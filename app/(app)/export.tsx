import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FileText, FileType, Code } from "lucide-react-native";

type FormatId = "docx" | "pdf" | "tex";

interface FormatOption {
  id: FormatId;
  extension: string;
  nameKey: string;
  descKey: string;
  color: string;
  icon: typeof FileText;
}

export default function ExportScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  const [selectedFormat, setSelectedFormat] = useState<FormatId>("docx");
  const [includeCover, setIncludeCover] = useState(true);
  const [includeToc, setIncludeToc] = useState(true);
  const [includeRefs, setIncludeRefs] = useState(true);

  const formats: FormatOption[] = [
    {
      id: "docx",
      extension: ".docx",
      nameKey: "export.wordDoc",
      descKey: "export.wordDocDesc",
      color: colors.brandPrimary,
      icon: FileText,
    },
    {
      id: "pdf",
      extension: ".pdf",
      nameKey: "export.pdfDoc",
      descKey: "export.pdfDocDesc",
      color: colors.semanticError,
      icon: FileType,
    },
    {
      id: "tex",
      extension: ".tex",
      nameKey: "export.latexSource",
      descKey: "export.latexDesc",
      color: colors.brandAccent,
      icon: Code,
    },
  ];

  const selectedExt = formats.find((f) => f.id === selectedFormat)?.extension ?? ".docx";

  const handleExport = () => {
    router.push({
      pathname: "/(app)/export-success",
      params: { thesisId, format: selectedExt },
    });
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
          {t("export.exportThesis")}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Thesis info card */}
        <Card style={styles.infoCard}>
          <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>
            The Impact of AI on Higher Education in Algeria
          </Text>
          <Text style={[styles.infoStats, { color: colors.textSecondary }]}>
            6 chapters {"\u00B7"} 24 pages {"\u00B7"} 8,420 words
          </Text>
        </Card>

        {/* Choose Format */}
        <Text style={[styles.heading, { color: colors.textPrimary }]}>
          {t("export.chooseFormat")}
        </Text>

        {formats.map((format) => {
          const isSelected = selectedFormat === format.id;
          const FormatIcon = format.icon;
          return (
            <Pressable
              key={format.id}
              onPress={() => setSelectedFormat(format.id)}
              style={[
                styles.formatCard,
                {
                  backgroundColor: colors.bgCard,
                  borderColor: isSelected ? format.color : colors.borderSubtle,
                  borderWidth: isSelected ? 2 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.formatBadge,
                  { backgroundColor: format.color + "1A" },
                ]}
              >
                <Text style={[styles.formatBadgeText, { color: format.color }]}>
                  {format.extension}
                </Text>
              </View>
              <View style={styles.formatInfo}>
                <Text style={[styles.formatName, { color: colors.textPrimary }]}>
                  {t(format.nameKey)}
                </Text>
                <Text style={[styles.formatDesc, { color: colors.textSecondary }]}>
                  {t(format.descKey)}
                </Text>
              </View>
              <View
                style={[
                  styles.radioOuter,
                  {
                    borderColor: isSelected ? format.color : colors.textPlaceholder,
                  },
                ]}
              >
                {isSelected && (
                  <View
                    style={[styles.radioInner, { backgroundColor: format.color }]}
                  />
                )}
              </View>
            </Pressable>
          );
        })}

        {/* Options */}
        <Text style={[styles.heading, { color: colors.textPrimary, marginTop: 8 }]}>
          {t("export.options")}
        </Text>

        <View style={[styles.optionsCard, { backgroundColor: colors.bgCard }]}>
          <View style={[styles.optionRow, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
              {t("export.includeCover")}
            </Text>
            <Switch
              value={includeCover}
              onValueChange={setIncludeCover}
              trackColor={{ false: colors.borderDefault, true: colors.brandPrimary + "66" }}
              thumbColor={includeCover ? colors.brandPrimary : colors.textPlaceholder}
            />
          </View>
          <View style={[styles.optionRow, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
              {t("export.includeToc")}
            </Text>
            <Switch
              value={includeToc}
              onValueChange={setIncludeToc}
              trackColor={{ false: colors.borderDefault, true: colors.brandPrimary + "66" }}
              thumbColor={includeToc ? colors.brandPrimary : colors.textPlaceholder}
            />
          </View>
          <View style={styles.optionRowLast}>
            <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
              {t("export.includeRefs")}
            </Text>
            <Switch
              value={includeRefs}
              onValueChange={setIncludeRefs}
              trackColor={{ false: colors.borderDefault, true: colors.brandPrimary + "66" }}
              thumbColor={includeRefs ? colors.brandPrimary : colors.textPlaceholder}
            />
          </View>
        </View>

        {/* Export button */}
        <Button
          title={`${t("export.exportAs")} ${selectedExt}`}
          onPress={handleExport}
          style={{ marginTop: 8 }}
        />
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
    gap: 14,
    paddingBottom: 40,
  },
  infoCard: {
    padding: 16,
    gap: 6,
  },
  infoTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 22,
  },
  infoStats: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  heading: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  formatCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  formatBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  formatBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  formatInfo: {
    flex: 1,
    gap: 2,
  },
  formatName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  formatDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  optionsCard: {
    borderRadius: 14,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  optionRowLast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
