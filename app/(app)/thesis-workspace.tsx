import { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Maximize2, Paperclip } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { sendMessageToAI } from "@/lib/ai-service";
import { BackButton } from "@/components/BackButton";
import { PaperPage } from "@/components/workspace/PaperPage";
import { ChapterCard } from "@/components/workspace/ChapterCard";
import { WorkspaceComposer } from "@/components/workspace/WorkspaceComposer";
import { AskBottomSheet } from "@/components/AskBottomSheet";
import { SourcesSheet } from "@/components/workspace/SourcesSheet";
import { Markdown } from "@/components/Markdown";
import { getTextDirection } from "@/lib/text-direction";
import type { SectionKind } from "@/types/thesis";

// Dark ink / muted ink for text rendered on the always-white PaperPage.
const INK = "#1A1A1A";
const MUTED = "#777777";

export default function ThesisWorkspaceScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  const thesis = useThesisStore((s) => s.theses.find((th) => th.id === thesisId));
  const selected = useThesisStore((s) => s.selected);
  const pendingAsk = useChatStore((s) => s.pendingAsk);

  // Mark this thesis current and pull the freshest copy from the server.
  useEffect(() => {
    if (!thesisId) return;
    useThesisStore.getState().setCurrentThesis(thesisId);
    useThesisStore.getState().refreshThesis(thesisId);
  }, [thesisId]);

  // Bridge the model's pending question (chat store) to the global sheet store,
  // which is what actually drives the AskBottomSheet's open state.
  useEffect(() => {
    if (pendingAsk) useBottomSheet.getState().openSheet("ask");
    else useBottomSheet.getState().closeSheet("ask");
  }, [pendingAsk]);

  const kindLabel = (kind: SectionKind): string => {
    switch (kind) {
      case "introduction":
        return t("wizard.kindIntroduction", { defaultValue: "Introduction" });
      case "conclusion":
        return t("wizard.kindConclusion", { defaultValue: "Conclusion" });
      case "section":
      default:
        return t("wizard.kindSection", { defaultValue: "Partie" });
    }
  };

  const title = thesis?.title ?? "";

  // Loading: no thesis yet (refreshThesis still in flight) or sections missing.
  if (!thesis || !thesis.sections) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bgSurface }]}
        edges={["top"]}
      >
        <View style={styles.topBar}>
          <BackButton />
          <Text
            style={[styles.topTitle, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <View style={styles.expandBtn} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  const frontMatter = thesis.frontMatter;
  const authors = frontMatter?.authors?.filter((a) => a && a.trim().length > 0);
  const resume = thesis.resume;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgSurface }]}
      edges={["top"]}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text
          style={[styles.topTitle, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {/* Sources → reference files the AI can draw from. */}
        <Pressable
          onPress={() => useBottomSheet.getState().openSheet("thesis-sources")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("sources.title", { defaultValue: "Sources" })}
          style={styles.expandBtn}
        >
          <Paperclip size={20} color={colors.textPrimary} />
        </Pressable>
        {/* Expand → full A4 preview of the rendered thesis. */}
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/(app)/thesis-preview-a4",
              params: { thesisId },
            })
          }
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("preview.a4Title", { defaultValue: "A4 preview" })}
          style={styles.expandBtn}
        >
          <Maximize2 size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
        {/* 1. Title page */}
        <PaperPage center>
          {frontMatter?.university ? (
            <Text style={styles.titleUniversity}>{frontMatter.university}</Text>
          ) : null}
          {frontMatter?.faculty ? (
            <Text style={styles.titleMuted}>{frontMatter.faculty}</Text>
          ) : null}
          {frontMatter?.department ? (
            <Text style={styles.titleMuted}>{frontMatter.department}</Text>
          ) : null}
          <View style={styles.titleSpacer} />
          <Text style={styles.titleMain}>{title}</Text>
          <View style={styles.titleSpacer} />
          {authors && authors.length > 0 ? (
            <Text style={styles.titleMeta}>
              Présenté par: {authors.join(" • ")}
            </Text>
          ) : null}
          {frontMatter?.supervisor ? (
            <Text style={styles.titleMeta}>
              Encadré par: {frontMatter.supervisor}
            </Text>
          ) : null}
          {frontMatter?.academicYear ? (
            <Text style={styles.titleMeta}>{frontMatter.academicYear}</Text>
          ) : null}
        </PaperPage>

        {/* 2. Résumé / Abstract pages */}
        {resume && resume.length > 0
          ? resume.map((block, i) => {
              const dir = getTextDirection(block.body || "");
              const heading =
                t("workspace.resume", { defaultValue: "Abstract" }) +
                (block.language ? ` (${block.language.toUpperCase()})` : "");
              return (
                <PaperPage key={`resume-${i}`}>
                  <Text
                    style={[
                      styles.pageHeading,
                      { textAlign: dir === "rtl" ? "right" : "left" },
                    ]}
                  >
                    {heading}
                  </Text>
                  {block.body?.trim() ? (
                    <Markdown content={block.body} color={INK} direction={dir} />
                  ) : null}
                  {block.keywords && block.keywords.length > 0 ? (
                    <Text
                      style={[
                        styles.keywords,
                        { textAlign: dir === "rtl" ? "right" : "left" },
                      ]}
                    >
                      {block.keywords.join(", ")}
                    </Text>
                  ) : null}
                </PaperPage>
              );
            })
          : null}

        {/* 3. Sections (Parties) + their chapters (Chapitres) */}
        {thesis.sections.map((section) => {
          const hasContent = !!section.content?.trim();
          const contentDir = hasContent
            ? getTextDirection(section.content || "")
            : "ltr";
          const sectionSelected =
            selected.sectionId === section.id && !selected.chapterId;

          return (
            <View key={section.id}>
              {hasContent ? (
                // Content section: left-aligned body under the title.
                <PaperPage
                  selected={sectionSelected}
                  onPress={() =>
                    useThesisStore.getState().selectSection(section.id)
                  }
                >
                  <Text style={styles.sectionTitleLeft}>{section.title}</Text>
                  <Text style={styles.sectionKindLeft}>
                    {kindLabel(section.kind)}
                  </Text>
                  <View style={styles.contentSpacer} />
                  <Markdown
                    content={section.content || ""}
                    color={INK}
                    direction={contentDir}
                  />
                </PaperPage>
              ) : (
                // Divider page: centered title + kind sublabel.
                <PaperPage
                  center
                  selected={sectionSelected}
                  onPress={() =>
                    useThesisStore.getState().selectSection(section.id)
                  }
                >
                  <Text style={styles.sectionTitleCenter}>{section.title}</Text>
                  <Text style={styles.sectionKindCenter}>
                    {kindLabel(section.kind)}
                  </Text>
                </PaperPage>
              )}

              {section.chapters.map((chapter) => (
                <ChapterCard
                  key={chapter.id}
                  chapter={chapter}
                  selected={selected.chapterId === chapter.id}
                  onPress={() =>
                    useThesisStore
                      .getState()
                      .selectChapter(section.id, chapter.id)
                  }
                  emptyLabel={t("workspace.emptyChapter", {
                    defaultValue: "Tap the chat to ask the AI to draft this.",
                  })}
                />
              ))}
            </View>
          );
        })}

        {/* 4. Empty state */}
        {thesis.sections.length === 0 ? (
          <PaperPage center>
            <Text style={styles.emptyText}>
              {t("workspace.empty", { defaultValue: "No content yet." })}
            </Text>
          </PaperPage>
        ) : null}
        </ScrollView>

        {/* AI composer pinned at the bottom, outside the ScrollView so the pages
            scroll above it and it stays fixed. */}
        <View style={{ paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.bgPrimary }}>
          <WorkspaceComposer thesisId={thesisId} />
        </View>
      </KeyboardAvoidingView>

      {/* Sources sheet — self-hides when closed (conditional unmount). */}
      <SourcesSheet thesisId={thesisId} />

      {/* The model's pending question → blocking answer sheet. */}
      {pendingAsk && (
        <AskBottomSheet
          ask={pendingAsk}
          onAnswer={(answer) => {
            useChatStore.getState().setPendingAsk(null);
            void sendMessageToAI(thesisId, answer, {
              sectionId: selected.sectionId ?? undefined,
              chapterId: selected.chapterId ?? undefined,
            });
          }}
          onClose={() => useChatStore.getState().setPendingAsk(null)}
        />
      )}
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
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  expandBtn: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  expandIcon: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { paddingBottom: 40 },

  // Title page
  titleUniversity: {
    color: INK,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  titleMuted: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 2,
  },
  titleMain: {
    color: INK,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 29,
  },
  titleMeta: {
    color: INK,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 4,
  },
  titleSpacer: { height: 28 },

  // Résumé / generic page heading
  pageHeading: {
    color: INK,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    marginBottom: 10,
  },
  keywords: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 12,
  },

  // Section divider (centered)
  sectionTitleCenter: {
    color: INK,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  sectionKindCenter: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 8,
  },

  // Section with content (left-aligned)
  sectionTitleLeft: {
    color: INK,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  sectionKindLeft: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  contentSpacer: { height: 10 },

  // Empty state
  emptyText: {
    color: MUTED,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
});
