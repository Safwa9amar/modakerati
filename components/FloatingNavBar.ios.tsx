import * as React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { SFSymbol } from "sf-symbols-typescript";

import { Host, HStack, ZStack, Image, Text, Namespace } from "@expo/ui/swift-ui";
import {
  Animation,
  animation,
  background,
  clipShape,
  font,
  foregroundStyle,
  frame,
  matchedGeometryEffect,
  onTapGesture,
  padding,
  shadow,
  shapes,
} from "@expo/ui/swift-ui/modifiers";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";

// -----------------------------------------------------------------------------
// Tabs
// -----------------------------------------------------------------------------

type TabName = "index" | "chat" | "thesis" | "notifications" | "profile";

type TabDef = {
  /** Route segment used both for active detection and for navigation. */
  name: TabName;
  /** expo-router href to push on press. */
  href: string;
  /** i18n key for the visible label. */
  labelKey: string;
  /** SF Symbol name rendered on iOS. */
  ios: SFSymbol;
};

const TABS: readonly TabDef[] = [
  { name: "index", href: "/(tabs)", labelKey: "nav.home", ios: "house.fill" },
  { name: "chat", href: "/(tabs)/chat", labelKey: "nav.chat", ios: "message.fill" },
  { name: "thesis", href: "/(tabs)/thesis", labelKey: "nav.thesis", ios: "doc.text.fill" },
  {
    name: "notifications",
    href: "/(tabs)/notifications",
    labelKey: "nav.notifications",
    ios: "bell.fill",
  },
  { name: "profile", href: "/(tabs)/profile", labelKey: "nav.profile", ios: "person.fill" },
] as const;

/** Shared matchedGeometry id for the single morphing pill. */
const PILL_ID = "navPill";

/** Spring driving the pill slide + label expand/collapse. */
const PILL_SPRING = Animation.spring({ response: 0.4, dampingFraction: 0.82 });

/**
 * Maps the current pathname to the active tab index, preserving the exact
 * detection logic specified in the brief.
 */
function activeIndexFromPathname(pathname: string): number {
  const isIndex =
    pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
  if (isIndex) return 0;
  const found = TABS.findIndex((tab) => tab.name !== "index" && pathname.includes(tab.name));
  return found === -1 ? 0 : found;
}

// -----------------------------------------------------------------------------
// Component (STRATEGY A: matchedGeometryEffect + animation(spring, activeIndex),
// driven purely by a React re-render — no worklets, no useNativeState.)
//
// The pathname change (after router.push) re-renders the bar; SwiftUI then sees
// `activeIndex` differ on the `animation(spring, value)` modifier that lives on
// the SAME view as matchedGeometryEffect, opens an animation transaction, and
// slides the matched-geometry pill from the old slot to the new one while the
// label expands/collapses. (Verifier fix: the animation modifier is co-located
// with matchedGeometryEffect on the pill view per the digest gotcha, and each
// tab slot is a structurally-stable wrapper so only the matched child re-parents.)
// -----------------------------------------------------------------------------

export function FloatingNavBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);
  const namespaceId = React.useId();

  const activeIndex = activeIndexFromPathname(pathname);

  // Solid tint for the active pill (gradients unsupported -> solid only).
  const pillTint = colors.brandPrimary + (theme === "dark" ? "33" : "1F");

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
        alignItems: "center",
      }}
      pointerEvents="box-none">
      <Host matchContents colorScheme={theme} style={{ alignSelf: "center" }}>
        <Namespace id={namespaceId}>
          <HStack
            spacing={4}
            alignment="center"
            modifiers={[
              padding({ horizontal: 8, vertical: 8 }),
              background(colors.navBar, shapes.capsule()),
              clipShape("capsule"),
              shadow({ radius: 16, x: 0, y: 6, color: "#00000040" }),
            ]}>
            {TABS.map((tab, index) => {
              const isActive = index === activeIndex;
              const onPress = () => router.push(tab.href as never);

              // Each slot is a structurally-stable ZStack of fixed footprint; we
              // only swap WHICH slot renders the matched pill child. Keeping the
              // slot wrapper constant (and toggling the pill child) is what lets
              // SwiftUI fly the SINGLE matched pill between positions rather than
              // teleporting / cross-fading.
              return (
                <ZStack
                  key={tab.name}
                  alignment="center"
                  modifiers={[
                    frame({ minWidth: 48, height: 44 }),
                    onTapGesture(onPress),
                  ]}>
                  {isActive ? (
                    // ACTIVE slot: the single expanded pill (icon + label). The
                    // matchedGeometryEffect id is constant ('navPill'); the
                    // co-located animation(spring, activeIndex) supplies the
                    // spring transaction so the slide + label morph animate.
                    <HStack
                      spacing={6}
                      alignment="center"
                      modifiers={[
                        matchedGeometryEffect(PILL_ID, namespaceId),
                        animation(PILL_SPRING, activeIndex),
                        padding({ horizontal: 16, vertical: 10 }),
                        background(pillTint, shapes.capsule()),
                        clipShape("capsule"),
                      ]}>
                      <Image
                        systemName={tab.ios}
                        size={20}
                        modifiers={[foregroundStyle(colors.brandPrimary)]}
                      />
                      <Text
                        modifiers={[
                          font({ size: 13, weight: "semibold" }),
                          foregroundStyle(colors.brandPrimary),
                          padding({ trailing: 2 }),
                        ]}>
                        {t(tab.labelKey)}
                      </Text>
                    </HStack>
                  ) : (
                    // INACTIVE slot: icon-only, centered in the fixed footprint.
                    <Image
                      systemName={tab.ios}
                      size={20}
                      modifiers={[foregroundStyle(colors.navInactive)]}
                    />
                  )}
                </ZStack>
              );
            })}
          </HStack>
        </Namespace>
      </Host>
    </View>
  );
}
