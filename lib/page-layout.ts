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

export type PaginateInput = {
  /** Measured height of each block, in document order, including its bottom margin. */
  heights: number[];
  /** Content height of the page each block would sit on — parallel to `heights`,
   *  because geometry can differ per section. */
  pageContentPx: number[];
  /** Block indices that MUST begin a page (a section with startsOnNewPage). */
  forcedStarts: ReadonlySet<number>;
};

/**
 * Accumulate block heights into pages.
 *
 * Returns the positions in `heights` that START each page — always beginning
 * with 0 for a non-empty document. Breaks land BETWEEN blocks, never inside a
 * paragraph, so a page under-fills by up to one block's height and the error
 * accumulates down the document. That is the accepted inaccuracy in D1 of the
 * spec; the PDF layer remains the source of exact truth.
 *
 * A block taller than a whole page occupies one alone rather than looping.
 */
export function paginate({ heights, pageContentPx, forcedStarts }: PaginateInput): number[] {
  if (heights.length === 0) return [];
  const starts: number[] = [0];
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    const limit = pageContentPx[i] || pageContentPx[0] || 1;
    const forced = i > 0 && forcedStarts.has(i);
    // `used > 0` is what stops an over-tall block looping: it always gets placed,
    // and the NEXT block opens a fresh page.
    if (forced || (used > 0 && used + heights[i] > limit)) {
      starts.push(i);
      used = heights[i];
      continue;
    }
    used += heights[i];
  }
  return starts;
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
 */
export function numberPages(pageStarts: number[], sections: PageSectionInput[]): PageNumbering[] {
  let counter = 1;
  let lastSection = -1;
  return pageStarts.map((startBlockIndex) => {
    const sectionIndex = sectionForBlock(sections, startBlockIndex);
    const sec = sections[sectionIndex];
    if (sectionIndex !== lastSection) {
      if (sec && sec.pageNumberStart != null) counter = sec.pageNumberStart;
      lastSection = sectionIndex;
    }
    const unnumbered = !!sec?.unnumbered;
    const value = counter;
    counter += 1;
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
