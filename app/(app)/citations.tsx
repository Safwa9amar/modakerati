import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { Plus, Sparkles } from "lucide-react-native";

type FormatId = "apa" | "mla" | "chicago" | "iso690";

interface Reference {
  author: string;
  year: number;
  title: string;
  source: string;
  citedIn: string[];
}

const REFERENCES: Reference[] = [
  {
    author: "Benkhelifa, A.",
    year: 2023,
    title: "Artificial Intelligence in Algerian Higher Education: Challenges and Opportunities",
    source: "Journal of North African Studies, 28(3), 451-472",
    citedIn: ["Ch 2", "Ch 4"],
  },
  {
    author: "Meziane, F. & Djeradi, A.",
    year: 2022,
    title: "Digital Transformation of Universities in the MENA Region",
    source: "International Journal of Educational Technology, 15(1), 89-110",
    citedIn: ["Ch 1", "Ch 2"],
  },
  {
    author: "UNESCO",
    year: 2023,
    title: "Global Education Monitoring Report: Technology in Education",
    source: "Paris: UNESCO Publishing",
    citedIn: ["Ch 2"],
  },
  {
    author: "Hamdi, S. & Benrahou, K.",
    year: 2021,
    title: "Student Perceptions of AI-Assisted Learning in Algerian Universities",
    source: "Arab Journal of Higher Education, 9(2), 134-156",
    citedIn: ["Ch 3", "Ch 4"],
  },
];

const FORMATS: { id: FormatId; label: string }[] = [
  { id: "apa", label: "APA" },
  { id: "mla", label: "MLA" },
  { id: "chicago", label: "Chicago" },
  { id: "iso690", label: "ISO 690" },
];

export default function CitationsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [activeFormat, setActiveFormat] = useState<FormatId>("apa");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("citations.references")}
        </Text>
        <Pressable style={[styles.addBtn, { backgroundColor: colors.brandPrimary }]}>
          <Plus size={16} color="#FFFFFF" />
          <Text style={styles.addBtnText}>{t("citations.add")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Format chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {FORMATS.map((f) => {
            const isActive = activeFormat === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => setActiveFormat(f.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isActive ? colors.brandPrimary : colors.bgSurface,
                    borderColor: isActive ? colors.brandPrimary : colors.borderSubtle,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: isActive ? "#FFFFFF" : colors.textSecondary },
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Count */}
        <Text style={[styles.countText, { color: colors.textSecondary }]}>
          12 references
        </Text>

        {/* Reference cards */}
        {REFERENCES.map((ref, i) => (
          <Card key={i} style={styles.refCard}>
            <Text style={[styles.refAuthor, { color: colors.textPrimary }]}>
              {ref.author} ({ref.year})
            </Text>
            <Text style={[styles.refTitle, { color: colors.brandPrimaryLight }]} numberOfLines={2}>
              {ref.title}
            </Text>
            <Text style={[styles.refSource, { color: colors.textSecondary }]} numberOfLines={1}>
              {ref.source}
            </Text>
            <View style={styles.citedRow}>
              <View style={[styles.citedBadge, { backgroundColor: colors.brandAccent + "1A" }]}>
                <Text style={[styles.citedText, { color: colors.brandAccent }]}>
                  {t("citations.citedIn")}: {ref.citedIn.join(", ")}
                </Text>
              </View>
            </View>
          </Card>
        ))}

        {/* AI suggestion button */}
        <Pressable
          style={[
            styles.aiSuggestion,
            { borderColor: colors.brandAccent, backgroundColor: colors.brandAccent + "0D" },
          ]}
        >
          <Sparkles size={16} color={colors.brandAccent} />
          <Text style={[styles.aiSuggestionText, { color: colors.brandAccent }]}>
            {t("citations.findMore")}
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
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  content: {
    padding: 20,
    gap: 12,
    paddingBottom: 40,
  },
  chipsRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  countText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  refCard: {
    gap: 6,
  },
  refAuthor: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  refTitle: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    fontStyle: "italic",
    lineHeight: 20,
  },
  refSource: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  citedRow: {
    flexDirection: "row",
    marginTop: 4,
  },
  citedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  citedText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  aiSuggestion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 8,
    marginTop: 4,
  },
  aiSuggestionText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
