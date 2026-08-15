// Drag-to-reorder tuning. Named constants rather than literals because every one
// of them was arrived at by feel on a real device — changing one is a UX decision.

export const GUTTER_PX = 42;     // width of the drag-handle gutter (hit zone) — matches the CSS padding
export const LIFT_HOLD_MS = 150; // tiny hold on the handle before the block lifts…
export const LIFT_MOVE_PX = 6;   // …or this much finger movement, whichever comes first
export const EDGE_PX = 44;       // auto-scroll band at top/bottom
export const EDGE_SPEED = 12;    // px per frame at the very edge
export const SETTLE_MS = 420;    // how long the drop preview is held while the real move round-trips
