// The visual half of the ask sheet: full-width rows, IMAGE ONLY — the ornament
// artwork at its natural wide-strip shape with its name beneath, no composed
// mini-page around it (the student sees the real page in the document itself;
// here the artwork is the whole question). Chosen over a grid (halves the
// artwork) and a carousel (hides the alternatives while choosing).
//
// Interaction: tap selects a row (highlight + description); the confirm button
// appears directly under the selected row and answers the ask. Dismissing
// without choosing stays the sheet's job — this component only ever answers.
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { SvgXml } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { fetchOrnamentPreview, type OrnamentPreview } from "@/lib/api";
import type { AskPreview } from "@/types/chat";

/** viewBox height/width — a page-shaped frame SVG (≈1.4) vs a flanking
 *  ornament strip (≪1), without the payload having to carry `kind`. */
function svgAspect(svg: string): number {
  const m = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  if (!m) return 0;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 ? h / w : 0;
}

function OrnamentRow({
  preview,
  selected,
  onPress,
  onConfirm,
}: {
  preview: AskPreview;
  selected: boolean;
  onPress: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [art, setArt] = useState<OrnamentPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOrnamentPreview(preview.previewUrl)
      .then((a) => { if (alive) setArt(a); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [preview.previewUrl]);

  // Uploaded artwork is always a page frame — that is the only kind the studio
  // accepts an upload for — so it takes the frame layout without a viewBox to
  // measure. Vector rows are still told apart by their aspect ratio.
  const aspect = art?.kind === "svg" ? svgAspect(art.svg) : 0;
  const pageShaped = art?.kind === "image" || aspect > 0.8; // a frame; strips are ≪1

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={preview.label}
        style={[
          styles.row,
          {
            backgroundColor: "#fdfcf8",
            borderColor: selected ? colors.brandPrimary : colors.borderDefault,
            borderWidth: selected ? 2 : 1,
          },
        ]}
      >
        {failed ? (
          // Choosable without its picture — the label still names the ornament;
          // hiding the option entirely would bias the choice.
          <Text style={styles.failText}>{preview.label}</Text>
        ) : !art ? (
          // Layout-shaped placeholder while the artwork loads — never a spinner.
          <View style={[styles.skelBar, { width: "82%" }]} />
        ) : pageShaped ? (
          // Frame family: a page outline can't stretch full-width — show it
          // small beside the name instead.
          <View style={styles.frameRow}>
            {art.kind === "image" ? (
              // A4 proportions: uploaded frames are page artwork, and resizeMode
              // "contain" keeps a non-A4 source from being stretched to fit.
              <Image
                source={{ uri: art.dataUri }}
                style={styles.frameImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            ) : (
              /* Explicit height: viewBox-only SVGs collapse to zero without it. */
              <SvgXml xml={art.svg} height={64} width={64 / Math.max(aspect, 0.1)} />
            )}
            <Text style={[styles.name, styles.frameName]}>{preview.label}</Text>
          </View>
        ) : (
          // Ornament strip at its natural shape: full width, height from the
          // viewBox via aspectRatio (SvgXml alone renders 0-high without it).
          <View style={{ width: "100%", aspectRatio: 1 / Math.max(aspect, 0.02) }}>
            <SvgXml xml={art.svg} width="100%" height="100%" />
          </View>
        )}
        {!failed && !pageShaped && <Text style={styles.name}>{preview.label}</Text>}
        {selected && !!preview.description && (
          <Text style={styles.desc}>{preview.description}</Text>
        )}
      </Pressable>

      {selected && (
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
    </View>
  );
}

export function AskPreviewGrid({
  previews,
  onChoose,
}: {
  previews: AskPreview[];
  onChoose: (label: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <View style={styles.list}>
      {previews.map((p) => {
        const selected = selectedId === p.id;
        return (
          <OrnamentRow
            key={p.id}
            preview={p}
            selected={selected}
            onPress={() => setSelectedId(selected ? null : p.id)}
            onConfirm={() => onChoose(p.label)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, marginBottom: 16 },
  row: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 8,
  },
  frameRow: { flexDirection: "row-reverse", alignItems: "center", gap: 14 },
  frameImage: { width: 46, height: 64 }, // 210:297, the page it will sit on
  frameName: { fontSize: 14 },
  name: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#3a3020", textAlign: "center", writingDirection: "rtl" },
  desc: { fontSize: 11, color: "#6b5d45", textAlign: "center", writingDirection: "rtl" },
  confirm: { marginTop: 6, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  confirmText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  skelBar: { height: 10, borderRadius: 5, backgroundColor: "#e8e2d5", marginVertical: 10 },
  failText: { textAlign: "center", fontSize: 13, color: "#5c4d33", writingDirection: "rtl" },
});
