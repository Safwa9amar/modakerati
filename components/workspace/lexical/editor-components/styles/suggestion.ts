// The inline AI suggestion and range-rewrite surfaces — a web port of the native
// InlineSuggestion.

export const CSS_SUGGESTION = `
/* Inline AI suggestion — a faithful web port of the native InlineSuggestion: an
   instruction chip, "Thought for Xs" trace, the proposal AS the paragraph with a
   green logical-edge bar + word add-marks, an expandable original teaser, and a
   white floating pill (Approve tint + dark ink / Edit / Again / Reject). Same
   fixed on-white palette as the native (this sits on the white document paper). */
.lx-sug { margin: 6px 0 10px; }
/* instruction chip */
.lx-sug-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 92%; margin: 4px 0 6px; padding: 3px 10px; border-radius: 999px; background: rgba(14,122,70,.08); border: 1px solid rgba(14,122,70,.18); color: #0E5C36; font-size: 11px; font-weight: 600; }
.lx-sug-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* "Thought for Xs" trace */
.lx-sug-trace { margin: 0 0 6px; border: 1px solid #D4DAE1; border-radius: 10px; background: #fff; padding: 4px 10px; }
.lx-sug-trace > summary { list-style: none; cursor: pointer; font-size: 11.5px; font-weight: 600; color: #0E5C36; }
.lx-sug-trace > summary::-webkit-details-marker { display: none; }
.lx-sug-trace-body { margin-top: 6px; font-size: 12px; line-height: 1.55; color: #3C4654; white-space: pre-wrap; max-height: 160px; overflow-y: auto; }
/* proposed text = the paragraph */
.lx-sug-proposed { font-size: 15px; line-height: 1.7; color: #16171d; border-inline-start: 3px solid #22C07A; padding-inline-start: 10px; }
.lx-sug-proposed.lx-sug-loading { color: #16171d; opacity: .38; }
/* Range rewrite: the proposal is a PASSAGE — one or more paragraphs, each with the
   green logical-edge bar, so the dynamic paragraph split is visible. */
.lx-sug-passage { display: flex; flex-direction: column; gap: 8px; }
.lx-sug-ppara { margin: 0; }
/* Per-paragraph keep/drop row: the proposed paragraph + a toggle. A dropped
   paragraph dims + strikes through and its toggle turns red; Apply commits only
   the kept ones. */
.lx-sug-prow { display: flex; align-items: flex-start; gap: 6px; }
.lx-sug-prow .lx-sug-proposed { flex: 1 1 auto; min-width: 0; }
.lx-sug-dropped { opacity: .45; text-decoration: line-through; text-decoration-color: #C0392B; border-inline-start-color: #C0392B; }
.lx-sug-toggle { flex: 0 0 auto; width: 26px; height: 26px; border: none; border-radius: 7px; background: transparent; color: #8A94A4; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.lx-sug-toggle:active { transform: scale(.9); }
.lx-sug-toggle.on { color: #C0392B; }
.lx-sug-add { background: rgba(34,192,122,.18); border-radius: 3px; }
/* original teaser (tap to expand; del-marks when open) */
.lx-sug-teaser { margin-top: 8px; padding: 6px 9px; background: #F6F8FA; border-radius: 8px; cursor: pointer; }
.lx-sug-teaser-txt { font-size: 12.5px; line-height: 1.5; color: #8A94A4; }
.lx-sug-teaser-txt.lx-sug-clamp { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.lx-sug-del { background: #FDECEC; color: #B3564A; text-decoration: line-through; border-radius: 3px; }
/* error slip */
.lx-sug-err { margin-top: 8px; padding: 8px 10px; background: #FDF0EF; border: 1px solid rgba(192,57,43,.25); border-radius: 8px; color: #C0392B; font-size: 12.5px; font-weight: 500; }
/* edit-in-place textarea */
.lx-sug-edit { width: 100%; box-sizing: border-box; font-size: 15px; line-height: 1.7; color: #16171d; border: 1px solid #D4DAE1; border-radius: 8px; padding: 8px 10px; resize: vertical; min-height: 72px; background: #fff; }
/* white floating action pill */
.lx-sug-pill { display: flex; justify-content: center; margin: 10px 0 4px; }
.lx-sug-pillrow { display: inline-flex; align-items: center; gap: 2px; background: #fff; border: 1px solid #E8ECEF; border-radius: 999px; padding: 4px; box-shadow: 0 5px 12px -2px rgba(10,30,20,.16); }
.lx-sug-approve { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 96px; padding: 8px 16px; border: 1px solid rgba(14,122,70,.18); border-radius: 999px; background: rgba(14,122,70,.12); color: #0E5C36; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.lx-sug-approve:active { background: rgba(14,122,70,.24); }
.lx-sug-approve:disabled { opacity: .5; }
.lx-sug-icon { display: inline-flex; align-items: center; justify-content: center; padding: 8px 10px; border: none; border-radius: 999px; background: transparent; color: #3C4654; cursor: pointer; }
.lx-sug-icon:active { background: rgba(60,70,84,.10); }
.lx-sug-icon.lx-sug-danger { color: #C0392B; }
.lx-sug-think { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; color: #0E5C36; font-size: 12px; font-weight: 500; }
`;
