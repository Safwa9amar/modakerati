// Pure page geometry, pagination and page numbering for the Writer's page view.
//
// PURE ON PURPOSE — no React, no react-native, no DOM. This module holds the two
// rules most likely to be wrong (height accumulation and the divider-numbering
// conventions) and the app has no test runner, so purity is what lets
// scripts/verify-page-layout.mjs check it. Keep it free of imports that need a
// bundler.
//
// Spec: docs/superpowers/specs/2026-08-12-page-view-in-writer-design.md
import type { AnchoredShape, DocSectionDTO } from "@/lib/api";

/** Word measures in twips: 1440 per inch. CSS is 96px per inch. */
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;
const TWIPS_TO_PX = PX_PER_INCH / TWIPS_PER_INCH;
/** Points → CSS px: 72 per inch vs 96 per inch. */
export const PX_PER_PT = PX_PER_INCH / 72;
/** Word measures DRAWINGS in EMU: 914400 per inch. */
const EMU_PER_INCH = 914400;
const EMU_TO_PX = PX_PER_INCH / EMU_PER_INCH;

/** A4 portrait at 1-inch margins — the fallback when a cached DTO predates
 *  `page`, matching the engine's PAGE_SIZES.A4 and MARGIN_PRESETS.normal. */
const A4_FALLBACK = {
  widthTwips: 11906,
  heightTwips: 16838,
  margins: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 720, footer: 720, gutter: 0 },
};

/** The two numbers pagination actually needs, in CSS pixels. */
export type PageGeometry = {
  /** Width of the text column — the measuring host's width. */
  textColumnPx: number;
  /** Height of the text area on one page: page height less top and bottom margins. */
  contentHeightPx: number;
};

/** Derive pixel geometry from a section's twips. `undefined`/`null` → A4 at 1". */
export function geometryFromSection(page: DocSectionDTO["page"] | undefined): PageGeometry {
  const p = page ?? A4_FALLBACK;
  const m = p.margins;
  return {
    // The gutter is the BINDING allowance — extra width stolen from the text
    // column on the bound edge. These theses are bound, so ignoring it makes
    // every column systematically too wide and under-counts pages.
    textColumnPx: (p.widthTwips - m.left - m.right - (m.gutter ?? 0)) * TWIPS_TO_PX,
    contentHeightPx: (p.heightTwips - m.top - m.bottom) * TWIPS_TO_PX,
  };
}

/** A paragraph's effective typography, resolved by the server through the OOXML
 *  cascade (Task 1 of the page-fidelity pass). Task 6 measures blocks at it. */
export type BlockFmt = {
  sizePt: number;
  line: { rule: "auto" | "exact" | "atLeast"; value: number };
  beforePt: number;
  afterPt: number;
};

/** CSS line-height px for a fmt, given the measured single-line height of the
 *  font at that size ("normal" leading — pass what the probe measured). */
export function lineHeightPx(fmt: BlockFmt, singleLinePx: number): number {
  if (fmt.line.rule === "exact") return fmt.line.value * PX_PER_PT;
  if (fmt.line.rule === "atLeast") return Math.max(singleLinePx, fmt.line.value * PX_PER_PT);
  return fmt.line.value * singleLinePx; // auto: multiplier × the font's real leading
}

export type PaginateInput = {
  /** Measured core height of each block, in document order — including its
   *  space-after, EXCLUDING its space-before, which travels separately so rule
   *  F3 can drop it at a page top. */
  heights: number[];
  /** Space-before per block, px, parallel to `heights`. Counted mid-page and at
   *  a FORCED page top; eaten at a natural one (F3). Absent → all zero. */
  spaceBefore?: number[];
  /** Content height of the page each block would sit on — parallel to `heights`,
   *  because geometry can differ per section. */
  pageContentPx: number[];
  /** Block indices that MUST begin a page (a section with startsOnNewPage). */
  forcedStarts: ReadonlySet<number>;
  /** Blocks that must not END a page (headings — Word's keep-with-next, F2). */
  keepWithNext?: ReadonlySet<number>;
  /** Whether Word could split this block across pages: paragraphs yes;
   *  image/table/textbox no. Absent → nothing splits (the v1 behaviour). */
  splittable?: boolean[];
};

export type PaginateResult = {
  /** Positions in `heights` that START each band-visible page — always
   *  beginning with 0 for a non-empty document. v1's return value, unchanged. */
  starts: number[];
  /** 0-based PHYSICAL page index of each start. Advances by more than one when
   *  the content between two boundaries consumed whole pages no band marks —
   *  a spilling paragraph's middle pages, an image taller than the page. */
  physPage: number[];
  /** Unused px at the bottom of page k — parallel to `starts`, the final page's
   *  entry appended last. 0 where a splittable block carried over: Word fills
   *  that page with the block's first lines. */
  remainder: number[];
};

/**
 * Accumulate block heights into pages, applying Word's break rules.
 *
 * Breaks land BETWEEN blocks, never inside a paragraph — that is the accepted
 * granularity in D1 of the spec; the PDF layer remains the source of exact
 * truth. On top of the v1 accumulator sit three rules, applied in this order at
 * every break:
 *
 * - **F3** — a block opening a page at a NATURAL break sheds its space-before;
 *   a FORCED start (section break) keeps it, matching Word.
 * - **F2** — keep-with-next: while the ended page's last block is a keep block,
 *   moving it leaves the page non-empty, and at most two have moved, it follows
 *   its content onto the new page. The gap it leaves is REAL (never a carry),
 *   and a pull never crosses a forced start — that is a section boundary, and
 *   the page's chrome is looked up from its first block.
 * - **F4** — carry: when the trigger itself opens the new page and Word could
 *   split it, its first lines conceptually filled the page it left (remainder
 *   0) and only the spill opens the new one; whole pages the spill consumes get
 *   no band and advance the physical counter instead. An unsplittable trigger
 *   moves whole, and one taller than the page spans physical pages alone.
 */
export function paginate({
  heights,
  spaceBefore,
  pageContentPx,
  forcedStarts,
  keepWithNext,
  splittable,
}: PaginateInput): PaginateResult {
  if (heights.length === 0) return { starts: [], physPage: [], remainder: [] };

  const starts: number[] = [0];
  const physPage: number[] = [0];
  const remainder: number[] = [];

  const limitAt = (i: number) => pageContentPx[i] || pageContentPx[0] || 1;

  // The page currently being filled. `contribs` records what each block on it
  // actually added to `used` — what F2 needs to move one and shrink the page it
  // leaves. `carryExtra` counts whole physical pages a carry spill consumed
  // before the one `used` accumulates on.
  let used = heights[0]; // F3: block 0 is a natural top — its space-before is eaten.
  let pageLimit = limitAt(0);
  let pageStartPhys = 0;
  let carryExtra = 0;
  let contribs: Array<{ idx: number; px: number }> = [{ idx: 0, px: heights[0] }];

  for (let i = 1; i < heights.length; i++) {
    const limit = limitAt(i);
    const before = spaceBefore?.[i] ?? 0;
    const h = heights[i];
    const forced = forcedStarts.has(i);

    // `used > 0` is what stops an over-tall block looping: it always gets
    // placed, and the NEXT block opens a fresh page.
    if (!forced && !(used > 0 && used + before + h > limit)) {
      used += before + h;
      contribs.push({ idx: i, px: before + h });
      continue;
    }

    // Block i begins a new page.

    // F2 — pull a trailing keep-with-next block (or two) onto the page its
    // content opens. Natural breaks only: never across a section boundary.
    const moved: Array<{ idx: number; px: number }> = [];
    if (!forced && keepWithNext) {
      while (
        contribs.length > 1 && // moving must leave the page non-empty
        moved.length < 2 &&
        keepWithNext.has(contribs[contribs.length - 1].idx)
      ) {
        const m = contribs.pop()!;
        moved.unshift(m);
        used -= m.px;
      }
    }

    // F4 — the trigger carries only when it opens the page itself and splits.
    const carried = !forced && moved.length === 0 && (splittable?.[i] ?? false);

    // Close the ended page. Its content may span several physical pages (a
    // carry's middle pages, an over-tall lone block); the remainder is what is
    // left on the LAST of them, and the next band's physical index counts them
    // all even though no band marks them.
    const endedSheets = carryExtra + Math.max(1, Math.ceil(used / pageLimit));
    remainder.push(carried ? 0 : Math.max(0, (endedSheets - carryExtra) * pageLimit - used));
    const bandPhys = pageStartPhys + endedSheets;

    // Open the new page.
    if (moved.length > 0) {
      // The first mover is the new page's natural top (space-before eaten);
      // everything behind it — the trigger included — is mid-page again.
      contribs = moved.map((m, k) => ({
        idx: m.idx,
        px: k === 0 ? heights[m.idx] : (spaceBefore?.[m.idx] ?? 0) + heights[m.idx],
      }));
      contribs.push({ idx: i, px: before + h });
      used = 0;
      for (const c of contribs) used += c.px;
      carryExtra = 0;
    } else if (carried) {
      // The spill: what ran past the old page's bottom. The space-before sat
      // mid-page THERE, so it counts toward that page's fill.
      const spill = used + before + h - pageLimit;
      carryExtra = Math.max(0, Math.ceil(spill / limit) - 1);
      used = spill - carryExtra * limit;
      contribs = [{ idx: i, px: used }];
    } else {
      // Whole-block move. F3: a natural top eats the space-before; a forced
      // start keeps it (Word preserves it after a section/hard break).
      used = forced ? before + h : h;
      contribs = [{ idx: i, px: used }];
      carryExtra = 0;
    }

    const startIdx = moved.length > 0 ? moved[0].idx : i;
    starts.push(startIdx);
    physPage.push(bandPhys);
    pageStartPhys = bandPhys;
    pageLimit = limitAt(startIdx);
  }

  // The final page's unused bottom.
  const finalSheets = carryExtra + Math.max(1, Math.ceil(used / pageLimit));
  remainder.push(Math.max(0, (finalSheets - carryExtra) * pageLimit - used));

  return { starts, physPage, remainder };
}

/** The per-section facts numbering needs. Built natively; serializable. */
export type PageSectionInput = {
  startBlockIndex: number;
  /** Divider page or ornamented front matter — carries no number by design. */
  unnumbered: boolean;
  /** This section's own w:pgNumType start value, when it restarts numbering. */
  pageNumberStart: number | null;
  /** w:pgNumType vocabulary: "decimal" | "lowerRoman" | "upperRoman" |
   *  "lowerLetter" | "upperLetter". Anything else renders decimal. */
  pageNumberFormat: string;
};

export type PageNumbering = {
  /** The block index this page begins at. */
  startBlockIndex: number;
  sectionIndex: number;
  unnumbered: boolean;
  /** The counter value, or null when the page is unnumbered. */
  number: number | null;
  /** Formatted per the owning section, or null when unnumbered. */
  text: string | null;
};

/** The section a block belongs to: the last one starting at or before it.
 *  Takes only `startBlockIndex` so anchor geometry can reuse it. */
export function sectionForBlock(
  sections: ReadonlyArray<{ startBlockIndex: number }>,
  blockIndex: number,
): number {
  let found = 0;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].startBlockIndex <= blockIndex) found = i;
    else break;
  }
  return found;
}

/**
 * Number the pages.
 *
 * EVERY physical page advances the counter, including an unnumbered one — that
 * is the "divider counted" convention (5, blank-6, 7) and it is what
 * add_divider_pages builds today. The "not counted" convention (5, blank, 6) is
 * nothing but a pageNumberStart restart on the FOLLOWING section, which the
 * reset below already honours. So there is no convention switch here: the Writer
 * renders whichever the .docx encodes and never picks one (spec D7).
 *
 * `physPage` is `paginate()`'s: the counter advances by its delta rather than
 * by 1, so pages consumed INSIDE a tall or spilling block are counted even
 * though no band marks them.
 */
export function numberPages(
  pageStarts: number[],
  physPage: number[],
  sections: PageSectionInput[],
): PageNumbering[] {
  let counter = 1;
  let lastSection = -1;
  return pageStarts.map((startBlockIndex, k) => {
    if (k > 0) {
      const step = physPage[k] - physPage[k - 1];
      counter += step >= 1 ? step : 1; // a malformed delta (NaN, ≤0) degrades to 1
    }
    const sectionIndex = sectionForBlock(sections, startBlockIndex);
    const sec = sections[sectionIndex];
    if (sectionIndex !== lastSection) {
      if (sec && sec.pageNumberStart != null) counter = sec.pageNumberStart;
      lastSection = sectionIndex;
    }
    const unnumbered = !!sec?.unnumbered;
    const value = counter;
    return {
      startBlockIndex,
      sectionIndex,
      unnumbered,
      number: unnumbered ? null : value,
      text: unnumbered ? null : formatPageNumber(value, sec?.pageNumberFormat ?? "decimal"),
    };
  });
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function toRoman(n: number): string {
  let out = "";
  let rest = n;
  for (const [value, sym] of ROMAN) {
    while (rest >= value) { out += sym; rest -= value; }
  }
  return out;
}

/** Word's alphabetic numbering REPEATS the letter past Z: A…Z, AA, BB, CC. */
function toLetter(n: number): string {
  const i = n - 1;
  return String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1);
}

// ── Floating shapes (`<wp:anchor>`) ─────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-08-13-floating-shapes-design.md
//
// Word stores a floating shape's placement in EMU against a page-sized canvas.
// The editor draws the same document into a phone-width column, so every number
// is scaled by `renderedColumnPx / documentColumnPx` — the page view's own
// factor, which is what makes true positioning tractable at all.

/** EMU (914400 per inch) → CSS px (96 per inch), at 100% scale. */
export function emuToPx(emu: number): number {
  return emu * EMU_TO_PX;
}

/** One section's geometry as an anchor needs it, in DOCUMENT px (96dpi). Built
 *  natively (it needs DocSectionDTO) and carried into the 'use dom' editor. */
export type AnchorSectionGeometry = {
  startBlockIndex: number;
  /** `geometryFromSection(section.page).textColumnPx`. */
  textColumnPx: number;
  /** The page margin on the INLINE-START side (RTL → the right margin), which is
   *  how far the text column's start sits from the page edge. Only `x.from:
   *  "page"` needs it. */
  startMarginPx: number;
};

/** What the overlay needs to place one shape over its carrier block's box. */
export type AnchorPlacement = {
  /** Offset from the content box's INLINE START, in rendered px. Applied as
   *  `inset-inline-start` so an Arabic document mirrors (spec). */
  startPx: number;
  /** Offset from the carrier block's TOP, in rendered px. Meaningful only when
   *  `vAlign` is "top". */
  topPx: number;
  /** Word's vertical alignment within the carrier block's box, when the anchor
   *  aligns instead of offsetting. "top" = use `topPx`. */
  vAlign: "top" | "center" | "bottom";
  widthPx: number;
  heightPx: number;
  /** Behind the block's text (0) or over it (2); the text itself sits at 1. */
  zIndex: number;
  /** rendered ÷ document px. The BOX is drawn at this scale, so whatever is
   *  inside it (a text box's type size, its insets) must scale by the same
   *  factor or it overflows a box Word had it fitting inside. */
  scale: number;
};

/**
 * Place one floating shape inside its carrier block's box.
 *
 * `renderedColumnPx` is measured in the DOM (the block's own width); the rest is
 * the document's true geometry. Degradation, all deliberate:
 *
 * - **`align` instead of `posOffset`** (exactly one anchor in the surveyed
 *   thesis — a chart, on BOTH axes) resolves against the text column rather
 *   than landing at 0. `align` is folded onto the same LOGICAL axis as the
 *   offsets, so "left" means inline-start; an RTL document mirrors it.
 * - **`y.from` other than paragraph/line** (one occurrence in a 123-page thesis)
 *   pins to the block top. Applying a PAGE-origin offset to a PARAGRAPH origin
 *   would push the shape hundreds of px down, over unrelated text — a
 *   mispositioned shape is worse than one sitting on its own carrier.
 * - **`x.from: "margin"`** is treated as "column": the body is single-column, so
 *   the margin box and the text column start at the same place.
 */
export function placeAnchor(
  a: AnchoredShape,
  renderedColumnPx: number,
  section: { textColumnPx: number; startMarginPx: number } | undefined,
): AnchorPlacement {
  const docColumnPx = section?.textColumnPx ?? geometryFromSection(undefined).textColumnPx;
  const scale = docColumnPx > 0 ? renderedColumnPx / docColumnPx : 1;
  const widthPx = emuToPx(a.widthEmu) * scale;
  const heightPx = emuToPx(a.heightEmu) * scale;

  // The page edge sits one start-margin BEFORE the text column's start.
  const origin = a.x.from === "page" ? -(section?.startMarginPx ?? 0) * scale : 0;
  const startPx =
    a.x.offsetEmu != null
      ? origin + emuToPx(a.x.offsetEmu) * scale
      : a.x.align === "center"
        ? (renderedColumnPx - widthPx) / 2
        : a.x.align === "right"
          ? renderedColumnPx - widthPx
          : 0;

  const vRelative = a.y.from === "paragraph" || a.y.from === "line";
  const topPx = vRelative && a.y.offsetEmu != null ? emuToPx(a.y.offsetEmu) * scale : 0;
  const vAlign = a.y.offsetEmu != null || !a.y.align ? "top" : a.y.align;

  return { startPx, topPx, vAlign, widthPx, heightPx, zIndex: a.behindDoc ? 0 : 2, scale };
}

/** Render a page number in w:pgNumType vocabulary. Unknown formats → decimal. */
export function formatPageNumber(n: number, format: string): string {
  if (n < 1) return String(n);
  switch (format) {
    case "lowerRoman": return toRoman(n).toLowerCase();
    case "upperRoman": return toRoman(n);
    case "lowerLetter": return toLetter(n).toLowerCase();
    case "upperLetter": return toLetter(n);
    default: return String(n);
  }
}
