import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonGroup } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/useThemeColors";

// One placeholder for both template lists — "Browse all" (ranked starting
// points) and a single institution's templates — because the two draw the same
// row: cover thumbnail, title, a line of meta, a strip of chips, chevron.

export function TemplateListSkeleton({ count = 6 }: { count?: number }) {
  const colors = useThemeColors();

  return (
    <SkeletonGroup style={styles.list} label="Loading templates">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[styles.row, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}
        >
          <SkeletonBlock width={45} height={59} radius={6} />
          <View style={styles.body}>
            <SkeletonBlock width={i % 3 === 0 ? "78%" : "60%"} height={13} />
            <SkeletonBlock width="45%" height={10} style={styles.meta} />
            <View style={styles.chips}>
              <SkeletonBlock width={74} height={16} radius={20} />
              <SkeletonBlock width={54} height={16} radius={20} />
            </View>
          </View>
          <SkeletonBlock width={10} height={16} radius={3} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 10 },
  body: { flex: 1 },
  meta: { marginTop: 7 },
  chips: { flexDirection: "row", gap: 5, marginTop: 8 },
});
