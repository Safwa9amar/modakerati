import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { RefreshCw, Table2 } from "lucide-react-native";

interface TableEntry {
  number: string;
  caption: string;
  page: number;
}

const TABLES: TableEntry[] = [
  { number: "Table 1.1", caption: "University Demographics Overview", page: 4 },
  { number: "Table 2.1", caption: "Literature Review Summary Matrix", page: 9 },
  { number: "Table 2.2", caption: "Comparison of AI-Powered Platforms", page: 12 },
  { number: "Table 3.1", caption: "Survey Response Rates by Faculty", page: 15 },
  { number: "Table 4.1", caption: "Regression Analysis Results", page: 19 },
  { number: "Table 4.2", caption: "Hypothesis Testing Summary", page: 21 },
];

export default function ListTablesScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("format.listOfTables")}
        </Text>
        <Pressable style={[styles.refreshBtn, { backgroundColor: colors.bgSurface }]}>
          <RefreshCw size={16} color={colors.textSecondary} />
          <Text style={[styles.refreshText, { color: colors.textSecondary }]}>Refresh</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Count badge */}
        <View style={[styles.countBadge, { backgroundColor: "#E6801A14" }]}>
          <View style={styles.countRow}>
            <Table2 size={18} color="#E6801A" />
            <Text style={[styles.countText, { color: "#E6801A" }]}>
              6 tables detected across 3 chapters
            </Text>
          </View>
        </View>

        {/* Preview label */}
        <Text style={[styles.previewLabel, { color: colors.textPlaceholder }]}>PREVIEW</Text>

        {/* Paper preview */}
        <View style={styles.paperPreview}>
          <Text style={styles.paperTitle}>List of Tables</Text>
          {TABLES.map((tbl, i) => (
            <View key={i} style={styles.tblRow}>
              <View style={styles.tblLeft}>
                <Text style={styles.tblNumber}>{tbl.number}</Text>
                <Text style={styles.tblCaption}>{tbl.caption}</Text>
              </View>
              <View style={styles.tblDots} />
              <Text style={styles.tblPage}>{tbl.page}</Text>
            </View>
          ))}
        </View>

        <Button title={t("format.generateTables")} onPress={() => {}} style={{ marginTop: 8 }} />
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
  tblRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  tblLeft: {
    flexShrink: 1,
  },
  tblNumber: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#262630",
  },
  tblCaption: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#52526A",
    marginTop: 1,
  },
  tblDots: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#C8C8D0",
    borderStyle: "dotted",
    marginBottom: 3,
    marginHorizontal: 4,
  },
  tblPage: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#262630",
  },
});
