import React, { useState } from "react";
import { View, Text, Pressable, Image, StyleSheet, Platform } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthHeader } from "@/hooks/useAuthHeader";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { thesisBlockImageUrl, type DocBlockDTO } from "@/lib/api";

// Dark ink / muted ink for text rendered on the always-white PaperPage.
const INK = "#1A1A1A";
const MUTED = "#8A8A8A";
const BORDER = "#D8D8DE";

// Heading level → text style. Level 0 is justified body; 1 is the largest.
const HEADING_SIZE: Record<1 | 2 | 3 | 4, number> = { 1: 22, 2: 19, 3: 16, 4: 14 };

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
export function DocBlock({
  block,
  rtl,
  thesisId,
  version,
}: {
  block: DocBlockDTO;
  rtl: boolean;
  // Needed to lazily load large figures from the media endpoint (bytes not inlined
  // in the block DTO). `version` busts the image cache after an edit.
  thesisId: string;
  version?: number;
}) {
  const colors = useThemeColors();
  // Membership test against the multi-selection set — a boolean primitive, so this
  // selector is stable for zustand's Object.is comparison (no fresh-object loop).
  const isSelected = useWorkspaceStore((s) => s.selectedBlocks.some((b) => b.index === block.index));
  const hi = colors.brandPrimary;

  if (block.kind === "other") {
    // Structural/unsupported block — render nothing (a tiny marker is noise).
    return null;
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
    const onSelect = () => pickBlock(block.index, figText);
    const onLong = () => longPickBlock(block.index, figText);
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
        onPress={() => pickBlock(block.index, tableToText(block.rows))}
        onLongPress={() => longPickBlock(block.index, tableToText(block.rows))}
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
  return (
    <Pressable
      onPress={() => pickBlock(block.index, block.text)}
      onLongPress={() => longPickBlock(block.index, block.text)}
      style={[
        styles.paraWrap,
        isSelected && { backgroundColor: hi + "18", borderColor: hi },
      ]}
    >
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
        {empty ? "·" : block.text}
      </Text>
    </Pressable>
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
  onSelect: () => void;
  onLong: () => void;
  captionNode: React.ReactNode;
}) {
  const authHeader = useAuthHeader();
  const [failed, setFailed] = useState(false);

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
        onError={() => setFailed(true)}
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
  onSelect: () => void;
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
function pickBlock(index: number, text: string): void {
  const ws = useWorkspaceStore.getState();
  if (ws.multiSelect) ws.toggleBlock(index, text);
  else ws.selectBlock(index, text);
}

// Long-press: enter multi-select mode and add this block (keeping any current one).
function longPickBlock(index: number, text: string): void {
  useWorkspaceStore.getState().addToSelection(index, text);
}

// RTL scripts: Hebrew, Arabic (+ supplements), Syriac, Thaana, Arabic presentation forms.
const RTL_CHAR = /[֐-׿؀-ۿ܀-ݏݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏɐ-ʯ]/;

/**
 * Base text direction from the first strong-directional character (the Unicode
 * bidi heuristic browsers use for `dir="auto"`). Falls back to the thesis
 * default when the text has no strong character (digits/punctuation only).
 */
function detectDir(text: string, fallbackRtl: boolean): "rtl" | "ltr" {
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
