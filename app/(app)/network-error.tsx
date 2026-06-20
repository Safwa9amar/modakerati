import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { WifiOff, Check } from "lucide-react-native";
import { useNetworkStatus } from "@/lib/network";
import { useEffect } from "react";

export default function NetworkErrorScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { isOffline } = useNetworkStatus();

  // Auto-navigate back when connection restored
  useEffect(() => {
    if (!isOffline) {
      router.back();
    }
  }, [isOffline]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.content}>
        {/* Wifi-off icon */}
        <View style={[styles.iconCircle, { backgroundColor: colors.semanticWarning + "1F" }]}>
          <WifiOff size={40} color={colors.semanticWarning} strokeWidth={2} />
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("network.noConnection")}</Text>
        <Text style={[styles.desc, { color: colors.textSecondary }]}>{t("network.offlineDesc")}</Text>

        {/* Available offline card */}
        <Card style={styles.offlineCard}>
          <Text style={[styles.offlineTitle, { color: colors.textPrimary }]}>{t("network.availableOffline")}</Text>
          {[t("network.readEdit"), t("network.viewStructure"), t("network.cachedTemplates")].map((item, i) => (
            <View key={i} style={styles.featureRow}>
              <Check size={14} color={colors.brandAccent} strokeWidth={2.5} />
              <Text style={[styles.featureText, { color: colors.textSecondary }]}>{item}</Text>
            </View>
          ))}
        </Card>

        <View style={styles.buttons}>
          <Button title={t("network.retryConnection")} onPress={() => router.back()} />
          <Pressable onPress={() => router.back()}>
            <Text style={[styles.offlineLink, { color: colors.brandPrimaryLight }]}>{t("network.continueOffline")}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 20 },
  iconCircle: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  desc: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24 },
  offlineCard: { width: "100%", gap: 10 },
  offlineTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  buttons: { width: "100%", gap: 12, alignItems: "center" },
  offlineLink: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
