# AI Bubble Peek/Preview (Messenger-style) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the collapsed ✦ workspace AI bubble (`FloatingPill`/`AIDock`) a Messenger "chat-heads" style peek card, so a plain chat ask that auto-collapses the dock still shows the user it's thinking, then streams a live preview, then leaves a persistent unread card until they open it — instead of the reply silently vanishing into chat history.

**Architecture:** One new boolean, `awaitingReply`, on `floating-pill-store.ts`, set by `AIDock`'s plain-chat send path. A new presentational `PeekCard` renders above the collapsed bubble whenever that flag is true, deriving its live/final content straight from the existing `useChatStore` (`generatingPhase`, `streamingId`, `messages`) — no duplicated message state. Tapping the card (or the bubble, while unread) opens the same full-thread panel `ChatHead.tsx` already defines, reusing `ThesisChat` + the `useChatHead` store's `open()`/`expanded`/`close()` (extracted into a small shared `ChatOverlayPanel` so `ChatHead.tsx`'s own — currently disabled — copy doesn't drift). `ChatHead.tsx`'s draggable bubble and the Android system-overlay module stay disabled exactly as today.

**Tech Stack:** Expo v56, React Native New Arch, Zustand, Reanimated 3, i18next (en/fr/ar), TypeScript.

**Spec:** [`docs/superpowers/specs/2026-07-26-ai-bubble-peek-preview-design.md`](../specs/2026-07-26-ai-bubble-peek-preview-design.md)

---

## ⚠️ Verification model for this repo (read first)

**This app has NO JS test runner** (no jest/vitest; confirmed project convention). Do **not** add one or write `.test.ts` files. The per-task gate is:

1. `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit` → **must be clean** (0 errors).
2. The stated **on-device/simulator check** at the end of the relevant task.

**Git (parallel-session safe):** the user runs concurrent sessions and has uncommitted WIP in `app/(tabs)/index.tsx`, `app/(tabs)/thesis.tsx`, `components/BackButton.tsx`, and **`components/workspace/FloatingPill.tsx`** (a chrome/header-footer feature, mid-flight). Before Task 5 (which edits `FloatingPill.tsx`), run `git status` and `git diff -- components/workspace/FloatingPill.tsx` to see the file's *current* state — the exact line numbers in this plan were captured against that file's content as of 2026-07-26 and may have drifted if the other session committed or changed it further. Use the surrounding-code anchors in each step (not raw line numbers) to place edits with the Edit tool. Every commit step below `git add`s **exact paths only** — never `-A`/`.`. Use fresh commits, never `--amend`.

**No locale additions.** `AIDock.tsx`'s existing sibling strings in this same `aiDock.*` namespace (`summarize`, `improve`, `format`, `translate`, `ask`, `askPlaceholder`, `suggested`, `theseSections`, `thisSection`) have **no fr/ar entries in `locales/*.json`** — they all run on the i18next `defaultValue` fallback today. The new `aiDock.peek.*` strings follow that exact, already-established precedent: `t(key, { defaultValue: "..." })` only, no JSON edits, no new inconsistency introduced.

---

## File Structure

**Create:**
- `components/ChatOverlayPanel.tsx` — the dim backdrop + zoom-in `ThesisChat` panel, extracted verbatim from `ChatHead.tsx` so both the (disabled) chat-head bubble and the workspace peek-reveal share one implementation. Driven entirely by the existing `useChatHead` store.
- `components/workspace/PeekCard.tsx` — the Messenger-style tail-bubble card: thinking pulse → live streaming snippet → persistent "done/unread" card. Pure presentational component, no store access of its own.

**Modify:**
- `stores/floating-pill-store.ts` — add `awaitingReply: boolean` + `setAwaitingReply`; cleared by `hide()`/`reset()`.
- `components/workspace/AIDock.tsx` — `sendPrompt`'s plain-chat branch sets `awaitingReply` right where it already collapses the dock.
- `components/workspace/FloatingPill.tsx` — render `PeekCard` beside the collapsed bubble, mount `ChatOverlayPanel`, add the tap-to-reveal action, and restructure the early-return so an open chat-overlay panel is never yanked out from under the user by an unrelated suppression flag flipping.
- `components/ChatHead.tsx` — swap its inline expanded-panel JSX for `<ChatOverlayPanel />`; drop the now-unused imports/styles that moved with it. No behavior change (still unmounted at the root).

---

## Task 1: Extract `ChatOverlayPanel` from `ChatHead.tsx`

Pure refactor first, before anything depends on it — isolates risk and gives Task 5 a component that already compiles and already matches `ChatHead.tsx`'s proven visual output.

**Files:**
- Create: `components/ChatOverlayPanel.tsx`
- Modify: `components/ChatHead.tsx`

- [ ] **Step 1: Create `components/ChatOverlayPanel.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useChatHead } from "@/stores/chat-head-store";
import { ThesisChat } from "@/app/(tabs)/chat";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  thesisId: string;
  thesisTitle: string;
}

/**
 * The dim backdrop + near-fullscreen chat panel shared by every entry point
 * that reveals the full thesis-chat thread. Visibility is driven entirely by
 * the `useChatHead` store (`expanded`/`close`), so any caller can open it via
 * `useChatHead.getState().open()` without owning any panel state itself —
 * the (currently disabled) chat-head bubble and the workspace ✦ bubble's
 * peek-reveal both render this same component.
 */
export function ChatOverlayPanel({ thesisId, thesisTitle }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const expanded = useChatHead((s) => s.expanded);
  const close = useChatHead((s) => s.close);

  if (!expanded) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <AnimatedPressable
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(160)}
        onPress={close}
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("common.close", { defaultValue: "Close" })}
      />
      <Animated.View
        entering={ZoomIn.duration(220)}
        exiting={ZoomOut.duration(180)}
        style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderDefault }]}
      >
        <ThesisChat thesisId={thesisId} thesisTitle={thesisTitle} variant="overlay" onClose={close} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  panel: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
```

- [ ] **Step 2: Verify it compiles standalone.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean (this file isn't imported anywhere yet, but it must type-check on its own).

- [ ] **Step 3: Replace the inline panel in `ChatHead.tsx` with the extracted component.**

Open `components/ChatHead.tsx`. Replace the import block at the top:

```tsx
import { useCallback, useEffect } from "react";
import { Alert, BackHandler, Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSegments } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { useChatHead } from "@/stores/chat-head-store";
import ModakeratiBubble from "@/modules/modakerati-bubble";
import { ThesisChat } from "@/app/(tabs)/chat";
```

with:

```tsx
import { useCallback, useEffect } from "react";
import { Alert, BackHandler, Image, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSegments } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { useChatHead } from "@/stores/chat-head-store";
import ModakeratiBubble from "@/modules/modakerati-bubble";
import { ChatOverlayPanel } from "./ChatOverlayPanel";
```

(`Pressable`, `ZoomIn`, `ZoomOut`, and the `ThesisChat` import move to `ChatOverlayPanel.tsx`; everything else is still used further down in this file — `Alert`/`BackHandler`/`Image`/`Platform` by the system-bubble logic, `FadeIn`/`FadeOut` by the collapsed bubble's `activeDot`.)

- [ ] **Step 4: Remove the now-unused `AnimatedPressable` const.** Delete this line (it sat right above the component function):

```tsx
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
```

- [ ] **Step 5: Swap the inline expanded-panel JSX for the extracted component.** Find the return statement's expanded block:

```tsx
      {/* Expanded: dim backdrop + near-fullscreen chat panel, zooming open. */}
      {expanded && (
        <View style={StyleSheet.absoluteFill}>
          <AnimatedPressable
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(160)}
            onPress={close}
            style={styles.backdrop}
            accessibilityRole="button"
            accessibilityLabel={t("common.close", { defaultValue: "Close" })}
          />
          <Animated.View
            entering={ZoomIn.duration(220)}
            exiting={ZoomOut.duration(180)}
            style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderDefault }]}
          >
            <ThesisChat thesisId={thesisId} thesisTitle={thesisTitle} variant="overlay" onClose={close} />
          </Animated.View>
        </View>
      )}
```

Replace it with:

```tsx
      <ChatOverlayPanel thesisId={thesisId} thesisTitle={thesisTitle} />
```

- [ ] **Step 6: Remove the now-unused `backdrop`/`panel` style keys** from the `StyleSheet.create` at the bottom of `ChatHead.tsx` (keep `bubble`, `bubbleLogo`, `activeDot` — those still back the collapsed bubble):

```tsx
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  panel: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
```

Delete both entries (and the trailing comma left dangling on the previous key, if any — check the result is valid JS).

- [ ] **Step 7: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean. `ChatHead.tsx` is still unmounted at the root (`app/_layout.tsx` keeps it commented out) — this step is a behavior-preserving refactor, verified by type-checking + code review, not a live run.

- [ ] **Step 8: Commit.**

```bash
git add components/ChatOverlayPanel.tsx components/ChatHead.tsx
git commit -m "$(cat <<'EOF'
refactor: extract ChatOverlayPanel from ChatHead

Pulls the backdrop+ThesisChat panel out of ChatHead.tsx into its own
component so the workspace bubble's upcoming peek-reveal can open the
same full-thread panel without duplicating it. No behavior change —
ChatHead stays unmounted at the root.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `awaitingReply` to `floating-pill-store.ts`

**Files:**
- Modify: `stores/floating-pill-store.ts`

- [ ] **Step 1: Replace the whole file** (it's short — 47 lines — easier to replace than patch):

```ts
import { create } from "zustand";

interface Pos {
  x: number;
  y: number;
}

interface FloatingPillState {
  /** Whether the persistent floating pill is on screen at all. Set true on the
   *  first block selection; only set false by a drag-to-X dismiss of the GLOBAL
   *  ✦ bubble (a block bubble's dismiss just reverts it to the global bubble). */
  visible: boolean;
  /** Last dragged top-left position (screen coords). null → the overlay uses its
   *  computed default spawn spot. Session-scoped (reset on workspace exit). */
  pos: Pos | null;
  /** Collapsed (bubble) vs expanded (full tool row). Default false = bubble. */
  expanded: boolean;
  /** Screen Y of the selecting tap → where the bubble spawns beside the block.
   *  null until a tap reports one. */
  anchorY: number | null;
  /** The dock's inline Ask input (on-demand variant). Opened by the Ask… chip
   *  or the pill's ✦; closed on send/hide/reset. */
  inputOpen: boolean;
  /** True from the moment AIDock fires a plain chat-loop ask until the user
   *  opens the Messenger-style peek reveal to read the reply. Drives the
   *  PeekCard on the collapsed bubble; see FloatingPill.tsx. */
  awaitingReply: boolean;
  show: () => void;
  hide: () => void;
  setPos: (pos: Pos) => void;
  setExpanded: (expanded: boolean) => void;
  setAnchorY: (y: number) => void;
  setInputOpen: (v: boolean) => void;
  setAwaitingReply: (v: boolean) => void;
  reset: () => void;
}

export const useFloatingPillStore = create<FloatingPillState>((set) => ({
  visible: false,
  pos: null,
  expanded: false,
  anchorY: null,
  inputOpen: false,
  awaitingReply: false,
  show: () => set({ visible: true }),
  hide: () => set({ visible: false, expanded: false, inputOpen: false, awaitingReply: false }),
  setPos: (pos) => set({ pos }),
  setExpanded: (expanded) => set({ expanded }),
  setAnchorY: (y) => set({ anchorY: y }),
  setInputOpen: (v) => set({ inputOpen: v }),
  setAwaitingReply: (v) => set({ awaitingReply: v }),
  reset: () => set({ visible: false, pos: null, expanded: false, anchorY: null, inputOpen: false, awaitingReply: false }),
}));
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean. Nothing reads `awaitingReply` yet, so no other file changes.

- [ ] **Step 3: Commit.**

```bash
git add stores/floating-pill-store.ts
git commit -m "$(cat <<'EOF'
feat(workspace): add awaitingReply to floating-pill-store

New flag the AI bubble's peek-preview will key off — set when a plain
chat ask fires, cleared when the user opens the reveal panel. Not
consumed anywhere yet; wired up in the next tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Set `awaitingReply` from `AIDock.sendPrompt`

**Files:**
- Modify: `components/workspace/AIDock.tsx:270-278`

- [ ] **Step 1: Add the flag set to the plain chat-loop branch.** This is the *last* branch in `sendPrompt` — the one that isn't a single paragraph/image, a sole table, or a multi-block range rewrite (those three already have their own in-place review UI and must NOT get a peek card). Find:

```tsx
    void sendMessageToAI(thesisId, prompt, {
      docBlockIndex: scopeIndices.length ? scopeIndices[0] : null,
      docBlockIndices: scopeIndices.length > 1 ? scopeIndices : undefined,
      // Ground the ask on the selected text (server previews it to the model);
      // only for a block scope — whole-memoir asks carry no selection.
      selection: scopeIndices.length ? scopeText || undefined : undefined,
    });
    pill.setExpanded(false);
  };
```

Replace with:

```tsx
    void sendMessageToAI(thesisId, prompt, {
      docBlockIndex: scopeIndices.length ? scopeIndices[0] : null,
      docBlockIndices: scopeIndices.length > 1 ? scopeIndices : undefined,
      // Ground the ask on the selected text (server previews it to the model);
      // only for a block scope — whole-memoir asks carry no selection.
      selection: scopeIndices.length ? scopeText || undefined : undefined,
    });
    pill.setExpanded(false);
    // Only this plain chat-loop branch gets the Messenger-style peek card —
    // the paragraph/image/table/range branches above already show their own
    // in-place review UI and return before reaching here.
    pill.setAwaitingReply(true);
  };
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add components/workspace/AIDock.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): mark a plain chat ask as awaiting-reply

AIDock's plain sendMessageToAI branch now flips awaitingReply on send,
right alongside the existing dock-collapse. No visible effect until
FloatingPill reads the flag (next task) — the dock already collapsed
here before this change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `PeekCard.tsx`

**Files:**
- Create: `components/workspace/PeekCard.tsx`

- [ ] **Step 1: Write the component.**

```tsx
import { useEffect } from "react";
import { I18nManager, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

export type PeekPhase = "thinking" | "writing" | "done";

// Must clear FloatingPill's BUBBLE_SIZE (52) + a small gap. Duplicated as a
// literal (not imported) to avoid a circular import between the two files —
// FloatingPill imports PeekCard, so PeekCard can't import back from it.
const BUBBLE_CLEARANCE = 62;

interface Props {
  /** true → anchor the card's physical-LEFT edge to the bubble (grows
   *  rightward); false → anchor the physical-RIGHT edge (grows leftward).
   *  Picked by the caller from the bubble's last settled position — this
   *  component only renders the resolved side, RTL-compensated below. */
  anchorLeft: boolean;
  phase: PeekPhase;
  /** Plain-text snippet to preview (already the raw message content — this
   *  component trims/truncates it for display). Empty string while there's
   *  no content yet (e.g. still in the "thinking" phase). */
  snippet: string;
  onPress: () => void;
}

/**
 * The Messenger "chat-heads" style tail-bubble card anchored above the
 * collapsed ✦ AI bubble. Purely presentational — FloatingPill derives `phase`
 * and `snippet` from the shared chat store and owns all screen-position math;
 * this component only owns its own look, the thinking-pulse animation, and
 * which side its tail points from.
 */
export function PeekCard({ anchorLeft, phase, snippet, onPress }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  // RN's global RTL left<->right style swap flips a plain left/right style
  // whenever I18nManager.isRTL, regardless of this view's own layout — so to
  // land on the PHYSICAL side the caller asked for, pick the opposite key
  // when the app is RTL (mirrors FloatingPill's own `hostAnchor` trick).
  const useLeftKey = I18nManager.isRTL ? !anchorLeft : anchorLeft;
  const anchorStyle = useLeftKey ? { left: 0 as const } : { right: 0 as const };

  const pulse = useSharedValue(0.4);
  useEffect(() => {
    if (phase === "thinking") {
      pulse.value = withRepeat(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      pulse.value = 1;
    }
  }, [phase, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const label =
    phase === "thinking"
      ? t("aiDock.peek.thinking", { defaultValue: "Thinking" })
      : phase === "writing"
        ? t("aiDock.peek.writing", { defaultValue: "Writing…" })
        : t("aiDock.peek.done", { defaultValue: "Done" });

  const trimmed = snippet.trim().replace(/\s+/g, " ").slice(0, 100);

  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.host, anchorStyle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={trimmed ? `${label}: ${trimmed}` : label}
        style={[
          styles.card,
          { backgroundColor: colors.bgCard, borderColor: phase === "done" ? colors.brandPrimary : colors.borderDefault },
        ]}
      >
        <Animated.View style={[styles.row, pulseStyle]}>
          <Text style={[styles.label, { color: colors.brandPrimary }]}>{label}</Text>
          {phase === "done" && <View style={[styles.unreadDot, { backgroundColor: colors.brandPrimary }]} />}
        </Animated.View>
        {trimmed.length > 0 && (
          <Text numberOfLines={2} style={[styles.snippet, { color: colors.textPrimary }]}>
            {trimmed}
          </Text>
        )}
      </Pressable>
      <View
        style={[
          styles.tail,
          { backgroundColor: colors.bgCard, borderColor: colors.borderDefault },
          anchorLeft ? styles.tailLeft : styles.tailRight,
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", bottom: BUBBLE_CLEARANCE, maxWidth: 220 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 10.5, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.3 },
  snippet: { fontSize: 12.5, fontFamily: "Inter_400Regular", lineHeight: 16 },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5 },
  tail: {
    position: "absolute",
    bottom: -6,
    width: 12,
    height: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: "45deg" }],
  },
  tailLeft: { left: 18 },
  tailRight: { right: 18 },
});
```

- [ ] **Step 2: Verify it compiles standalone.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean (not imported anywhere yet).

- [ ] **Step 3: Commit.**

```bash
git add components/workspace/PeekCard.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): add PeekCard component

Presentational Messenger-style tail-bubble card: a thinking pulse, a
live snippet while writing, and a persistent done/unread state. Not
wired into FloatingPill yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire it all into `FloatingPill.tsx`

This is the integration task. **Before starting, run** `git diff -- components/workspace/FloatingPill.tsx` **and confirm the surrounding code in each step below still matches** — this file carries uncommitted WIP from a concurrent session (chrome/header-footer bands) and may have moved on since this plan was written. Match by the surrounding comments/code shown, not by absolute line numbers.

**Files:**
- Modify: `components/workspace/FloatingPill.tsx`

- [ ] **Step 1: Add the new imports.** Find the existing import block:

```tsx
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { hSelection } from "@/lib/haptics";
import { layoutSpring, SPRING } from "@/lib/motion";
import type { DocBlockDTO } from "@/lib/api";
import { resolveBubbleKind, chromeBubbleKind, BUBBLE_ICONS, type BubbleKind } from "@/lib/bubble-configs";
import { AIDock } from "./AIDock";
import { BlockContextBar } from "./BlockContextBar";
import { DismissTarget, DISMISS_HIT_RADIUS } from "./DismissTarget";
```

Add four new import lines (`useThesisStore`, `useChatHead`, `PeekCard`, `ChatOverlayPanel`):

```tsx
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatHead } from "@/stores/chat-head-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { hSelection } from "@/lib/haptics";
import { layoutSpring, SPRING } from "@/lib/motion";
import type { DocBlockDTO } from "@/lib/api";
import { resolveBubbleKind, chromeBubbleKind, BUBBLE_ICONS, type BubbleKind } from "@/lib/bubble-configs";
import { AIDock } from "./AIDock";
import { BlockContextBar } from "./BlockContextBar";
import { DismissTarget, DISMISS_HIT_RADIUS } from "./DismissTarget";
import { PeekCard, type PeekPhase } from "./PeekCard";
import { ChatOverlayPanel } from "@/components/ChatOverlayPanel";
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean (new imports unused so far — TS doesn't error on unused imports in this project's config, but if it does, ignore until Steps 3-6 consume them; if it hard-errors, skip ahead and come back).

- [ ] **Step 3: Add the new selectors.** Find:

```tsx
  const colors = useThemeColors();
  // Busy spinner: the bubble spins while an AI turn is generating, in either mode.
  const busy = useChatStore((s) => s.isGenerating);
```

Replace with:

```tsx
  const colors = useThemeColors();
  // Busy spinner: the bubble spins while an AI turn is generating, in either mode.
  const busy = useChatStore((s) => s.isGenerating);
  // Peek-card state: whether a plain chat ask is awaiting the user's read, plus
  // the raw chat-store fields the card's content derives from (no copy kept).
  const awaitingReply = useFloatingPillStore((s) => s.awaitingReply);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const streamingId = useChatStore((s) => s.streamingId);
  const threadMessages = useChatStore((s) => s.messages[thesisId]);
  const thesisTitle = useThesisStore((s) => s.theses.find((th) => th.id === thesisId)?.title ?? "");
```

- [ ] **Step 4: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Derive the peek card's content + anchor side, and the reveal action.** Find:

```tsx
  // ── Drag position ──
  const defaultX = (width - maxPillW) / 2;
  const defaultY = height - insets.bottom - PILL_H - 120;
  const startX = pos?.x ?? defaultX;
  const startY = pos?.y ?? defaultY;
```

Add right after it:

```tsx
  // ── Drag position ──
  const defaultX = (width - maxPillW) / 2;
  const defaultY = height - insets.bottom - PILL_H - 120;
  const startX = pos?.x ?? defaultX;
  const startY = pos?.y ?? defaultY;

  // Peek card content: while generating, the live/streaming message; once the
  // turn ends, the last assistant message — both read straight off the shared
  // chat thread. `!busy` (not `generatingPhase === "idle"`) decides "done" so a
  // brief post-stream gap before the store settles doesn't flash "thinking".
  const peekPhase: PeekPhase = !busy ? "done" : generatingPhase === "writing" ? "writing" : "thinking";
  const peekMessage = !busy
    ? threadMessages?.[threadMessages.length - 1]
    : threadMessages?.find((m) => m.id === streamingId);
  const peekSnippet = peekMessage?.content ?? "";
  // Anchor the card's tail toward whichever half of the screen the bubble is
  // currently settled in, so it never overhangs an edge. Read from the last
  // PERSISTED position (not the live drag shared value) — a rare cosmetic
  // trade-off: the anchor side won't flip mid-drag, only after the bubble
  // settles, which is fine since a peek is never shown while actively dragging.
  const peekAnchorLeft = startX + BUBBLE_SIZE / 2 < width / 2;

  // Tapping the peek card — or the bubble itself while a reply is unread —
  // opens the shared chat-overlay panel instead of expanding the AI dock.
  // Marks the reply read.
  const revealReply = () => {
    useChatHead.getState().open();
    useFloatingPillStore.getState().setAwaitingReply(false);
    useFloatingPillStore.getState().setExpanded(false);
  };
```

- [ ] **Step 6: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Restructure the return so the chat overlay is never unmounted by an unrelated suppression flag.** This is the one structural change: today, `if (!visible || suppressed) return null;` means if the overlay is open (`useChatHead.expanded === true`, e.g. the user is answering a follow-up question inside it) and something else flips `suppressed` true in the meantime (e.g. a *new* AI turn started from inside that very overlay trips `aiGateActive`), the whole component — including the overlay we just opened — would vanish. Find:

```tsx
  const suppressed =
    askAiOpen || aiGateActive || soleSuggested || rangeActive || !composerOpen || previewMode != null || insertMenuOpen;
  if (!visible || suppressed) {
    // Still render the target host? No — nothing to show when suppressed.
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <DismissTarget visible={dragActive} active={overTarget} centerY={targetCY} bottomInset={dismissBottom} />
      <GestureDetector gesture={pan}>
        <Animated.View layout={layoutSpring} style={[styles.host, hostAnchor, { width: curW }, pillStyle]}>
          {expanded ? (
```

Replace the `if (...) return null;` + opening `return (` + `<View ...>` with:

```tsx
  const suppressed =
    askAiOpen || aiGateActive || soleSuggested || rangeActive || !composerOpen || previewMode != null || insertMenuOpen;
  // The pill itself hides when suppressed/not visible, same as before — but the
  // chat-overlay panel (mounted unconditionally below) must NOT unmount just
  // because one of those flags flips while the user is actively using it.
  const pillVisible = visible && !suppressed;

  return (
    <>
      {pillVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <DismissTarget visible={dragActive} active={overTarget} centerY={targetCY} bottomInset={dismissBottom} />
          <GestureDetector gesture={pan}>
            <Animated.View layout={layoutSpring} style={[styles.host, hostAnchor, { width: curW }, pillStyle]}>
              {expanded ? (
```

Then find the matching close of that same JSX block, further down:

```tsx
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
```

Replace with:

```tsx
            </Animated.View>
          </GestureDetector>
        </View>
      )}
      <ChatOverlayPanel thesisId={thesisId} thesisTitle={thesisTitle} />
    </>
  );
}
```

(Everything between those two edited boundaries — the whole `{expanded ? (...) : (...)}` block, including Step 9 below — is now one JSX-nesting level deeper than before, from inside `<View>` directly to inside `{pillVisible && (<View>...)}`. **Do not re-indent it.** Leave every line's existing leading whitespace exactly as-is — JSX/JS doesn't require consistent indentation to run, and Step 9's find/replace below is written against the file's *original* indentation so it can match verbatim. A whitespace-only cleanup pass is safe to do later, but not as part of this step.)

- [ ] **Step 8: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean. If it complains about a stray unmatched brace/paren, the re-indent in Step 7 dropped or duplicated a closing token — recount `(`/`{` pairs between the two edited spots.

- [ ] **Step 9: Render `PeekCard` beside the collapsed `Bubble`, and reroute its tap while unread.** Find:

```tsx
          ) : (
            <Bubble
              colors={colors}
              kind={bubbleKind}
              busy={busy}
              label={
                count === 0
                  ? t("blockBar.askAi", { defaultValue: "Ask AI" })
                  : t("blockBar.formattingTools", { defaultValue: "Formatting tools" })
              }
              onPress={() => useFloatingPillStore.getState().setExpanded(true)}
            />
          )}
```

Replace with:

```tsx
          ) : (
            <>
              {awaitingReply && (
                <PeekCard anchorLeft={peekAnchorLeft} phase={peekPhase} snippet={peekSnippet} onPress={revealReply} />
              )}
              <Bubble
                colors={colors}
                kind={bubbleKind}
                busy={busy}
                label={
                  count === 0
                    ? t("blockBar.askAi", { defaultValue: "Ask AI" })
                    : t("blockBar.formattingTools", { defaultValue: "Formatting tools" })
                }
                onPress={awaitingReply ? revealReply : () => useFloatingPillStore.getState().setExpanded(true)}
              />
            </>
          )}
```

- [ ] **Step 10: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 11: Device/simulator QA.** Open a thesis in the workspace:
  1. Tap the ✦ bubble → AIDock opens. Type a whole-memoir question in "Ask…" and send.
     - Expect: dock collapses to the ✦ bubble immediately; a tail-bubble card appears above it reading "Thinking" with a pulsing label.
     - Once tokens start streaming, the card's label switches and shows a live growing snippet of the answer.
     - Once the turn finishes, the card switches to its "done" look (colored border + unread dot) and **stays** — wait ~15s without touching it to confirm no auto-fade.
  2. Tap the card → the full chat overlay opens (dim backdrop + zoomed-in panel) showing the exchange that just happened. Close it (backdrop tap or its own close button) → back to the plain ✦ bubble, no card left over.
  3. Repeat, but this time tap the bare ✦ **bubble** itself (not the card) while the reply is still unread → same reveal opens.
  4. Fire a second whole-memoir ask before reading the first reply → the snippet updates to the new turn; no duplicate cards, no crash.
  5. Select 2+ blocks (not a Lexical range — e.g. a table + a paragraph, or use the native/non-Lexical view if available) and fire "Ask…" on that multi-block scope → confirm the peek card still appears on whatever icon the collapsed bubble shows (not just the ✦ icon).
  6. Select a single paragraph and use "Improve writing" → confirm **no** peek card appears (this path goes through the suggestion store's in-place diff UI, untouched by this change).
  7. Switch the app to Arabic (RTL) and repeat step 1 with the bubble parked on both the left and right thirds of the screen → card mirrors and never overhangs an edge.
  8. While a reply is unread, trigger an AI clarifying question in a **different** ask (e.g. one that hits `pendingAsk`) → confirm the bottom composer still force-opens as it does today, independent of the peek state.

- [ ] **Step 12: Commit.**

```bash
git add components/workspace/FloatingPill.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): Messenger-style peek card on the AI bubble

When a plain chat ask auto-collapses the AIDock, the bubble now shows
a tail-bubble peek card (thinking -> streaming snippet -> persistent
unread) instead of just spinning silently. Tapping the card or the
bubble opens the same full-thread chat overlay ChatHead already
defines. Also hardens FloatingPill's suppression check so an open
overlay is never unmounted by an unrelated flag flipping mid-use.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full regression pass

Nothing new to build — this task is a final sweep across the whole feature plus the areas it touches, since `FloatingPill.tsx` is a heavily-shared, actively-changing file.

**Files:** none (verification only).

- [ ] **Step 1: Full project tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean, 0 errors, across the whole project (not just the touched files).

- [ ] **Step 2: Re-run the full Task 5 Step 11 device/simulator checklist** end to end in one sitting, plus:
  - Block formatting (select a paragraph, no Ask — just bold/align/etc.) still works exactly as before (unaffected code path, `BlockContextBar` branch).
  - Drag the ✦ bubble to the bottom-center ✕ while a reply is unread → pill dismisses as it always has (no crash, no orphaned peek card, no orphaned overlay).
  - Background the app mid-generation, foreground it again → peek state (thinking/writing/done) still reflects reality (it's derived live from `useChatStore`, not snapshotted, so this should just work — confirm it does).
  - Leave the thesis workspace screen entirely while a reply is unread, then re-enter the same thesis → confirm the peek does **not** persist across the screen unmount (matches the locked "workspace bubble only" scope — this is expected, not a bug).

- [ ] **Step 3: Update project memory.** This plan's completion should update the existing `ai-bubble-peek-preview.md` memory entry (in `~/.claude/projects/-Users-hamzasafwan-modakerati/memory/`) from "SPEC ONLY, not implemented" to reflect the shipped state and commit range — done by whoever runs this task, not part of the app's git history.

- [ ] **Step 4: No commit for this task** — it's verification-only. If Step 2 surfaces a bug, fix it as a small follow-up commit scoped to the specific file it's in, re-run the relevant checklist item, then commit that fix on its own.
