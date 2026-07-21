import { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from "react-native-reanimated";
import { CornerDownRight } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Ink that reads on the white document paper (theme text flips light in dark mode).
const PAPER = "#FFFFFF";
const INK = "#1A1A26";
const INK_SOFT = "#6B6B7A";

/**
 * Masks a heading-navigation jump. While `navigating` is true it covers the
 * document area with a quick paper-white fade and a small "→ {section}" loader, so
 * the raw scroll (which for a far/unmeasured row can fly through or multi-step) is
 * never seen. It fades out to reveal the settled target — which then flashes (see
 * the outline Row highlight). Snaps in fast, eases out smooth.
 */
export function NavOverlay() {
  const colors = useThemeColors();
  const navigating = useWorkspaceStore((s) => s.navigating);
  // The section we're jumping to = the single selected block's text (set just
  // before the scroll request). Primitive selector → no zustand loop.
  const label = useWorkspaceStore((s) => (s.selectedBlocks.length === 1 ? s.selectedBlocks[0].text : ""));

  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(navigating ? 1 : 0, {
      duration: navigating ? 120 : 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [navigating]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const rtl = /[֐-ࣿ]/.test(label);

  return (
    <Animated.View style={[styles.fill, style]} pointerEvents={navigating ? "auto" : "none"}>
      <View style={styles.center}>
        <View style={[styles.pill, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <ActivityIndicator size="small" color={colors.brandPrimary} />
          {label ? (
            <>
              <CornerDownRight size={15} color={INK_SOFT} style={rtl ? styles.flip : undefined} />
              <Text style={[styles.label, { textAlign: rtl ? "right" : "left" }]} numberOfLines={1}>
                {label}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Covers the doc area (paper-white so it blends with the document beneath).
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: PAPER, zIndex: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "100%",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: "#F4F4F8",
  },
  label: { flexShrink: 1, color: INK, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  flip: { transform: [{ scaleX: -1 }] },
});
