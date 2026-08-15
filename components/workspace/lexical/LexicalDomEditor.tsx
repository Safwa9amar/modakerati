'use dom';

// The thesis editor: Lexical rendered as an Expo DOM component ('use dom' →
// @expo/dom-webview). This file is the COMPOSITION SHELL and nothing else —
// every plugin, helper, contract and stylesheet lives in ./editor-components/.
//
// Data flow (per the Expo DOM-components contract — serializable props only):
//   • native → web:  `command` (a serializable {type,value,nonce} object). The
//     nonce forces a re-apply even when the same command repeats.
//   • web → native:  `onState` and the other top-level async function props.
// See ./editor-components/props for the full contract, with a note per prop.
//
// ⚠️ THE RULE THIS FILE LIVES BY: babel-preset-expo's use-dom-directive plugin
// allows a 'use dom' module exactly ONE export, and it must be the default. A
// named non-type export here is a BUNDLE-time failure that renders the writer
// screen blank — and `npx tsc --noEmit` cannot see it. That is why everything
// below is imported rather than declared, and why the gate before believing any
// change to this subsystem works is:
//
//     node scripts/verify-use-dom.mjs

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";

import type { AnchorSectionGeometry } from "@/lib/page-layout";
import {
  $blocksToLexical,
  AnchorGeometryContext,
  BlockDataNode,
  ChromeNode,
  EditCellContext,
  EquationNode,
  GhostCompletionNode,
  MediaContext,
  PageBreakNode,
  RangeSuggestionNode,
  SuggestionNode,
  TABLE_AI_LABELS_EN,
  TableProposalContext,
  WORKING_LABELS_EN,
  WorkingLabelsContext,
} from "./blockLexical";
import type { LexicalDomEditorProps } from "./editor-components/props";
import { seed } from "./editor-components/seed";
import { CSS } from "./editor-components/styles";
import { theme } from "./editor-components/theme";
import { CompletionPlugin } from "./editor-components/plugins/CompletionPlugin";
import { DrawerSwipePlugin } from "./editor-components/plugins/DrawerSwipePlugin";
import { EditorBridge } from "./editor-components/plugins/editor-bridge/EditorBridge";
import { EquationTapPlugin } from "./editor-components/plugins/EquationTapPlugin";
import { KeyboardModePlugin } from "./editor-components/plugins/KeyboardModePlugin";
import { PaginationPlugin } from "./editor-components/plugins/pagination/PaginationPlugin";
import { PasteImagePlugin } from "./editor-components/plugins/PasteImagePlugin";
import { RangeSuggestionPlugin } from "./editor-components/plugins/RangeSuggestionPlugin";
import { ReorderPlugin } from "./editor-components/plugins/reorder/ReorderPlugin";
import { ScrollSyncPlugin } from "./editor-components/plugins/ScrollSyncPlugin";
import { SearchHighlightPlugin } from "./editor-components/plugins/SearchHighlightPlugin";
import { SelectPlugin } from "./editor-components/plugins/SelectPlugin";
import { SelectionHighlightPlugin } from "./editor-components/plugins/SelectionHighlightPlugin";
import { SlashPlugin } from "./editor-components/plugins/SlashPlugin";
import { SuggestionPlugin } from "./editor-components/plugins/SuggestionPlugin";

// Stable empty default for the anchor-geometry context: a fresh [] per render
// would change the context value every render and re-render every overlay.
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

  // ⚠️ Plugin ORDER below is behaviour, not layout. Lexical resolves command
  // listeners registered at equal priority in registration order, so moving a
  // plugin up or down this list can change which one wins a command.
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
