import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Check } from "lucide-react-native";

export default function PaymentSuccessScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.centered}>
        <View style={[styles.iconCircle, { backgroundColor: colors.semanticSuccess + "20" }]}>
          <Check size={40} color={colors.semanticSuccess} strokeWidth={3} />
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("payment.paymentSuccessful")}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{t("payment.successDescription")}</Text>

        <Card style={styles.receiptCard}>
          <View style={styles.receiptRow}>
            <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>{t("payment.plan")}</Text>
            <Text style={[styles.receiptValue, { color: colors.textPrimary }]}>Pro Student</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.receiptRow}>
            <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>{t("payment.amount")}</Text>
            <Text style={[styles.receiptValue, { color: colors.textPrimary }]}>500 DZD</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.receiptRow}>
            <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>{t("payment.date")}</Text>
            <Text style={[styles.receiptValue, { color: colors.textPrimary }]}>Jun 20, 2026</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.receiptRow}>
            <Text style={[styles.receiptLabel, { color: colors.textSecondary }]}>{t("payment.transactionId")}</Text>
            <Text style={[styles.receiptValue, { color: colors.textPrimary }]}>TXN-2026-0620</Text>
          </View>
        </Card>

        <Button
          title={t("payment.startBuilding")}
          onPress={() => router.replace("/(tabs)")}
          style={styles.button}
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
  description: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 32 },
  receiptCard: { width: "100%", marginBottom: 32 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  receiptLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  receiptValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  divider: { height: 1 },
  button: { width: "100%" },
});
