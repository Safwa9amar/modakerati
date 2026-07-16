# ThinkingTrace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two inconsistent "thinking" displays with one shared, Claude-Code-style `<ThinkingTrace>` widget that streams reasoning live and collapses to a reviewable "Thought for Xs" chip.

**Architecture:** A single presentational `components/ThinkingTrace.tsx` (pure props, no store access) is rendered by both the chat tab (`app/(tabs)/chat.tsx`) and the workspace composer (`components/workspace/ComposerThinking.tsx`). Reasoning duration comes from two new timestamps stamped on the chat message in `stores/chat-store.ts` from `lib/ai-service.ts`. Pure logic lives in `lib/thinking.ts` and is unit-verified.

**Tech Stack:** React Native + Expo (SDK 56), Zustand, react-native-reanimated 4, lucide-react-native, react-i18next. **No test runner exists in this repo** — pure helpers are verified with `npx tsx` (ephemeral, no repo changes); the RN view is verified manually on a device.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/thinking.ts` | **New.** Pure helpers: `deriveThinkingMs`, `windowLines`, `formatThinkingDuration`. No imports. |
| `lib/thinking.check.ts` | **New.** Throwaway assertion script run via `npx tsx` to verify the helpers. |
| `components/ThinkingTrace.tsx` | **New.** The entire shared widget + its 4 render states + animations. |
| `types/chat.ts` | +2 optional timestamp fields on `ChatMessage`. |
| `stores/chat-store.ts` | Stamp `thinkingStartedAt` on first chunk; add `markThinkingEnded` action. |
| `lib/ai-service.ts` | Stamp `thinkingEndedAt` at first answer token and in `finally`. |
| `app/(tabs)/chat.tsx` | `Bubble` renders `<ThinkingTrace>`; remove dead state/styles/imports. |
| `components/workspace/ComposerThinking.tsx` | Rewrite over `<ThinkingTrace>` + collapsed-after-done. |
| `components/workspace/WorkspaceComposerSheet.tsx` | Pass the last assistant message's thinking + duration. |
| `locales/{en,fr,ar}.json` | Add `chat.thinkingEllipsis` and `chat.thoughtFor`. |

---

## Task 1: Pure helpers (`lib/thinking.ts`)

**Files:**
- Create: `lib/thinking.ts`
- Create: `lib/thinking.check.ts`

- [ ] **Step 1: Write the failing check**

Create `lib/thinking.check.ts`:

```ts
import assert from "node:assert";
import { deriveThinkingMs, windowLines, formatThinkingDuration } from "./thinking";

// deriveThinkingMs
assert.strictEqual(deriveThinkingMs({}), undefined, "no timestamps → undefined");
assert.strictEqual(
  deriveThinkingMs({ thinkingStartedAt: "2026-07-16T00:00:00.000Z" }),
  undefined,
  "only start → undefined",
);
assert.strictEqual(
  deriveThinkingMs({
    thinkingStartedAt: "2026-07-16T00:00:00.000Z",
    thinkingEndedAt: "2026-07-16T00:00:08.000Z",
  }),
  8000,
  "both → delta ms",
);
assert.strictEqual(
  deriveThinkingMs({
    thinkingStartedAt: "2026-07-16T00:00:08.000Z",
    thinkingEndedAt: "2026-07-16T00:00:00.000Z",
  }),
  undefined,
  "negative → undefined",
);

// windowLines
assert.deepStrictEqual(windowLines("", 6), [], "empty → []");
assert.deepStrictEqual(windowLines("a\n\n b \nc", 6), ["a", "b", "c"], "trims + drops empties");
assert.deepStrictEqual(windowLines("1\n2\n3\n4", 2), ["3", "4"], "keeps last n");

// formatThinkingDuration
assert.strictEqual(formatThinkingDuration(0), "1s", "floors to 1s");
assert.strictEqual(formatThinkingDuration(500), "1s", "sub-second → 1s");
assert.strictEqual(formatThinkingDuration(45_000), "45s");
assert.strictEqual(formatThinkingDuration(60_000), "1m");
assert.strictEqual(formatThinkingDuration(64_000), "1m 4s");

console.log("OK: lib/thinking.ts");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx lib/thinking.check.ts`
Expected: FAIL — cannot resolve `./thinking` (module not found).

- [ ] **Step 3: Implement the helpers**

Create `lib/thinking.ts`:

```ts
// Pure helpers for the ThinkingTrace widget. No React/RN imports so they can be
// verified with `npx tsx lib/thinking.check.ts`.

/** Reasoning duration in ms, or undefined if it can't be measured yet. */
export function deriveThinkingMs(msg: {
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
}): number | undefined {
  if (!msg.thinkingStartedAt || !msg.thinkingEndedAt) return undefined;
  const ms = Date.parse(msg.thinkingEndedAt) - Date.parse(msg.thinkingStartedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** The last `n` non-empty, trimmed lines of the reasoning text. */
export function windowLines(text: string, n: number): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return n > 0 ? lines.slice(-n) : lines;
}

/** Human duration for the chip: "1s" (min) … "45s" … "1m 4s". */
export function formatThinkingDuration(ms: number): string {
  const secs = Math.max(1, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx lib/thinking.check.ts`
Expected: prints `OK: lib/thinking.ts`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/thinking.ts lib/thinking.check.ts
git commit -m "feat(thinking): pure duration/line helpers + verification check"
```

---

## Task 2: Message timestamp fields (`types/chat.ts`)

**Files:**
- Modify: `types/chat.ts`

- [ ] **Step 1: Add the two fields**

In `types/chat.ts`, find:

```ts
  // Reasoning ("thinking") tokens from a reasoning model, shown in a collapsible
  // section. Ephemeral — streamed live, not persisted server-side.
  thinking?: string;
```

Replace with:

```ts
  // Reasoning ("thinking") tokens from a reasoning model, shown in a collapsible
  // section. Ephemeral — streamed live, not persisted server-side.
  thinking?: string;
  // When reasoning started / ended (ISO). Drives the "Thought for Xs" chip; set
  // by the chat-store as tokens stream (start) and by ai-service at the first
  // answer token / turn end (end).
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `types/chat.ts`. (Pre-existing unrelated errors, if any, are fine.)

- [ ] **Step 3: Commit**

```bash
git add types/chat.ts
git commit -m "feat(thinking): add thinkingStartedAt/thinkingEndedAt to ChatMessage"
```

---

## Task 3: Store — stamp start + `markThinkingEnded` (`stores/chat-store.ts`)

**Files:**
- Modify: `stores/chat-store.ts`

- [ ] **Step 1: Stamp `thinkingStartedAt` on the first thinking chunk**

Find `appendToThinking` (currently):

```ts
  appendToThinking: (thesisId, id, chunk) =>
    set((s) => {
      const list = s.messages[thesisId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [thesisId]: list.map((m) => (m.id === id ? { ...m, thinking: (m.thinking ?? "") + chunk } : m)),
        },
      };
    }),
```

Replace with:

```ts
  appendToThinking: (thesisId, id, chunk) =>
    set((s) => {
      const list = s.messages[thesisId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [thesisId]: list.map((m) =>
            m.id === id
              ? {
                  ...m,
                  thinking: (m.thinking ?? "") + chunk,
                  // First reasoning token → start the clock (idempotent).
                  thinkingStartedAt: m.thinkingStartedAt ?? new Date().toISOString(),
                }
              : m,
          ),
        },
      };
    }),
```

- [ ] **Step 2: Declare the new action on the interface**

Find in `interface ChatState`:

```ts
  appendToThinking: (thesisId: string, id: string, chunk: string) => void;
```

Add directly below it:

```ts
  markThinkingEnded: (thesisId: string, id: string) => void;
```

- [ ] **Step 3: Implement the action**

Find the `setPendingAsk` action (near the bottom):

```ts
  setPendingAsk: (ask) => set({ pendingAsk: ask }),
```

Add directly below it:

```ts
  // Stamp when reasoning ended. Idempotent: only stamps if thinking actually
  // started and the end isn't already set. Called at the first answer token and
  // again in ai-service's finally (covers tool-only turns and aborts).
  markThinkingEnded: (thesisId, id) =>
    set((s) => {
      const list = s.messages[thesisId];
      if (!list) return s;
      let changed = false;
      const next = list.map((m) => {
        if (m.id !== id || !m.thinkingStartedAt || m.thinkingEndedAt) return m;
        changed = true;
        return { ...m, thinkingEndedAt: new Date().toISOString() };
      });
      return changed ? { messages: { ...s.messages, [thesisId]: next } } : s;
    }),
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `stores/chat-store.ts`.

- [ ] **Step 5: Commit**

```bash
git add stores/chat-store.ts
git commit -m "feat(thinking): store stamps reasoning start + markThinkingEnded"
```

---

## Task 4: Service — stamp end (`lib/ai-service.ts`)

**Files:**
- Modify: `lib/ai-service.ts` (`runAssistantTurn`)

- [ ] **Step 1: Add a `sawContent` flag next to `assistantId`**

Find:

```ts
  // Lazily created on the first streamed chunk so the "thinking" indicator
  // shows until the AI actually starts producing text.
  let assistantId: string | null = null;
```

Replace with:

```ts
  // Lazily created on the first streamed chunk so the "thinking" indicator
  // shows until the AI actually starts producing text.
  let assistantId: string | null = null;
  // Flips true at the first answer token → marks the end of reasoning exactly once.
  let sawContent = false;
```

- [ ] **Step 2: Close out reasoning at the first answer token**

Find the `onDelta` handler:

```ts
        onDelta: (chunk) => {
          const s = useChatStore.getState();
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
            s.setGeneratingPhase("writing");
          }
          s.appendToMessage(thesisId, assistantId, chunk);
        },
```

Replace with:

```ts
        onDelta: (chunk) => {
          const s = useChatStore.getState();
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
          }
          if (!sawContent) {
            sawContent = true;
            // First answer token → reasoning is over; stamp its end and flip phase.
            s.markThinkingEnded(thesisId, assistantId);
            s.setGeneratingPhase("writing");
          }
          s.appendToMessage(thesisId, assistantId, chunk);
        },
```

- [ ] **Step 3: Also stamp end when the turn finishes**

Find the `finally` block:

```ts
  } finally {
    store.setGenerating(false);
    store.setGeneratingPhase("idle");
```

Replace with:

```ts
  } finally {
    // Covers turns that end with no answer text (tool-only actions) or a mid-think
    // abort — markThinkingEnded is a no-op if reasoning never started or already ended.
    if (assistantId) store.markThinkingEnded(thesisId, assistantId);
    store.setGenerating(false);
    store.setGeneratingPhase("idle");
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `lib/ai-service.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-service.ts
git commit -m "feat(thinking): stamp reasoning end at first token + turn end"
```

---

## Task 5: i18n keys (`locales/{en,fr,ar}.json`)

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: English**

In `locales/en.json`, find:

```json
    "thinking": "Thinking",
```

Replace with:

```json
    "thinking": "Thinking",
    "thinkingEllipsis": "Thinking…",
    "thoughtFor": "Thought for {{d}}",
```

- [ ] **Step 2: French**

In `locales/fr.json`, find:

```json
    "thinking": "Reflexion",
```

Replace with:

```json
    "thinking": "Reflexion",
    "thinkingEllipsis": "Réflexion…",
    "thoughtFor": "Réfléchi pendant {{d}}",
```

- [ ] **Step 3: Arabic**

In `locales/ar.json`, find:

```json
    "thinking": "يفكر",
```

Replace with:

```json
    "thinking": "يفكر",
    "thinkingEllipsis": "يفكر…",
    "thoughtFor": "فكّر لمدة {{d}}",
```

- [ ] **Step 4: Verify the JSON is valid**

Run: `node -e "['en','fr','ar'].forEach(l=>{const c=require('./locales/'+l+'.json'); if(!c.chat.thoughtFor||!c.chat.thinkingEllipsis) throw new Error(l+' missing keys'); }); console.log('OK i18n')"`
Expected: prints `OK i18n`.

- [ ] **Step 5: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(thinking): i18n thinkingEllipsis + thoughtFor (en/fr/ar)"
```

---

## Task 6: The `<ThinkingTrace>` component (`components/ThinkingTrace.tsx`)

**Files:**
- Create: `components/ThinkingTrace.tsx`

- [ ] **Step 1: Write the component**

Create `components/ThinkingTrace.tsx`:

```tsx
import { useEffect, useRef, useState, type ComponentType } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView as RNScrollView } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Asterisk, ChevronDown, ChevronUp } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { windowLines, formatThinkingDuration } from "@/lib/thinking";

// How many trailing reasoning lines the live window shows.
const LIVE_LINES = 6;

interface Props {
  /** Accumulated reasoning text. */
  text: string;
  /** True while this turn is still reasoning. */
  streaming: boolean;
  /** Once known → renders "Thought for Xs". */
  durationMs?: number;
  /** Initial expanded state (composer live = true; chat = false). */
  defaultOpen?: boolean;
  /** Draw a hairline separator below when an answer follows (chat bubble). */
  dividerBelow?: boolean;
  rtl?: boolean;
  /** The sheet injects BottomSheetScrollView; chat leaves it default. */
  ScrollComponent?: ComponentType<any>;
}

/** A ✻ that spins while the model is reasoning. */
function SpinningAsterisk({ color }: { color: string }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 1200, easing: Easing.linear }), -1);
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Asterisk size={13} color={color} strokeWidth={2.5} />
    </Animated.View>
  );
}

/** Top-edge fade over the live window, built from stacked opacity bands (no
 *  gradient dependency — mirrors chat.tsx's FadeOverlay). */
function TopFade({ color }: { color: string }) {
  const SLICES = 8;
  const H = 22;
  return (
    <View pointerEvents="none" style={[styles.topFade, { height: H }]}>
      {Array.from({ length: SLICES }).map((_, i) => (
        <View key={i} style={{ height: H / SLICES, backgroundColor: color, opacity: (SLICES - i) / SLICES }} />
      ))}
    </View>
  );
}

/**
 * The shared "model thinking" widget. Streams reasoning line-by-line (Claude-Code
 * style) while active, then collapses to a tappable "Thought for Xs" chip.
 */
export function ThinkingTrace({
  text,
  streaming,
  durationMs,
  defaultOpen = false,
  dividerBelow = false,
  rtl = false,
  ScrollComponent,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);

  // Auto-collapse to the chip when a turn ends; re-open when a new turn starts.
  const prevStreaming = useRef(streaming);
  useEffect(() => {
    if (!prevStreaming.current && streaming) setOpen(true);
    else if (prevStreaming.current && !streaming) setOpen(false);
    prevStreaming.current = streaming;
  }, [streaming]);

  const hasText = text.trim().length > 0;
  if (!streaming && !hasText) return null;

  const Scroll = ScrollComponent ?? RNScrollView;
  const durLabel = durationMs != null ? formatThinkingDuration(durationMs) : "";
  const label = streaming
    ? t("chat.thinkingEllipsis", { defaultValue: "Thinking…" })
    : durationMs != null
      ? t("chat.thoughtFor", { d: durLabel, defaultValue: `Thought for ${durLabel}` })
      : t("chat.thinking", { defaultValue: "Thinking" });

  const liveLines = windowLines(text, LIVE_LINES);

  return (
    <View style={dividerBelow ? [styles.dividerWrap, { borderColor: colors.borderDefault }] : undefined}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        accessibilityRole="button"
        style={[styles.header, { flexDirection: rtl ? "row-reverse" : "row" }]}
      >
        {streaming ? (
          <SpinningAsterisk color={colors.brandPrimaryLight} />
        ) : (
          <Asterisk size={13} color={colors.textSecondary} strokeWidth={2.5} />
        )}
        <Text style={[styles.label, { color: streaming ? colors.brandPrimaryLight : colors.textSecondary }]}>
          {label}
        </Text>
        <View style={styles.spacer} />
        {open ? (
          <ChevronUp size={14} color={colors.textSecondary} strokeWidth={2} />
        ) : (
          <ChevronDown size={14} color={colors.textSecondary} strokeWidth={2} />
        )}
      </Pressable>

      {/* Live: last N lines, top-faded, no inner scroll (never fights the sheet). */}
      {streaming && open && hasText ? (
        <View style={[styles.rail, { borderColor: colors.brandPrimary }]}>
          <View style={styles.liveWindow}>
            {liveLines.map((line, i) => (
              <Text
                key={i}
                style={[styles.line, { color: colors.textSecondary, opacity: i === liveLines.length - 1 ? 0.95 : 0.45 }]}
              >
                {line}
              </Text>
            ))}
          </View>
          <TopFade color={colors.bgCard} />
        </View>
      ) : null}

      {/* Done + expanded: full reasoning, scrollable via the injected container. */}
      {!streaming && open && hasText ? (
        <View style={[styles.rail, { borderColor: colors.borderDefault }]}>
          <Scroll style={styles.doneScroll} contentContainerStyle={styles.doneScrollContent}>
            <Text selectable style={[styles.line, { color: colors.textSecondary }]}>
              {text.trim()}
            </Text>
          </Scroll>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dividerWrap: { marginBottom: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { alignItems: "center", gap: 6 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  spacer: { flex: 1 },
  rail: { marginTop: 8, borderLeftWidth: 2, paddingLeft: 10, position: "relative" },
  liveWindow: { maxHeight: 110, overflow: "hidden", justifyContent: "flex-end" },
  doneScroll: { maxHeight: 220 },
  doneScrollContent: { paddingBottom: 2 },
  line: { fontSize: 11.5, lineHeight: 17, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  topFade: { position: "absolute", top: 0, left: 0, right: 0 },
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `components/ThinkingTrace.tsx`. (Confirms `colors.brandPrimaryLight`, `colors.bgCard`, `colors.borderDefault` exist on the theme.)

- [ ] **Step 3: Commit**

```bash
git add components/ThinkingTrace.tsx
git commit -m "feat(thinking): shared ThinkingTrace widget (Claude-Code style)"
```

---

## Task 7: Wire the chat tab (`app/(tabs)/chat.tsx`)

**Files:**
- Modify: `app/(tabs)/chat.tsx`

- [ ] **Step 1: Add imports**

Find:

```tsx
import { getTextDirection } from "@/lib/text-direction";
import { TypingIndicator, ThinkingDots } from "@/components/TypingIndicator";
```

Replace with:

```tsx
import { getTextDirection } from "@/lib/text-direction";
import { TypingIndicator } from "@/components/TypingIndicator";
import { ThinkingTrace } from "@/components/ThinkingTrace";
import { deriveThinkingMs } from "@/lib/thinking";
```

- [ ] **Step 2: Drop the now-unused `Sparkles` import**

Find:

```tsx
import { Send, Plus, Home, List, Paperclip, Image as ImageIcon, Sparkles, ChevronDown, ChevronUp, Square, Maximize2, X, FileText, RotateCcw } from "lucide-react-native";
```

Replace with (remove only `Sparkles,` — `ChevronDown`/`ChevronUp` stay, they're used elsewhere):

```tsx
import { Send, Plus, Home, List, Paperclip, Image as ImageIcon, ChevronDown, ChevronUp, Square, Maximize2, X, FileText, RotateCcw } from "lucide-react-native";
```

- [ ] **Step 3: Remove the dead `thinkOpen` state**

Find and delete this line inside `Bubble`:

```tsx
  const [thinkOpen, setThinkOpen] = useState(false);
```

- [ ] **Step 4: Replace the inline thinking block with `<ThinkingTrace>`**

Find:

```tsx
        {!isUser && item.thinking ? (
          <View style={[hasContent && styles.thinkWrap, { borderColor: colors.borderDefault }]}>
            <Pressable onPress={() => setThinkOpen((o) => !o)} hitSlop={6} style={styles.thinkHeader} accessibilityRole="button">
              <Sparkles size={13} color={colors.textSecondary} strokeWidth={2} />
              <Text style={[styles.thinkLabel, { color: colors.textSecondary }]}>{t("chat.thinking", { defaultValue: "Thinking" })}</Text>
              {thinkingActive && <ThinkingDots color={colors.textSecondary} />}
              <View style={styles.thinkSpacer} />
              {thinkOpen ? <ChevronUp size={14} color={colors.textSecondary} strokeWidth={2} /> : <ChevronDown size={14} color={colors.textSecondary} strokeWidth={2} />}
            </Pressable>
            {thinkOpen && <Text selectable style={[styles.thinkText, { color: colors.textSecondary }]}>{item.thinking}</Text>}
          </View>
        ) : null}
```

Replace with:

```tsx
        {!isUser && item.thinking ? (
          <ThinkingTrace
            text={item.thinking}
            streaming={thinkingActive}
            durationMs={deriveThinkingMs(item)}
            dividerBelow={hasContent}
            rtl={dir === "rtl"}
          />
        ) : null}
```

- [ ] **Step 5: Remove the now-unused styles**

In the `StyleSheet.create` block at the bottom, delete these five entries (keep `fadeOverlay` and `collapsedWrap` — still used by message collapse):

```tsx
  thinkWrap: { marginBottom: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  thinkHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  thinkLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  thinkSpacer: { flex: 1 },
  thinkText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 8, fontStyle: "italic" },
```

- [ ] **Step 6: Verify it compiles with no unused-symbol errors**

Run: `npx tsc --noEmit`
Expected: no new errors in `app/(tabs)/chat.tsx`; no "declared but never used" for `Sparkles`, `ThinkingDots`, `thinkOpen`, or the removed styles.

- [ ] **Step 7: Commit**

```bash
git add "app/(tabs)/chat.tsx"
git commit -m "feat(thinking): chat tab renders shared ThinkingTrace"
```

---

## Task 8: Wire the workspace composer

**Files:**
- Modify: `components/workspace/ComposerThinking.tsx`
- Modify: `components/workspace/WorkspaceComposerSheet.tsx`

- [ ] **Step 1: Rewrite `ComposerThinking.tsx`**

Replace the entire contents of `components/workspace/ComposerThinking.tsx` with:

```tsx
import { View, Text, StyleSheet } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useThemeColors } from "@/hooks/useThemeColors";
import { ThinkingTrace } from "@/components/ThinkingTrace";

interface Props {
  isGenerating: boolean;
  /** True only while actively reasoning (phase === "thinking"). Drives the live
   *  stream; once the model starts writing this is false so the chip appears. */
  reasoning: boolean;
  /** Reasoning to surface: the live turn's, else the last turn's (for review). */
  thinking: string;
  /** Duration of the completed reasoning → "Thought for Xs". */
  durationMs?: number;
  /** Localized idle status line. */
  statusReady: string;
  rtl: boolean;
}

/**
 * The composer's "model thinking" area. When there's nothing to show it's a
 * one-line status; otherwise it renders the shared ThinkingTrace — live while
 * reasoning, then a reviewable "Thought for Xs" chip (through the writing phase
 * and until the next turn).
 */
export function ComposerThinking({ isGenerating, reasoning, thinking, durationMs, statusReady, rtl }: Props) {
  const colors = useThemeColors();

  if (!isGenerating && !thinking) {
    return (
      <View style={[styles.box, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}>
        <Text
          style={[styles.status, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}
          numberOfLines={1}
        >
          {statusReady}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.box, { backgroundColor: colors.bgSurface, borderColor: colors.brandPrimary + "44" }]}>
      <ThinkingTrace
        text={thinking}
        streaming={reasoning}
        durationMs={reasoning ? undefined : durationMs}
        defaultOpen={reasoning}
        rtl={rtl}
        ScrollComponent={BottomSheetScrollView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 2,
  },
  status: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
```

- [ ] **Step 2: Feed the composer the last-turn reasoning + duration**

In `components/workspace/WorkspaceComposerSheet.tsx`, find:

```tsx
  const thinking = useChatStore((s) => {
    const id = s.streamingId;
    if (!id) return "";
    return s.messages[thesisId]?.find((m) => m.id === id)?.thinking ?? "";
  });
```

Replace with:

```tsx
  // Reasoning to surface: the live streaming message while generating, else the
  // most recent assistant message that produced reasoning (kept reviewable until
  // the next turn). Both selectors return primitives so the composer re-renders
  // only when the value changes (no fresh-object selector loop).
  const thinking = useChatStore((s) => {
    const list = s.messages[thesisId];
    if (!list) return "";
    if (s.streamingId) return list.find((m) => m.id === s.streamingId)?.thinking ?? "";
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "assistant" && list[i].thinking) return list[i].thinking ?? "";
    }
    return "";
  });
  const thinkingMs = useChatStore((s) => {
    const list = s.messages[thesisId];
    if (!list) return undefined;
    let msg: (typeof list)[number] | undefined;
    if (s.streamingId) {
      msg = list.find((m) => m.id === s.streamingId);
    } else {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === "assistant" && list[i].thinking) {
          msg = list[i];
          break;
        }
      }
    }
    return msg ? deriveThinkingMs(msg) : undefined;
  });
```

- [ ] **Step 3: Import `deriveThinkingMs`**

Near the top of `WorkspaceComposerSheet.tsx`, find:

```tsx
import { ComposerThinking } from "./ComposerThinking";
```

Add directly below it:

```tsx
import { deriveThinkingMs } from "@/lib/thinking";
```

- [ ] **Step 4: Update the `<ComposerThinking>` call site**

Find:

```tsx
                <ComposerThinking
                  isGenerating={isGenerating}
                  phase={generatingPhase}
                  thinking={thinking}
                  statusReady={t("composer.status.ready")}
                  thinkingLabel={t("composer.status.thinking")}
                  writingLabel={t("composer.status.writing")}
                  rtl={rtl}
                />
```

Replace with:

```tsx
                <ComposerThinking
                  isGenerating={isGenerating}
                  reasoning={isGenerating && generatingPhase === "thinking"}
                  thinking={thinking}
                  durationMs={thinkingMs}
                  statusReady={t("composer.status.ready")}
                  rtl={rtl}
                />
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors. `generatingPhase` is still used (in the `reasoning` prop), so no cleanup is needed there.

- [ ] **Step 6: Commit**

```bash
git add components/workspace/ComposerThinking.tsx components/workspace/WorkspaceComposerSheet.tsx
git commit -m "feat(thinking): workspace composer uses ThinkingTrace + reviewable chip"
```

---

## Task 9: Manual device verification

No automated RN view test exists in this repo; verify on a real device (the Word-fidelity/reasoning flows don't fully work in the simulator per project notes).

**Files:** none (verification only).

- [ ] **Step 1: Launch the app**

Run: `npm run ios` (or use the `run` skill / a dev build on a physical device).
Expected: app builds and boots to the thesis list.

- [ ] **Step 2: Chat tab — live + collapse**

Open the Chat tab, send a prompt that triggers reasoning. Observe:
- A spinning ✻ + "Thinking…" (brand color) appears; if you tap the row it expands to dim italic lines with a top fade.
- When the answer starts, the header collapses to "Thought for Xs" (muted) above the answer, with a hairline divider.
- Tapping it re-expands the full reasoning (scrollable, selectable).

- [ ] **Step 3: Workspace composer — live + reviewable chip**

Open a thesis → workspace → the AI composer sheet. Send a reasoning prompt. Observe:
- The live window streams line-by-line inside the sheet (no gesture fighting when you drag the sheet).
- When the turn ends, it collapses to a "Thought for Xs" chip that **stays** and re-expands on tap.
- Starting a new turn re-opens the live window.

- [ ] **Step 4: Edge cases**

- Trigger a non-reasoning turn (or a model with no `[[MODK_THINK]]`): the chat bubble shows no thinking block; the composer shows the plain "Ready…" status line.
- Tap Stop mid-reasoning: the chip still shows "Thought for Xs" over the partial reasoning.
- Open an RTL (Arabic) thesis: the header label/glyph mirror correctly; the reasoning body stays LTR and readable.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "fix(thinking): device-verification adjustments"
```

(Skip if no changes were required.)

---

## Self-Review Notes

- **Spec coverage:** shared component (Tasks 6–8) ✓; Style-B live look (Task 6) ✓; collapse to "Thought for Xs" (Tasks 3–4 duration, Task 6 render) ✓; both surfaces (Tasks 7–8) ✓; composer keeps previous chip (Task 8 selectors + auto-collapse effect) ✓; LTR body in RTL (Task 6, no RTL applied to `line`) ✓; edge cases (Task 9 Step 4) ✓; helper unit checks (Task 1) ✓; i18n en/fr/ar (Task 5) ✓.
- **Type consistency:** `deriveThinkingMs` / `windowLines` / `formatThinkingDuration` (Task 1) are used with matching signatures in Tasks 6–8; `markThinkingEnded(thesisId, id)` defined in Task 3 and called identically in Task 4; `thinkingStartedAt`/`thinkingEndedAt` names consistent across Tasks 2–4.
- **No placeholders:** every code step contains full content.
```
