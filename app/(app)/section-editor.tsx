import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Link,
  Sparkles,
} from "lucide-react-native";

type ToolId = "bold" | "italic" | "underline" | "strike" | "h1" | "h2" | "bullets" | "numbered" | "quote" | "link";

const TOOLS: { id: ToolId; icon: typeof Bold }[] = [
  { id: "bold", icon: Bold },
  { id: "italic", icon: Italic },
  { id: "underline", icon: Underline },
  { id: "strike", icon: Strikethrough },
  { id: "h1", icon: Heading1 },
  { id: "h2", icon: Heading2 },
  { id: "bullets", icon: List },
  { id: "numbered", icon: ListOrdered },
  { id: "quote", icon: Quote },
  { id: "link", icon: Link },
];

export default function SectionEditorScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId, chapterId, sectionId } = useLocalSearchParams<{
    thesisId: string;
    chapterId: string;
    sectionId: string;
  }>();

  const [activeTools, setActiveTools] = useState<Set<ToolId>>(new Set(["bold"]));

  const toggleTool = (id: ToolId) => {
    setActiveTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = () => {
    router.back();
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
          {t("editor.sectionEditor")}
        </Text>
        <Pressable onPress={handleSave} style={styles.saveButton}>
          <Text style={styles.saveText}>{t("common.save")}</Text>
        </Pressable>
      </View>

      {/* Breadcrumb */}
      <View style={[styles.breadcrumbRow, { backgroundColor: colors.bgSurface }]}>
        <Text style={[styles.breadcrumbText, { color: colors.textSecondary }]}>
          Ch 2 &rsaquo; Literature Review &rsaquo; 2.1 AI in Global Ed.
        </Text>
      </View>

      {/* Formatting toolbar */}
      <View style={[styles.toolbar, { borderBottomColor: colors.borderSubtle }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarContent}>
          {TOOLS.map((tool) => {
            const isActive = activeTools.has(tool.id);
            const ToolIcon = tool.icon;
            return (
              <Pressable
                key={tool.id}
                onPress={() => toggleTool(tool.id)}
                style={[
                  styles.toolButton,
                  {
                    backgroundColor: isActive
                      ? colors.brandPrimary + "33"
                      : "transparent",
                  },
                ]}
              >
                <ToolIcon
                  size={18}
                  color={isActive ? colors.brandPrimary : colors.textSecondary}
                  strokeWidth={2}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Content area */}
      <ScrollView
        style={styles.contentArea}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Section title */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          2.1 AI in Global Education
        </Text>

        {/* Body paragraph */}
        <Text style={[styles.bodyText, { color: colors.textPrimary }]}>
          Artificial intelligence has rapidly transformed educational practices across the globe.
          From adaptive learning platforms to automated assessment tools, AI technologies are
          reshaping how students learn and how institutions deliver knowledge. This section
          examines the current landscape of AI adoption in educational systems worldwide.
        </Text>

        <Text style={[styles.bodyText, { color: colors.textPrimary }]}>
          Research indicates that AI-powered tutoring systems can improve student performance
          by up to 30% compared to traditional methods (Zhang et al., 2023). These systems
          leverage natural language processing and machine learning algorithms to provide
          personalized feedback and adaptive learning paths.
        </Text>

        {/* Citation block */}
        <View
          style={[
            styles.citationBlock,
            {
              borderLeftColor: colors.brandPrimary,
              backgroundColor: colors.brandPrimary + "14",
            },
          ]}
        >
          <Text style={[styles.citationText, { color: colors.textPrimary }]}>
            "The integration of AI in higher education represents a paradigm shift in pedagogical
            approaches, enabling unprecedented levels of personalization and efficiency in the
            learning process." (Martinez & Chen, 2024)
          </Text>
        </View>

        {/* Bullet list */}
        <View style={styles.bulletList}>
          <View style={styles.bulletItem}>
            <Text style={[styles.bullet, { color: colors.brandPrimary }]}>{"\u2022"}</Text>
            <Text style={[styles.bulletText, { color: colors.textPrimary }]}>
              Adaptive learning platforms used in 67% of universities
            </Text>
          </View>
          <View style={styles.bulletItem}>
            <Text style={[styles.bullet, { color: colors.brandPrimary }]}>{"\u2022"}</Text>
            <Text style={[styles.bulletText, { color: colors.textPrimary }]}>
              AI-assisted grading reduces evaluation time by 40%
            </Text>
          </View>
          <View style={styles.bulletItem}>
            <Text style={[styles.bullet, { color: colors.brandPrimary }]}>{"\u2022"}</Text>
            <Text style={[styles.bulletText, { color: colors.textPrimary }]}>
              Student satisfaction rates increased by 25% with AI tutors
            </Text>
          </View>
        </View>

        {/* AI suggestion chip */}
        <View
          style={[
            styles.aiSuggestion,
            { borderColor: colors.semanticSuccess },
          ]}
        >
          <View style={[styles.aiDot, { backgroundColor: colors.semanticSuccess }]} />
          <Text style={[styles.aiSuggestionText, { color: colors.semanticSuccess }]}>
            {t("editor.aiSuggestion")}
          </Text>
        </View>
      </ScrollView>

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.bgSurface, borderTopColor: colors.borderSubtle }]}>
        <Text style={[styles.wordCount, { color: colors.textSecondary }]}>
          342 {t("editor.wordCount")} {"\u00B7"} 1,847 {t("editor.characters")}
        </Text>
        <Pressable
          onPress={() => {}}
          style={[styles.aiEnhanceBtn, { backgroundColor: colors.brandPrimary }]}
        >
          <Sparkles size={16} color="#FFFFFF" strokeWidth={2} />
          <Text style={styles.aiEnhanceText}>{t("editor.aiEnhance")}</Text>
        </Pressable>
      </View>
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
  breadcrumbRow: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  breadcrumbText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  toolbar: {
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  toolbarContent: {
    paddingHorizontal: 16,
    gap: 4,
  },
  toolButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  contentArea: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    gap: 16,
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  bodyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
  },
  citationBlock: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  citationText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
    lineHeight: 22,
  },
  bulletList: {
    gap: 8,
  },
  bulletItem: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 4,
  },
  bullet: {
    fontSize: 18,
    lineHeight: 24,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
  },
  aiSuggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  aiDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  aiSuggestionText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  wordCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  aiEnhanceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  aiEnhanceText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
