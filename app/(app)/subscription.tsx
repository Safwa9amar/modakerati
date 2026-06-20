import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Check, CreditCard, Send } from "lucide-react-native";

const PRO_FEATURES = [
  "Unlimited thesis projects",
  "AI-powered chapter generation",
  "Advanced formatting tools",
  "Priority AI responses",
  "Export to all formats",
];

const RESEARCHER_FEATURES = [
  "Everything in Pro Student",
  "Multi-language thesis support",
  "Citation auto-discovery",
  "Collaboration features",
  "Dedicated support channel",
];

const PAYMENT_METHODS = [
  { id: "cib", label: "CIB" },
  { id: "edahabia", label: "Edahabia" },
  { id: "chargily", label: "Chargily" },
  { id: "stripe", label: "Stripe" },
];

export default function SubscriptionScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<"pro" | "researcher">("pro");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("payment.upgradeToPro")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t("payment.upgradeSubtitle")}
        </Text>

        {/* Pro Student Plan */}
        <Pressable onPress={() => setSelectedPlan("pro")}>
          <Card
            borderColor={selectedPlan === "pro" ? colors.brandPrimary : colors.borderSubtle}
            style={[styles.planCard, selectedPlan === "pro" && { borderWidth: 2, borderColor: colors.brandPrimary }]}
          >
            <View style={styles.planHeader}>
              <Text style={[styles.planName, { color: colors.textPrimary }]}>{t("payment.proStudent")}</Text>
              <View style={[styles.badge, { backgroundColor: colors.brandPrimary }]}>
                <Text style={styles.badgeText}>{t("payment.recommended")}</Text>
              </View>
            </View>
            <Text style={[styles.price, { color: colors.textPrimary }]}>500 DZD</Text>
            <Text style={[styles.perMonth, { color: colors.textSecondary }]}>{t("payment.perMonth")}</Text>
            <View style={styles.featuresList}>
              {PRO_FEATURES.map((feature, i) => (
                <View key={i} style={styles.featureRow}>
                  <Check size={16} color={colors.semanticSuccess} strokeWidth={3} />
                  <Text style={[styles.featureText, { color: colors.textSecondary }]}>{feature}</Text>
                </View>
              ))}
            </View>
          </Card>
        </Pressable>

        {/* Pro+ Researcher Plan */}
        <Pressable onPress={() => setSelectedPlan("researcher")}>
          <Card
            borderColor={selectedPlan === "researcher" ? "#FFC733" : colors.borderSubtle}
            style={[styles.planCard, selectedPlan === "researcher" && { borderWidth: 2, borderColor: "#FFC733" }]}
          >
            <View style={styles.planHeader}>
              <Text style={[styles.planName, { color: colors.textPrimary }]}>{t("payment.proResearcher")}</Text>
              <View style={[styles.badge, { backgroundColor: "#FFC733" }]}>
                <Text style={[styles.badgeText, { color: "#000" }]}>PRO+</Text>
              </View>
            </View>
            <Text style={[styles.price, { color: colors.textPrimary }]}>1,500 DZD</Text>
            <Text style={[styles.perMonth, { color: colors.textSecondary }]}>{t("payment.perMonth")}</Text>
            <View style={styles.featuresList}>
              {RESEARCHER_FEATURES.map((feature, i) => (
                <View key={i} style={styles.featureRow}>
                  <Check size={16} color="#FFC733" strokeWidth={3} />
                  <Text style={[styles.featureText, { color: colors.textSecondary }]}>{feature}</Text>
                </View>
              ))}
            </View>
          </Card>
        </Pressable>

        {/* Payment Methods */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t("payment.paymentMethods")}</Text>
        <View style={styles.methodsRow}>
          {PAYMENT_METHODS.map((method) => (
            <Card key={method.id} style={styles.methodCard}>
              <CreditCard size={20} color={colors.textSecondary} />
              <Text style={[styles.methodLabel, { color: colors.textPrimary }]}>{method.label}</Text>
            </Card>
          ))}
        </View>

        <Button
          title={t("payment.subscribe")}
          onPress={() => router.push("/(app)/payment-checkout")}
          style={styles.subscribeBtn}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 20 },
  planCard: { marginBottom: 16 },
  planHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  planName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  price: { fontSize: 32, fontFamily: "Inter_700Bold" },
  perMonth: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  featuresList: { gap: 10 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", marginTop: 24, marginBottom: 12 },
  methodsRow: { flexDirection: "row", gap: 10 },
  methodCard: { flex: 1, alignItems: "center", paddingVertical: 14, gap: 6 },
  methodLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  subscribeBtn: { marginTop: 24 },
});
