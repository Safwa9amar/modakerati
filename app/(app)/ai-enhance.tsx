import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { ArrowDown } from "lucide-react-native";

type SuggestionType = "grammar" | "clarity" | "tone";

interface Suggestion {
  type: SuggestionType;
  original: string;
  fixed: string;
}

const TYPE_CONFIG: Record<SuggestionType, { labelKey: string; color: string }> = {
  grammar: { labelKey: "enhance.grammar", color: "#FF5959" },
  clarity: { labelKey: "enhance.clarity", color: "#FF9933" },
  tone: { labelKey: "enhance.academicTone", color: "#7C3AED" },
};

const SUGGESTIONS: Suggestion[] = [
  {
    type: "grammar",
    original: "The students was not aware of the changes that has been made to the curriculum.",
    fixed: "The students were not aware of the changes that had been made to the curriculum.",
  },
  {
    type: "clarity",
    original: "The thing about AI is that it does stuff that helps people learn better in many ways.",
    fixed: "Artificial intelligence enhances learning outcomes through personalized content delivery and adaptive assessment mechanisms.",
  },
  {
    type: "tone",
    original: "We found out that a lot of students really like using AI tools for their homework.",
    fixed: "The findings indicate that a significant proportion of students expressed favorable attitudes toward AI-assisted academic tasks.",
  },
];

const STATS: { type: SuggestionType; count: number }[] = [
  { type: "grammar", count: 3 },
  { type: "clarity", count: 2 },
  { type: "tone", count: 1 },
];

export default function AiEnhanceScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("enhance.aiEnhance")}
        </Text>
        <Pressable style={[styles.applyAllBtn, { backgroundColor: colors.brandAccent }]}>
          <Text style={styles.applyAllText}>{t("enhance.applyAll")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Stats badges */}
        <View style={styles.statsRow}>
          {STATS.map((stat) => {
            const config = TYPE_CONFIG[stat.type];
            return (
              <View
                key={stat.type}
                style={[styles.statBadge, { backgroundColor: config.color + "1A" }]}
              >
                <Text style={[styles.statText, { color: config.color }]}>
                  {stat.count} {t(config.labelKey)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Suggestion cards */}
        {SUGGESTIONS.map((suggestion, i) => {
          const config = TYPE_CONFIG[suggestion.type];
          return (
            <Card key={i} style={styles.suggestionCard}>
              {/* Type badge */}
              <View style={[styles.typeBadge, { backgroundColor: config.color + "1A" }]}>
                <Text style={[styles.typeBadgeText, { color: config.color }]}>
                  {t(config.labelKey)}
                </Text>
              </View>

              {/* Original text */}
              <Text
                style={[
                  styles.originalText,
                  { color: colors.textSecondary, textDecorationLine: "line-through" },
                ]}
              >
                {suggestion.original}
              </Text>

              {/* Arrow indicator */}
              <View style={styles.arrowRow}>
                <ArrowDown size={16} color={colors.textPlaceholder} />
              </View>

              {/* Fixed text */}
              <Text style={[styles.fixedText, { color: colors.textPrimary }]}>
                {suggestion.fixed}
              </Text>

              {/* Action buttons */}
              <View style={styles.actionsRow}>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: colors.brandAccent + "26" }]}
                >
                  <Text style={[styles.actionBtnText, { color: colors.brandAccent }]}>
                    {t("enhance.accept")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: colors.bgSurface }]}
                >
                  <Text style={[styles.actionBtnText, { color: colors.textSecondary }]}>
                    {t("enhance.dismiss")}
                  </Text>
                </Pressable>
              </View>
            </Card>
          );
        })}
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
  applyAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  applyAllText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  content: {
    padding: 20,
    gap: 14,
    paddingBottom: 40,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  suggestionCard: {
    gap: 10,
  },
  typeBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  originalText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  arrowRow: {
    alignItems: "center",
  },
  fixedText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
