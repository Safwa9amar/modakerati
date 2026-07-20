import { makeMutable } from "react-native-reanimated";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * Block→block selection handoff detection for the workspace pill.
 *
 * The pill is anchored inline under the selected block's row, so moving the
 * selection to another block unmounts it in one row and mounts it in another.
 * Without this flag that replays exit + entrance ("hide then reappear") — the
 * pill should only spring in on first select and drop away on deselect; on a
 * handoff it must reposition instantly.
 */

/** UI-thread flag read by motion.ts's pillOutUnlessHandoff exit worklet. */
export const pillHandoffSV = makeMutable(0);

let handoffUntil = 0;

/** JS-thread check — decides `entering` at mount time during the handoff render. */
export function isPillHandoff() {
  return Date.now() < handoffUntil;
}

const HANDOFF_MS = 250;

function markPillHandoff() {
  handoffUntil = Date.now() + HANDOFF_MS;
  pillHandoffSV.value = 1;
  // Aligned with handoffUntil — no trailing window where only the SV is set.
  setTimeout(() => {
    if (Date.now() >= handoffUntil) pillHandoffSV.value = 0;
  }, HANDOFF_MS);
}

// ── Ask-AI glow dedup ──────────────────────────────────────────────────────
// The glow ring should pulse once per NEW selection target. The pill remounts
// far more often than the target changes (block→block handoff, keyboard
// open/close swapping the compact/docked instances), so the last pulsed key
// lives here at module scope, across instances.
let lastGlowKey: string | null = null;

/** Record `key` as seen and report whether this mount deserves a glow pulse:
 *  yes only for a genuinely new selection target outside a handoff window. */
export function shouldGlow(key: string) {
  const glow = !isPillHandoff() && key !== lastGlowKey;
  lastGlowKey = key;
  return glow;
}

// Zustand listeners fire synchronously inside set(), BEFORE React re-renders —
// so the flag is up before the new row's pill mounts. Marking a handoff when no
// remount actually happens (same anchor row) is harmless: pillIn/pillOut only
// consult the flag at mount/unmount, and shouldGlow only on a new key — neither
// fires without an actual change.
useWorkspaceStore.subscribe((s, prev) => {
  if (s.selectedBlocks === prev.selectedBlocks) return;
  if (s.selectedBlocks.length === 0) {
    // Real deselect: cancel any pending handoff so the pill's exit drop-fades.
    handoffUntil = 0;
    pillHandoffSV.value = 0;
    // Reselecting the same block after a deselect should glow again.
    lastGlowKey = null;
    return;
  }
  // Single→single moves only — entering multi-select hides the pill and should
  // keep its drop-fade; multi→single mounts a fresh pill and should spring in.
  if (prev.selectedBlocks.length === 1 && s.selectedBlocks.length === 1) {
    markPillHandoff();
  }
});
