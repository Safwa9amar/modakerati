// One-finger gutter-handle drag-to-reorder: grips, the lifted block, the opened
// slot and the pill that follows the finger.

import { BRAND, BRAND_RGB } from "./brand";

export const CSS_REORDER = `
/* ── One-finger gutter-handle drag-to-reorder ────────────────────────────────
   Mode on → one gutter column with a grip chip on every DRAGGABLE unit (JS tags
   those 'lx-drag-ok'; multi-block units get the indent but no chip, so the column
   stays straight and nothing offers a handle that won't lift).
   The gutter side is the DOCUMENT's, resolved once by JS ('lx-reorder-rtl') —
   NOT each block's own logical side: direction is per paragraph here, so logical
   padding put the handle on the right of an Arabic block and on the left of the
   empty one under it, which reads as a broken UI rather than an affordance. */
.lx-content.lx-reorder-on > *:not(.lx-chrome):not(.lx-chrome-wrap) { position: relative; padding-left: 42px; }
.lx-content.lx-reorder-on.lx-reorder-rtl > *:not(.lx-chrome):not(.lx-chrome-wrap) { padding-left: 0; padding-right: 42px; }
.lx-content.lx-reorder-on > .lx-drag-ok::before {
  content: "⠿"; position: absolute; left: 8px; top: 1px;
  width: 24px; height: 24px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  color: rgba(${BRAND_RGB},.62); font-size: 15px; line-height: 1;
  background: rgba(${BRAND_RGB},.09); border-radius: 8px;
  transition: background .12s ease, color .12s ease, transform .12s ease;
  animation: lxGripIn .18s ease; /* NO fill-mode: a held end state would outrank the press transform below */
  -webkit-user-select: none; user-select: none; pointer-events: none;
}
.lx-content.lx-reorder-on.lx-reorder-rtl > .lx-drag-ok::before { left: auto; right: 8px; }
@keyframes lxGripIn { from { opacity: 0; transform: scale(.72); } to { opacity: 1; transform: scale(1); } }
/* finger down on a handle, before the lift arms */
.lx-content.lx-reorder-on > .lx-drag-hot::before { background: rgba(${BRAND_RGB},.2); color: ${BRAND}; transform: scale(1.06); }
/* The lifted block leaves NO hole: it hides, and its neighbours slide across it,
   so the page previews exactly the post-drop order. Transforms only → no reflow,
   so the rects cached at lift time stay valid for the whole drag. */
.lx-content.lx-reorder-on > .lx-reorder-lifted { visibility: hidden; }
.lx-content.lx-reorder-on > .lx-reorder-shift { transition: transform .19s cubic-bezier(.22,1,.36,1); will-change: transform; }
/* A thin rule down the middle of the opened slot — the slot itself is the loud
   signal, so this stays quiet instead of a glowing full-bleed bar. */
.lx-drop-slot { position: fixed; z-index: 9998; height: 2px; border-radius: 2px; pointer-events: none;
  background: rgba(${BRAND_RGB},.85); transition: top .12s cubic-bezier(.2,0,0,1); }
.lx-drop-slot::before, .lx-drop-slot::after { content: ""; position: absolute; top: -2px; width: 6px; height: 6px; border-radius: 50%; background: rgba(${BRAND_RGB},.85); }
.lx-drop-slot::before { left: 0; }
.lx-drop-slot::after { right: 0; }
/* The moving sign — a small pill of the block's text that follows the finger and
   sinks into the slot on release. */
.lx-drag-pill { position: fixed; z-index: 9999; pointer-events: none; box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 14px;
  font-size: 12.5px; font-weight: 600; background: rgba(255,255,255,.97); color: #2a2d3d;
  border: 1px solid rgba(${BRAND_RGB},.35); border-radius: 999px; white-space: nowrap;
  max-width: 62vw; overflow: hidden;
  box-shadow: 0 10px 24px -10px rgba(20,22,40,.5), 0 2px 6px -2px rgba(20,22,40,.18);
  animation: lxPillIn .16s cubic-bezier(.34,1.5,.64,1); }
.lx-drag-pill-grip { color: rgba(${BRAND_RGB},.7); flex: 0 0 auto; }
.lx-drag-pill-txt { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lx-drag-pill-drop { transition: top .18s cubic-bezier(.3,0,.2,1), opacity .18s ease, transform .18s ease; }
@keyframes lxPillIn { from { transform: scale(.7); opacity: .3; } to { transform: scale(1); opacity: 1; } }
`;
