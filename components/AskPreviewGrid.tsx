// The visual half of the ask sheet: a two-column grid of preview cards, each a
// mini divider page — the fetched ornament SVG around GENERIC Arabic sample
// text. Generic on purpose: with real chapter text every card looks
// near-identical and the ornament, the only thing being chosen, becomes the
// hardest part to see (same rule as the dashboard studio's preview).
//
// Interaction: first tap EXPANDS a card to full width (the ornament needs room
// to be judged); the expanded card's confirm button answers the ask. Tapping a
// different card moves the expansion. Dismissing without choosing stays the
// sheet's job — this component only ever answers.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SvgXml } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { fetchOrnamentSvg } from "@/lib/api";
import type { AskPreview } from "@/types/chat";

const SAMPLE_LABEL = "الفصل الأول";
const SAMPLE_TITLE = "الإطار النظري";

/** viewBox height/width — tells a page-shaped frame SVG (≈1.4) apart from a
 *  flanking ornament strip (≪1) without the payload having to carry `kind`. */
function svgAspect(svg: string): number {
  const m = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  if (!m) return 0;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 ? h / w : 0;
}

function PreviewCard({
  preview,
  expanded,
  onPress,
  onConfirm,
}: {
  preview: AskPreview;
  expanded: boolean;
  onPress: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOrnamentSvg(preview.previewUrl)
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [preview.previewUrl]);

  const frame = svg ? svgAspect(svg) > 0.8 : false;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={preview.label}
      style={[
        styles.card,
        expanded && styles.cardExpanded,
        { borderColor: expanded ? colors.brandPrimary : colors.borderDefault, backgroundColor: "#fdfcf8" },
      ]}
    >
      <View style={styles.page}>
        {failed ? (
          // The card stays choosable without its picture — the label still names
          // the ornament, and killing the option entirely would bias the choice.
          <Text style={styles.failText}>{preview.label}</Text>
        ) : !svg ? (
          // Layout-shaped placeholder while the SVG loads — never a spinner.
          <View style={styles.skeleton}>
            <View style={[styles.skelBar, { width: "70%" }]} />
            <View style={[styles.skelBar, { width: "45%" }]} />
            <View style={[styles.skelBar, { width: "62%" }]} />
          </View>
        ) : frame ? (
          // Page-shaped frame: the SVG is the page, sample text centred inside.
          <View style={styles.frameWrap}>
            <SvgXml xml={svg} width="100%" height="100%" />
            <View style={styles.frameText}>
              <Text style={styles.label}>{SAMPLE_LABEL}</Text>
              <Text style={[styles.title, expanded && styles.titleExpanded]}>{SAMPLE_TITLE}</Text>
            </View>
          </View>
        ) : (
          // Flanking ornament: above + below the sample text, like the document.
          <View style={styles.flankWrap}>
            <SvgXml xml={svg} width="86%" />
            <Text style={styles.label}>{SAMPLE_LABEL}</Text>
            <View style={styles.rule} />
            <Text style={[styles.title, expanded && styles.titleExpanded]}>{SAMPLE_TITLE}</Text>
            <SvgXml xml={svg} width="86%" />
          </View>
        )}
      </View>

      <Text style={[styles.name, { color: "#3a3020" }]} numberOfLines={1}>
        {preview.label}
      </Text>
      {expanded && !!preview.description && (
        <Text style={styles.desc} numberOfLines={2}>
          {preview.description}
        </Text>
      )}
      {expanded && (
        <Pressable
          onPress={onConfirm}
          accessibilityRole="button"
          style={[styles.confirm, { backgroundColor: colors.brandPrimary }]}
        >
          <Text style={styles.confirmText}>
            {t("chat.choosePreview", { defaultValue: "اختيار هذا الشكل" })}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export function AskPreviewGrid({
  previews,
  onChoose,
}: {
  previews: AskPreview[];
  onChoose: (label: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View style={styles.grid}>
      {previews.map((p) => {
        const expanded = expandedId === p.id;
        return (
          <PreviewCard
            key={p.id}
            preview={p}
            expanded={expanded}
            onPress={() => setExpandedId(expanded ? null : p.id)}
            onConfirm={() => onChoose(p.label)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  // Two columns; an expanded card takes the whole row so the ornament gets room.
  card: { width: "48%", flexGrow: 1, borderWidth: 2, borderRadius: 12, padding: 8 },
  cardExpanded: { width: "100%" },
  page: { aspectRatio: 1 / 1.35, justifyContent: "center" },
  flankWrap: { alignItems: "center", justifyContent: "center", gap: 6, flex: 1 },
  frameWrap: { flex: 1 },
  frameText: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  label: { fontSize: 10, letterSpacing: 2, color: "#5c4d33", writingDirection: "rtl" },
  rule: { height: StyleSheet.hairlineWidth, width: "38%", backgroundColor: "#5c4d33", opacity: 0.5 },
  title: { fontSize: 15, fontWeight: "700", color: "#2a2118", writingDirection: "rtl" },
  titleExpanded: { fontSize: 20 },
  name: { marginTop: 6, fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  desc: { marginTop: 2, fontSize: 11, color: "#6b5d45", textAlign: "center", writingDirection: "rtl" },
  confirm: { marginTop: 8, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  confirmText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  skeleton: { alignItems: "center", justifyContent: "center", gap: 6, flex: 1 },
  skelBar: { height: 8, borderRadius: 4, backgroundColor: "#e8e2d5" },
  failText: { textAlign: "center", fontSize: 13, color: "#5c4d33", writingDirection: "rtl" },
});
