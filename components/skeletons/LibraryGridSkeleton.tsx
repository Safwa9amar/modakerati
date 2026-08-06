import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonGroup } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/useThemeColors";

// The Library's two-column tile grid, held while the thesis's sources load. The
// figures and tables come from the already-resident block model, so this only
// covers the gap where the uploaded sources will appear.

export function LibraryGridSkeleton({ count = 6 }: { count?: number }) {
  const colors = useThemeColors();

  return (
    <SkeletonGroup style={styles.grid} label="Loading library">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[styles.tile, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}
        >
          <SkeletonBlock width="100%" height={104} radius={0} />
          <SkeletonBlock width={i % 2 === 0 ? "80%" : "58%"} height={11} style={styles.label} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  // No horizontal padding: this renders INSIDE the grid's own scroll container,
  // which already pads to 16.
  grid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    width: "47.5%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingBottom: 9,
  },
  label: { marginHorizontal: 10, marginTop: 8 },
});
