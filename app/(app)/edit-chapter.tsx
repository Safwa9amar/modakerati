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
import { TextInput } from "@/components/ui/TextInput";
import { Card } from "@/components/ui/Card";
import { Plus, Trash2 } from "lucide-react-native";

// NOTE: P0 placeholder. With the new model the top container is a Section
// (Partie) whose children are Chapters (Chapitres). This screen was the old
// "edit chapter" view; it has been minimally remapped to edit a Section and its
// chapters so it compiles and renders. The rich editor / status / AI actions are
// slated for the P2/P3 workspace rebuild.
export default function EditChapterScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId, sectionId } = useLocalSearchParams<{
    thesisId: string;
    sectionId: string;
  }>();
  const {
    theses,
    updateSection,
    deleteSection,
    addChapter,
    deleteChapter,
  } = useThesisStore();

  const thesis = theses.find((th) => th.id === thesisId);
  const section = thesis?.sections.find((sec) => sec.id === sectionId);

  const [sectionTitle, setSectionTitle] = useState(section?.title ?? "");

  if (!thesis || !section) {
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
          <Text style={{ color: colors.textSecondary }}>Section not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSave = () => {
    updateSection(thesisId!, sectionId!, { title: sectionTitle });
    router.back();
  };

  const handleDelete = () => {
    Alert.alert(
      t("thesis.deleteChapter"),
      `${t("common.delete")} "${section.title}"?`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            deleteSection(thesisId!, sectionId!);
            router.back();
          },
        },
      ]
    );
  };

  const handleAddChapter = () => {
    addChapter(thesisId!, sectionId!, `Chapter ${section.chapters.length + 1}`);
  };

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
        {/* Section title input */}
        <TextInput
          label={t("thesis.chapterTitle")}
          value={sectionTitle}
          onChangeText={setSectionTitle}
        />

        {/* Chapters (Chapitres) */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t("home.chapters")} ({section.chapters.length})
          </Text>
          <Pressable
            onPress={handleAddChapter}
            style={[
              styles.addSectionBtn,
              { backgroundColor: colors.brandPrimary + "18" },
            ]}
          >
            <Plus size={14} color={colors.brandPrimary} strokeWidth={2.5} />
            <Text
              style={[styles.addSectionText, { color: colors.brandPrimary }]}
            >
              {t("thesis.addChapter")}
            </Text>
          </Pressable>
        </View>

        {section.chapters.length === 0 ? (
          <View
            style={[styles.emptySection, { backgroundColor: colors.bgSurface }]}
          >
            <Text style={[styles.emptySectionText, { color: colors.textSecondary }]}>
              {t("thesis.noChapters")}
            </Text>
          </View>
        ) : (
          section.chapters.map((chapter) => (
            <Card key={chapter.id} style={styles.sectionCard}>
              <View style={styles.sectionRow}>
                <View style={styles.sectionInfo}>
                  <Text
                    style={[styles.sectionName, { color: colors.textPrimary }]}
                  >
                    {chapter.title}
                  </Text>
                  <Text
                    style={[styles.sectionWords, { color: colors.textSecondary }]}
                  >
                    {chapter.wordCount} words
                  </Text>
                </View>
                <Pressable
                  onPress={() => deleteChapter(thesisId!, sectionId!, chapter.id)}
                  hitSlop={8}
                >
                  <Trash2 size={16} color={colors.semanticError} strokeWidth={2} />
                </Pressable>
              </View>
            </Card>
          ))
        )}

        {/* Delete section */}
        <Pressable
          onPress={handleDelete}
          style={[
            styles.deleteBtn,
            { backgroundColor: colors.semanticError + "14" },
          ]}
        >
          <Trash2 size={16} color={colors.semanticError} strokeWidth={2} />
          <Text style={[styles.deleteText, { color: colors.semanticError }]}>
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
