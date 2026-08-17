// The Lexical → native direction of the bridge: turn the current selection into
// the LexicalState the native pill / AI dock attaches to.
//
// ⚠️ Must be called inside an `editorState.read()` — every $-prefixed helper below
// needs the active editor state bound.

import { $isHeadingNode } from "@lexical/rich-text";
import { $isListItemNode, $isListNode } from "@lexical/list";
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  type ElementNode,
  type LexicalNode,
} from "lexical";

import { $isBlockDataNode, $isChromeNode, $isPageBreakNode } from "../../../blockLexical";
import { $blockIndexOfNode, $nodeAtBlockIndex, $rootChildBlockIndex } from "../../block-index";
import type { LexicalState } from "../../types";

// "Nothing is selected" — the base every report starts from, and the whole report
// for a history-only update (CAN_UNDO / CAN_REDO), where no selection has changed.
export const EMPTY_LEXICAL_STATE: LexicalState = {
  bold: false, italic: false, underline: false,
  blockType: "paragraph", isRTL: false, alignment: null,
  index: -1, text: "", y: -1,
};

// Returns the state to report, plus the node key whose element supplies `y`
// (measured by the caller — getBoundingClientRect is a DOM read, not a state read).
export function $readSelectionState(): { key: string | null; payload: LexicalState } {
  let key: string | null = null;
  let payload: LexicalState = { ...EMPTY_LEXICAL_STATE };
  const done = () => ({ key, payload });

  const sel = $getSelection();
  // A structural block (table/image/other) tapped → NodeSelection on its
  // BlockDataNode. Report it as a single-block selection of THAT block's kind
  // so the native pill shows the image/table/… toolset.
  if ($isNodeSelection(sel)) {
    const nodes = sel.getNodes();
    // A tapped chrome band (section header/footer/section-break) → NodeSelection
    // on its display-only ChromeNode. Report it with a "chrome:"-prefixed
    // blockType so the native side shows the chrome bubble (not a block toolset).
    // Mutually exclusive with the page-band and BlockDataNode paths below (a
    // selection is ONE node): check chrome first, then the page band, else
    // the structural block.
    const cn = nodes.length === 1 && $isChromeNode(nodes[0]) ? nodes[0] : null;
    const pb = nodes.length === 1 && $isPageBreakNode(nodes[0]) ? nodes[0] : null;
    const bd = nodes.length === 1 && $isBlockDataNode(nodes[0]) ? nodes[0] : null;
    if (cn) {
      const cd = cn.getData();
      key = cn.getKey();
      payload = {
        bold: false, italic: false, underline: false,
        blockType: "chrome:" + cd.kind, // "chrome:top" | "chrome:bottom" | "chrome:section"
        isRTL: cd.rtl, alignment: null,
        index: cd.startBlockIndex, text: cd.text,
        blocks: [{ index: cd.startBlockIndex, text: cd.text }],
        y: -1,
      };
    } else if (pb) {
      // A tapped page band. It carries BOTH a header and a footer, so the
      // side the student actually touched decides which we report — then
      // it rides the EXISTING chrome path, so the native sheet, the ✦
      // panel and the template picker all work with no native change.
      const d = pb.getData();
      const side = pb.getPick();
      // A tap on a bare margin — no header / no footer printed on that edge at
      // all — falls back to the zone's own target, which is set whether or not
      // the section has that part. Without it a page with neither reports
      // nothing and the sheet never opens, which is exactly what left those
      // edges dead. A gutter tap carries the SECTION instead, and reports as
      // "chrome:section" — the page view's stand-in for the continuous view's
      // `§ New section` band.
      // The band edge (header / footer), which carries the text that grounds the
      // sheet's AI ask. null for a gutter tap — a section report has no band text;
      // its bubble is all section state, which native reads from doc.sections.
      const edge =
        side === "top" ? (d.header ?? d.topTarget)
          : side === "bottom" ? (d.footer ?? d.bottomTarget)
            : null;
      const part = side === "section" ? d.sectionTarget : edge;
      if (part) {
        key = pb.getKey();
        const text = edge?.text ?? "";
        payload = {
          bold: false, italic: false, underline: false,
          blockType: "chrome:" + side,   // "chrome:top" | "chrome:bottom" | "chrome:section"
          isRTL: d.rtl, alignment: null,
          index: part.startBlockIndex, text,
          blocks: [{ index: part.startBlockIndex, text }],
          y: -1,
        };
      }
    } else if (bd) {
      const idx = $rootChildBlockIndex(bd);
      key = bd.getKey();
      payload = { bold: false, italic: false, underline: false, blockType: bd.getBlock().kind, isRTL: false, alignment: null, index: idx, text: "", blocks: [{ index: idx, text: "" }], y: -1 };
    }
    return done();
  }
  if (!$isRangeSelection(sel)) return done();
  const anchor = sel.anchor.getNode();
  const top = anchor.getKey() === "root" ? null : anchor.getTopLevelElement();
  if (anchor.getKey() !== "root" && !top) return done(); // selection detached (e.g. mid-suggestion)
  let blockType = "paragraph";
  if (top) {
    if ($isHeadingNode(top)) blockType = top.getTag();
    else if ($isListNode(top)) { const lt = top.getListType(); blockType = lt === "bullet" ? "bullet" : lt === "check" ? "check" : "number"; }
    else blockType = top.getType(); // "paragraph" | "quote"
  }
  key = top ? top.getKey() : null;
  // Alignment + direction live on the LIST ITEM (applyBlockFormat targets it),
  // NOT the top-level ListNode — so read the element format from the nearest
  // list-item ancestor when the caret is inside a list, else from `top` itself.
  // Otherwise the align sub-pill's active highlight / RTL state would read the
  // list's (always-unset) format and never reflect the item's real alignment.
  let fmtNode: ElementNode | null = top;
  if (top && $isListNode(top)) {
    let li: LexicalNode | null = anchor;
    while (li && !$isListItemNode(li)) li = li.getParent();
    if ($isListItemNode(li)) fmtNode = li;
  }
  // ElementNode.getFormatType() → "" | "left" | "center" | "right" | "justify" | "start" | "end"
  const fmt = fmtNode ? fmtNode.getFormatType() : "";
  // Every top-level block the selection spans, in document order. A caret or an
  // in-paragraph selection yields ONE entry; a cross-paragraph drag lists them
  // all. We walk the selected nodes (not just the anchor, which stays put while
  // the focus extends downward) so extending a selection grows the set — that's
  // what lets the native side build a MULTI-block selection instead of
  // collapsing everything to the anchor block.
  const spanned: { index: number; text: string }[] = [];
  const seen = new Set<number>();
  for (const n of sel.getNodes()) {
    if (n.getKey() === "root") continue;
    // block-model index (lists expanded), so a list ITEM counts as its own
    // block — not the whole list collapsed to one entry.
    const idx = $blockIndexOfNode(n);
    if (idx < 0 || seen.has(idx)) continue;
    seen.add(idx);
    const node = $nodeAtBlockIndex(idx);
    spanned.push({ index: idx, text: node ? node.getTextContent() : "" });
  }
  spanned.sort((a, b) => a.index - b.index);
  payload = {
    bold: sel.hasFormat("bold"),
    italic: sel.hasFormat("italic"),
    underline: sel.hasFormat("underline"),
    blockType,
    isRTL: !!fmtNode && fmtNode.getDirection() === "rtl",
    alignment: fmt === "left" || fmt === "center" || fmt === "right" || fmt === "justify" ? fmt : null,
    index: $blockIndexOfNode(anchor),
    text: (spanned.find((s) => s.index === $blockIndexOfNode(anchor))?.text) ?? (top ? top.getTextContent() : ""),
    blocks: spanned,
    y: -1,
  };
  return done();
}
