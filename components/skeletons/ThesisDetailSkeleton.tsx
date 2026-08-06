import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonCard, SkeletonGroup } from "@/components/ui/Skeleton";

// The thesis detail page is the slowest push in the app — it waits on the thesis
// row AND the outline. This holds its three bands (book cover on its stage, the
// stat strip, the section rows) so the page lands in one piece.

// ThesisBookCover: 150×208 book centred on a 236pt stage, with a title plate
// above it.
const COVER_W = 150;
const COVER_H = 208;

export function ThesisDetailSkeleton({ sections = 4 }: { sections?: number }) {
  return (
    <SkeletonGroup style={styles.content} label="Loading thesis">
      <View style={styles.stage}>
        <SkeletonBlock width={COVER_W} height={COVER_H} radius={5} />
        <SkeletonBlock width={150} height={26} radius={13} style={styles.plate} />
      </View>

      <View style={styles.strip}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.cell}>
            <SkeletonBlock width={34} height={17} />
            <SkeletonBlock width={52} height={9} radius={4} style={styles.cellLabel} />
          </View>
        ))}
      </View>

      {Array.from({ length: sections }, (_, i) => (
        <SkeletonCard key={i} style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <SkeletonBlock width={28} height={28} radius={9} />
            <SkeletonBlock width={i % 2 === 0 ? "62%" : "48%"} height={14} />
          </View>
        </SkeletonCard>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 18 },
  stage: { height: 236, alignItems: "center", justifyContent: "center", gap: 14 },
  plate: { marginTop: 2 },
  strip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  cell: { flex: 1, alignItems: "center" },
  cellLabel: { marginTop: 7 },
  // SectionRow carries its own 9pt bottom margin on top of the 18pt content gap.
  sectionCard: { borderRadius: 13, padding: 12, marginBottom: 9 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10 },
});
