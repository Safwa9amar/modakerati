import { createContext, useContext, useEffect, type ReactNode } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";

// -----------------------------------------------------------------------------
// Skeleton primitives.
//
// A skeleton is not a spinner. It holds the SHAPE of the screen that is coming,
// so a push feels instantaneous and the real content settles into a layout the
// eye has already parsed. Every screen that fetches on mount should render one
// of these instead of a centred ActivityIndicator over an empty page.
//
// All the bars on a screen breathe off ONE driver (`SkeletonGroup`): a timer per
// bar drifts out of phase and reads as flicker, not as loading.
// -----------------------------------------------------------------------------

const PULSE_MS = 750;
const OPACITY_MIN = 0.35;
const OPACITY_SPAN = 0.4;

const PulseContext = createContext<SharedValue<number> | null>(null);

function startPulse(v: SharedValue<number>) {
  v.value = withRepeat(
    withSequence(
      withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: PULSE_MS, easing: Easing.inOut(Easing.ease) })
    ),
    -1,
    false
  );
}

/**
 * Wraps a screen's placeholder tree: owns the single pulse every `SkeletonBlock`
 * below it animates against, and takes the whole subtree out of the touch and
 * accessibility trees (there is nothing here to press or read).
 */
export function SkeletonGroup({
  children,
  style,
  label = "Loading",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    startPulse(pulse);
  }, [pulse]);

  return (
    <PulseContext.Provider value={pulse}>
      {/* `accessible` collapses the whole tree into one element on both platforms,
          so a screen reader says "Loading" once instead of walking 40 blank bars. */}
      <View style={style} pointerEvents="none" accessible accessibilityLabel={label}>
        {children}
      </View>
    </PulseContext.Provider>
  );
}

/** One pulsing placeholder bar. Inherits the group's pulse, or drives its own. */
export function SkeletonBlock({
  width = "100%",
  height = 12,
  radius = 6,
  color,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  /** Overrides the default surface tone — for bars sitting on a coloured field. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const inherited = useContext(PulseContext);
  // Always created so the hook count is stable; only wound up when this block is
  // standing on its own outside a group.
  const own = useSharedValue(0);

  useEffect(() => {
    if (inherited) return;
    startPulse(own);
  }, [inherited, own]);

  const pulse = inherited ?? own;
  const anim = useAnimatedStyle(() => ({ opacity: OPACITY_MIN + pulse.value * OPACITY_SPAN }), [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: color ?? colors.bgSurface },
        style,
        anim,
      ]}
    />
  );
}

/** Avatars, icon badges, status dots. */
export function SkeletonCircle({
  size,
  color,
  style,
}: {
  size: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <SkeletonBlock width={size} height={size} radius={size / 2} color={color} style={style} />;
}

/** A run of text: one bar per entry in `widths`, tallest-to-shortest as written. */
export function SkeletonLines({
  widths,
  height = 12,
  gap = 8,
  color,
  style,
}: {
  widths: DimensionValue[];
  height?: number;
  gap?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap }, style]}>
      {widths.map((w, i) => (
        <SkeletonBlock key={i} width={w} height={height} color={color} />
      ))}
    </View>
  );
}

/**
 * The card chrome a list row sits in. Drawn from the real card tokens (not the
 * pulsing surface) so the page's rhythm is right before any data lands.
 */
export function SkeletonCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
});
