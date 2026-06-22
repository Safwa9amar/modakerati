import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ThemeColors } from "@/constants/colors";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Eye,
  Plus,
  Trash2,
} from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { useNavBarClearance } from "@/components/FloatingNavBar";
import {
  addDocumentParagraph,
  deleteDocumentParagraph,
  editDocumentParagraph,
  getDocumentContent,
} from "@/lib/api";
import { useDocumentStore } from "@/stores/document-store";
import { getTextDirection } from "@/lib/text-direction";
import type { Align, ParagraphDTO } from "@/types/document";

// Heading style choices exposed in the toolbar → Word style IDs.
// level mirrors the server's levelFromStyle (Title/Subtitle → 0, Heading{n} → n).
const STYLE_CHOICES: { key: string; styleId: string; level: number | null }[] = [
  { key: "body", styleId: "Normal", level: null },
  { key: "title", styleId: "Title", level: 0 },
  { key: "h1", styleId: "Heading1", level: 1 },
  { key: "h2", styleId: "Heading2", level: 2 },
  { key: "h3", styleId: "Heading3", level: 3 },
];

const ALIGN_CHOICES: { value: Align; Icon: typeof AlignLeft }[] = [
  { value: "left", Icon: AlignLeft },
  { value: "center", Icon: AlignCenter },
  { value: "right", Icon: AlignRight },
  { value: "both", Icon: AlignJustify },
];

export default function DocumentEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const bottomPad = useNavBarClearance();
  const preview = useDocumentStore((s) => s.preview);

  const [title, setTitle] = useState("");
  const [paragraphs, setParagraphs] = useState<ParagraphDTO[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); // structural ops (add/delete/preview)

  // The whole feature edits ONE shared .docx (download → mutate → upload). Serialize
  // every mutation through a single in-flight chain so overlapping round-trips can't
  // both read the pre-mutation file and clobber each other (last-write-wins data loss).
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(fn, fn);
    queue.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const content = await getDocumentContent(id);
      setTitle(content.title);
      setParagraphs(content.paragraphs);
      setReadOnly(content.readOnly);
    } catch (e) {
      Alert.alert(t("documents.loadFailed"), e instanceof Error ? e.message : "");
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Edits (text/style/alignment) never change paragraph indices, so patch the
  // single paragraph in place from the server's response.
  const replaceParagraph = useCallback((index: number, next: ParagraphDTO) => {
    setParagraphs((prev) => prev.map((p, i) => (i === index ? next : p)));
  }, []);

  const handleSaveText = useCallback(
    (index: number, text: string) => {
      if (!id || paragraphs[index]?.text === text) return;
      enqueue(async () => {
        setSavingIndex(index);
        try {
          const res = await editDocumentParagraph(id, index, { text });
          replaceParagraph(index, res.paragraph);
        } catch (e) {
          Alert.alert(t("documents.saveFailed"), e instanceof Error ? e.message : "");
        } finally {
          setSavingIndex(null);
        }
      });
    },
    [id, paragraphs, enqueue, replaceParagraph, t]
  );

  const handleSetStyle = useCallback(
    (index: number, styleId: string) => {
      if (!id) return;
      enqueue(async () => {
        setSavingIndex(index);
        try {
          const res = await editDocumentParagraph(id, index, { styleId });
          replaceParagraph(index, res.paragraph);
        } catch (e) {
          Alert.alert(t("documents.saveFailed"), e instanceof Error ? e.message : "");
        } finally {
          setSavingIndex(null);
        }
      });
    },
    [id, enqueue, replaceParagraph, t]
  );

  const handleSetAlign = useCallback(
    (index: number, alignment: Align) => {
      if (!id) return;
      enqueue(async () => {
        setSavingIndex(index);
        try {
          const res = await editDocumentParagraph(id, index, { alignment });
          replaceParagraph(index, res.paragraph);
        } catch (e) {
          Alert.alert(t("documents.saveFailed"), e instanceof Error ? e.message : "");
        } finally {
          setSavingIndex(null);
        }
      });
    },
    [id, enqueue, replaceParagraph, t]
  );

  // Structural ops shift indices, so re-fetch to resync the whole list.
  const handleAdd = useCallback(() => {
    if (!id || busy) return;
    enqueue(async () => {
      setBusy(true);
      try {
        await addDocumentParagraph(id, { text: "" });
        const content = await getDocumentContent(id);
        setParagraphs(content.paragraphs);
        setReadOnly(content.readOnly);
        setSelected(content.paragraphs.length - 1);
      } catch (e) {
        Alert.alert(t("documents.saveFailed"), e instanceof Error ? e.message : "");
      } finally {
        setBusy(false);
      }
    });
  }, [id, busy, enqueue, t]);

  const handleDelete = useCallback(
    (index: number) => {
      Alert.alert(t("documents.deleteParaTitle"), t("documents.deleteParaConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            if (!id) return;
            enqueue(async () => {
              setBusy(true);
              try {
                await deleteDocumentParagraph(id, index);
                const content = await getDocumentContent(id);
                setParagraphs(content.paragraphs);
                setReadOnly(content.readOnly);
                setSelected(null);
              } catch (e) {
                Alert.alert(t("documents.saveFailed"), e instanceof Error ? e.message : "");
              } finally {
                setBusy(false);
              }
            });
          },
        },
      ]);
    },
    [id, enqueue, t]
  );

  async function handlePreview() {
    if (!id || busy) return;
    setBusy(true);
    const res = await preview(id);
    setBusy(false);
    if (res.error) {
      const body = res.code && res.code !== "generic" ? t(`documents.err_${res.code}`) : res.error;
      Alert.alert(t("documents.previewFailed"), body);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {title || t("documents.title")}
        </Text>
        <Pressable
          onPress={handlePreview}
          disabled={busy}
          style={[styles.previewBtn, { backgroundColor: colors.bgSurface }]}
        >
          <Eye size={16} color={colors.textPrimary} strokeWidth={2} />
          <Text style={[styles.previewText, { color: colors.textPrimary }]}>
            {t("documents.preview")}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 40 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {readOnly && (
              <View style={[styles.banner, { backgroundColor: colors.bgSurface }]}>
                <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
                  {t("documents.readOnlyBanner")}
                </Text>
              </View>
            )}

            {paragraphs.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {t("documents.emptyBody")}
              </Text>
            ) : (
              paragraphs.map((para, index) => (
                <ParagraphRow
                  key={para.paraId ?? `idx-${index}`}
                  para={para}
                  index={index}
                  selected={selected === index}
                  saving={savingIndex === index}
                  readOnly={readOnly}
                  colors={colors}
                  onSelect={() => setSelected(index)}
                  onSaveText={handleSaveText}
                  onSetStyle={handleSetStyle}
                  onSetAlign={handleSetAlign}
                  onDelete={handleDelete}
                  styleLabel={(key) => t(`documents.style_${key}`)}
                />
              ))
            )}

            {!readOnly && (
              <Pressable
                onPress={handleAdd}
                disabled={busy}
                style={[styles.addBtn, { borderColor: colors.borderDefault }]}
              >
                <Plus size={16} color={colors.brandPrimary} strokeWidth={2.5} />
                <Text style={[styles.addText, { color: colors.brandPrimary }]}>
                  {t("documents.addParagraph")}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {busy && (
        <View style={[styles.busyOverlay, { backgroundColor: colors.bgPrimary + "99" }]}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Paragraph row ───────────────────────────────────────────────────────────
// Holds its own text state so keystrokes don't re-render the whole list; saves
// on blur. Re-syncs when the server returns a normalized value.

interface RowProps {
  para: ParagraphDTO;
  index: number;
  selected: boolean;
  saving: boolean;
  readOnly: boolean;
  colors: ThemeColors;
  onSelect: () => void;
  onSaveText: (index: number, text: string) => void;
  onSetStyle: (index: number, styleId: string) => void;
  onSetAlign: (index: number, alignment: Align) => void;
  onDelete: (index: number) => void;
  styleLabel: (key: string) => string;
}

function ParagraphRow({
  para,
  index,
  selected,
  saving,
  readOnly,
  colors,
  onSelect,
  onSaveText,
  onSetStyle,
  onSetAlign,
  onDelete,
  styleLabel,
}: RowProps) {
  const [text, setText] = useState(para.text);

  // Server may normalize text/structure; resync local state on prop change.
  useEffect(() => {
    setText(para.text);
  }, [para.text]);

  const heading = headingFontFor(para.level);
  const activeStyleKey = STYLE_CHOICES.find((s) => s.level === para.level)?.key ?? "body";
  // Render content in its own script direction (Arabic theses are RTL) regardless
  // of UI locale; honor an explicit paragraph alignment, else default by direction.
  const dir = getTextDirection(text);
  const textAlign = para.alignment ? alignToRN(para.alignment) : dir === "rtl" ? "right" : "left";

  return (
    <Pressable onPress={onSelect} style={[styles.row, { backgroundColor: colors.bgCard }]}>
      <View style={styles.rowHead}>
        <Text style={[styles.levelBadge, { color: colors.textPlaceholder }]}>
          {styleLabel(activeStyleKey)}
        </Text>
        {saving && <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        onFocus={onSelect}
        onEndEditing={() => onSaveText(index, text)}
        editable={!readOnly}
        multiline
        placeholder=""
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            fontSize: heading.fontSize,
            fontFamily: heading.fontFamily,
            textAlign,
            writingDirection: dir,
          },
        ]}
      />

      {selected && !readOnly && (
        <View style={[styles.toolbar, { borderTopColor: colors.borderSubtle }]}>
          <View style={styles.toolGroup}>
            {STYLE_CHOICES.map((choice) => (
              <Pressable
                key={choice.key}
                onPress={() => onSetStyle(index, choice.styleId)}
                style={[
                  styles.styleChip,
                  {
                    backgroundColor:
                      activeStyleKey === choice.key ? colors.brandPrimary : colors.bgSurface,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.styleChipText,
                    { color: activeStyleKey === choice.key ? "#FFFFFF" : colors.textSecondary },
                  ]}
                >
                  {styleLabel(choice.key)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.toolGroup}>
            {ALIGN_CHOICES.map(({ value, Icon }) => {
              const active = (para.alignment ?? "left") === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => onSetAlign(index, value)}
                  style={[
                    styles.alignBtn,
                    { backgroundColor: active ? colors.brandPrimary : colors.bgSurface },
                  ]}
                >
                  <Icon size={16} color={active ? "#FFFFFF" : colors.textSecondary} strokeWidth={2} />
                </Pressable>
              );
            })}
            <Pressable onPress={() => onDelete(index)} style={styles.deleteBtn} hitSlop={8}>
              <Trash2 size={18} color={colors.semanticError} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function headingFontFor(level: number | null): { fontSize: number; fontFamily: string } {
  switch (level) {
    case 0:
      return { fontSize: 24, fontFamily: "Inter_700Bold" };
    case 1:
      return { fontSize: 20, fontFamily: "Inter_700Bold" };
    case 2:
      return { fontSize: 17, fontFamily: "Inter_600SemiBold" };
    case 3:
      return { fontSize: 15, fontFamily: "Inter_600SemiBold" };
    default:
      return { fontSize: 15, fontFamily: "Inter_400Regular" };
  }
}

function alignToRN(a: string | null): "left" | "center" | "right" | "justify" {
  if (a === "center") return "center";
  if (a === "right") return "right";
  if (a === "both") return "justify";
  return "left";
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  previewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  previewText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  listContent: { padding: 16, gap: 10 },
  banner: { borderRadius: 10, padding: 12, marginBottom: 4 },
  bannerText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 40 },
  row: { borderRadius: 12, padding: 12, gap: 8 },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 16 },
  levelBadge: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  input: { padding: 0, minHeight: 24, lineHeight: 22 },
  toolbar: { borderTopWidth: 1, paddingTop: 10, gap: 8 },
  toolGroup: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  styleChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  styleChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  alignBtn: { width: 34, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  deleteBtn: { marginLeft: "auto", padding: 6 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 4,
  },
  addText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  // Full-screen, input-blocking overlay during structural ops (add/delete/preview).
  busyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
