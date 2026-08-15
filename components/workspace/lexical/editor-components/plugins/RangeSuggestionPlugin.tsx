// A pending RANGE proposal — a multi-block dynamic rewrite.

import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { ListNode } from "@lexical/list";
import { mergeRegister } from "@lexical/utils";
import {
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  type LexicalNode,
  SKIP_DOM_SELECTION_TAG,
} from "lexical";
import {
  $createRangeSuggestionNode,
  $isRangeSuggestionNode,
  RANGE_AGAIN_COMMAND,
  RANGE_APPROVE_COMMAND,
  RANGE_EDIT_COMMAND,
  RANGE_REJECT_COMMAND,
  type RangeData,
  type RangeOriginal,
  RangeSuggestionNode,
} from "../../blockLexical";
import { $anyNodeAtBlockIndex } from "../block-index";
import { withScrollPinned } from "../lexical-updates";
import type { RangeSuggestionInput } from "../types";

// Renders a pending RANGE proposal (multi-block dynamic rewrite) IN PLACE OF the
// selected range: it replaces blocks [start..end] with ONE RangeSuggestionNode
// showing the rewritten passage (1..N paragraphs). Approve/Reject/Again/Edit dispatch
// commands that call back to `onRangeAction`. On clear it settles in place — approve
// → the proposed paragraphs (the doc reseed then applies server truth), reject →
// the captured originals (no reseed). Driven by the native suggestion store's `range`.
export function RangeSuggestionPlugin({
  rangeSuggestion,
  onRangeAction,
}: {
  rangeSuggestion?: RangeSuggestionInput;
  onRangeAction?: (action: string, text?: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Which action cleared the range — decides the clear behavior: approve reseeds
  // from server truth (nothing to do here); reject restores the originals in place.
  const lastActionRef = useRef<string>("");
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(RANGE_APPROVE_COMMAND, (keptText) => { lastActionRef.current = "approve"; onRangeAction?.("approve", keptText); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(RANGE_REJECT_COMMAND, () => { lastActionRef.current = "reject"; onRangeAction?.("reject"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(RANGE_AGAIN_COMMAND, () => { onRangeAction?.("again"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(RANGE_EDIT_COMMAND, (text) => { onRangeAction?.("edit", text); return true; }, COMMAND_PRIORITY_LOW),
      ),
    [editor, onRangeAction],
  );

  const r = rangeSuggestion;
  const active = !!r && r.start >= 0;
  const key = active ? `${r!.start}:${r!.end}:${r!.status}:${r!.proposed.length}:${r!.reasoning.length}` : "";
  useEffect(() => {
    // Does a range node currently exist? Decides create (structural) vs stream.
    // ── Cleared ──────────────────────────────────────────────────────────────
    // Do NOTHING to the editor here — a reseed from authoritative truth settles it:
    // APPROVE → approveRange published the applied doc (the sync layer reseeds the
    // whole editor to it); REJECT → onRangeAction forces a reseed from the current
    // (unchanged) doc, restoring the originals WITH their formatting. Mutating in
    // place here would (a) fire a spurious auto-save that races the reseed — the
    // revert bug — and (b) rebuild the originals as PLAIN text, losing runs/alignment.
    if (!active || !r) { lastActionRef.current = ""; return; }

    // ── Active: create the node, or stream into the existing one ──────────────
    let hasNode = false;
    editor.getEditorState().read(() => { hasNode = !!$getRoot().getChildren().find($isRangeSuggestionNode); });
    const mutate = () => {
      const root = $getRoot();
      const existing = root.getChildren().find($isRangeSuggestionNode) as RangeSuggestionNode | undefined;
      const data: RangeData = { original: r.original, proposed: r.proposed, status: r.status, instruction: r.instruction, reasoning: r.reasoning, reasoningMs: r.reasoningMs };
      if (existing) { existing.getWritable().__data = data; return; } // stream in place
      // Create: replace blocks [start..end] with ONE range node.
      //
      // r.start/r.end are BLOCK-MODEL indices. Root-child positions are NOT the
      // same space, and they diverge in both directions: a display-only node (a
      // chrome band, a page boundary) adds a position the block model doesn't
      // have, while a list collapses many block indices into ONE child. Indexing
      // getChildren() with them therefore removed and REPLACED the wrong nodes —
      // destructively, on any document with a band or a list above the range.
      //
      // Resolve to real nodes through the block-model mapper instead, and collect
      // them all BEFORE mutating: the removals below change the child list, and a
      // walk must not read a list it is editing.
      const originals: RangeOriginal[] = r.originalBlocks;
      if (r.start < 0 || r.end < r.start) return;
      const targets: LexicalNode[] = [];
      for (let i = r.start; i <= r.end; i++) {
        const n = $anyNodeAtBlockIndex(i);
        if (n && !targets.some((t) => t.getKey() === n.getKey())) targets.push(n);
      }
      if (targets.length === 0) return;
      // Every target must be a direct child of the root. A list item is not: it
      // lives inside a ListNode, so replacing it with a block-level decorator
      // would leave a malformed list (and emptying the list would strand it).
      // Refusing to show the proposal is strictly better than mangling the
      // student's document — the range tools already handle a null result.
      const rootKey = root.getKey();
      if (!targets.every((n) => n.getParent()?.getKey() === rootKey)) {
        console.warn("[range] proposal spans non-top-level blocks (a list?) — not rendering it");
        return;
      }
      $setSelection(null);
      for (let i = targets.length - 1; i > 0; i--) targets[i].remove();
      targets[0].replace($createRangeSuggestionNode(data, originals));
    };
    // Create is structural (pin scroll + blur); a pure stream update isn't.
    if (!hasNode) withScrollPinned(editor, mutate, true);
    else editor.update(mutate, { tag: SKIP_DOM_SELECTION_TAG });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
