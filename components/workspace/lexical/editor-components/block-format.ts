// Whole-block formatting, and rebuilding a block from a suggestion's captured
// original. Both mutate the tree, so both must be called inside an editor.update().

import { $createHeadingNode, $createQuoteNode, $isHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import { $isListItemNode } from "@lexical/list";
import {
  $createParagraphNode,
  $createTextNode,
  $isParagraphNode,
  $isTextNode,
  type ElementFormatType,
  type ElementNode,
} from "lexical";

import { $nodeAtBlockIndex } from "./block-index";
import type { BlockFmtChange } from "./types";

// Whole-block formatting from the native pill (mirror of the server's
// whole-paragraph `format` op): inline marks to every text child, level via a
// paragraph⇄heading swap, alignment/direction on the element.
export function applyBlockFormat(json: string | undefined) {
  let payload: { indices?: number[]; changes?: BlockFmtChange };
  try { payload = JSON.parse(json || "{}"); } catch { return; }
  const indices = payload.indices || [];
  const ch = payload.changes || {};
  for (const idx of indices) {
    const base = $nodeAtBlockIndex(idx);
    // Target paragraphs, headings, AND list items (align/direction/marks all apply
    // to a list item; only the heading swap is paragraph/heading-only).
    if (!base || !($isHeadingNode(base) || $isParagraphNode(base) || $isListItemNode(base))) continue;
    let node: ElementNode = base;
    // level → paragraph⇄heading swap, preserving children + element format/dir
    if (ch.level !== undefined && !$isListItemNode(node)) {
      const wantHead = ch.level >= 1;
      const tag = ("h" + Math.min(ch.level, 6)) as HeadingTagType;
      const isHead = $isHeadingNode(node);
      if (wantHead !== isHead || ($isHeadingNode(node) && node.getTag() !== tag)) {
        const el: ElementNode = wantHead ? $createHeadingNode(tag) : $createParagraphNode();
        el.setFormat(node.getFormatType());
        const d = node.getDirection(); if (d) el.setDirection(d);
        el.append(...node.getChildren());
        node.replace(el);
        node = el;
      }
    }
    if (ch.alignment !== undefined) node.setFormat(ch.alignment as ElementFormatType);
    if (ch.direction !== undefined) node.setDirection(ch.direction);
    // inline marks on every text child (whole-block, matching patchRuns)
    for (const child of node.getChildren()) {
      if (!$isTextNode(child)) continue;
      (["bold", "italic", "underline"] as const).forEach((f) => {
        if (ch[f] !== undefined && child.hasFormat(f) !== ch[f]) child.toggleFormat(f);
      });
      if (ch.color !== undefined) child.setStyle(ch.color == null ? "" : `color: #${String(ch.color).replace(/^#/, "")}`);
      if (ch.clearFormatting) {
        (["bold", "italic", "underline"] as const).forEach((f) => { if (child.hasFormat(f)) child.toggleFormat(f); });
        child.setStyle("");
      }
    }
  }
}

// Rebuild the original block node from a suggestion's captured type/text — used to
// restore it when a proposal is rejected (approve routes through the sync layer,
// which reseeds the whole doc from server truth anyway).
export function rebuildOriginal(text: string, origType: string) {
  const el =
    origType === "h1" || origType === "h2" || origType === "h3"
      ? $createHeadingNode(origType as HeadingTagType)
      : origType === "quote"
        ? $createQuoteNode()
        : $createParagraphNode();
  if (text) el.append($createTextNode(text));
  return el;
}
