import { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { DocBlockDTO } from "@/lib/api";

// A "word" = a maximal run of non-whitespace. Whitespace-splitting counts Latin
// and Arabic prose alike (both are space-delimited); only paragraph blocks carry
// running text, so tables/figures/structural blocks are skipped.
export function countWords(blocks: DocBlockDTO[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind !== "paragraph") continue;
    const t = b.text.trim();
    if (!t) continue;
    n += t.split(/\s+/).length;
  }
  return n;
}

export interface DocStats {
  words: number;
  pages: number;
  // Heading-level paragraphs (level ≥ 1) — a proxy for the doc's section count.
  sections: number;
}

// Derive lightweight momentum stats from the live block model. ~300 words/page
// is the conventional double-spaced estimate.
export function computeDocStats(blocks: DocBlockDTO[]): DocStats {
  const words = countWords(blocks);
  const pages = words === 0 ? 0 : Math.ceil(words / 300);
  const sections = blocks.reduce(
    (acc, b) => acc + (b.kind === "paragraph" && b.level >= 1 ? 1 : 0),
    0,
  );
  return { words, pages, sections };
}

// A tiny ring (top-anchored, clockwise) showing progress through the current
// 1000-word band — a subtle "closing in on the next milestone" cue.
function ProgressRing({ frac, color, track }: { frac: number; color: string; track: string }) {
  const size = 16;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, frac)) * circumference;
  const c = size / 2;
  return (
    <Svg width={size} height={size}>
      <Circle cx={c} cy={c} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <Circle
        cx={c}
        cy={c}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${c} ${c})`}
      />
    </Svg>
  );
}

// Compact progress pill for the workspace status strip: a momentum ring + a
// "N words · N pages · N sections" summary derived from the live doc. Subtle,
// themed, single-line (shrinks before it squeezes the sync chip beside it).
export function DocProgress({ blocks }: { blocks: DocBlockDTO[] }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const stats = useMemo(() => computeDocStats(blocks), [blocks]);
  const frac = (stats.words % 1000) / 1000;
  const summary = t("workspace.progressSummary", {
    words: stats.words.toLocaleString(),
    pages: stats.pages,
    sections: stats.sections,
    defaultValue: "{{words}} words · {{pages}} pages · {{sections}} sections",
  });
  return (
    <View style={styles.wrap} accessibilityRole="text" accessibilityLabel={summary}>
      <ProgressRing frac={frac} color={colors.brandPrimary} track={colors.borderDefault} />
      <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>
        {summary}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  text: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
