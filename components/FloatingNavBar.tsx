import { useEffect, useMemo, useRef } from "react";
import { I18nManager, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Home, MessageSquare, FileText, Bell, User, type LucideIcon } from "lucide-react-native";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";

// -----------------------------------------------------------------------------
// Floating tab bar — fixed equal-width icon slots so the icons NEVER move, plus
// a single rounded pill that springs (react-native-reanimated) to the selected
// slot. Only the selected tab animates; the others stay perfectly still.
//
// Slots are a constant width, so the pill position is pure `activeIndex` math —
// no per-tab measurement, no reflow, no "dancing".
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

const SLOT_WIDTH = 62;
const TAB_HEIGHT = 44;
const PILL_INSET = 6;
const PILL_HEIGHT = 40;
const SPRING = { damping: 18, stiffness: 200, mass: 0.9 } as const;

function activeIndexFromPathname(pathname: string): number {
  const isIndex =
    pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
  if (isIndex) return 0;
  const found = TABS.findIndex((tab) => tab.name !== "index" && pathname.includes(tab.name));
  return found === -1 ? 0 : found;
}

export function FloatingNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);

  const activeIndex = useMemo(() => activeIndexFromPathname(pathname), [pathname]);
  const pillTint = colors.brandPrimary + (theme === "dark" ? "33" : "1F");

  // Mirror the slot for RTL so the pill lands under the correct icon.
  const slotIndex = I18nManager.isRTL ? TABS.length - 1 - activeIndex : activeIndex;
  const targetX = slotIndex * SLOT_WIDTH + PILL_INSET;

  // Initialised at the correct spot so it never flashes from 0 on mount; only
  // subsequent active-tab changes spring.
  const pillX = useSharedValue(targetX);
  const didInit = useRef(false);

  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true;
      return;
    }
    pillX.value = withSpring(targetX, SPRING);
  }, [targetX, pillX]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }]}
      pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: colors.navBar }]}>
        <View style={styles.row}>
          {/* Single sliding pill, behind the icons. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pill,
              pillStyle,
              { width: SLOT_WIDTH - PILL_INSET * 2, backgroundColor: pillTint },
            ]}
          />

          {TABS.map((tab, index) => {
            const isActive = index === activeIndex;
            const Icon = tab.icon;
            return (
              <Pressable
                key={tab.name}
                onPress={() => router.push(tab.href as never)}
                style={styles.tab}
                accessibilityRole="button"
                accessibilityLabel={t(tab.labelKey)}
                accessibilityState={{ selected: isActive }}>
                <Icon
                  size={23}
                  color={isActive ? colors.brandPrimary : colors.navInactive}
                  strokeWidth={2}
                />
              </Pressable>
            );
          })}
        </View>
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
    borderRadius: 30,
    padding: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: {
    flexDirection: "row",
    position: "relative",
  },
  pill: {
    position: "absolute",
    left: 0,
    top: (TAB_HEIGHT - PILL_HEIGHT) / 2,
    height: PILL_HEIGHT,
    borderRadius: 20,
  },
  tab: {
    width: SLOT_WIDTH,
    height: TAB_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
});
