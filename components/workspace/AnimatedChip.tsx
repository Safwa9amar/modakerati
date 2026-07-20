import React, { memo, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { chipIn, PRESS_SCALE, SPRING } from "@/lib/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  accessibilityLabel: string;
  /** Full visual style (colors/borders/size) — owned by the caller, as before. */
  style?: StyleProp<ViewStyle>;
  /** Position in its row → staggered entrance. null/undefined → no entrance anim. */
  enterIndex?: number | null;
  children: React.ReactNode;
}

/**
 * Springy chip: press-down scale, overshoot pop when it becomes active, and a
 * staggered pop-in entrance (drives the toolset-morph feel). Declared once at
 * module scope so the component TYPE is stable — chips never remount on parent
 * re-renders (the concern the old element-returning chip() helper solved).
 * memo() is best-effort only: call sites pass fresh style/onPress/children each
 * render, so re-renders still happen — they're cheap; no-remount is what matters.
 */
export const AnimatedChip = memo(function AnimatedChip({
  onPress,
  disabled,
  active,
  accessibilityLabel,
  style,
  enterIndex,
  children,
}: Props) {
  const scale = useSharedValue(1);
  const wasActive = useRef(!!active);

  useEffect(() => {
    if (active && !wasActive.current) {
      // Became active → overshoot pop from the pressed size.
      scale.value = PRESS_SCALE;
      scale.value = withSpring(1, SPRING);
    }
    wasActive.current = !!active;
  }, [active, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      entering={enterIndex == null ? undefined : chipIn(enterIndex)}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(PRESS_SCALE, SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING);
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
      style={[style, animStyle]}
    >
      {children}
    </AnimatedPressable>
  );
});
