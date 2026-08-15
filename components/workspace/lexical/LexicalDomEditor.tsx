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
import { PaginationPlugin } from "./editor-components/plugins/pagination/PaginationPlugin";
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
