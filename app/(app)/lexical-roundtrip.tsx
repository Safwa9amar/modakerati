import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { detectDir } from "@/components/workspace/DocBlock";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { LexicalBubble } from "@/components/workspace/lexical/LexicalBubble";
import { listTheses, getThesisDocument, type DocBlockDTO } from "@/lib/api";
import type { Thesis } from "@/types/thesis";

// Round-trip spike, now over REAL thesis data: pick a thesis → load its live-.docx
// blocks from the API → seed Lexical → serialize back → diff each block. The editor
// is seeded from `blocks` (Sample or a real thesis); structural blocks (table/image)
// render for real and round-trip verbatim. This screen never imports the conversion
// module — that runs inside the DOM component.

type ParaRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };

const SAMPLE_BLOCKS: DocBlockDTO[] = [
  { index: 0, kind: "paragraph", text: "الفصل الأول: منهجية البحث", styleId: "Heading1", level: 1, alignment: "center", direction: "rtl" },
  {
    index: 1, kind: "paragraph", text: "تُعدّ هذه الدراسة محاولةً جادة لفهم الأثر.",
    styleId: "Normal", level: 0, alignment: "both", direction: "rtl",
    runs: [{ text: "تُعدّ هذه الدراسة " }, { text: "محاولةً جادة", bold: true, color: "C0392B" }, { text: " لفهم الأثر." }],
  } as unknown as DocBlockDTO,
  {
    index: 2, kind: "paragraph", text: "This paragraph is left-to-right and mixes styles.",
    styleId: "Normal", level: 0, alignment: "left", direction: "ltr",
    runs: [{ text: "This paragraph is " }, { text: "left-to-right", italic: true, underline: true }, { text: " and mixes styles." }],
  } as unknown as DocBlockDTO,
  { index: 3, kind: "table", rows: [["Variable", "Value"], ["N", "120"]] },
  { index: 4, kind: "image", hasMedia: true, width: 640, height: 360, caption: "الشكل 1: توزيع البيانات" },
  { index: 5, kind: "other", tag: "sdt" },
];

const CAP = 120; // don't push an entire 700-page thesis across the DOM bridge

function normMarks(runs: ParaRun[]): ParaRun[] {
  const cleaned = runs.map((r) => ({
    text: r.text, bold: !!r.bold, italic: !!r.italic, underline: !!r.underline,
    color: (r.color || "").replace(/^#/, "").toUpperCase() || undefined,
  }));
  const merged: typeof cleaned = [];
  for (const r of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic && last.underline === r.underline && last.color === r.color) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged.some((r) => r.bold || r.italic || r.underline || r.color) ? merged : [];
}

function signature(b: DocBlockDTO): unknown {
  if (b.kind === "paragraph") {
    const runs = (b as { runs?: ParaRun[] }).runs ?? (b.text ? [{ text: b.text }] : []);
    return { k: "paragraph", text: b.text, level: b.level, align: b.alignment, dir: b.direction ?? detectDir(b.text, false), marks: normMarks(runs) };
  }
  if (b.kind === "table") return { k: "table", rows: b.rows };
  if (b.kind === "image") return { k: "image", dataUri: b.dataUri ?? null, hasMedia: !!b.hasMedia, width: b.width ?? null, height: b.height ?? null, caption: b.caption ?? null };
  return { k: "other", tag: b.tag };
}
const j = (v: unknown) => JSON.stringify(v, null, 1);

export default function LexicalRoundtripScreen() {
  const colors = useThemeColors();
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [selectedId, setSelectedId] = useState<string>("sample");
  const [blocks, setBlocks] = useState<DocBlockDTO[]>(SAMPLE_BLOCKS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<{ shown: number; total: number } | null>(null);

  const [active, setActive] = useState<LexicalState>({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, alignment: null, index: -1, text: "" });
  const [command, setCommand] = useState<LexicalCommand | null>(null);
  const [roundtripped, setRoundtripped] = useState<DocBlockDTO[] | null>(null);
  const [showResults, setShowResults] = useState(false);
  const nonce = useRef(0);

  useEffect(() => {
    listTheses().then(setTheses).catch(() => {});
  }, []);

  const send = useCallback((type: string, value?: string) => {
    setCommand({ type, value, nonce: ++nonce.current } as LexicalCommand);
  }, []);
  const onState = useCallback((s: LexicalState) => setActive(s), []);
  const onBlocks = useCallback((serialized: DocBlockDTO[]) => {
    setRoundtripped(serialized);
    setShowResults(true);
  }, []);

  const selectSource = useCallback(async (id: string) => {
    setRoundtripped(null);
    setShowResults(false);
    setError(null);
    setSelectedId(id);
    if (id === "sample") {
      setBlocks(SAMPLE_BLOCKS);
      setTruncated(null);
      return;
    }
    setLoading(true);
    try {
      const doc = await getThesisDocument(id);
      if (!doc.available) {
        setError("This thesis is on the legacy section model — no live blocks to load.");
        setBlocks([]);
        setTruncated(null);
      } else {
        setBlocks(doc.blocks.slice(0, CAP));
        setTruncated(doc.blocks.length > CAP ? { shown: CAP, total: doc.blocks.length } : null);
      }
    } catch {
      setError("Couldn't load the thesis document.");
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const rows = useMemo(() => {
    if (!roundtripped) return [];
    return blocks.map((orig, i) => {
      const rt = roundtripped[i];
      const a = signature(orig);
      const b = rt ? signature(rt) : null;
      const pass = !!b && j(a) === j(b);
      return { i, kind: orig.kind, pass, a: j(a), b: b ? j(b) : "— missing —" };
    });
  }, [roundtripped, blocks]);
  const passCount = rows.filter((r) => r.pass).length;

  const chip = (id: string, label: string) => {
    const on = selectedId === id;
    return (
      <Pressable
        key={id}
        onPress={() => void selectSource(id)}
        style={[styles.chip, { borderColor: colors.borderDefault, backgroundColor: on ? colors.brandPrimary : colors.bgCard }]}
      >
        <Text numberOfLines={1} style={[styles.chipText, { color: on ? colors.bgPrimary : colors.textPrimary }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Round-trip · real data</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker} contentContainerStyle={styles.pickerRow}>
        {chip("sample", "Sample")}
        {theses.map((t) => chip(t.id, t.title || "Untitled"))}
      </ScrollView>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {loading ? "Loading…" : error ? error : `${blocks.length} blocks${truncated ? ` (first ${truncated.shown} of ${truncated.total})` : ""} · edit, then run the round-trip`}
      </Text>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.editorWrap, { borderColor: colors.borderSubtle }]}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : blocks.length === 0 ? (
            <View style={styles.center}><Text style={{ color: colors.textPlaceholder }}>{error ?? "No blocks"}</Text></View>
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
          onPress={() => blocks.length > 0 && send("serialize")}
          style={[styles.runBtn, { backgroundColor: blocks.length > 0 ? colors.brandPrimary : colors.borderDefault }]}
        >
          <Text style={[styles.runText, { color: colors.bgPrimary }]}>Run round-trip  ✓</Text>
        </Pressable>
      </KeyboardAvoidingView>

      <Modal visible={showResults} animationType="slide" transparent onRequestClose={() => setShowResults(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.bgPrimary }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                {passCount === rows.length && rows.length > 0 ? "✓ " : ""}{passCount}/{rows.length} blocks preserved
              </Text>
              <Pressable onPress={() => setShowResults(false)}><Text style={[styles.close, { color: colors.brandPrimary }]}>Done</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {rows.map((r) => (
                <View key={r.i} style={[styles.rowCard, { borderColor: colors.borderSubtle }]}>
                  <Text style={[styles.rowTitle, { color: r.pass ? (colors.semanticSuccess ?? "#2f9e6f") : (colors.semanticError ?? "#c0392b") }]}>
                    {r.pass ? "PASS" : "DIFF"} · block {r.i} · {r.kind}
                  </Text>
                  {!r.pass && (
                    <View style={styles.diffWrap}>
                      <Text style={[styles.diffLabel, { color: colors.textSecondary }]}>original</Text>
                      <Text style={[styles.code, { color: colors.textPrimary }]}>{r.a}</Text>
                      <Text style={[styles.diffLabel, { color: colors.textSecondary }]}>round-tripped</Text>
                      <Text style={[styles.code, { color: colors.textPrimary }]}>{r.b}</Text>
                    </View>
                  )}
                </View>
              ))}
              <Text style={[styles.caveat, { color: colors.textSecondary }]}>
                DIFFs are the finding, not a failure — they show exactly where a real Lexical migration
                would need work (e.g. an explicit direction override, run boundaries, or a block kind not
                yet modelled). Lexical lists have no block-model equivalent and flatten to a paragraph.
              </Text>
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
  rowCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, marginBottom: 8 },
  rowTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  diffWrap: { marginTop: 6, gap: 2 },
  diffLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", marginTop: 4 },
  code: { fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  caveat: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 8, paddingHorizontal: 4 },
});
