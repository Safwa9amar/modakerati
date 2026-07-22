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
import type { Thesis } from "@/types/thesis";

// WRITE-BACK proof: edit a REAL thesis in Lexical → serialize → diff vs the loaded
// baseline → persist each changed paragraph through the EXISTING edit endpoint
// (editThesisParagraph, the same call the durable op-queue's executeOp uses) →
// verify against the document the endpoint echoes back. Confirm-gated because it
// mutates real thesis content (undoable from the thesis History). Scope: text +
// paragraph-level format (level/alignment/direction). Inline-run changes (bold a
// word) need the deferred formatRange op; structural changes (Δ block count) need
// split/insert/delete — both are DETECTED and reported, never silently applied.

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

type EditChange = { index: number; changes: { text?: string; level?: number; alignment?: "left" | "center" | "right" | "justify"; direction?: "rtl" | "ltr" } };
type Skip = { index: number; reason: string };
type Verify = { index: number; ok: boolean };

// Diff one loaded block vs its serialized counterpart at the same index.
function diffPair(o: DocBlockDTO, n: DocBlockDTO): { change?: EditChange; skip?: Skip } {
  if (o.kind !== "paragraph" || n.kind !== "paragraph") {
    return o.kind === n.kind ? {} : { skip: { index: o.index, reason: `kind changed ${o.kind}→${n.kind}` } };
  }
  const changes: EditChange["changes"] = {};
  if (o.text !== n.text) changes.text = n.text;
  if (o.level !== n.level) changes.level = n.level;
  if ((o.alignment ?? null) !== (n.alignment ?? null)) {
    const ui = uiAlign(n.alignment);
    if (ui) changes.alignment = ui;
  }
  const oDir = o.direction ?? detectDir(o.text, false);
  const nDir = n.direction ?? detectDir(n.text, false);
  if (oDir !== nDir && (n.direction === "rtl" || n.direction === "ltr")) changes.direction = n.direction;
  if (Object.keys(changes).length > 0) return { change: { index: o.index, changes } };
  if (normMarks(runsOf(o)) !== normMarks(runsOf(n))) return { skip: { index: o.index, reason: "inline run formatting — needs formatRange op" } };
  return {};
}

export default function LexicalWritebackScreen() {
  const colors = useThemeColors();
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<DocBlockDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ sent: EditChange[]; skipped: Skip[]; verified: Verify[]; structural?: string; error?: string } | null>(null);

  const [active, setActive] = useState<LexicalState>({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false });
  const [command, setCommand] = useState<LexicalCommand | null>(null);
  const nonce = useRef(0);

  // Save context read at serialize time (avoids stale closures in onBlocks).
  const ctx = useRef<{ baseline: DocBlockDTO[]; thesisId: string | null; title: string }>({ baseline: [], thesisId: null, title: "" });
  const pendingSave = useRef(false);

  useEffect(() => {
    listTheses().then(setTheses).catch(() => {});
  }, []);

  const send = useCallback((type: string, value?: string) => {
    setCommand({ type, value, nonce: ++nonce.current } as LexicalCommand);
  }, []);
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
        ctx.current = { baseline: loaded, thesisId: t.id, title: t.title || "this thesis" };
      }
    } catch {
      setError("Couldn't load the thesis.");
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Persist through the DURABLE OP-QUEUE (production path). Writing via the doc
  // store's `mutate` updates the SAME cached doc the workspace reads (so it stops
  // showing stale content), enqueues durable ops, and `flushOps` forces them to
  // the server. Then we verify against the reconciled store doc.
  const persist = useCallback(async (thesisId: string, sent: EditChange[]) => {
    setSaving(true);
    const store = useThesisDocStore.getState();
    try {
      // Share the same loaded doc as the workspace (optimistic base + sync target).
      await store.load(thesisId);
      for (const c of sent) {
        if (c.changes.text != null) {
          await store.mutate(thesisId, { type: "editText", index: c.index, text: c.changes.text });
        }
        const fmt: { level?: number; alignment?: "left" | "center" | "right" | "justify"; direction?: "rtl" | "ltr" } = {};
        if (c.changes.level != null) fmt.level = c.changes.level;
        if (c.changes.alignment) fmt.alignment = c.changes.alignment;
        if (c.changes.direction) fmt.direction = c.changes.direction;
        if (Object.keys(fmt).length > 0) {
          await store.mutate(thesisId, { type: "format", indices: [c.index], changes: fmt });
        }
      }
      const drained = await store.flushOps(thesisId, { timeoutMs: 20_000 });
      const doc = useThesisDocStore.getState().byId[thesisId];
      const verified: Verify[] = sent.map((c) => {
        if (!doc || !doc.available) return { index: c.index, ok: false };
        const blk = doc.blocks.find((b) => b.index === c.index);
        const okText = c.changes.text == null || (blk?.kind === "paragraph" && blk.text === c.changes.text);
        return { index: c.index, ok: drained && !!blk && okText };
      });
      // New baseline = reconciled server state so a second save diffs correctly.
      if (doc && doc.available) {
        const nb = doc.blocks.slice(0, CAP);
        setBlocks(nb);
        ctx.current = { ...ctx.current, baseline: nb };
      }
      setResult((r) => ({ sent, skipped: r?.skipped ?? [], verified, structural: r?.structural }));
    } catch {
      setResult((r) => ({ sent, skipped: r?.skipped ?? [], verified: [], error: "The write-back failed." }));
    } finally {
      setSaving(false);
    }
  }, []);

  const onBlocks = useCallback((serialized: DocBlockDTO[]) => {
    if (!pendingSave.current) return;
    pendingSave.current = false;
    const { baseline, thesisId, title } = ctx.current;
    if (!thesisId) return;

    if (serialized.length !== baseline.length) {
      setResult({ sent: [], skipped: [], verified: [], structural: `Block count changed ${baseline.length}→${serialized.length} — structural edits (split/insert/delete) aren't in this write-back spike.` });
      return;
    }
    const sent: EditChange[] = [];
    const skipped: Skip[] = [];
    for (let i = 0; i < baseline.length; i++) {
      const { change, skip } = diffPair(baseline[i], serialized[i]);
      if (change) sent.push(change);
      if (skip) skipped.push(skip);
    }
    if (sent.length === 0) {
      setResult({ sent: [], skipped, verified: [] });
      return;
    }
    Alert.alert(
      "Persist to the real thesis?",
      `Write ${sent.length} paragraph change(s) to "${title}". You can undo this from the thesis History.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => setResult({ sent: [], skipped, verified: [], error: "Cancelled." }) },
        { text: "Persist", style: "destructive", onPress: () => { setResult({ sent, skipped, verified: [] }); void persist(thesisId, sent); } },
      ],
    );
  }, [persist]);

  const runSave = () => {
    if (!ctx.current.thesisId || blocks.length === 0) return;
    pendingSave.current = true;
    setResult(null);
    send("serialize");
  };

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
        {loading ? "Loading…" : error ? error : !selectedId ? "Pick a thesis, edit a paragraph, then Save to persist it." : `${blocks.length} blocks · edit, then Save`}
      </Text>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.editorWrap, { borderColor: colors.borderSubtle }]}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : blocks.length === 0 ? (
            <View style={styles.center}><Text style={{ color: colors.textPlaceholder }}>{error ?? "Pick a thesis above"}</Text></View>
          ) : (
            <LexicalDomEditor
              key={`${selectedId}:${blocks.length}`}
              initialBlocks={blocks}
              command={command}
              onState={onState}
              onBlocks={onBlocks}
              dom={{ style: { flex: 1 }, scrollEnabled: true, keyboardDisplayRequiresUserAction: false, hideKeyboardAccessoryView: true }}
            />
          )}
        </View>
        <LexicalBubble active={active} onCommand={send} />
        <Pressable
          onPress={runSave}
          disabled={saving || blocks.length === 0}
          style={[styles.runBtn, { backgroundColor: blocks.length > 0 && !saving ? colors.brandPrimary : colors.borderDefault }]}
        >
          <Text style={[styles.runText, { color: colors.bgPrimary }]}>{saving ? "Saving…" : "Save to thesis  ↑"}</Text>
        </Pressable>
      </KeyboardAvoidingView>

      <Modal visible={!!result} animationType="slide" transparent onRequestClose={() => setResult(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.bgPrimary }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Write-back result</Text>
              <Pressable onPress={() => setResult(null)}><Text style={[styles.close, { color: colors.brandPrimary }]}>Done</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {result?.error && <Text style={[styles.big, { color: colors.semanticError ?? "#c0392b" }]}>{result.error}</Text>}
              {result?.structural && <Text style={[styles.note, { color: colors.textSecondary }]}>{result.structural}</Text>}
              {!result?.error && !result?.structural && result?.sent.length === 0 && (
                <Text style={[styles.note, { color: colors.textSecondary }]}>No persistable changes detected.</Text>
              )}
              {saving && <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 12 }} />}
              {result?.sent.map((c) => {
                const v = result.verified.find((x) => x.index === c.index);
                const ok = v?.ok;
                return (
                  <View key={`s${c.index}`} style={[styles.rowCard, { borderColor: colors.borderSubtle }]}>
                    <Text style={[styles.rowTitle, { color: ok ? (colors.semanticSuccess ?? "#2f9e6f") : v ? (colors.semanticError ?? "#c0392b") : colors.textSecondary }]}>
                      {ok ? "PERSISTED ✓ verified" : v ? "SENT · verify failed" : "SENT…"} · block {c.index}
                    </Text>
                    <Text style={[styles.code, { color: colors.textPrimary }]}>{JSON.stringify(c.changes)}</Text>
                  </View>
                );
              })}
              {result?.skipped.map((s) => (
                <View key={`k${s.index}`} style={[styles.rowCard, { borderColor: colors.borderSubtle }]}>
                  <Text style={[styles.rowTitle, { color: colors.textSecondary }]}>SKIPPED · block {s.index}</Text>
                  <Text style={[styles.note, { color: colors.textSecondary }]}>{s.reason}</Text>
                </View>
              ))}
              {result && result.verified.length > 0 && (
                <Text style={[styles.note, { color: colors.textSecondary }]}>
                  Verified against the document the server echoed back — reopen this thesis in the workspace to see it there too.
                </Text>
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
  rowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  code: { fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginTop: 4 },
});
