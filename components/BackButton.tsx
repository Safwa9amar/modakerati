import { useEffect } from "react";
import { BackHandler, Pressable, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useZoomCollapse } from "@/components/ZoomFromOrigin";

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

  // Drawer rows replace rather than push, so a screen opened straight from the
  // drawer is often the ONLY entry on the stack — `back()` there does nothing and
  // the arrow reads as broken. Fall back to the app's root, which resolves to the
  // writer (or its empty state). Back therefore always means "out of here", never
  // "nothing happens".
  // On a screen that grew out of the chip which opened it, leaving collapses back
  // into that chip before the pop — otherwise the navigator cuts it away at full
  // size and the arrival and the exit tell two different stories. `collapse` runs
  // its callback straight through on every other screen, so this is the same
  // `goBack` it always was there.
  const { collapse, active: zooming } = useZoomCollapse();
  const goBack = () => {
    collapse(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/" as any);
    });
  };

  // Android hardware back has to agree with the arrow. Without this, a screen
  // replaced into from the drawer is the only entry on the stack, so the OS back
  // gesture EXITS THE APP instead of returning to the writer. Returning false when
  // there is somewhere to pop leaves the default pop untouched (and screens stacked
  // underneath register the same no-op handler, so nothing double-pops).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // A zooming screen has to OWN its pop — letting the default one through
      // would tear the screen away at full size while the collapse was still
      // playing. Everywhere else the original rule stands untouched.
      if (zooming) {
        goBack();
        return true;
      }
      if (router.canGoBack()) return false;
      router.replace("/" as any);
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, zooming]);

  return (
    <TouchableOpacity onPress={goBack} style={styles.button} hitSlop={8} accessibilityRole="button">
      <Arrow size={22} color={colors.textPrimary} strokeWidth={2} />
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({ button: { padding: 4 } });
