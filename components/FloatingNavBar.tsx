import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { SFSymbol } from "sf-symbols-typescript";

import { Host, Row, Icon, Text } from "@expo/ui";
import {
  Animation,
  animation as iosAnimation,
  shadow as iosShadow,
} from "@expo/ui/swift-ui/modifiers";
import {
  animateContentSize,
  dropShadow,
  Shapes as AndroidShapes,
} from "@expo/ui/jetpack-compose/modifiers";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";

// -----------------------------------------------------------------------------
// ONE native floating tab bar for ALL platforms.
//
// Built on the universal @expo/ui layer: a single component tree that renders
// native Jetpack Compose on Android, native SwiftUI on iOS, and react-native-web
// on web. The active tab is an expanded pill (icon + label on a solid
// brandPrimary tint); inactive tabs are icon-only. Gradients aren't supported by
// native backgrounds, so the pill uses a solid tint.
//
// Animation: a soft per-platform morph is added through the `modifiers` escape
// hatch — animateContentSize on Android, animation(spring, activeIndex) on iOS —
// so the bar springs as the active pill changes width on each navigation.
// -----------------------------------------------------------------------------

type TabName = "index" | "chat" | "thesis" | "notifications" | "profile";

type TabDef = {
  name: TabName;
  href: string;
  labelKey: string;
  /** Cross-platform icon: SF Symbol on iOS, Material Symbols XML on Android. */
  icon: { ios: SFSymbol; android: number };
};

const TABS: readonly TabDef[] = [
  {
    name: "index",
    href: "/(tabs)",
    labelKey: "nav.home",
    icon: { ios: "house.fill", android: require("@expo/material-symbols/home.xml") },
  },
  {
    name: "chat",
    href: "/(tabs)/chat",
    labelKey: "nav.chat",
    icon: { ios: "message.fill", android: require("@expo/material-symbols/chat.xml") },
  },
  {
    name: "thesis",
    href: "/(tabs)/thesis",
    labelKey: "nav.thesis",
    icon: { ios: "doc.text.fill", android: require("@expo/material-symbols/description.xml") },
  },
  {
    name: "notifications",
    href: "/(tabs)/notifications",
    labelKey: "nav.notifications",
    icon: { ios: "bell.fill", android: require("@expo/material-symbols/notifications.xml") },
  },
  {
    name: "profile",
    href: "/(tabs)/profile",
    labelKey: "nav.profile",
    icon: { ios: "person.fill", android: require("@expo/material-symbols/person.xml") },
  },
] as const;

function activeIndexFromPathname(pathname: string): number {
  const isIndex =
    pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
  if (isIndex) return 0;
  const found = TABS.findIndex((tab) => tab.name !== "index" && pathname.includes(tab.name));
  return found === -1 ? 0 : found;
}

const BAR_RADIUS = 30;
const PILL_RADIUS = 22;

export function FloatingNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);

  const activeIndex = activeIndexFromPathname(pathname);

  // Solid tint for the active pill (native backgrounds don't support gradients).
  const pillTint = colors.brandPrimary + (theme === "dark" ? "33" : "1F");

  // Soft floating shadow + a subtle width-morph spring, applied natively per
  // platform via the universal `modifiers` escape hatch.
  const cardModifiers =
    Platform.OS === "ios"
      ? [
          iosShadow({ radius: 16, x: 0, y: 6, color: "#00000040" }),
          iosAnimation(Animation.spring({ response: 0.4, dampingFraction: 0.82 }), activeIndex),
        ]
      : Platform.OS === "android"
        ? [
            dropShadow(AndroidShapes.RoundedCorner(BAR_RADIUS), {
              radius: 18,
              alpha: 0.18,
              offsetY: 6,
              color: "#000000",
            }),
            animateContentSize(0.9, 300),
          ]
        : undefined;

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
        alignItems: "center",
      }}
      pointerEvents="box-none">
      <Host matchContents colorScheme={theme} style={{ alignSelf: "center" }}>
        <Row
          spacing={4}
          alignment="center"
          modifiers={cardModifiers as never}
          style={{
            backgroundColor: colors.navBar,
            borderRadius: BAR_RADIUS,
            paddingVertical: 8,
            paddingHorizontal: 8,
          }}>
          {TABS.map((tab, index) => {
            const isActive = index === activeIndex;
            const onPress = () => router.push(tab.href as never);

            return isActive ? (
              <Row
                key={tab.name}
                spacing={7}
                alignment="center"
                onPress={onPress}
                style={{
                  backgroundColor: pillTint,
                  borderRadius: PILL_RADIUS,
                  paddingVertical: 11,
                  paddingHorizontal: 16,
                }}>
                <Icon name={tab.icon} size={20} color={colors.brandPrimary} />
                <Text textStyle={{ fontSize: 14, fontWeight: "600", color: colors.brandPrimary }}>
                  {t(tab.labelKey)}
                </Text>
              </Row>
            ) : (
              <Row
                key={tab.name}
                alignment="center"
                onPress={onPress}
                style={{ borderRadius: PILL_RADIUS, paddingVertical: 11, paddingHorizontal: 15 }}>
                <Icon name={tab.icon} size={22} color={colors.navInactive} />
              </Row>
            );
          })}
        </Row>
      </Host>
    </View>
  );
}
