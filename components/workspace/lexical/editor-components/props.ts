// The full prop contract of the DOM editor. TYPE-ONLY — see ./types for why the
// 'use dom' module cannot hold it.
//
// Expo DOM components take SERIALIZABLE props plus top-level async function props
// (the web → native direction). Everything below honours that: no class instances,
// no React elements, no non-top-level callbacks.

import type { DocBlockDTO } from "@/lib/api";
import type { AnchorSectionGeometry } from "@/lib/page-layout";
import type {
  ChromeData,
  ChromeKind,
  TableAILabels,
  TableProposalData,
  WorkingLabels,
} from "../blockLexical";
// type-only — WorkspaceLexicalView is the native ('use dom' host) module; importing
// just the type is erased at compile time, same contract as ChromeData above.
import type { PageSetup } from "../../WorkspaceLexicalView";
import type {
  LexicalCommand,
  LexicalState,
  RangeSuggestionInput,
  ScrollAnchor,
  SearchInput,
  SuggestionInput,
} from "./types";

export type LexicalDomEditorProps = {
  command?: LexicalCommand | null;
  onState: (s: LexicalState) => void;
  // Serialized blocks emitted in response to a `serialize` command (round-trip test).
  onBlocks?: (blocks: DocBlockDTO[]) => void;
  // A tapped equation, as JSON: { index, math }. Opens the native equation sheet —
  // an equation is not text, so this is the only gesture that can reach one.
  onEquationTap?: (payload: string) => void;
  // When provided, the editor is seeded FROM these blocks instead of the demo text.
  initialBlocks?: DocBlockDTO[];
  // Display-only section chrome (header/footer/section-break bands) interleaved into
  // the seed/reseed by BLOCK INDEX; carried alongside `initialBlocks` and `reseed`.
  chrome?: ChromeData[];
  // Serializable pagination input (geometry + section facts + pre-localized gutter
  // strings) built natively by buildPageSetup. PaginationPlugin measures against it
  // and inserts the PageBreakNodes; null/empty → the document stays continuous.
  pageSetup?: PageSetup | null;
  // Per-section page geometry in DOCUMENT px, for placing FLOATING shapes
  // (`DocBlockDTO.anchors`) over their carrier block. Independent of `pageSetup`:
  // a divider page's title must show whether or not the page view is on.
  // Spec: docs/superpowers/specs/2026-08-13-floating-shapes-design.md
  anchorGeometry?: AnchorSectionGeometry[];
  // In-place reconcile trigger: on nonce change, rebuild content from `blocks`
  // (+ its chrome) WITHOUT remounting (used to reflect external native/AI edits).
  reseed?: { blocks: DocBlockDTO[]; chrome?: ChromeData[]; nonce: number };
  // Outline-drawer navigation: on nonce change, scroll the block at `index` into view.
  scrollToIndex?: { index: number; nonce: number };
  // Header/footer sheet: on nonce change, scroll that BAND into view — the sheet
  // covers the lower two-thirds, so the band being edited has to be visible above it.
  scrollToChrome?: { kind: ChromeKind; index: number; nonce: number; offset?: number };
  // Header/footer sheet: render a template / AI proposal ON the real band while the
  // student browses. Display-only and reverted on clear — never saved.
  chromePreview?: { kind: ChromeKind; index: number; segments: string[]; text: string; nonce: number } | null;
  // Pending AI proposal to render in-flow, and its approve/reject callback.
  suggestion?: SuggestionInput;
  onSuggestAction?: (action: string, text?: string) => void;
  // AI inline autocomplete (ghost text). completionEnabled gates the plugin;
  // `completion` is the streamed continuation for the pending request; the callbacks
  // request / commit (accept) / cancel (dismiss) round-trip to the native store.
  completionEnabled?: boolean;
  completion?: { text: string; nonce: number; status: "idle" | "loading" | "done" | "error"; index?: number };
  onRequestCompletion?: (ctx: { index: number; text: string }) => void;
  onCommitCompletion?: (index: number, fullText: string) => void;
  onCancelCompletion?: () => void;
  // Pending RANGE proposal (multi-block dynamic rewrite) + its approve/reject/again/edit callback.
  rangeSuggestion?: RangeSuggestionInput;
  onRangeAction?: (action: string, text?: string) => void;
  // Top-level block indices to keep highlighted (the native MULTI-block selection),
  // so the chosen blocks stay marked after the OS text selection is dismissed.
  selectedIndices?: number[];
  // Figure media resolution: authed base URL + token so large figures (no inline
  // dataUri) load in the WebView via <img src=".../media/:index?token=...">.
  media?: { base: string; token: string; thesisId: string; version: string | number };
  // Document-search matches to tint (+ the current one), driven by the search store.
  search?: SearchInput;
  // Commit an in-cell table edit → native routes it through the silent table-op
  // sync (a DOM→native async function prop, like onState).
  onEditCell?: (blockIndex: number, row: number, col: number, text: string) => void;
  // AI table proposal (in-place diff): while set, the targeted table renders the
  // diff view; the pill's approve/reject/again round-trips through the native
  // function prop. tableLoadingIndex dims the table while the model thinks.
  // Spec: docs/superpowers/specs/2026-07-23-ai-table-proposals-design.md
  tableProposal?: TableProposalData | null;
  tableLoadingIndex?: number | null;
  // The reasoning streamed so far (live thinking under the dimmed table) and the
  // block index of a failed request (inline error + retry strip).
  tableThinking?: string;
  tableErrorIndex?: number | null;
  // Proposal UI strings resolved native-side via i18next (the DOM bundle has no
  // i18n instance) — the app is trilingual ar/fr/en. Defaults to English.
  tableLabels?: Partial<TableAILabels>;
  // "Still working" wait lines, shared by all three inline AI surfaces (table
  // proposal, paragraph suggestion, range rewrite). Same native-side i18next
  // arrangement as tableLabels; defaults to English.
  workingLabels?: Partial<WorkingLabels>;
  onTableProposalAction?: (action: string, note?: string) => void;
  // Notion-style Insert menu: fires when a "/query" is detected/cleared at the
  // caret (active + block index + query text) so native can bloom the menu.
  onInsertTrigger?: (t: { active: boolean; index: number; query: string }) => void;
  // An OS paste carrying an image: native reads the system clipboard itself and
  // inserts a figure AFTER this block index (see PasteImagePlugin).
  onPasteImage?: (index: number) => void;
  // Scroll persistence: `scrollRestore` requests a restore to `anchor` whenever its
  // `nonce` changes (native bumps it on focus / preview-return); `onScroll` reports
  // the live position out (throttled) so native keeps it; `onScrollRestored` fires
  // when a restore reaches its target (→ native hides the loading overlay).
  scrollRestore?: { anchor: ScrollAnchor; nonce: number } | null;
  onScroll?: (anchor: ScrollAnchor) => void;
  onScrollRestored?: () => void;
  // One-finger gutter-handle drag-to-reorder: `onReorder(from, to)` commits a block
  // move once the gesture drops; `onLift` fires when the hold arms the drag (native
  // haptic pop). `reorderActive` reflects the AIDock "Reorder" toggle — the plugin is
  // fully inert (no gutter grips, no gesture) until a later task passes it true.
  onReorder?: (from: number, to: number) => void;
  onLift?: () => void;
  reorderActive?: boolean;
  // Checkbox select mode (the ✦ dock's "Select" chip): every block grows a leading
  // checkbox and the editor goes read-only, so a multi-block selection is built by
  // TAPPING blocks instead of dragging the OS text-selection handles across them.
  // `selectedForCheck` are the block indices to draw checked (the native store's
  // selection); `onToggleSelect` reports a tapped block back to it.
  selectActive?: boolean;
  selectedForCheck?: number[];
  onToggleSelect?: (index: number, text: string) => void;
  // Block-editing keyboard mode: false → inputmode="none" (select a block WITHOUT
  // opening the keyboard); true → inputmode="text" (a tap/focus opens it). Issue #6.
  keyboardActive?: boolean;
  // Fast right→left fling over plain text (not tables/images) → open the structure
  // drawer (issue #4, option C). Bridged out to native, which flips the drawer store.
  onSwipeOpenDrawer?: () => void;
  // App-UI direction: flips the fling-to-open direction (RTL = right→left, LTR = left→right).
  appRtl?: boolean;
  // Consumed by the Expo DOM runtime (WebView config); declared so native call
  // sites can pass it. Not read inside the component.
  dom?: import("expo/dom").DOMProps;
};
