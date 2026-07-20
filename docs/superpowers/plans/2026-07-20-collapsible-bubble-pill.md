# Collapsible Bubble Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** The floating pill defaults to a small circular bubble (adaptive icon), expands to the full tool row on tap (collapse via a chevron), and spawns beside the selected block while staying draggable.

**Architecture:** `expanded` + `anchorY` added to floating-pill-store; DocBlock reports the selecting tap's `pageY`; BlockContextBar gains an optional collapse chevron; FloatingPill renders bubble-vs-pill, owns tap-expand + beside-block anchoring + width-aware drag/clamp + the morph.

**Tech:** reanimated 4.3.1, gesture-handler 2.31.1. Verify APIs against https://docs.expo.dev/versions/v56.0.0/ per AGENTS.md.

**Spec:** `docs/superpowers/specs/2026-07-20-collapsible-bubble-pill-design.md`

**Verification:** `npx tsc --noEmit` per task (ignore known parallel-session errors in untouched files). Behavior = Task 5 device QA.

**Git:** parallel sessions share this tree. Exact-path `git add`; fresh commits; never `--amend`; some files (DocBlock, thesis-workspace, OutlineReorderable) may carry other sessions' WIP — report anything bundled.

---

### Task 1: store — `expanded` + `anchorY`

**Files:** Modify `stores/floating-pill-store.ts`.

- [ ] **Step 1** — extend the state:

```ts
interface FloatingPillState {
  visible: boolean;
  pos: Pos | null;
  /** Collapsed (bubble) vs expanded (full tool row). Default false = bubble. */
  expanded: boolean;
  /** Screen Y of the selecting tap → where the bubble spawns beside the block.
   *  null until a tap reports one. */
  anchorY: number | null;
  show: () => void;
  hide: () => void;
  setPos: (pos: Pos) => void;
  setExpanded: (expanded: boolean) => void;
  setAnchorY: (y: number) => void;
  reset: () => void;
}

export const useFloatingPillStore = create<FloatingPillState>((set) => ({
  visible: false,
  pos: null,
  expanded: false,
  anchorY: null,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false, expanded: false }),
  setPos: (pos) => set({ pos }),
  setExpanded: (expanded) => set({ expanded }),
  setAnchorY: (y) => set({ anchorY: y }),
  reset: () => set({ visible: false, pos: null, expanded: false, anchorY: null }),
}));
```

(Note: `hide()` also resets `expanded` to false so a re-spawn starts as a bubble.)

- [ ] **Step 2** — `npx tsc --noEmit` clean; commit:
```bash
git add stores/floating-pill-store.ts
git commit -m "feat(workspace): floating-pill store — expanded (bubble/pill) + selection anchorY"
```

---

### Task 2: BlockContextBar — optional collapse chevron

**Files:** Modify `components/workspace/BlockContextBar.tsx`.

PRE-FLIGHT: `git diff components/workspace/BlockContextBar.tsx` empty (last commit touching it 22985c9 or later). If not, NEEDS_CONTEXT.

- [ ] **Step 1** — add the prop to the `Props` interface:

```tsx
  /** When set (floating overlay only), the compact pill shows a leading collapse
   *  chevron that calls this — collapses the pill back to its bubble. The keyboard-
   *  docked bar never passes it. */
  onCollapse?: () => void;
```

Destructure `onCollapse` in the component signature.

- [ ] **Step 2** — import `ChevronsDownUp` (collapse-to-bubble glyph) from lucide-react-native (add to the existing lucide import block). Verify the name exists in the installed lucide-react-native; if not, use `Minimize2`.

- [ ] **Step 3** — render the chevron as the FIRST child of the compact pill's tools, only when `onCollapse` is set and the pill is NOT keyboard-docked and NOT the (+)-expanded card. Locate the compact-pill branch (keyboard-closed, not `pillExpanded`) where `compactTools` + sep + AskAI + OutlineBtn render. Insert BEFORE the tools ScrollView:

```tsx
          {onCollapse
            ? chip({ keyProp: "collapse-bubble", Icon: ChevronsDownUp, accessibilityLabel: t("blockBar.collapse", { defaultValue: "Collapse" }), onPress: onCollapse })
            : null}
```

(Use the existing `chip()` helper so it gets the same AnimatedChip press feedback. Place it so it reads as a leading affordance in both LTR and RTL — since the row is `flexDirection: rtl ? "row-reverse" : "row"`, being the first child puts it at the reading start automatically.)

- [ ] **Step 4** — `npx tsc --noEmit` clean; commit:
```bash
git add components/workspace/BlockContextBar.tsx
git commit -m "feat(workspace): BlockContextBar optional collapse chevron (floating overlay)"
```

---

### Task 3: DocBlock — capture the selecting tap's pageY

**Files:** Modify `components/workspace/DocBlock.tsx`.

PRE-FLIGHT: read the file's CURRENT state (it may carry parallel WIP). Report anything bundled.

Context: single-select taps go through `pickBlock(index, text)` and `enterOrSelect(index, text)` (both module-level, called from `Pressable onPress`). The `Pressable onPress` receives a `GestureResponderEvent` with `nativeEvent.pageY`.

- [ ] **Step 1** — import the store: `import { useFloatingPillStore } from "@/stores/floating-pill-store";`

- [ ] **Step 2** — give the two single-select helpers an optional `pageY` and record it:

```tsx
function pickBlock(index: number, text: string, pageY?: number): void {
  hSelection();
  const ws = useWorkspaceStore.getState();
  if (ws.multiSelect) ws.toggleBlock(index, text);
  else {
    ws.selectBlock(index, text);
    if (pageY != null) useFloatingPillStore.getState().setAnchorY(pageY);
  }
}
```

```tsx
function enterOrSelect(index: number, text: string, pageY?: number): void {
  const ws = useWorkspaceStore.getState();
  if (ws.multiSelect) {
    ws.toggleBlock(index, text);
    return;
  }
  ws.selectBlock(index, text);
  if (pageY != null) useFloatingPillStore.getState().setAnchorY(pageY);
  if (!useChatStore.getState().isGenerating) ws.setEditingBlock(index);
}
```

- [ ] **Step 3** — thread `pageY` from the `onPress` events. Find each `Pressable` whose `onPress` calls `pickBlock` or `enterOrSelect` (image ~line 212, paragraph ~line 326, table ~line 561/600 — verify current lines) and change e.g.:

```tsx
        onPress={(e) => enterOrSelect(block.index, block.text, e.nativeEvent.pageY)}
```
```tsx
        onPress={(e) => pickBlock(block.index, tableToText(block.rows), e.nativeEvent.pageY)}
```

Only the SINGLE-select `onPress` handlers — do NOT touch `onLongPress` (multi-select). If any of these presses are wrapped in a helper like `onSelect`, thread the event through it. Match the ACTUAL current call sites on disk.

- [ ] **Step 4** — `npx tsc --noEmit` clean; commit:
```bash
git add components/workspace/DocBlock.tsx
git commit -m "feat(workspace): DocBlock reports selecting-tap pageY for bubble anchoring"
```

---

### Task 4: FloatingPill — bubble/pill render + expand + beside-block anchor + width-aware drag

**Files:** Modify `components/workspace/FloatingPill.tsx`.

PRE-FLIGHT: `git diff components/workspace/FloatingPill.tsx` empty (last commit 22985c9). If not, NEEDS_CONTEXT.

- [ ] **Step 1 — imports & consts.** Add to the reanimated import: nothing new needed beyond existing (`Animated`, `useAnimatedStyle`, `useSharedValue`, `withSpring`, `withTiming`, `runOnJS`). Add `Pressable` to the react-native import. Add lucide + theme + motion:

```tsx
import { Pressable } from "react-native"; // merge into existing RN import
import { Type, Image as ImageIcon, Table } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { layoutSpring, SPRING, SPRING_ENTER } from "@/lib/motion"; // extend existing motion import
```

Add consts near `PILL_W`:

```tsx
const BUBBLE_SIZE = 52;
```

- [ ] **Step 2 — read new store state:**

```tsx
  const colors = useThemeColors();
  const expanded = useFloatingPillStore((s) => s.expanded);
  const anchorY = useFloatingPillStore((s) => s.anchorY);
```

- [ ] **Step 3 — width-aware current width.** After `selectedBlock`/`count` are computed, add:

```tsx
  // Container width depends on form; drives centering, clamp, and the drag hit-test.
  const curW = expanded ? PILL_W : BUBBLE_SIZE;
```

Replace the fixed `PILL_W` uses in the bounds + hit-test with `curW`:
- `maxX = Math.max(minX, width - curW - 8)`
- in the pan `onUpdate` hit test: `const cx = tx.value + curW / 2;` (keep `cy = ty.value + PILL_H / 2` — height stays ~pill height; for the bubble PILL_H≈56 vs BUBBLE 52, close enough).
- ADD `curW` (and `expanded`) to the `pan` useMemo deps so the memo rebuilds when the form changes: `[width, height, insets.top, insets.bottom, curW]`.

- [ ] **Step 4 — beside-block anchor effect.** After the pan/`pillStyle`, before `suppressed`:

```tsx
  // Spawn/re-anchor beside the selected block: when the selected INDEX changes and
  // we have a tap Y, spring the pill to a screen-side position at that height. A ref
  // guards against re-anchoring on unrelated re-renders (drag, prop churn). Drag
  // overrides until the next selection change; scrolling does not re-anchor.
  const lastAnchoredIndex = React.useRef<number | null>(null);
  const soleIndex = selectedBlock ? selectedBlock.index : count === 1 ? indices[0] ?? null : null;
  useEffect(() => {
    if (soleIndex == null) return;
    if (soleIndex === lastAnchoredIndex.current) return;
    lastAnchoredIndex.current = soleIndex;
    if (anchorY == null) return;
    const w = expanded ? PILL_W : BUBBLE_SIZE;
    const sideX = rtl ? minX : Math.max(minX, width - w - 12);
    const yy = Math.min(Math.max(anchorY - BUBBLE_SIZE / 2, minY), maxY);
    tx.value = withSpring(sideX, SPRING);
    ty.value = withSpring(yy, SPRING);
    useFloatingPillStore.getState().setPos({ x: sideX, y: yy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleIndex, anchorY]);
```

- [ ] **Step 5 — render bubble vs pill.** Replace the return's inner `<Animated.View style={[styles.pill, pillStyle]}>…</Animated.View>` so the container width is dynamic and it renders the bubble when collapsed:

```tsx
      <GestureDetector gesture={pan}>
        <Animated.View layout={layoutSpring} style={[styles.host, { width: curW }, pillStyle]}>
          {expanded ? (
            <BlockContextBar
              thesisId={thesisId}
              rtl={rtl}
              paragraphSelection={paragraphSelection}
              selectedBlock={selectedBlock}
              selectedIndices={indices}
              count={count}
              blockCount={blocks.length}
              keyboardOpen={false}
              scopeLabel={scopeLabel}
              onAskAI={() => useWorkspaceStore.getState().setAskAiOpen(true)}
              onCollapse={() => useFloatingPillStore.getState().setExpanded(false)}
              bottomInset={0}
            />
          ) : (
            <Bubble
              colors={colors}
              kind={selectedBlock?.kind}
              onPress={() => useFloatingPillStore.getState().setExpanded(true)}
            />
          )}
        </Animated.View>
      </GestureDetector>
```

Change `styles.pill` → `styles.host` (drop the fixed `width: PILL_W`; width now comes from the inline `{ width: curW }`):

```tsx
const styles = StyleSheet.create({
  host: { position: "absolute", top: 0, left: 0 },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
});
```

- [ ] **Step 6 — the Bubble component** (module scope, below the FloatingPill function). Springy entrance; adaptive icon:

```tsx
function Bubble({
  colors,
  kind,
  onPress,
}: {
  colors: ReturnType<typeof useThemeColors>;
  kind: DocBlockDTO["kind"] | undefined;
  onPress: () => void;
}) {
  const Icon = kind === "image" ? ImageIcon : kind === "table" ? Table : Type;
  return (
    <Animated.View entering={pillEnterPreset}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Formatting tools"
        style={[styles.bubble, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
      >
        <Icon size={22} color={colors.bgPrimary} strokeWidth={2.2} />
      </Pressable>
    </Animated.View>
  );
}
```

For `pillEnterPreset` use the motion module's `SPRING_ENTER`-based zoom-in. If the motion module doesn't export a ready ZoomIn, use reanimated's `ZoomIn.springify()` imported from "react-native-reanimated" and drop the custom import — simplest:

```tsx
import Animated, { ZoomIn, /* existing */ } from "react-native-reanimated";
// ...
    <Animated.View entering={ZoomIn.springify().damping(30).stiffness(700)}>
```

(Then `SPRING_ENTER` import is optional; keep whichever keeps tsc clean and the code minimal.)

- [ ] **Step 7 — `npx tsc --noEmit` clean; commit:**
```bash
git add components/workspace/FloatingPill.tsx
git commit -m "feat(workspace): FloatingPill bubble⇄pill — tap-expand, adaptive icon, beside-block anchor, collapse chevron"
```

---

### Task 5: Device QA

**Files:** none.

- [ ] Walk (real device, LTR + RTL, Reduce Motion on/off):
  1. Select an image/table block (keyboard stays down) → a **bubble** appears **beside the block** with the adaptive icon (image/table glyph).
  2. Tap the bubble → springy **expand** to the full pill; the leading **collapse chevron** shrinks it back to the bubble.
  3. Select a different block → the bubble/pill **re-anchors beside the new block**; expanded/collapsed state persists.
  4. Drag the bubble and the expanded pill; both clamp on-screen; **drag to the bottom X dismisses** from either state.
  5. Expand near the top/side → the 320px pill re-clamps on-screen (not clipped).
  6. Paragraph tap opens the keyboard (docked bar, no bubble); dismiss keyboard → bubble appears near the block; docked bar shows NO collapse chevron.
  7. count===0 / composer hidden / preview → no bubble (suppression intact).
  8. Reduce Motion → expand/collapse/anchor without spring flourish, still functional.
- [ ] Contingencies: bubble tap not registering (Pan stealing it) → confirm `activeOffsetY`/`failOffsetX` lets the zero-movement tap through; if not, raise the offset or wrap only the icon in the Pressable. Re-anchor feels jumpy on every block → gate the anchor effect to only the FIRST spawn (keep dragged pos after).
- [ ] Final `npx tsc --noEmit` + `git status`; commit any tuning.

---

## Self-review notes
- Spec coverage: expanded/anchorY store → T1; collapse chevron → T2; tap pageY → T3; bubble/pill render + expand + anchor + width-aware clamp + morph → T4; QA → T5.
- Type consistency: `expanded`/`anchorY`/`setExpanded`/`setAnchorY` (T1) used in T3/T4; `onCollapse` (T2) passed in T4; `BUBBLE_SIZE`/`curW` in T4.
- Deferred: re-anchor-only-on-first-spawn vs every-selection is a QA tuning toggle (T5).
