import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { detectDir } from "@/components/workspace/DocBlock";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { LexicalBubble } from "@/components/workspace/lexical/LexicalBubble";
import { listTheses, getThesisDocument, applyThesisOps, type DocBlockDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { applyOpToBlocks, type ThesisOp } from "@/lib/thesis-ops";
import type { Thesis } from "@/types/thesis";

// WRITE-BACK proof (structural, LCS diff): edit a REAL thesis in Lexical →
// serialize → LCS-diff the loaded baseline vs the edit into a MINIMAL op sequence
// (editText / splitParagraph / deleteBlocks / format), simulating indices with the
// store's own applyOpToBlocks → write through the durable op-queue → flush → verify.
// Confirm-gated; undoable from History. A hard op cap aborts implausibly large
// diffs (protects the thesis from a mis-aligned cascade). Each op is one server
// call — a production build would batch these into a bulk endpoint.

type ParaRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };
type ParagraphDTO = Extract<DocBlockDTO, { kind: "paragraph" }>;
const CAP = 120;
const MAX_OPS = 1000; // one batch call now handles many ops; cap matches the server

function runsOf(b: ParagraphDTO): ParaRun[] {
  const r = (b as { runs?: ParaRun[] }).runs;
  return r?.length ? r : b.text ? [{ text: b.text }] : [];
}
function normMarks(runs: ParaRun[]): string {
  const cleaned = runs.map((r) => ({ b: !!r.bold, i: !!r.italic, u: !!r.underline, c: (r.color || "").replace(/^#/, "").toUpperCase() }));
  const merged: typeof cleaned = [];
  for (const r of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.u === r.u && last.c === r.c) continue;
    merged.push(r);
  }
  return JSON.stringify(merged.filter((r) => r.b || r.i || r.u || r.c));
}
const uiAlign = (a: ParagraphDTO["alignment"]) => (a === "both" ? "justify" : a === "left" || a === "center" || a === "right" ? a : undefined);

function tsig(b: DocBlockDTO): string {
  if (b.kind === "paragraph") return "p|" + b.text;
  if (b.kind === "table") return "t|" + JSON.stringify(b.rows);
  if (b.kind === "image") return "i|" + (b.dataUri ?? "") + "|" + (b.caption ?? "") + "|" + (b.hasMedia ? 1 : 0);
  return "o|" + b.tag;
}
type Fmt = { level?: number; alignment?: "left" | "center" | "right" | "justify"; direction?: "rtl" | "ltr" };
function fmtChanges(o: ParagraphDTO, n: ParagraphDTO): Fmt | null {
  const c: Fmt = {};
  if (o.level !== n.level) c.level = n.level;
  if ((o.alignment ?? null) !== (n.alignment ?? null)) {
    const ui = uiAlign(n.alignment);
    if (ui) c.alignment = ui;
  }
  const oDir = o.direction ?? detectDir(o.text, false);
  const nDir = n.direction ?? detectDir(n.text, false);
  if (oDir !== nDir && (n.direction === "rtl" || n.direction === "ltr")) c.direction = n.direction;
  return Object.keys(c).length ? c : null;
}

type Step = { op: "keep" | "del" | "ins"; ai?: number; bi?: number };

// Minimal edit script via LCS on content signatures — no cascade: unchanged blocks
// stay KEEP, so an edit only produces ops for what actually changed.
function lcsScript(A: string[], B: string[]): Step[] {
  const n = A.length, m = B.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Step[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ op: "keep", ai: i, bi: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: "del", ai: i }); i++; }
    else { out.push({ op: "ins", bi: j }); j++; }
  }
  while (i < n) out.push({ op: "del", ai: i++ });
  while (j < m) out.push({ op: "ins", bi: j++ });
  return out;
}

function planOps(base: DocBlockDTO[], target: DocBlockDTO[]): { ops: ThesisOp[]; unsupported: string[]; converged: boolean } {
  const script = lcsScript(base.map(tsig), target.map(tsig));
  let sim: DocBlockDTO[] = base.map((b, k) => ({ ...b, index: k }));
  const ops: ThesisOp[] = [];
  const unsupported: string[] = [];
  const emit = (op: ThesisOp) => { ops.push(op); sim = applyOpToBlocks(sim, op); };
  const asPara = (b: DocBlockDTO | undefined) => (b && b.kind === "paragraph" ? b : null);
  let pos = 0;

  for (let k = 0; k < script.length; k++) {
    const step = script[k];
    const next = script[k + 1];
    // del followed by ins on paragraphs → an in-place text replace (one editText)
    if (step.op === "del" && next && next.op === "ins") {
      const oldB = asPara(base[step.ai!]);
      const newB = asPara(target[next.bi!]);
      if (oldB && newB) {
        const cur = asPara(sim[pos]);
        if (cur && cur.text !== newB.text) emit({ type: "editText", index: pos, text: newB.text });
        const now = asPara(sim[pos]);
        if (now) {
          const fc = fmtChanges(now, newB);
          if (fc) emit({ type: "format", indices: [pos], changes: fc });
          if (normMarks(runsOf(now)) !== normMarks(runsOf(newB))) unsupported.push(`inline run formatting @${pos}`);
        }
        pos++; k++; // consume the ins too
        continue;
      }
    }
    if (step.op === "keep") {
      const cur = asPara(sim[pos]);
      const newB = asPara(target[step.bi!]);
      if (cur && newB) {
        const fc = fmtChanges(cur, newB);
        if (fc) emit({ type: "format", indices: [pos], changes: fc });
        if (normMarks(runsOf(cur)) !== normMarks(runsOf(newB))) unsupported.push(`inline run formatting @${pos}`);
      }
      pos++;
    } else if (step.op === "del") {
      emit({ type: "deleteBlocks", indices: [pos] }); // pos stays; next block shifts in
    } else {
      // insert target[bi] at pos via a split on an adjacent paragraph
      const newB = target[step.bi!];
      if (newB.kind !== "paragraph") { unsupported.push(`insert ${newB.kind} @${pos}`); continue; }
      if (pos === 0) {
        const first = asPara(sim[0]);
        if (!first) { unsupported.push(`insert @0 needs a paragraph anchor`); continue; }
        emit({ type: "splitParagraph", index: 0, before: newB.text, after: first.text });
      } else {
        const anchor = asPara(sim[pos - 1]);
        if (!anchor) { unsupported.push(`insert @${pos} needs a paragraph anchor`); continue; }
        emit({ type: "splitParagraph", index: pos - 1, before: anchor.text, after: newB.text });
      }
      const now = asPara(sim[pos]);
      if (now) { const fc = fmtChanges(now, newB); if (fc) emit({ type: "format", indices: [pos], changes: fc }); }
      pos++;
    }
  }
  const converged = sim.length === target.length && target.every((t, k) => sim[k] && tsig(sim[k]) === tsig(t));
  return { ops, unsupported, converged };
}

function tally(ops: ThesisOp[]): string {
  const c: Record<string, number> = {};
  for (const o of ops) c[o.type] = (c[o.type] ?? 0) + 1;
  return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ") || "none";
}
function opLine(o: ThesisOp): string {
  if (o.type === "editText") return `editText @${o.index}: "${o.text.slice(0, 22)}${o.text.length > 22 ? "…" : ""}"`;
  if (o.type === "splitParagraph") return `split @${o.index} (+ "${o.after.slice(0, 18)}…")`;
  if (o.type === "deleteBlocks") return `delete @${o.indices.join(",")}`;
  if (o.type === "format") return `format @${o.indices.join(",")} ${JSON.stringify(o.changes)}`;
  return o.type;
}

type ResultT = { ops: ThesisOp[]; unsupported: string[]; verified?: { matched: number; total: number; drained: boolean }; error?: string; note?: string };

export default function LexicalWritebackScreen() {
  const colors = useThemeColors();
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<DocBlockDTO[]>([]);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ResultT | null>(null);

  const [active, setActive] = useState<LexicalState>({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, index: -1, text: "" });
  const [command, setCommand] = useState<LexicalCommand | null>(null);
  const nonce = useRef(0);
  const ctx = useRef<{ baseline: DocBlockDTO[]; thesisId: string | null; title: string }>({ baseline: [], thesisId: null, title: "" });
  const pendingSave = useRef(false);

  useEffect(() => { listTheses().then(setTheses).catch(() => {}); }, []);

  const send = useCallback((type: string, value?: string) => { setCommand({ type, value, nonce: ++nonce.current } as LexicalCommand); }, []);
  const onState = useCallback((s: LexicalState) => setActive(s), []);

  const select = useCallback(async (t: Thesis) => {
    setError(null);
    setSelectedId(t.id);
    setLoading(true);
    try {
      const doc = await getThesisDocument(t.id);
      if (!doc.available) {
        setError("Legacy section-model thesis — no live blocks.");
        setBlocks([]);
        ctx.current = { baseline: [], thesisId: null, title: t.title };
      } else {
        const loaded = doc.blocks.slice(0, CAP);
        setBlocks(loaded);
        setReloadNonce((n) => n + 1);
        ctx.current = { baseline: loaded, thesisId: t.id, title: t.title || "this thesis" };
      }
    } catch {
      setError("Couldn't load the thesis.");
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const persist = useCallback(async (thesisId: string, ops: ThesisOp[], unsupported: string[], target: DocBlockDTO[]) => {
    setSaving(true);
    try {
      // ONE call: the server replays all ops under a single lock and one .docx save.
      const res = await applyThesisOps(thesisId, ops);
      const doc = res.document;
      // Sync the workspace's shared doc cache from the echoed document.
      if (doc) useThesisDocStore.getState().setDoc(thesisId, doc);
      let matched = 0;
      if (doc?.available) {
        for (let i = 0; i < target.length; i++) {
          if (doc.blocks[i] && tsig(doc.blocks[i]) === tsig(target[i])) matched++;
        }
        const nb = doc.blocks.slice(0, CAP);
        setBlocks(nb);
        setReloadNonce((n) => n + 1);
        ctx.current = { ...ctx.current, baseline: nb };
      }
      const serverSkipped = (res.skipped ?? []).map((s) => `server: ${s}`);
      setResult({ ops, unsupported: [...unsupported, ...serverSkipped], verified: { matched, total: target.length, drained: res.applied >= ops.length } });
    } catch {
      setResult({ ops, unsupported, error: "Write-back failed (the batch request errored)." });
    } finally {
      setSaving(false);
    }
  }, []);

  const onBlocks = useCallback((serialized: DocBlockDTO[]) => {
    if (!pendingSave.current) return;
    pendingSave.current = false;
    const { baseline, thesisId, title } = ctx.current;
    if (!thesisId) return;
    const { ops, unsupported, converged } = planOps(baseline, serialized);
    if (ops.length === 0) {
      setResult({ ops: [], unsupported, note: converged ? "No persistable changes detected." : "Couldn't reconcile the edit into ops." });
      return;
    }
    if (ops.length > MAX_OPS) {
      setResult({ ops: [], unsupported, error: `Diff produced ${ops.length} ops (cap ${MAX_OPS}) — aborted to protect the thesis. Make a smaller edit; large structural edits need a bulk endpoint, not one call per op.` });
      return;
    }
    Alert.alert(
      "Persist to the real thesis?",
      `${ops.length} op(s): ${tally(ops)}. Written to "${title}", undoable from History.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => setResult({ ops: [], unsupported, note: "Cancelled." }) },
        { text: "Persist", style: "destructive", onPress: () => { setResult({ ops, unsupported }); void persist(thesisId, ops, unsupported, serialized); } },
      ],
    );
  }, [persist]);

  const runSave = () => {
    if (!ctx.current.thesisId || blocks.length === 0) return;
    pendingSave.current = true;
    setResult(null);
    send("serialize");
  };

  const verified = result?.verified;
  const allOk = !!verified && verified.matched === verified.total && verified.drained;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Write-back proof</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker} contentContainerStyle={styles.pickerRow}>
        {theses.map((t) => {
          const on = selectedId === t.id;
          return (
            <Pressable key={t.id} onPress={() => void select(t)} style={[styles.chip, { borderColor: colors.borderDefault, backgroundColor: on ? colors.brandPrimary : colors.bgCard }]}>
              <Text numberOfLines={1} style={[styles.chipText, { color: on ? colors.bgPrimary : colors.textPrimary }]}>{t.title || "Untitled"}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {loading ? "Loading…" : error ? error : !selectedId ? "Pick a thesis, make a SMALL edit, then Save." : `${blocks.length} blocks · edit, then Save`}
      </Text>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.editorWrap, { borderColor: colors.borderSubtle }]}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : blocks.length === 0 ? (
            <View style={styles.center}><Text style={{ color: colors.textPlaceholder }}>{error ?? "Pick a thesis above"}</Text></View>
          ) : (
            <LexicalDomEditor
              key={`${selectedId}:${reloadNonce}`}
              initialBlocks={blocks}
              command={command}
              onState={onState}
              onBlocks={onBlocks}
              dom={{ style: { flex: 1 }, scrollEnabled: true, keyboardDisplayRequiresUserAction: false, hideKeyboardAccessoryView: true }}
            />
          )}
        </View>
        <LexicalBubble active={active} onCommand={send} />
        <Pressable onPress={runSave} disabled={saving || blocks.length === 0} style={[styles.runBtn, { backgroundColor: blocks.length > 0 && !saving ? colors.brandPrimary : colors.borderDefault }]}>
          <Text style={[styles.runText, { color: colors.bgPrimary }]}>{saving ? "Saving…" : "Save to thesis  ↑"}</Text>
        </Pressable>
      </KeyboardAvoidingView>

      <Modal visible={!!result} animationType="slide" transparent onRequestClose={() => setResult(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.bgPrimary }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: allOk ? (colors.semanticSuccess ?? "#2f9e6f") : colors.textPrimary }]}>
                {verified ? (allOk ? "✓ Persisted & verified" : "Persisted · partial") : "Write-back"}
              </Text>
              <Pressable onPress={() => setResult(null)}><Text style={[styles.close, { color: colors.brandPrimary }]}>Done</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {saving && <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 12 }} />}
              {result?.error && <Text style={[styles.big, { color: colors.semanticError ?? "#c0392b" }]}>{result.error}</Text>}
              {result?.note && <Text style={[styles.note, { color: colors.textSecondary }]}>{result.note}</Text>}
              {verified && (
                <Text style={[styles.big, { color: allOk ? (colors.semanticSuccess ?? "#2f9e6f") : (colors.semanticError ?? "#c0392b") }]}>
                  {verified.matched}/{verified.total} positions match the edit on the server{verified.drained ? "" : " (queue not fully drained)"}
                </Text>
              )}
              {result && result.ops.length > 0 && (
                <View style={[styles.rowCard, { borderColor: colors.borderSubtle }]}>
                  <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{result.ops.length} op(s) · {tally(result.ops)}</Text>
                  {result.ops.slice(0, 12).map((o, i) => (
                    <Text key={i} style={[styles.code, { color: colors.textSecondary }]}>{opLine(o)}</Text>
                  ))}
                  {result.ops.length > 12 && <Text style={[styles.code, { color: colors.textPlaceholder }]}>… +{result.ops.length - 12} more</Text>}
                </View>
              )}
              {result?.unsupported.slice(0, 8).map((u, i) => (
                <View key={`u${i}`} style={[styles.rowCard, { borderColor: colors.borderSubtle }]}>
                  <Text style={[styles.rowTitle, { color: colors.textSecondary }]}>SKIPPED</Text>
                  <Text style={[styles.note, { color: colors.textSecondary }]}>{u}</Text>
                </View>
              ))}
              {verified && (
                <Text style={[styles.note, { color: colors.textSecondary }]}>Reopen this thesis in the workspace — the change is in the shared doc cache and the .docx.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  picker: { maxHeight: 44, flexGrow: 0 },
  pickerRow: { paddingHorizontal: 14, gap: 8, alignItems: "center" },
  chip: { maxWidth: 180, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12.5, fontFamily: "Inter_500Medium" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", paddingHorizontal: 20, paddingVertical: 8 },
  editorWrap: { flex: 1, marginHorizontal: 12, marginBottom: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", backgroundColor: "#ffffff" },
  runBtn: { marginHorizontal: 12, marginTop: 4, marginBottom: 8, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  runText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modalCard: { maxHeight: "80%", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  close: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  big: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 4 },
  rowCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, marginBottom: 8 },
  rowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  code: { fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginTop: 2 },
});
