import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { X, Download } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getThesisPreviewHtml, exportThesis } from "@/lib/api";

// Neutral page-canvas grey behind the white A4 page (matches the server HTML).
const CANVAS_BG = "#d9dbe0";

export default function ThesisPreviewA4Screen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    getThesisPreviewHtml(thesisId)
      .then((r) => setHtml(r.html))
      .catch((e: any) => {
        Alert.alert(
          t("common.error", { defaultValue: "Error" }),
          e?.message ?? String(e)
        );
        router.back();
      })
      .finally(() => setLoading(false));
  }, [thesisId]);

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await exportThesis(thesisId, "docx");
      await Linking.openURL(res.url);
    } catch (e: any) {
      Alert.alert(
        t("common.error", { defaultValue: "Error" }),
        e?.message ?? String(e)
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + 8, backgroundColor: colors.bgPrimary },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("common.close", { defaultValue: "Close" })}
          style={styles.sideBtn}
        >
          <X size={24} color={colors.textPrimary} />
        </Pressable>
        <Text
          style={[styles.title, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {t("preview.a4Title", { defaultValue: "A4 preview" })}
        </Text>
        <Pressable
          onPress={onDownload}
          disabled={downloading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("preview.download", { defaultValue: "Download" })}
          style={[styles.sideBtn, styles.sideBtnEnd]}
        >
          {downloading ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Download size={20} color={colors.textPrimary} />
          )}
        </Pressable>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {loading || !html ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
          </View>
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html }}
            style={styles.web}
            // Keep the document inline; send real links out to the system browser.
            onShouldStartLoadWithRequest={(req) => {
              if (req.url === "about:blank" || req.url.startsWith("data:"))
                return true;
              Linking.openURL(req.url).catch(() => {});
              return false;
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 12,
  },
  sideBtn: { width: 40, justifyContent: "center" },
  sideBtnEnd: { alignItems: "flex-end" },
  title: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  body: { flex: 1, backgroundColor: CANVAS_BG },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  web: { flex: 1, backgroundColor: CANVAS_BG },
});
