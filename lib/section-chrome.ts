// Reading a Word section's page chrome the way the PAPER reads it.
//
// Both the writer and the header/footer sheet ask the same two questions of
// DocumentDTO.sections — which section owns this block, and does that section
// actually put anything on this page edge — and they must answer them
// identically or the page and the sheet disagree about what exists. Lives here
// rather than in either of them: the sheet is mounted at the app root and the
// writer imports the sheet, so a helper in the writer would close a cycle.

import type { DocSectionDTO } from "./api";

/**
 * The section CONTAINING `index`, by range — the same resolution the server's
 * /chrome-op does with the block index the app sends it.
 *
 * A band's index is a block *inside* its section, not necessarily its first
 * (a footer band anchors to the section's LAST block), so this can't be a
 * lookup by startBlockIndex.
 */
export function sectionAt(sections: DocSectionDTO[] | undefined, index: number): DocSectionDTO | null {
  if (!sections) return null;
  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].startBlockIndex;
    const end = sections[i + 1]?.startBlockIndex ?? Number.POSITIVE_INFINITY;
    if (index >= start && index < end) return sections[i];
  }
  return null;
}

/**
 * Does this section actually PRINT anything on that page edge?
 *
 * Owning a header/footer part is not the same as showing one. Removing a header
 * empties its part rather than dropping the section's reference to it — dropping
 * the reference is Word's "same as the previous section", which would bring the
 * previous header back instead of clearing this one — so a section can own a part
 * that draws nothing at all. Everything that decides whether to draw a band, or
 * to offer "add" instead of "edit", has to read the part the way the paper does.
 *
 * A part that is only a PICTURE counts as printing: a running head can be a
 * university logo with no text, and a cover frame lives in an otherwise empty
 * header part.
 */
export function sectionPrints(section: DocSectionDTO | null | undefined, side: "top" | "bottom"): boolean {
  if (!section) return false;
  if (side === "top") {
    const h = section.header;
    if (!h) return false;
    return !!(h.text.trim() || h.segments.join("").trim() || h.border?.bottom || h.drawings?.length);
  }
  const f = section.footer;
  if (!f) return false;
  return !!(f.text.trim() || f.pageNumbers || f.drawings?.length);
}
