# Two‑finger block reorder — design

**Date:** 2026-07-27
**Status:** Approved (brainstorm), pending implementation plan
**Surface:** Lexical Writer (the in‑workspace DOM editor)

## Summary

Let a user reorder document blocks by lifting one with **two fingers** and dragging
it to a new position, directly inside the live Lexical writer. One finger stays
reserved for text selection / caret / normal scrolling; two fingers is the reorder
channel. The interaction is inline in the editing surface — no separate "reorder
mode" screen.

The data pipeline already exists and is battle‑tested: a `{ type: "move", from, to }`
op (`lib/thesis-ops.ts`), an optimistic local `patchMove`, and the server
`moveThesisBlock` API (used by the now‑retired native `OutlineReorderable`). This
feature adds **only** the gesture + in‑editor UX; it emits the existing `move` op and
requires **no server change and no new op type**.

## REVISION v2 (2026-07-27) — one‑finger drag handle, gated by a dock toggle

The gesture was changed during implementation. This section **supersedes** the
two‑finger framing above and Decision 2 below; everything else (granularity,
cross‑chapter confirm, the move‑op pipeline, the ghost / drop‑line / auto‑scroll
machinery, `$blockEntries`, the move‑math helpers) is unchanged.

- **One finger, not two.** Reorder is a **one‑finger** drag.
- **Reorder is a MODE, off by default.** A **"Reorder" toggle** is added to the AI
  dock (`AIDock`), mirroring the existing "Section markers" toggle (a stateful pill
  backed by a `reorderMode` flag + `toggleReorderMode` action in `workspace-store`,
  exactly like `showChrome` / `toggleShowChrome`). Normal editing is untouched until
  the user turns it on.
- **Drag handle in the gutter.** While reorder mode is ON, each draggable block shows
  a grip (⠿) in the leading gutter. A one‑finger press‑drag on the grip lifts and
  moves the block; the text body still scrolls, so long documents stay navigable.
  This is the conflict‑free one‑finger pattern (used by the retired native
  `OutlineReorderable`). When reorder mode is OFF, no grips, no reorder gesture.
- **Arming:** touch that starts in the gutter band over a single‑block unit →
  `preventDefault` (own the gesture, no text‑selection/scroll) → lift after a tiny
  hold (~150 ms) or ~6 px of movement, whichever first → haptic pop → drag → drop.
- **Phase‑1 safety:** only single‑block units (`count === 1`) are draggable; lists
  and whole‑section (heading‑carry) moves remain Phase 2. Callbacks are held in refs
  and the plugin is fully inert unless reorder mode is on and callbacks are wired.
- **Drag visual (approved via companion mockups):** while dragging, the source block
  **collapses to a slim placeholder** (content hidden, footprint kept → no reflow) and
  a compact **preview‑pill sign** (grip + a truncated text peek) follows the finger;
  the block after the target gap **slides down to open a "magnetic slot"**; on drop the
  pill **expands** into a block at the slot as the reseed lands the real content. Grips
  render per‑block on the leading edge (RTL‑correct) and never on chrome
  (`ChromeNode` wrapper tagged `lx-chrome-wrap`).

## Decisions (locked in brainstorm)

1. **Granularity — heading offers a choice; paragraphs move alone.**
   Lifting a plain block (paragraph / table / image / list item) moves exactly that
   block. Lifting a **heading** floats a small pill offering *"whole section"*
   (default) vs *"heading only"*. "Whole section" = the heading plus every block
   under it until the next heading of the same or higher level.

2. **Lift trigger — two‑finger brief hold (~250 ms) → haptic pop.**
   Two fingers must rest roughly stationary for ~250 ms before the block lifts (a
   light haptic marks the pop). A faster two‑finger swipe never crosses the
   threshold, so it stays a scroll. Two‑finger drag **replaces** two‑finger scroll
   inside the editor; one‑finger scroll is unchanged.

3. **Cross‑section — free within a section, confirm on crossing.**
   Reordering within the block's own section is frictionless. If the drop target is
   in a *different* section, the insertion line turns amber with a
   *"Move into §X?"* tag and the release must confirm the crossing. Whole‑section
   lifts are expected to cross boundaries and do not need the confirm.

**What "section" means here.** Throughout this feature "section" = a **heading‑delimited
outline span**, not a Word section‑break. The cross‑section confirm (decision 3) fires
when a drop crosses a **top‑level heading (chapter)** boundary — i.e. the block would
land under a different top‑level heading than the one it started under. This keeps the
confirm rare and structurally meaningful (crossing every h3 subsection would be noise).
Word section‑break chrome bands are a *separate* concept (page/header layout) and are
only inert, non‑droppable markers — they do not by themselves gate a move. This gives
one consistent notion of "section" shared by the heading‑carry feature and the
cross‑chapter confirm.

Concretely: a heading is a `DocBlockDTO` of `kind:"paragraph"` with `level >= 1`
(`level` is `0..6`, `0` = body text); a **chapter** boundary is a `level === 1`
heading. Both the whole‑section span and the cross‑chapter confirm are computed by
scanning `blocks[].level` in document order.

## Architecture

Everything runs in the DOM / Lexical layer, where block geometry, indices, section
boundaries, and chrome interleaving already live. No native gesture handler sits over
the WebView (two‑finger arbitration with WKWebView's own scroll is fragile, and a
native layer only knows block boundaries via lagging bridge round‑trips).

Components touched:

- **`components/workspace/lexical/blockLexical.tsx`** — new touch controller /
  `ReorderPlugin`: the gesture state machine, the lifted‑block overlay, the insertion
  line, edge auto‑scroll, the heading toggle pill, and the amber cross‑section tag.
  This is where the block model, `sections[]`, and chrome interleaving already exist.
- **`components/workspace/lexical/LexicalDomEditor.tsx`** — a thin bridge callback
  (e.g. `onReorder(from, to)` / `onReorderRange(...)`) crossing the DOM→native
  boundary, alongside the existing `onBlocks` / `onEditCell` callbacks.
- **`components/workspace/WorkspaceLexicalView.tsx`** — receives the reorder callback
  and dispatches the existing `move` op through the same save/op path used by other
  edits (optimistic `patchMove`, batch `/ops`, undo/redo).

No new store. No server route. No new op type (whole‑section move is expressed as a
contiguous run of `move` ops, or a range‑aware move if the plan finds that cleaner —
either way it reuses existing primitives).

## Gesture state machine (in the WebView)

```
idle
  └─ touchstart (exactly 2 touches on a block) ──► armed
armed
  ├─ 250 ms elapsed AND midpoint moved < ~10px ──► lifted   (haptic pop)
  ├─ midpoint moved > ~10px before timer        ──► idle    (it's a scroll — never preventDefault)
  └─ a finger lifts                             ──► idle
lifted / dragging
  ├─ touchmove ──► track two‑finger midpoint, update insertion line + auto‑scroll
  └─ touchend  ──► drop
drop
  ├─ target == origin gap ──► no‑op (emit nothing)
  └─ else                  ──► emit move / range‑move; animate into slot; haptic confirm
```

Key rule: we only call `preventDefault()` (to own the gesture and stop WebView
scroll) **after** the lift is armed. Before that, touches pass through untouched, so
scrolling is never hijacked.

## Drag mechanics

- **Lifted overlay.** The grabbed block is cloned into an absolutely‑positioned
  overlay element (scale ~1.03, ~1° tilt, drop shadow) that rides the midpoint of the
  two touches. The source block stays in the flow at reduced opacity.
- **No document reflow.** The rest of the doc does not part to open a gap — only the
  insertion line moves. This is essential on a long thesis (hundreds of pages); a
  per‑move reflow would be prohibitively expensive.
- **Insertion index.** Block rectangles are cached once on lift (not recomputed each
  `touchmove`). The target gap is the nearest inter‑block boundary to the midpoint.
- **Insertion line.** A single absolutely‑positioned bar; blue normally, amber when
  it crosses into another section.
- **Edge auto‑scroll.** When the midpoint enters the top/bottom ~34 px band, a
  `requestAnimationFrame` loop adjusts `scrollTop` so distant targets are reachable
  without releasing.

## Heading toggle (whole section vs heading only)

When the lifted block is a heading, a small floating pill appears near the fingers:
`whole section ▾ / heading only`, defaulting to **whole section**. The section span
is the heading through the block before the next heading of the same or higher level.
On drop, a whole‑section move relocates that contiguous run so it lands contiguously
at the target (implemented as sequential `move` ops or a range move). The span and
heading levels come from scanning the block list's heading kinds/levels in document
order — not from Word `sections[]` / `buildChrome`, which describe page‑layout chrome.

## Cross‑section confirm

The source block's enclosing top‑level heading (chapter) is known at lift. During
drag, if the target gap falls under a *different* top‑level heading, the insertion
line renders amber with a *"Move into §X?"* label (the target chapter's heading text).
Releasing there performs the move (the amber state is the confirmation — the release
itself is the deliberate act). Whole‑section lifts skip this, since crossing is their
purpose. Chapter boundaries are derived by scanning heading blocks in document order
(the same scan used for the whole‑section span), independent of Word section‑break
chrome.

## Edge cases & guards

- **Chrome bands are inert.** Header / footer / section‑break marker bands are
  display‑only (interleaved by block index, not real blocks). They cannot be lifted
  and are not valid drop targets; the insertion index snaps to real block gaps only.
- **Drop on origin = no‑op.** No op is emitted; the overlay animates back.
- **Suppression.** Arming is blocked while a pending AI suggestion (per‑block or
  range) or an active inline edit is present, mirroring the existing
  `suggestionActiveRef` guard, so a lift can never clobber a proposal in flight.
- **Save & undo.** The emitted `move` flows through the existing op path / save chain;
  `move` is already covered by doc history and undo/redo. Positional‑index safety is
  handled by the existing ops layer.
- **RTL.** The insertion line and toggle pill respect the document's writing
  direction (the view already tracks `rtl`).

## Out of scope

- Multi‑block (non‑section) drag selection reorder — only single block or
  whole‑section for v1.
- A dedicated "reorder mode" card overlay (kept as a fallback only if inline drag
  proves unworkable on device).
- Any change to the native `OutlineReorderable` (retired) or the server API.

## Verification

The Expo app has no JS test runner, so gate with `npx tsc --noEmit` plus on‑device QA
(per the app‑verification rule — no jest/TDD for app code). Manual QA matrix:

1. Two‑finger swipe scrolls (no accidental lift); one‑finger scroll unaffected.
2. Brief hold arms with haptic pop.
3. Lift + drop a paragraph within its section; order persists after save + reload.
4. Whole‑section move of a heading lands contiguously; "heading only" moves just the
   heading.
5. Cross‑section drag shows amber + confirm; block lands in the new section.
6. Edge auto‑scroll reaches a far target.
7. Drop on origin = no change. Undo reverts a move.
8. A lift is refused while an AI suggestion / inline edit is active.
