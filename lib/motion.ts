import {
  Easing,
  FadeOut,
  LinearTransition,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { EntryExitAnimationFunction } from "react-native-reanimated";
import { pillHandoffSV } from "./pill-handoff";

/** Shared spring — settles ≲ 400ms. Every pill moment speaks this dialect. */
export const SPRING = { damping: 18, stiffness: 250, mass: 1 } as const;
/** Slightly softer spring for larger surfaces (expansion row, glow ring). */
export const SPRING_SOFT = { damping: 16, stiffness: 220, mass: 1 } as const;
export const STAGGER_MS = 40;
/** Cap the stagger tail so long rows (12 chips) don't feel laggy. */
const STAGGER_MAX_MS = 240;
export const PRESS_SCALE = 0.85;

const OUT_TIMING = { duration: 180, easing: Easing.in(Easing.quad) };
const ROW_OUT_TIMING = { duration: 150, easing: Easing.in(Easing.quad) };

/** Compact pill entrance: springs up from under the block with slight overshoot. */
export const pillIn: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 48 }, { scale: 0.85 }] },
    animations: {
      opacity: withTiming(1, { duration: 160 }),
      transform: [{ translateY: withSpring(0, SPRING) }, { scale: withSpring(1, SPRING) }],
    },
  };
};

/** Pill exit: quick drop-fade — no bounce on the way out. */
export const pillOut: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, OUT_TIMING),
      transform: [
        { translateY: withTiming(40, OUT_TIMING) },
        { scale: withTiming(0.9, OUT_TIMING) },
      ],
    },
  };
};

/** Pill exit that skips itself during a block→block selection handoff: the pill
 *  vanishes instantly here and appears instantly under the new block ("moves"),
 *  instead of drop-fading out and springing back in. */
export const pillOutUnlessHandoff: EntryExitAnimationFunction = () => {
  "worklet";
  if (pillHandoffSV.value === 1) {
    return {
      initialValues: { opacity: 0 },
      animations: { opacity: withTiming(0, { duration: 1 }) },
    };
  }
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, OUT_TIMING),
      transform: [
        { translateY: withTiming(40, OUT_TIMING) },
        { scale: withTiming(0.9, OUT_TIMING) },
      ],
    },
  };
};

/** Category expansion row: bottom-origin springy zoom out of the pill. */
export const rowIn: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 14 }, { scale: 0.85 }] },
    animations: {
      opacity: withTiming(1, { duration: 140 }),
      transform: [
        { translateY: withSpring(0, SPRING_SOFT) },
        { scale: withSpring(1, SPRING_SOFT) },
      ],
    },
  };
};

/** Category expansion close: fast fade + slight sink. */
export const rowOut: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: {
      opacity: withTiming(0, ROW_OUT_TIMING),
      transform: [
        { translateY: withTiming(10, ROW_OUT_TIMING) },
        { scale: withTiming(0.92, ROW_OUT_TIMING) },
      ],
    },
  };
};

/** Per-chip staggered pop-in. `i` = the chip's position in its row. */
export const chipIn = (i = 0): EntryExitAnimationFunction => {
  const delay = Math.min(i * STAGGER_MS, STAGGER_MAX_MS);
  return () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.4 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 120 })),
        transform: [{ scale: withDelay(delay, withSpring(1, SPRING)) }],
      },
    };
  };
};

/** Fast fade for outgoing tool rows (toolset morph / collapse). */
export const chipOut = FadeOut.duration(120);

/** Springy size/position morph for the pill ⇄ full-card container. */
export const layoutSpring = LinearTransition.springify()
  .damping(SPRING.damping)
  .stiffness(SPRING.stiffness);
