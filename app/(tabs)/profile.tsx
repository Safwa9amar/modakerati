import { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";
import { useProfileStore } from "@/stores/profile-store";
import { useThesisStore } from "@/stores/thesis-store";
import { Card } from "@/components/ui/Card";
import { AvatarPicker } from "@/components/AvatarPicker";
import { useNavBarClearance } from "@/components/FloatingNavBar";
import { Shield, ChevronRight, User, BookOpen, Settings, HelpCircle, LogOut } from "lucide-react-native";

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

export default function ProfileScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const profile = useProfileStore((s) => s.profile);
  const theses = useThesisStore((s) => s.theses);
  const bottomPad = useNavBarClearance();

  const notSet = t("profile.notSet");
  const displayName = profile?.fullName?.trim() || profile?.email?.split("@")[0] || notSet;
  const displayEmail = profile?.email || "";
  const levelLabel = profile?.level ? t(`profile.levels.${profile.level}`) : notSet;

  const stats = useMemo(() => {
    const thesesCount = theses.length;
    const chaptersCount = theses.reduce((sum, th) => sum + th.chapters.length, 0);
    const wordsCount = theses.reduce(
      (sum, th) =>
        sum +
        (th.wordCount ||
          th.chapters.reduce(
            (cSum, c) => cSum + c.sections.reduce((sSum, s) => sSum + (s.wordCount || 0), 0),
            0
          )),
      0
    );
    return [
      { value: formatCount(thesesCount), label: t("profile.theses"), color: colors.brandPrimary },
      { value: formatCount(chaptersCount), label: t("profile.chapters"), color: colors.brandAccent },
      { value: formatCount(wordsCount), label: t("profile.words"), color: colors.semanticWarning },
    ];
  }, [theses, t, colors]);

  const universityInfo = [
    { label: t("profile.university"), value: profile?.university || notSet },
    { label: t("profile.department"), value: profile?.department || notSet },
    { label: t("profile.level"), value: levelLabel },
    { label: t("profile.year"), value: profile?.academicYear || notSet },
  ];

  const actions = [
    { label: t("profile.editProfile"), color: colors.brandPrimary, icon: User, route: "/(app)/edit-profile" },
    { label: t("profile.manageSub"), color: colors.brandAccent, icon: BookOpen, route: "/(app)/subscription" },
    { label: t("profile.settings"), color: colors.brandPrimaryLight, icon: Settings, route: "/(app)/settings" },
    { label: t("profile.help"), color: colors.textSecondary, icon: HelpCircle, route: null },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>{t("profile.profile")}</Text>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <AvatarPicker size={88} name={displayName} avatarUrl={profile?.avatarUrl} />
          <Text style={[styles.userName, { color: colors.textPrimary, marginTop: 12 }]}>{displayName}</Text>
          {!!displayEmail && <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{displayEmail}</Text>}
          <View style={[styles.proBadge, { backgroundColor: colors.brandAccent + "26" }]}>
            <Shield size={14} color={colors.brandAccent} />
            <Text style={[styles.proBadgeText, { color: colors.brandAccent }]}>{t("profile.proPlan")}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          {stats.map((stat, i) => (
            <Card key={i} style={styles.statCard}>
              <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{stat.label}</Text>
            </Card>
          ))}
        </View>

        {/* University */}
        <Card style={styles.uniCard}>
          {universityInfo.map((item, i) => (
            <View key={i}>
              <View style={styles.uniRow}>
                <Text style={[styles.uniLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                <Text style={[styles.uniValue, { color: colors.textPrimary }]}>{item.value}</Text>
              </View>
              {i < universityInfo.length - 1 && <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />}
            </View>
          ))}
        </Card>

        {/* Actions */}
        <Card style={styles.actionsCard}>
          {actions.map((action, i) => (
            <View key={i}>
              <Pressable
                style={styles.actionRow}
                onPress={() => action.route && router.push(action.route as any)}
              >
                <View style={[styles.actionIcon, { backgroundColor: action.color + "26" }]}>
                  <action.icon size={18} color={action.color} />
                </View>
                <Text style={[styles.actionLabel, { color: colors.textPrimary, flex: 1 }]}>{action.label}</Text>
                <ChevronRight size={18} color={colors.textSecondary} />
              </Pressable>
              {i < actions.length - 1 && <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />}
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
          <Pressable style={styles.actionRow} onPress={signOut}>
            <View style={[styles.actionIcon, { backgroundColor: colors.semanticError + "26" }]}>
              <LogOut size={18} color={colors.semanticError} />
            </View>
            <Text style={[styles.actionLabel, { color: colors.semanticError, flex: 1 }]}>{t("profile.logOut")}</Text>
            <ChevronRight size={18} color={colors.semanticError} />
          </Pressable>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  screenTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", textAlign: "center", marginVertical: 16 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  userName: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  userEmail: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 10 },
  proBadge: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  proBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statCard: { flex: 1, alignItems: "center", paddingVertical: 14 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  uniCard: { marginBottom: 16 },
  uniRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  uniLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  uniValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  divider: { height: 1 },
  actionsCard: {},
  actionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  actionIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
