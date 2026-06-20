import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RefreshCw, ChevronRight } from "lucide-react-native";

function Toggle({ value, onToggle, color }: { value: boolean; onToggle: () => void; color: string }) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.toggle, { backgroundColor: value ? color : "#4A4A5C" }]}
    >
      <View style={[styles.toggleKnob, { transform: [{ translateX: value ? 20 : 0 }] }]} />
    </Pressable>
  );
}

interface TocEntry {
  text: string;
  page: number;
  level: number;
  bold?: boolean;
}

const TOC_ENTRIES: TocEntry[] = [
  { text: "Introduction", page: 1, level: 0, bold: true },
  { text: "1.1 Background", page: 2, level: 1 },
  { text: "1.2 Problem Statement", page: 4, level: 1 },
  { text: "Literature Review", page: 6, level: 0, bold: true },
  { text: "2.1 AI in Global Education", page: 7, level: 1 },
  { text: "2.2 Algerian Higher Education", page: 10, level: 1 },
  { text: "Methodology", page: 13, level: 0, bold: true },
  { text: "3.1 Research Design", page: 14, level: 1 },
  { text: "3.2 Data Collection", page: 16, level: 1 },
  { text: "Results & Discussion", page: 18, level: 0, bold: true },
  { text: "Conclusion", page: 22, level: 0, bold: true },
  { text: "References", page: 24, level: 0, bold: true },
];

export default function AutoTocScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const [includeFigures, setIncludeFigures] = useState(true);
  const [includeTables, setIncludeTables] = useState(true);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("format.tableOfContents")}
        </Text>
        <Pressable style={[styles.refreshBtn, { backgroundColor: colors.bgSurface }]}>
          <RefreshCw size={16} color={colors.textSecondary} />
          <Text style={[styles.refreshText, { color: colors.textSecondary }]}>Refresh</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Options card */}
        <Card style={styles.optionsCard}>
          <View style={[styles.toggleRow, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>
              {t("format.includeFigures")}
            </Text>
            <Toggle value={includeFigures} onToggle={() => setIncludeFigures(!includeFigures)} color={colors.brandAccent} />
          </View>
          <View style={[styles.toggleRow, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>
              {t("format.includeTables")}
            </Text>
            <Toggle value={includeTables} onToggle={() => setIncludeTables(!includeTables)} color={colors.brandAccent} />
          </View>
          <View style={styles.toggleRowLast}>
            <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Depth</Text>
            <View style={styles.valueRight}>
              <Text style={[styles.valueText, { color: colors.textSecondary }]}>3 levels</Text>
              <ChevronRight size={16} color={colors.textPlaceholder} />
            </View>
          </View>
        </Card>

        {/* Preview label */}
        <Text style={[styles.previewLabel, { color: colors.textPlaceholder }]}>PREVIEW</Text>

        {/* Paper preview */}
        <View style={styles.paperPreview}>
          <Text style={styles.paperTitle}>Table of Contents</Text>
          {TOC_ENTRIES.map((entry, i) => (
            <View key={i} style={[styles.tocRow, { marginLeft: entry.level * 24 }]}>
              <Text
                style={[
                  styles.tocText,
                  entry.bold && styles.tocTextBold,
                ]}
                numberOfLines={1}
              >
                {entry.text}
              </Text>
              <View style={styles.tocDots} />
              <Text style={styles.tocPage}>{entry.page}</Text>
            </View>
          ))}
        </View>

        <Button title={t("format.generateToc")} onPress={() => {}} style={{ marginTop: 8 }} />
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
  optionsCard: {
    padding: 0,
    overflow: "hidden",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  toggleRowLast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },
  valueRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  valueText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
    gap: 6,
  },
  paperTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#262630",
    textAlign: "center",
    marginBottom: 16,
  },
  tocRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  tocText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#262630",
    flexShrink: 1,
  },
  tocTextBold: {
    fontFamily: "Inter_600SemiBold",
  },
  tocDots: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#C8C8D0",
    borderStyle: "dotted",
    marginBottom: 3,
    marginHorizontal: 4,
  },
  tocPage: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#262630",
  },
});
