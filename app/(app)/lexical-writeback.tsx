import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { detectDir } from "@/components/workspace/DocBlock";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { LexicalBubble } from "@/components/workspace/lexical/LexicalBubble";
import { listTheses, getThesisDocument, type DocBlockDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { applyOpToBlocks, type ThesisOp } from "@/lib/thesis-ops";
import type { Thesis } from "@/types/thesis";

// WRITE-BACK proof (structural): edit a REAL thesis in Lexical → serialize → diff
// the loaded baseline vs the edit into an OP SEQUENCE (editText / splitParagraph /
// deleteBlocks / format) using the SAME applyOpToBlocks the store uses to keep
// indices consistent → write through the durable op-queue (store.mutate) → flush →
// verify against the reconciled doc. Confirm-gated (mutates real content; undoable
// from thesis History). Reports what it can't express (inline runs → formatRange;
// non-paragraph inserts) instead of writing something wrong.

type ParaRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };
type ParagraphDTO = Extract<DocBlockDTO, { kind: "paragraph" }>;
const CAP = 120;

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

// Content identity used to ALIGN blocks (structure). Text-only for paragraphs so a
// format-only change stays "the same block" and is handled by the format pass.
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

// Diff base → target into an op sequence. `sim` mirrors the doc as ops apply
// (applyOpToBlocks == the store's optimistic patch), so op indices stay correct.
function planOps(base: DocBlockDTO[], target: DocBlockDTO[]): { ops: ThesisOp[]; unsupported: string[]; converged: boolean } {
  let sim: DocBlockDTO[] = base.map((b, i) => ({ ...b, index: i }));
  const ops: ThesisOp[] = [];
  const unsupported: string[] = [];
  const emit = (op: ThesisOp) => { ops.push(op); sim = applyOpToBlocks(sim, op); };

  // ── structural pass: make sim match target by content/order ──
  const MAX = base.length + target.length + 30;
  let guard = 0;
  while (guard++ < MAX) {
    let p = -1;
    for (let i = 0; i < target.length; i++) {
      if (i >= sim.length || tsig(sim[i]) !== tsig(target[i])) { p = i; break; }
    }
    if (p === -1) {
      if (sim.length > target.length) { emit({ type: "deleteBlocks", indices: [target.length] }); continue; }
      break;
    }
    const tgt = target[p];
    const cur: DocBlockDTO | undefined = sim[p];
    const nextT = p + 1 < target.length ? tsig(target[p + 1]) : "\x00";
    const nextS = p + 1 < sim.length ? tsig(sim[p + 1]) : "\x00";
    const isInsert = cur != null && tsig(cur) === nextT;
    const isDelete = cur != null && nextS === tsig(tgt);

    if (cur == null || (isInsert && !isDelete)) {
      if (tgt.kind !== "paragraph") {
        unsupported.push(`insert ${tgt.kind} @${p}`);
        sim = [...sim.slice(0, p), { ...tgt, index: p }, ...sim.slice(p)].map((b, i) => ({ ...b, index: i }));
        continue;
      }
      if (p === 0) {
        if (sim[0]?.kind !== "paragraph") { unsupported.push(`insert @0 needs a paragraph anchor`); break; }
        emit({ type: "splitParagraph", index: 0, before: tgt.text, after: (sim[0] as ParagraphDTO).text });
      } else {
        const a = sim[p - 1];
        if (a?.kind !== "paragraph") { unsupported.push(`insert @${p} needs a paragraph anchor`); break; }
        emit({ type: "splitParagraph", index: p - 1, before: (a as ParagraphDTO).text, after: tgt.text });
      }
      continue;
    }
    if (isDelete && !isInsert) { emit({ type: "deleteBlocks", indices: [p] }); continue; }

    // replace at p
    if (cur.kind === "paragraph" && tgt.kind === "paragraph") {
      if (cur.text !== tgt.text) emit({ type: "editText", index: p, text: tgt.text });
      else sim = sim.map((b, i) => (i === p ? { ...tgt, index: i } : b));
    } else {
      unsupported.push(`${cur.kind}→${tgt.kind} change @${p}`);
      sim = sim.map((b, i) => (i === p ? { ...tgt, index: i } : b));
    }
  }

  const converged = sim.length === target.length && target.every((t, i) => sim[i] && tsig(sim[i]) === tsig(t));

  // ── format pass (only when structure is aligned) ──
  if (converged) {
    for (let i = 0; i < target.length; i++) {
      const s = sim[i], t = target[i];
      if (s.kind === "paragraph" && t.kind === "paragraph") {
        const fc = fmtChanges(s, t);
        if (fc) emit({ type: "format", indices: [i], changes: fc });
        if (normMarks(runsOf(s)) !== normMarks(runsOf(t))) unsupported.push(`inline run formatting @${i} (needs formatRange)`);
      }
    }
  }
  return { ops, unsupported, converged };
}

function tally(ops: ThesisOp[]): string {
  const c: Record<string, number> = {};
  for (const o of ops) c[o.type] = (c[o.type] ?? 0) + 1;
  return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ") || "none";
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

  const [active, setActive] = useState<LexicalState>({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false });
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
    const store = useThesisDocStore.getState();
    try {
      await store.load(thesisId); // share the workspace's cached doc
      for (const op of ops) await store.mutate(thesisId, op);
      const drained = await store.flushOps(thesisId, { timeoutMs: 30_000 });
      const doc = useThesisDocStore.getState().byId[thesisId];
      let matched = 0;
      if (doc?.available) {
        for (let i = 0; i < target.length; i++) {
          if (doc.blocks[i] && tsig(doc.blocks[i]) === tsig(target[i])) matched++;
        }
        const nb = doc.blocks.slice(0, CAP);
        setBlocks(nb);
        setReloadNonce((n) => n + 1); // reseed editor from the persisted server state
        ctx.current = { ...ctx.current, baseline: nb };
      }
      setResult({ ops, unsupported, verified: { matched, total: target.length, drained } });
    } catch {
      setResult({ ops, unsupported, error: "Write-back failed (a request errored)." });
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
    Alert.alert(
      "Persist to the real thesis?",
      `${ops.length} op(s): ${tally(ops)}. Written to "${title}", undoable from the thesis History.`,
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
        {loading ? "Loading…" : error ? error : !selectedId ? "Pick a thesis, edit freely (add/remove/change lines), then Save." : `${blocks.length} blocks · edit, then Save`}
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
              {result?.unsupported.map((u, i) => (
                <View key={`u${i}`} style={[styles.rowCard, { borderColor: colors.borderSubtle }]}>
                  <Text style={[styles.rowTitle, { color: colors.textSecondary }]}>SKIPPED</Text>
                  <Text style={[styles.note, { color: colors.textSecondary }]}>{u}</Text>
                </View>
              ))}
              {verified && (
                <Text style={[styles.note, { color: colors.textSecondary }]}>Reopen this thesis in the workspace — the change is now in the shared doc cache and the .docx.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function opLine(o: ThesisOp): string {
  if (o.type === "editText") return `editText @${o.index}: "${o.text.slice(0, 24)}${o.text.length > 24 ? "…" : ""}"`;
  if (o.type === "splitParagraph") return `split @${o.index}  (+ "${o.after.slice(0, 20)}…")`;
  if (o.type === "deleteBlocks") return `delete @${o.indices.join(",")}`;
  if (o.type === "format") return `format @${o.indices.join(",")} ${JSON.stringify(o.changes)}`;
  return o.type;
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
