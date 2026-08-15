// Checkbox SELECT mode.

import { BRAND, BRAND_RGB } from "./brand";

export const CSS_SELECT = `
/* ── Checkbox SELECT mode ────────────────────────────────────────────────────
   The OS text-selection drag (handles + magnifier) was the only way to build a
   multi-block selection and it was unusable on both platforms — the handles
   fight the page scroll and never land on block boundaries. In this mode the
   editor goes read-only, the OS selection is switched off entirely, and every
   selectable block grows a leading checkbox; a tap anywhere on the block toggles
   it. Rows are marked by the plugin (lx-selrow), NOT by a child selector, so a
   LIST contributes one row per ITEM — matching the block model, where each item
   is its own block.
   The checkbox column sits on the DOCUMENT's side, resolved once by JS
   ('lx-select-rtl') — same reason the reorder gutter above does: direction is set
   per paragraph, so logical padding puts the box on the right of an Arabic block
   and on the left of the empty one under it. */
.lx-content.lx-select-on { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
/* cursor:pointer is load-bearing on iOS, not decoration: WebKit only dispatches a
   click for a tap on an element it considers clickable, and the listener sits on the
   editor ROOT. Same trick .lx-blockpick / .lx-chrome already rely on. */
.lx-content.lx-select-on .lx-selrow {
  position: relative; padding-left: 42px; list-style: none; cursor: pointer;
  border-radius: 6px; transition: background-color .12s ease;
}
.lx-content.lx-select-on.lx-select-rtl .lx-selrow { padding-left: 0; padding-right: 42px; }
.lx-content.lx-select-on .lx-selrow::before {
  content: ""; position: absolute; left: 8px; top: 0.05em;
  width: 22px; height: 22px; box-sizing: border-box;
  border: 2px solid #b9bcc8; border-radius: 6px; background-color: #fff;
  background-repeat: no-repeat; background-position: center; background-size: 15px 15px;
  pointer-events: none;
}
.lx-content.lx-select-on.lx-select-rtl .lx-selrow::before { left: auto; right: 8px; }
.lx-content.lx-select-on .lx-selrow.lx-selon { background-color: rgba(${BRAND_RGB},.11); }
.lx-content.lx-select-on .lx-selrow.lx-selon::before {
  border-color: ${BRAND}; background-color: ${BRAND};
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round' d='M3.2 8.4l3.1 3.1 6.5-6.5'/%3E%3C/svg%3E");
}

`;
