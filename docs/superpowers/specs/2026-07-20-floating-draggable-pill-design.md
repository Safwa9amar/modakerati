# Floating Draggable Pill — Design

**Date:** 2026-07-20
**Status:** Approved (in-conversation; two decisions locked via AskUserQuestion)
**Builds on:** [pill toolbar animations](2026-07-20-pill-toolbar-animations-design.md)

## Goal

Turn the workspace block pill (BlockContextBar, compact/floating form) from an
inline per-block element into a **single persistent, draggable, screen-level
floating palette** — like an Android chat-head / bubble. It stays open across
block changes and closes only by dragging onto a dismiss (X) target.

## Locked decisions

- **Dismiss = drag to X target** (Android-bubble style): an X target fades in at
  bottom-center while dragging; drop the pill on it to close. No persistent X.
- **Keyboard = dock above keyboard**: keyboard up → the existing full-width docked
  bar (BlockComposer, unchanged); keyboard down → the floating draggable pill.

## Behavior

**Lifecycle (persistent).**
- First non-empty block selection → floating pill springs in at a default spot.
- Persists across block changes; tapping another block **retargets** its tools to
  that block (smart-pill morph still swaps text/image/table toolsets). Format
  tools disable when nothing is selected, but the pill stays.
- Closes ONLY via drag-to-X. Dismiss also `clearSelection()`, so the next block
  tap re-spawns it.

**Dragging.**
- Whole pill draggable via a Pan gesture with a movement threshold (~10px) so
  quick taps still hit chips. Free-drop (settle where released), clamped inside
  the screen (below header, above safe-area bottom). Position is session-persistent.
- The pill no longer scrolls with the document (it's a fixed screen overlay).

**Drag-to-X dismiss.**
- On drag begin, a DismissTarget (X) fades/scales in at bottom-center.
- Hit test: when the pill center is within the target's radius, the target grows +
  one selection haptic. Release over it → dismiss (pill scales into the X → `hide`).
  Release elsewhere → settle at drop position. Target hides on drag end.

**Keyboard.** Keyboard up → docked bar (unchanged); the floating overlay is
suppressed (but `visible` stays true). Keyboard down → floating pill returns at
its last position.

## Components / data flow

- **`stores/floating-pill-store.ts`** (new): `visible: boolean` (default false),
  `pos: {x,y} | null` (null = default spawn), actions `show() / hide() / setPos()`
  / `reset()`. Reset on workspace exit (call from the same place `workspace-store`
  resets). Selected as primitives (no fresh-object selectors — zustand v5 loop).
- **`components/workspace/DismissTarget.tsx`** (new): absolutely-positioned X at
  bottom-center; `active`/`visible` shared values drive fade + scale. pointerEvents
  none (hit-testing is done by the pill's pan, not touch).
- **`components/workspace/FloatingPill.tsx`** (new): the overlay. Computes the
  selection derivations currently in BlockToolbarPill (paragraphSelection,
  selectedBlock, indices, count, scopeLabel), wraps `BlockContextBar`
  (keyboardOpen=false) in a `GestureDetector(Pan)` + absolute Reanimated.View at
  `pos` + drag translation, renders DismissTarget, runs the hit test, and owns the
  spawn (`show` on first selection) + dismiss (`hide` + clearSelection). Mounted
  ONCE in thesis-workspace.tsx, outside the KeyboardAvoidingView.
- **Retire** the inline `{showPill && <BlockToolbarPill/>}` mount in
  `OutlineReorderable.tsx` (+ its now-unused `pillEligible`/`aiGateActive`/`showPill`;
  keep `hasSuggestion`, still used by InlineSuggestion). Delete `BlockToolbarPill.tsx`.

**Suppression parity:** the floating overlay must reproduce the inline pill's
suppression conditions — hidden while `askAiOpen`, while the AI ask/confirm gate
owns the bottom (`useChatStore` pendingAsk/pendingConfirm), and while the sole
selected paragraph has an active inline suggestion (its stored `original` still
matches the block text). Plus: hidden while `keyboardOpen`.

**Handoff feature:** the block→block instant-move handoff (`lib/pill-handoff.ts`)
was about the per-row remount. With a persistent overlay the pill no longer
remounts on block change, so that machinery goes dormant (harmless — pillIn/pillOut
now fire only on show/dismiss). Not removed.

## Defaults chosen (not separately confirmed)

- Free-drop positioning (not edge-snap).
- Default spawn: bottom-center, above the safe-area bottom (roughly where the
  compact pill sits today).
- Drag activation threshold ~10px so chip taps pass through.
- X dismiss also clears the selection.

## Risks

- **Pan vs the tool row's horizontal gesture-handler ScrollView.** A deliberate
  horizontal drag could compete with chip-row scroll. Fallback (flagged to user):
  a small grip handle on the pill edge that owns the drag. Decide in device QA.
- **Overlay above a scrolling document + New Arch gesture-handler.** Standard
  chat-head pattern; verify no touch pass-through issues on device.

## Verification

No JS test runner. Gate each task on `npx tsc --noEmit`; behavior via on-device QA:
drag + reposition + clamp, drag-to-X dismiss + haptic, retarget across blocks,
persist across block change, keyboard-dock still works, chip taps vs drag, RTL,
Reduce Motion.
