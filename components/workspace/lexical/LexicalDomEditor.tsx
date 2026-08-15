'use dom';

// Lexical rich-text editor rendered as an Expo DOM component ('use dom' →
// @expo/dom-webview). This is a SPIKE: an isolated proof that our NATIVE bubble
// can drive a web rich-text editor while keeping RTL + rich formatting for free.
//
// Data flow (per the Expo DOM-components contract — serializable props only):
//   • native → web:  `command` (a serializable {type,value,nonce} object). The
//     nonce forces a re-apply even when the same command repeats.
//   • web → native:  `onState` (a top-level async function prop) reports the
//     active formats so the native bubble can highlight B/I/U/heading/direction.
// Nothing here is wired to the thesis doc/op-queue yet — it's a feasibility test.

import * as React from "react";
import { useEffect, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  ListNode,
  ListItemNode,
  $isListNode,
  $isListItemNode,
  $insertList,
} from "@lexical/list";
import {
  $getRoot,
  $addUpdateTag,
  SKIP_DOM_SELECTION_TAG,
  type LexicalNode,
} from "lexical";
import {
  $blocksToLexical,
  BlockDataNode,
  ChromeNode,
  PageBreakNode,
  $createPageBreakNode,
  $isPageBreakNode,
  type PageBreakData,
  // The ONE predicate that owns "this node exists only to be looked at" —
  // chrome bands AND page boundaries. Every block-INDEX walk skips it; only a
  // genuine "is this specifically a chrome band?" identity test uses
  // $isChromeNode. Getting that backwards puts every index past the node off
  // by N, which is exactly how c28d406 and 6eae8ee both shipped.
  $isDisplayOnlyNode,
  MediaContext,
  AnchorGeometryContext,
  EditCellContext,
  TableProposalContext,
  TABLE_AI_LABELS_EN,
  WorkingLabelsContext,
  WORKING_LABELS_EN,
  SuggestionNode,
  RangeSuggestionNode,
  GhostCompletionNode,
  EquationNode,
  $blockEntries,
  countListItems,
  type BlockEntry,
} from "./blockLexical";
import { singleMoveTo } from "@/lib/reorder-range";
// Pure geometry/pagination/numbering — no React, no RN, no DOM, so it is the one
// piece of this feature verifiable off-device (scripts/verify-page-layout.mjs).
import {
  paginate,
  numberPages,
  sectionForBlock,
  chromeDrawingFractions,
  duotoneStops,
  type AnchorSectionGeometry,
} from "@/lib/page-layout";
// type-only — WorkspaceLexicalView is the native ('use dom' host) module; importing
// just the type is erased at compile time, same contract as ChromeData above.
import type { PageSetup } from "../WorkspaceLexicalView";
// ── ./editor-components ──────────────────────────────────────────────────────
// This module carries the 'use dom' directive, so babel-preset-expo allows it
// exactly ONE export and it must be the default. Every contract, helper, plugin
// and stylesheet therefore lives beside it in editor-components/ (plain web-bundle
// modules, free to export as they like). Gate: node scripts/verify-use-dom.mjs.
import {
  $anyNodeAtBlockIndex,
} from "./editor-components/block-index";
import { withScrollPinned } from "./editor-components/lexical-updates";
import { measureBlockHeights, measureCacheClear } from "./editor-components/measure";
import { CompletionPlugin } from "./editor-components/plugins/CompletionPlugin";
import { ReorderPlugin } from "./editor-components/plugins/reorder/ReorderPlugin";
import { DrawerSwipePlugin } from "./editor-components/plugins/DrawerSwipePlugin";
import { EditorBridge } from "./editor-components/plugins/editor-bridge/EditorBridge";
import { EquationTapPlugin } from "./editor-components/plugins/EquationTapPlugin";
import { KeyboardModePlugin } from "./editor-components/plugins/KeyboardModePlugin";
import { PasteImagePlugin } from "./editor-components/plugins/PasteImagePlugin";
import { RangeSuggestionPlugin } from "./editor-components/plugins/RangeSuggestionPlugin";
import { ScrollSyncPlugin } from "./editor-components/plugins/ScrollSyncPlugin";
import { SearchHighlightPlugin } from "./editor-components/plugins/SearchHighlightPlugin";
import { SelectPlugin } from "./editor-components/plugins/SelectPlugin";
import { SelectionHighlightPlugin } from "./editor-components/plugins/SelectionHighlightPlugin";
import { SlashPlugin } from "./editor-components/plugins/SlashPlugin";
import { SuggestionPlugin } from "./editor-components/plugins/SuggestionPlugin";
import { seed } from "./editor-components/seed";
import { CSS } from "./editor-components/styles";
import { theme } from "./editor-components/theme";
import type { LexicalDomEditorProps } from "./editor-components/props";


// Marks the plugin's OWN writes below. Removing and re-inserting boundary nodes
// is a dirty update like any other, so without a tag to recognise it by, the
// plugin's update listener would re-trigger the plugin — forever, every 400ms,
// for as long as the document stayed open. That is not merely wasted work: the
// native side resets its 1500ms serialize timer on every editor report, so a
// self-feeding loop would hold that timer permanently reset and the student's
// writing would never be saved.
const PAGES_TAG = "page-view";

/**
 * Insert one PageBreakNode per measured page boundary.
 *
 * Runs on idle, never per keystroke: measurement touches layout, and the
 * Writer's rule is that nothing updates per input event (see createStreamPump's
 * 90ms batching for the same discipline applied to streaming).
 */
function PaginationPlugin({ setup }: { setup?: PageSetup | null }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Strip every band. Used when there is nothing to paginate — turning the page
    // view off must take the paper away, not freeze the last layout on screen.
    /**
     * Run a band mutation without moving the reader.
     *
     * TWO separate things move the page, and both have to be held:
     *
     * 1. FOCUS. Without SKIP_DOM_SELECTION_TAG the reconciler runs its DOM-selection
     *    update, which re-focuses the root — and a focused caret-less contentEditable
     *    makes iOS WKWebView scroll to the document top. That is the same trap
     *    withScrollPinned documents, and it is why an edit appeared to jump to the top
     *    once the sync settled: reseed → 400ms → this plugin rewrote the bands.
     * 2. LAYOUT. Inserting or removing a band ABOVE the viewport shifts everything
     *    below it. Restoring the old scrollY would hold the pixel and lose the words,
     *    so instead we anchor on a real block element: remember where the top-most
     *    visible block sat, then put it back exactly there. Block nodes are never
     *    touched by this mutation — only page nodes are — so the element survives and
     *    the anchor stays valid.
     */
    const pinned = (mutator: () => void) => {
      let anchor: { el: HTMLElement; top: number } | null = null;
      const rootEl = editor.getRootElement();
      if (rootEl) {
        for (const child of Array.from(rootEl.children) as HTMLElement[]) {
          const r = child.getBoundingClientRect();
          if (r.bottom > 0) { anchor = { el: child, top: r.top }; break; }
        }
      }
      const restore = () => {
        if (!anchor || typeof window === "undefined") return;
        const delta = anchor.el.getBoundingClientRect().top - anchor.top;
        if (delta) window.scrollBy(0, delta);
      };
      editor.update(
        () => { $addUpdateTag(PAGES_TAG); $addUpdateTag(SKIP_DOM_SELECTION_TAG); mutator(); },
        { tag: "history-merge", onUpdate: () => { restore(); requestAnimationFrame(restore); } },
      );
    };

    const dropAll = () => {
      let any = false;
      editor.getEditorState().read(() => {
        any = $getRoot().getChildren().some((n) => $isPageBreakNode(n));
      });
      if (!any) return;
      pinned(() => {
        $getRoot().getChildren().forEach((n) => { if ($isPageBreakNode(n)) n.remove(); });
      });
    };

    if (!setup || setup.sections.length === 0) { dropAll(); return; }
    const sections = setup.sections;

    // Font readiness: a measurement taken before Liberation Serif finishes
    // loading measured the fallback serif's metrics instead — poisoned, and
    // cached under the same keys real measurements will later hit. Clear
    // BOTH caches (block heights and the single-line probe — a probe taken
    // in the fallback is exactly as poisoned as a block measurement) and
    // re-run once the real font is in.
    if (typeof document !== "undefined" && "fonts" in document) {
      (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {
        if (cancelled) return;
        measureCacheClear();
        schedule();
      });
    }

    const repaginate = () => {
      if (cancelled) return;

      // 1 ─ Collect the block-bearing DOM rows, in order, skipping display-only
      //     nodes. Their positions ARE block indices — the same contract
      //     $anyNodeAtBlockIndex relies on. The bands already in the tree are
      //     recorded in the same walk, each keyed by the block index it sits
      //     before, so an unchanged layout can skip the write entirely.
      const rows: HTMLElement[] = [];
      // Block index at which each root child's rows begin. A band can only be
      // inserted BETWEEN root children, so these are the only positions a page
      // may legally start at (see the snap below).
      const childStart: number[] = [];
      const current: string[] = [];
      let desynced = false;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        // A LIST is one root child but MANY block indices — one per leaf item, in
        // the depth-first order pushListItems flattens them. Measuring the list as
        // a single row would both attribute its whole height to one index and
        // shift every index after it, which is how a section's forced page break
        // stops matching and a page inherits the wrong header's chrome.
        const pushLeafRows = (node: LexicalNode): boolean => {
          if ($isListNode(node)) {
            for (const item of node.getChildren()) {
              if (!$isListItemNode(item)) continue;
              const nested = item.getChildren().find($isListNode);
              if (nested) { if (!pushLeafRows(nested as LexicalNode)) return false; continue; }
              const li = editor.getElementByKey(item.getKey());
              if (!li) return false;
              rows.push(li);
            }
            return true;
          }
          const el = editor.getElementByKey(node.getKey());
          if (!el) return false;
          rows.push(el);
          return true;
        };
        root.getChildren().forEach((node) => {
          if ($isPageBreakNode(node)) { current.push(`${rows.length}|${JSON.stringify(node.getData())}`); return; }
          if ($isDisplayOnlyNode(node)) return;
          const start = rows.length;
          // A block with no element yet would shift every index after it. Rather
          // than measure the wrong paragraph, abandon this pass — the next edit
          // (or the next scheduled run) will find the DOM settled.
          if (!pushLeafRows(node)) { desynced = true; return; }
          if (rows.length > start) childStart.push(start);
        });
      });
      if (desynced || rows.length === 0) return;

      // 2 ─ Measure at true geometry and paginate.
      // One column width for the whole document: a thesis mixing page sizes
      // mid-document is vanishingly rare, and a per-section width would mean
      // re-laying out the measuring host per block. Page HEIGHT is per-section
      // below, which is the one that actually varies (landscape appendices).
      const columnPx = sections[0].textColumnPx;
      // Typography per block index, from the server's resolution of the OOXML
      // cascade. A block without it (table, image, or a cache predating the
      // field) falls back to the editor's own metrics inside measureBlockHeights.
      const blockFmts = setup.blockFmts ?? [];
      const results = measureBlockHeights(rows, columnPx, setup.rtl, blockFmts);
      const heights = results.map((r) => r.h);
      const spaceBefore = results.map((r) => r.before);
      const pageContentPx = rows.map((_, i) => sections[sectionForBlock(sections, i)].contentHeightPx);
      const forcedStarts = new Set(
        sections.filter((s) => s.startsOnNewPage && s.startBlockIndex > 0).map((s) => s.startBlockIndex),
      );
      // `remainder` is deliberately unused until Task 8 renders the spacer.
      const raw = paginate({
        heights,
        spaceBefore,
        pageContentPx,
        forcedStarts,
        // A heading is never left at the bottom of a page — Word's built-in
        // heading styles all carry keep-with-next.
        keepWithNext: new Set(setup.keepWithNext ?? []),
        // Only a paragraph splits across pages in Word; a table, an image or a
        // text box moves whole. Having typography IS being a paragraph.
        splittable: rows.map((_, i) => blockFmts[i] != null),
      });

      // A page may only START where a root child does. Pagination works in block
      // space, where a list is many indices, so a break can land BETWEEN two list
      // items — and a band inserted there would sit inside the <ul>, malforming
      // it (the same structural rule that makes RangeSuggestionPlugin decline a
      // list range). Snap such a boundary back to the list's first block: the
      // list travels whole to the next page, which is also what Word does when
      // its items are kept together.
      const snapToChild = (b: number) => {
        let s = 0;
        for (const c of childStart) { if (c <= b) s = c; else break; }
        return s;
      };
      const starts: number[] = [];
      const physPage: number[] = [];
      // `raw.remainder` is parallel to `raw.starts` — entry k is the unused space
      // at the foot of the page STARTING at starts[k]. It has to be carried
      // through the snap in lockstep or a page inherits another page's whitespace.
      const remainder: number[] = [];
      for (let k = 0; k < raw.starts.length; k++) {
        const s = k === 0 ? 0 : snapToChild(raw.starts[k]);
        // Snapping can collapse a boundary onto the page before it — that page
        // simply absorbs the list rather than splitting it. The merged page now
        // ends where THIS one ended, so it takes this page's remainder; it still
        // begins where the earlier one did, so its physical index is unchanged.
        if (k > 0 && s <= starts[starts.length - 1]) {
          remainder[remainder.length - 1] = raw.remainder[k] ?? 0;
          continue;
        }
        starts.push(s);
        physPage.push(raw.physPage[k]);
        remainder.push(raw.remainder[k] ?? 0);
      }
      // Measurement px → display px. The bands render in the editor's narrower
      // column, so the room left on a page has to shrink by the same ratio the
      // text did. Capped: a nearly-empty page would otherwise scroll for a screen
      // and a half of blank paper, which reads as a bug rather than as Word.
      const renderedColumnPx = editor.getRootElement()?.clientWidth ?? columnPx;
      const displayScale = columnPx > 0 ? renderedColumnPx / columnPx : 1;
      const remainderDisplay = (k: number) =>
        Math.min(240, Math.round(((remainder[k] ?? 0) * displayScale) / 4) * 4);
      // A page whose picture Word centres ON THE PAGE (set_image_layout with
      // vertical:"center") does not lay that picture out in the flow at all, so
      // the flow's own answer — hard against the top, all the leftover room
      // below — is the one thing it certainly is not. Split that room in two and
      // put half of it above: the SAME total blank the page already showed, just
      // distributed the way Word distributes it. The 240px cap above is left
      // exactly as it is; halving a capped remainder still reads as centred, and
      // uncapping it here would bring back the screen and a half of blank paper
      // that cap exists to prevent.
      const pageCentered = new Set(setup.pageCentered ?? []);
      const centredPage = (k: number) => {
        if (pageCentered.size === 0) return false;
        const end = k + 1 < starts.length ? starts[k + 1] : rows.length;
        for (let b = starts[k]; b < end; b++) if (pageCentered.has(b)) return true;
        return false;
      };
      const leadDisplay = (k: number) => (centredPage(k) ? Math.round(remainderDisplay(k) / 2 / 4) * 4 : 0);
      const tailDisplay = (k: number) => remainderDisplay(k) - leadDisplay(k);
      const numbering = numberPages(starts, physPage, sections);
      if (cancelled || numbering.length === 0) return;

      // 3 ─ Build the node data.
      //     An unnumbered page shows NOTHING on the paper — that is the whole
      //     point of a divider — so its footer is dropped even when the section
      //     has one, and the gutter NAMES it rather than numbering it.
      const footerFor = (page: (typeof numbering)[number]) => {
        const sec = sections[page.sectionIndex];
        if (!sec?.footer || page.unnumbered) return null;
        return {
          text: sec.footer.text,
          pageText: sec.footer.hasPageNumbers ? page.text : null,
          sectionIndex: page.sectionIndex,
          startBlockIndex: sec.startBlockIndex,
        };
      };
      const headerFor = (page: (typeof numbering)[number]) => {
        const sec = sections[page.sectionIndex];
        if (!sec?.header) return null;
        return {
          text: sec.header.text,
          segments: sec.header.segments,
          border: sec.header.border,
          sectionIndex: page.sectionIndex,
          startBlockIndex: sec.startBlockIndex,
        };
      };
      // Artwork behind the page BEGINNING after this band, as fractions of the
      // sheet. Deliberately NOT resolved to px here: the band knows its own
      // width and its page's measured height, and those are what Word's ratios
      // have to be re-scaled against.
      const artworkFor = (page: (typeof numbering)[number]) => {
        const sec = sections[page.sectionIndex];
        const drawings = sec?.headerDrawings ?? [];
        if (!drawings.length || !sec?.chromeGeo) return undefined;
        const geo = sec.chromeGeo;
        const pageAspect = geo.pageWidthPx > 0 ? geo.pageHeightPx / geo.pageWidthPx : 1.414;
        return drawings.map((d) => ({
          dataUri: d.dataUri!, // buildPageSetup keeps only drawings that have one
          ...chromeDrawingFractions(d, geo),
          pageAspect,
          duotone: duotoneStops(d.duotone),
          alt: d.descr ?? "",
        }));
      };
      const gutterFor = (page: (typeof numbering)[number]) => {
        if (!page.unnumbered) return setup.gutterNumberTemplate.replace("{{n}}", page.text ?? "");
        return sections[page.sectionIndex]?.unnumberedKind === "divider"
          ? setup.gutterDividerLabel
          : setup.gutterOrnamentLabel;
      };
      // Where a gutter tap goes. Nothing to offer on a page that is unnumbered
      // by design — there is no page number to ask for.
      const gutterTargetFor = (page: (typeof numbering)[number]) => {
        if (page.unnumbered) return null;
        const sec = sections[page.sectionIndex];
        if (!sec) return null;
        return { sectionIndex: page.sectionIndex, startBlockIndex: sec.startBlockIndex, text: sec.footer?.text ?? "" };
      };

      // Boundaries sit immediately BEFORE the first block of each page after
      // the first.
      const boundaries = new Map<number, PageBreakData>();
      for (let p = 1; p < starts.length; p++) {
        boundaries.set(starts[p], {
          variant: "boundary",
          endingPage: numbering[p - 1].number ?? 0,
          footer: footerFor(numbering[p - 1]),
          header: headerFor(numbering[p]),
          gutterLabel: gutterFor(numbering[p]),
          gutterTarget: gutterTargetFor(numbering[p - 1]),
          remainderPx: tailDisplay(p - 1),
          leadPx: leadDisplay(p),
          rtl: setup.rtl,
          artwork: artworkFor(numbering[p]),
        });
      }
      // The edge nodes: a boundary separates two pages, so without these the
      // FIRST page would have no header and the LAST no footer.
      const first = numbering[0];
      const last = numbering[numbering.length - 1];
      const firstHeader = headerFor(first);
      const firstArtwork = artworkFor(first);
      const lastFooter = footerFor(last);
      // The cover page's frame reaches the paper only through this leading band —
      // there is no boundary above page 1 to carry it.
      // …and the leading band is also the only place page ONE's top padding can
      // go, so a first page that centres a picture needs one even with no header.
      const firstLead = leadDisplay(0);
      const leading: PageBreakData | null = firstHeader || firstLead > 0
        ? { variant: "leading", endingPage: 0, footer: null, header: firstHeader,
            gutterLabel: "", gutterTarget: null, remainderPx: 0, leadPx: firstLead, rtl: setup.rtl,
            artwork: firstArtwork }
        : null;
      const trailing: PageBreakData | null = lastFooter
        ? { variant: "trailing", endingPage: last.number ?? 0, footer: lastFooter, header: null,
            gutterLabel: "", gutterTarget: null, remainderPx: tailDisplay(numbering.length - 1), leadPx: 0, rtl: setup.rtl }
        : null;

      // 4 ─ Apply, but only if anything actually moved. Re-creating identical
      //     nodes would remount every band (a visible flicker) and dirty the
      //     editor for nothing.
      const next: string[] = [];
      if (leading) next.push(`0|${JSON.stringify(leading)}`);
      for (let p = 1; p < starts.length; p++) next.push(`${starts[p]}|${JSON.stringify(boundaries.get(starts[p]))}`);
      if (trailing) next.push(`${rows.length}|${JSON.stringify(trailing)}`);
      if (next.length === current.length && next.every((s, i) => s === current[i])) return;

      pinned(() => {
        const root = $getRoot();
        // Drop the previous nodes wholesale, then re-insert. Simpler than
        // diffing, and the node carries no state worth preserving.
        root.getChildren().forEach((n) => { if ($isPageBreakNode(n)) n.remove(); });

        // Two passes rather than one: the insertions below mutate the tree, and
        // a block-index walk must not be reading a list it is changing.
        const blockNodes: LexicalNode[] = [];
        root.getChildren().forEach((n) => { if (!$isDisplayOnlyNode(n)) blockNodes.push(n); });
        if (blockNodes.length === 0) return;
        // Walk in BLOCK space, advancing by a list's item count — the same space
        // `boundaries` is keyed in. Every key is a root-child start thanks to the
        // snap above, so each lands exactly on one of these nodes.
        let blockIndex = 0;
        for (const node of blockNodes) {
          const data = boundaries.get(blockIndex);
          if (data) node.insertBefore($createPageBreakNode(data));
          blockIndex += $isListNode(node) ? countListItems(node) : 1;
        }
        if (leading) blockNodes[0].insertBefore($createPageBreakNode(leading));
        if (trailing) blockNodes[blockNodes.length - 1].insertAfter($createPageBreakNode(trailing));
      });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Pagination is a nicety; writing is not. A throw here must leave the
        // student with a plain continuous flow, never a broken editor.
        try { repaginate(); }
        catch (err) { console.warn("[pages] pagination failed, continuing unpaginated", err); }
      }, 400);
    };

    schedule();
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
      // Our own insert/remove of boundary nodes fires this too. Re-scheduling on
      // it would never converge — see PAGES_TAG above.
      if (tags.has(PAGES_TAG)) return;
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      schedule();
    });

    return () => { cancelled = true; if (timer) clearTimeout(timer); unregister(); };
  }, [editor, setup]);

  return null;
}

// Stable empty default for the anchor-geometry context: a fresh [] per render
// would change the context value every render and re-render every overlay.
// Module-private on purpose — a 'use dom' module may export ONE thing, the
// default (scripts/verify-use-dom.mjs).
const EMPTY_ANCHOR_GEOMETRY: AnchorSectionGeometry[] = [];

export default function LexicalDomEditor({
  command,
  onState,
  onBlocks,
  initialBlocks,
  chrome,
  pageSetup,
  anchorGeometry,
  reseed,
  scrollToIndex,
  scrollToChrome,
  chromePreview,
  suggestion,
  onSuggestAction,
  completionEnabled,
  completion,
  onRequestCompletion,
  onCommitCompletion,
  onCancelCompletion,
  rangeSuggestion,
  onRangeAction,
  selectedIndices,
  media,
  search,
  onEditCell,
  tableProposal,
  tableLoadingIndex,
  tableThinking,
  tableErrorIndex,
  tableLabels,
  workingLabels,
  onTableProposalAction,
  onEquationTap,
  onInsertTrigger,
  onPasteImage,
  scrollRestore,
  onScroll,
  onScrollRestored,
  onReorder,
  onLift,
  reorderActive,
  selectActive,
  selectedForCheck,
  onToggleSelect,
  keyboardActive,
  onSwipeOpenDrawer,
  appRtl,
}: LexicalDomEditorProps) {
  const initialConfig = {
    namespace: "kwill-lexical-lab",
    theme,
    onError: (error: Error) => console.error("[lexical]", error),
    // Every node class that can appear in the tree MUST be listed here: Lexical
    // throws at registration for an unregistered class and the editor then
    // renders NOTHING — a blank white screen, not a partial failure.
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, BlockDataNode, SuggestionNode, RangeSuggestionNode, GhostCompletionNode, EquationNode, ChromeNode, PageBreakNode],
    editorState: () => (initialBlocks && initialBlocks.length ? $blocksToLexical(initialBlocks, chrome) : seed()),
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <style>{CSS}</style>
      <MediaContext.Provider value={media ?? { base: "", token: "", thesisId: "", version: "" }}>
      <AnchorGeometryContext.Provider value={anchorGeometry ?? EMPTY_ANCHOR_GEOMETRY}>
      <EditCellContext.Provider value={onEditCell ?? null}>
      <WorkingLabelsContext.Provider value={{ ...WORKING_LABELS_EN, ...(workingLabels ?? {}) }}>
      <TableProposalContext.Provider
        value={{
          proposal: tableProposal ?? null,
          loadingIndex: tableLoadingIndex ?? null,
          thinking: tableThinking ?? "",
          errorIndex: tableErrorIndex ?? null,
          labels: { ...TABLE_AI_LABELS_EN, ...(tableLabels ?? {}) },
          onAction: (action, note) => onTableProposalAction?.(action, note),
        }}
      >
      <div className="lx-root">
        <RichTextPlugin
          // spellCheck off: the WebView's native spellchecker has no Arabic
          // dictionary, so it red-underlines every Arabic word. We have no native
          // replacement, so it simply goes off across all languages (issue #8).
          contentEditable={<ContentEditable className="lx-content" dir="auto" spellCheck={false} />}
          placeholder={<div className="lx-ph">اكتب هنا… · format from the bar below</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <KeyboardModePlugin active={!!keyboardActive} />
        <DrawerSwipePlugin onOpen={onSwipeOpenDrawer} rtl={!!appRtl} />
        <ListPlugin />
        {/* Checklist support: adds the click-to-toggle checkbox handling for
            list items created with $insertList("check"). */}
        <CheckListPlugin />
        <EditorBridge command={command} onState={onState} onBlocks={onBlocks} reseed={reseed} scrollToIndex={scrollToIndex} scrollToChrome={scrollToChrome} chromePreview={chromePreview} />
        <SuggestionPlugin suggestion={suggestion} onSuggestAction={onSuggestAction} />
        <EquationTapPlugin onEquationTap={onEquationTap} />
        <CompletionPlugin
          enabled={completionEnabled}
          completion={completion}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
          onRequest={onRequestCompletion}
          onCommit={onCommitCompletion}
          onCancel={onCancelCompletion}
        />
        <SlashPlugin onInsertTrigger={onInsertTrigger} suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal} />
        <PasteImagePlugin onPasteImage={onPasteImage} suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal} />
        <ReorderPlugin
          onReorder={onReorder}
          onLift={onLift}
          active={reorderActive}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
        />
        <SelectPlugin
          active={selectActive}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
          indices={selectedForCheck}
          onToggle={onToggleSelect}
        />
        <RangeSuggestionPlugin rangeSuggestion={rangeSuggestion} onRangeAction={onRangeAction} />
        <SelectionHighlightPlugin indices={selectedIndices} />
        <SearchHighlightPlugin search={search} />
        <ScrollSyncPlugin restore={scrollRestore} onScroll={onScroll} onRestored={onScrollRestored} />
        <PaginationPlugin setup={pageSetup} />
      </div>
      </TableProposalContext.Provider>
      </WorkingLabelsContext.Provider>
      </EditCellContext.Provider>
      </AnchorGeometryContext.Provider>
      </MediaContext.Provider>
    </LexicalComposer>
  );
}
