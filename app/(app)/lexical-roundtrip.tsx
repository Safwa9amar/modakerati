import { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { detectDir } from "@/components/workspace/DocBlock";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { LexicalBubble } from "@/components/workspace/lexical/LexicalBubble";
import type { DocBlockDTO } from "@/lib/api";

// Round-trip spike: prove blocks → Lexical → blocks preserves the document. The
// editor is SEEDED from SAMPLE_BLOCKS; "Run round-trip" asks Lexical to serialize
// back to blocks, and we diff each block. Text (heading/para/align/dir/inline
// runs) should PASS; table/image/other are carried opaque (verbatim). This screen
// never imports the conversion module — that runs inside the DOM component.

type ParaRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };

// Representative slice of a real thesis: RTL heading, RTL justified body with a
// bold+coloured run, an LTR paragraph with italic+underline, a table, a figure,
// and an opaque structural block.
const SAMPLE_BLOCKS: DocBlockDTO[] = [
  { index: 0, kind: "paragraph", text: "الفصل الأول: منهجية البحث", styleId: "Heading1", level: 1, alignment: "center", direction: "rtl" },
  {
    index: 1, kind: "paragraph",
    text: "تُعدّ هذه الدراسة محاولةً جادة لفهم الأثر.",
    styleId: "Normal", level: 0, alignment: "both", direction: "rtl",
    runs: [
      { text: "تُعدّ هذه الدراسة " },
      { text: "محاولةً جادة", bold: true, color: "C0392B" },
      { text: " لفهم الأثر." },
    ],
  } as unknown as DocBlockDTO,
  {
    index: 2, kind: "paragraph",
    text: "This paragraph is left-to-right and mixes styles.",
    styleId: "Normal", level: 0, alignment: "left", direction: "ltr",
    runs: [
      { text: "This paragraph is " },
      { text: "left-to-right", italic: true, underline: true },
      { text: " and mixes styles." },
    ],
  } as unknown as DocBlockDTO,
  { index: 3, kind: "table", rows: [["Variable", "Value"], ["N", "120"]] },
  { index: 4, kind: "image", hasMedia: true, width: 640, height: 360, caption: "الشكل 1: توزيع البيانات" },
  { index: 5, kind: "other", tag: "sdt" },
];

// ── Normalisation: compare SEMANTIC fidelity, not incidental representation.
// Drops positional `index` and derived `styleId`; resolves `direction` null↔
// content-derived (the block model auto-derives too); merges adjacent same-mark
// runs and uppercases colours so run-boundary/format cosmetics don't false-fail.
function normMarks(runs: ParaRun[]): ParaRun[] {
  const cleaned = runs.map((r) => ({
    text: r.text,
    bold: !!r.bold,
    italic: !!r.italic,
    underline: !!r.underline,
    color: (r.color || "").replace(/^#/, "").toUpperCase() || undefined,
  }));
  const merged: typeof cleaned = [];
  for (const r of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic && last.underline === r.underline && last.color === r.color) {
      last.text += r.text;
    } else merged.push({ ...r });
  }
  const anyMark = merged.some((r) => r.bold || r.italic || r.underline || r.color);
  return anyMark ? merged : [];
}

function signature(b: DocBlockDTO): unknown {
  if (b.kind === "paragraph") {
    const runs = (b as { runs?: ParaRun[] }).runs ?? (b.text ? [{ text: b.text }] : []);
    return {
      k: "paragraph",
      text: b.text,
      level: b.level,
      align: b.alignment,
      dir: b.direction ?? detectDir(b.text, false),
      marks: normMarks(runs),
    };
  }
  if (b.kind === "table") return { k: "table", rows: b.rows };
  if (b.kind === "image") return { k: "image", dataUri: b.dataUri ?? null, hasMedia: !!b.hasMedia, width: b.width ?? null, height: b.height ?? null, caption: b.caption ?? null };
  return { k: "other", tag: b.tag };
}

const j = (v: unknown) => JSON.stringify(v, null, 1);

export default function LexicalRoundtripScreen() {
  const colors = useThemeColors();
  const [active, setActive] = useState<LexicalState>({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false });
  const [command, setCommand] = useState<LexicalCommand | null>(null);
  const [roundtripped, setRoundtripped] = useState<DocBlockDTO[] | null>(null);
  const [showResults, setShowResults] = useState(false);
  const nonce = useRef(0);

  const send = useCallback((type: string, value?: string) => {
    setCommand({ type, value, nonce: ++nonce.current } as LexicalCommand);
  }, []);
  const onState = useCallback((s: LexicalState) => setActive(s), []);
  const onBlocks = useCallback((blocks: DocBlockDTO[]) => {
    setRoundtripped(blocks);
    setShowResults(true);
  }, []);

  const rows = useMemo(() => {
    if (!roundtripped) return [];
    return SAMPLE_BLOCKS.map((orig, i) => {
      const rt = roundtripped[i];
      const a = signature(orig);
      const b = rt ? signature(rt) : null;
      const pass = !!b && j(a) === j(b);
      return { i, kind: orig.kind, pass, missing: !rt, a: j(a), b: b ? j(b) : "— missing —" };
    });
  }, [roundtripped]);

  const passCount = rows.filter((r) => r.pass).length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Round-trip test</Text>
        <View style={{ width: 30 }} />
      </View>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        blocks → Lexical → blocks · edit if you like, then run the round-trip
      </Text>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.editorWrap, { borderColor: colors.borderSubtle }]}>
          <LexicalDomEditor
            initialBlocks={SAMPLE_BLOCKS}
            command={command}
            onState={onState}
            onBlocks={onBlocks}
            dom={{ style: { flex: 1 }, scrollEnabled: true, keyboardDisplayRequiresUserAction: false, hideKeyboardAccessoryView: true }}
          />
        </View>
        <LexicalBubble active={active} onCommand={send} />
        <Pressable
          onPress={() => send("serialize")}
          style={[styles.runBtn, { backgroundColor: colors.brandPrimary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.runText, { color: colors.bgPrimary }]}>Run round-trip  ✓</Text>
        </Pressable>
      </KeyboardAvoidingView>

      <Modal visible={showResults} animationType="slide" transparent onRequestClose={() => setShowResults(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.bgPrimary }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                {passCount === rows.length ? "✓ " : ""}{passCount}/{rows.length} blocks preserved
              </Text>
              <Pressable onPress={() => setShowResults(false)}>
                <Text style={[styles.close, { color: colors.brandPrimary }]}>Done</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {rows.map((r) => (
                <View key={r.i} style={[styles.rowCard, { borderColor: colors.borderSubtle }]}>
                  <Text style={[styles.rowTitle, { color: r.pass ? colors.semanticSuccess ?? "#2f9e6f" : colors.semanticError ?? "#c0392b" }]}>
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
                Note: Lexical lists have no block-model equivalent — if you convert a paragraph to a
                list and re-run, it flattens back to a paragraph (surfaced, never silently dropped).
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", paddingHorizontal: 20, paddingBottom: 8 },
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
