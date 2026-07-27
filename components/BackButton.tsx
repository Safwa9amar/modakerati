import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";

export function BackButton() {
  const router = useRouter();
  const colors = useThemeColors();
  const { isRTL } = useRTL();
  // Point the glyph the right way PER DIRECTION instead of flipping ArrowLeft with
  // `scaleX: -1`. On the New Architecture (Fabric) an RTL-mirrored subtree plus a
  // scaleX flip renders the SVG icon INVISIBLE — the back button vanished entirely
  // in the Arabic header (its slot was there, but blank). Swapping the icon drops
  // the transform and is the standard RTL approach: → in RTL, ← in LTR.
  const Arrow = isRTL ? ArrowRight : ArrowLeft;
  return (
    <Pressable onPress={() => router.back()} style={styles.button} hitSlop={8} accessibilityRole="button">
      <Arrow size={22} color={colors.textPrimary} strokeWidth={2} />
    </Pressable>
  );
}
const styles = StyleSheet.create({ button: { padding: 4 } });
