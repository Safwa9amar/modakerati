import { useEffect, useRef, useState } from "react";
import {
  I18nManager,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useThemeColors } from "@/hooks/useThemeColors";

// -----------------------------------------------------------------------------
// A TabView-style segmented selector: a fixed-height track with equal-width
// segments and a single indicator that slides (react-native-reanimated) to the
// selected segment. Used for in-page filters/tabs (e.g. All/Active/Completed).
// -----------------------------------------------------------------------------

export type Segment = { key: string; label: string; count?: number };

const DURATION = 240;
const EASING = Easing.inOut(Easing.cubic);
const TRACK_HEIGHT = 42;
const PAD = 4;

type SegmentedTabsProps = {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
};

export function SegmentedTabs({ segments, value, onChange }: SegmentedTabsProps) {
  const colors = useThemeColors();
  const [trackWidth, setTrackWidth] = useState(0);

  const count = segments.length;
  const innerWidth = Math.max(0, trackWidth - PAD * 2);
  const slot = count > 0 ? innerWidth / count : 0;

  const activeIdx = Math.max(
    0,
    segments.findIndex((s) => s.key === value),
  );
  // Mirror for RTL so the indicator lands under the correct segment.
  const visualIdx = I18nManager.isRTL ? count - 1 - activeIdx : activeIdx;

  const x = useSharedValue(0);
  const didInit = useRef(false);

  useEffect(() => {
    if (slot <= 0) return;
    const target = visualIdx * slot;
    if (!didInit.current) {
      x.value = target;
      didInit.current = true;
    } else {
      x.value = withTiming(target, { duration: DURATION, easing: EASING });
    }
  }, [visualIdx, slot, x]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: slot,
  }));

  return (
    <View
      style={[styles.track, { backgroundColor: colors.bgSurface }]}
      onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}>
      {slot > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, indicatorStyle, { backgroundColor: colors.brandPrimary }]}
        />
      ) : null}
      {segments.map((seg) => {
        const isActive = seg.key === value;
        return (
          <Pressable
            key={seg.key}
            onPress={() => onChange(seg.key)}
            style={styles.segment}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}>
            <Text
              numberOfLines={1}
              style={[styles.label, { color: isActive ? "#FFFFFF" : colors.textSecondary }]}>
              {seg.label}
            </Text>
            {seg.count != null ? (
              <Text
                style={[
                  styles.count,
                  {
                    color: isActive ? "rgba(255,255,255,0.78)" : colors.textPlaceholder,
                  },
                ]}>
                {seg.count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: PAD,
    position: "relative",
  },
  indicator: {
    position: "absolute",
    left: PAD,
    top: PAD,
    bottom: PAD,
    borderRadius: (TRACK_HEIGHT - PAD * 2) / 2,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
  },
  label: {
    flexShrink: 1,
    fontSize: 12.5,
    fontFamily: "Inter_500Medium",
  },
  count: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
});
