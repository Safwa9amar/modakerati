# Pill Toolbar Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the workspace block pill toolbar (BlockContextBar) a coherent springy motion language — entrance/exit, category expansion, smart-pill toolset morph, (+)→full-card grow, and press/active/glow micro-interactions.

**Architecture:** One motion-language module (`lib/motion.ts`) exporting spring configs + entering/exiting preset factories; one `AnimatedChip` component replacing the inline `chip()` Pressables; BlockContextBar's keyboard-closed forms restructured into a single `Animated.View` that morphs pill ⇄ full-card via `LinearTransition`. Keyboard-docked bar stays an instant swap BY DESIGN.

**Tech Stack:** react-native-reanimated 4.3.1 (already installed; babel plugin auto-configured by babel-preset-expo — verified against https://docs.expo.dev/versions/v56.0.0/sdk/reanimated/). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-20-pill-toolbar-animations-design.md`

**Verification (no JS test runner in this app — do NOT add jest):** every task gates on `npx tsc --noEmit` (expect: no output, exit 0). Behavior verification is Task 8's on-device checklist.

**Git rules for this repo:** the user runs parallel Claude sessions on this working tree with unrelated WIP. `git add` EXACT paths only (never `-A`/`.`), fresh commits only (never `--amend`), and re-check `git status` after any interruption.

---

### Task 1: Motion language — `lib/motion.ts`

**Files:**
- Create: `lib/motion.ts`

- [ ] **Step 1: Write the module**

```ts
import {
  Easing,
  FadeOut,
  LinearTransition,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { EntryExitAnimationFunction } from "react-native-reanimated";

/** Shared spring — settles ≲ 400ms. Every pill moment speaks this dialect. */
export const SPRING = { damping: 18, stiffness: 250, mass: 1 } as const;
/** Slightly softer spring for larger surfaces (expansion row, glow ring). */
export const SPRING_SOFT = { damping: 16, stiffness: 220, mass: 1 } as const;
export const STAGGER_MS = 40;
/** Cap the stagger tail so long rows (12 chips) don't feel laggy. */
const STAGGER_MAX_MS = 240;
export const PRESS_SCALE = 0.85;

const OUT_TIMING = { duration: 180, easing: Easing.in(Easing.quad) };

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
      opacity: withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }),
      transform: [
        { translateY: withTiming(10, { duration: 150 }) },
        { scale: withTiming(0.92, { duration: 150 }) },
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
export const layoutSpring = LinearTransition.springify().damping(18).stiffness(250);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0. (If `EntryExitAnimationFunction` isn't exported under that name in reanimated 4.3.1, check `node_modules/react-native-reanimated/lib/typescript/layoutReanimation/animationBuilder/commonTypes.d.ts` for the current name — it may be `EntryExitAnimationFunction` under `commonTypes` — and fix the import, not the shape.)

- [ ] **Step 3: Commit**

```bash
git add lib/motion.ts
git commit -m "feat(workspace): motion language for pill toolbar animations (springs, staggers, presets)"
```

---

### Task 2: `AnimatedChip` component

**Files:**
- Create: `components/workspace/AnimatedChip.tsx`

- [ ] **Step 1: Write the component**

Note: no `exiting` on individual chips — on pill exit the container's `pillOut` owns the animation (per-chip exiting would empty the pill mid-drop). Outgoing tool ROWS fade via `chipOut` on their keyed wrapper (Task 6).

```tsx
import React, { memo, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { chipIn, PRESS_SCALE, SPRING } from "@/lib/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  accessibilityLabel: string;
  /** Full visual style (colors/borders/size) — owned by the caller, as before. */
  style?: StyleProp<ViewStyle>;
  /** Position in its row → staggered entrance. null/undefined → no entrance anim. */
  enterIndex?: number | null;
  children: React.ReactNode;
}

/**
 * Springy chip: press-down scale, overshoot pop when it becomes active, and a
 * staggered pop-in entrance (drives the toolset-morph feel). Module-level +
 * memoized so it's a stable component type — same no-remount concern the old
 * element-returning chip() helper solved.
 */
export const AnimatedChip = memo(function AnimatedChip({
  onPress,
  disabled,
  active,
  accessibilityLabel,
  style,
  enterIndex,
  children,
}: Props) {
  const scale = useSharedValue(1);
  const wasActive = useRef(!!active);

  useEffect(() => {
    if (active && !wasActive.current) {
      // Became active → overshoot pop from the pressed size.
      scale.value = PRESS_SCALE;
      scale.value = withSpring(1, SPRING);
    }
    wasActive.current = !!active;
  }, [active, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      entering={enterIndex == null ? undefined : chipIn(enterIndex)}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(PRESS_SCALE, SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING);
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
      style={[style, animStyle]}
    >
      {children}
    </AnimatedPressable>
  );
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/AnimatedChip.tsx
git commit -m "feat(workspace): AnimatedChip — springy press/active/entrance chip"
```

---

### Task 3: Swap `chip()` to AnimatedChip (press + active micro-interactions)

**Files:**
- Modify: `components/workspace/BlockContextBar.tsx` (the `chip()` helper, ~lines 294–322, and imports)

- [ ] **Step 1: Add import**

```tsx
import { AnimatedChip } from "./AnimatedChip";
```

- [ ] **Step 2: Replace the `chip()` helper body**

Replace the existing Pressable-returning `chip()` with (note the new optional `enterIndex` — call sites use it in Task 6):

```tsx
const chip = (opts: {
  keyProp: string;
  Icon: LucideIcon;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  dim?: boolean;
  accessibilityLabel: string;
  enterIndex?: number | null;
}) => {
  const { Icon } = opts;
  return (
    <AnimatedChip
      key={opts.keyProp}
      onPress={opts.onPress}
      disabled={opts.disabled}
      active={opts.active}
      accessibilityLabel={opts.accessibilityLabel}
      enterIndex={opts.enterIndex}
      style={[
        styles.chip,
        { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
        opts.active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
        (opts.disabled || opts.dim) && styles.chipDim,
      ]}
    >
      <Icon size={17} color={opts.active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
    </AnimatedChip>
  );
};
```

`Pressable` stays imported (AskAI / OutlineBtn / option pills still use it until Tasks 4 & 7).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Quick device sanity (if a simulator/device is already running)**

Chips press-scale down/up; tapping Style/Align pops the active fill. No layout change otherwise.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/BlockContextBar.tsx
git commit -m "feat(workspace): pill chips get springy press + active-pop feedback"
```

---

### Task 4: Category expansion row — springy zoom + staggered options

**Files:**
- Modify: `components/workspace/BlockContextBar.tsx` (`renderExpansion()`, ~lines 457–511, and imports)

- [ ] **Step 1: Add imports**

```tsx
import Animated from "react-native-reanimated";
import { rowIn, rowOut } from "@/lib/motion";
```

- [ ] **Step 2: Rewrite `renderExpansion()`**

Options become AnimatedChip (staggered `enterIndex`, press feedback); the row is an `Animated.View` keyed by category so switching Style→Align cross-animates. The `optPill()` style helper stays as-is.

```tsx
const renderExpansion = () => {
  if (!activeCategory) return null;
  let body: React.ReactNode = null;
  if (activeCategory === "style") {
    body = STYLE_LEVELS.map((l, i) => {
      const active = allLevel(l);
      return (
        <AnimatedChip
          key={l}
          enterIndex={i}
          onPress={() => apply({ level: l })}
          disabled={!canFormat}
          active={active}
          accessibilityLabel={l === 0 ? t("composer.edit.normal", { defaultValue: "Normal" }) : `H${l}`}
          style={optPill(active, !canFormat)}
        >
          <Text style={[styles.optText, { color: active ? colors.bgPrimary : colors.textPrimary }]}>
            {l === 0 ? t("composer.edit.normal", { defaultValue: "Normal" }) : `H${l}`}
          </Text>
        </AnimatedChip>
      );
    });
  } else if (activeCategory === "align") {
    body = ALIGN_OPTIONS.map(({ value, Icon }, i) => {
      const active = allAlign(value);
      return (
        <AnimatedChip
          key={value}
          enterIndex={i}
          onPress={() => apply({ alignment: value })}
          disabled={!canFormat}
          active={active}
          accessibilityLabel={value}
          style={optPill(active, !canFormat)}
        >
          <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
        </AnimatedChip>
      );
    });
  } else if (activeCategory === "direction") {
    body = DIRECTION_OPTIONS.map(({ value, Icon }, i) => {
      const active = allDirection(value);
      return (
        <AnimatedChip
          key={value}
          enterIndex={i}
          onPress={() => apply({ direction: value })}
          disabled={!canFormat}
          active={active}
          accessibilityLabel={value}
          style={optPill(active, !canFormat)}
        >
          <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
        </AnimatedChip>
      );
    });
  } else {
    // list / color — Phase 2 (DTO can't carry these yet): dimmed options + caption.
    const items = activeCategory === "list" ? ["•", "1.", "☑"] : ["A", "A", "A"];
    body = (
      <>
        {items.map((label, i) => (
          <AnimatedChip key={i} enterIndex={i} onPress={soon} accessibilityLabel={label} style={optPill(false, true)}>
            <Text style={[styles.optText, { color: colors.textPlaceholder }]}>{label}</Text>
          </AnimatedChip>
        ))}
        <Text style={[styles.soonCaption, { color: colors.textPlaceholder }]}>
          {t("blockBar.soonTitle", { defaultValue: "Coming soon" })}
        </Text>
      </>
    );
  }
  return (
    <Animated.View
      key={"exp-" + activeCategory}
      entering={rowIn}
      exiting={rowOut}
      style={[styles.expansion, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.expansionRow, { flexDirection: rtl ? "row-reverse" : "row" }]}
      >
        {body}
      </ScrollView>
    </Animated.View>
  );
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/BlockContextBar.tsx
git commit -m "feat(workspace): category expansion row bounces open with staggered options"
```

---

### Task 5: Entrance/exit + pill ⇄ full-card morph (restructured return)

**Files:**
- Modify: `components/workspace/BlockContextBar.tsx` (the two return blocks, ~lines 513–572, and `fullCard` style)

- [ ] **Step 1: Add motion imports**

```tsx
import { layoutSpring, pillIn, pillOut, rowIn, rowOut } from "@/lib/motion";
```

- [ ] **Step 2: Replace both return blocks**

Keyboard-open (docked) stays instant BY DESIGN. Keyboard-closed becomes ONE `Animated.View` that stays mounted across the (+) toggle so `layout={layoutSpring}` morphs its size; `entering`/`exiting` handle block select/deselect. Visual unification: the expansion row now floats ABOVE the card in the expanded-inline form too (it used to render inside the card).

```tsx
// ── Layout: floating pill (morphs to full card) vs full-width docked bar ──
if (keyboardOpen) {
  // Docked on the keyboard: instant swap BY DESIGN — animating it fights the OS
  // keyboard animation and timing differs iOS vs Android (see animations spec).
  return (
    <View
      style={[
        styles.fullWrap,
        { backgroundColor: colors.bgPrimary, borderTopColor: colors.borderSubtle, paddingBottom: 6 },
      ]}
    >
      {renderExpansion()}
      <View style={[styles.fullRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={[styles.fullTools, { flexDirection: rtl ? "row-reverse" : "row" }]}
          style={styles.fullScroll}
        >
          {expandedTools}
        </ScrollView>
        {AskAI}
        {OutlineBtn}
      </View>
      {saving ? <View style={[styles.savingDot, { backgroundColor: colors.brandPrimary }]} /> : null}
      {cropModal}
    </View>
  );
}

return (
  <View style={styles.pillWrap} pointerEvents="box-none">
    {renderExpansion()}
    <Animated.View
      entering={pillIn}
      exiting={pillOut}
      layout={layoutSpring}
      style={
        pillExpanded
          ? [styles.fullCard, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]
          : [
              styles.pill,
              {
                backgroundColor: colors.bgPrimary,
                borderColor: colors.borderSubtle,
                flexDirection: rtl ? "row-reverse" : "row",
              },
            ]
      }
    >
      {pillExpanded ? (
        <View style={[styles.fullRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={[styles.fullTools, { flexDirection: rtl ? "row-reverse" : "row" }]}
            style={styles.fullScroll}
          >
            {expandedTools}
            {/* Collapse back to the compact pill. */}
            {chip({ keyProp: "collapse", Icon: X, accessibilityLabel: t("common.close", { defaultValue: "Close" }), onPress: () => setPillExpanded(false) })}
          </ScrollView>
          {AskAI}
          {OutlineBtn}
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            style={styles.pillScroll}
            contentContainerStyle={[styles.pillToolsRow, { flexDirection: rtl ? "row-reverse" : "row" }]}
          >
            {compactTools}
          </ScrollView>
          <View style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />
          {AskAI}
          {OutlineBtn}
        </>
      )}
      {pillExpanded && saving ? (
        <View style={[styles.savingDot, { backgroundColor: colors.brandPrimary }]} />
      ) : null}
    </Animated.View>
    {cropModal}
  </View>
);
```

- [ ] **Step 3: Update the `fullCard` style**

It now lives inside `pillWrap` (which already pads horizontally 8) and must stretch — replace the existing `fullCard` entry:

```tsx
// Expanded pill inline (keyboard closed) — the morph target of the compact pill.
fullCard: {
  alignSelf: "stretch",
  marginTop: 2,
  paddingHorizontal: 10,
  paddingTop: 8,
  paddingBottom: 8,
  borderRadius: 18,
  borderWidth: StyleSheet.hairlineWidth,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.12,
  shadowRadius: 12,
  elevation: 8,
},
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/BlockContextBar.tsx
git commit -m "feat(workspace): pill springs in/out on select; (+) morphs pill to full card"
```

---

### Task 6: Smart-pill toolset morph (paragraph ↔ image ↔ table)

**Files:**
- Modify: `components/workspace/BlockContextBar.tsx` (toolset resolution ~line 402, tool-row JSX inside both keyboard-closed branches from Task 5, tool builders ~lines 336–400)

- [ ] **Step 1: Derive a toolset key**

Right after `const isTable = selectedBlock?.kind === "table";` add:

```tsx
// Keyed remount of the tool row per block kind → old chips fade out (chipOut on
// the row), new chips stagger in (per-chip chipIn) = the smart-pill morph.
const toolsetKind = isImage ? "image" : isTable ? "table" : "para";
```

Add `chipOut` to the motion import:

```tsx
import { chipOut, layoutSpring, pillIn, pillOut, rowIn, rowOut } from "@/lib/motion";
```

- [ ] **Step 2: Give chips their stagger positions**

`categoryChip` gains an `enterIndex` param:

```tsx
const categoryChip = (c: Category, Icon: LucideIcon, label: string, enterIndex?: number) =>
  chip({
    keyProp: "cat-" + c,
    Icon,
    accessibilityLabel: label,
    enterIndex,
    active: activeCategory === c,
    disabled: (c === "style" || c === "align" || c === "direction") && !canFormat,
    onPress: () => toggleCategory(c),
  });
```

`imageMoveDeleteChips` becomes a function of the starting index:

```tsx
const imageMoveDeleteChips = (base: number) => [
  chip({ keyProp: "img-up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, enterIndex: base, onPress: () => move("up") }),
  chip({ keyProp: "img-down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, enterIndex: base + 1, onPress: () => move("down") }),
  chip({ keyProp: "img-del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), enterIndex: base + 2, onPress: del }),
];
```

Then thread sequential `enterIndex` values through every toolset (full code — these replace the existing consts):

```tsx
const fullTools = (
  <>
    {chip({ keyProp: "bold", Icon: Bold, accessibilityLabel: "Bold", dim: true, enterIndex: 0, onPress: soon })}
    {chip({ keyProp: "italic", Icon: Italic, accessibilityLabel: "Italic", dim: true, enterIndex: 1, onPress: soon })}
    {sep("s1")}
    {categoryChip("style", Type, t("blockBar.style", { defaultValue: "Style" }), 2)}
    {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }), 3)}
    {categoryChip("direction", PilcrowLeft, t("blockBar.direction", { defaultValue: "Direction" }), 4)}
    {categoryChip("list", List, t("blockBar.list", { defaultValue: "List" }), 5)}
    {categoryChip("color", Palette, t("blockBar.color", { defaultValue: "Color" }), 6)}
    {sep("s2")}
    {single
      ? [
          chip({ keyProp: "up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, enterIndex: 7, onPress: () => move("up") }),
          chip({ keyProp: "down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, enterIndex: 8, onPress: () => move("down") }),
          chip({ keyProp: "img", Icon: ImagePlus, accessibilityLabel: t("blockBar.image", { defaultValue: "Insert image" }), enterIndex: 9, onPress: () => void pickImage() }),
        ]
      : null}
    {chip({ keyProp: "clear", Icon: Eraser, accessibilityLabel: t("blockBar.clear", { defaultValue: "Clear formatting" }), disabled: !canFormat, enterIndex: 10, onPress: () => apply({ clearFormatting: true }) })}
    {chip({ keyProp: "del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), enterIndex: 11, onPress: del })}
  </>
);

const pillTools = (
  <>
    {categoryChip("style", Type, t("blockBar.style", { defaultValue: "Style" }), 0)}
    {categoryChip("align", AlignLeft, t("blockBar.align", { defaultValue: "Align" }), 1)}
    {categoryChip("direction", PilcrowLeft, t("blockBar.direction", { defaultValue: "Direction" }), 2)}
    {chip({ keyProp: "p-more", Icon: Plus, accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }), enterIndex: 3, onPress: () => setPillExpanded(true) })}
  </>
);

const imagePillTools = (
  <>
    {chip({ keyProp: "img-replace", Icon: RefreshCw, accessibilityLabel: t("blockBar.replaceImage", { defaultValue: "Replace image" }), enterIndex: 0, onPress: () => void replaceImage() })}
    {imageMoveDeleteChips(1)}
    {chip({ keyProp: "img-more", Icon: Plus, accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }), enterIndex: 4, onPress: () => setPillExpanded(true) })}
  </>
);

const imageFullTools = (
  <>
    {chip({ keyProp: "img-replace", Icon: RefreshCw, accessibilityLabel: t("blockBar.replaceImage", { defaultValue: "Replace image" }), enterIndex: 0, onPress: () => void replaceImage() })}
    {imageMoveDeleteChips(1)}
    {sep("is1")}
    {chip({ keyProp: "img-rotate", Icon: RotateCw, accessibilityLabel: t("blockBar.rotate", { defaultValue: "Rotate" }), disabled: busy, enterIndex: 4, onPress: () => void rotateFlip("rotateRight") })}
    {chip({ keyProp: "img-flip", Icon: FlipHorizontal2, accessibilityLabel: t("blockBar.flip", { defaultValue: "Flip" }), disabled: busy, enterIndex: 5, onPress: () => void rotateFlip("flipH") })}
    {chip({ keyProp: "img-crop", Icon: Crop, accessibilityLabel: t("blockBar.crop", { defaultValue: "Crop" }), disabled: busy, enterIndex: 6, onPress: () => { if (soleIndex != null) setCropIndex(soleIndex); } })}
    {chip({ keyProp: "img-bg", Icon: WandSparkles, accessibilityLabel: t("blockBar.removeBg", { defaultValue: "Remove background" }), disabled: busy, enterIndex: 7, onPress: () => void removeBg() })}
  </>
);

const tableTools = <>{imageMoveDeleteChips(0)}</>;
```

- [ ] **Step 3: Key the tool rows**

In the Task-5 keyboard-closed return, wrap each tool row in a keyed fading `Animated.View` (Reanimated renders exiting views out of layout flow, so old/new rows crossfade in place):

Compact branch — replace the `<ScrollView …>{compactTools}</ScrollView>` with:

```tsx
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  keyboardShouldPersistTaps="always"
  style={styles.pillScroll}
>
  <Animated.View
    key={"tools-" + toolsetKind}
    exiting={chipOut}
    style={[styles.pillToolsRow, { flexDirection: rtl ? "row-reverse" : "row" }]}
  >
    {compactTools}
  </Animated.View>
</ScrollView>
```

Expanded branch — replace the `<ScrollView …>{expandedTools}{collapse chip}</ScrollView>` with:

```tsx
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  keyboardShouldPersistTaps="always"
  style={styles.fullScroll}
>
  <Animated.View
    key={"full-" + toolsetKind}
    exiting={chipOut}
    style={[styles.fullTools, { flexDirection: rtl ? "row-reverse" : "row" }]}
  >
    {expandedTools}
    {chip({ keyProp: "collapse", Icon: X, accessibilityLabel: t("common.close", { defaultValue: "Close" }), onPress: () => setPillExpanded(false) })}
  </Animated.View>
</ScrollView>
```

(The `contentContainerStyle` flex styles move onto the inner Animated.View.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/BlockContextBar.tsx
git commit -m "feat(workspace): smart-pill toolset morph — chips crossfade + restagger by block kind"
```

---

### Task 7: ✦ Ask AI glow pulse + pulsing saving dot

**Files:**
- Modify: `components/workspace/BlockContextBar.tsx` (module scope, the `AskAI` element, both `savingDot` renders, imports)

- [ ] **Step 1: Add imports**

```tsx
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SPRING_SOFT } from "@/lib/motion";
```

(Merge with the existing `Animated` import from earlier tasks.)

- [ ] **Step 2: Add module-level components** (below the `alignFromDoc` helper, module scope — NOT inside BlockContextBar)

```tsx
/** One-shot ring pulse behind ✦ Ask AI when the selection changes — deliberately
 *  not an infinite loop (battery). `trigger` = the selection identity string. */
function AskAIGlow({ trigger, color }: { trigger: string; color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.value = 1;
    opacity.value = 0.5;
    scale.value = withSpring(1.5, SPRING_SOFT);
    opacity.value = withTiming(0, { duration: 500 });
  }, [trigger, scale, opacity]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius: CHIP / 2, backgroundColor: color }, style]}
    />
  );
}

/** Saving-in-flight dot: gentle repeat pulse; the loop dies with the unmount. */
function PulsingDot({ color }: { color: string }) {
  const v = useSharedValue(0.4);
  useEffect(() => {
    v.value = withRepeat(
      withSequence(withTiming(1, { duration: 600 }), withTiming(0.4, { duration: 600 })),
      -1,
      false,
    );
  }, [v]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.7 + v.value * 0.5 }],
  }));
  return <Animated.View style={[styles.savingDot, { backgroundColor: color }, style]} />;
}
```

Note: `CHIP` (=40) is declared below the component — move `const CHIP = 40;` above these components. Add `useEffect` to the React import.

- [ ] **Step 3: Wire them in**

`AskAI` element — insert the glow as the first child (the Pressable already has a fixed size + borderRadius; ring scales past its bounds, overflow is visible by default):

```tsx
const AskAI = (
  <Pressable
    onPress={onAskAI}
    accessibilityRole="button"
    accessibilityLabel={t("blockBar.askAi", { defaultValue: "Ask AI" })}
    style={[styles.askBtn, { backgroundColor: colors.brandPrimary }]}
  >
    <AskAIGlow trigger={selectedIndices.join(",")} color={colors.brandPrimary} />
    <Sparkles size={18} color={colors.bgPrimary} strokeWidth={2.2} />
  </Pressable>
);
```

Replace BOTH saving-dot renders (docked branch and expanded-card branch) with:

```tsx
{saving ? <PulsingDot color={colors.brandPrimary} /> : null}
```

(and in the expanded-card branch: `{pillExpanded && saving ? <PulsingDot color={colors.brandPrimary} /> : null}`)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/BlockContextBar.tsx
git commit -m "feat(workspace): Ask AI one-shot glow pulse + pulsing saving dot"
```

---

### Task 8: On-device verification (the real gate — no test runner exists)

**Files:** none (verification + possible tuning commits)

- [ ] **Step 1: Launch the app** (dev build on device/simulator, open a thesis workspace)

- [ ] **Step 2: Walk the checklist**

1. Select a paragraph block → pill springs up, chips stagger-pop. Deselect → quick drop-fade.
2. Tap Style → row bounces out, Normal/H1/H2/H3 stagger in; tapped chip pops to active fill. Tap Align while Style is open → old row fades, new row bounces.
3. Select an image block → tools crossfade to replace/move/delete with restagger; table block → minimal set; back to paragraph → text tools return.
4. Tap (+) → pill morphs into the full card with a spring, extra chips stagger in; X → morphs back. **This is the LinearTransition risk spot** (New Arch + nested gesture-handler ScrollView).
5. Chip press feedback everywhere (including expansion options); Ask AI ring pulses once per selection change; saving dot pulses during a burst of edits.
6. Open the keyboard (composer) → docked bar swap is instant; confirm the compact pill's exit animation isn't visibly doubling behind the rising keyboard.
7. RTL thesis (Arabic): repeat 1–4; confirm stagger direction feels right.
8. iOS Settings → Accessibility → Motion → Reduce Motion ON → reopen workspace: entering/exiting/layout animations are skipped (Reanimated handles this automatically), everything still functional.

- [ ] **Step 3: Apply contingencies ONLY if their trigger reproduces**

- **(+) morph glitches** (jumps, misplaced chips, flicker): remove `layout={layoutSpring}` from the container `Animated.View` in Task 5 — the keyed inner rows' entering/exiting still animate the swap discretely. Commit as `fix(workspace): drop layout morph on pill expand (New Arch glitch), keep discrete anims`.
- **Keyboard swap double-animation visible**: wrap the keyboard-closed return's `<Animated.View>` in `<LayoutAnimationConfig skipExiting>` imported from react-native-reanimated when `keyboardOpen` was just toggled is NOT practical — instead simply remove `exiting={pillOut}` and accept instant disappearance, or accept the artifact if invisible behind the keyboard. Judge on device.
- **RTL stagger feels backwards**: in `chip()`, compute `enterIndex: rtl && opts.enterIndex != null ? maxIndex - opts.enterIndex : opts.enterIndex` — requires threading the row length; only do this if it actually looks wrong.

- [ ] **Step 4: Final typecheck + status**

Run: `npx tsc --noEmit` → no output. `git status` → only intended files changed (remember: parallel sessions share this tree).

- [ ] **Step 5: Commit any tuning**

```bash
git add components/workspace/BlockContextBar.tsx lib/motion.ts
git commit -m "polish(workspace): tune pill animation springs after device QA"
```

---

## Self-review notes

- **Spec coverage:** motion language → Task 1; AnimatedChip → Tasks 2–3; entrance/exit → Task 5; toolset morph → Task 6; category expansion → Task 4; (+)→full card → Task 5 (+6 for row keying); micro-interactions → Tasks 3 & 7; keyboard-dock exclusion → Task 5 comment; risks/fallbacks + Reduce Motion + RTL → Task 8.
- **Known intentional deviations:** expansion row now floats above the expanded card (visual unification, noted in Task 5); saving dot appears in the expanded card only when `pillExpanded && saving`.
- **Type consistency:** `chipIn(i)`, `chipOut`, `rowIn/rowOut`, `pillIn/pillOut`, `layoutSpring`, `SPRING`, `SPRING_SOFT`, `PRESS_SCALE` are defined once in Task 1 and referenced with those exact names throughout; `AnimatedChip` props defined in Task 2 match all call sites in Tasks 3–6.
