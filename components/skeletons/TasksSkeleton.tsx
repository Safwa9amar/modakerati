import { useEffect, useRef } from "react";
import { View, Animated, Easing, StyleSheet, type DimensionValue } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * The Tasks screen while it loads: the "Up next" header, three task rows and a
 * schedule button, in the shape they will really occupy.
 *
 * Layout-shaped, not a spinner — and the skeleton owns its OWN single pulse.
 * The parent must not drive one: this is the only pulse on the screen, and
 * keeping it here holds every bar in phase by construction.
 */
export function TasksSkeleton() {
  const colors = useThemeColors();

  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const bar = (width: DimensionValue, height = 12, marginBottom = 8) => (
    <Animated.View
      style={{ width, height, borderRadius: 6, marginBottom, backgroundColor: colors.bgSurface, opacity: pulse }}
    />
  );

  return (
    <View style={styles.wrap}>
      {bar("28%", 10, 14)}
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.row, { borderColor: colors.borderDefault }]}>
          <Animated.View
            style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.bgSurface, opacity: pulse }}
          />
          <View style={styles.rowBody}>
            {bar("62%", 12, 6)}
            {bar("38%", 10, 0)}
          </View>
        </View>
      ))}
      <Animated.View
        style={{ height: 46, borderRadius: 12, marginTop: 10, backgroundColor: colors.bgSurface, opacity: pulse }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  rowBody: { flex: 1 },
});
