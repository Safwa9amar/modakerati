// The document surface: the measuring font-face, the page column, typography,
// lists and the checklist, plus the persistent multi-block selection highlight
// and the tappable structural block.

import { BRAND, BRAND_RGB } from "./brand";

// Metric twin of Times New Roman (SIL OFL). MEASUREMENT ONLY — display keeps the
// reading font. Required here so the 'use dom' bundler carries it into www.bundle.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LIBERATION_REGULAR = require("../../../../assets/fonts/LiberationSerif-Regular.ttf");
const LIBERATION_BOLD = require("../../../../assets/fonts/LiberationSerif-Bold.ttf");

export const CSS_BASE = `
/* Metric twin of Times New Roman, used ONLY by the offscreen .lx-measure host
   (see below) so block heights match where Word would actually wrap — never
   applied to the visible, readable-size editor content. */
@font-face { font-family: "Liberation Serif"; src: url("${LIBERATION_REGULAR}"); font-weight: 400; }
@font-face { font-family: "Liberation Serif"; src: url("${LIBERATION_BOLD}"); font-weight: 700; }
/* Use the GENERIC sans-serif keyword, inherited by all content, NOT concrete
   font names: on this WebView a concrete-first stack (Roboto/-apple-system/…)
   fails to fall back to an Arabic font and renders .notdef tofu, whereas the
   generic keyword chains to the system Arabic font (verified on-device). */
/* The PAGE never scrolls sideways — a wide table (min-content wider than the
   viewport) otherwise widens the document and the WKWebView pans the WHOLE
   editor horizontally, cutting body text off at the edges. Wide content scrolls
   INSIDE its own overflow-x container (the tables' ScrollWrap) instead. */
html, body { max-width: 100vw; overflow-x: hidden; }
/* isolation:isolate makes this the stacking context page artwork sits inside.
   Without it, .lx-pb-art-img's z-index:-1 would escape to the document root and
   paint BEHIND this element's white background — the frame would simply not be
   there. overflow-x:hidden then clips a frame wider than the paper at the
   sheet's edge, which is what Word does with the same oversized art. */
.lx-root { position: relative; height: 100%; background: #ffffff; font-family: sans-serif;
  overflow-x: hidden; isolation: isolate; }
.lx-content { outline: none; min-height: 100%; padding: 16px 18px 140px; color: #1a1a1a;
  font-size: 15px; line-height: 1.7; -webkit-user-select: text; max-width: 100%; }
.lx-ph { position: absolute; top: 16px; inset-inline-start: 18px; color: #8a8a8a; pointer-events: none; font-size: 15px; }
.lx-p { margin: 0 0 10px; }
.lx-h1 { font-size: 24px; font-weight: 700; margin: 6px 0 10px; }
.lx-h2 { font-size: 20px; font-weight: 700; margin: 6px 0 8px; }
.lx-h3 { font-size: 17px; font-weight: 600; margin: 4px 0 8px; }
.lx-quote { margin: 0 0 10px; border-inline-start: 3px solid ${BRAND}; padding-inline-start: 12px; color: #555; font-style: italic; }
.lx-ul { margin: 0 0 10px; padding-inline-start: 26px; list-style: disc; }
.lx-ol { margin: 0 0 10px; padding-inline-start: 26px; list-style: decimal; }
.lx-li { margin: 2px 0; }
/* Checklist items (CheckListPlugin) — no bullet/number; a tappable box drawn with
   ::before. The inline-start logical props keep the box on the leading edge in both
   LTR and RTL. Tapping the box toggles __checked (handled natively by the plugin's
   click listener). */
.lx-li-checked, .lx-li-unchecked {
  position: relative; margin: 2px 0; list-style-type: none;
  padding-inline-start: 24px; outline: none;
}
.lx-li-checked:before, .lx-li-unchecked:before {
  content: ''; position: absolute; inset-inline-start: 0; top: 3px;
  width: 16px; height: 16px; border: 1px solid #9aa0aa; border-radius: 3px;
  background-size: cover; cursor: pointer;
}
.lx-li-checked { text-decoration: line-through; color: #8a8a8a; }
.lx-li-checked:before {
  border-color: ${BRAND}; background-color: ${BRAND};
}
.lx-li-checked:after {
  content: ''; position: absolute; inset-inline-start: 5px; top: 5px;
  width: 4px; height: 8px; border: solid #ffffff; border-width: 0 2px 2px 0;
  transform: rotate(45deg); cursor: pointer;
}
.lx-bold { font-weight: 700; }
.lx-italic { font-style: italic; }
.lx-underline { text-decoration: underline; }
::selection { background: #ffe08a; }
/* Persistent MULTI-block selection highlight — mirrors the native OS text
   selection so the chosen blocks stay visibly marked after the OS selection is
   dismissed (e.g. once the AI dock opens). Driven from the native store's
   selected indices via SelectionHighlightPlugin. Box-shadow (not padding) so it
   reads as a continuous band across the small inter-paragraph gaps without
   reflowing the text. */
.lx-selected { background: rgba(52, 120, 246, 0.20); border-radius: 3px; box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.20); }
/* Tappable structural block (table/image/other) — tap to select it and reveal its
   kind tools; a pressed ring gives feedback that it's an interactive target. */
.lx-blockpick { cursor: pointer; border-radius: 6px; transition: box-shadow 120ms ease; }
.lx-blockpick:active { box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.28); }
`;
