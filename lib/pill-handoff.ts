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

function markPillHandoff() {
  handoffUntil = Date.now() + 250;
  pillHandoffSV.value = 1;
  setTimeout(() => {
    if (Date.now() >= handoffUntil) pillHandoffSV.value = 0;
  }, 300);
}

// Zustand listeners fire synchronously inside set(), BEFORE React re-renders —
// so the flag is up before the new row's pill mounts. Marking a handoff when no
// remount actually happens (same anchor row) is harmless: entering/exiting only
// consult the flag when a mount/unmount occurs.
useWorkspaceStore.subscribe((s, prev) => {
  if (
    s.selectedBlocks !== prev.selectedBlocks &&
    s.selectedBlocks.length > 0 &&
    prev.selectedBlocks.length > 0
  ) {
    markPillHandoff();
  }
});
