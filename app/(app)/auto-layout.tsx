import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Sparkles, ChevronRight, CheckCircle } from "lucide-react-native";

interface ValueRow {
  label: string;
  value: string;
}

const MARGINS: ValueRow[] = [
  { label: "Top", value: "2.5 cm" },
  { label: "Bottom", value: "2.5 cm" },
  { label: "Left (Binding)", value: "3.0 cm" },
  { label: "Right", value: "2.0 cm" },
];

const TYPOGRAPHY: ValueRow[] = [
  { label: "Body Font", value: "Times New Roman" },
  { label: "Body Size", value: "12pt" },
  { label: "Heading Font", value: "TNR Bold" },
  { label: "Line Spacing", value: "1.5" },
];

const PAGE_SETUP: ValueRow[] = [
  { label: "Paper Size", value: "A4" },
  { label: "Orientation", value: "Portrait" },
  { label: "Header Height", value: "1.25 cm" },
  { label: "Footer Height", value: "1.25 cm" },
];

export default function AutoLayoutScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const renderValueRow = (row: ValueRow, isLast: boolean) => (
    <View
      key={row.label}
      style={[
        styles.valueRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
      ]}
    >
      <Text style={[styles.valueLabel, { color: colors.textPrimary }]}>{row.label}</Text>
      <View style={styles.valueRight}>
        <Text style={[styles.valueText, { color: colors.textSecondary }]}>{row.value}</Text>
        <ChevronRight size={16} color={colors.textPlaceholder} />
      </View>
    </View>
  );

  const renderSection = (title: string, rows: ValueRow[]) => (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textPlaceholder }]}>{title}</Text>
      <Card style={styles.sectionCard}>
        {rows.map((row, i) => renderValueRow(row, i === rows.length - 1))}
      </Card>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("format.pageLayout")}
        </Text>
        <Pressable style={[styles.autoFixBtn, { backgroundColor: colors.brandAccent }]}>
          <Sparkles size={14} color="#FFFFFF" />
          <Text style={styles.autoFixText}>{t("format.autoFix")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Template badge */}
        <View style={[styles.templateBadge, { backgroundColor: colors.brandPrimary + "14" }]}>
          <View style={styles.templateRow}>
            <CheckCircle size={16} color={colors.brandPrimary} />
            <Text style={[styles.templateTitle, { color: colors.brandPrimary }]}>
              Using: Universite de Djelfa — M2
            </Text>
          </View>
          <Text style={[styles.templateSub, { color: colors.brandPrimaryLight }]}>
            All rules auto-applied
          </Text>
        </View>

        {renderSection(t("format.margins"), MARGINS)}
        {renderSection(t("format.typography"), TYPOGRAPHY)}
        {renderSection(t("format.pageSetup"), PAGE_SETUP)}

        <Button title={t("format.applyLayout")} onPress={() => {}} style={{ marginTop: 8 }} />
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
  autoFixBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
  },
  autoFixText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  content: {
    padding: 20,
    gap: 4,
    paddingBottom: 40,
  },
  templateBadge: {
    borderRadius: 12,
    padding: 14,
    gap: 4,
    marginBottom: 8,
  },
  templateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  templateTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  templateSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginLeft: 24,
  },
  section: {
    gap: 6,
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginLeft: 4,
  },
  sectionCard: {
    padding: 0,
    overflow: "hidden",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  valueLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
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
});
