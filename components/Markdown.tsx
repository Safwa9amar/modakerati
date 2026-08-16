import React, { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  Platform,
  I18nManager,
  ScrollView,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useMarkdown, Renderer, type useMarkdownHookOptions } from "react-native-marked";
import { ChartSvg } from "@/components/ChartSvg";
import { useThemeColors } from "@/hooks/useThemeColors";
import { firstStrongDirection, getTextDirection, isolateBidi, type TextDirection } from "@/lib/text-direction";
import { splitMath } from "@/lib/latex-unicode";
import { chartToSvg, type ChartSpec } from "@/lib/chart-svg";
import type { ThemeColors } from "@/constants/colors";
import { visualRow, LTR_ROW, visualTextAlign } from "@/lib/rtl-layout";
import { parseBlockHref, type BlockLink } from "@/lib/block-links";

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

// Consecutive emoji code points grouped into one run so ZWJ / variation-selector
// sequences (e.g. 👨‍👩‍👧, flags) stay intact.
const EMOJI_RE =
  /([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]+)/u;

// A custom fontFamily (Inter) suppresses iOS's automatic color-emoji fallback on
// the New Architecture — and a nested <Text> INHERITS the family from its
// ancestor, so a heading's Inter_700Bold reaches the emoji run even when that run
// sets no font of its own (⚠️ renders as two tofu boxes). Naming the system font
// explicitly is what restores the fallback.
const EMOJI_FONT: TextStyle = {
  fontFamily: Platform.select({ ios: "System", android: "sans-serif", default: undefined }),
};

// A formula inside a chat message. A serif face is what makes "P=∑ᵢ₌₁ⁿPᵢVᵢ" read as
// maths rather than as prose — the same distinction the document's own equations
// get on native surfaces (DocBlock's `equation` style).
const MATH_FONT: TextStyle = {
  fontFamily: Platform.select({ ios: "Times New Roman", android: "serif", default: undefined }),
  fontSize: 15.5,
};

// `visualRow` and `LTR_ROW` used to live here. They were right, and they were
// the ONLY place in the app that was — so they now live in @/lib/rtl-layout and
// everything else has been moved onto them.

const SEP = StyleSheet.hairlineWidth;
// Below this a column is unreadable, so the table scrolls sideways instead of
// squeezing further. Two- and three-column tables still fit a chat bubble.
const MIN_COL_W = 92;

// A reference to a place in the thesis (`modk://b/11`) is the one link that does
// NOT leave the app: tapping it opens the document there. Marked with a trailing
// arrow so it reads as "go to", and LTR-isolated so the glyph doesn't reorder
// into the middle of an Arabic sentence.
const BLOCK_LINK_MARK = "↗︎"; // ↗ (text presentation — never an emoji)

type Ctx = {
  dir: TextDirection;
  colors: ThemeColors;
  textColor: string;
  onBlockPress?: (link: BlockLink, label: string) => void;
};

const dirStyle = (d: TextDirection): TextStyle => ({
  textAlign: visualTextAlign(d === "rtl"),
  writingDirection: d,
});

/** Flattens an already-rendered node tree back to its text, to read a block's
 *  direction off content the parser has handed us as elements. */
function collectText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (React.isValidElement(node)) return collectText((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * Prepares one inline run: bidi-isolated so a Latin phrase keeps its own
 * brackets/units inside an Arabic line, with emoji broken out into their own
 * <Text> so the system font (and its color-emoji fallback) applies to them.
 *
 * Deliberately sets NO textAlign/writingDirection: those belong to the block
 * root. An inline run that declares its own would fight the line it sits in —
 * on iOS the winner is whichever run's paragraph style lands last, which is what
 * left-aligned single bullets inside otherwise right-aligned Arabic lists.
 */
function inlineRuns(text: string, blockDir: TextDirection): string | ReactNode[] {
  // Maths first: the AI answers about equations in LaTeX, and `$P = \sum_{i=1}^{n}
  // P_i V_i$` is not something a student can read. Rendered as the SAME Unicode
  // linearisation the document's own equations show on this surface, in a serif
  // face and LTR-isolated so a formula reads correctly inside an Arabic sentence.
  const chunks = splitMath(text);
  if (chunks.length > 1 || chunks[0].math) {
    return chunks.flatMap((c, i) =>
      c.math ? (
        <Text key={`m${i}`} style={MATH_FONT}>
          {isolateBidi(c.text, "ltr")}
        </Text>
      ) : (
        // Prose between formulas still needs the emoji/bidi treatment below.
        toRuns(c.text, blockDir, `t${i}`)
      ),
    );
  }
  return toRuns(text, blockDir);
}

/** Bidi-isolate a run and break its emoji out into their own <Text>. */
function toRuns(text: string, blockDir: TextDirection, keyPrefix = ""): string | ReactNode[] {
  const isolated = isolateBidi(text, blockDir);
  if (!EMOJI_RE.test(isolated)) return isolated;
  return isolated
    .split(EMOJI_RE)
    .filter((p) => p !== "")
    .map((p, i) =>
      EMOJI_RE.test(p) ? (
        <Text key={`${keyPrefix}e${i}`} style={EMOJI_FONT}>
          {p}
        </Text>
      ) : (
        p
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bullets and numbers rendered by us rather than by the library's counter list,
 * whose marker side follows the app locale — an Arabic answer in an English UI
 * ended up with its bullets on the wrong (left) edge. The marker column sits on
 * the message's own start side, and the number itself stays LTR ("10." never
 * reorders to ".10").
 */
function MdList({
  ordered,
  items,
  startIndex,
  markerStyle,
  dir,
  color,
}: {
  ordered: boolean;
  items: ReactNode[];
  startIndex: number;
  markerStyle?: TextStyle;
  dir: TextDirection;
  color: string;
}) {
  const rtl = dir === "rtl";
  const marker: TextStyle = {
    fontFamily: ordered ? "Inter_500Medium" : "Inter_400Regular",
    fontSize: markerStyle?.fontSize ?? 14,
    lineHeight: markerStyle?.lineHeight ?? 21,
    color: (markerStyle?.color as string | undefined) ?? color,
    minWidth: ordered ? 20 : 10,
    // Hug the content side so multi-digit markers stay aligned with the text.
    textAlign: rtl ? "left" : "right",
    writingDirection: "ltr",
  };
  return (
    <View style={styles.list}>
      {items.map((node, i) => (
        <View key={i} style={[styles.listItem, { flexDirection: visualRow(rtl) }]}>
          <Text style={marker}>{ordered ? `${startIndex + i}.` : "•"}</Text>
          <View style={styles.listBody}>{node}</View>
        </View>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A cell is its own little block: it aligns by its OWN first strong character —
 * an Arabic label column reads right, a "Times New Roman 12" value column reads
 * left — which is also why the alignment is stamped here rather than left to the
 * inline runs inside.
 */
const cellContent = (nodes: ReactNode[] | undefined, fallback: TextDirection, head: boolean): ReactNode => {
  if (!nodes?.length) return null;
  // The parser hands a cell its inline nodes as SIBLINGS; dropped into the cell
  // View they stack vertically (a bold word landed on its own line). One parent
  // <Text> makes them flow as one line again — and carries the cell's alignment.
  const kids = head
    ? nodes.map((n, i) =>
        React.isValidElement(n)
          ? React.cloneElement(n as React.ReactElement<{ style?: unknown }>, {
              key: i,
              // Header emphasis can't ride on the parent: each run names its own
              // font family, which would win over an inherited one.
              style: [(n as React.ReactElement<{ style?: unknown }>).props.style, styles.tableHeadText],
            })
          : n,
      )
    : nodes;
  return (
    <Text selectable style={dirStyle(firstStrongDirection(collectText(nodes), fallback))}>
      {kids}
    </Text>
  );
};

/**
 * Replaces the library's table, which sized every column at 43% of the WINDOW
 * width inside a horizontal scroller — in a chat bubble that clipped the first
 * column off the edge (and in RTL it clipped the column that matters most).
 *
 * Here the columns share the measured container width and only scroll when they
 * genuinely can't fit; column order is reversed for an RTL table so the first
 * column reads on the right.
 */
function MdTable({
  header,
  rows,
  dir,
  colors,
}: {
  header: ReactNode[][];
  rows: ReactNode[][][];
  dir: TextDirection;
  colors: ThemeColors;
}) {
  const rtl = dir === "rtl";
  const [avail, setAvail] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const pinnedStart = useRef(false);

  const nCols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const gutters = SEP * (nCols - 1) + 2; // column separators + the outer border
  const colW = Math.max(MIN_COL_W, Math.floor((avail - gutters) / nCols));
  const total = colW * nCols + gutters;
  const scrollable = avail > 0 && total > avail + 1;

  // Visual left→right order, so the scroll offsets below mean what they say.
  const order = useMemo(() => {
    const idx = Array.from({ length: nCols }, (_, i) => i);
    return rtl ? idx.reverse() : idx;
  }, [nCols, rtl]);

  const row = (cells: ReactNode[][] | undefined, key: string, isHead: boolean) => (
    <View
      key={key}
      style={[
        { flexDirection: LTR_ROW, borderTopColor: colors.borderDefault },
        isHead ? { backgroundColor: colors.bgSurface } : { borderTopWidth: SEP },
      ]}
    >
      {order.map((ci, pos) => (
        <Fragment key={ci}>
          {pos > 0 ? <View style={{ width: SEP, backgroundColor: colors.borderDefault }} /> : null}
          <View style={[styles.tableCell, { width: colW }]}>{cellContent(cells?.[ci], dir, isHead)}</View>
        </Fragment>
      ))}
    </View>
  );

  return (
    <View style={styles.tableWrap} onLayout={(e) => setAvail(e.nativeEvent.layout.width)}>
      {avail > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          bounces={false}
          scrollEnabled={scrollable}
          showsHorizontalScrollIndicator={scrollable}
          // An RTL table's first column is the RIGHTMOST one, so a scrollable
          // table must open at that edge instead of at x=0.
          onContentSizeChange={() => {
            if (!pinnedStart.current && scrollable && rtl) {
              pinnedStart.current = true;
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
        >
          <View style={[styles.table, { width: total, borderColor: colors.borderDefault }]}>
            {header.length ? row(header, "h", true) : null}
            {rows.map((r, i) => row(r, `r${i}`, false))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Renderer                                                                    */
/* -------------------------------------------------------------------------- */

class MdRenderer extends Renderer {
  ctx: Ctx;

  constructor(ctx: Ctx) {
    super();
    this.ctx = ctx;
  }

  // Fenced ```chart blocks (JSON ChartSpec) render as an inline SVG chart; every
  // other fence is a monospace, always-LTR code card (code is never RTL, even in
  // an Arabic answer).
  code(text: string, language?: string, _containerStyle?: ViewStyle, _textStyle?: TextStyle): ReactNode {
    if ((language || "").trim().toLowerCase() === "chart") {
      try {
        const spec = JSON.parse(text) as ChartSpec;
        const svg = chartToSvg(spec, { width: 320, height: 200 });
        return <ChartSvg key={this.getKey()} xml={svg} style={{ width: "100%", aspectRatio: 320 / 200 }} />;
      } catch {
        // fall through to the code card on bad JSON
      }
    }
    const { colors } = this.ctx;
    return (
      <View
        key={this.getKey()}
        style={[styles.codeCard, { backgroundColor: colors.bgInput, borderColor: colors.borderDefault }]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeCardInner}>
          <Text selectable style={[styles.codeText, { color: colors.textPrimary }]}>
            {text}
          </Text>
        </ScrollView>
      </View>
    );
  }

  // The accent bar is a sibling View, not a border: RN swaps physical
  // left/right styles under an RTL locale, which would put the bar on the wrong
  // side of a quote whose direction differs from the app's.
  blockquote(children: ReactNode[], _styles?: ViewStyle): ReactNode {
    const { colors, dir } = this.ctx;
    return (
      <View key={this.getKey()} style={[styles.quote, { flexDirection: visualRow(dir === "rtl") }]}>
        <View style={[styles.quoteBar, { backgroundColor: colors.brandPrimary }]} />
        <View style={styles.quoteBody}>{children}</View>
      </View>
    );
  }

  // The paragraph is a flex row, so a line shorter than the bubble is placed by
  // the ROW's direction rather than by textAlign — that row has to follow the
  // paragraph's own language too, or a French line inside an Arabic answer hugs
  // the wrong edge.
  paragraph(children: ReactNode[], paraStyle?: ViewStyle): ReactNode {
    const dir = firstStrongDirection(collectText(children), this.ctx.dir);
    return (
      <View key={this.getKey()} style={[paraStyle, { flexDirection: visualRow(dir === "rtl") }]}>
        {children}
      </View>
    );
  }

  // A heading is a block root: it aligns by its OWN first strong character, so a
  // French heading with an Arabic gloss reads left-aligned inside an Arabic
  // answer instead of inheriting the message's side.
  heading(text: string | ReactNode[], headingStyle?: TextStyle): ReactNode {
    const dir = firstStrongDirection(collectText(text), this.ctx.dir);
    return (
      <Text key={this.getKey()} selectable style={[headingStyle, dirStyle(dir)]}>
        {typeof text === "string" ? inlineRuns(text, dir) : text}
      </Text>
    );
  }

  // Link text never reached getTextNode — the base renderer builds its own
  // <Text> — so a linked filename got no bidi isolation and no emoji font.
  link(children: string | ReactNode[], href: string, linkStyle?: TextStyle, title?: string): ReactNode {
    const label = typeof children === "string" ? children : collectText(children);
    const block = parseBlockHref(href);
    if (block) {
      const { onBlockPress, colors } = this.ctx;
      // No handler on this surface (a preview, a screen that can't navigate) →
      // render the words alone. Falling through to the base link would hand
      // `modk://b/11` to Linking.openURL, which fails with a console warning and
      // leaves an underlined dead end in the middle of the sentence.
      if (!onBlockPress) {
        return (
          <Text key={this.getKey()} selectable style={linkStyle}>
            {typeof children === "string" ? inlineRuns(children, this.ctx.dir) : children}
          </Text>
        );
      }
      return (
        <Text
          key={this.getKey()}
          selectable
          accessibilityRole="link"
          accessibilityLabel={label}
          accessibilityHint={title || undefined}
          onPress={() => onBlockPress(block, label)}
          style={[linkStyle, { color: colors.brandPrimaryLight, textDecorationLine: "underline" }]}
        >
          {typeof children === "string" ? inlineRuns(children, this.ctx.dir) : children}
          <Text style={EMOJI_FONT}>{isolateBidi(` ${BLOCK_LINK_MARK}`, "ltr")}</Text>
        </Text>
      );
    }
    return super.link(
      typeof children === "string" ? inlineRuns(children, this.ctx.dir) : children,
      href,
      linkStyle,
      title,
    );
  }

  list(
    ordered: boolean,
    li: ReactNode[],
    _listStyle?: ViewStyle,
    textStyle?: TextStyle,
    startIndex?: number,
  ): ReactNode {
    return (
      <MdList
        key={this.getKey()}
        ordered={ordered}
        items={li}
        startIndex={startIndex ?? 1}
        markerStyle={textStyle}
        dir={this.ctx.dir}
        color={this.ctx.textColor}
      />
    );
  }

  table(
    header: ReactNode[][],
    rows: ReactNode[][][],
    _tableStyle?: ViewStyle,
    _rowStyle?: ViewStyle,
    _cellStyle?: ViewStyle,
  ): ReactNode {
    return <MdTable key={this.getKey()} header={header} rows={rows} dir={this.ctx.dir} colors={this.ctx.colors} />;
  }
}

// getTextNode is private in TS but is the single leaf all text methods funnel
// through; override it at runtime, preserving the exact wrapper structure.
(MdRenderer.prototype as any).getTextNode = function (this: MdRenderer, children: ReactNode, textStyle: TextStyle) {
  if (typeof children === "string") {
    // A code span is quoted verbatim BECAUSE it is quoted: `$x^2$` inside backticks
    // is someone showing the LaTeX, not writing an equation.
    const isCode = (textStyle as TextStyle | undefined)?.fontFamily === MONO;
    return (
      <Text key={this.getKey()} selectable style={textStyle}>
        {isCode ? children : inlineRuns(children, this.ctx.dir)}
      </Text>
    );
  }
  // An array under an EMPTY style is the wrapper the parser builds around a
  // paragraph's / list item's inline nodes — i.e. the block root, which owns the
  // line's alignment. (strong/em/link also arrive as arrays, but always with a
  // style of their own, and must not touch alignment.)
  const isBlockRoot = Array.isArray(children) && (!textStyle || Object.keys(textStyle).length === 0);
  const style = isBlockRoot
    ? [textStyle, dirStyle(firstStrongDirection(collectText(children), this.ctx.dir))]
    : textStyle;
  return (
    <Text key={this.getKey()} selectable style={style}>
      {children}
    </Text>
  );
};

/* -------------------------------------------------------------------------- */
/* Streaming                                                                   */
/* -------------------------------------------------------------------------- */

/** A half-typed fence would swallow the rest of the answer as code — close it
 *  for rendering only, so the block appears as it is being written. */
function closeOpenFence(text: string): string {
  const fences = (text.match(/^[ \t]*```/gm) || []).length;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

/**
 * Splits a streaming answer into the part that is safe to format and the line
 * still being typed.
 *
 * Re-parsing the whole answer per token is O(n²) and janks the list, but merely
 * throttling THAT made the text arrive in visible slabs — the typing was gone.
 * So the two halves are decoupled: everything up to the last newline is markdown
 * (re-parsed at most ~6×/s, and only when a line actually completes), while the
 * unfinished tail after it is plain text that grows with every single token. The
 * reader sees continuous typing, with blocks snapping into shape behind it.
 */
function useStreamedContent(
  content: string,
  streaming?: boolean,
): { body: string; pending: string; tail: string; lineKey: number } {
  const [settled, setSettled] = useState("");
  const lastAt = useRef(0);

  useEffect(() => {
    if (!streaming) {
      setSettled("");
      return;
    }
    // A regenerate swaps the text out from under us — anything that is no longer
    // a prefix of the live content has to be dropped, not diffed.
    if (!content.startsWith(settled)) {
      setSettled("");
      return;
    }
    const complete = content.slice(0, content.lastIndexOf("\n") + 1);
    if (complete.length <= settled.length) return; // nothing new has completed
    const interval = content.length > 8000 ? 400 : 160;
    const wait = Math.max(0, lastAt.current + interval - Date.now());
    const id = setTimeout(() => {
      lastAt.current = Date.now();
      setSettled(complete);
    }, wait);
    return () => clearTimeout(id);
  }, [content, streaming, settled]);

  if (!streaming) return { body: content, pending: "", tail: "", lineKey: 0 };
  const safe = content.startsWith(settled) ? settled : "";
  // Leading blank lines of the tail are block separators the settled half already
  // accounted for — kept, they'd open a gap that closes again a moment later.
  const rest = content.slice(safe.length).replace(/^\n+/, "");
  // Split the unformatted remainder at its last newline. What comes before is
  // FINISHED lines still waiting their turn to be parsed; what comes after is the
  // line being typed right now.
  //
  // The split exists for the fade. Only the leading edge may animate: the
  // finished lines are already on screen at full opacity, and fading them again
  // (which is what animating the whole remainder — or the settled blocks — would
  // do) reads as the answer flickering, not as it arriving.
  const cut = rest.lastIndexOf("\n");
  return {
    body: closeOpenFence(safe),
    pending: cut === -1 ? "" : rest.slice(0, cut + 1),
    tail: cut === -1 ? rest : rest.slice(cut + 1),
    // Where the current line starts in the whole answer. It changes exactly once
    // per completed line, and — crucially — a settle only moves text from `rest`
    // into `body` without touching it, so formatting a block never restarts the
    // fade. This is the identity the leading edge is keyed on.
    lineKey: content.lastIndexOf("\n") + 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Public component                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Renders markdown inside a chat bubble using react-native-marked.
 *
 * We use the `useMarkdown` hook (not the default <Markdown /> component) because
 * the component renders its own FlatList, which can't nest inside the chat's
 * FlatList. The hook returns plain elements we render in a View instead.
 */
export function Markdown({
  content,
  color,
  direction,
  streaming,
  onBlockPress,
}: {
  content: string;
  color?: string;
  direction?: TextDirection;
  streaming?: boolean;
  /**
   * Tap handler for a reference to a place in the thesis (`modk://b/N`). Keep it
   * referentially stable (useCallback) — the renderer is rebuilt when it changes.
   * Omitted on surfaces with nowhere to navigate: the link renders as plain text.
   */
  onBlockPress?: (link: BlockLink, label: string) => void;
}) {
  const colors = useThemeColors();
  const textColor = color ?? colors.textPrimary;
  const { body, pending, tail, lineKey } = useStreamedContent(content, streaming);
  // Direction follows the message's own language, not the app locale, so an
  // Arabic answer stays RTL in an English UI and vice versa.
  const dir = direction ?? getTextDirection(content);
  const rtl = dir === "rtl";
  // Arabic needs more room than Latin at the same nominal size — its letterforms
  // sit smaller and the diacritics need vertical air.
  const fs = rtl ? 15 : 14;
  const lh = rtl ? 26 : 21;
  // The renderer lays each paragraph out as a flex row, so a single text run
  // hugs the row's start — which follows the global I18nManager, not this
  // message. Flip flexDirection so the row's visual direction matches the
  // message regardless of the app locale (the `direction` style isn't honored
  // reliably for nested flex containers here).
  const rowDirection = visualRow(rtl);

  const renderer = useMemo(
    () => new MdRenderer({ dir, colors, textColor, onBlockPress }),
    // A fresh renderer per render pass keeps the internal key slugger in step
    // with the element tree it just produced.
    [body, dir, colors, textColor, onBlockPress],
  );

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
        // No textAlign/writingDirection on the inline styles: every block root
        // (paragraph wrapper, heading, list item, table cell) stamps its own,
        // and a nested run that also declared one would fight it.
        text: { fontSize: fs, fontFamily: "Inter_400Regular", lineHeight: lh, color: textColor },
        strong: { fontFamily: "Inter_700Bold" },
        em: { fontStyle: "italic" },
        paragraph: { marginVertical: 5, flexWrap: "wrap", flexDirection: rowDirection, alignItems: "flex-start", justifyContent: "flex-start" },
        // Headings breathe above and hug what they introduce below; the
        // library's default underline rule is dropped — with `---` rules in the
        // same answer it read as clutter.
        h1: { fontFamily: "Inter_700Bold", fontSize: fs + 7, lineHeight: lh + 10, marginTop: 14, marginBottom: 6, paddingBottom: 0, borderBottomWidth: 0, color: textColor },
        h2: { fontFamily: "Inter_700Bold", fontSize: fs + 5, lineHeight: lh + 8, marginTop: 14, marginBottom: 6, paddingBottom: 0, borderBottomWidth: 0, color: textColor },
        h3: { fontFamily: "Inter_700Bold", fontSize: fs + 3, lineHeight: lh + 6, marginTop: 12, marginBottom: 4, color: textColor },
        h4: { fontFamily: "Inter_600SemiBold", fontSize: fs + 1, lineHeight: lh + 3, marginTop: 10, marginBottom: 3, color: textColor },
        h5: { fontFamily: "Inter_600SemiBold", fontSize: fs, lineHeight: lh + 2, marginTop: 8, marginBottom: 2, color: textColor },
        h6: { fontFamily: "Inter_600SemiBold", fontSize: fs, lineHeight: lh + 2, marginTop: 8, marginBottom: 2, color: colors.textSecondary },
        hr: { backgroundColor: colors.borderDefault, height: StyleSheet.hairlineWidth, borderBottomWidth: 0, marginVertical: 10 },
        link: { color: colors.brandPrimaryLight, textDecorationLine: "underline", fontStyle: "normal" },
        list: { marginVertical: 2 },
        li: { fontSize: fs, fontFamily: "Inter_400Regular", lineHeight: lh, color: textColor },
        codespan: {
          fontFamily: MONO,
          fontSize: fs - 1,
          fontStyle: "normal",
          backgroundColor: colors.bgSurface,
          color: colors.brandAccent,
        },
      },
    }),
    [renderer, colors, textColor, rowDirection, fs, lh],
  );

  const elements = useMarkdown(body, options);

  // Shared by both runs of the unformatted remainder so they set as one block.
  const tailStyle: TextStyle = { fontSize: fs, fontFamily: "Inter_400Regular", lineHeight: lh, color: textColor };
  // Read once for the whole remainder rather than per run: the line being typed
  // can open with punctuation or a digit, and deciding its direction from that
  // alone would swing it away from the direction the lines above it settled on.
  const restDir = firstStrongDirection(pending + tail, dir);

  return (
    <View>
      {elements.map((el, i) => (
        <Fragment key={i}>{el}</Fragment>
      ))}
      {/* The part of the answer that has arrived but isn't formatted yet: raw
          text, repainted on every token, so the answer visibly streams while the
          settled blocks above it are parsed.

          Two runs inside ONE wrapper, and the wrapper owns the margin. Given
          their own vertical margins they would open a gap between the last
          finished line and the one being typed — a gap that closes again the
          moment the pair is parsed into a single paragraph. Stacked bare inside
          the wrapper they read as consecutive lines of one block, which is what
          they are. Direction is taken from the whole remainder, so a line does
          not flip as its first strong character arrives. */}
      {pending || tail ? (
        <View style={styles.streamTail}>
          {pending ? (
            <Text selectable style={[tailStyle, dirStyle(restDir)]}>
              {/* The trailing newline is the separator from the line below, which
                  is a sibling element — printed, it would open a blank line. */}
              {pending.replace(/\n$/, "")}
            </Text>
          ) : null}
          {tail ? (
            // The leading edge, and the only thing that animates. Remounting on
            // `lineKey` is what makes each new line fade up as it begins instead
            // of snapping in — and because the key only moves when a line ends,
            // the fade starts when the line is a character or two long, never
            // over text the reader is already looking at.
            <Animated.View key={lineKey} entering={FadeIn.duration(260)}>
              <Text selectable style={[tailStyle, dirStyle(restDir)]}>
                {tail}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The margin lives here, not on the runs inside — see the comment at the call site.
  streamTail: { marginVertical: 5 },
  list: { marginVertical: 2 },
  listItem: { alignItems: "flex-start", gap: 8, marginBottom: 2 },
  listBody: { flex: 1 },
  quote: { marginVertical: 6, gap: 10, alignItems: "stretch" },
  quoteBar: { width: 3, borderRadius: 2 },
  quoteBody: { flex: 1, opacity: 0.92 },
  codeCard: { marginVertical: 6, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  codeCardInner: { padding: 12 },
  codeText: { fontFamily: MONO, fontSize: 12.5, lineHeight: 19, textAlign: "left", writingDirection: "ltr" },
  tableWrap: { marginVertical: 8, width: "100%" },
  table: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  tableCell: { paddingHorizontal: 10, paddingVertical: 8, justifyContent: "center" },
  tableHeadText: { fontFamily: "Inter_600SemiBold" },
});
