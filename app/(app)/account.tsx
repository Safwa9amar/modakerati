import { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  User,
  KeyRound,
  Sparkles,
  Settings as SettingsIcon,
  Bell,
  Mail,
  GraduationCap,
  FileText,
  Shield,
  LogOut,
  ChevronRight,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react-native";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useAuthStore } from "@/stores/auth-store";
import { useProfileStore } from "@/stores/profile-store";
import { useThesisStore } from "@/stores/thesis-store";
import { BackButton } from "@/components/BackButton";
import { AvatarPicker } from "@/components/AvatarPicker";

// 0–999 shown as-is, 1000+ compacted to "8.4K" / "1.2M".
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  const m = n / 1_000_000;
  return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
}

type AccountRow = {
  key: string;
  icon: LucideIcon;
  label: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  brand?: boolean;
  danger?: boolean;
};

/**
 * Everything about the person rather than the document, in grouped rows. This is
 * the whole of the retired Profile tab plus the entry points that were buried in
 * Settings — reached one way only: the avatar at the foot of the drawer.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const rtl = useRTL();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const signOut = useAuthStore((s) => s.signOut);
  const profile = useProfileStore((s) => s.profile);
  const theses = useThesisStore((s) => s.theses);

  const notSet = t("profile.notSet");
  const displayName = profile?.fullName?.trim() || profile?.email?.split("@")[0] || notSet;

  const stats = useMemo(() => {
    const pages = theses.reduce((sum, th) => sum + (th.pageCount || 0), 0);
    const words = theses.reduce((sum, th) => sum + (th.wordCount || 0), 0);
    return [
      { value: formatCount(theses.length), label: t("profile.theses") },
      { value: formatCount(pages), label: t("home.pages", { defaultValue: "Pages" }) },
      { value: formatCount(words), label: t("profile.words") },
    ];
  }, [theses, t]);

  const mine: AccountRow[] = [
    {
      key: "profile",
      icon: User,
      label: t("profile.editProfile"),
      onPress: () => router.push("/(app)/edit-profile" as any),
    },
    {
      key: "key",
      icon: KeyRound,
      label: t("account.aiKey"),
      onPress: () => router.push("/(app)/ai-key" as any),
    },
    {
      key: "settings",
      icon: SettingsIcon,
      label: t("profile.settings"),
      onPress: () => router.push("/(app)/settings" as any),
    },
  ];

  const account: AccountRow[] = [
    {
      key: "university",
      icon: GraduationCap,
      label: t("profile.university"),
      detail: profile?.university || notSet,
    },
    {
      key: "plan",
      icon: Sparkles,
      label: t("account.upgradePlan"),
      brand: true,
      onPress: () => router.push("/(app)/subscription" as any),
    },
    { key: "email", icon: Mail, label: t("auth.email"), detail: profile?.email || notSet },
    {
      key: "notifications",
      icon: Bell,
      label: t("nav.notifications"),
      onPress: () => router.push("/(app)/notifications" as any),
    },
  ];

  const about: AccountRow[] = [
    {
      key: "terms",
      icon: FileText,
      label: t("settings.terms"),
      onPress: () => router.push("/(app)/terms-of-service" as any),
    },
    {
      key: "privacy",
      icon: Shield,
      label: t("settings.privacy"),
      onPress: () => router.push("/(app)/privacy-policy" as any),
    },
    { key: "logout", icon: LogOut, label: t("profile.logOut"), danger: true, onPress: signOut },
  ];

  const Chevron = rtl.isRTL ? ChevronLeft : ChevronRight;

  const renderGroup = (label: string, rows: AccountRow[]) => (
    <>
      <Text style={[styles.groupLabel, { color: colors.textSecondary, textAlign: rtl.textAlign }]}>
        {label}
      </Text>
      <View style={[styles.group, { backgroundColor: colors.bgCard }]}>
        {rows.map((row, i) => {
          const Icon = row.icon;
          const fg = row.danger ? colors.semanticError : row.brand ? colors.brandPrimary : colors.textPrimary;
          return (
            <View key={row.key}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />}
              <Pressable
                onPress={row.onPress}
                disabled={!row.onPress}
                style={[styles.row, { flexDirection: rtl.flexDirection }]}
                accessibilityRole={row.onPress ? "button" : undefined}
              >
                <Icon size={19} color={row.danger ? colors.semanticError : row.brand ? colors.brandPrimary : colors.textSecondary} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: fg, textAlign: rtl.textAlign }]} numberOfLines={1}>
                    {row.label}
                  </Text>
                  {!!row.detail && (
                    <Text
                      style={[styles.rowDetail, { color: colors.textSecondary, textAlign: rtl.textAlign }]}
                      numberOfLines={1}
                    >
                      {row.detail}
                    </Text>
                  )}
                </View>
                {row.onPress && <Chevron size={17} color={colors.textSecondary} />}
              </Pressable>
            </View>
          );
        })}
      </View>
    </>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.topBar, { flexDirection: rtl.flexDirection }]}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("drawer.account")}
        </Text>
        <View style={styles.topSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <AvatarPicker size={72} name={displayName} avatarUrl={profile?.avatarUrl} />
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
            {displayName}
          </Text>
        </View>

        <View style={[styles.stats, { flexDirection: rtl.flexDirection }]}>
          {stats.map((s) => (
            <View key={s.label} style={[styles.stat, { backgroundColor: colors.bgCard }]}>
              <Text style={[styles.statValue, { color: colors.textPrimary }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>

        {renderGroup(t("account.mine"), mine)}
        {renderGroup(t("drawer.account"), account)}
        {renderGroup(t("account.about"), about)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  topTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  topSpacer: { width: 30 },
  content: { paddingHorizontal: 16 },
  identity: { alignItems: "center", gap: 10, paddingVertical: 14 },
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  stats: { gap: 10, marginBottom: 6 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  groupLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 4,
    marginTop: 20,
    marginBottom: 7,
  },
  group: { borderRadius: 14, overflow: "hidden" },
  row: { alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14.5, fontFamily: "Inter_500Medium" },
  rowDetail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginStart: 46 },
});
