// The geometry half of drag-to-reorder: what is where, and which gap is nearest.
//
// Everything here is a pure read — it measures, it never mutates the Lexical
// document. The gesture state machine that consumes it lives in ./ReorderPlugin;
// these are split out because they are the parts that can be reasoned about (and
// re-read) without holding the whole lift closure in your head.

import type { LexicalEditor } from "lexical";

import { $blockEntries, type BlockEntry } from "../../../blockLexical";

// One draggable UNIT: a block entry (a paragraph, or a whole list) with the rect
// it occupied when the drag was armed. `from`/`count` are block-model indices.
export type Ent = { from: number; count: number; top: number; bottom: number; left: number; right: number; rtl: boolean; key: string; el: HTMLElement };

// The live lift. Null until a finger arms one; every field is scratch state for
// the duration of a single gesture.
export type Live = {
  start: { x: number; y: number };
  timer: ReturnType<typeof setTimeout> | null;
  armed: boolean;
  lifted: boolean;
  from: number;
  srcIdx: number;      // index of the dragged unit in `entries`
  srcH: number;        // its full row height incl. the margin below it = the slot size
  entries: Ent[];
  rows: HTMLElement[][]; // per entry: its element + any chrome band trailing it
  gaps: number[];
  shift: number[];     // px currently applied to each row (the slot preview)
  gapIdx: number;      // gap the preview is currently opened at (-1 = none)
  pill: HTMLElement | null;
  line: HTMLElement | null;
  hot: HTMLElement | null;
  raf: number | null;
  lastX: number;
  lastY: number;
};

// Undo the slot preview. Transitions are killed for the reset frame so the
// blocks don't animate back home — on a drop the reseed is about to paint the
// real order, and an eased snap-back reads as the move being rejected.
export function stripEls(els: HTMLElement[]): void {
  const touched = els.filter((el) => el.classList.contains("lx-reorder-shift"));
  for (const el of touched) {
    el.style.transition = "none";
    el.style.transform = "";
    el.classList.remove("lx-reorder-shift");
  }
  for (const el of els) el.classList.remove("lx-reorder-lifted");
  if (touched.length) requestAnimationFrame(() => { for (const el of touched) el.style.transition = ""; });
}

// Measure every draggable unit, plus the gap positions between them (each gap is
// a unit's top, with the last unit's bottom closing the list).
export function buildEntries(editor: LexicalEditor): { rects: Ent[]; gaps: number[] } {
  let entries: BlockEntry[] = [];
  editor.getEditorState().read(() => { entries = $blockEntries(); });
  const rects = entries
    .map((e) => {
      const el = editor.getElementByKey(e.key) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      if (!el || !r) return null;
      const rtl = getComputedStyle(el).direction === "rtl";
      return { from: e.from, count: e.count, top: r.top, bottom: r.bottom, left: r.left, right: r.right, rtl, key: e.key, el };
    })
    .filter(Boolean) as Ent[];
  const gaps = rects.map((r) => r.top);
  if (rects.length) gaps.push(rects[rects.length - 1].bottom);
  return { rects, gaps };
}

// Chrome bands (section breaks, header/footer strips) are NOT block entries, so
// a preview that moved only entry elements would slide text straight across
// them. Group each band with the block it trails: rows then tile the page with
// no gaps, every row height is exactly top-to-top, and the preview shifts whole
// rows — nothing can overlap. Children above the first block never move (gap 0
// means "below the page header", which is where they already are).
export function buildRows(root: HTMLElement, rects: Ent[]): HTMLElement[][] {
  const rows: HTMLElement[][] = rects.map(() => []);
  const idxOf = new Map<HTMLElement, number>();
  rects.forEach((r, i) => idxOf.set(r.el, i));
  let cur = -1;
  for (const child of Array.from(root.children) as HTMLElement[]) {
    const own = idxOf.get(child);
    if (own !== undefined) cur = own;
    if (cur >= 0) rows[cur].push(child);
  }
  return rows;
}

// The unit under a screen-Y, if any.
export const unitAt = (y: number, rects: Ent[]): Ent | null =>
  rects.find((r) => y >= r.top && y <= r.bottom) ?? null;

// The gap nearest a screen-Y → 0..entries.length.
export function gapFor(y: number, gaps: number[]): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < gaps.length; i++) { const d = Math.abs(gaps[i] - y); if (d < bestD) { bestD = d; best = i; } }
  return best;
}

// A gap index → the block-model index a drop there lands on.
export const gapToBlock = (gapIdx: number, rects: Ent[]): number =>
  gapIdx >= rects.length ? (rects.length ? rects[rects.length - 1].from + rects[rects.length - 1].count : 0) : rects[gapIdx].from;
