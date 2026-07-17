import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronLeft, ChevronDown } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection } from "@/lib/text-direction";

export type SectionChapter = { index: number; title: string };

/**
 * One section as a spine-edged card. Tapping a section that has chapters
 * expands it in place to list them; a chapterless section opens the workspace
 * directly. Titles align by their own script.
 */
export function SectionRow({
  ordinal,
  sectionIndex,
  title,
  chapters,
  spineColor,
  onOpenBlock,
}: {
  ordinal: number;
  sectionIndex: number;
  title: string;
  chapters: SectionChapter[];
  spineColor: string;
  onOpenBlock: (blockIndex: number, title: string) => void;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isRtl = getTextDirection(title) === "rtl";
  const hasChapters = chapters.length > 0;

  const onPressHeader = () => {
    if (hasChapters) setExpanded((e) => !e);
    else onOpenBlock(sectionIndex, title);
  };

  const CollapsedChevron = isRtl ? ChevronLeft : ChevronRight;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bgCard,
          borderRightColor: spineColor,
          borderRightWidth: 4,
        },
        expanded && { borderColor: colors.borderDefault, borderWidth: 1, borderRightWidth: 4 },
      ]}
    >
      <Pressable onPress={onPressHeader} style={[styles.header, isRtl && styles.rowReverse]}>
        <View
          style={[
            styles.num,
            { backgroundColor: expanded ? spineColor + "28" : colors.bgSurface },
          ]}
        >
          <Text style={[styles.numText, { color: expanded ? spineColor : colors.textSecondary }]}>
            {ordinal}
          </Text>
        </View>

        <View style={styles.info}>
          <Text
            style={[styles.title, { color: colors.textPrimary, textAlign: isRtl ? "right" : "left" }]}
            numberOfLines={2}
          >
            {title}
          </Text>
          <Text
            style={[styles.meta, { color: colors.textSecondary, textAlign: isRtl ? "right" : "left" }]}
          >
            {chapters.length} {t("home.chapters")}
          </Text>
        </View>

        {hasChapters && expanded ? (
          <ChevronDown size={18} color={spineColor} strokeWidth={2} />
        ) : (
          <CollapsedChevron size={18} color={colors.textPlaceholder} strokeWidth={2} />
        )}
      </Pressable>

      {expanded && (
        <View style={[styles.chapters, { borderTopColor: colors.borderDefault }]}>
          {chapters.map((ch) => {
            const cRtl = getTextDirection(ch.title) === "rtl";
            return (
              <Pressable
                key={ch.index}
                onPress={() => onOpenBlock(ch.index, ch.title)}
                style={[styles.chapterRow, cRtl && styles.rowReverse]}
              >
                <View style={[styles.dot, { backgroundColor: spineColor }]} />
                <Text
                  style={[
                    styles.chapterText,
                    { color: colors.textSecondary, textAlign: cRtl ? "right" : "left" },
                  ]}
                  numberOfLines={1}
                >
                  {ch.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 13, padding: 12, marginBottom: 9 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  rowReverse: { flexDirection: "row-reverse" },
  num: { minWidth: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  info: { flex: 1, gap: 3 },
  title: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  chapters: { marginTop: 11, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  chapterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  chapterText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
});
