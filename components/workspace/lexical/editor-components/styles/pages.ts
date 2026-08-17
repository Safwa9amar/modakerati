// Page view: the offscreen measuring host, the page boundary (footer / gutter /
// header) and the decorative page artwork.

export const CSS_PAGES = `
/* Offscreen measuring host for the page view. Content is rendered here at TRUE
   A4 text-column width, in the document's own point sizes, purely to learn how
   tall each block is on a real page — the visible editor keeps writing-size text.
   visibility:hidden, NEVER display:none: a display:none subtree reports zero
   heights and every page would hold the whole document. */
.lx-measure {
  position: absolute; left: -10000px; top: 0;
  visibility: hidden; pointer-events: none;
  font-family: sans-serif; color: #1a1a1a;
}
.lx-measure * { max-width: none; }

/* ── Page boundary: footer, gutter, header ────────────────────────────────── */
.lx-pagebreak-host { user-select: none; -webkit-user-select: none; }
.lx-pagebreak { margin: 0 -18px; }            /* bleed past .lx-content padding to the paper edge */
.lx-pb-footer { padding: 10px 18px 14px; text-align: center; cursor: pointer;
  box-shadow: 0 6px 8px -8px rgba(0,0,0,.35); }
.lx-pb-footer-txt { font-size: 12px; color: #3a3a46; }
.lx-pb-gutter { height: 17px; background: #dcdde3; display: flex; align-items: center;
  justify-content: center; }
.lx-pb-gutter-lbl { font-size: 9.5px; font-weight: 700; color: #979daa; letter-spacing: .04em; }
/* This boundary is also where a new Word section begins — the page view's section
   marker. Tappable (it opens the section bubble), and a shade darker so the § reads
   as something you can touch rather than another page label. */
.lx-pb-gutter-sec { background: #cfd1da; cursor: pointer; }
.lx-pb-gutter-sec .lx-pb-gutter-lbl { color: #6f7486; }
.lx-pb-gutter-sec:active { background: #c3c6d2; }
.lx-pb-header { padding: 13px 18px 5px; cursor: pointer;
  box-shadow: 0 -6px 8px -8px rgba(0,0,0,.35); }
.lx-pb-header-row { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; }

/* The blank top / bottom margin of a page that has no header / footer to show:
   bare paper, but the way IN to the header/footer sheet for that page — the same
   place Word takes a double-click. It prints nothing, so it draws nothing except
   the page-edge shadow its missing sibling would have cast; :active is the only
   affordance, and it is there so a tap on empty paper still feels answered. */
.lx-pb-zone { height: 30px; cursor: pointer; }
.lx-pb-zone-b { box-shadow: 0 6px 8px -8px rgba(0,0,0,.35); }
.lx-pb-zone-t { box-shadow: 0 -6px 8px -8px rgba(0,0,0,.35); }
.lx-pb-zone:active { background: rgba(60,64,90,.055); }

/* Page artwork (a decorative header frame). Zero-height and non-clipping, so its
   children hang DOWN over the page that begins after this band; the band's own
   bottom edge is that page's content-box origin. Never interactive and never
   selectable — it is paper, not content.

   z-index:-1 is what makes it Word's "Behind Text" rather than a sticker over
   the student's writing: CSS paints a positioned element ABOVE inline text, so
   document order alone would put the frame on top of every word. A negative
   z-index drops it below text and block backgrounds — and .lx-root isolates so
   that it stops there instead of sliding behind the paper itself and vanishing.
   Left/top are PHYSICAL: page art is not mirrored for RTL (see page-layout). */
.lx-pb-art { position: relative; height: 0; overflow: visible;
  pointer-events: none; user-select: none; -webkit-user-select: none; }
.lx-pb-art-img { position: absolute; z-index: -1; max-width: none; object-fit: fill;
  -webkit-user-drag: none; user-drag: none; }
/* Carrier for the duotone filter definitions — never painted itself. Absolute
   so it cannot add a stray line box to the band's height. */
.lx-pb-art-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
`;
