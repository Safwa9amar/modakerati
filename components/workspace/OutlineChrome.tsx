import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { type DocSectionDTO } from "@/lib/api";

// Word-style READ-ONLY page chrome for the Outline view: a grey header zone at
// the top of the white card, a footer zone at the bottom, and dashed section
// markers where a section break changes the running header/footer. Tones are
// hardcoded light greys to match the outline card's white paper (not themed).

const C = {
  zoneBg: "#F5F6FA",
  zoneText: "#5A5F7A",
  rule: "#C3C8DC",
  tagText: "#8B8FA8",
  tagBorder: "#D5D8E6",
  chipBg: "#EEF0FA",
  chipText: "#4A4F6E",
};

// iOS only dashes borders when all four sides are set — a clipped full-border
// strip is the reliable way to draw a single dashed rule.
function DashedRule() {
  return (
    <View style={styles.ruleClip}>
      <View style={styles.ruleStrip} />
    </View>
  );
}

function numberingSample(t: TFunction, format: string): string {
  const key =
    format === "decimal" || format === "lowerRoman" || format === "upperRoman"
      ? `workspace.hf.num.${format}`
      : "workspace.hf.num.other";
  return t(key);
}

// One line summarizing a footer: "text · 1, 2, 3…" (either part optional).
function footerSummary(t: TFunction, footer: NonNullable<DocSectionDTO["footer"]>): string {
  const parts: string[] = [];
  if (footer.text) parts.push(footer.text);
  if (footer.pageNumbers) parts.push(numberingSample(t, footer.pageNumbers.format));
  return parts.join(" · ");
}

// startBlockIndex → marker chip label, for every section (2nd onward) whose
// header/footer differs from the previous one. Only non-empty NEW values make a
// line — a change to nothing is silent (v1).
export function computeSectionMarkers(
  t: TFunction,
  sections: DocSectionDTO[] | undefined,
): Map<number, string> {
  const map = new Map<number, string>();
  if (!sections || sections.length < 2) return map;
  for (let k = 1; k < sections.length; k++) {
    const prev = sections[k - 1];
    const cur = sections[k];
    const parts: string[] = [];
    const curHeader = cur.header?.text ?? "";
    if (curHeader && curHeader !== (prev.header?.text ?? "")) {
      parts.push(t("workspace.hf.headerIs", { text: curHeader }));
    }
    const prevFooter = prev.footer ? footerSummary(t, prev.footer) : "";
    const curFooter = cur.footer ? footerSummary(t, cur.footer) : "";
    if (curFooter && curFooter !== prevFooter) {
      parts.push(t("workspace.hf.footerIs", { text: curFooter }));
    }
    if (parts.length) {
      map.set(cur.startBlockIndex, `${t("workspace.hf.newSection")} · ${parts.join(" · ")}`);
    }
  }
  return map;
}

// Grey band + dashed rule + small tag chip. Shows the FIRST section's header —
// the document's base running header. Renders nothing when there is none.
export function OutlineHeaderZone({ section, rtl }: { section?: DocSectionDTO; rtl: boolean }) {
  const { t } = useTranslation();
  if (!section?.header) return null;
  return (
    <View>
      <View style={styles.zone}>
        <Text style={[styles.tag, rtl ? styles.tagLeft : styles.tagRight]}>
          {t("workspace.hf.header")}
        </Text>
        <Text
          numberOfLines={2}
          style={[
            styles.zoneText,
            { textAlign: rtl ? "right" : "left", writingDirection: rtl ? "rtl" : "ltr" },
          ]}
        >
          {section.header.text}
        </Text>
      </View>
      <DashedRule />
    </View>
  );
}

// Footer band at the end of the list: footer text and/or a page-number sample
// built from the real numbering format. Renders nothing when there is none.
export function OutlineFooterZone({ section, rtl }: { section?: DocSectionDTO; rtl: boolean }) {
  const { t } = useTranslation();
  if (!section?.footer) return null;
  return (
    <View>
      <DashedRule />
      <View style={styles.zone}>
        <Text style={[styles.tag, rtl ? styles.tagLeft : styles.tagRight]}>
          {t("workspace.hf.footer")}
        </Text>
        <Text numberOfLines={2} style={[styles.zoneText, styles.footerText]}>
          {footerSummary(t, section.footer)}
        </Text>
      </View>
    </View>
  );
}

// Dashed divider + chip above the first block of a section whose chrome changed.
export function OutlineSectionMarker({ label, rtl }: { label: string; rtl: boolean }) {
  return (
    <View style={[styles.marker, { flexDirection: rtl ? "row-reverse" : "row" }]}>
      <View style={styles.markerLine} />
      <Text style={styles.chip} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.markerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { backgroundColor: C.zoneBg, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 12 },
  zoneText: { fontSize: 12, color: C.zoneText, lineHeight: 17 },
  footerText: { textAlign: "center" },
  tag: {
    position: "absolute",
    top: 4,
    fontSize: 8,
    color: C.tagText,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.tagBorder,
    borderRadius: 3,
    paddingHorizontal: 3,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  tagRight: { right: 6 },
  tagLeft: { left: 6 },
  ruleClip: { height: 1.5, overflow: "hidden" },
  ruleStrip: { height: 3, borderWidth: 1.5, borderColor: C.rule, borderStyle: "dashed" },
  marker: { alignItems: "center", gap: 6, marginVertical: 8 },
  markerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: C.rule },
  chip: {
    fontSize: 10,
    color: C.chipText,
    backgroundColor: C.chipBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.tagBorder,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: "80%",
    overflow: "hidden",
  },
});
