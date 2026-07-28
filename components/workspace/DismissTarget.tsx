import React from "react";
import { StyleSheet } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { X, type LucideIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Diameter of the circular target and the hit radius the pill tests against. */
export const DISMISS_SIZE = 50;
export const DISMISS_HIT_RADIUS = 100;

/**
 * One target in the bubble's drag tray (C2 layout): a bare outlined circle anchored
 * to the screen's right edge at a given bottom offset, with a label that flies out to
 * its LEFT while the pill hovers it. Two of these stack into the right-edge column
 * (close above, keyboard below) revealed while dragging the ✦ bubble.
 */
interface Props {
  /** 0→1 as a drag starts/ends (fade + slide in from the right). */
  visible: SharedValue<number>;
  /** 0→1 when the pill is over this target (grow + tint + reveal label). */
  active: SharedValue<number>;
  /** Glyph in the circle (default X = dismiss the bubble). */
  Icon?: LucideIcon;
  /** Label shown to the LEFT of the circle while hovered. */
  label?: string;
  /** Active tint: "danger" (destructive close) or "neutral" (keyboard). */
  variant?: "danger" | "neutral";
  /** px from the screen's right edge to the circle's right side. */
  right: number;
  /** px from the screen's bottom to the circle's bottom. */
  bottom: number;
}

export function DismissTarget({ visible, active, Icon = X, label, variant = "danger", right, bottom }: Props) {
  const colors = useThemeColors();
  const activeTint = variant === "danger" ? colors.semanticError : colors.brandPrimary;
  const wrapStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateX: interpolate(visible.value, [0, 1], [16, 0]) }],
  }));
  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(active.value, [0, 1], [1, 1.18]) }],
    borderColor: active.value > 0.5 ? activeTint : colors.brandAccent,
    backgroundColor: active.value > 0.5 ? `${activeTint}22` : "transparent",
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: active.value }));
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { right, bottom }, wrapStyle]}>
      {label ? (
        <Animated.Text
          numberOfLines={1}
          style={[styles.label, { color: activeTint, backgroundColor: `${activeTint}18` }, labelStyle]}
        >
          {label}
        </Animated.Text>
      ) : null}
      <Animated.View style={[styles.circle, circleStyle]}>
        <Icon size={22} color={colors.brandAccent} strokeWidth={2.2} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", flexDirection: "row", alignItems: "center", gap: 8 },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
  circle: {
    width: DISMISS_SIZE,
    height: DISMISS_SIZE,
    borderRadius: DISMISS_SIZE / 2,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
