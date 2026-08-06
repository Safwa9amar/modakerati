import { makeMutable } from "react-native-reanimated";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useToolbarStore } from "@/stores/toolbar-store";

/**
 * OPEN and CLOSE are separate animations — this is what keeps them from running at
 * the same time.
 *
 * A React view can't animate out and in as one motion: closing unmounts one tree and
 * opening mounts another, so Reanimated plays the old view's `exiting` and the new
 * view's `entering` CONCURRENTLY, in the same spot. That reads as a stutter — the
 * collapsing pill sinking away while the bubble is already popping in over it, two
 * category panels crossfading through each other.
 *
 * The rule: when a surface is REPLACED by its counterpart, only the arriving side
 * animates. The leaving side is marked as a swap and vanishes instantly (see the
 * exit worklets in lib/motion.ts). A plain open (nothing was there) or a plain close
 * (nothing replaces it) is untouched — each keeps its own full animation, tuned on
 * its own terms.
 *
 * Mirrors lib/pill-handoff.ts, including WHY the marking happens in a zustand
 * subscriber: those fire synchronously inside set(), BEFORE React re-renders, so the
 * flag is up by the time the outgoing view unmounts. Marking it after the fact would
 * be useless — an exit worklet reads the flag once, when the view is removed.
 */

/** The bubble ⇄ expanded pill/dock swap (FloatingPill). */
export const pillSwapSV = makeMutable(0);
/** One category sub-panel replacing another (Style → Align). */
export const panelSwapSV = makeMutable(0);
/** The compact tool row ⇄ the full one, via (+) More / ✕. */
export const toolsSwapSV = makeMutable(0);

type Surface = "pill" | "panel" | "tools";

const SV: Record<Surface, typeof pillSwapSV> = {
  pill: pillSwapSV,
  panel: panelSwapSV,
  tools: toolsSwapSV,
};
const until: Record<Surface, number> = { pill: 0, panel: 0, tools: 0 };

// Long enough to cover the replaced view's unmount commit, short enough that an
// unrelated close a moment later still gets its own animation.
const SWAP_MS = 200;

/** Each surface has its OWN flag: a panel switching in the same frame as a pill
 *  collapse must not silence the pill's close animation. */
function markSwap(surface: Surface) {
  until[surface] = Date.now() + SWAP_MS;
  SV[surface].value = 1;
  setTimeout(() => {
    if (Date.now() >= until[surface]) SV[surface].value = 0;
  }, SWAP_MS);
}

/** JS-thread check — for deciding `entering` at mount time, mid-swap. */
export function isSwapping(surface: Surface) {
  return Date.now() < until[surface];
}

// Bubble ⇄ pill, and pill ⇄ AI dock: one always replaces the other in the same host.
useFloatingPillStore.subscribe((s, prev) => {
  if (s.expanded !== prev.expanded || s.inputOpen !== prev.inputOpen) markSwap("pill");
});

useToolbarStore.subscribe((s, prev) => {
  // Only a REPLACEMENT overlaps. Opening from nothing and closing to nothing are each
  // the sole animation on screen, so they keep their own.
  if (s.category !== prev.category && prev.category != null && s.category != null) {
    markSwap("panel");
  }
  // (+) More ⇄ ✕: the tool row is keyed per form, so it remounts. Unlike a block-KIND
  // change — where the crossfade IS the smart-pill morph, and stays — these two rows
  // are mostly the same chips, and dissolving one into the other just reads as jitter.
  if (s.expanded !== prev.expanded) markSwap("tools");
});
