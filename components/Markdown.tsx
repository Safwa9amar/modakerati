import { Fragment, useMemo, type ReactNode } from "react";
import { View, Text, Platform, type TextStyle } from "react-native";
import { useMarkdown, Renderer, type useMarkdownHookOptions } from "react-native-marked";
import { useThemeColors } from "@/hooks/useThemeColors";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

/**
 * Emoji don't cascade to the system color-emoji font when a custom `fontFamily`
 * (Inter) is applied on RN's Fabric text engine, so they render as tofu boxes.
 * We split emoji into their own <Text> runs with an explicit emoji-capable font,
 * which overrides the inherited Inter and lets them render.
 */
const EMOJI_FONT = Platform.OS === "ios" ? "Apple Color Emoji" : "sans-serif";
// Consecutive emoji code points grouped into one run so ZWJ / variation-selector
// sequences (e.g. 👨‍👩‍👧, flags) stay intact.
const EMOJI_RE =
  /([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]+)/u;

class EmojiRenderer extends Renderer {}
// getTextNode is private in TS but is the single leaf all text methods funnel
// through; override it at runtime, preserving the exact wrapper structure.
(EmojiRenderer.prototype as any).getTextNode = function (children: ReactNode, styles: TextStyle) {
  if (typeof children === "string" && EMOJI_RE.test(children)) {
    const parts = children.split(EMOJI_RE).filter((p) => p !== "");
    return (
      <Text key={this.getKey()} selectable style={styles}>
        {parts.map((p, i) =>
          EMOJI_RE.test(p) ? (
            <Text key={i} style={{ fontFamily: EMOJI_FONT }}>
              {p}
            </Text>
          ) : (
            p
          ),
        )}
      </Text>
    );
  }
  return (
    <Text key={this.getKey()} selectable style={styles}>
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
export function Markdown({ content, color }: { content: string; color?: string }) {
  const colors = useThemeColors();
  const textColor = color ?? colors.textPrimary;

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
        text: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, color: textColor },
        strong: { fontFamily: "Inter_700Bold" },
        em: { fontStyle: "italic" },
        paragraph: { marginVertical: 4, flexWrap: "wrap", flexDirection: "row", alignItems: "flex-start" },
        h1: { fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 26, marginVertical: 4, color: textColor },
        h2: { fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 24, marginVertical: 4, color: textColor },
        h3: { fontFamily: "Inter_700Bold", fontSize: 16, lineHeight: 22, marginVertical: 4, color: textColor },
        h4: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21, marginVertical: 2, color: textColor },
        h5: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21, marginVertical: 2, color: textColor },
        h6: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20, marginVertical: 2, color: textColor },
        hr: { backgroundColor: colors.borderDefault, height: 1, marginVertical: 8 },
        blockquote: {
          borderLeftWidth: 3,
          borderLeftColor: colors.brandPrimary,
          paddingLeft: 12,
          marginVertical: 4,
          opacity: 0.9,
        },
        link: { color: colors.brandPrimaryLight, textDecorationLine: "underline" },
        list: { marginVertical: 2 },
        li: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, color: textColor },
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
    [renderer, colors, textColor],
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
