import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChevronRight } from "lucide-react-native";

function Toggle({ value, onToggle, color }: { value: boolean; onToggle: () => void; color: string }) {
  return (
    <Pressable
      onPress={onToggle}
      style={[
        styles.toggle,
        { backgroundColor: value ? color : "#4A4A5C" },
      ]}
    >
      <View
        style={[
          styles.toggleKnob,
          { transform: [{ translateX: value ? 20 : 0 }] },
        ]}
      />
    </Pressable>
  );
}

export default function AutoNumberingScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const [enablePageNumbers, setEnablePageNumbers] = useState(true);
  const [autoChapter, setAutoChapter] = useState(true);
  const [autoSection, setAutoSection] = useState(true);
  const [autoFigure, setAutoFigure] = useState(true);
  const [autoTable, setAutoTable] = useState(true);
  const [autoEquation, setAutoEquation] = useState(false);

  const renderToggleRow = (label: string, value: boolean, onToggle: () => void, subtitle?: string, isLast?: boolean) => (
    <View
      style={[
        styles.toggleRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
      ]}
    >
      <View style={styles.toggleLeft}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>{label}</Text>
        {subtitle && (
          <Text style={[styles.toggleSub, { color: colors.textSecondary }]}>{subtitle}</Text>
        )}
      </View>
      <Toggle value={value} onToggle={onToggle} color={colors.brandAccent} />
    </View>
  );

  const renderValueRow = (label: string, value: string, isLast?: boolean) => (
    <View
      style={[
        styles.toggleRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
      ]}
    >
      <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>{label}</Text>
      <View style={styles.valueRight}>
        <Text style={[styles.valueText, { color: colors.textSecondary }]}>{value}</Text>
        <ChevronRight size={16} color={colors.textPlaceholder} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("format.autoNumbering")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* PAGE NUMBERS */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textPlaceholder }]}>
            {t("format.pageNumbers")}
          </Text>
          <Card style={styles.sectionCard}>
            {renderToggleRow("Enable Page Numbers", enablePageNumbers, () => setEnablePageNumbers(!enablePageNumbers))}
            {renderValueRow("Position", "Bottom Center")}
            {renderValueRow("Start From", "Page 1")}
            {renderValueRow("Front Matter Style", "Roman (i, ii, iii)")}
            {renderValueRow("Body Style", "Arabic (1, 2, 3)", true)}
          </Card>
        </View>

        {/* CHAPTERS & SECTIONS */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textPlaceholder }]}>
            {t("format.chaptersAndSections")}
          </Text>
          <Card style={styles.sectionCard}>
            {renderToggleRow("Auto Chapter Numbers", autoChapter, () => setAutoChapter(!autoChapter))}
            {renderToggleRow("Auto Section Numbers", autoSection, () => setAutoSection(!autoSection))}
            {renderValueRow("Format", "1.1.1 Hierarchical", true)}
          </Card>
        </View>

        {/* FIGURES & TABLES */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textPlaceholder }]}>
            {t("format.figuresAndTables")}
          </Text>
          <Card style={styles.sectionCard}>
            {renderToggleRow("Auto Figure Numbers", autoFigure, () => setAutoFigure(!autoFigure))}
            {renderToggleRow("Auto Table Numbers", autoTable, () => setAutoTable(!autoTable))}
            {renderToggleRow("Auto Equation Numbers", autoEquation, () => setAutoEquation(!autoEquation), undefined, true)}
          </Card>
        </View>

        <Button title={t("format.applyNumbering")} onPress={() => {}} style={{ marginTop: 8 }} />
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
  content: {
    padding: 20,
    gap: 4,
    paddingBottom: 40,
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  toggleLeft: {
    flex: 1,
    gap: 2,
  },
  toggleLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  toggleSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
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
});
