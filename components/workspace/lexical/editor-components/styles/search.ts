// Document-search hit overlays.

export const CSS_SEARCH = `
/* Document-search hit overlays — absolute divs over each match, inside .lx-root so
   they scroll with the content but sit under the caret (pointer-events off). Amber
   on all matches, a stronger orange on the current one. */
.lx-hl-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; overflow: visible; }
.lx-hl { position: absolute; background: rgba(255, 213, 79, 0.45); border-radius: 2px; }
.lx-hl-cur { background: rgba(255, 138, 0, 0.55); }
`;
