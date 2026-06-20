import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";
import { CreditCard, Shield } from "lucide-react-native";

type PaymentMethod = "cib" | "edahabia";

export default function PaymentCheckoutScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>("cib");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  const handlePay = () => {
    router.push("/(app)/payment-success");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("payment.payment")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Order Summary */}
        <Card style={styles.summaryCard}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{t("payment.orderSummary")}</Text>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{t("payment.plan")}</Text>
            <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>Pro Student</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{t("payment.duration")}</Text>
            <Text style={[styles.summaryValue, { color: colors.textPrimary }]}>1 {t("payment.month")}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{t("payment.price")}</Text>
            <Text style={[styles.summaryValue, { color: colors.brandPrimary, fontFamily: "Inter_700Bold" }]}>500 DZD</Text>
          </View>
        </Card>

        {/* Payment Method */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t("payment.paymentMethod")}</Text>
        <View style={styles.methodsRow}>
          <Pressable onPress={() => setMethod("cib")} style={{ flex: 1 }}>
            <Card
              borderColor={method === "cib" ? colors.brandPrimary : colors.borderSubtle}
              style={[styles.radioCard, method === "cib" && { borderWidth: 2, borderColor: colors.brandPrimary }]}
            >
              <View style={[styles.radioOuter, { borderColor: method === "cib" ? colors.brandPrimary : colors.borderDefault }]}>
                {method === "cib" && <View style={[styles.radioInner, { backgroundColor: colors.brandPrimary }]} />}
              </View>
              <CreditCard size={18} color={colors.textPrimary} />
              <Text style={[styles.radioLabel, { color: colors.textPrimary }]}>CIB</Text>
            </Card>
          </Pressable>
          <Pressable onPress={() => setMethod("edahabia")} style={{ flex: 1 }}>
            <Card
              borderColor={method === "edahabia" ? colors.brandPrimary : colors.borderSubtle}
              style={[styles.radioCard, method === "edahabia" && { borderWidth: 2, borderColor: colors.brandPrimary }]}
            >
              <View style={[styles.radioOuter, { borderColor: method === "edahabia" ? colors.brandPrimary : colors.borderDefault }]}>
                {method === "edahabia" && <View style={[styles.radioInner, { backgroundColor: colors.brandPrimary }]} />}
              </View>
              <CreditCard size={18} color={colors.textPrimary} />
              <Text style={[styles.radioLabel, { color: colors.textPrimary }]}>Edahabia</Text>
            </Card>
          </Pressable>
        </View>

        {/* Card Inputs */}
        <View style={styles.inputsSection}>
          <TextInput
            label={t("payment.cardNumber")}
            placeholder="0000 0000 0000 0000"
            value={cardNumber}
            onChangeText={setCardNumber}
            keyboardType="number-pad"
          />
          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <TextInput
                label={t("payment.expiry")}
                placeholder="MM/YY"
                value={expiry}
                onChangeText={setExpiry}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextInput
                label={t("payment.cvv")}
                placeholder="***"
                value={cvv}
                onChangeText={setCvv}
                keyboardType="number-pad"
                secureTextEntry
              />
            </View>
          </View>
        </View>

        <Button
          title={`${t("payment.pay")} 500 DZD`}
          onPress={handlePay}
          style={styles.payBtn}
        />

        <View style={styles.securedRow}>
          <Shield size={14} color={colors.textSecondary} />
          <Text style={[styles.securedText, { color: colors.textSecondary }]}>{t("payment.securedBy")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  summaryCard: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  summaryLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  divider: { height: 1 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", marginBottom: 12 },
  methodsRow: { flexDirection: "row", gap: 12, marginBottom: 24 },
  radioCard: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  radioLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  inputsSection: { gap: 16, marginBottom: 24 },
  inputRow: { flexDirection: "row", gap: 12 },
  payBtn: { marginBottom: 16 },
  securedRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  securedText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
