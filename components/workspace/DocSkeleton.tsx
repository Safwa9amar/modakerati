import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";

// Grey placeholder tint for the "paper" skeleton bars. Kept independent of the
// theme's border tokens so the bars read as content on the always-white paper
// (the Writer's page is white in both themes — see PaperPage).
const BAR = "#E7E7EE";

/**
 * Lightweight document-loading placeholder: a white "paper" card with grey
 * rounded bars (a title + a few paragraph lines) that mimics a page while the
 * live-.docx model loads. Plain RN Views only; a single subtle opacity pulse
 * (reanimated, already a project dep) breathes life into it — no per-bar
 * animation, so it stays cheap and safe.
 */
export function DocSkeleton() {
  const colors = useThemeColors();
  // One shared pulse drives the whole card via a single wrapping Animated.View,
  // so we never share an animated style across multiple nodes.
  const pulse = useSharedValue(0.6);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      pulse.value = 0.6;
    };
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={[styles.host, { backgroundColor: colors.bgSurface }]}>
      <View style={styles.paper}>
        <Animated.View style={pulseStyle}>
          <View style={styles.title} />
          <View style={styles.gap} />
          <View style={[styles.line, styles.full]} />
          <View style={[styles.line, styles.full]} />
          <View style={[styles.line, styles.wide]} />
          <View style={styles.gap} />
          <View style={[styles.line, styles.full]} />
          <View style={[styles.line, styles.full]} />
          <View style={[styles.line, styles.mid]} />
          <View style={styles.gap} />
          <View style={[styles.line, styles.full]} />
          <View style={[styles.line, styles.short]} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, paddingHorizontal: 16, paddingTop: 24 },
  paper: {
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
    padding: 20,
    minHeight: 320,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  title: { height: 20, width: "58%", borderRadius: 5, backgroundColor: BAR },
  line: { height: 12, borderRadius: 4, backgroundColor: BAR, marginBottom: 10 },
  gap: { height: 14 },
  full: { width: "100%" },
  wide: { width: "88%" },
  mid: { width: "72%" },
  short: { width: "45%" },
});
