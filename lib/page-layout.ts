// Pure page geometry, pagination and page numbering for the Writer's page view.
//
// PURE ON PURPOSE — no React, no react-native, no DOM. This module holds the two
// rules most likely to be wrong (height accumulation and the divider-numbering
// conventions) and the app has no test runner, so purity is what lets
// scripts/verify-page-layout.mjs check it. Keep it free of imports that need a
// bundler.
//
// Spec: docs/superpowers/specs/2026-08-12-page-view-in-writer-design.md
import type { DocSectionDTO } from "@/lib/api";

/** Word measures in twips: 1440 per inch. CSS is 96px per inch. */
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;
const TWIPS_TO_PX = PX_PER_INCH / TWIPS_PER_INCH;

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

/** The section a block belongs to: the last one starting at or before it. */
export function sectionForBlock(sections: PageSectionInput[], blockIndex: number): number {
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
