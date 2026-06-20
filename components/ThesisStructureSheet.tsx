import { View, Text, StyleSheet, ScrollView, Pressable, Modal } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { Plus, Check, Circle } from "lucide-react-native";
import type { Chapter } from "@/types/thesis";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ThesisStructureSheet({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const thesis = useThesisStore((s) => s.getCurrentThesis());

  if (!thesis) return null;

  const chapters = thesis.chapters;
  const doneCount = chapters.filter((c) => c.status === "done").length;
  const progressCount = chapters.filter((c) => c.status === "in_progress").length;
  const pendingCount = chapters.filter((c) => c.status === "not_started").length;

  const statusColor = (status: string) => {
    if (status === "done") return colors.brandAccent;
    if (status === "in_progress") return colors.semanticWarning;
    return colors.navInactive;
  };

  const statusIcon = (status: string) => {
    if (status === "done") return <Check size={16} color={colors.brandAccent} strokeWidth={2.5} />;
    if (status === "in_progress") return <Circle size={16} color={colors.semanticWarning} strokeWidth={2} fill={colors.semanticWarning} />;
    return <Circle size={16} color={colors.navInactive} strokeWidth={1.5} />;
  };

  function handleChapterPress(chapter: Chapter) {
    onClose();
    router.push({ pathname: "/(app)/edit-chapter", params: { thesisId: thesis!.id, chapterId: chapter.id } } as any);
  }

  function handleAdd() {
    const store = useThesisStore.getState();
    store.addChapter(thesis!.id, `Chapter ${chapters.length + 1}`);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.bgModal }]}>
          {/* Handle */}
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.textSecondary }]} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t("thesis.thesisStructure")}</Text>
            <Pressable onPress={handleAdd} style={[styles.addBtn, { backgroundColor: colors.brandPrimary }]}>
              <Plus size={14} color="#fff" strokeWidth={2.5} />
              <Text style={styles.addBtnText}>{t("thesis.addChapter")}</Text>
            </Pressable>
          </View>

          {/* Status summary */}
          <View style={styles.statusRow}>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: colors.brandAccent }]} />
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>{doneCount} {t("thesis.done")}</Text>
            </View>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: colors.semanticWarning }]} />
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>{progressCount} {t("thesis.inProgress")}</Text>
            </View>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: colors.navInactive }]} />
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>{pendingCount} {t("thesis.pending")}</Text>
            </View>
          </View>

          {/* Chapter list */}
          <ScrollView style={styles.chapterList} showsVerticalScrollIndicator={false}>
            {chapters.map((chapter) => (
              <Pressable
                key={chapter.id}
                onPress={() => handleChapterPress(chapter)}
                style={[styles.chapterCard, { backgroundColor: colors.bgCard, borderColor: statusColor(chapter.status) + "40" }]}
              >
                <View style={styles.chapterRow}>
                  <View style={styles.chapterLeft}>
                    <Text style={[styles.dragHandle, { color: colors.textSecondary + "80" }]}>{"\u22EE\u22EE"}</Text>
                    <Text style={[styles.chapterTitle, { color: colors.textPrimary }]}>{chapter.title}</Text>
                  </View>
                  {statusIcon(chapter.status)}
                </View>
                {chapter.sections.length > 0 && (
                  <View style={styles.sectionsList}>
                    {chapter.sections.map((sec) => (
                      <View key={sec.id} style={styles.sectionRow}>
                        <View style={[styles.sectionDot, { backgroundColor: colors.textSecondary }]} />
                        <Text style={[styles.sectionName, { color: colors.textSecondary }]}>{sec.title}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Pressable>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, maxHeight: "80%" },
  handleRow: { alignItems: "center", paddingVertical: 12 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusRow: { flexDirection: "row", gap: 16, paddingHorizontal: 20, marginBottom: 16 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  chapterList: { paddingHorizontal: 20 },
  chapterCard: { borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1 },
  chapterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chapterLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  dragHandle: { fontSize: 14 },
  chapterTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  sectionsList: { marginTop: 8, paddingLeft: 24 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionDot: { width: 4, height: 4, borderRadius: 2 },
  sectionName: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
