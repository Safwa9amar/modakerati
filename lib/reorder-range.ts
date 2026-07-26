// lib/reorder-range.ts
// Pure block-index math for reorder. No React, no DOM — verifiable in isolation.
// Block indices are POSITIONAL (0..n-1), matching $lexicalToBlocks() and the
// server's move op (patchMove: splice(from,1) then splice(to,0,item)).

export type MoveOp = { type: "move"; from: number; to: number };

// A drop "gap" g means "land before the block currently at index g" (g in 0..n).
// react-native-reorderable-list / patchMove semantics: move(from,to) places the
// item at final index `to` AFTER removal. So dropping a single block from `from`
// into gap `g`:
//   - moving down (g > from): the removal shifts targets down by one → final = g-1
//   - moving up   (g <= from): final = g
export function singleMoveTo(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

// Relocate a contiguous run [from, from+count) so it lands starting at gap `g`,
// expressed as a sequence of single `move` ops (no new op type). Each op is applied
// to the array state produced by the previous op, so indices are re-derived stepwise.
// Strategy: move the run one element at a time, preserving intra-run order.
//   - moving down: repeatedly move the run's first element to (g-1), because after
//     removing an element at `from`, the destination shifts left by one.
//   - moving up: move successive run elements to g, g+1, g+2 … keeping their order.
export function rangeMoveOps(from: number, count: number, gap: number): MoveOp[] {
  if (count <= 0) return [];
  if (gap >= from && gap <= from + count) return []; // drop inside/adjacent self → no-op
  const ops: MoveOp[] = [];
  if (gap > from + count) {
    // moving down: dest index for the (shrinking) run's head is gap-1
    const dest = gap - 1;
    for (let i = 0; i < count; i++) ops.push({ type: "move", from, to: dest });
  } else {
    // moving up: pull each run element (they sit at from, from+1, …) to g, g+1, …
    for (let i = 0; i < count; i++) ops.push({ type: "move", from: from + i, to: gap + i });
  }
  return ops;
}
