import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { X, Sparkles } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBillingStore, useQuotaBlocked, useQuotaAvailable, useQuotaLow } from "@/stores/billing-store";
import { visualRow, visualTextAlign } from "@/lib/rtl-layout";

// Two states, one card, pinned above the composer:
//
//   BLOCKED — the server refused the turn. The question stays in the chat marked
//             undelivered (so Retry works once there is credit); this explains
//             why and offers the only thing that can fix it.
//   LOW     — still sendable, but nearly out. Dismissible, and never shown twice
//             in a row for the same count.
//
// Why here rather than an Alert: a modal interrupts, and the student is mid
// thought. This sits where the answer would have appeared.

export function QuotaNotice() {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const blocked = useQuotaBlocked();
  const available = useQuotaAvailable();
  const low = useQuotaLow();
  const setBlocked = useBillingStore((s) => s.setBlocked);

  // -1 means the counter has never loaded — say nothing rather than guess.
  if (!blocked && (!low || available < 0)) return null;

  const isBlocked = !!blocked;
  const rtl = i18n.language === "ar";

  const title = isBlocked
    ? t("payment.quotaBlockedTitle")
    : t("payment.quotaLow", { count: Math.max(0, available) });

  const body = isBlocked
    ? blocked === "month-cap"
      ? t("payment.quotaMonthCapBody")
      : t("payment.quotaBlockedBody")
    : t("payment.quotaBlockedBody");

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bgCard,
          borderColor: isBlocked ? colors.semanticError : colors.borderDefault,
          // Physical left/right are swapped by I18nManager — see lib/rtl-layout.
          flexDirection: visualRow(rtl),
        },
      ]}
    >
      <Sparkles size={20} color={isBlocked ? colors.semanticError : colors.brandAccent} />

      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.textPrimary, textAlign: visualTextAlign(rtl) }]}>
          {title}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary, textAlign: visualTextAlign(rtl) }]}>
          {body}
        </Text>
      </View>

      <Pressable
        onPress={() => {
          setBlocked(null);
          router.push("/(app)/subscription" as any);
        }}
        style={[styles.cta, { backgroundColor: colors.brandPrimary }]}
        hitSlop={8}
      >
        <Text style={styles.ctaText}>{t("payment.viewPlans")}</Text>
      </Pressable>

      {/* Only the warning is dismissible. Hiding the blocked card would leave a
          composer that silently refuses every send with nothing to explain it. */}
      {!isBlocked && (
        <Pressable onPress={() => setBlocked(null)} hitSlop={10}>
          <X size={16} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cta: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  ctaText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
});
