# Pill Toolbar Animations — Design

**Date:** 2026-07-20
**Status:** Approved (brainstormed via visual companion; user picked options in browser)
**Scope:** `components/workspace/BlockContextBar.tsx`, `components/workspace/BlockToolbarPill.tsx`, new `lib/motion.ts`

## Goal

Give the block-anchored pill toolbar (BlockContextBar) a coherent, springy motion
language using react-native-reanimated 4.3.1. Today every state change is an
instant snap: the pill mounts abruptly, the category expansion row pops in, the
(+) → full-card swap is a hard cut, and chips give no press feedback.

## Decisions (from brainstorming)

- **Personality: springy & playful.** Overshoot springs, staggered chip pop-in,
  bouncy expansion. Chosen over calm/iOS-subtle and liquid-morph in a live
  browser comparison. Pairs with the recently shipped haptic feedback.
- **Timing: snappy.** All springs settle ≲ 400 ms. Stagger step 40 ms.
- **Moments animated (all five):**
  1. Pill entrance & exit (block select / deselect)
  2. Category expansion row (Style / Align / Direction options)
  3. Smart-pill toolset morph (paragraph ↔ image ↔ table chip sets)
  4. (+) → full-card expand and X → collapse
  5. Micro-interactions (chip press, active pop, ✦ Ask AI glow, saving dot)
- **Explicitly NOT animated:** the keyboard-docking transition (compact pill →
  full-width docked bar when the keyboard opens). It competes with the OS
  keyboard animation and timing differs iOS vs Android; it stays an instant swap.
- **Approach: Reanimated declarative presets + layout transitions** (entering/
  exiting + `LinearTransition`), not manual shared-value orchestration and not a
  new dependency (Moti rejected).

## Components

### 1. `lib/motion.ts` — the motion language (new)

Single source of truth so every moment shares one dialect:

- `PILL_SPRING` — spring config tuned to settle ≲ 400 ms (approx damping 18,
  stiffness 250; tune on device).
- `STAGGER_MS = 40`.
- Preset factories built on Reanimated's entering/exiting builders:
  - `chipIn(i)` — `ZoomIn.springify(...).delay(i * STAGGER_MS)`
  - `chipOut` — fast ease-in scale/fade (~150 ms)
  - `rowIn` — bottom-origin springy zoom for the expansion row
  - `rowOut` — ~150 ms fade + slight scale-down
  - `pillIn` / `pillOut` — spring-up entrance / ~250 ms drop-fade exit
- `PRESS_SCALE = 0.85` for chip press-down.

### 2. `AnimatedChip` — chip component with feedback (new, module-level)

Replaces the `chip()` element-returning helper in BlockContextBar (and styles the
expansion option pills). Module-level + memoized so it is NOT a fresh component
type per render (the existing helper comment's remount concern stays honored).

- Press-in: scale to 0.85 with `PILL_SPRING`; press-out: spring back (overshoot).
- Becoming `active`: overshoot pop (scale 0.85 → 1 with spring) + fill change.
- Same props as today's `chip()` opts (Icon, onPress, active, disabled, dim,
  accessibilityLabel) — call sites change mechanically.

### 3. BlockContextBar wiring

- **Entrance/exit:** compact pill wrapped in `Animated.View` with
  `pillIn`/`pillOut`; chips get `chipIn(i)`. The pill unmounts inside the
  outline Row (BlockToolbarPill host stays mounted), so `exiting` runs.
- **Toolset morph:** the tools row wrapped in an `Animated.View` with
  `key={toolsetKind}` where `toolsetKind = 'image' | 'table' | 'paragraph'`.
  Selection-kind change remounts the row → old chips `chipOut`, new chips
  `chipIn(i)` stagger. No bespoke crossfade code.
- **Category expansion:** `renderExpansion()` wrapper becomes `Animated.View`
  with `rowIn`/`rowOut`; each option pill gets `chipIn(i)` stagger. The tapped
  category chip's active pop comes free from AnimatedChip.
- **(+) → full card:** container gets `layout={LinearTransition.springify()}`;
  the expanded rows' chips enter with `chipIn(i)`; X-collapse reverses.
- **Micro:**
  - ✦ Ask AI: ONE-SHOT glow/scale pulse (withSequence) when the selection
    changes — never an infinite loop (battery).
  - Saving dot: `withRepeat` opacity/scale pulse while `saving` is true
    (animation stops when the dot unmounts).

## Risks & fallbacks

- **`LinearTransition` on New Arch with a nested gesture-handler ScrollView**
  (the (+) → full-card grow) is the risky moment. If it glitches, fallback:
  measured height-morph via a shared value (equivalent of CSS `0fr → 1fr`),
  same look, more code. All other moments use plain entering/exiting, which are
  low-risk.
- **Exit animation depends on parent staying mounted.** BlockToolbarPill's Row
  gate currently keeps the host in the tree; if a future refactor unmounts the
  Row itself on deselect, the exit animation silently stops running — leave a
  comment at the gate.
- **RTL:** rows use `flexDirection: row-reverse`; index-based stagger then runs
  from the visual row start, which is acceptable. If it feels wrong on device,
  invert delay order when `rtl` is true (index math only).
- **Reduce Motion:** Reanimated disables entering/exiting/layout animations when
  the OS reduce-motion setting is on — no extra work, but verify once on device.

## Out of scope

- Keyboard-docking transition (deliberate, see Decisions).
- Any animation in the WordDocxView / OnlyOffice / PDF views.
- Expo v56 docs check before implementation (per AGENTS.md) happens in the
  implementation plan, not here.

## Verification

No JS test runner in this app. Gate: `npx tsc --noEmit` + run the app and
exercise all five moments on device (both LTR and RTL theses), with Reduce
Motion on and off.
