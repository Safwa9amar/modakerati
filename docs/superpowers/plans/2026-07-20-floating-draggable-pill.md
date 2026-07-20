# Floating Draggable Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the workspace pill a persistent, draggable, screen-level floating palette (chat-head style) that closes only by drag-to-X and stays open across block changes.

**Architecture:** New `floating-pill-store` (visible + position). New `FloatingPill` overlay (Pan gesture + absolute Reanimated view + hit-tested `DismissTarget`) mounted once in thesis-workspace, reusing `BlockContextBar` and BlockToolbarPill's selection derivations. Retire the inline per-row pill mount.

**Tech:** react-native-gesture-handler 2.31.1 (`Gesture.Pan`/`GestureDetector`), reanimated 4.3.1, safe-area-context 5.7. Per AGENTS.md, verify APIs against https://docs.expo.dev/versions/v56.0.0/ before writing gesture/animation code.

**Spec:** `docs/superpowers/specs/2026-07-20-floating-draggable-pill-design.md`

**Verification:** no JS test runner — gate every task on `npx tsc --noEmit` (ignore the known parallel-session errors, if any, in files you didn't touch). Behavior = Task 5 device QA.

**Git:** parallel sessions share this tree. `git add` EXACT paths only; fresh commits; never `--amend`; re-check `git status` after interruptions.

---

### Task 1: `floating-pill-store` + reset wiring

**Files:** Create `stores/floating-pill-store.ts`; Modify `app/(app)/thesis-workspace.tsx` (reset block ~line 159).

- [ ] **Step 1: Create the store**

```ts
import { create } from "zustand";

interface Pos {
  x: number;
  y: number;
}

interface FloatingPillState {
  /** Whether the persistent floating pill is on screen at all. Set true on the
   *  first block selection; only set false by a drag-to-X dismiss. */
  visible: boolean;
  /** Last dragged top-left position (screen coords). null → the overlay uses its
   *  computed default spawn spot. Session-scoped (reset on workspace exit). */
  pos: Pos | null;
  show: () => void;
  hide: () => void;
  setPos: (pos: Pos) => void;
  reset: () => void;
}

export const useFloatingPillStore = create<FloatingPillState>((set) => ({
  visible: false,
  pos: null,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false }),
  setPos: (pos) => set({ pos }),
  reset: () => set({ visible: false, pos: null }),
}));
```

- [ ] **Step 2: Reset on workspace exit** — in `app/(app)/thesis-workspace.tsx`, next to `useWorkspaceStore.getState().reset();` (line ~159), add:

```tsx
      useFloatingPillStore.getState().reset();
```

and import it at the top with the other store imports:

```tsx
import { useFloatingPillStore } from "@/stores/floating-pill-store";
```

- [ ] **Step 3: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add stores/floating-pill-store.ts "app/(app)/thesis-workspace.tsx"
git commit -m "feat(workspace): floating-pill store (persistent visible + session position)"
```

---

### Task 2: `DismissTarget` component

**Files:** Create `components/workspace/DismissTarget.tsx`.

The X target shown at bottom-center while dragging. Driven by two shared values the
pill owns (`visible` = drag active, `active` = pill hovering over it). pointerEvents
none — hit-testing is done by the pill's pan math, not by touches on this view.

- [ ] **Step 1: Write it**

```tsx
import React from "react";
import { StyleSheet } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Diameter of the circular dismiss target and the hit radius the pill tests against. */
export const DISMISS_SIZE = 64;
export const DISMISS_HIT_RADIUS = 70;

interface Props {
  /** 0→1 as a drag starts/ends (fade + rise in). */
  visible: SharedValue<number>;
  /** 0→1 when the pill is over the target (grow + tint). */
  active: SharedValue<number>;
  /** Center Y of the target in screen coords (the pill compares against this). */
  centerY: number;
  bottomInset: number;
}

export function DismissTarget({ visible, active, centerY, bottomInset }: Props) {
  const colors = useThemeColors();
  const wrapStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: interpolate(visible.value, [0, 1], [24, 0]) }],
  }));
  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(active.value, [0, 1], [1, 1.25]) }],
    backgroundColor: active.value > 0.5 ? colors.error ?? "#E5484D" : colors.bgCard,
    borderColor: active.value > 0.5 ? colors.error ?? "#E5484D" : colors.borderDefault,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { bottom: bottomInset + 24 }, wrapStyle]}
    >
      <Animated.View style={[styles.circle, circleStyle]}>
        <X size={26} color={colors.textPrimary} strokeWidth={2.4} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  circle: {
    width: DISMISS_SIZE,
    height: DISMISS_SIZE,
    borderRadius: DISMISS_SIZE / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
});
```

Note: `colors.error` may not exist on the theme — the implementer must check
`hooks/useThemeColors` and use whatever the destructive/red token is (e.g.
`textDanger`, `danger`, or fall back to the literal `#E5484D` as written). `centerY`
is accepted for API symmetry; the hit test lives in the pill (Task 3).

- [ ] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → clean (fix the `colors.error` token per the real theme).
```bash
git add components/workspace/DismissTarget.tsx
git commit -m "feat(workspace): DismissTarget — drag-to-close X target for the floating pill"
```

---

### Task 3: `FloatingPill` overlay (drag + dismiss + spawn)

**Files:** Create `components/workspace/FloatingPill.tsx`.

The screen-level overlay: selection derivations (lifted from BlockToolbarPill) →
`BlockContextBar` inside a draggable, absolutely-positioned Reanimated view, plus the
DismissTarget and the drag→X hit test, plus spawn-on-first-select and
dismiss→hide+clearSelection.

- [ ] **Step 1: Write it**

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { Dimensions, Keyboard, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { hSelection } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import type { DocBlockDTO } from "@/lib/api";
import { BlockContextBar } from "./BlockContextBar";
import { DismissTarget, DISMISS_HIT_RADIUS } from "./DismissTarget";

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;

interface Props {
  thesisId: string;
  blocks: DocBlockDTO[];
  rtl: boolean;
}

const PILL_W = 320; // approximate — used only for the initial center + clamp math
const PILL_H = 56;

/**
 * The persistent, draggable, screen-level floating pill. Mounted ONCE by
 * thesis-workspace. Appears on the first block selection, stays open across block
 * changes (retargeting its tools to the current selection), and closes only when
 * dragged onto the bottom-center X (which also clears the selection). Suppressed —
 * but not hidden from the store — while the keyboard is up (the docked bar takes
 * over), while the block Ask-AI input is open, while the AI ask/confirm gate owns
 * the bottom, and while the sole selected paragraph has an active inline suggestion.
 */
export function FloatingPill({ thesisId, blocks, rtl }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get("window");

  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const askAiOpen = useWorkspaceStore((s) => s.askAiOpen);
  const aiGateActive = useChatStore((s) => s.pendingAsk != null || s.pendingConfirm != null);

  const visible = useFloatingPillStore((s) => s.visible);
  const pos = useFloatingPillStore((s) => s.pos);

  // Local keyboard tracking — hide the floating form while the docked bar is up.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardVisible(false));
    const showA = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideA = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); showA.remove(); hideA.remove(); };
  }, []);

  // ── Selection derivations (mirror BlockToolbarPill) ──
  const ordered = useMemo(
    () => [...selectedBlocks].sort((a, b) => a.index - b.index),
    [selectedBlocks],
  );
  const indices = useMemo(() => ordered.map((b) => b.index), [ordered]);
  const count = selectedBlocks.length;
  const paragraphSelection = useMemo(() => {
    if (!ordered.length) return [] as ParagraphBlock[];
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    return ordered
      .map((s) => byIndex.get(s.index))
      .filter((b): b is ParagraphBlock => !!b && b.kind === "paragraph");
  }, [ordered, blocks]);
  const selectedBlock = useMemo<DocBlockDTO | null>(() => {
    if (count !== 1) return null;
    return blocks.find((b) => b.index === ordered[0]?.index) ?? null;
  }, [count, ordered, blocks]);
  const scopeLabel =
    count === 1
      ? (selectedBlocks[0]?.text?.replace(/\s+/g, " ").trim().slice(0, 32) ||
        t("workspace.selectedBlock", { defaultValue: "Selected section" }))
      : t("workspace.nSelected", { count, defaultValue: `${count} selected` });

  // Suggestion suppression: sole selected paragraph currently in review.
  const soleSuggested = useSuggestionStore((s) => {
    if (count !== 1) return false;
    const b = selectedBlock;
    return !!b && b.kind === "paragraph" && s.byIndex[b.index]?.original === b.text;
  });

  // Spawn on the first non-empty selection; never auto-hide (only drag-to-X does).
  useEffect(() => {
    if (count > 0 && !visible) useFloatingPillStore.getState().show();
  }, [count, visible]);

  // ── Drag position ──
  const defaultX = (width - PILL_W) / 2;
  const defaultY = height - insets.bottom - PILL_H - 120;
  const startX = pos?.x ?? defaultX;
  const startY = pos?.y ?? defaultY;

  const tx = useSharedValue(startX);
  const ty = useSharedValue(startY);
  // Re-seed when the store position changes from outside (e.g. reset → default).
  useEffect(() => {
    tx.value = pos?.x ?? defaultX;
    ty.value = pos?.y ?? defaultY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, width, height, insets.bottom]);

  const dragActive = useSharedValue(0); // DismissTarget fade
  const overTarget = useSharedValue(0); // DismissTarget grow
  const startTX = useSharedValue(0);
  const startTY = useSharedValue(0);

  const targetCX = width / 2;
  const targetCY = height - insets.bottom - 24 - 32; // matches DismissTarget bottom+radius

  const minX = 8;
  const maxX = width - PILL_W - 8;
  const minY = insets.top + 8;
  const maxY = height - insets.bottom - PILL_H - 8;

  const dismiss = () => {
    useFloatingPillStore.getState().hide();
    useWorkspaceStore.getState().clearSelection();
  };

  const pan = Gesture.Pan()
    .minDistance(10) // let quick taps reach the chips
    .onStart(() => {
      startTX.value = tx.value;
      startTY.value = ty.value;
      dragActive.value = withTiming(1, { duration: 140 });
    })
    .onUpdate((e) => {
      tx.value = startTX.value + e.translationX;
      ty.value = startTY.value + e.translationY;
      // Hit test: pill center vs target center.
      const cx = tx.value + PILL_W / 2;
      const cy = ty.value + PILL_H / 2;
      const dist = Math.hypot(cx - targetCX, cy - targetCY);
      const over = dist < DISMISS_HIT_RADIUS ? 1 : 0;
      if (over !== overTarget.value) {
        overTarget.value = withTiming(over, { duration: 120 });
        if (over) runOnJS(hSelection)();
      }
    })
    .onEnd(() => {
      dragActive.value = withTiming(0, { duration: 140 });
      if (overTarget.value > 0.5) {
        overTarget.value = 0;
        runOnJS(dismiss)();
        return;
      }
      overTarget.value = 0;
      // Clamp into bounds and persist.
      const clampedX = Math.min(Math.max(tx.value, minX), maxX);
      const clampedY = Math.min(Math.max(ty.value, minY), maxY);
      tx.value = withSpring(clampedX, SPRING);
      ty.value = withSpring(clampedY, SPRING);
      runOnJS(useFloatingPillStore.getState().setPos)({ x: clampedX, y: clampedY });
    });

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  const suppressed = keyboardVisible || askAiOpen || aiGateActive || soleSuggested;
  if (!visible || suppressed) {
    // Still render the target host? No — nothing to show when suppressed.
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <DismissTarget visible={dragActive} active={overTarget} centerY={targetCY} bottomInset={insets.bottom} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.pill, pillStyle]}>
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
            bottomInset={0}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { position: "absolute", top: 0, left: 0, width: PILL_W },
});
```

Implementer notes:
- Verify `useSuggestionStore` shape (`byIndex[index]?.original`) against `stores/suggestion-store.ts` — mirror the exact selector `OutlineReorderable` uses (see its `hasSuggestion`).
- Verify `useChatStore` field names `pendingAsk`/`pendingConfirm` against the store.
- `PILL_W = 320` is a fixed width for the overlay so the drag/clamp/center math is
  deterministic (the inline pill was auto-width). If the compact pill's real content
  is narrower, it will be centered within 320; acceptable. If tsc/log shows the pill
  overflowing on very small screens, reduce to `Math.min(320, width - 16)`.
- Keep every `useFloatingPillStore`/`useWorkspaceStore` selector a PRIMITIVE or the
  stored array ref (never a fresh literal) — zustand v5 Object.is loop.

- [ ] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add components/workspace/FloatingPill.tsx
git commit -m "feat(workspace): FloatingPill — draggable persistent overlay with drag-to-X dismiss"
```

---

### Task 4: Mount the overlay, retire the inline pill

**Files:** Modify `app/(app)/thesis-workspace.tsx`; Modify `components/workspace/OutlineReorderable.tsx`; Delete `components/workspace/BlockToolbarPill.tsx`.

- [ ] **Step 1: Mount FloatingPill in thesis-workspace** — as a sibling AFTER `</KeyboardAvoidingView>` (so it's a true screen overlay), near the milestone host (~line 724). Add:

```tsx
      {/* Persistent floating formatting pill — draggable screen overlay; closes
          only by drag-to-X. Replaces the old inline per-block pill. */}
      {thesisId && (
        <FloatingPill thesisId={thesisId} rtl={docRtl} blocks={liveDoc?.blocks ?? []} />
      )}
```

Import at top:

```tsx
import { FloatingPill } from "@/components/workspace/FloatingPill";
```

(`docRtl` and `liveDoc` are already in scope — used by the existing `BlockComposer` render. Confirm the exact names in the file and match them.)

- [ ] **Step 2: Retire the inline mount in OutlineReorderable** — remove line ~118 `{showPill && <BlockToolbarPill thesisId={thesisId} blocks={blocks} rtl={rtl} />}` and the now-unused `pillEligible`, `aiGateActive`, and `showPill` declarations (lines ~65–87). KEEP `hasSuggestion` (still used by the InlineSuggestion branch). Remove the `import { BlockToolbarPill } from "./BlockToolbarPill";` line. Leave the InlineSuggestion / DocBlock rendering untouched.

Verify after editing that `useChatStore` import is still used elsewhere in the file; if `aiGateActive` was its only use, remove that import too (check with grep).

- [ ] **Step 3: Delete BlockToolbarPill**

```bash
git rm components/workspace/BlockToolbarPill.tsx
```

- [ ] **Step 4: Typecheck & commit**

Run: `npx tsc --noEmit` → clean (no dangling references to BlockToolbarPill or the removed vars).
```bash
git add "app/(app)/thesis-workspace.tsx" components/workspace/OutlineReorderable.tsx
git commit -m "feat(workspace): mount FloatingPill overlay; retire inline BlockToolbarPill"
```

---

### Task 5: Device QA

**Files:** none (verification + tuning commits).

- [ ] **Step 1: Launch the app**, open a thesis workspace.
- [ ] **Step 2: Walk the checklist** (real device, LTR + Arabic RTL, Reduce Motion on/off):
  1. Select a block → floating pill springs in. Tap another block → pill STAYS, tools retarget (para→image→table morph works).
  2. Drag the pill around → it follows the finger, stays where dropped, clamps on-screen (not under header / off bottom).
  3. Chip taps still work (drag threshold): tapping Style/Align/(+)/Ask AI must NOT be swallowed by the drag.
  4. Start dragging → X target fades in at bottom-center; drag over it → it grows + a haptic fires; release over it → pill dismisses and selection clears. Release elsewhere → settles.
  5. After dismiss, tap a block again → pill re-spawns.
  6. Tap a block to type (keyboard up) → docked bar appears (floating pill hidden); dismiss keyboard → floating pill returns at its last position.
  7. Category expansion / (+) full card still open correctly ABOVE/within the floating, dragged position.
  8. Ask AI opens the AI input (pill hides); close it → pill returns.
  9. RTL doc: repeat 1–4.
  10. Reduce Motion on: pill appears/moves without spring flourish, drag + dismiss still fully functional.
- [ ] **Step 3: Contingencies (only if the trigger reproduces)**
  - **Horizontal drag competes with the chip-row scroll** → add a grip handle: a small drag zone on the pill's leading edge that owns the Pan; make the chip ScrollView `simultaneousHandlers` exclude the pan, or gate `pan.activeOffsetY` so only vertical drags start it. Commit as `fix(workspace): grip-handle drag on floating pill (chip-scroll conflict)`.
  - **Category expansion opens off-screen** when the pill is dragged near the top → clamp `maxY` lower or flip the expansion below the pill when near the top edge.
  - **Pill overflows small screens** → `PILL_W = Math.min(320, width - 16)`.
- [ ] **Step 4: Final `npx tsc --noEmit` + `git status`** (only intended files changed).
- [ ] **Step 5: Commit any tuning** with an exact-path `git add`.

---

## Self-review notes

- **Spec coverage:** store → T1; DismissTarget → T2; drag + hit-test + dismiss + spawn + suppression + retarget → T3; mount + retire inline + delete BlockToolbarPill → T4; risks/RTL/Reduce-Motion → T5.
- **Type consistency:** `useFloatingPillStore` (visible/pos/show/hide/setPos/reset), `DISMISS_HIT_RADIUS`, `FloatingPill({thesisId, blocks, rtl})` used consistently across tasks. Selection derivations copied verbatim from BlockToolbarPill so `BlockContextBar` props are unchanged.
- **Known follow-ups deferred:** edge-snap positioning, grip handle (only if QA needs it), remembering position across app launches (currently session-only).
