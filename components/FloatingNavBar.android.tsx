import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Host,
  Row,
  Icon,
  Text,
  AnimatedVisibility,
  EnterTransition,
  ExitTransition,
} from "@expo/ui/jetpack-compose";
import {
  animateContentSize,
  background,
  clickable,
  clip,
  dropShadow,
  padding,
  paddingAll,
  Shapes,
  spring,
} from "@expo/ui/jetpack-compose/modifiers";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";

// -----------------------------------------------------------------------------
// Tabs
// -----------------------------------------------------------------------------

type TabName = "index" | "chat" | "thesis" | "notifications" | "profile";

type TabDef = {
  name: TabName;
  href: string;
  labelKey: string;
  /** require()'d Android XML vector drawable -> numeric asset id. */
  android: number;
};

const TABS: readonly TabDef[] = [
  {
    name: "index",
    href: "/(tabs)",
    labelKey: "nav.home",
    android: require("@expo/material-symbols/home.xml") as number,
  },
  {
    name: "chat",
    href: "/(tabs)/chat",
    labelKey: "nav.chat",
    android: require("@expo/material-symbols/chat.xml") as number,
  },
  {
    name: "thesis",
    href: "/(tabs)/thesis",
    labelKey: "nav.thesis",
    android: require("@expo/material-symbols/description.xml") as number,
  },
  {
    name: "notifications",
    href: "/(tabs)/notifications",
    labelKey: "nav.notifications",
    android: require("@expo/material-symbols/notifications.xml") as number,
  },
  {
    name: "profile",
    href: "/(tabs)/profile",
    labelKey: "nav.profile",
    android: require("@expo/material-symbols/person.xml") as number,
  },
] as const;

const BAR_PADDING = 8;
const BAR_RADIUS = 28;
const PILL_RADIUS = 22;

function activeIndexFromPathname(pathname: string): number {
  const isIndex =
    pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
  if (isIndex) return 0;
  const found = TABS.findIndex((tab) => tab.name !== "index" && pathname.includes(tab.name));
  return found === -1 ? 0 : found;
}

// -----------------------------------------------------------------------------
// Component (STRATEGY A on Android: per-tab animateContentSize springs the pill
// width as the label mounts/unmounts; background(animationSpec) crossfades the
// tint via animateColorAsState; AnimatedVisibility animates the label in/out —
// ALL on a plain React re-render of the usePathname-derived activeIndex. No
// worklets / useNativeState.)
//
// NOTE: Compose has no matchedGeometryEffect, so this produces a smooth
// expand/collapse + tint crossfade IN PLACE on the newly-active tab (and the
// old tab collapses), NOT a continuous left/right glide of one indicator. This
// is the robust, measurement-free morph; a true cross-tab slide would require
// the measured-position + graphicsLayer(translationX) indicator (more fragile
// on first paint), intentionally omitted here.
// -----------------------------------------------------------------------------

export function FloatingNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);

  const activeIndex = activeIndexFromPathname(pathname);

  const pillTint = colors.brandPrimary + (theme === "dark" ? "33" : "1F");
  const tintSpec = spring({ dampingRatio: 0.9, stiffness: 300 });

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
        alignItems: "center",
      }}
      pointerEvents="box-none">
      <Host matchContents colorScheme={theme} style={{ alignSelf: "center" }}>
        {/* Card chrome: rounded + tinted bar with a soft floating shadow. */}
        <Row
          verticalAlignment="center"
          horizontalArrangement={{ spacedBy: 2 }}
          modifiers={[
            dropShadow(Shapes.RoundedCorner(BAR_RADIUS), {
              radius: 18,
              alpha: 0.18,
              offsetY: 6,
              color: "#000000",
            }),
            clip(Shapes.RoundedCorner(BAR_RADIUS)),
            background(colors.navBar),
            paddingAll(BAR_PADDING),
          ]}>
          {TABS.map((tab, index) => {
            const isActive = index === activeIndex;
            const onPress = () => router.push(tab.href as never);

            return (
              <Row
                key={tab.name}
                verticalAlignment="center"
                horizontalArrangement={{ spacedBy: 6 }}
                modifiers={[
                  clip(Shapes.RoundedCorner(PILL_RADIUS)),
                  // background() with an animationSpec crossfades the tint in/out
                  // (animateColorAsState) as the active tab changes. Placed AFTER
                  // clip so the fill is rounded.
                  background(isActive ? pillTint : "#00000000", {
                    animationSpec: tintSpec,
                  }),
                  // animateContentSize springs the pill WIDTH as the label mounts
                  // / unmounts on a plain React re-render.
                  animateContentSize(0.9, 300),
                  clickable(onPress, { indication: false }),
                  padding(isActive ? 16 : 14, 10, isActive ? 16 : 14, 10),
                ]}>
                <Icon
                  source={tab.android}
                  size={24}
                  tint={isActive ? colors.brandPrimary : colors.navInactive}
                />
                <AnimatedVisibility
                  visible={isActive}
                  enterTransition={EnterTransition.fadeIn().plus(
                    EnterTransition.expandHorizontally()
                  )}
                  exitTransition={ExitTransition.fadeOut().plus(
                    ExitTransition.shrinkHorizontally()
                  )}>
                  <Text
                    color={colors.brandPrimary}
                    style={{ fontWeight: "600", fontSize: 14 }}
                    modifiers={[padding(6, 0, 2, 0)]}>
                    {t(tab.labelKey)}
                  </Text>
                </AnimatedVisibility>
              </Row>
            );
          })}
        </Row>
      </Host>
    </View>
  );
}
