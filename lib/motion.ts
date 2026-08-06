import {
  Easing,
  LinearTransition,
  ZoomIn,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { EntryExitAnimationFunction } from "react-native-reanimated";
import { pillHandoffSV } from "./pill-handoff";
import { panelSwapSV, pillSwapSV, toolsSwapSV } from "./pill-swap";

/**
 * The workspace bubble's motion vocabulary, in two INDEPENDENT halves.
 *
 * OPEN and CLOSE are deliberately not two directions of one animation: they have
 * different jobs, so they get different curves, different distances and different
 * budgets. Opening is a spring — it should feel like the surface arrives with intent.
 * Closing is a timing curve — it should simply be over, and never "settle" (a spring
 * close leaves the surface hanging around at low opacity, which is most of what reads
 * as sluggishness). Tune one without touching the other.
 *
 * The third rule that makes them separate in PRACTICE: when one surface replaces
 * another, only the arriving one animates — the leaving one vanishes instantly. See
 * lib/pill-swap.ts for why, and for what counts as a replacement.
 *
 * Budget: the whole open moment — surface in, chips complete — lands inside ~200ms,
 * with springs settled by ~250ms. Damping ratios stay near ζ≈0.5: pushing stiffness
 * without damping reads twitchy, which feels slow again for a different reason.
 */

// ── OPEN ───────────────────────────────────────────────────────────────────
/** Entrance spring for the pill / panel / chips. Settles in ~250ms. */
export const SPRING_OPEN = { damping: 32, stiffness: 1000, mass: 1 } as const;
/** Shared spring for in-place feedback (chip press, active pop, drag settle) —
 *  not an open/close animation, so it lives outside both halves. */
export const SPRING = { damping: 26, stiffness: 700, mass: 1 } as const;
/** Softer spring for larger surfaces (the ✦ glow ring). */
export const SPRING_SOFT = { damping: 22, stiffness: 520, mass: 1 } as const;
/** Per-chip entrance offset — small enough to read as one ripple across the row
 *  rather than chips arriving one at a time. */
export const STAGGER_MS = 12;
/** Cap the stagger tail so long rows (12+ chips) finish with the first ones. */
const STAGGER_MAX_MS = 60;
export const PRESS_SCALE = 0.85;

// ── CLOSE ──────────────────────────────────────────────────────────────────
// Timings, never springs. Each surface closes on its own budget: the pill travels
// furthest so it gets the longest, a panel is smaller and lighter, chips just fade.
const PILL_CLOSE = { duration: 100, easing: Easing.in(Easing.quad) };
const PANEL_CLOSE = { duration: 90, easing: Easing.in(Easing.quad) };
const BUBBLE_CLOSE_MS = 110;
const CHIP_CLOSE_MS = 70;
/** A replaced surface leaves in one frame — see lib/pill-swap.ts. */
const INSTANT = { duration: 1 };

/** Vanish now, animate nothing. Reanimated needs a real animation object here, so a
 *  1ms fade from an already-invisible state stands in for "just go". */
function gone() {
  "worklet";
  return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(0, INSTANT) } };
}

// ── The pill / column strip ────────────────────────────────────────────────

/** OPEN: springs up from under the block with a slight overshoot. Short travel (28px)
 *  — the eye finishes tracking it sooner than a long slide. */
export const pillIn: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 28 }, { scale: 0.9 }] },
    animations: {
      opacity: withTiming(1, { duration: 60 }),
      transform: [{ translateY: withSpring(0, SPRING_OPEN) }, { scale: withSpring(1, SPRING_OPEN) }],
    },
  };
};

/** CLOSE: a quick drop-fade with no bounce — but instant in the two cases where
 *  something else is simultaneously animating INTO the same spot: a block→block
 *  handoff (the pill "moves" instead of hiding and reappearing) and a bubble swap
 *  (the bubble is already popping in over it). */
export const pillOutUnlessHandoff: EntryExitAnimationFunction = () => {
  "worklet";
  if (pillHandoffSV.value === 1 || pillSwapSV.value === 1) return gone();
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, PILL_CLOSE),
      transform: [{ translateY: withTiming(40, PILL_CLOSE) }, { scale: withTiming(0.9, PILL_CLOSE) }],
    },
  };
};

// ── The collapsed ✦ bubble ─────────────────────────────────────────────────

/** OPEN: the bubble is always the only thing arriving, so it never needs suppressing. */
export const bubbleIn = ZoomIn.springify().damping(SPRING_OPEN.damping).stiffness(SPRING_OPEN.stiffness);

/** CLOSE: instant while the expanded pill springs in over it, else a quick zoom out.
 *  A springy bubble exit was leaving it shrinking UNDER the arriving pill. */
export const bubbleOut: EntryExitAnimationFunction = () => {
  "worklet";
  if (pillSwapSV.value === 1) return gone();
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: BUBBLE_CLOSE_MS }),
      transform: [{ scale: withTiming(0.7, { duration: BUBBLE_CLOSE_MS }) }],
    },
  };
};

// ── The category sub-panel ─────────────────────────────────────────────────

/** OPEN: bottom-origin springy zoom out of the pill. */
export const rowIn: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 10 }, { scale: 0.88 }] },
    animations: {
      opacity: withTiming(1, { duration: 50 }),
      transform: [{ translateY: withSpring(0, SPRING_OPEN) }, { scale: withSpring(1, SPRING_OPEN) }],
    },
  };
};

/** CLOSE: a fast fade + slight sink — instant when another panel is replacing it
 *  (Style → Align), or when a handoff would otherwise leave the old anchor's panel
 *  lingering behind the moving pill. */
export const rowOutUnlessHandoff: EntryExitAnimationFunction = () => {
  "worklet";
  if (pillHandoffSV.value === 1 || panelSwapSV.value === 1) return gone();
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, PANEL_CLOSE),
      transform: [{ translateY: withTiming(10, PANEL_CLOSE) }, { scale: withTiming(0.92, PANEL_CLOSE) }],
    },
  };
};

// ── Tool chips ─────────────────────────────────────────────────────────────

/** OPEN: staggered pop-in. `i` = the chip's position in its row. Starts at 0.6 scale
 *  so the pop is short — chips need to be READABLE fast, not animated at length. */
export const chipIn = (i = 0): EntryExitAnimationFunction => {
  const delay = Math.min(i * STAGGER_MS, STAGGER_MAX_MS);
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 70 })),
        transform: [{ scale: withDelay(delay, withSpring(1, SPRING_OPEN)) }],
      },
    };
  };
};

/** CLOSE: a fast fade for an outgoing tool row. Instant on a compact ⇄ full swap,
 *  where the two rows are mostly the SAME chips and dissolving one into the other
 *  just reads as jitter; a block-KIND change keeps the fade, because that crossfade
 *  is the smart-pill morph itself. */
export const chipOut: EntryExitAnimationFunction = () => {
  "worklet";
  if (toolsSwapSV.value === 1) return gone();
  return {
    initialValues: { opacity: 1 },
    animations: { opacity: withTiming(0, { duration: CHIP_CLOSE_MS }) },
  };
};

// ── In-place morph (no mount/unmount, so no open/close split applies) ───────
/** Springy size/position morph for the pill ⇄ full-card container. Uses the OPEN
 *  spring: it runs on the open/close moment itself, where a slow settle is exactly
 *  what reads as lag. */
export const layoutSpring = LinearTransition.springify()
  .damping(SPRING_OPEN.damping)
  .stiffness(SPRING_OPEN.stiffness);
