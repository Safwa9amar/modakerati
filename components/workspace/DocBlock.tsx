import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  Platform,
  TextInput,
  type TextStyle,
  type GestureResponderEvent,
} from "react-native";
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthHeader } from "@/hooks/useAuthHeader";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { thesisBlockImageUrl, type DocBlockDTO } from "@/lib/api";
import { hSelection, hMedium } from "@/lib/haptics";

// Dark ink / muted ink for text rendered on the always-white PaperPage.
const INK = "#1A1A1A";
const MUTED = "#8A8A8A";
const BORDER = "#D8D8DE";

// Heading level → text style. Level 0 is justified body; 1 is the largest.
const HEADING_SIZE: Record<1 | 2 | 3 | 4, number> = { 1: 22, 2: 19, 3: 16, 4: 14 };

// Fixed on-white ink for text on the always-white paper — shared with the
// inline suggestion so its proposed text renders as document, not UI.
export const PARAGRAPH_INK = INK;

// The exact Text style DocBlock uses for a paragraph of this heading level
// (level 0 = body). The inline suggestion renders the proposed text with this
// so it reads as the document.
export function paragraphTextStyle(level: number): TextStyle {
  return level >= 1
    ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(level, 4) as 1 | 2 | 3 | 4] }
    : styles.body;
}

// One visible run of a paragraph with its inline character formatting, as emitted
// by the server DTO. Read defensively off the block (the shared `lib/api.ts`
// DocBlockDTO doesn't declare it) so the read path can render marks.
type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };

// A run's inline color is honoured on the always-white paper only when it stays
// legible — a near-white color would vanish, so we drop it and keep the default
// ink. Accepts the OOXML 6-hex with or without a leading '#'.
function legibleColor(hex?: string): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) return undefined;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255; // perceived luminance 0..1
  return lum > 0.82 ? undefined : `#${h.toUpperCase()}`;
}

// Per-run text style for a span. Named Google fonts ignore `fontWeight`, so bold
// swaps to the bold family (fontWeight kept as a harmless fallback); italic is
// best-effort (no italic Inter is loaded → faux/synthesised where the platform
// allows). Only the marks present on the run are applied — everything else is
// inherited from the parent paragraph <Text>.
function runTextStyle(run: Run): TextStyle {
  const s: TextStyle = {};
  if (run.bold) {
    s.fontFamily = "Inter_700Bold";
    s.fontWeight = "700";
  }
  if (run.italic) s.fontStyle = "italic";
  if (run.underline) s.textDecorationLine = "underline";
  const col = legibleColor(run.color);
  if (col) s.color = col;
  return s;
}

// Cap an inlined image's rendered height so a tall chart can't dominate the page.
const MAX_IMAGE_HEIGHT = 360;

/**
 * Renders one live-.docx block (read-only). Paragraphs/tables are tappable and
 * select themselves by their engine block `index` (so L2 chat can target them);
 * images render as a light figure placeholder and `other` blocks render nothing.
 *
 * Text direction is detected per block from its own content (so mixed-language
 * theses render correctly); `rtl` (the thesis language) is only the fallback
 * for blocks with no strong-directional character.
 */
function DocBlockInner({
  block,
  rtl,
  thesisId,
  version,
  onLongPressDrag,
}: {
  block: DocBlockDTO;
  rtl: boolean;
  // Needed to lazily load large figures from the media endpoint (bytes not inlined
  // in the block DTO). `version` busts the image cache after an edit.
  thesisId: string;
  version?: number;
  // Long-press a block to lift it for drag-reorder (replaces the visible grip
  // handle). When provided it supersedes the long-press multi-select.
  onLongPressDrag?: () => void;
}) {
  const colors = useThemeColors();
  // Membership test against the multi-selection set — a boolean primitive, so this
  // selector is stable for zustand's Object.is comparison (no fresh-object loop).
  const isSelected = useWorkspaceStore((s) => s.selectedBlocks.some((b) => b.index === block.index));
  // Colocated with isSelected (not inside the paragraph branch below) so this hook
  // still runs unconditionally across the other/image/table early returns.
  const isEditing = useWorkspaceStore((s) => s.editingBlockIndex === block.index);
  // True right after this block's suggestion was approved — plays a one-shot
  // green settle flash on the (freshly patched) paragraph text below.
  const justApplied = useSuggestionStore((s) => s.justApplied === block.index);
  const hi = colors.brandPrimary;

  if (block.kind === "other") {
    // Structural / unsupported top-level block (e.g. a content control `<w:sdt>`
    // wrapping an appendix or TOC section). Rendering nothing here made a run of
    // these read as "document ended" — trailing sections (appendices) vanished
    // from the outline while the docx/PDF preview still showed them. Render a
    // visible marker: the server's best-effort text preview when present (so the
    // appendix heading + content stays legible), else a subtle divider. Non-
    // interactive — these aren't editable paragraphs, so no select/edit/drag.
    const otherText = (block as { text?: string }).text?.trim();
    if (otherText) {
      const oDir = detectDir(otherText, rtl);
      return (
        <View style={styles.otherBlock}>
          <Text
            style={[
              styles.otherText,
              { textAlign: oDir === "rtl" ? "right" : "left", writingDirection: oDir },
            ]}
          >
            {otherText}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.otherDivider}>
        <View style={styles.otherDividerLine} />
        <Text style={styles.otherDividerText}>⋯</Text>
        <View style={styles.otherDividerLine} />
      </View>
    );
  }

  if (block.kind === "image") {
    // Caption sits under the image/placeholder; it aligns to the text edge in RTL.
    const caption = block.caption?.trim();
    const captionNode = caption ? (
      <Text
        style={[
          styles.figureCaption,
          { textAlign: "center", writingDirection: detectDir(caption, rtl) },
        ]}
        numberOfLines={3}
      >
        {caption}
      </Text>
    ) : null;

    const figText = caption || "figure";
    const onSelect = (e: GestureResponderEvent) => pickBlock(block.index, figText, e.nativeEvent.pageY);
    const onLong = onLongPressDrag ?? (() => longPickBlock(block.index, figText));
    const ratio =
      block.width && block.height && block.height > 0 ? block.width / block.height : undefined;

    // Prefer the inlined bytes (small charts, instant). Otherwise, if the server
    // reports real bytes exist (`hasMedia`), load them on demand from the media
    // endpoint so large figures render here too — matching the docx/OnlyOffice
    // views. Only a genuine no-image drawing falls through to the placeholder.
    const uri =
      block.dataUri ??
      (block.hasMedia ? thesisBlockImageUrl(thesisId, block.index, version) : undefined);
    if (uri) {
      return (
        <FigureImage
          uri={uri}
          // dataUri is self-contained; the media endpoint needs the Bearer token.
          needsAuth={!block.dataUri}
          ratio={ratio}
          isSelected={isSelected}
          hi={hi}
          onSelect={onSelect}
          onLong={onLong}
          captionNode={captionNode}
        />
      );
    }

    // No resolvable image bytes → keep the light placeholder.
    return (
      <FigurePlaceholder
        isSelected={isSelected}
        hi={hi}
        onSelect={onSelect}
        onLong={onLong}
        captionNode={captionNode}
      />
    );
  }

  if (block.kind === "table") {
    return (
      <Pressable
        onPress={(e) => pickBlock(block.index, tableToText(block.rows), e.nativeEvent.pageY)}
        onLongPress={onLongPressDrag ?? (() => longPickBlock(block.index, tableToText(block.rows)))}
        style={[
          styles.tableWrap,
          { borderColor: isSelected ? hi : BORDER },
          isSelected && { backgroundColor: hi + "18" },
        ]}
      >
        {block.rows.map((row, r) => (
          <View
            key={r}
            style={[
              styles.tableRow,
              { borderBottomColor: BORDER },
              r === block.rows.length - 1 && styles.tableRowLast,
            ]}
          >
            {row.map((cell, c) => (
              <View
                key={c}
                style={[
                  styles.tableCell,
                  { borderRightColor: BORDER },
                  c === row.length - 1 && styles.tableCellLast,
                ]}
              >
                <Text
                  style={[styles.tableCellText, dirStyle(cell, rtl)]}
                >
                  {cell}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </Pressable>
    );
  }

  // paragraph
  const isHeading = block.level >= 1;
  const empty = !block.text.trim();
  // Per-run inline formatting (bold/italic/underline/color) from the server, READ
  // path only. Render run spans when the paragraph actually carries formatting;
  // otherwise the flat `block.text` renders identically (and stays the source of
  // truth for inline editing). The DTO guarantees the runs' text reconstructs
  // `block.text`, so swapping in spans never drops content.
  const runs = (block as { runs?: Run[] }).runs;
  const useRuns =
    !empty &&
    Array.isArray(runs) &&
    runs.length > 0 &&
    (runs.length > 1 || runs.some((r) => r.bold || r.italic || r.underline || r.color));
  // Base direction from this paragraph's own script, not the thesis flag, so
  // French/English text never renders RTL (and Arabic never renders LTR).
  // An explicit paragraph direction (w:bidi, set via the Edit tools) wins;
  // otherwise fall back to auto-detecting from the text's script.
  const dir = block.direction ?? detectDir(block.text, rtl);
  const align = dir === "rtl" ? "right" : "left";
  // Explicit paragraph alignment (w:jc) wins; otherwise fall back to the
  // direction-based default (headings) / justified body. Without this the native
  // render ignores the paragraph's real alignment, so the Edit tools look broken.
  const jcAlign =
    block.alignment === "center"
      ? "center"
      : block.alignment === "left"
        ? "left"
        : block.alignment === "right"
          ? "right"
          : block.alignment === "both"
            ? "justify"
            : null;
  const textAlign = (jcAlign ?? (isHeading ? align : "justify")) as
    | "left"
    | "right"
    | "center"
    | "justify";
  // Android/Fabric silently drops `textAlign: "justify"` for RTL text — Arabic body
  // paragraphs fall back to a ragged right edge while iOS justifies fine. Two
  // Android-only levers make the inter-word justification actually apply:
  //   1. `textBreakStrategy: "simple"` — the default high-quality line optimizer
  //      suppresses justification; the greedy strategy lets it through.
  //   2. omit `writingDirection` — pinning it to "rtl" disables justify on Fabric;
  //      dropping it lets Android's first-strong bidi derive RTL from the Arabic
  //      content, which keeps justify enabled. iOS and non-justified blocks keep the
  //      explicit direction (needed for correct bidi on mixed-script lines).
  const androidJustify = Platform.OS === "android" && textAlign === "justify";
  // While editing, the paragraph is JUST the TextInput — NOT wrapped in a Pressable
  // with an onPress. On the New Architecture that ancestor press-handler swallows the
  // tap you make to move the caret inside the field (so the caret can't land on the
  // word you pressed) AND blurs the input on that tap — which fires onBlur →
  // setEditingBlock(null), so the caret "shows once then hides". With no wrapping
  // press-handler the TextInput owns every touch: tapping a word places the caret
  // there natively, and staying inside the field never kicks you out.
  if (isEditing) {
    return (
      <View style={styles.paraWrap}>
        <EditableParagraph
          block={block}
          rtl={rtl}
          thesisId={thesisId}
          textStyle={
            isHeading
              ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(block.level, 4) as 1 | 2 | 3 | 4] }
              : styles.body
          }
          textAlign={textAlign}
        />
      </View>
    );
  }

  return (
    <Pressable
      onPress={(e) => enterOrSelect(block.index, block.text, e.nativeEvent.pageY)}
      onLongPress={onLongPressDrag ?? (() => longPickBlock(block.index, block.text))}
      // No selection box on paragraphs — the caret (while editing) or the floating
      // pill (when the keyboard is dismissed) is the selection indicator.
      style={styles.paraWrap}
    >
      <SettleFlash active={justApplied}>
        <Text
          {...(androidJustify ? { textBreakStrategy: "simple" as const } : null)}
          style={[
            isHeading
              ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(block.level, 4) as 1 | 2 | 3 | 4] }
              : styles.body,
            {
              textAlign,
              ...(androidJustify ? null : { writingDirection: dir }),
            },
            empty && styles.emptyPara,
          ]}
        >
          {empty
            ? "·"
            : useRuns && runs
              ? runs.map((r, i) => (
                  <Text key={i} style={runTextStyle(r)}>
                    {r.text}
                  </Text>
                ))
              : block.text}
        </Text>
      </SettleFlash>
    </Pressable>
  );
}

// Memoized: each block re-renders only when its own props (block/rtl/version/…) or
// its per-block store selectors (isSelected / isEditing / justApplied) change — so
// entering edit mode on one paragraph doesn't reconcile every other visible block.
export const DocBlock = React.memo(DocBlockInner);

// The paragraph body when it's being edited inline (outline view): a multiline
// TextInput seeded ONCE from the block text, committing live (debounced) + on blur
// via the editText op. Enter splits, Backspace-at-start merges. Local state owns
// the value so store/prop re-syncs can't reset the caret mid-edit.
function EditableParagraph({
  block,
  rtl,
  thesisId,
  textStyle,
  textAlign,
}: {
  block: Extract<DocBlockDTO, { kind: "paragraph" }>;
  rtl: boolean;
  thesisId: string;
  textStyle: TextStyle;
  textAlign: "left" | "right" | "center" | "justify";
}) {
  const isGenerating = useChatStore((s) => s.isGenerating);
  const dir = block.direction ?? detectDir(block.text, rtl);

  const [value, setValue] = useState(block.text);
  const baselineRef = useRef(block.text);
  const selRef = useRef({ start: block.text.length, end: block.text.length });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handedOffRef = useRef(false); // true once editing was handed to a sibling (split/merge)
  const inputRef = useRef<TextInput>(null);

  // Focus backstop: `autoFocus` fires as part of the mount commit, so if this block
  // ever mounts during a heavier render the keyboard can lag. Explicitly focus on
  // the next frame — but ONLY if autoFocus hasn't already taken. Re-calling focus()
  // on an already-focused field can emit a transient blur on some New-Arch builds,
  // which would fire onBlur → exit edit mode; the isFocused() guard avoids that.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!inputRef.current?.isFocused?.()) inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const pending = useWorkspaceStore.getState().pendingCaret;
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(
    pending?.index === block.index ? { start: pending.pos, end: pending.pos } : undefined,
  );
  useEffect(() => {
    const pc = useWorkspaceStore.getState().pendingCaret;
    if (pc?.index === block.index) {
      setSelection({ start: pc.pos, end: pc.pos });
      useWorkspaceStore.getState().clearPendingCaret();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (text: string) => {
    if (handedOffRef.current) return; // editing moved to a sibling — the split/merge ops own this block's text
    if (text === baselineRef.current) return;
    baselineRef.current = text;
    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index: block.index, text });
  };
  const scheduleCommit = (text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      commit(text);
    }, 900);
  };

  const doSplit = (before: string, after: string) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    baselineRef.current = before;
    setValue(before);
    void useThesisDocStore.getState().mutate(thesisId, {
      type: "splitParagraph", index: block.index, before, after,
    });
    handedOffRef.current = true;
    useWorkspaceStore.getState().setEditingBlock(block.index + 1, 0);
  };

  const onChangeText = (next: string) => {
    if (next.includes("\n") && !value.includes("\n")) {
      const nl = next.indexOf("\n");
      doSplit(next.slice(0, nl), next.slice(nl + 1));
      return;
    }
    setValue(next);
    scheduleCommit(next);
  };

  const onKeyPress = (e: { nativeEvent: { key: string } }) => {
    if (e.nativeEvent.key !== "Backspace") return;
    if (selRef.current.start !== 0 || selRef.current.end !== 0) return;
    if (block.index === 0) return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const store = useThesisDocStore.getState();
    const doc = store.byId[thesisId];
    const prev = doc?.available ? doc.blocks.find((b) => b.index === block.index - 1) : undefined;
    if (!prev || prev.kind !== "paragraph") return;
    const prevText = prev.text;
    const merged = prevText + value;
    baselineRef.current = value;
    void store.mutate(thesisId, { type: "editText", index: block.index - 1, text: merged });
    void store.mutate(thesisId, { type: "deleteBlocks", indices: [block.index] });
    handedOffRef.current = true;
    useWorkspaceStore.getState().setEditingBlock(block.index - 1, prevText.length);
  };

  const onBlur = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    commit(value);
    const ws = useWorkspaceStore.getState();
    // Only act if THIS block is still the one being edited — tapping straight into
    // another block already moved editing there; don't clobber it.
    if (ws.editingBlockIndex !== block.index) return;
    // Dismiss the keyboard → leave editing but KEEP the block selected, so its
    // floating pill (formatting + ✦ Ask AI) appears. Tapping the block again brings
    // the keyboard + docked toolbar back — a smart switch between the two forms.
    ws.setEditingBlock(null);
  };

  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      onKeyPress={onKeyPress}
      onSelectionChange={(e) => {
        selRef.current = e.nativeEvent.selection;
        // Release the controlled selection after its first report so the user
        // regains free caret control (a permanently-controlled `selection` pins
        // the caret at the split/merge hand-off offset).
        if (selection !== undefined) setSelection(undefined);
      }}
      onBlur={onBlur}
      selection={selection}
      autoFocus
      multiline
      editable={!isGenerating}
      scrollEnabled={false}
      textAlignVertical="top"
      style={[
        textStyle,
        { textAlign, padding: 0, ...(Platform.OS === "android" ? null : { writingDirection: dir }) },
      ]}
    />
  );
}

// A figure rendered from its bytes. When `needsAuth` the bytes come from the
// authed media endpoint (Bearer header resolved once); until that header is ready,
// or if the load fails, we show the placeholder so the row never renders blank.
function FigureImage({
  uri,
  needsAuth,
  ratio,
  isSelected,
  hi,
  onSelect,
  onLong,
  captionNode,
}: {
  uri: string;
  needsAuth: boolean;
  ratio?: number;
  isSelected: boolean;
  hi: string;
  onSelect: (e: GestureResponderEvent) => void;
  onLong: () => void;
  captionNode: React.ReactNode;
}) {
  const authHeader = useAuthHeader();
  // Track WHICH uri failed (not a bare boolean): a freshly-inserted image first
  // renders from its optimistic base64 `data:` URI, then reconciles to the media-
  // endpoint URL (large photos lose the inlined `dataUri` past the size cap). If
  // the big base64 fails to decode on-device — or the media load hiccups once — a
  // sticky boolean would latch the placeholder forever even after `uri` changes to
  // a loadable one. Keying the failure to the uri clears it the moment uri changes.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = failedUri === uri;

  // Wait for the token before hitting the media endpoint (an unauthed request
  // would 401 and needlessly flip us to the placeholder); show the placeholder on
  // any load failure (404 for a genuinely image-less drawing, network, etc.).
  if (failed || (needsAuth && !authHeader)) {
    return (
      <FigurePlaceholder
        isSelected={isSelected}
        hi={hi}
        onSelect={onSelect}
        onLong={onLong}
        captionNode={captionNode}
      />
    );
  }

  return (
    <Pressable
      onPress={onSelect}
      onLongPress={onLong}
      style={[
        styles.imageWrap,
        { borderColor: isSelected ? hi : "transparent" },
        isSelected && { backgroundColor: hi + "18" },
      ]}
    >
      <Image
        source={needsAuth && authHeader ? { uri, headers: authHeader } : { uri }}
        resizeMode="contain"
        onError={() => setFailedUri(uri)}
        style={[
          styles.image,
          ratio ? { aspectRatio: ratio, maxHeight: MAX_IMAGE_HEIGHT } : { height: MAX_IMAGE_HEIGHT },
        ]}
      />
      {captionNode}
    </Pressable>
  );
}

// The dashed "figure" card: a drawing block with no resolvable image, or a figure
// still resolving / failed to load.
function FigurePlaceholder({
  isSelected,
  hi,
  onSelect,
  onLong,
  captionNode,
}: {
  isSelected: boolean;
  hi: string;
  onSelect: (e: GestureResponderEvent) => void;
  onLong: () => void;
  captionNode: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onSelect}
      onLongPress={onLong}
      style={[
        styles.figureCard,
        { borderColor: isSelected ? hi : BORDER },
        isSelected && { backgroundColor: hi + "18" },
      ]}
    >
      <Text style={styles.figureText}>🖼 figure</Text>
      {captionNode}
    </Pressable>
  );
}

// Flatten a table grid to a single string for the selection chip / L2 targeting.
function tableToText(rows: string[][]): string {
  return rows.map((r) => r.join(" | ")).join("\n");
}

// Tap: in multi-select mode toggle this block in/out of the set; otherwise it's a
// single-select (replace). Read mode at press time via getState() so the press
// handlers don't need to subscribe.
function pickBlock(index: number, text: string, pageY?: number): void {
  hSelection();
  const ws = useWorkspaceStore.getState();
  if (ws.multiSelect) ws.toggleBlock(index, text);
  else {
    ws.selectBlock(index, text);
    if (pageY != null) useFloatingPillStore.getState().setAnchorY(pageY);
  }
}

// Long-press: enter multi-select mode and add this block (keeping any current one).
function longPickBlock(index: number, text: string): void {
  hMedium();
  useWorkspaceStore.getState().addToSelection(index, text);
}

// Tap a paragraph → go STRAIGHT to inline editing: caret in the block, keyboard
// up, the docked toolbar — no intermediate selection-box state. (Select it too so
// the toolbar / ✦ Ask AI target this block.) Multi-select mode still just toggles
// membership; during an AI turn we only select (don't open the editor).
function enterOrSelect(index: number, text: string, pageY?: number): void {
  const ws = useWorkspaceStore.getState();
  if (ws.multiSelect) {
    ws.toggleBlock(index, text);
    return;
  }
  ws.selectBlock(index, text);
  if (pageY != null) useFloatingPillStore.getState().setAnchorY(pageY);
  if (!useChatStore.getState().isGenerating) ws.setEditingBlock(index);
}

// RTL scripts: Hebrew, Arabic (+ supplements), Syriac, Thaana, Arabic presentation forms.
const RTL_CHAR = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏɐ-ʯ]/;

/**
 * Base text direction from the first strong-directional character (the Unicode
 * bidi heuristic browsers use for `dir="auto"`). Falls back to the thesis
 * default when the text has no strong character (digits/punctuation only).
 */
export function detectDir(text: string, fallbackRtl: boolean): "rtl" | "ltr" {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return "rtl";
    if (LTR_CHAR.test(ch)) return "ltr";
  }
  return fallbackRtl ? "rtl" : "ltr";
}

function dirStyle(text: string, fallbackRtl: boolean) {
  const dir = detectDir(text, fallbackRtl);
  return { textAlign: dir === "rtl" ? "right" : "left", writingDirection: dir } as const;
}

// One-shot green settle flash behind a freshly-approved paragraph: "the new
// text became the document". Clears the store marker when done (or instantly
// under reduce-motion).
function SettleFlash({ active, children }: { active: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (!active) return;
    const clear = () => useSuggestionStore.getState().clearApplied();
    if (reduce) {
      clear();
      return;
    }
    v.value = 1;
    v.value = withDelay(
      150,
      withTiming(0, { duration: 600 }, (finished) => {
        if (finished) runOnJS(clear)();
      }),
    );
    // Cleanup guarantees the marker clears even if the row unmounts mid-flash
    // (virtualized list) and the UI-thread completion callback never fires.
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const st = useAnimatedStyle(() => ({
    borderRadius: 6,
    backgroundColor: interpolateColor(v.value, [0, 1], ["rgba(34,192,122,0)", "rgba(34,192,122,0.22)"]),
  }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  paraWrap: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginVertical: 2,
  },
  heading: {
    color: INK,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  body: {
    color: INK,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  emptyPara: { color: MUTED },

  // Structural/embedded (`other`) block with a text preview — a muted card set
  // slightly apart from body paragraphs so it reads as embedded content, not a
  // regular editable paragraph.
  otherBlock: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 4,
    backgroundColor: "#F5F5F8",
  },
  otherText: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  // Text-less structural block (bookmark, empty content control): a thin divider
  // so a run of them signals "content continues", never "document ended".
  otherDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 8,
    paddingHorizontal: 4,
  },
  otherDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
  otherDividerText: { color: MUTED, fontSize: 12, paddingHorizontal: 8 },

  figureCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingVertical: 22,
    marginVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAFC",
  },
  figureText: { color: MUTED, fontSize: 14, fontFamily: "Inter_500Medium" },
  figureCaption: {
    color: MUTED,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    alignSelf: "stretch",
  },

  imageWrap: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 6,
    paddingVertical: 8,
    marginVertical: 8,
    alignItems: "center",
  },
  // width:100% fits the paper content area; aspectRatio (set inline) keeps shape.
  image: { width: "100%", borderRadius: 4 },

  tableWrap: {
    borderWidth: 1,
    borderRadius: 6,
    marginVertical: 8,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tableRowLast: { borderBottomWidth: 0 },
  tableCell: {
    flex: 1,
    minWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableCellLast: { borderRightWidth: 0 },
  tableCellText: { color: INK, fontSize: 12, fontFamily: "Inter_400Regular" },
});
