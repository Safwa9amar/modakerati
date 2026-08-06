import { View, StyleSheet } from "react-native";
import { SkeletonBlock, SkeletonGroup } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/useThemeColors";

// The template preview shows either a rendered PDF page or the mock cover sheet;
// either way what fills the screen is one tall portrait page, so that is what the
// placeholder holds — a sheet with the cover's centred bands ghosted onto it.

export function TemplatePreviewSkeleton() {
  const colors = useThemeColors();

  return (
    <SkeletonGroup style={styles.content} label="Loading template">
      <View style={[styles.paper, { borderColor: colors.borderSubtle, backgroundColor: colors.bgCard }]}>
        <SkeletonBlock width="76%" height={9} radius={4} />
        <SkeletonBlock width="64%" height={9} radius={4} />
        <View style={styles.divider} />
        <SkeletonBlock width="52%" height={13} />
        <SkeletonBlock width="44%" height={10} />
        <SkeletonBlock width="38%" height={9} radius={4} />
        <View style={styles.divider} />
        <SkeletonBlock width="34%" height={15} />
        <SkeletonBlock width="82%" height={46} radius={4} style={styles.titleBox} />
        <View style={styles.divider} />
        <SkeletonBlock width="46%" height={9} radius={4} />
        <SkeletonBlock width="46%" height={9} radius={4} />
        <View style={styles.spacer} />
        <SkeletonBlock width="40%" height={9} radius={4} />
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20 },
  paper: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 8,
  },
  divider: { height: 10 },
  spacer: { height: 16 },
  titleBox: { marginVertical: 6 },
});
