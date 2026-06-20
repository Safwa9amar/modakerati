import {
  View,
  Text,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Download, Share2, FolderOpen } from "lucide-react-native";

export default function ExportSuccessScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId, format } = useLocalSearchParams<{
    thesisId: string;
    format: string;
  }>();

  const ext = format ?? ".docx";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      <View style={styles.centered}>
        {/* Large circle icon */}
        <View
          style={[
            styles.iconCircle,
            { borderColor: colors.brandPrimary },
          ]}
        >
          <Download size={36} color={colors.brandPrimary} strokeWidth={2} />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("export.exportComplete")}
        </Text>

        {/* Description */}
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {t("export.exportedAs")} {ext}
        </Text>

        {/* File info card */}
        <Card style={styles.fileCard}>
          <View style={styles.fileRow}>
            <Text style={[styles.fileLabel, { color: colors.textSecondary }]}>
              Filename
            </Text>
            <Text style={[styles.fileValue, { color: colors.textPrimary }]}>
              thesis-ai-education{ext}
            </Text>
          </View>
          <View style={[styles.fileDivider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.fileRow}>
            <Text style={[styles.fileLabel, { color: colors.textSecondary }]}>
              Size
            </Text>
            <Text style={[styles.fileValue, { color: colors.textPrimary }]}>
              2.4 MB
            </Text>
          </View>
          <View style={[styles.fileDivider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.fileRow}>
            <Text style={[styles.fileLabel, { color: colors.textSecondary }]}>
              Pages
            </Text>
            <Text style={[styles.fileValue, { color: colors.textPrimary }]}>
              24
            </Text>
          </View>
          <View style={[styles.fileDivider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.fileRow}>
            <Text style={[styles.fileLabel, { color: colors.textSecondary }]}>
              Words
            </Text>
            <Text style={[styles.fileValue, { color: colors.textPrimary }]}>
              8,420
            </Text>
          </View>
        </Card>

        {/* Buttons */}
        <View style={styles.buttons}>
          <Button
            title={t("export.shareFile")}
            onPress={() => {}}
          />
          <Button
            title={t("export.openInFiles")}
            onPress={() => router.back()}
            variant="secondary"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  fileCard: {
    width: "100%",
    padding: 16,
    marginBottom: 28,
  },
  fileRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  fileLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  fileValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  fileDivider: {
    height: 1,
  },
  buttons: {
    width: "100%",
    gap: 12,
  },
});
