import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useTableSuggestionStore } from "@/stores/table-suggestion-store";
import { sendMessageToAI } from "@/lib/ai-service";
import type { DocBlockDTO } from "@/lib/api";
import type { DockScope } from "@/lib/ai-dock-scopes";

export interface SendArgs {
  thesisId: string;
  scope: DockScope;
  prompt: string;
  indices: number[];
  selectedBlock: DocBlockDTO | null;
  scopeBlocks: { index: number; text: string; level: number }[];
  scopeText?: string;
}

/**
 * The dock's ONLY send path, switched on the scope kind that the header already
 * displayed. It does not re-derive the route from its own conditionals — that is
 * the whole point: the promise the student read and the thing that happens are
 * the same value.
 *
 * ⚠️ Invariant this structure now enforces: a block-scoped ask must go through
 * useSuggestionStore/useTableSuggestionStore — the dedicated suggest endpoints,
 * which return a proposal to approve or reject. sendMessageToAI is the plain
 * chat/tool loop and edits the document directly with no review step. The dock
 * bypassed this once already (regression, fixed a8b14a8).
 */
export function sendFromDock({
  thesisId,
  scope,
  prompt,
  indices,
  selectedBlock,
  scopeBlocks,
  scopeText,
}: SendArgs): void {
  const pill = useFloatingPillStore.getState();
  const collapse = () => {
    pill.setExpanded(false);
    pill.setInputOpen(false);
  };

  // Every guard below FAILS SAFE — `return`, never `break`. Breaking would drop
  // a review-outcome scope into the direct-send tail at the bottom, so a stale
  // selectedBlock (the optimistic edit path can reindex blocks underneath us)
  // would turn "you'll review the change" into an unreviewed document edit. That
  // is precisely the regression fixed in a8b14a8. Doing nothing is the correct
  // failure mode here; escalating to the more destructive action is not.
  switch (scope.kind) {
    case "emptyParagraph":
      if (!selectedBlock || selectedBlock.kind !== "paragraph") return;
      // The fill flow lets the model choose prose vs a real table; both come
      // back as an inline proposal.
      void useSuggestionStore.getState().requestFill(thesisId, selectedBlock.index, prompt);
      collapse();
      return;

    case "paragraph":
    case "heading":
      if (!selectedBlock || selectedBlock.kind !== "paragraph") return;
      void useSuggestionStore
        .getState()
        .request(thesisId, selectedBlock.index, selectedBlock.text, prompt);
      collapse();
      return;

    case "image":
      if (!selectedBlock || selectedBlock.kind !== "image") return;
      void useSuggestionStore
        .getState()
        .request(thesisId, selectedBlock.index, selectedBlock.caption ?? "", prompt, "image");
      collapse();
      return;

    case "table":
      if (!selectedBlock || selectedBlock.kind !== "table") return;
      void useTableSuggestionStore.getState().request(thesisId, selectedBlock.index, prompt);
      collapse();
      return;

    case "range":
      // requestRange reads the first and last entry of this array for its span
      // bounds; an empty or single-entry one would hand undefined bounds to
      // applyThesisRangeReplace. tsconfig has no noUncheckedIndexedAccess, so
      // nothing upstream catches that for us.
      if (scopeBlocks.length < 2) return;
      void useSuggestionStore.getState().requestRange(thesisId, scopeBlocks, prompt);
      collapse();
      return;

    case "chrome":
    case "memoir":
    case "scattered":
      break;
  }

  // Reached ONLY by the three intentionally-`direct` scopes above.
  void sendMessageToAI(thesisId, prompt, {
    docBlockIndex: indices.length ? indices[0] : null,
    docBlockIndices: indices.length > 1 ? indices : undefined,
    // Ground the ask on the selected text; whole-memoir asks carry no selection.
    selection: indices.length ? scopeText || undefined : undefined,
  });
  // collapse(), not a bare setExpanded: the ask bar is ALWAYS rendered now, so a
  // direct-outcome send has to clear `inputOpen` too — the old dock's handleAskSend
  // did this unconditionally. Leaving it set strands the target: re-tapping a
  // header/footer band or a mixed multi-selection would reopen the AI dock instead
  // of that target's own formatting toolbar, with no way back until an unrelated
  // block is selected.
  collapse();
  // Only this branch gets the peek card — every `review` branch above returned
  // early and shows its own in-place approve/reject UI instead.
  pill.setAwaitingReply(true);
}
