// Steps 2 and 3 of a pagination pass: measure at true geometry, paginate, and
// build the PageBreakNode data for every boundary.
//
// The pure geometry it leans on (paginate, numberPages, sectionForBlock) lives in
// @/lib/page-layout and is verifiable off-device: scripts/verify-page-layout.mjs.
// What this file adds is the document-shaped part — snapping a boundary back to a
// root child, scaling measurement px to display px, and resolving each page's
// header / footer / gutter / artwork from its section.

import { type LexicalEditor } from "lexical";

import {
  chromeDrawingFractions,
  duotoneStops,
  numberPages,
  paginate,
  sectionForBlock,
} from "@/lib/page-layout";
import type { PageBreakData } from "../../../blockLexical";
import type { PageSetup } from "../../../../WorkspaceLexicalView";
import { measureBlockHeights } from "../../measure";

export type Bands = {
  boundaries: Map<number, PageBreakData>;
  leading: PageBreakData | null;
  trailing: PageBreakData | null;
  // Serialized band list, for the "did anything actually move?" comparison
  // against CollectedRows.current — re-creating identical nodes would remount
  // every band (a visible flicker) and dirty the editor for nothing.
  next: string[];
  starts: number[];
};

// Returns null when there is nothing to lay out, or when `isCancelled` goes true
// partway (the effect was torn down mid-pass).
export function buildBands(
  editor: LexicalEditor,
  setup: PageSetup,
  rows: HTMLElement[],
  childStart: number[],
  isCancelled: () => boolean,
): Bands | null {
  const sections = setup.sections;
  // 2 ─ Measure at true geometry and paginate.
  // One column width for the whole document: a thesis mixing page sizes
  // mid-document is vanishingly rare, and a per-section width would mean
  // re-laying out the measuring host per block. Page HEIGHT is per-section
  // below, which is the one that actually varies (landscape appendices).
  const columnPx = sections[0].textColumnPx;
  // Typography per block index, from the server's resolution of the OOXML
  // cascade. A block without it (table, image, or a cache predating the
  // field) falls back to the editor's own metrics inside measureBlockHeights.
  const blockFmts = setup.blockFmts ?? [];
  const results = measureBlockHeights(rows, columnPx, setup.rtl, blockFmts);
  const heights = results.map((r) => r.h);
  const spaceBefore = results.map((r) => r.before);
  const pageContentPx = rows.map((_, i) => sections[sectionForBlock(sections, i)].contentHeightPx);
  const forcedStarts = new Set(
    sections.filter((s) => s.startsOnNewPage && s.startBlockIndex > 0).map((s) => s.startBlockIndex),
  );
  // `remainder` is deliberately unused until Task 8 renders the spacer.
  const raw = paginate({
    heights,
    spaceBefore,
    pageContentPx,
    forcedStarts,
    // A heading is never left at the bottom of a page — Word's built-in
    // heading styles all carry keep-with-next.
    keepWithNext: new Set(setup.keepWithNext ?? []),
    // Only a paragraph splits across pages in Word; a table, an image or a
    // text box moves whole. Having typography IS being a paragraph.
    splittable: rows.map((_, i) => blockFmts[i] != null),
  });

  // A page may only START where a root child does. Pagination works in block
  // space, where a list is many indices, so a break can land BETWEEN two list
  // items — and a band inserted there would sit inside the <ul>, malforming
  // it (the same structural rule that makes RangeSuggestionPlugin decline a
  // list range). Snap such a boundary back to the list's first block: the
  // list travels whole to the next page, which is also what Word does when
  // its items are kept together.
  const snapToChild = (b: number) => {
    let s = 0;
    for (const c of childStart) { if (c <= b) s = c; else break; }
    return s;
  };
  const starts: number[] = [];
  const physPage: number[] = [];
  // `raw.remainder` is parallel to `raw.starts` — entry k is the unused space
  // at the foot of the page STARTING at starts[k]. It has to be carried
  // through the snap in lockstep or a page inherits another page's whitespace.
  const remainder: number[] = [];
  for (let k = 0; k < raw.starts.length; k++) {
    const s = k === 0 ? 0 : snapToChild(raw.starts[k]);
    // Snapping can collapse a boundary onto the page before it — that page
    // simply absorbs the list rather than splitting it. The merged page now
    // ends where THIS one ended, so it takes this page's remainder; it still
    // begins where the earlier one did, so its physical index is unchanged.
    if (k > 0 && s <= starts[starts.length - 1]) {
      remainder[remainder.length - 1] = raw.remainder[k] ?? 0;
      continue;
    }
    starts.push(s);
    physPage.push(raw.physPage[k]);
    remainder.push(raw.remainder[k] ?? 0);
  }
  // Measurement px → display px. The bands render in the editor's narrower
  // column, so the room left on a page has to shrink by the same ratio the
  // text did. Capped: a nearly-empty page would otherwise scroll for a screen
  // and a half of blank paper, which reads as a bug rather than as Word.
  const renderedColumnPx = editor.getRootElement()?.clientWidth ?? columnPx;
  const displayScale = columnPx > 0 ? renderedColumnPx / columnPx : 1;
  // A section Word centres VERTICALLY (`w:vAlign="center"`) — every chapter
  // divider is one. Its page is mostly blank BY DESIGN, so the 240px cap below
  // must not apply to it: capping shrinks the room the title is centred inside
  // and pulls it back toward the top of the page, which is the very thing this
  // is here to fix.
  const vCentredPage = (k: number) => !!sections[sectionForBlock(sections, starts[k])]?.verticalCenter;
  const remainderDisplay = (k: number) => {
    const px = Math.round(((remainder[k] ?? 0) * displayScale) / 4) * 4;
    return vCentredPage(k) ? px : Math.min(240, px);
  };
  // Two kinds of page put their leftover room in the MIDDLE rather than all at
  // the foot, and the flow's own answer — content hard against the top — is the
  // one thing neither of them is:
  //
  // - A whole section Word centres vertically (`w:vAlign="center"`). Every
  //   divider page add_divider_pages builds is one, and Word paints its label,
  //   rule and title in the true middle of the sheet.
  // - A single picture Word centres ON THE PAGE (set_image_layout with
  //   vertical:"center"), which Word does not lay out in the flow at all.
  //
  // Either way: split the page's leftover room in two and put half above. For a
  // picture that is the SAME total blank the page already showed, just
  // distributed the way Word distributes it (its 240px cap stands — halving a
  // capped remainder still reads as centred, and uncapping would bring back the
  // screen and a half of blank paper the cap exists to prevent). A vertically
  // centred section shows its room in full — see remainderDisplay.
  const pageCentered = new Set(setup.pageCentered ?? []);
  const centredPage = (k: number) => {
    if (vCentredPage(k)) return true;
    if (pageCentered.size === 0) return false;
    const end = k + 1 < starts.length ? starts[k + 1] : rows.length;
    for (let b = starts[k]; b < end; b++) if (pageCentered.has(b)) return true;
    return false;
  };
  const leadDisplay = (k: number) => (centredPage(k) ? Math.round(remainderDisplay(k) / 2 / 4) * 4 : 0);
  const tailDisplay = (k: number) => remainderDisplay(k) - leadDisplay(k);
  const numbering = numberPages(starts, physPage, sections);
  if (isCancelled() || numbering.length === 0) return null;

  // 3 ─ Build the node data.
  //     An unnumbered page shows NOTHING on the paper — that is the whole
  //     point of a divider — so its footer is dropped even when the section
  //     has one, and the gutter NAMES it rather than numbering it.
  const footerFor = (page: (typeof numbering)[number]) => {
    const sec = sections[page.sectionIndex];
    if (!sec?.footer || page.unnumbered) return null;
    // A footer with no text and no page number prints NOTHING, so the paper must
    // show nothing — an empty band strip would be the app inventing a line Word
    // won't draw. This is the shape "remove the footer" leaves behind: the part
    // stays (dropping the reference would make the section inherit the previous
    // section's footer, which is the opposite of removing it) and it is bare.
    if (!sec.footer.text.trim() && !sec.footer.hasPageNumbers) return null;
    return {
      text: sec.footer.text,
      pageText: sec.footer.hasPageNumbers ? page.text : null,
      sectionIndex: page.sectionIndex,
      startBlockIndex: sec.startBlockIndex,
    };
  };
  const headerFor = (page: (typeof numbering)[number]) => {
    const sec = sections[page.sectionIndex];
    if (!sec?.header) return null;
    return {
      text: sec.header.text,
      segments: sec.header.segments,
      border: sec.header.border,
      sectionIndex: page.sectionIndex,
      startBlockIndex: sec.startBlockIndex,
    };
  };
  // Artwork behind the page BEGINNING after this band, as fractions of the
  // sheet. Deliberately NOT resolved to px here: the band knows its own
  // width and its page's measured height, and those are what Word's ratios
  // have to be re-scaled against.
  const artworkFor = (page: (typeof numbering)[number]) => {
    const sec = sections[page.sectionIndex];
    const drawings = sec?.headerDrawings ?? [];
    if (!drawings.length || !sec?.chromeGeo) return undefined;
    const geo = sec.chromeGeo;
    const pageAspect = geo.pageWidthPx > 0 ? geo.pageHeightPx / geo.pageWidthPx : 1.414;
    return drawings.map((d) => ({
      dataUri: d.dataUri!, // buildPageSetup keeps only drawings that have one
      ...chromeDrawingFractions(d, geo),
      pageAspect,
      duotone: duotoneStops(d.duotone),
      alt: d.descr ?? "",
    }));
  };
  const gutterFor = (page: (typeof numbering)[number]) => {
    if (!page.unnumbered) return setup.gutterNumberTemplate.replace("{{n}}", page.text ?? "");
    return sections[page.sectionIndex]?.unnumberedKind === "divider"
      ? setup.gutterDividerLabel
      : setup.gutterOrnamentLabel;
  };
  // Does the page beginning after this gutter open a new Word section? Then the
  // gutter IS the section marker (the continuous view's `§ New section` band has
  // no counterpart here — see PageBreakBand) and a tap opens the section bubble.
  // Compared against the PREVIOUS page's section rather than against
  // startBlockIndex, so a continuous break that lands mid-page still gets its one
  // marker, on the first page that shows the new section's chrome. Never section
  // 0: there is no previous section to link it to.
  const sectionTargetFor = (page: (typeof numbering)[number], prev: (typeof numbering)[number]) => {
    if (page.sectionIndex === 0 || page.sectionIndex === prev.sectionIndex) return null;
    const sec = sections[page.sectionIndex];
    if (!sec) return null;
    // SectionTools matches this against sections[].startBlockIndex to place the
    // section, so it must be the section's own start, not a block inside it.
    return { sectionIndex: page.sectionIndex, startBlockIndex: sec.startBlockIndex };
  };
  // Where a tap on a page's blank TOP / BOTTOM margin goes — set whether or not
  // the section actually has a header or footer there. A section with NEITHER
  // used to render nothing tappable at all on those edges, which left the
  // student no way into the header/footer sheet for that page; the margin strip
  // is that way in now (see PageBreakBand's zones), the way Word gives it to a
  // double-click. Set even on an unnumbered page, whose footer the paper never
  // prints: a divider with no page number is still a section whose footer can be
  // asked for.
  const topTargetFor = (page: (typeof numbering)[number]) => {
    const sec = sections[page.sectionIndex];
    if (!sec) return null;
    return { sectionIndex: page.sectionIndex, startBlockIndex: sec.startBlockIndex, text: sec.header?.text ?? "" };
  };
  const bottomTargetFor = (page: (typeof numbering)[number]) => {
    const sec = sections[page.sectionIndex];
    if (!sec) return null;
    return { sectionIndex: page.sectionIndex, startBlockIndex: sec.startBlockIndex, text: sec.footer?.text ?? "" };
  };

  // Boundaries sit immediately BEFORE the first block of each page after
  // the first.
  const boundaries = new Map<number, PageBreakData>();
  for (let p = 1; p < starts.length; p++) {
    boundaries.set(starts[p], {
      variant: "boundary",
      endingPage: numbering[p - 1].number ?? 0,
      footer: footerFor(numbering[p - 1]),
      header: headerFor(numbering[p]),
      gutterLabel: gutterFor(numbering[p]),
      sectionTarget: sectionTargetFor(numbering[p], numbering[p - 1]),
      topTarget: topTargetFor(numbering[p]),
      bottomTarget: bottomTargetFor(numbering[p - 1]),
      remainderPx: tailDisplay(p - 1),
      leadPx: leadDisplay(p),
      rtl: setup.rtl,
      artwork: artworkFor(numbering[p]),
    });
  }
  // The edge nodes: a boundary separates two pages, so without these the
  // FIRST page would have no header and the LAST no footer.
  const first = numbering[0];
  const last = numbering[numbering.length - 1];
  const firstHeader = headerFor(first);
  const firstArtwork = artworkFor(first);
  const lastFooter = footerFor(last);
  // The cover page's frame reaches the paper only through this leading band —
  // there is no boundary above page 1 to carry it.
  // …and the leading band is also the only place page ONE's top padding can
  // go, so a first page that centres a picture needs one even with no header.
  // The tap targets keep both edge bands alive even when there is no chrome to
  // draw: page one's top margin and the last page's bottom margin are the only
  // places those two pages can be reached from, and a band that isn't there
  // can't be tapped.
  const firstLead = leadDisplay(0);
  const firstTop = topTargetFor(first);
  const lastBottom = bottomTargetFor(last);
  const leading: PageBreakData | null = firstHeader || firstLead > 0 || firstTop
    ? { variant: "leading", endingPage: 0, footer: null, header: firstHeader,
        gutterLabel: "", sectionTarget: null, topTarget: firstTop, bottomTarget: null,
        remainderPx: 0, leadPx: firstLead, rtl: setup.rtl,
        artwork: firstArtwork }
    : null;
  const trailing: PageBreakData | null = lastFooter || lastBottom
    ? { variant: "trailing", endingPage: last.number ?? 0, footer: lastFooter, header: null,
        gutterLabel: "", sectionTarget: null, topTarget: null, bottomTarget: lastBottom,
        remainderPx: tailDisplay(numbering.length - 1), leadPx: 0, rtl: setup.rtl }
    : null;

  // The serialized band list the caller compares against what is already in the
  // tree. It must list EVERY band it will write — a band left out here can never
  // compare equal, so the plugin would rewrite the whole run on every pass.
  const next: string[] = [];
  if (leading) next.push(`0|${JSON.stringify(leading)}`);
  for (let p = 1; p < starts.length; p++) next.push(`${starts[p]}|${JSON.stringify(boundaries.get(starts[p]))}`);
  if (trailing) next.push(`${rows.length}|${JSON.stringify(trailing)}`);

  return { boundaries, leading, trailing, next, starts };
}
