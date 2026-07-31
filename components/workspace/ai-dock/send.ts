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

  switch (scope.kind) {
    case "emptyParagraph":
      if (!selectedBlock) break;
      // The fill flow lets the model choose prose vs a real table; both come
      // back as an inline proposal.
      void useSuggestionStore.getState().requestFill(thesisId, selectedBlock.index, prompt);
      collapse();
      return;

    case "paragraph":
    case "heading":
      if (!selectedBlock || selectedBlock.kind !== "paragraph") break;
      void useSuggestionStore
        .getState()
        .request(thesisId, selectedBlock.index, selectedBlock.text, prompt);
      collapse();
      return;

    case "image":
      if (!selectedBlock || selectedBlock.kind !== "image") break;
      void useSuggestionStore
        .getState()
        .request(thesisId, selectedBlock.index, selectedBlock.caption ?? "", prompt, "image");
      collapse();
      return;

    case "table":
      if (!selectedBlock) break;
      void useTableSuggestionStore.getState().request(thesisId, selectedBlock.index, prompt);
      collapse();
      return;

    case "range":
      void useSuggestionStore.getState().requestRange(thesisId, scopeBlocks, prompt);
      collapse();
      return;

    case "chrome":
    case "memoir":
    case "scattered":
      break;
  }

  // Every `direct` outcome, plus any defensive fall-through above.
  void sendMessageToAI(thesisId, prompt, {
    docBlockIndex: indices.length ? indices[0] : null,
    docBlockIndices: indices.length > 1 ? indices : undefined,
    // Ground the ask on the selected text; whole-memoir asks carry no selection.
    selection: indices.length ? scopeText || undefined : undefined,
  });
  pill.setExpanded(false);
  // Only this branch gets the peek card — every `review` branch above returned
  // early and shows its own in-place approve/reject UI instead.
  pill.setAwaitingReply(true);
}
