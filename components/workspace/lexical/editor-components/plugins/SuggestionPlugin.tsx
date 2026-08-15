// Renders a pending AI proposal IN PLACE OF its block (matching the native
// InlineSuggestion — proposal as the paragraph, original teaser, ✓ Approve / ✕
// pill), driven by the native suggestion store via the `suggestion` prop. The
// SuggestionNode captures the replaced block's type so reject can restore it, and
// $lexicalToBlocks reports the original text for it (so a flush never drops the
// block). Approve/Reject dispatch commands that call back to `onSuggestAction`.

import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode } from "@lexical/rich-text";
import { mergeRegister } from "@lexical/utils";
import { $getRoot, $setSelection, COMMAND_PRIORITY_LOW, SKIP_DOM_SELECTION_TAG } from "lexical";
import type { DocBlockDTO } from "@/lib/api";
import {
  $createBlockDataNode,
  $createSuggestionNode,
  $isSuggestionNode,
  $lexicalToBlocks,
  BlockDataNode,
  type SugData,
  SUGGEST_AGAIN_COMMAND,
  SUGGEST_APPROVE_COMMAND,
  SUGGEST_EDIT_COMMAND,
  SUGGEST_REJECT_COMMAND,
  SuggestionNode,
} from "../../blockLexical";
import { rebuildOriginal } from "../block-format";
import { $anyNodeAtBlockIndex, $nodeAtBlockIndex } from "../block-index";
import { withScrollPinned } from "../lexical-updates";
import type { SuggestionInput } from "../types";

export function SuggestionPlugin({
  suggestion,
  onSuggestAction,
}: {
  suggestion?: SuggestionInput;
  onSuggestAction?: (action: string, text?: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Which action last cleared the suggestion — decides whether the node settles to
  // the PROPOSED text (approve) or the ORIGINAL (reject). This lets approve apply
  // IN PLACE (one node) instead of triggering a full doc reseed, which is what was
  // scrolling the view to the document end.
  const lastActionRef = useRef<string>("");
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(SUGGEST_APPROVE_COMMAND, () => { lastActionRef.current = "approve"; onSuggestAction?.("approve"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_REJECT_COMMAND, () => { lastActionRef.current = "reject"; onSuggestAction?.("reject"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_AGAIN_COMMAND, () => { onSuggestAction?.("again"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_EDIT_COMMAND, (text) => { onSuggestAction?.("edit", text); return true; }, COMMAND_PRIORITY_LOW),
      ),
    [editor, onSuggestAction],
  );
  useEffect(() => {
    const mutate = () => {
      const root = $getRoot();
      const existing = root.getChildren().find($isSuggestionNode);
      // Cleared: settle the node in place — approve → the applied proposal, reject →
      // the untouched original. Doing it here (one node) means approve does NOT need
      // the sync-layer reseed (WorkspaceLexicalView skips it), so the view stays put.
      if (!suggestion || suggestion.index < 0) {
        if (existing) {
          const applied = lastActionRef.current === "approve";
          const sug = existing.__sug;
          if (sug.action === "setChart") {
            // A chart card never REPLACED its block — it sits beside the chart, which
            // is still in the tree. So there is nothing to rebuild: drop the card and
            // let the server echo repaint the chart with its new SVG.
            existing.remove();
            $setSelection(null);
            lastActionRef.current = "";
            return;
          }
          if (applied && sug.action === "insertTable" && sug.proposedRows?.length) {
            // Settle a table proposal IN PLACE (instant, no full reseed): insert the
            // real table node BEFORE the node, then leave the original (empty) paragraph
            // as the trailing spacer — matching the insertTable op's effect (table at
            // index, empty paragraph at index+1). The op syncs in the background and the
            // server echo reconciles. `index` is fixed by that reseed.
            existing.insertBefore(
              $createBlockDataNode({
                index: 0,
                kind: "table",
                rows: sug.proposedRows,
                ...(sug.tableHeader ? { header: true } : {}),
                ...(sug.tableRtl ? { direction: "rtl" } : {}),
              } as unknown as DocBlockDTO),
            );
            existing.replace(rebuildOriginal(sug.original, existing.__origType));
          } else if (applied && sug.action === "insertSourceImage" && sug.hasImage) {
            // Same in-place settle for a figure copied from a source: the figure node
            // goes in BEFORE the card and the (empty) paragraph stays after it, which
            // is exactly what the insertImage op does server-side (afterIndex = the
            // block before). Without a preview dataUri the node still renders — the
            // server echo brings the bytes back on reconcile.
            existing.insertBefore(
              $createBlockDataNode({
                index: 0,
                kind: "image",
                hasMedia: true,
                ...(sug.imageDataUri ? { dataUri: sug.imageDataUri } : {}),
                ...(sug.imageWidth ? { width: sug.imageWidth } : {}),
                ...(sug.imageHeight ? { height: sug.imageHeight } : {}),
              } as unknown as DocBlockDTO),
            );
            existing.replace(rebuildOriginal(sug.original, existing.__origType));
          } else {
            existing.replace(rebuildOriginal(applied ? sug.proposed : sug.original, existing.__origType));
          }
          $setSelection(null);
        }
        lastActionRef.current = "";
        return;
      }
      const data: SugData = {
        original: suggestion.original,
        proposed: suggestion.proposed,
        status: suggestion.status,
        instruction: suggestion.instruction,
        label: suggestion.label,
        reasoning: suggestion.reasoning,
        reasoningMs: suggestion.reasoningMs,
        action: suggestion.action,
        proposedRows: suggestion.proposedRows,
        tableHeader: suggestion.tableHeader,
        tableRtl: suggestion.tableRtl,
        hasImage: suggestion.hasImage,
        imageDataUri: suggestion.imageDataUri,
        imageWidth: suggestion.imageWidth,
        imageHeight: suggestion.imageHeight,
        // action "setChart": without these the card has no preview to render and
        // falls through to the plain-text branch, which shows an empty proposal.
        chartSvg: suggestion.chartSvg,
        chartOriginalSvg: suggestion.chartOriginalSvg,
        errorText: suggestion.errorText,
      };
      if (existing) { existing.getWritable().__sug = data; return; } // stream in place
      if (suggestion.action === "setChart") {
        // ⚠️ A chart is a structural BlockDataNode, so two things differ from a
        // paragraph rewrite:
        //   • $nodeAtBlockIndex only yields paragraph/heading/list-item nodes — it
        //     returns null here, which is why the card never appeared at all.
        //   • REPLACING it would be data loss: $lexicalToBlocks serializes a
        //     SuggestionNode as a paragraph of `sug.original` (empty for a chart),
        //     so a flush mid-review would delete the chart from the .docx.
        // So the card goes in AFTER the chart and the chart node stays put — the
        // same shape the native surface uses (figure visible, card beneath it).
        const chartNode = $anyNodeAtBlockIndex(suggestion.index);
        if (chartNode) {
          $setSelection(null);
          chartNode.insertAfter($createSuggestionNode(data, "paragraph"));
        }
        return;
      }
      const target = $nodeAtBlockIndex(suggestion.index);
      if (target) {
        const origType = $isHeadingNode(target)
          ? target.getTag()
          : target.getType() === "quote"
            ? "quote"
            : "paragraph";
        // Detach the caret from the block we're about to replace — a RangeSelection
        // left pointing into a removed node makes Lexical throw during reconcile.
        $setSelection(null);
        target.replace($createSuggestionNode(data, origType));
      }
    };
    // Pin scroll ONLY when the node is created/removed (that's what moves layout);
    // an in-place stream update (existing __sug) must not fight the user's scroll.
    // On the CLEAR path (approve/reject) also blur: tapping the pill button focused
    // it, and removing it drops the caret at the document end → iOS scroll.
    //
    // ⚠️ Ask the TREE whether the node exists (same as RangeSuggestionPlugin's
    // `hasNode`). The old test — "no proposed text yet, so this must be the create"
    // — holds only for the FIRST update: while the model is still thinking,
    // `reasoning` streams and re-runs this effect many times a second with
    // `proposed` still empty, so every one of those purely in-place re-renders took
    // the structural path and re-pinned the scroll. The mutator below already knows
    // better (`if (existing) … return // stream in place`); only this decision was
    // guessing. It went unnoticed while the pin was a silent no-op; once the pin
    // actually moved the view it became the editor shaking up and down under the
    // student's finger for as long as the AI thought.
    let hasNode = false;
    editor.getEditorState().read(() => { hasNode = !!$getRoot().getChildren().find($isSuggestionNode); });
    const isClear = !suggestion || suggestion.index < 0;
    const structural = isClear || !hasNode;
    if (structural) withScrollPinned(editor, mutate, isClear);
    else editor.update(mutate, { tag: SKIP_DOM_SELECTION_TAG }); // stream in place — never touch focus/scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion?.index, suggestion?.proposed, suggestion?.status, suggestion?.reasoning, suggestion?.label, suggestion?.proposedRows, suggestion?.imageDataUri]);
  return null;
}
