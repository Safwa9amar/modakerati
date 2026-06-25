import { Fragment, useMemo, type ReactNode } from "react";
import { View, Text, Platform, I18nManager, StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { useMarkdown, Renderer, type useMarkdownHookOptions } from "react-native-marked";
import { SvgXml } from "react-native-svg";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection, type TextDirection } from "@/lib/text-direction";
import { chartToSvg, type ChartSpec } from "@/lib/chart-svg";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

// Consecutive emoji code points grouped into one run so ZWJ / variation-selector
// sequences (e.g. 👨‍👩‍👧, flags) stay intact.
const EMOJI_RE =
  /([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]+)/u;

class EmojiRenderer extends Renderer {
  // Render fenced ```chart blocks (JSON ChartSpec) as inline SVG charts; any
  // other code block (or invalid JSON) falls back to the base code renderer.
  code(text: string, language?: string, containerStyle?: ViewStyle, textStyle?: TextStyle): ReactNode {
    if ((language || "").trim().toLowerCase() === "chart") {
      try {
        const spec = JSON.parse(text) as ChartSpec;
        const svg = chartToSvg(spec, { width: 320, height: 200 });
        return <SvgXml key={this.getKey()} xml={svg} width="100%" />;
      } catch {
        // fall through to default code rendering on bad JSON
      }
    }
    return super.code(text, language, containerStyle, textStyle);
  }
}
// getTextNode is private in TS but is the single leaf all text methods funnel
// through; override it at runtime, preserving the exact wrapper structure.
(EmojiRenderer.prototype as any).getTextNode = function (children: ReactNode, styles: TextStyle) {
  // Per-node direction: an English heading/line inside a mostly-Arabic answer
  // (or vice versa) aligns by its OWN language, so punctuation lands on the
  // correct side instead of inheriting the message's dominant direction.
  const perNodeDir: TextStyle | null =
    typeof children === "string"
      ? (() => {
          const d = getTextDirection(children);
          return { textAlign: d === "rtl" ? "right" : "left", writingDirection: d };
        })()
      : null;
  const style = perNodeDir ? [styles, perNodeDir] : styles;
  if (typeof children === "string" && EMOJI_RE.test(children)) {
    const parts = children.split(EMOJI_RE).filter((p) => p !== "");
    // A custom fontFamily (Inter) suppresses iOS's automatic color-emoji
    // fallback on the New Architecture, so emoji in such a run render as tofu.
    // Keep the wrapper fontless — the system font DOES fall back to emoji — and
    // re-apply the text font only to the non-emoji runs.
    const { fontFamily, ...wrapperStyle } = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    const textRunStyle = fontFamily ? { fontFamily } : undefined;
    return (
      <Text key={this.getKey()} selectable style={wrapperStyle}>
        {parts.map((p, i) =>
          EMOJI_RE.test(p) ? (
            <Text key={i}>{p}</Text>
          ) : (
            <Text key={i} style={textRunStyle}>
              {p}
            </Text>
          ),
        )}
      </Text>
    );
  }
  return (
    <Text key={this.getKey()} selectable style={style}>
      {children}
    </Text>
  );
};

/**
 * Renders markdown inside a chat bubble using react-native-marked.
 *
 * We use the `useMarkdown` hook (not the default <Markdown /> component) because
 * the component renders its own FlatList, which can't nest inside the chat's
 * FlatList. The hook returns plain elements we render in a View instead.
 */
export function Markdown({ content, color, direction }: { content: string; color?: string; direction?: TextDirection }) {
  const colors = useThemeColors();
  const textColor = color ?? colors.textPrimary;
  // Direction follows the message's own language, not the app locale, so an
  // Arabic answer stays RTL in an English UI and vice versa.
  const dir = direction ?? getTextDirection(content);
  const align = dir === "rtl" ? "right" : "left";
  // The renderer lays each paragraph out as a flex row, so a single text run
  // hugs the row's start — which follows the global I18nManager, not this
  // message. Flip flexDirection so the row's visual direction matches the
  // message regardless of the app locale (the `direction` style isn't honored
  // reliably for nested flex containers here).
  const rowDirection: "row" | "row-reverse" =
    (dir === "rtl") === I18nManager.isRTL ? "row" : "row-reverse";

  const renderer = useMemo(() => new EmojiRenderer(), [content]);

  const options = useMemo<useMarkdownHookOptions>(
    () => ({
      renderer,
      theme: {
        colors: {
          text: textColor,
          link: colors.brandPrimaryLight,
          code: colors.bgInput,
          background: "transparent",
          border: colors.borderDefault,
        },
      },
      styles: {
        text: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, color: textColor, textAlign: align, writingDirection: dir },
        strong: { fontFamily: "Inter_700Bold" },
        em: { fontStyle: "italic" },
        paragraph: { marginVertical: 4, flexWrap: "wrap", flexDirection: rowDirection, alignItems: "flex-start", justifyContent: "flex-start" },
        h1: { fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 26, marginVertical: 4, color: textColor, textAlign: align, writingDirection: dir },
        h2: { fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 24, marginVertical: 4, color: textColor, textAlign: align, writingDirection: dir },
        h3: { fontFamily: "Inter_700Bold", fontSize: 16, lineHeight: 22, marginVertical: 4, color: textColor, textAlign: align, writingDirection: dir },
        h4: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21, marginVertical: 2, color: textColor, textAlign: align, writingDirection: dir },
        h5: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21, marginVertical: 2, color: textColor, textAlign: align, writingDirection: dir },
        h6: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20, marginVertical: 2, color: textColor, textAlign: align, writingDirection: dir },
        hr: { backgroundColor: colors.borderDefault, height: 1, marginVertical: 8 },
        blockquote: {
          borderLeftWidth: dir === "rtl" ? 0 : 3,
          borderRightWidth: dir === "rtl" ? 3 : 0,
          borderLeftColor: colors.brandPrimary,
          borderRightColor: colors.brandPrimary,
          paddingLeft: dir === "rtl" ? 0 : 12,
          paddingRight: dir === "rtl" ? 12 : 0,
          marginVertical: 4,
          opacity: 0.9,
        },
        link: { color: colors.brandPrimaryLight, textDecorationLine: "underline" },
        list: { marginVertical: 2 },
        li: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, color: textColor, textAlign: align, writingDirection: dir },
        code: {
          fontFamily: MONO,
          fontSize: 13,
          lineHeight: 19,
          backgroundColor: colors.bgInput,
          color: colors.textPrimary,
          padding: 12,
          borderRadius: 10,
          marginVertical: 4,
        },
        codespan: {
          fontFamily: MONO,
          fontSize: 13,
          backgroundColor: colors.bgSurface,
          color: colors.brandAccent,
        },
        table: { borderColor: colors.borderDefault, borderWidth: 1, borderRadius: 8, marginVertical: 4 },
        tableRow: { borderColor: colors.borderSubtle },
        tableCell: { padding: 8 },
      },
    }),
    [renderer, colors, textColor, align, dir, rowDirection],
  );

  const elements = useMarkdown(content, options);

  return (
    <View>
      {elements.map((el, i) => (
        <Fragment key={i}>{el}</Fragment>
      ))}
    </View>
  );
}
