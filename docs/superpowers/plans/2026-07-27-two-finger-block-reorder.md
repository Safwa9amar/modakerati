# Two‑finger block reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user reorder document blocks by lifting one with two fingers (brief hold → haptic pop) and dragging it to a new position, directly inside the live Lexical writer.

**Architecture:** All gesture logic lives in the DOM/Lexical layer (a new `ReorderPlugin` in `blockLexical`/`LexicalDomEditor`). It computes a `from`/`to` (or range) in **block‑index space** and hands it to native through a thin bridge callback; native reuses the existing, battle‑tested `move` op (`useThesisDocStore.mutate({type:"move",from,to})`) / `applyThesisOps` batch. The optimistic doc update + the existing sync‑layer reseed repaint the new order. No server change, no new op type.

**Tech Stack:** Lexical (in an Expo DOM component / WKWebView), React Native, Zustand stores, `expo-haptics` (via `@/lib/haptics`).

**Spec:** `docs/superpowers/specs/2026-07-27-two-finger-block-reorder-design.md`

---

## Verification model (read first)

The Expo app has **no JS test runner** (see the project's app‑verification rule — no jest/TDD for app code). So this plan does **not** write jest tests. Every task is gated by:

1. **`npx tsc --noEmit`** (from `/Users/hamzasafwan/modakerati`) — must be clean. This is the automated gate.
2. **Pure‑logic helpers** (`lib/reorder-range.ts`) are verified with a **throwaway `npx tsx` script** run once (the app has `tsx`/`ts-node` available for scripts) — real assertions, real output, then delete the script.
3. **On‑device QA checklist** at the end of each phase — the WKWebView touch behavior can only be judged on a real device.

Touch thresholds (hold ms, move‑cancel px, edge‑band px) are **tuning constants** — the plan gives working defaults and the QA step is where they get dialed in.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `lib/reorder-range.ts` | **New.** Pure helpers: `singleMoveTo(from, gap)` → final `to`; `rangeMoveOps(from, count, gap)` → `MoveOp[]` for relocating a contiguous run; `blockEntries` types. No React/DOM. | Create |
| `components/workspace/lexical/blockLexical.tsx` | Add `ReorderPlugin` (the touch state machine + overlay + insertion line + auto‑scroll + heading toggle + amber confirm) and a `$blockEntries()` reader that maps top‑level nodes → `{el, from, count, isHeading, level}`. | Modify |
| `components/workspace/lexical/LexicalDomEditor.tsx` | Add `onReorder`/`onReorderRange` props to `LexicalDomEditor` + inner `Props`, thread them to `ReorderPlugin`, and pass a `reorderSuppressed` flag (mirrors `SlashPlugin`'s `suppressed`). Add the CSS for the overlay / insertion line / toggle. | Modify |
| `components/workspace/WorkspaceLexicalView.tsx` | Provide `onReorder`/`onReorderRange` handlers that dispatch the existing `move` op / `applyThesisOps` batch, plus a `chapters` prop derived from `blocks[].level` for the cross‑chapter confirm. | Modify |

New CSS classes (in `LexicalDomEditor`'s injected stylesheet): `.lx-drag-ghost`, `.lx-drop-line`, `.lx-drop-line-cross`, `.lx-drag-toggle`.

---

## Phase 1 — Single‑block reorder (MVP)

Goal of the phase: two‑finger hold lifts a single top‑level block (paragraph / heading / table / image / whole list), drag shows a ghost + insertion line with edge auto‑scroll, release emits one `move` op. No heading‑carry, no cross‑section confirm yet.

### Task 1: Pure move‑math helper

**Files:**
- Create: `lib/reorder-range.ts`

- [ ] **Step 1: Write the helper**

```ts
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
```

- [ ] **Step 2: Verify the math with a throwaway script**

Create `scratch-reorder-check.ts` at repo root:

```ts
import { singleMoveTo, rangeMoveOps, type MoveOp } from "./lib/reorder-range";
const apply = (arr: number[], op: MoveOp) => { const a = [...arr]; const [x] = a.splice(op.from, 1); a.splice(op.to, 0, x); return a; };
const runRange = (arr: number[], from: number, count: number, gap: number) => rangeMoveOps(from, count, gap).reduce(apply, arr);
const eq = (a: number[], b: number[]) => JSON.stringify(a) === JSON.stringify(b);
let ok = true; const check = (name: string, got: number[], want: number[]) => { const p = eq(got, want); ok &&= p; console.log(`${p ? "PASS" : "FAIL"} ${name}  got=${got} want=${want}`); };
// single down: [A B C D], move A(0) into gap 3 (before D) → B C A D
{ const a = ["A","B","C","D"]; const [x]=a.splice(0,1); a.splice(singleMoveTo(0,3),0,x); check("single-down", a.map((s)=>["A","B","C","D"].indexOf(s)), [1,2,0,3]); }
// single up: [A B C D], move D(3) into gap 1 → A D B C
{ const a=["A","B","C","D"]; const [x]=a.splice(3,1); a.splice(singleMoveTo(3,1),0,x); check("single-up", a.map((s)=>["A","B","C","D"].indexOf(s)), [0,3,1,2]); }
// range down: [0 1 2 3 4 5], move [1,2] to gap 5 (before 5) → 0 3 4 1 2 5
check("range-down", runRange([0,1,2,3,4,5],1,2,5), [0,3,4,1,2,5]);
// range up: [0 1 2 3 4 5], move [3,4] to gap 1 → 0 3 4 1 2 5
check("range-up", runRange([0,1,2,3,4,5],3,2,1), [0,3,4,1,2,5]);
// no-op: drop inside self
check("range-noop", runRange([0,1,2,3],1,2,2), [0,1,2,3]);
console.log(ok ? "ALL PASS" : "FAILURES"); if (!ok) process.exit(1);
```

Run: `npx tsx scratch-reorder-check.ts`
Expected: every line `PASS`, final `ALL PASS`.

- [ ] **Step 3: Delete the scratch script**

Run: `rm scratch-reorder-check.ts`

- [ ] **Step 4: tsc gate**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/reorder-range.ts
git commit -m "feat(reorder): pure block-index move math (single + range)"
```

---

### Task 2: `$blockEntries()` reader — map top‑level nodes to block‑index ranges

**Files:**
- Modify: `components/workspace/lexical/blockLexical.tsx` (add near `$lexicalToBlocks`, ~line 1544)

Rationale: reorder hit‑testing needs, for each **draggable unit**, its DOM element and its block‑index range. A paragraph/heading/table/image = 1 block; a list = one block per item (matches `$lexicalToBlocks`, which expands lists via `pushListItems`). Chrome/suggestion nodes are skipped (not draggable). Heading level rides along for Phase 2/3.

- [ ] **Step 1: Add the reader + helper types**

```ts
// blockLexical.tsx — add after $lexicalToBlocks()

// One draggable unit: a top-level node, its DOM element, and the block-index range
// it occupies. Lists occupy `count` > 1. Call inside editor.read() and pass the
// editor so we can resolve elements. Chrome/suggestion nodes are excluded.
export type BlockEntry = {
  key: string;
  from: number;      // first block index this unit occupies
  count: number;     // number of block indices (1, except lists)
  isHeading: boolean;
  level: number;     // 0 for body, 1..6 for headings; 0 for non-paragraph units
};

export function $blockEntries(): BlockEntry[] {
  const out: BlockEntry[] = [];
  let idx = 0;
  for (const node of $getRoot().getChildren()) {
    if ($isChromeNode(node)) continue;           // display-only, not draggable
    if ($isSuggestionNode(node) || $isRangeSuggestionNode(node)) {
      // reorder is suppressed while a proposal shows; still advance the index so a
      // stray call stays consistent with $lexicalToBlocks.
      idx += $isRangeSuggestionNode(node) ? (node as RangeSuggestionNode).__originals.length : 1;
      continue;
    }
    if ($isListNode(node)) {
      const items = countListItems(node as ListNode);
      out.push({ key: node.getKey(), from: idx, count: items, isHeading: false, level: 0 });
      idx += items;
      continue;
    }
    const isHeading = $isHeadingNode(node);
    const level = isHeading ? Number((node as HeadingNode).getTag().slice(1)) : 0;
    out.push({ key: node.getKey(), from: idx, count: 1, isHeading, level });
    idx += 1;
  }
  return out;
}

// Count leaf list items the way pushListItems flattens them (nested lists included).
function countListItems(list: ListNode): number {
  let n = 0;
  for (const item of list.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const nested = item.getChildren().find($isListNode) as ListNode | undefined;
    if (nested) n += countListItems(nested);
    else n += 1;
  }
  return n;
}
```

Note: if `$isListItemNode` / `RangeSuggestionNode` type aren't already imported in this file, add them to the existing `@lexical/list` / local imports (they are used elsewhere in the file — reuse the existing import lines).

- [ ] **Step 2: tsc gate**

Run: `npx tsc --noEmit`
Expected: no errors. (Fix any missing import surfaced here.)

- [ ] **Step 3: Commit**

```bash
git add components/workspace/lexical/blockLexical.tsx
git commit -m "feat(reorder): $blockEntries() maps top-level nodes to block-index ranges"
```

---

### Task 3: Bridge props (`onReorder`) through LexicalDomEditor

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (Props type ~line 1709; component signature ~1677; plugin mount ~1805)

- [ ] **Step 1: Add the prop to both the outer component and inner `Props`**

In the outer `LexicalDomEditor` destructure (near `onEditCell`, ~1694) add `onReorder`, and in the props type (near `onEditCell?:`, ~1744) add:

```ts
  onReorder?: (from: number, to: number) => void;
```

- [ ] **Step 2: Mount the plugin**

After `<SlashPlugin … />` (~line 1814) add:

```tsx
        <ReorderPlugin
          onReorder={onReorder}
          onLift={onLift}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
        />
```

Also add `onLift?: () => void;` to both the outer destructure and the props type, alongside `onReorder`. `onLift` fires the real native lift haptic (the DOM can't call `expo-haptics`); it's defined in Task 5.

`ReorderPlugin` is defined in Task 4 and imported from `./blockLexical` (or defined inline in `LexicalDomEditor` alongside the other plugins — keep it in `LexicalDomEditor.tsx` next to `SlashPlugin`/`CompletionPlugin`, since those are the sibling patterns).

- [ ] **Step 3: tsc gate** (`ReorderPlugin` unresolved is expected until Task 4)

Run: `npx tsc --noEmit`
Expected: only "Cannot find name 'ReorderPlugin'". Proceed to Task 4 before committing.

---

### Task 4: `ReorderPlugin` — gesture state machine + drag visuals

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (add the plugin next to `SlashPlugin`, ~line 1362; import `$blockEntries`, `type BlockEntry` from `./blockLexical`)

Design notes baked into the code:
- **Arming:** `touchstart` with exactly 2 touches records the midpoint + starts a 250 ms timer. `touchmove` before the timer with midpoint delta > 10 px cancels (it was a scroll — we never called `preventDefault`, so scroll runs normally).
- **Lift:** on timer fire (still 2 touches, not cancelled) → haptic pop, clone the target block element into `.lx-drag-ghost`, dim the source, snapshot every entry's `rect` (via `getBoundingClientRect`) for hit‑testing.
- **Drag:** `touchmove` (now `preventDefault`'d) moves the ghost to the midpoint, finds the nearest gap, positions `.lx-drop-line`, and runs edge auto‑scroll.
- **Drop:** `touchend` → compute `to = singleMoveTo(from, gap)`, call `onReorder(from, to)` (unless no‑op), remove overlay. The existing sync‑layer reseed repaints the new order.

- [ ] **Step 1: Write the plugin**

```tsx
// LexicalDomEditor.tsx — add near SlashPlugin. Import at top:
//   import { $blockEntries, type BlockEntry } from "./blockLexical";
// (hLight/hMedium haptics run natively — the DOM bundle can't call expo-haptics,
//  so we signal the pop via a bridge no-op: use a CSS/vibration fallback here and
//  fire the real haptic natively in WorkspaceLexicalView.onReorder. For the lift
//  pop we use navigator.vibrate when available; it's a no-op on iOS but harmless.)

const HOLD_MS = 250;
const CANCEL_PX = 10;
const EDGE_PX = 44;
const EDGE_SPEED = 12; // px per frame at the very edge

function ReorderPlugin({
  onReorder,
  onLift,
  suppressed,
}: {
  onReorder?: (from: number, to: number) => void;
  onLift?: () => void;
  suppressed?: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const scroller = root.closest(".lx-scroll") as HTMLElement | null ?? document.scrollingElement as HTMLElement ?? root;

    type Live = {
      startMid: { x: number; y: number };
      timer: ReturnType<typeof setTimeout> | null;
      armed: boolean;      // timer still pending
      lifted: boolean;
      from: number; count: number;
      entries: { from: number; count: number; top: number; bottom: number }[];
      gaps: number[];      // y of each gap boundary, length entries+1
      ghost: HTMLElement | null;
      line: HTMLElement | null;
      srcEl: HTMLElement | null;
      raf: number | null;
      lastY: number;
    };
    let L: Live | null = null;

    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

    const cleanup = () => {
      if (!L) return;
      if (L.timer) clearTimeout(L.timer);
      if (L.raf) cancelAnimationFrame(L.raf);
      L.ghost?.remove();
      L.line?.remove();
      if (L.srcEl) L.srcEl.style.opacity = "";
      L = null;
    };

    const buildEntries = () => {
      // Read Lexical → entries with DOM rects. Skip if the touched unit is unknown.
      let entries: BlockEntry[] = [];
      editor.getEditorState().read(() => { entries = $blockEntries(); });
      const rects = entries
        .map((e) => {
          const el = editor.getElementByKey(e.key);
          const r = el?.getBoundingClientRect();
          return r ? { from: e.from, count: e.count, top: r.top, bottom: r.bottom } : null;
        })
        .filter(Boolean) as Live["entries"];
      // gaps: boundary before each entry, plus after the last
      const gaps = rects.map((r) => r.top);
      if (rects.length) gaps.push(rects[rects.length - 1].bottom);
      return { rects, gaps };
    };

    const unitAt = (y: number, rects: Live["entries"]) =>
      rects.find((r) => y >= r.top && y <= r.bottom) ?? null;

    const gapFor = (y: number, gaps: number[]) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < gaps.length; i++) { const d = Math.abs(gaps[i] - y); if (d < bestD) { bestD = d; best = i; } }
      return best; // 0..entries.length  → block gap index
    };

    // gap index is in ENTRY space; convert to BLOCK space via the entry `from`s.
    const gapToBlock = (gapIdx: number, rects: Live["entries"]) =>
      gapIdx >= rects.length ? (rects.length ? rects[rects.length - 1].from + rects[rects.length - 1].count : 0) : rects[gapIdx].from;

    const onTouchStart = (e: TouchEvent) => {
      if (suppressedRef.current || e.touches.length !== 2) { cleanup(); return; }
      const m = mid(e.touches);
      const target = document.elementFromPoint(m.x, m.y);
      const { rects } = buildEntries();
      // find which unit the midpoint is over
      const overRect = unitAt(m.y, rects);
      if (!overRect || !target) return;
      L = { startMid: m, timer: null, armed: true, lifted: false, from: overRect.from, count: overRect.count,
            entries: rects, gaps: [], ghost: null, line: null, srcEl: null, raf: null, lastY: m.y };
      L.timer = setTimeout(() => lift(), HOLD_MS);
    };

    const lift = () => {
      if (!L || !L.armed) return;
      L.armed = false; L.lifted = true;
      onLift?.(); // real native haptic pop (WorkspaceLexicalView → hLight)
      const { rects, gaps } = buildEntries(); // re-read fresh rects at lift
      L.entries = rects; L.gaps = gaps;
      // source element = first block element of the unit
      const first = rects.find((r) => r.from === L!.from);
      // clone visual: use the unit's DOM element
      const srcKey = (() => { let k = ""; editor.getEditorState().read(() => { const es = $blockEntries().find((x) => x.from === L!.from); k = es ? es.key : ""; }); return k; })();
      const srcEl = srcKey ? editor.getElementByKey(srcKey) as HTMLElement | null : null;
      if (!srcEl) { cleanup(); return; }
      L.srcEl = srcEl;
      const r = srcEl.getBoundingClientRect();
      const ghost = srcEl.cloneNode(true) as HTMLElement;
      ghost.className = "lx-drag-ghost " + ghost.className;
      ghost.style.width = r.width + "px";
      ghost.style.left = r.left + "px";
      ghost.style.top = r.top + "px";
      document.body.appendChild(ghost);
      srcEl.style.opacity = "0.35";
      const line = document.createElement("div");
      line.className = "lx-drop-line";
      document.body.appendChild(line);
      L.ghost = ghost; L.line = line;
      positionLine(L.lastY);
    };

    const positionLine = (y: number) => {
      if (!L?.line) return;
      const gapIdx = gapFor(y, L.gaps);
      L.line.style.top = (L.gaps[Math.min(gapIdx, L.gaps.length - 1)]) + "px";
      const rootR = editor.getRootElement()!.getBoundingClientRect();
      L.line.style.left = rootR.left + "px";
      L.line.style.width = rootR.width + "px";
    };

    const autoScroll = () => {
      if (!L?.lifted) return;
      const vh = window.innerHeight;
      let dv = 0;
      if (L.lastY < EDGE_PX) dv = -EDGE_SPEED * (1 - L.lastY / EDGE_PX);
      else if (L.lastY > vh - EDGE_PX) dv = EDGE_SPEED * (1 - (vh - L.lastY) / EDGE_PX);
      if (dv !== 0) {
        scroller.scrollTop += dv;
        // rects were captured in viewport space; recompute gaps after scroll
        const { rects, gaps } = buildEntries(); L.entries = rects; L.gaps = gaps;
        positionLine(L.lastY);
      }
      L.raf = requestAnimationFrame(autoScroll);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!L) return;
      if (e.touches.length !== 2) { cleanup(); return; }
      const m = mid(e.touches);
      L.lastY = m.y;
      if (L.armed) {
        // still deciding: a real move = it's a scroll, bail (never preventDefault)
        if (Math.hypot(m.x - L.startMid.x, m.y - L.startMid.y) > CANCEL_PX) cleanup();
        return;
      }
      if (!L.lifted) return;
      e.preventDefault(); // own the gesture now
      if (L.ghost) { const r = L.ghost.getBoundingClientRect(); L.ghost.style.left = (m.x - r.width / 2) + "px"; L.ghost.style.top = (m.y - r.height / 2) + "px"; }
      positionLine(m.y);
      if (L.raf == null) L.raf = requestAnimationFrame(autoScroll);
    };

    const onTouchEnd = () => {
      if (!L || !L.lifted) { cleanup(); return; }
      const gapIdx = gapFor(L.lastY, L.gaps);
      const gapBlock = gapToBlock(gapIdx, L.entries);
      const from = L.from;
      cleanup();
      // single-block move only in Phase 1 (count===1). Lists (count>1) handled in Phase 2.
      if (from == null) return;
      const to = singleMoveTo(from, gapBlock);
      if (to !== from) onReorder?.(from, to);
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", cleanup, { passive: true });
    return () => {
      cleanup();
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", cleanup);
    };
  }, [editor]);

  return null;
}
```

Import `singleMoveTo` from `@/lib/reorder-range` at the top of `LexicalDomEditor.tsx`.

Note on `.lx-scroll`: the editor's scroll container. If the root itself scrolls (check the existing `ScrollSyncPlugin` / the `dom={{ scrollEnabled }}` wrapper), set `scroller` to the correct element — verify against `ScrollSyncPlugin` at ~line 819, which already knows the scroll element. Reuse its selector.

- [ ] **Step 2: Add the CSS**

In the injected stylesheet (the big template string with `.lx-*` rules, ~line 200–331) add:

```css
.lx-drag-ghost { position: fixed; z-index: 9999; pointer-events: none; background: #fff; border: 2px solid #4b57c4; border-radius: 10px; box-shadow: 0 16px 30px -8px rgba(75,87,196,.65); transform: rotate(-1.2deg) scale(1.03); padding: 6px 10px; opacity: .96; }
.lx-drop-line { position: fixed; z-index: 9998; height: 0; border-top: 3px solid #4b57c4; box-shadow: 0 0 8px #4b57c4; border-radius: 2px; pointer-events: none; }
.lx-drop-line-cross { border-top-color: #d68a2e; box-shadow: 0 0 8px #d68a2e; }
.lx-drag-toggle { position: fixed; z-index: 10000; background: #fff; border: 1px solid #d8d8de; border-radius: 999px; box-shadow: 0 8px 22px -6px rgba(20,22,40,.3); font-size: 12px; display: flex; gap: 2px; padding: 3px; }
```

- [ ] **Step 3: tsc gate**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/lexical/LexicalDomEditor.tsx
git commit -m "feat(reorder): ReorderPlugin — two-finger lift/drag/drop with ghost + drop line"
```

---

### Task 5: Native handler — dispatch the `move` op

**Files:**
- Modify: `components/workspace/WorkspaceLexicalView.tsx` (add handler near `onEditCell`, ~line 779; pass to `<LexicalDomEditor>` ~line 807; import `hMedium` from `@/lib/haptics`)

- [ ] **Step 1: Add the handler**

```tsx
// WorkspaceLexicalView.tsx — near onEditCell
// Reorder from the DOM plugin → the existing durable `move` op. The store applies
// the optimistic patchMove, persists + flushes, and the sync-layer effect reseeds
// Lexical to the new order. Fire the real native haptic here (the DOM can't).
const onReorder = useCallback((from: number, to: number) => {
  if (from === to) return;
  hMedium();
  void useThesisDocStore.getState().mutate(thesisId, { type: "move", from, to });
}, [thesisId]);

// Real native haptic on lift (the DOM bundle can't call expo-haptics).
const onLift = useCallback(() => { hLight(); }, []);
```

Update the import to `import { hLight, hMedium } from "@/lib/haptics";` and pass `onLift={onLift}` to `<LexicalDomEditor>` too.

- [ ] **Step 2: Pass it to the editor**

In the `<LexicalDomEditor … />` prop list (near `onEditCell={onEditCell}`, ~line 832) add:

```tsx
          onReorder={onReorder}
```

- [ ] **Step 3: Add the import**

At the top with the other lib imports:

```ts
import { hLight, hMedium } from "@/lib/haptics";
```

- [ ] **Step 4: tsc gate**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(reorder): wire ReorderPlugin to the durable move op"
```

---

### Phase 1 device QA (run the app on a real device)

Open a thesis in the Writer and verify:

- [ ] Two‑finger **quick swipe** scrolls the document — no block lifts.
- [ ] Two fingers **held ~¼s** on a paragraph → it lifts (ghost appears, source dims).
- [ ] Dragging shows a blue insertion line snapping between blocks.
- [ ] Release moves the paragraph there; order **persists after leaving + reopening** the Writer (server round‑trip).
- [ ] Dropping back where it started = no change (no banner/op).
- [ ] Holding near the top/bottom edge auto‑scrolls to reach far targets.
- [ ] One‑finger scroll + caret + text selection are all unaffected.
- [ ] A heading and a table can each be lifted and moved (count===1 units).
- [ ] Undo (dock/header) reverts the move.

Tune `HOLD_MS` / `CANCEL_PX` / `EDGE_PX` here if arming feels too eager or too sluggish. Commit any tuning as `chore(reorder): tune touch thresholds`.

---

## Phase 2 — Heading carries its section (+ lists as a unit)

Goal: lifting a heading floats a toggle (`whole section ▾ / heading only`, default whole section); whole‑section and multi‑item lists move as a contiguous **range** via one `applyThesisOps` batch.

### Task 6: Whole‑section span from `blocks[].level`

**Files:**
- Modify: `components/workspace/lexical/blockLexical.tsx` (extend the reorder helpers) — add a pure span function; **or** compute natively. Decision: compute in the DOM plugin from `$blockEntries()` (it already carries `isHeading`/`level`).

- [ ] **Step 1: Add a span helper in `reorder-range.ts`**

```ts
// lib/reorder-range.ts — append
// The block-index range a heading "owns": itself through the block before the next
// heading of the same-or-higher level. `levels` is blocks[].level in document order
// (0 = body). Returns [from, count].
export function headingSpan(levels: number[], from: number): { from: number; count: number } {
  const lvl = levels[from];
  if (!lvl) return { from, count: 1 }; // not a heading → itself only
  let end = from + 1;
  while (end < levels.length && !(levels[end] >= 1 && levels[end] <= lvl)) end++;
  return { from, count: end - from };
}
```

- [ ] **Step 2: Verify with a throwaway script**

Create `scratch-span-check.ts`:

```ts
import { headingSpan } from "./lib/reorder-range";
// levels: 0=body. Doc: H1(0) body(1) H2(2) body(3) H2(4) body(5) H1(6)
const L = [1,0,2,0,2,0,1];
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
let ok = true; const c = (n: string, got: any, want: any) => { const p = eq(got, want); ok &&= p; console.log(`${p?"PASS":"FAIL"} ${n} got=${JSON.stringify(got)}`); };
c("H1 carries to next H1", headingSpan(L, 0), { from: 0, count: 6 });
c("H2 carries to next H2", headingSpan(L, 2), { from: 2, count: 2 });
c("last H2 to next H1", headingSpan(L, 4), { from: 4, count: 2 });
c("body = self only", headingSpan(L, 1), { from: 1, count: 1 });
console.log(ok ? "ALL PASS" : "FAIL"); if (!ok) process.exit(1);
```

Run: `npx tsx scratch-span-check.ts` → expect `ALL PASS`. Then `rm scratch-span-check.ts`.

- [ ] **Step 3: tsc + commit**

Run: `npx tsc --noEmit` (clean), then:

```bash
git add lib/reorder-range.ts
git commit -m "feat(reorder): headingSpan — whole-section block range from levels"
```

---

### Task 7: `onReorderRange` bridge + native batch dispatch

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (add `onReorderRange` prop like `onReorder`)
- Modify: `components/workspace/WorkspaceLexicalView.tsx` (handler using `applyThesisOps` + `rangeMoveOps`)

- [ ] **Step 1: Add the prop** (both outer + inner `Props`, mirroring Task 3):

```ts
  onReorderRange?: (from: number, count: number, to: number) => void;
```

Thread it into `<ReorderPlugin onReorderRange={onReorderRange} … />`.

- [ ] **Step 2: Native handler** (WorkspaceLexicalView, near `onReorder`):

```tsx
// A whole-section / multi-item move: relocate a contiguous block RANGE. Expressed
// as a sequence of single move ops (rangeMoveOps) sent in ONE applyThesisOps batch
// — no new op type, one server round-trip, one reseed. `to` here is the drop GAP in
// block space (0..n); rangeMoveOps converts it to the correct positional moves.
const onReorderRange = useCallback((from: number, count: number, gap: number) => {
  const ops = rangeMoveOps(from, count, gap);
  if (ops.length === 0) return;
  hMedium();
  void (async () => {
    const store = useThesisDocStore.getState();
    if ((store.pending[thesisId] ?? 0) > 0) {   // positional ops must not interleave with queued edits
      setBanner("Syncing — try again in a moment");
      setTimeout(() => setBanner(null), 2600);
      return;
    }
    const cur = store.byId[thesisId];
    if (cur?.available) {                        // optimistic: apply locally first
      let optimistic = cur;
      for (const op of ops) optimistic = applyOpToDoc(optimistic, op);
      store.setDoc(thesisId, optimistic);
    }
    try {
      const res = await applyThesisOps(thesisId, ops);
      if (res.document) store.setDoc(thesisId, res.document);
      void store.refreshHistoryState(thesisId);
    } catch {
      void store.revalidate(thesisId);
    }
  })();
}, [thesisId]);
```

Add imports: `rangeMoveOps` from `@/lib/reorder-range` (`applyOpToDoc` and `applyThesisOps` are already imported in this file; verify `store.pending` / `refreshHistoryState` / `revalidate` exist — they're used by the table handler `onTableProposalAction` in the same file, so mirror it exactly).

- [ ] **Step 3: Pass to editor**: add `onReorderRange={onReorderRange}` to `<LexicalDomEditor>`.

- [ ] **Step 4: tsc + commit**

```bash
git add components/workspace/lexical/LexicalDomEditor.tsx components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(reorder): onReorderRange bridge + batched range move dispatch"
```

---

### Task 8: Heading toggle pill + route to range vs single in the plugin

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (`ReorderPlugin`: on lifting a heading, show `.lx-drag-toggle`; track `mode`; multi‑item lists always use range)

- [ ] **Step 1: Extend `Live` + lift() to build the toggle**

Add to `Live`: `isHeading: boolean; level: number; mode: "section" | "self"; levels: number[]`. In `buildEntries`, also read `levels` (from `$blockEntries()` → `.level` expanded per block, or read `$lexicalToBlocks().map(b=>b.level)` once at lift). In `lift()`, after building the ghost, if the lifted unit is a heading:

```ts
// read levels once for span math
let levels: number[] = [];
editor.getEditorState().read(() => { levels = $lexicalToBlocks().map((b) => (b.kind === "paragraph" ? b.level : 0)); });
L.levels = levels;
if (L.isHeading) {
  L.mode = "section";
  const pill = document.createElement("div");
  pill.className = "lx-drag-toggle";
  const mk = (label: string, m: "section" | "self") => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "border:none;border-radius:999px;padding:4px 10px;font-weight:600;background:" + (L!.mode === m ? "#4b57c4" : "transparent") + ";color:" + (L!.mode === m ? "#fff" : "#333");
    b.onclick = (ev) => { ev.stopPropagation(); L!.mode = m; pill.querySelectorAll("button").forEach((x, i) => { const on = (i === 0) === (m === "section"); (x as HTMLElement).style.background = on ? "#4b57c4" : "transparent"; (x as HTMLElement).style.color = on ? "#fff" : "#333"; }); };
    return b;
  };
  pill.appendChild(mk("Whole section", "section"));
  pill.appendChild(mk("Heading only", "self"));
  document.body.appendChild(pill);
  (L as any).pill = pill;
}
```

Position the pill near the ghost in `onTouchMove` (below the ghost). Remove it in `cleanup()`.

Note: pill labels are English here; the trilingual strings must be passed IN as props (the DOM bundle has no i18n — same pattern as `tableLabels`). Add a `reorderLabels={{ wholeSection, headingOnly, moveIntoSection }}` prop resolved via `t()` in `WorkspaceLexicalView` (mirror `tableLabels` at ~line 690) and use them instead of the literals.

- [ ] **Step 2: Route the drop**

Replace `onTouchEnd`'s single dispatch with:

```ts
const from = L.from;
let count = L.count;                       // lists already have count>1
if (L.isHeading && L.mode === "section") count = headingSpan(L.levels, from).count;
cleanup();
if (count > 1) onReorderRange?.(from, count, gapBlock);
else { const to = singleMoveTo(from, gapBlock); if (to !== from) onReorder?.(from, to); }
```

Import `headingSpan` from `@/lib/reorder-range`.

- [ ] **Step 3: tsc gate + commit**

```bash
git add components/workspace/lexical/LexicalDomEditor.tsx components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(reorder): heading toggle (whole section / heading only) + list-as-unit"
```

---

### Phase 2 device QA

- [ ] Lift an **H2 heading** → the "Whole section / Heading only" pill appears, defaulting to Whole section.
- [ ] Whole‑section drop moves the heading **and its body** contiguously to the target.
- [ ] Toggling **Heading only** then dropping moves just the heading line.
- [ ] Lifting a **bulleted list** moves all its items together (no item left behind).
- [ ] Range moves are undoable in one step (or a small consistent number of steps).
- [ ] Reopening the Writer shows the persisted new order.

---

## Phase 3 — Cross‑chapter amber confirm

Goal: dragging a block whose drop gap lands under a **different top‑level heading (chapter)** turns the drop line amber with a "Move into §X?" tag; release confirms.

### Task 9: Chapter derivation + amber line + confirm

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (`ReorderPlugin`)
- Modify: `components/workspace/WorkspaceLexicalView.tsx` (pass chapter titles via `reorderLabels`/a `chapters` prop)

- [ ] **Step 1: Chapter helper in `reorder-range.ts`**

```ts
// lib/reorder-range.ts — append
// Which chapter (level-1 heading block index) governs a given block gap. `levels`
// is blocks[].level. Returns the block index of the enclosing level-1 heading, or
// -1 for content before the first chapter.
export function chapterOfGap(levels: number[], gap: number): number {
  let chapter = -1;
  for (let i = 0; i < gap && i < levels.length; i++) if (levels[i] === 1) chapter = i;
  return chapter;
}
```

Verify with a throwaway script (`chapterOfGap([1,0,0,1,0], 4) === 3`, `chapterOfGap(L,2) === 0`, `chapterOfGap(L,0) === -1`), then `rm` it.

- [ ] **Step 2: In the plugin, detect crossing during drag**

In `onTouchMove`, after `positionLine(m.y)`:

```ts
if (!L.isHeading) { // whole-section lifts skip the confirm (crossing is their purpose)
  const gapIdx = gapFor(m.y, L.gaps);
  const gapBlock = gapToBlock(gapIdx, L.entries);
  const srcChapter = chapterOfGap(L.levels, L.from);
  const dstChapter = chapterOfGap(L.levels, gapBlock);
  const crossing = dstChapter !== srcChapter;
  L.line?.classList.toggle("lx-drop-line-cross", crossing);
  // show/update the "Move into §X?" tag near the line when crossing
  updateCrossTag(crossing, dstChapter);
}
```

`updateCrossTag` creates/updates a small absolutely‑positioned label (reuse `.lx-drag-toggle` styling in amber) whose text is `reorderLabels.moveIntoSection` with the chapter title. Chapter titles come from a `chapters: {index:number,title:string}[]` prop built in `WorkspaceLexicalView` from `blocks` (`level===1` paragraphs → their text). Remove the tag in `cleanup()`.

- [ ] **Step 3: Confirm on release** — the amber state **is** the confirmation (per spec: release is the deliberate act). No modal. Keep the existing drop dispatch; the amber line already told the user. (If device QA shows users want an explicit tap‑to‑confirm, add a one‑tap confirm chip on the tag — deferred unless QA demands it.)

- [ ] **Step 4: Build the `chapters` prop** in `WorkspaceLexicalView`:

```tsx
const chapters = useMemo(
  () => blocks.filter((b) => b.kind === "paragraph" && b.level === 1).map((b) => ({ index: b.index, title: b.text })),
  [blocks],
);
```

Pass `chapters={chapters}` and add `moveIntoSection: t("workspace.reorder.moveInto", { defaultValue: "Move into “{title}”?" })` to `reorderLabels`.

- [ ] **Step 5: tsc gate + commit**

```bash
git add components/workspace/lexical/LexicalDomEditor.tsx components/workspace/WorkspaceLexicalView.tsx lib/reorder-range.ts
git commit -m "feat(reorder): amber cross-chapter drop line + Move-into confirm tag"
```

---

### Phase 3 device QA

- [ ] Dragging a paragraph **within its chapter** keeps the line blue (no tag).
- [ ] Dragging it **into another chapter** turns the line amber + shows "Move into “Results”?".
- [ ] Release in the amber zone moves it into the new chapter; the block re‑homes correctly.
- [ ] A **whole‑section** drag never shows the amber confirm (crossing is expected).
- [ ] Content before the first chapter (front matter) behaves sanely (no crash; `-1` chapter).

---

## Final checklist

- [ ] `npx tsc --noEmit` clean across all changes.
- [ ] i18n: `wholeSection`, `headingOnly`, `moveInto` keys added to `locales/{en,fr,ar}.json` (edit **surgically** — these files have duplicate keys; never `json.load/dump`).
- [ ] No scratch scripts left in the repo (`git status` clean besides intended files).
- [ ] All three phases' device‑QA boxes checked on a real device.

## Out of scope (do not build)

- A dedicated "reorder mode" card overlay (fallback only).
- Changes to the retired native `OutlineReorderable` or any server route/op.
- Multi‑block (non‑section) marquee reorder.
- Persisting real list structure (unchanged; lists still flatten per item on save).
