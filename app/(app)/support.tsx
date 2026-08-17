import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  MessageSquarePlus,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useBottomInset } from "@/hooks/useBottomInset";
import { listSupportConversations } from "@/lib/api";

type Row = {
  key: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  route: string;
  /** Rendered as a count pill at the end of the row. */
  badge?: number;
};

/**
 * The Support Center landing page — everything a stuck student might reach for,
 * in one place.
 *
 * Four destinations, ordered by how often they actually help: the writing guide
 * (how to use Kwill well), the capability catalogue (what it can do at all), the
 * FAQ (real questions), and finally a human. Contact is last on purpose — the
 * three above it answer most of what students write in about.
 */
export default function SupportScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const bottomInset = useBottomInset(32);
  const router = useRouter();

  const [unread, setUnread] = useState(0);

  // Refetched on focus so the badge is right when the student comes back from a
  // thread they just read. A failure here is silent: an unread count is not
  // worth an error banner on a help screen.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      listSupportConversations()
        .then((rows) => {
          if (alive) setUnread(rows.reduce((n, c) => n + (c.unread || 0), 0));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [])
  );

  const rows: Row[] = [
    {
      key: "guide",
      icon: BookOpen,
      title: t("support.guide.title", { defaultValue: "Writing guide" }),
      subtitle: t("support.guide.subtitle", {
        defaultValue: "The right order, and how to ask",
      }),
      route: "/(app)/support-guide",
    },
    {
      key: "capabilities",
      icon: Sparkles,
      title: t("chat.guide.title", { defaultValue: "What Kwill can do" }),
      subtitle: t("support.capabilities.subtitle", {
        defaultValue: "Everything it can do to your document",
      }),
      route: "/(app)/chat-guide",
    },
    {
      key: "faq",
      icon: HelpCircle,
      title: t("support.faq.title", { defaultValue: "Common questions" }),
      subtitle: t("support.faq.subtitle", { defaultValue: "Asked by other students" }),
      route: "/(app)/support-faq",
    },
    {
      key: "contact",
      icon: MessageSquarePlus,
      title: t("support.contact.title", { defaultValue: "Contact us" }),
      subtitle: t("support.contact.subtitle", { defaultValue: "Report a problem, get an answer" }),
      route: "/(app)/support-contact",
      badge: unread || undefined,
    },
  ];

  const Chevron = isRTL ? ChevronLeft : ChevronRight;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("support.title", { defaultValue: "Help & support" })}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lead, { color: colors.textSecondary, textAlign }]}>
          {t("support.lead", {
            defaultValue:
              "Guides written from what students actually asked — and a way to reach us when they don't cover it.",
          })}
        </Text>

        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <Pressable
              key={row.key}
              onPress={() => router.push(row.route as any)}
              accessibilityRole="button"
              accessibilityLabel={row.title}
            >
              {({ pressed }) => (
                <Card style={[styles.row, pressed && { opacity: 0.7 }]}>
                  <View style={[styles.rowInner, { flexDirection }]}>
                    <View style={[styles.badge, { backgroundColor: colors.brandPrimary + "1F" }]}>
                      <Icon size={19} color={colors.brandPrimary} strokeWidth={2} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, { color: colors.textPrimary, textAlign }]}>
                        {row.title}
                      </Text>
                      <Text style={[styles.rowSub, { color: colors.textSecondary, textAlign }]}>
                        {row.subtitle}
                      </Text>
                    </View>
                    {row.badge ? (
                      <View style={[styles.countPill, { backgroundColor: colors.brandPrimary }]}>
                        <Text style={[styles.countText, { color: colors.brandOnPrimary }]}>
                          {row.badge}
                        </Text>
                      </View>
                    ) : null}
                    <Chevron size={18} color={colors.textPlaceholder} />
                  </View>
                </Card>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  content: { paddingHorizontal: 20 },
  lead: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, marginBottom: 20 },
  row: { marginBottom: 10 },
  rowInner: { alignItems: "center", gap: 12 },
  badge: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  rowSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
