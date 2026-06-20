import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";
import { Card } from "@/components/ui/Card";
import { Shield, ChevronRight, User, BookOpen, FileText, HelpCircle, LogOut } from "lucide-react-native";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);

  const stats = [
    { value: "3", label: t("profile.theses"), color: colors.brandPrimary },
    { value: "14", label: t("profile.chapters"), color: colors.brandAccent },
    { value: "8.4K", label: t("profile.words"), color: colors.semanticWarning },
  ];

  const universityInfo = [
    { label: t("profile.university"), value: "Universite de Djelfa" },
    { label: t("profile.department"), value: "Computer Science" },
    { label: t("profile.level"), value: "Master 2" },
    { label: t("profile.year"), value: "2025/2026" },
  ];

  const actions = [
    { label: t("profile.editProfile"), color: colors.brandPrimary, icon: User, route: "/(app)/edit-profile" },
    { label: t("profile.manageSub"), color: colors.brandAccent, icon: BookOpen, route: "/(app)/subscription" },
    { label: t("profile.help"), color: colors.textSecondary, icon: HelpCircle, route: null },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>{t("profile.profile")}</Text>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={[styles.avatar, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimaryLight }]}>
            <Text style={styles.avatarText}>HS</Text>
          </View>
          <Text style={[styles.userName, { color: colors.textPrimary }]}>Hamza Safwan</Text>
          <Text style={[styles.userEmail, { color: colors.textSecondary }]}>hamza@example.com</Text>
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
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff" },
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
