import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { RefreshCw, Image } from "lucide-react-native";

interface FigureEntry {
  number: string;
  caption: string;
  page: number;
}

const FIGURES: FigureEntry[] = [
  { number: "Figure 1.1", caption: "AI Adoption Rates in Algerian Universities", page: 3 },
  { number: "Figure 1.2", caption: "Student Satisfaction Survey Results", page: 5 },
  { number: "Figure 2.1", caption: "Global EdTech Market Growth (2020-2025)", page: 8 },
  { number: "Figure 2.2", caption: "Comparative Analysis of AI Tools", page: 11 },
  { number: "Figure 3.1", caption: "Research Methodology Framework", page: 14 },
  { number: "Figure 3.2", caption: "Data Collection Process Flow", page: 16 },
  { number: "Figure 4.1", caption: "Performance Metrics Dashboard", page: 19 },
  { number: "Figure 4.2", caption: "Statistical Distribution of Results", page: 21 },
];

export default function ListFiguresScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("format.listOfFigures")}
        </Text>
        <Pressable style={[styles.refreshBtn, { backgroundColor: colors.bgSurface }]}>
          <RefreshCw size={16} color={colors.textSecondary} />
          <Text style={[styles.refreshText, { color: colors.textSecondary }]}>Refresh</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Count badge */}
        <View style={[styles.countBadge, { backgroundColor: "#7C3AED14" }]}>
          <View style={styles.countRow}>
            <Image size={18} color="#7C3AED" />
            <Text style={[styles.countText, { color: "#7C3AED" }]}>
              8 figures detected across 4 chapters
            </Text>
          </View>
        </View>

        {/* Preview label */}
        <Text style={[styles.previewLabel, { color: colors.textPlaceholder }]}>PREVIEW</Text>

        {/* Paper preview */}
        <View style={styles.paperPreview}>
          <Text style={styles.paperTitle}>List of Figures</Text>
          {FIGURES.map((fig, i) => (
            <View key={i} style={styles.figRow}>
              <View style={styles.figLeft}>
                <Text style={styles.figNumber}>{fig.number}</Text>
                <Text style={styles.figCaption}>{fig.caption}</Text>
              </View>
              <View style={styles.figDots} />
              <Text style={styles.figPage}>{fig.page}</Text>
            </View>
          ))}
        </View>

        <Button title={t("format.generateFigures")} onPress={() => {}} style={{ marginTop: 8 }} />
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
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
  },
  refreshText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  content: {
    padding: 20,
    gap: 14,
    paddingBottom: 40,
  },
  countBadge: {
    borderRadius: 12,
    padding: 14,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  countText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  previewLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginLeft: 4,
    marginTop: 4,
  },
  paperPreview: {
    backgroundColor: "#F5F5F7",
    borderRadius: 12,
    padding: 24,
    gap: 10,
  },
  paperTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#262630",
    textAlign: "center",
    marginBottom: 12,
  },
  figRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  figLeft: {
    flexShrink: 1,
  },
  figNumber: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#262630",
  },
  figCaption: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#52526A",
    marginTop: 1,
  },
  figDots: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#C8C8D0",
    borderStyle: "dotted",
    marginBottom: 3,
    marginHorizontal: 4,
  },
  figPage: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#262630",
  },
});
