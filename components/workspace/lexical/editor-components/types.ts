// The Lexical editor's public and cross-module contracts — TYPES ONLY, no runtime
// value, so every import of this file is erased at compile time.
//
// Why they live here and not in LexicalDomEditor.tsx: that file carries the
// 'use dom' directive, and babel-preset-expo's use-dom-directive-plugin allows
// such a module exactly ONE export — the default. A named export there is a
// BUNDLE-time failure that renders the writer screen blank, and `tsc` cannot see
// it (scripts/verify-use-dom.mjs is the gate). Native call sites import the two
// public types straight from here.

import type { BlockKind } from "@/stores/insert-menu-store";
import type { RangeOriginal } from "../blockLexical";

// Payload the native Insert menu sends back in: which block to produce (or
// clearSlash = just remove the /query, used before a native structural op).
// Carried by INSERT_BLOCK_COMMAND (./commands) — EditorBridge dispatches it,
// SlashPlugin handles it, so neither has to import the other.
export type InsertBlockPayload = { kind: BlockKind | "clearSlash" };

// The pending AI proposal handed to the editor from the native suggestion store.
export type SuggestionInput = {
  index: number;
  original: string;
  proposed: string;
  status: string;
  instruction: string;
  label: string;
  reasoning: string;
  reasoningMs?: number;
  // action "insertTable": render the proposed grid as a table preview instead of
  // proposed text (SuggestionView branches on proposedRows). Applied via the
  // insertTable op on approve. Absent for a text rewrite / caption.
  action?: string;
  proposedRows?: string[][];
  tableHeader?: boolean;
  tableRtl?: boolean;
  // action "insertSourceImage": a figure copied out of one of the student's uploaded
  // sources — previewed here as a self-contained data: URI; approve inserts the same
  // bytes via the insertImage op (they never enter the WebView). `hasImage` stays true
  // when the bytes were too big to send across the bridge for preview.
  hasImage?: boolean;
  // action "setChart": the PROPOSED chart as SVG source, plus the chart it would
  // replace (the card's peek). Both are a few KB of text across the bridge.
  chartSvg?: string;
  chartOriginalSvg?: string;
  imageDataUri?: string;
  imageWidth?: number;
  imageHeight?: number;
  // Why the ask couldn't be fulfilled (e.g. no matching figure in the attachments) —
  // replaces the generic error line when present.
  errorText?: string;
};

// The pending RANGE proposal (multi-block dynamic rewrite) handed to the editor.
export type RangeSuggestionInput = {
  start: number;
  end: number;
  originalBlocks: RangeOriginal[];
  original: string;
  proposed: string;
  status: string;
  instruction: string;
  reasoning: string;
  reasoningMs?: number;
};

// The serializable command the native bubble/pill sends in. `nonce` bumps per tap.
// Generic (a plain {type,value?} bag) so both the lab bubble's typed commands and
// the workspace pill's `blockFormat` (JSON value) / `direction` flow through it.
// Known types: bold | italic | underline | undo | redo | align | heading | quote |
// list | color | clearFormatting | serialize | direction | blockFormat.
export type LexicalCommand = { type: string; value?: string; nonce: number };

// The active-format snapshot reported back to the native bubble.
export type LexicalState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  blockType: string; // paragraph | h1 | h2 | h3 | quote | bullet | number
  isRTL: boolean;
  alignment: string | null; // left | center | right | justify | null (element format)
  index: number; // position of the focused top-level block (-1 if none)
  text: string; // the focused block's text (for the selection chip / AI targeting)
  // Every top-level block the current selection spans, in document order. Length 1
  // for a caret / in-paragraph selection; >1 for a cross-paragraph drag — lets the
  // native side build a MULTI-block selection instead of collapsing to the anchor.
  // Optional so the lab screens' bare initial-state literals still type-check.
  blocks?: { index: number; text: string }[];
  y?: number; // the block's top in WebView-viewport px (for anchoring the native pill)
  // In-editor HistoryPlugin availability — lets the native undo/redo buttons step
  // Lexical's own history (instant, offline) before falling back to the op queue /
  // server snapshots. Optional so the lab screens' bare literals still type-check.
  canUndo?: boolean;
  canRedo?: boolean;
  // False when the report was NOT produced by the student working in the editor:
  // focus has left the WebView, so whatever the browser left of the DOM selection
  // is an artifact, not a choice. Native uses it to refuse a report that would
  // shrink a multi-block selection — see WorkspaceLexicalView's onState.
  userDriven?: boolean;
};

// Document-search matches to tint (+ which one is current), driven by the search
// store. Consumed by SearchHighlightPlugin.
export type SearchInput = { matches: { blockIndex: number; start: number; end: number }[]; current: number };

// A saved reading position: the top-level block that was at the top of the
// viewport (by DOM child index) + how far it was scrolled past, with a raw pixel
// fallback. Anchoring to a BLOCK (not a pixel) survives figures loading in and
// reflowing the page after a fresh mount — we re-align that block once its images,
// and the ones above it, have laid out. Mirrors `ScrollAnchor` in editor-scroll-store.
export type ScrollAnchor = { y: number; index: number; delta: number };

// Whole-block formatting from the native pill (mirror of the server's
// whole-paragraph `format` op): inline marks to every text child, level via a
// paragraph⇄heading swap, alignment/direction on the element.
export type BlockFmtChange = {
  bold?: boolean; italic?: boolean; underline?: boolean;
  color?: string | null; clearFormatting?: boolean;
  level?: number; alignment?: string; direction?: "rtl" | "ltr";
};
