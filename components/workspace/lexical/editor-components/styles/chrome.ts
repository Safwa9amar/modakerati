// Inline chrome bands (section header / footer / section break) and the faithful
// header preview.
// 
// The trailing .lx-ghost rule (AI autocomplete ghost text) belongs to
// CompletionPlugin, not to chrome — it lives here because these chunks preserve
// the stylesheet ORDER exactly, and moving a rule between chunks would change
// the cascade. See ./index.

export const CSS_CHROME = `
/* Inline chrome bands (section header/footer/section-break) — display-only
   markers rendered by ChromeNode; tap to select like a structural block. */
.lx-chrome { cursor: pointer; user-select: none; }
.lx-chrome-band { display: flex; gap: 8px; align-items: baseline; padding: 8px 10px; margin: 6px 0;
  border: 1px dashed rgba(154,90,49,.40); border-radius: 8px; background: rgba(154,90,49,.07); }
.lx-chrome-tag { font-size: 10px; font-weight: 800; letter-spacing: .04em; color: #9A5A31; white-space: nowrap; }
.lx-chrome-text { font-size: 13px; color: #6E6456; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1 1 auto; min-width: 0; }
.lx-chrome-break { display: flex; align-items: center; gap: 8px; margin: 12px 2px; }
.lx-chrome-break .lx-chrome-line { flex: 1; height: 1px; background: rgba(154,90,49,.35); }
.lx-chrome-lbl { font-size: 10px; font-weight: 800; color: #9A5A31; padding: 3px 9px;
  border: 1px solid rgba(154,90,49,.35); border-radius: 20px; white-space: nowrap; }
/* Faithful header preview: the tab-positioned segments spread apart + the bottom rule. */
/* The header preview renders CLEAN — like the real running head (the parts spread +
   the rule), NOT a dashed UI box: override the .lx-chrome-band chrome look. */
.lx-chrome-hdr { align-items: stretch; border: none; background: transparent; padding: 10px 2px 4px; margin: 2px 0; }
.lx-chrome-hdr-preview { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.lx-chrome-hdr-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.lx-chrome-hdr-seg { font-size: 13.5px; font-weight: 700; color: #1A1A26; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.lx-chrome-hdr-rule { height: 2px; border-radius: 1px; }
/* AI inline autocomplete ghost text — dim, non-selectable, tap/swipe to accept. */
.lx-ghost { color: #b3b3bd; cursor: pointer; -webkit-user-select: none; user-select: none; }
`;
