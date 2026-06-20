import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { Card } from "@/components/ui/Card";
import {
  GripVertical,
  Edit3,
  CheckCircle,
  Circle,
  Clock,
  Plus,
  Sparkles,
  ListTree,
  Shuffle,
  Trash2,
} from "lucide-react-native";
import type { ChapterStatus } from "@/types/thesis";

const STATUS_OPTIONS: { key: ChapterStatus; labelKey: string }[] = [
  { key: "not_started", labelKey: "thesis.notStarted" },
  { key: "in_progress", labelKey: "thesis.inProgress" },
  { key: "done", labelKey: "thesis.done" },
];

export default function EditChapterScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId, chapterId } = useLocalSearchParams<{
    thesisId: string;
    chapterId: string;
  }>();
  const {
    theses,
    updateChapter,
    deleteChapter,
    addSection,
    deleteSection,
  } = useThesisStore();

  const thesis = theses.find((th) => th.id === thesisId);
  const chapter = thesis?.chapters.find((ch) => ch.id === chapterId);

  const [chapterTitle, setChapterTitle] = useState(chapter?.title ?? "");
  const [status, setStatus] = useState<ChapterStatus>(
    chapter?.status ?? "not_started"
  );

  if (!thesis || !chapter) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bgPrimary }]}
        edges={["top"]}
      >
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
            {t("thesis.editChapter")}
          </Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>Chapter not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusColorMap: Record<ChapterStatus, string> = {
    not_started: colors.textSecondary,
    in_progress: colors.semanticWarning,
    done: colors.semanticSuccess,
  };

  const statusIconMap: Record<ChapterStatus, typeof Circle> = {
    not_started: Circle,
    in_progress: Clock,
    done: CheckCircle,
  };

  const handleSave = () => {
    updateChapter(thesisId!, chapterId!, {
      title: chapterTitle,
      status,
    });
    router.back();
  };

  const handleDelete = () => {
    Alert.alert(
      t("thesis.deleteChapter"),
      `${t("common.delete")} "${chapter.title}"?`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            deleteChapter(thesisId!, chapterId!);
            router.back();
          },
        },
      ]
    );
  };

  const handleAddSection = () => {
    addSection(thesisId!, chapterId!, `Section ${chapter.sections.length + 1}`);
  };

  const aiActions = [
    {
      icon: Sparkles,
      label: t("thesis.generateAll"),
      color: "#9959FF",
    },
    {
      icon: ListTree,
      label: t("thesis.suggestMissing"),
      color: colors.brandPrimary,
    },
    {
      icon: Shuffle,
      label: t("thesis.reorderFlow"),
      color: colors.brandAccent,
    },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("thesis.editChapter")}
        </Text>
        <Pressable onPress={handleSave} style={styles.saveButton}>
          <Text style={styles.saveText}>{t("common.save")}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Status badge */}
        <View style={styles.statusBadgeRow}>
          {(() => {
            const StatusIcon = statusIconMap[status];
            return (
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusColorMap[status] + "18" },
                ]}
              >
                <StatusIcon
                  size={14}
                  color={statusColorMap[status]}
                  strokeWidth={2}
                />
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: statusColorMap[status] },
                  ]}
                >
                  {t(STATUS_OPTIONS.find((s) => s.key === status)!.labelKey)}
                </Text>
              </View>
            );
          })()}
        </View>

        {/* Chapter title input */}
        <TextInput
          label={t("thesis.chapterTitle")}
          value={chapterTitle}
          onChangeText={setChapterTitle}
        />

        {/* Status selector */}
        <View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t("thesis.status")}
          </Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((opt) => {
              const isActive = status === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setStatus(opt.key)}
                  style={[
                    styles.statusChip,
                    {
                      backgroundColor: isActive
                        ? statusColorMap[opt.key] + "22"
                        : colors.bgSurface,
                      borderColor: isActive
                        ? statusColorMap[opt.key]
                        : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      {
                        color: isActive
                          ? statusColorMap[opt.key]
                          : colors.textSecondary,
                      },
                    ]}
                  >
                    {t(opt.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Sections */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t("thesis.sections")} ({chapter.sections.length})
          </Text>
          <Pressable
            onPress={handleAddSection}
            style={[
              styles.addSectionBtn,
              { backgroundColor: colors.brandPrimary + "18" },
            ]}
          >
            <Plus size={14} color={colors.brandPrimary} strokeWidth={2.5} />
            <Text
              style={[styles.addSectionText, { color: colors.brandPrimary }]}
            >
              {t("thesis.addSection")}
            </Text>
          </Pressable>
        </View>

        {chapter.sections.length === 0 ? (
          <View
            style={[styles.emptySection, { backgroundColor: colors.bgSurface }]}
          >
            <Text style={[styles.emptySectionText, { color: colors.textSecondary }]}>
              No sections yet
            </Text>
          </View>
        ) : (
          chapter.sections.map((section) => {
            const SectionStatusIcon = statusIconMap[section.status];
            return (
              <Card key={section.id} style={styles.sectionCard}>
                <View style={styles.sectionRow}>
                  <GripVertical
                    size={16}
                    color={colors.textPlaceholder}
                    strokeWidth={2}
                  />
                  <View style={styles.sectionInfo}>
                    <Text
                      style={[
                        styles.sectionName,
                        { color: colors.textPrimary },
                      ]}
                    >
                      {section.title}
                    </Text>
                    <Text
                      style={[
                        styles.sectionWords,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {section.wordCount} words
                    </Text>
                  </View>
                  <SectionStatusIcon
                    size={16}
                    color={statusColorMap[section.status]}
                    strokeWidth={2}
                  />
                  <Pressable
                    onPress={() => {}}
                    hitSlop={8}
                  >
                    <Edit3
                      size={16}
                      color={colors.textSecondary}
                      strokeWidth={2}
                    />
                  </Pressable>
                </View>
              </Card>
            );
          })
        )}

        {/* AI Actions */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          {t("thesis.aiActions")}
        </Text>
        <View style={styles.aiRow}>
          {aiActions.map((action, i) => (
            <Pressable
              key={i}
              style={[styles.aiCard, { backgroundColor: colors.bgCard }]}
              onPress={() => {}}
            >
              <View
                style={[
                  styles.aiIconBg,
                  { backgroundColor: action.color + "18" },
                ]}
              >
                <action.icon
                  size={18}
                  color={action.color}
                  strokeWidth={2}
                />
              </View>
              <Text
                style={[styles.aiLabel, { color: colors.textPrimary }]}
                numberOfLines={2}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Delete chapter */}
        <Pressable
          onPress={handleDelete}
          style={[
            styles.deleteBtn,
            { backgroundColor: colors.semanticError + "14" },
          ]}
        >
          <Trash2
            size={16}
            color={colors.semanticError}
            strokeWidth={2}
          />
          <Text
            style={[styles.deleteText, { color: colors.semanticError }]}
          >
            {t("thesis.deleteChapter")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  topTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  saveButton: {
    backgroundColor: "#33D6A6",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  content: {
    padding: 20,
    gap: 20,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  statusBadgeRow: {
    flexDirection: "row",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: "row",
    gap: 10,
  },
  statusChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  addSectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addSectionText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  emptySection: {
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
  },
  emptySectionText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  sectionCard: {
    padding: 12,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionInfo: {
    flex: 1,
    gap: 2,
  },
  sectionName: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  sectionWords: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  aiRow: {
    flexDirection: "row",
    gap: 10,
  },
  aiCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    gap: 8,
  },
  aiIconBg: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  aiLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  deleteText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
