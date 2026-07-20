# Collapsible Bubble Pill — Design

**Date:** 2026-07-20
**Status:** Approved (in-conversation; 3 decisions locked via AskUserQuestion)
**Builds on:** [floating draggable pill](2026-07-20-floating-draggable-pill-design.md)

## Goal

The floating pill defaults to a small **circular bubble** and expands to the full
tool row on tap. The bubble spawns **beside the selected block** and stays floating
/ draggable.

## Locked decisions

- **Bubble icon = adaptive**: `T` (text/paragraph), image glyph (image), table glyph
  (table), per the sole selected block's kind. Fallback for multi-select: `Type`.
- **Collapse = a button on the expanded pill** (a leading collapse chevron) → back
  to the bubble. Never collapses by accident.
- **Position = beside the block, then float**: spawn beside the selected block (at
  the selecting tap's screen Y), then draggable; re-anchors on each new selection;
  does NOT chase the block on scroll.

## Behavior

- **Collapsed (default):** a ~52px circle at the pill position showing the adaptive
  icon. **Tap → expand** to the full `BlockContextBar`. Draggable; drag-to-X dismisses.
- **Expanded:** the full pill + a **leading collapse chevron** → back to bubble.
  Draggable; drag-to-X dismisses. Expanded/collapsed state is **sticky across block
  changes** (only the chevron / tap toggles it); position re-anchors.
- **Bubble ⇄ pill morph:** springy expand/collapse via the motion language
  (`SPRING_ENTER` for the content, `layoutSpring` for the container size change) —
  the pill grows out of / shrinks into the circle.
- **Spawn beside the block:** on selecting a block, the block's `Pressable onPress`
  reports `nativeEvent.pageY`; the bubble is placed at a screen side (trailing edge
  in reading direction) at that Y, clamped on-screen. Re-anchors when the selected
  block INDEX changes (not on scroll/drag). Programmatic reselects (move up/down)
  carry no tap → position unchanged.
- All prior behavior intact: persist-until-drag-to-X, keyboard-dock (docked bar
  never shows the bubble/collapse), the count===0 / composer-hidden / preview
  suppression.

## Components

- **`stores/floating-pill-store.ts`**: add `expanded: boolean` (default false),
  `setExpanded(v)`; `anchorY: number | null`, `setAnchorY(y)`. `reset()` clears both
  (expanded→false, anchorY→null).
- **`components/workspace/DocBlock.tsx`**: thread the press event's `pageY` into the
  single-select path (`pickBlock` / `enterOrSelect`) → `setAnchorY(pageY)`. Long-press
  / multi-select unaffected.
- **`components/workspace/BlockContextBar.tsx`**: add optional `onCollapse?: () => void`.
  When provided (floating overlay only), the compact pill renders a **leading collapse
  chevron chip** that calls it. Undefined (docked bar) → no chevron.
- **`components/workspace/FloatingPill.tsx`**:
  - Read `expanded`, `anchorY` from the store; `BUBBLE_SIZE = 52`.
  - Render the **bubble** (`Pressable` circle, adaptive icon, `onPress → setExpanded(true)`)
    when `!expanded`; the `BlockContextBar` (with `onCollapse → setExpanded(false)`)
    when expanded. Both inside the existing `GestureDetector(Pan)` + absolute
    Reanimated.View. Width-aware: container/clamp/center math use
    `expanded ? PILL_W : BUBBLE_SIZE`.
  - **Anchor effect:** on selected-block INDEX change with a known `anchorY`, spring
    `tx/ty` to the beside-block position (side X + clamped Y) and persist via `setPos`.
    A `lastAnchoredIndex` ref prevents re-anchoring on unrelated re-renders.
  - **Morph:** `layout={layoutSpring}` on the container animates the size change;
    bubble/pill content entering via the motion presets.
  - Drag clamp becomes width-aware (`maxX = Math.max(minX, width - curW - 8)`); on
    expand, re-clamp X so the full pill fits on-screen.

## Defaults chosen

- Expanded/collapsed state sticky across selections (re-anchor position, keep state).
- Bubble at the trailing screen edge (reading-direction aware) at the tap Y, not the
  tap X (block spans full width; a side anchor is cleaner and avoids off-screen).
- Multi-select bubble icon: `Type`.

## Risks

- **Tap-to-expand vs Pan vs chip taps.** The Pan already uses `activeOffsetY`/`failOffsetX`
  so a zero-movement tap doesn't activate → the bubble's `onPress` (expand) and the
  chips' `onPress` fire normally. Verify on device.
- **Paragraph taps open the keyboard** (`enterOrSelect` → `setEditingBlock`), so the
  floating bubble mainly appears for image/table selection or after keyboard dismiss.
  anchorY is still captured on the paragraph tap for the keyboard-dismiss case
  (approximate if the doc scrolled). Acceptable; drag corrects.
- **Expand near a screen edge** could push the 320px pill off-screen — the expand
  re-clamp handles it.

## Verification

tsc per task; device QA: tap-expand, collapse chevron, adaptive icon per kind,
spawn-beside-block, re-anchor on new selection, drag both states, drag-to-X from
both, morph feel, keyboard dock, RTL, Reduce Motion.
