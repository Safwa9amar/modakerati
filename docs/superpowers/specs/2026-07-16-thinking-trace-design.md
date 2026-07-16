# ThinkingTrace — Claude-style reasoning display

**Date:** 2026-07-16
**Branch context:** `feat/thesis-hierarchy-p0`
**Status:** Approved design, ready for implementation planning

## Problem

The AI's reasoning ("thinking") is shown two different, inconsistent ways:

- **Workspace composer** (`components/workspace/ComposerThinking.tsx`) — a spinner + an
  uppercase `THINKING…` label + the whole raw reasoning dumped into a 140px scroll box.
  When the turn ends the box reverts to a one-line idle status, so **all the reasoning
  vanishes and can never be reviewed**.
- **Chat tab** (`app/(tabs)/chat.tsx`) — a per-message collapsible "Thinking" toggle
  (Sparkles + label + live dots + chevron) that dumps the full reasoning as static text.
  No streaming animation, no "Thought for Xs" duration.

Goal: one polished, shared reasoning display that looks like Claude Code — used identically
on both surfaces — where completed reasoning collapses to a reviewable "Thought for Xs" chip.

## Decisions (locked)

1. **Scope:** both surfaces, via one shared component.
2. **After a turn finishes:** live stream collapses to a compact, tappable "Thought for Xs"
   chip that stays and re-expands to the full reasoning.
3. **Live look:** Style B "Claude-Code" — dim italic lines, left accent rail, a spinning ✻
   glyph, line-by-line reveal (newest line bright, older lines dimmed), top gradient fade.
4. **Architecture:** Approach 1 — a single presentational `<ThinkingTrace>` component plus
   store-tracked duration. (Rejected: shared-helpers-two-shells, which drifts; composer-only,
   which leaves the chat tab inconsistent.)
5. **Composer keeps the previous turn's chip** visible until the next turn starts.
6. **Reasoning body stays LTR** even in Arabic theses (it's the model's English scratchpad).

## Architecture

### Component: `components/ThinkingTrace.tsx`

Self-contained, presentational, no store access. Props:

```ts
interface ThinkingTraceProps {
  text: string;           // accumulated reasoning
  streaming: boolean;     // still thinking this turn
  durationMs?: number;    // once known → "Thought for Xs"
  defaultOpen?: boolean;  // composer live = true; chat = false
  dividerBelow?: boolean; // hairline separator when an answer follows (chat bubble)
  rtl?: boolean;
  ScrollComponent?: React.ComponentType<any>; // sheet injects BottomSheetScrollView
}
```

**Render states:**

| State | Condition | UI |
|-------|-----------|-----|
| Empty | `!text && !streaming` | renders `null` |
| Live | `streaming` | spinning ✻ + "Thinking…" (brand) + chevron; body = last ~6 lines of `text` (split on `\n`), newest bright / older dimmed, italic monospace, left accent rail, capped ~110px with a top gradient fade. **No inner ScrollView** — windowed slice only. |
| Done + collapsed | `!streaming && text` (default) | static muted ✻ + "Thought for {d}" + `›`; body hidden |
| Done + expanded | user tapped open | "Thought for {d}" + up-chevron; full `text` in `ScrollComponent`, capped ~220px, `selectable` |

Tapping the header toggles collapse in any state (the live stream can be folded mid-think).

**Why no inner scroll while streaming:** the composer mounts inside a gorhom bottom sheet;
a nested RN `ScrollView` fights the sheet's pan gestures. Windowing to the last N lines gives
the auto-scroll feel without a scroll container. A real scroll is only needed for the
expanded/done review, where the parent injects `BottomSheetScrollView` (sheet) or `ScrollView`
(chat).

### Pure helpers: `lib/thinking.ts`

Extracted for unit testing:

- `deriveThinkingMs(msg): number | undefined` — `end − start` when both timestamps exist, else
  `undefined`.
- `windowLines(text: string, n: number): string[]` — split on `\n`, drop empties, return the
  last `n`.
- `formatThinkingDuration(ms: number): string` — `< 1000` → `"1s"`; `< 60_000` →
  `"{s}s"`; else `"{m}m {s}s"`.

### Duration tracking (store + types)

`types/chat.ts` — add to `ChatMessage`:

```ts
thinkingStartedAt?: string; // ISO, set on first thinking chunk
thinkingEndedAt?: string;   // ISO, set when writing begins or the turn ends
```

`stores/chat-store.ts`:

- `appendToThinking` — set `thinkingStartedAt` on the first thinking chunk (if unset).
- New `markThinkingEnded(thesisId, id)` — idempotently set `thinkingEndedAt` (only if
  `thinkingStartedAt` is set and end is unset).

`lib/ai-service.ts` (`runAssistantTurn`):

- In the `onDelta` first-chunk branch (phase → "writing"), call `markThinkingEnded` — the
  thinking→writing boundary.
- In the `finally` block, call `markThinkingEnded` when `assistantId` exists — covers
  tool-only turns (no content delta) and user aborts.

Timestamps are plain message fields, so they ride along with `message.thinking` through
`persistCache`; the chip survives a reload if the cached reasoning does (non-blocking).

### Surface wiring

**Chat tab** — `app/(tabs)/chat.tsx` `Bubble`, replace the inline block at lines 108–119:

```tsx
{!isUser && item.thinking ? (
  <ThinkingTrace
    text={item.thinking}
    streaming={thinkingActive}
    durationMs={deriveThinkingMs(item)}
    dividerBelow={hasContent}
    rtl={dir === "rtl"}
    ScrollComponent={ScrollView}
  />
) : null}
```

Remove the now-dead `thinkOpen` state, the `thinkWrap`/`thinkHeader`/`thinkLabel`/`thinkText`
styles, and any imports left unused (e.g. `ThinkingDots`, `Sparkles`, chevrons) if not
referenced elsewhere.

**Composer** — `components/workspace/ComposerThinking.tsx`:

- Renders `<ThinkingTrace>` instead of the bespoke box.
- Live turn → `streaming`, `defaultOpen`, `ScrollComponent={BottomSheetScrollView}`.
- Idle **with** a last-turn reasoning → collapsed "Thought for Xs" chip (reviewable) until the
  next turn.
- Idle **without** reasoning → the existing one-line "ready" status.

`components/workspace/WorkspaceComposerSheet.tsx` — pass the **last assistant message's**
`thinking` + `durationMs` (not only the live-streaming one), so the composer can show the chip
after the turn ends. Currently it selects thinking by `streamingId`, which is `null` when idle.

### RN specifics

- **Top fade:** reuse the `FadeOverlay` / `expo-linear-gradient` pattern from chat.tsx,
  oriented top→down from `bgCard` (#1C1C2E) to transparent over ~24px.
- **Spinning ✻:** Reanimated `withRepeat(withTiming(360, 1200ms, linear))` rotating a Lucide
  `Asterisk`; static muted `Asterisk` when done. (Reanimated is already used by the outline
  reorderables.)
- **Colors (dark):** brand `#5C6BFF` / light `#7A8CFF` for the live label + glyph; body text
  `textSecondary` `#9999AE` (newest line full, older ~0.45 opacity); accent rail `#5C6BFF`.
- **i18n:** add `chat.thinkingEllipsis` ("Thinking…") and `chat.thoughtFor` (`"Thought for
  {{d}}"`) to en/fr/ar.

## Edge cases

- **Non-reasoning turn** (no `[[MODK_THINK]]`) — `text` empty, no start stamp → component
  renders nothing (chat) / status line (composer).
- **Abort mid-think** — `finally` stamps end → chip shows "Thought for Xs" over the partial
  reasoning.
- **Reasoning without newlines** — windows as one long wrapping line; still faded + italic.
- **Sub-second thinking** — floored to `"1s"`.

## Testing

- **Unit** (`lib/thinking.ts`): `deriveThinkingMs` (both / one / neither timestamp),
  `windowLines` (fewer than n, more than n, empties), `formatThinkingDuration`
  (`<1s`→`1s`, `59s`, `1m 4s`).
- **Manual device pass:** trigger a reasoning turn in **both** the workspace composer and the
  chat tab → verify live stream → auto-collapse to "Thought for Xs" → re-expand; plus an RTL
  thesis and a mid-think abort.

## Files touched

| File | Change |
|------|--------|
| `components/ThinkingTrace.tsx` | **new** — the shared widget |
| `lib/thinking.ts` | **new** — pure helpers |
| `types/chat.ts` | +2 timestamp fields on `ChatMessage` |
| `stores/chat-store.ts` | stamp start in `appendToThinking`; add `markThinkingEnded` |
| `lib/ai-service.ts` | call `markThinkingEnded` at writing-start + `finally` |
| `app/(tabs)/chat.tsx` | `Bubble` uses `ThinkingTrace`; remove dead state/styles |
| `components/workspace/ComposerThinking.tsx` | rewrite over `ThinkingTrace` + collapsed-after-done |
| `components/workspace/WorkspaceComposerSheet.tsx` | pass last-message thinking + duration |
| i18n en/fr/ar | `chat.thinkingEllipsis`, `chat.thoughtFor` |

## Out of scope

- Server-side persistence of reasoning (still ephemeral per the `ChatMessage.thinking` note).
- Streaming the reasoning as structured events instead of a raw `[[MODK_THINK]]` text stream.
- Changing which models emit reasoning or the `[[MODK_THINK]]` protocol.
