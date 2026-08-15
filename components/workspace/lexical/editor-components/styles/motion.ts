// Keyframes: a web port of the native InlineSuggestion Reanimated animations.
// Must follow ./suggestion — the exit/entrance rules override the static ones.

export const CSS_MOTION = `
/* --- motion: a web port of the native InlineSuggestion (Reanimated) animations --- */
/* entrance: calm ease-out fade + rise (native FadeInDown 220ms). Runs once on mount
   — the decorator's outer div persists across stream re-renders, so it never replays. */
@keyframes lx-sug-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.lx-sug { animation: lx-sug-in 240ms cubic-bezier(0.33, 1, 0.68, 1) both; }
/* the floating pill rises a touch after the body (native pill anchor). */
.lx-sug-pill { animation: lx-sug-in 300ms cubic-bezier(0.33, 1, 0.68, 1) both; }
/* thinking: a light band sweeping across the dimmed original (native SweepBand). */
.lx-sug-proposed.lx-sug-loading { position: relative; overflow: hidden; }
.lx-sug-proposed.lx-sug-loading::after { content: ""; position: absolute; top: 0; bottom: 0; width: 55%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent); animation: lx-sug-sweep 1.4s linear infinite; pointer-events: none; }
@keyframes lx-sug-sweep { from { transform: translateX(-140%); } to { transform: translateX(320%); } }
/* thinking capsule ✦ spinner (native SpinSparkle). */
.lx-sug-think svg { animation: lx-sug-spin 1s linear infinite; transform-origin: center; }
@keyframes lx-sug-spin { to { transform: rotate(360deg); } }
/* added words flash brighter on appear, then settle to the soft tint (native AddSpan). */
@keyframes lx-sug-addflash { 0% { background: rgba(34, 192, 122, 0.5); } 100% { background: rgba(34, 192, 122, 0.18); } }
.lx-sug-add { animation: lx-sug-addflash 700ms ease-out both; }
/* pill press feedback: scale squish (native usePressFx). */
.lx-sug-approve, .lx-sug-icon { transition: transform 120ms ease, background 120ms ease; }
.lx-sug-approve:active, .lx-sug-icon:active { transform: scale(0.92); }
/* exit: approve = absorb up + shrink + fade; reject = tip down + fade (native
   pillSink / pillDrop choreography). Played for ~200ms before the node is settled. */
.lx-sug.lx-leaving-approve { animation: lx-sug-approve-out 220ms cubic-bezier(0.4, 0, 1, 1) forwards; }
@keyframes lx-sug-approve-out { to { opacity: 0; transform: translateY(-8px) scale(0.97); } }
.lx-sug.lx-leaving-reject { animation: lx-sug-reject-out 200ms cubic-bezier(0.4, 0, 1, 1) forwards; }
@keyframes lx-sug-reject-out { to { opacity: 0; transform: translateY(10px) rotate(0.6deg); } }
@media (prefers-reduced-motion: reduce) {
  .lx-sug, .lx-sug-pill { animation: none; }
  .lx-sug-proposed.lx-sug-loading::after, .lx-sug-think svg, .lx-sug-add { animation: none; }
  .lx-sug.lx-leaving-approve, .lx-sug.lx-leaving-reject { animation: none; }
  .lx-content.lx-reorder-on > .lx-drag-ok::before { animation: none; }
  .lx-content.lx-reorder-on > .lx-reorder-shift { transition: none; }
  .lx-drop-slot, .lx-drag-pill-drop { transition: none; }
  .lx-drag-pill { animation: none; }
}
`;
