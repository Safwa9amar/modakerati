import { View, StyleSheet, type DimensionValue } from "react-native";
import { SkeletonBlock, SkeletonCard, SkeletonGroup } from "@/components/ui/Skeleton";

// Mirrors the notifications SectionList: a small uppercase bucket label, then
// rows of icon-box + title + description + relative time.

const DESC_WIDTHS: DimensionValue[] = ["86%", "64%", "78%", "58%", "72%", "68%"];

function Row({ descWidth }: { descWidth: DimensionValue }) {
  return (
    <SkeletonCard style={styles.card}>
      <View style={styles.row}>
        <SkeletonBlock width={38} height={38} radius={10} />
        <View style={styles.content}>
          <SkeletonBlock width="62%" height={13} />
          <SkeletonBlock width={descWidth} height={11} style={styles.desc} />
          <SkeletonBlock width={56} height={9} radius={4} style={styles.time} />
        </View>
      </View>
    </SkeletonCard>
  );
}

export function NotificationsSkeleton({ count = 6 }: { count?: number }) {
  const first = Math.min(3, count);
  const rest = Math.max(0, count - first);

  return (
    <SkeletonGroup style={styles.container} label="Loading notifications">
      <SkeletonBlock width={62} height={11} radius={4} style={styles.bucket} />
      {Array.from({ length: first }, (_, i) => (
        <Row key={`a${i}`} descWidth={DESC_WIDTHS[i % DESC_WIDTHS.length]} />
      ))}

      {rest > 0 && (
        <>
          <SkeletonBlock width={86} height={11} radius={4} style={styles.bucket} />
          {Array.from({ length: rest }, (_, i) => (
            <Row key={`b${i}`} descWidth={DESC_WIDTHS[(i + first) % DESC_WIDTHS.length]} />
          ))}
        </>
      )}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  bucket: { marginTop: 10, marginBottom: 10 },
  card: { padding: 14, borderRadius: 14, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  content: { flex: 1 },
  desc: { marginTop: 8 },
  time: { marginTop: 8 },
});
