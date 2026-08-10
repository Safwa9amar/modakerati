// A chart drawn from SVG source, with its TEXT rendered natively.
//
// react-native-svg's Android text engine walks a string CHARACTER BY CHARACTER and
// converts each one to a glyph path (GlyphPathBag/TSpanView) against a typeface it
// resolves by asset name. Two things break there, and both show in the same chart:
//
//   1. the font-family list our generator emits ("Helvetica, Arial, sans-serif")
//      matches no asset and no Android family, so EVERY glyph — Arabic letters and
//      the plain digits above the bars alike — falls back to .notdef tofu boxes;
//   2. even with a font that has the glyphs, per-character paths mean no shaping:
//      Arabic letters would come out isolated, unjoined and in logical (LTR) order.
//
// Native <Text> has neither problem — it shapes and bidi-orders through the platform
// text stack. So the SVG keeps the geometry (bars, slices, axes, chips) and every
// <text> element is lifted out and re-drawn as an absolutely positioned RN <Text>
// at the same place, in the same size, with the same anchor.
import { useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";

type Anchor = "start" | "middle" | "end";

type SvgLabel = {
  text: string;
  /** User-space (viewBox) coordinates. `y` is the BASELINE, as in SVG. */
  x: number;
  y: number;
  size: number;
  fill: string;
  anchor: Anchor;
  bold: boolean;
};

type ParsedSvg = {
  /** The same source with every <text> removed — geometry only. */
  body: string;
  view: { x: number; y: number; w: number; h: number };
  labels: SvgLabel[];
};

const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g;

function attrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(source))) out[m[1]] = m[2];
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "") // a stray <tspan> wrapper — keep its text, drop the tag
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const num = (v: string | undefined, fallback: number) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : fallback;
};

function parseChartSvg(xml: string): ParsedSvg {
  const root = attrs(xml.slice(0, Math.max(0, xml.indexOf(">"))));
  const vb = (root.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const view =
    vb.length === 4 && vb.every((n) => Number.isFinite(n))
      ? { x: vb[0], y: vb[1], w: vb[2] || 1, h: vb[3] || 1 }
      : { x: 0, y: 0, w: num(root.width, 480), h: num(root.height, 300) };

  const labels: SvgLabel[] = [];
  TEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEXT_RE.exec(xml))) {
    const a = attrs(m[1]);
    const text = unescapeXml(m[2]).trim();
    if (!text) continue;
    const anchor = a["text-anchor"];
    labels.push({
      text,
      x: num(a.x, 0),
      y: num(a.y, 0),
      size: num(a["font-size"], 10),
      fill: a.fill && a.fill !== "none" ? a.fill : "#333333",
      anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
      bold: a["font-weight"] === "bold" || num(a["font-weight"], 400) >= 600,
    });
  }

  return { body: labels.length ? xml.replace(TEXT_RE, "") : xml, view, labels };
}

export function ChartSvg({ xml, style }: { xml: string; style?: StyleProp<ViewStyle> }) {
  const parsed = useMemo(() => parseChartSvg(xml), [xml]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5 ? prev : { w: width, h: height }));
  };

  // The same fit react-native-svg applies (preserveAspectRatio="xMidYMid meet"),
  // so an overlaid label lands exactly on the geometry it belongs to even when the
  // container's aspect ratio is not the viewBox's.
  const scale = box.w > 0 && box.h > 0 ? Math.min(box.w / parsed.view.w, box.h / parsed.view.h) : 0;
  const originX = (box.w - parsed.view.w * scale) / 2 - parsed.view.x * scale;
  const originY = (box.h - parsed.view.h * scale) / 2 - parsed.view.y * scale;

  return (
    <View style={style} onLayout={onLayout}>
      <SvgXml xml={parsed.body} width="100%" height="100%" />
      {scale > 0 && parsed.labels.length > 0 && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {parsed.labels.map((l, i) => {
            const size = l.size * scale;
            const px = originX + l.x * scale;
            // SVG anchors the BASELINE; RN anchors the box top. An unpadded line box
            // puts the baseline at ~0.8em, so lift the box by that much.
            const top = originY + l.y * scale - size * 0.92;
            // The label is laid out inside an over-wide box anchored on `px`, which
            // gives start/middle/end alignment without measuring the text first.
            const span = Math.max(box.w, 1) * 2;
            const left = l.anchor === "middle" ? px - span / 2 : l.anchor === "end" ? px - span : px;
            return (
              <View
                key={i}
                style={{
                  position: "absolute",
                  left,
                  top,
                  width: span,
                  alignItems: l.anchor === "middle" ? "center" : l.anchor === "end" ? "flex-end" : "flex-start",
                }}
              >
                <Text
                  numberOfLines={1}
                  // No fontFamily: the platform default is the only one guaranteed to
                  // carry Arabic (a named family tofus it — see webview-arabic-font).
                  style={{
                    fontSize: size,
                    lineHeight: size * 1.15,
                    color: l.fill,
                    fontWeight: l.bold ? "700" : "400",
                  }}
                >
                  {l.text}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
