import { useCallback, useMemo, useRef } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Home, MessageSquare, FileText, Bell, User, type LucideIcon } from "lucide-react-native";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";

// -----------------------------------------------------------------------------
// Floating tab bar: active tab = an expanding pill (icon + text); inactive tabs
// = icon only. Built with react-native-reanimated.
//
// To make the expansion read as a smooth glide (not the bouncy "dancing"), the
// row reflow and the pill are animated with the SAME timing + easing, so they
// move in lockstep: each tab uses a timing-based LinearTransition, and the
// single sliding pill withTiming's its x + width to the active tab's measured
// frame over the same duration. No springs = no overshoot.
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

const TAB_HEIGHT = 44;
const DURATION = 280;
const EASING = Easing.inOut(Easing.cubic);
const TIMING = { duration: DURATION, easing: EASING } as const;
const SMOOTH = LinearTransition.duration(DURATION).easing(EASING);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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

  // Hide tab bar on chat screen
  const hideNavBar = pathname.includes("chat");
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const pillTint = colors.brandPrimary + (theme === "dark" ? "33" : "1F");

  // Measured frame (x + width) of every tab, relative to the inner row.
  const layouts = useRef<({ x: number; width: number } | null)[]>(TABS.map(() => null));
  const pillX = useSharedValue(0);
  const pillW = useSharedValue(0);
  const ready = useSharedValue(0);

  const moveTo = useCallback(
    (index: number) => {
      const frame = layouts.current[index];
      if (!frame) return;
      if (ready.value === 1) {
        pillX.value = withTiming(frame.x, TIMING);
        pillW.value = withTiming(frame.width, TIMING);
      } else {
        // First measurement: snap into place (no animation from 0,0).
        pillX.value = frame.x;
        pillW.value = frame.width;
        ready.value = 1;
      }
    },
    [pillX, pillW, ready],
  );

  const onTabLayout = useCallback(
    (index: number, e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      layouts.current[index] = { x, width };
      // Re-aim the pill when the active tab (re)measures — fires after navigation
      // once the newly-active tab has grown to include its label.
      if (index === activeIndexRef.current) moveTo(index);
    },
    [moveTo],
  );

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillW.value,
    opacity: ready.value,
  }));

  if (hideNavBar) return null;

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }]}
      pointerEvents="box-none">
      <View style={[styles.card, { backgroundColor: colors.navBar }]}>
        <View style={styles.row}>
          {/* Single sliding + resizing pill, behind the tabs. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, pillStyle, { backgroundColor: pillTint }]}
          />

          {TABS.map((tab, index) => {
            const isActive = index === activeIndex;
            const Icon = tab.icon;
            return (
              <AnimatedPressable
                key={tab.name}
                layout={SMOOTH}
                onLayout={(e) => onTabLayout(index, e)}
                onPress={() => router.push(tab.href as never)}
                style={styles.tab}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}>
                <Icon
                  size={22}
                  color={isActive ? colors.brandPrimary : colors.navInactive}
                  strokeWidth={2}
                />
                {isActive ? (
                  <Animated.Text
                    entering={FadeIn.duration(200)}
                    numberOfLines={1}
                    style={[styles.label, { color: colors.brandPrimary }]}>
                    {t(tab.labelKey)}
                  </Animated.Text>
                ) : null}
              </AnimatedPressable>
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
    alignItems: "center",
    position: "relative",
    gap: 2,
  },
  pill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: TAB_HEIGHT,
    borderRadius: 22,
  },
  tab: {
    height: TAB_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 22,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
});
