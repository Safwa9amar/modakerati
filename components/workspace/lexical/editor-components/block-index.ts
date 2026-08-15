// ── Block-model ⇄ Lexical index mapping ──────────────────────────────────────
//
// The single home for the walkers that translate between the two indexes. A
// Lexical LIST groups N item-paragraphs into ONE root child, but the block model
// (and $lexicalToBlocks) keeps them SEPARATE — so a node's block-model index ≠
// its Lexical root position once a list exists. The native tools target
// block-model indices, so map them to the real node.
//
// ⚠️ Every walk here skips $isDisplayOnlyNode — chrome bands AND page boundaries
// are top-level root children the block model excludes. Using $isChromeNode
// instead (it answers a narrower question) puts every index past a page break off
// by N, which is exactly how two shipped regressions happened.

import { $isListItemNode, $isListNode, type ListItemNode, type ListNode } from "@lexical/list";
import { $isHeadingNode } from "@lexical/rich-text";
import {
  $getRoot,
  $isParagraphNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";

import { $isDisplayOnlyNode } from "../blockLexical";

export function listItemsOf(list: ListNode): ListItemNode[] {
  return list.getChildren().filter($isListItemNode) as ListItemNode[];
}
export function $nodeAtBlockIndex(idx: number): ElementNode | null {
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if ($isListNode(child)) {
      const items = listItemsOf(child);
      if (idx < acc + items.length) return items[idx - acc];
      acc += items.length;
    } else {
      if (idx === acc) return $isHeadingNode(child) || $isParagraphNode(child) ? (child as ElementNode) : null;
      acc += 1;
    }
  }
  return null;
}
// Like $nodeAtBlockIndex, but returns the node at `idx` REGARDLESS of kind —
// including a structural BlockDataNode (table/image/other), which $nodeAtBlockIndex
// deliberately skips (it only yields editable heading/paragraph/list-item nodes).
// Used for scroll-into-view, where we just need the element to scroll to, so
// navigating to a table or figure from the outline drawer works too.
export function $anyNodeAtBlockIndex(idx: number): LexicalNode | null {
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if ($isListNode(child)) {
      const items = listItemsOf(child);
      if (idx < acc + items.length) return items[idx - acc];
      acc += items.length;
    } else {
      if (idx === acc) return child;
      acc += 1;
    }
  }
  return null;
}
// Block-model index (lists expanded) of a DIRECT root child — e.g. a structural
// BlockDataNode (table/image/other) that a NodeSelection targets.
export function $rootChildBlockIndex(node: LexicalNode): number {
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if (child === node) return acc;
    acc += $isListNode(child) ? listItemsOf(child).length : 1;
  }
  return -1;
}

// Block-model index (lists expanded) of the block CONTAINING a node — its list
// item if it sits inside a list, else its top-level element. -1 if detached.
export function $blockIndexOfNode(node: LexicalNode): number {
  const top = node.getKey() === "root" ? null : node.getTopLevelElement();
  if (!top) return -1;
  let item: LexicalNode | null = node;
  while (item && !$isListItemNode(item)) item = item.getParent();
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if (child === top) {
      if ($isListNode(top) && $isListItemNode(item)) acc += listItemsOf(top).indexOf(item);
      return acc;
    }
    acc += $isListNode(child) ? listItemsOf(child).length : 1;
  }
  return -1;
}
