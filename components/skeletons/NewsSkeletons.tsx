import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonCard, SkeletonGroup, SkeletonLines } from "@/components/ui/Skeleton";

// Placeholders for the two news screens. Both mirror the real layout closely
// enough that nothing jumps when the articles land: same card padding, same
// 96×96 thumbnail, same 200pt cover.

// Varied line widths per card, so the list doesn't read as a printed pattern.
const CARD_SHAPES: { title: number[]; summary: number[] }[] = [
  { title: [180, 120], summary: [200, 140] },
  { title: [150], summary: [190, 110] },
  { title: [175, 95], summary: [180] },
  { title: [160, 130], summary: [195, 125] },
  { title: [145], summary: [185, 100] },
];

export function NewsListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonGroup style={styles.list} label="Loading news">
      {CARD_SHAPES.slice(0, count).map((shape, i) => (
        <SkeletonCard key={i} style={styles.newsCard}>
          <SkeletonBlock width={96} height={96} radius={12} />
          <View style={styles.newsBody}>
            <SkeletonBlock width={70} height={9} radius={4} />
            <SkeletonLines widths={shape.title} height={13} gap={6} style={styles.gapTop} />
            <SkeletonLines widths={shape.summary} height={10} gap={5} style={styles.gapTop} />
            <SkeletonBlock width={44} height={9} radius={4} style={styles.gapTop} />
          </View>
        </SkeletonCard>
      ))}
    </SkeletonGroup>
  );
}

export function NewsArticleSkeleton() {
  return (
    <SkeletonGroup style={styles.article} label="Loading article">
      <SkeletonBlock width="100%" height={200} radius={18} />

      <View style={styles.metaRow}>
        <SkeletonBlock width={92} height={24} radius={20} />
        <SkeletonBlock width={40} height={13} />
      </View>

      {/* Title — 25pt/32 line-height in the real screen. */}
      <SkeletonLines widths={["92%", "68%"]} height={22} gap={9} />
      <SkeletonBlock width={130} height={12} />

      <SkeletonLines widths={["100%", "96%", "72%"]} height={14} gap={8} style={styles.gapTop} />
      <SkeletonLines
        widths={["100%", "98%", "94%", "100%", "88%", "60%"]}
        height={11}
        gap={9}
        style={styles.body}
      />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingTop: 2, gap: 12 },
  newsCard: { flexDirection: "row", gap: 12, borderRadius: 16 },
  newsBody: { flex: 1 },
  gapTop: { marginTop: 8 },

  article: { padding: 20, gap: 12 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  body: { marginTop: 12 },
});
