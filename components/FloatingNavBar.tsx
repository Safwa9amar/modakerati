import { View, Text, Pressable, StyleSheet } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Home, MessageSquare, FileText, Bell, User } from "lucide-react-native";

const TABS = [
  { name: "index", href: "/(tabs)", icon: Home, labelKey: "nav.home" },
  { name: "chat", href: "/(tabs)/chat", icon: MessageSquare, labelKey: "nav.chat" },
  { name: "thesis", href: "/(tabs)/thesis", icon: FileText, labelKey: "nav.thesis" },
  { name: "notifications", href: "/(tabs)/notifications", icon: Bell, labelKey: "nav.notifications" },
  { name: "profile", href: "/(tabs)/profile", icon: User, labelKey: "nav.profile" },
] as const;

export function FloatingNavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();

  const activeTab = TABS.find((tab) => {
    if (tab.name === "index") return pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
    return pathname.includes(tab.name);
  })?.name ?? "index";

  return (
    <View style={styles.container}>
      <View style={styles.dotRow}>
        {TABS.map((tab) => (
          <View key={tab.name} style={styles.dotSlot}>
            {activeTab === tab.name && (
              <View style={[styles.dot, { backgroundColor: colors.brandPrimary }]} />
            )}
          </View>
        ))}
      </View>
      <View style={[styles.card, { backgroundColor: colors.navBar }]}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.name;
          const Icon = tab.icon;
          return (
            <Pressable key={tab.name} onPress={() => router.push(tab.href as any)} style={styles.tab}>
              <Icon size={22} color={isActive ? colors.brandPrimary : colors.navInactive} strokeWidth={1.8} />
              <Text style={[styles.label, { color: isActive ? colors.brandPrimary : colors.navInactiveLabel, fontFamily: isActive ? "Inter_500Medium" : "Inter_400Regular" }]}>
                {t(tab.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingBottom: 16 },
  dotRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: -4 },
  dotSlot: { flex: 1, alignItems: "center", height: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 28, paddingVertical: 10, paddingHorizontal: 20 },
  tab: { alignItems: "center", gap: 3 },
  label: { fontSize: 10 },
});
