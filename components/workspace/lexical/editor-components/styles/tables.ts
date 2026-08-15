// Table proposal pulse + the horizontal scroll indicator.

export const CSS_TABLES = `
/* AI table proposal: the grid pulses while the model thinks. */
.lx-tbl-loading { pointer-events: none; animation: lxTblPulse 1.1s ease-in-out infinite alternate; }
@keyframes lxTblPulse { from { opacity: 0.35; } to { opacity: 0.65; } }
/* Table horizontal scroller: a persistent thin indicator in the brand ACCENT
   (constants/colors.ts brandAccent #33D6A6) so "more table sideways" is
   visible; padding-bottom keeps a gap between the table and the bar. */
.lx-tblscroll { padding-bottom: 10px; }
.lx-tblscroll::-webkit-scrollbar { height: 4px; }
.lx-tblscroll::-webkit-scrollbar-track { background: transparent; }
.lx-tblscroll::-webkit-scrollbar-thumb { background: #33D6A6; border-radius: 999px; }
`;
