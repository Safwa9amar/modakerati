# Suggestion Pill Motion — "Absorb Into the Text"

**Date:** 2026-07-20
**Status:** Approved (brainstormed with visual companion; user selected motion language A of 4)
**Extends:** `2026-07-20-inline-suggestion-redesign-design.md` (the pill this animates shipped there)

## Goal

Action-driven motion for the suggestion action pill in [components/workspace/InlineSuggestion.tsx](../../../components/workspace/InlineSuggestion.tsx): each tap produces a choreography that *explains* what happened, plus restored press feedback on every pill button.

## Device constraint (hard, discovered on-device 2026-07-20)

On this app's New-Arch iOS build, styles passed to `Pressable` via the `({pressed}) => [...]` function form can silently fail to apply. ALL motion in this spec therefore runs on plain `Animated.View`s (Reanimated shared values / entering / exiting), with press state driven by `onPressIn`/`onPressOut` events — never Pressable style-functions.

## Choreographies (springs; durations are ceilings)

1. **Approve (~280ms then commit):** press squish → a small green ✓ badge (solid `#0E7A46` circle, white check) springs from the Approve button upward into the paragraph while the pill sinks (`translateY` +12, scale 0.85, fade). At animation end → `hSuccess()` + `useSuggestionStore.approve()` — the component unmounts and the existing `SettleFlash` green flash plays as the "landing" of the ✓.
2. **Reject (~200ms then commit):** the pill tips (rotate ~6°) + drops (`translateY` +20) + fades → then `reject()`; the suggestion surface's existing exiting fade returns the original.
3. **Again (instant commit, morph presentation):** `again()` fires immediately (streaming should not wait). The pill exits with `ZoomOut`; the loading branch NEWLY renders a compact thinking capsule in the pill's position — white capsule, spinning `Sparkles` + `t("suggestion.thinking")`, entering `ZoomIn` — which lives for the whole re-run and pops back into the full pill when ready returns.
4. **Edit (crossfade):** the pill row gets its own entering/exiting (`FadeIn`/`FadeOut` ~120ms) so switching ready↔editing crossfades ONLY the actions (Approve/✎/↻/✕ ↔ Done/Cancel); the paragraph→TextInput swap stays as-is.
5. **Press feedback (every pill button, all states):** on press-in — scale to 0.93 + tint deepen (primary: `rgba(14,122,70,0.28)`; icon buttons: `rgba(60,70,84,0.10)` behind the icon) + `hSelection()` haptic; on press-out — spring back. One shared value per button instance, animated style on the inner `Animated.View`.

## Implementation shape

- All changes inside `InlineSuggestion.tsx`. No store changes, no new files, no new dependencies.
- `PillPrimary`/`PillIcon`: inner `View` → `Animated.View` with a press-driven animated style; `Pressable` gains `onPressIn`/`onPressOut` and stays visually bare.
- Ready branch gains local `leaving: null | "approve" | "reject"`:
  - set on tap → disables ALL pill presses (guard in handlers) → runs the choreography → `runOnJS` commits the store call at completion.
  - The flying ✓ is an absolutely-positioned `Animated.View` overlay in the ready-branch root; travel distance = measured root height via `onLayout` (from pill position to the paragraph area) — no hardcoded travel.
- **Reduce motion:** no choreography, no flying ✓, no press scaling (tint-only press feedback is fine) — store calls fire immediately (today's behavior).
- **Safety:** the delayed commit means an app kill inside the ~280ms window loses the approve; accepted (identical to not having tapped yet). Double-taps are guarded by `leaving`. If the animation-completion callback is somehow dropped (unmount race), a 400ms `setTimeout` fallback fires the same commit exactly once.

## Testing / verification

`npx tsc --noEmit` clean + device QA: each of the five choreographies on the Arabic thesis; approve lands into the settle flash; Again's capsule persists through streaming; no double-commit on rapid double-tap; reduce-motion path instant; error-state pill still works (press feedback only — no new choreography there).

## Out of scope

Error-state choreography beyond press feedback; teaser/trace motion changes; any store or DocBlock changes.
