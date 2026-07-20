# Always-on AI Bubble + Dock — Design

**Date:** 2026-07-20
**Status:** Approved (two visual-companion rounds + terminal Q&A)
**Builds on:** [collapsible bubble pill](2026-07-20-collapsible-bubble-pill-design.md)

## Locked decisions (user)

- **Always open:** the bubble appears on workspace entry and NEVER auto-closes —
  not on keyboard dismiss, not on deselect. Only drag-to-X closes it. When
  dismissed, the legacy bottom AI bar returns as fallback.
- **AI mode at count===0:** bubble shows ✦; tap expands **Dock layout A** (panel
  unfolds beside the bubble): fixed quick-action chips on top, "Suggested" chips
  beneath (server-generated, shimmer while loading).
- **Chips run immediately** through the existing chat pipeline (confirm gates +
  doc history still protect destructive ops).
- **Inline prompt input, variant 3 (on demand):** an "Ask…" chip in the dock
  morphs into an inline input row (scope tag + text + send). The **legacy bottom
  inputs are removed** (whole-memoir IdleAIBar AND the block-scoped askAiOpen
  input) — all AI asking happens in the dock.
- **Keyboard-aware input:** when the inline input focuses and the keyboard rises,
  the dock lifts so the input sits ABOVE the keyboard (user: "always watch the
  keyboard so the input appears on top of it").
- **Working state:** after send/chip-tap the dock collapses and the bubble's ✦
  spins while the AI works (`isGenerating`).
- **Deferred (parallel-session WIP conflicts):** Voice chip (`lib/voice.ts` WIP).

## Modes

- **count>0 (block selected):** unchanged formatting behavior (adaptive icon
  bubble → BlockContextBar pill). The pill's ✦ Ask AI now opens the dock's inline
  input (block-scoped scope tag) instead of the legacy bottom input (`askAiOpen`
  is no longer set by the floating path).
- **count===0:** ✦ AI bubble → the AI dock.

## Components

- `stores/floating-pill-store.ts`: add `inputOpen: boolean` + `setInputOpen`;
  `hide()`/`reset()` clear it. `visible` unchanged (drag-to-X only) but FloatingPill
  now calls `show()` on MOUNT (always-on), not on first selection.
- `components/workspace/AIDock.tsx` (new): the AI-mode panel. Fixed chips
  (Summarize chapter / Improve writing / Fix formatting / Translate) → canned
  prompts via `sendMessageToAI`; Suggested via `getComposerSuggestions` (abort
  superseded, static-fallback convention = hide section when empty); "Ask…" chip
  → inline input row (scope tag, TextInput, send). Sends run through
  `sendMessageToAI(thesisId, text, …)` with block indices when scoped.
- `components/workspace/FloatingPill.tsx`: always-on mount; suppression drops
  `count === 0` (keep aiGate / soleSuggested / previewMode / !composerOpen);
  renders AIDock vs BlockContextBar by count; ✦ onAskAI → `setInputOpen(true)`;
  keyboard lift: when `inputOpen && keyboardHeight > 0`, spring `ty` so the dock
  bottom clears the keyboard; bubble icon spins while `isGenerating`.
- `components/workspace/BlockComposer.tsx`: remove the whole-memoir IdleAIBar
  branch and the askAiOpen block-scoped input branch — UNLESS the floating pill
  is dismissed (`!useFloatingPillStore.visible` → whole-memoir bar returns as
  fallback, per the locked decision). Docked formatting bar + pendingAsk/Confirm
  gate surfaces stay. ⚠️ file carries parallel-session WIP (IdleAIBar `focused`
  refactor) — bundling expected, label clearly.

## Verification

tsc per task; device QA: always-on lifecycle, AI dock chips fire chat, suggested
chips load/hide, Ask input above keyboard, block-scope input from the pill ✦,
legacy bars gone (but fallback returns after drag-to-X), spinner, RTL, Reduce Motion.
