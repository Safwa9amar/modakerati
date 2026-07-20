import React from "react";
import { StyleSheet } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Diameter of the circular dismiss target and the hit radius the pill tests against. */
export const DISMISS_SIZE = 64;
export const DISMISS_HIT_RADIUS = 70;

interface Props {
  /** 0→1 as a drag starts/ends (fade + rise in). */
  visible: SharedValue<number>;
  /** 0→1 when the pill is over the target (grow + tint). */
  active: SharedValue<number>;
  /** Center Y of the target in screen coords (the pill compares against this). */
  centerY: number;
  bottomInset: number;
}

export function DismissTarget({ visible, active, centerY, bottomInset }: Props) {
  const colors = useThemeColors();
  const wrapStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: interpolate(visible.value, [0, 1], [24, 0]) }],
  }));
  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(active.value, [0, 1], [1, 1.25]) }],
    backgroundColor: active.value > 0.5 ? colors.semanticError : colors.bgCard,
    borderColor: active.value > 0.5 ? colors.semanticError : colors.borderDefault,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { bottom: bottomInset + 24 }, wrapStyle]}
    >
      <Animated.View style={[styles.circle, circleStyle]}>
        <X size={26} color={colors.textPrimary} strokeWidth={2.4} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  circle: {
    width: DISMISS_SIZE,
    height: DISMISS_SIZE,
    borderRadius: DISMISS_SIZE / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
});
