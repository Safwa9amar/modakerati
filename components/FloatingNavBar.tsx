import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Home, MessageSquare, FileText, Bell, User, type LucideIcon } from "lucide-react-native";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";

// -----------------------------------------------------------------------------
// Web / other-platform fallback. Metro resolves FloatingNavBar.ios.tsx /
// FloatingNavBar.android.tsx first on native; this file ships on web and any
// other platform. Static (non-animated) floating pill nav bar: the active tab
// is an expanded pill (icon + label on a solid brandPrimary tint), inactive
// tabs are icon-only. The animated SwiftUI / Jetpack Compose variants live in
// the .ios.tsx / .android.tsx siblings.
// -----------------------------------------------------------------------------

type TabName = "index" | "chat" | "thesis" | "notifications" | "profile";

type TabDef = {
  name: TabName;
  href: string;
  icon: LucideIcon;
  labelKey: string;
};

const TABS: readonly TabDef[] = [
  { name: "index", href: "/(tabs)", icon: Home, labelKey: "nav.home" },
  { name: "chat", href: "/(tabs)/chat", icon: MessageSquare, labelKey: "nav.chat" },
  { name: "thesis", href: "/(tabs)/thesis", icon: FileText, labelKey: "nav.thesis" },
  { name: "notifications", href: "/(tabs)/notifications", icon: Bell, labelKey: "nav.notifications" },
  { name: "profile", href: "/(tabs)/profile", icon: User, labelKey: "nav.profile" },
] as const;

export function FloatingNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);

  const activeTab =
    TABS.find((tab) => {
      if (tab.name === "index") {
        return pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
      }
      return pathname.includes(tab.name);
    })?.name ?? "index";

  const pillTint = colors.brandPrimary + (theme === "dark" ? "33" : "1F");

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: insets.bottom > 0 ? insets.bottom : 12 },
      ]}
      pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: colors.navBar }]}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.name;
          const Icon = tab.icon;
          return (
            <Pressable
              key={tab.name}
              onPress={() => router.push(tab.href as never)}
              style={[
                styles.tab,
                isActive && [styles.tabActive, { backgroundColor: pillTint }],
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}>
              <Icon
                size={22}
                color={isActive ? colors.brandPrimary : colors.navInactive}
                strokeWidth={2}
              />
              {isActive ? (
                <Text style={[styles.label, { color: colors.brandPrimary }]} numberOfLines={1}>
                  {t(tab.labelKey)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    alignItems: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 28,
    paddingVertical: 8,
    paddingHorizontal: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    minWidth: 48,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  tabActive: {
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
});
