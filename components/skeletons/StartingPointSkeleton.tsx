import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonGroup } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/useThemeColors";

// The "start a thesis" match-first screen: one highlighted recommendation card,
// then the quieter alternatives. The two static rows below it (Browse all, Blank
// document) are not part of this — the real screen can render those immediately,
// so the skeleton stops where the fetched data starts.

export function StartingPointSkeleton() {
  const colors = useThemeColors();

  return (
    <SkeletonGroup style={styles.scroll} label="Loading starting points">
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}>
        <SkeletonBlock width={128} height={22} radius={20} />

        <View style={styles.cardBody}>
          <SkeletonBlock width={58} height={78} radius={8} />
          <View style={styles.flex}>
            <SkeletonBlock width="88%" height={14} />
            <SkeletonBlock width="52%" height={11} style={styles.uniRow} />
            <View style={styles.chips}>
              <SkeletonBlock width={44} height={17} radius={20} />
              <SkeletonBlock width={52} height={17} radius={20} />
              <SkeletonBlock width={40} height={17} radius={20} />
            </View>
          </View>
        </View>

        <SkeletonBlock width="100%" height={42} radius={12} />
      </View>

      <SkeletonBlock width={96} height={10} radius={4} style={styles.sectionLabel} />

      <View style={[styles.quietRow, { borderColor: colors.borderSubtle }]}>
        <View style={styles.flex}>
          <SkeletonBlock width="66%" height={13} />
          <SkeletonBlock width="40%" height={10} style={styles.meta} />
        </View>
        <SkeletonBlock width={10} height={16} radius={3} />
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 10 },
  flex: { flex: 1 },
  card: { borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 12 },
  cardBody: { flexDirection: "row", gap: 12 },
  uniRow: { marginTop: 8 },
  chips: { flexDirection: "row", gap: 5, marginTop: 10 },
  sectionLabel: { marginTop: 6 },
  quietRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  meta: { marginTop: 7 },
});
