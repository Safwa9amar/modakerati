// Step 1 of a pagination pass: the block-bearing DOM rows, in order.

import { $isListItemNode, $isListNode } from "@lexical/list";
import { $getRoot, type LexicalEditor, type LexicalNode } from "lexical";

import { $isDisplayOnlyNode, $isPageBreakNode } from "../../../blockLexical";

export type CollectedRows = {
  rows: HTMLElement[];
  // Block index at which each root child's rows begin. A band can only be
  // inserted BETWEEN root children, so these are the only positions a page
  // may legally start at (see the snap in ./build-bands).
  childStart: number[];
  // The bands already in the tree, each keyed by the block index it sits before,
  // so an unchanged layout can skip the write entirely.
  current: string[];
  // A block had no element yet — measuring would attribute heights to the wrong
  // indices, so the caller abandons this pass and waits for the DOM to settle.
  desynced: boolean;
};

export function collectRows(editor: LexicalEditor): CollectedRows {
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
  return { rows, childStart, current, desynced };
}
