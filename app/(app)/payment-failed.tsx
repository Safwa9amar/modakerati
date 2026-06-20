import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Button } from "@/components/ui/Button";
import { X } from "lucide-react-native";

export default function PaymentFailedScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.centered}>
        <View style={[styles.iconCircle, { backgroundColor: colors.semanticError + "20" }]}>
          <X size={40} color={colors.semanticError} strokeWidth={3} />
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("payment.paymentFailed")}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{t("payment.failedDescription")}</Text>

        <View style={[styles.errorBadge, { backgroundColor: colors.semanticError + "15" }]}>
          <Text style={[styles.errorCode, { color: colors.semanticError }]}>ERR_PAYMENT_DECLINED</Text>
        </View>

        <Button
          title={t("payment.tryAgain")}
          onPress={() => router.back()}
          style={styles.primaryBtn}
        />
        <Button
          title={t("payment.useDifferentMethod")}
          onPress={() => router.replace("/(app)/payment-checkout")}
          variant="secondary"
          style={styles.secondaryBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 8 },
  description: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 24 },
  errorBadge: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 32 },
  errorCode: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  primaryBtn: { width: "100%", marginBottom: 12 },
  secondaryBtn: { width: "100%" },
});
