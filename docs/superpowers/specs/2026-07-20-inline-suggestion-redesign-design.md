# Inline AI Suggestion Redesign — In-Place Suggestion with Peeking Original

**Date:** 2026-07-20
**Status:** Approved (brainstormed with visual companion; user selected the in-place direction, fold-out original, peeking-first-line trigger with diff-on-expand)

## Problem

The current inline suggestion card ([components/workspace/InlineSuggestion.tsx](../../../components/workspace/InlineSuggestion.tsx)) has six confirmed UX problems (all validated by the user):

1. **No visible diff** — the original is a struck-through blob above the proposal; you must read both texts fully to find the changes.
2. **Weak action hierarchy** — four equal-width buttons; Approve doesn't dominate; long fr/ar labels truncate.
3. **Thinking trace clashes** — the reasoning trace renders on a dark theme card (`bgCard`) floating on the white document paper.
4. **Heavy card** — trace card + struck original + proposal + button row ≈ half a screen per suggestion; pushes the document around.
5. **"Edit" is destructive-by-surprise** — it *applies* the suggestion, then opens the block editor. There is no way to tweak the proposal before it touches the document (the store's `setProposed` is never used by the UI).
6. **No instruction reminder** — the card never shows what the user asked for.

## Approved design (one paragraph)

The suggestion is rendered **in place of the block's text**: the proposed rewrite *is* the paragraph, marked by a green logical-start edge bar and one small header chip carrying the instruction + a «💭 Xs» expandable thinking trace. The **original's first line always peeks below** the paragraph under a fade gradient (no button, no label); tapping it unfolds the full original with **removed words struck in red** while the **added words in the new text flash green** in sync — tap again to collapse. Actions live in a **floating pill**: a dominant solid-green Approve (labeled), and Edit / Again / Reject as icon buttons. Edit turns the proposal into an in-place text input **before anything touches the document**. Approve morphs the pill into a ✓ as the review chrome melts away and the text simply becomes the document; Reject fades back to the original block. All motion is spring-based Reanimated, RTL-aware, localized en/fr/ar.

## Architecture

### New: `lib/word-diff.ts`

Pure TS word-level diff used by the expanded comparison view.

- `diffWords(oldText: string, newText: string): DiffSegment[]` where `DiffSegment = { text: string; kind: "same" | "del" | "add" }`.
- Tokenize on whitespace (word-safe for Arabic — letters join only within words), LCS over tokens, merge adjacent segments of the same kind, preserve single spaces on join.
- **Perf cap:** if either side exceeds 400 tokens, return two segments (`del` = old, `add` = new) — the UI then shows the plain dimmed original without word marks. LCS is O(n·m); the cap keeps worst case ~160k cells, fine on the UI thread off-render (memoized).
- No new dependencies.

### Rebuilt: `components/workspace/InlineSuggestion.tsx`

Renders **instead of** `DocBlock` for the block under review (today it renders *below* it).

Integration in [OutlineReorderable.tsx](../../../components/workspace/OutlineReorderable.tsx) `Row`:

```tsx
{hasSuggestion ? (
  <InlineSuggestion thesisId={thesisId} block={block} rtl={rtl} />
) : (
  <DocBlock ... />
)}
```

- `hasSuggestion` selector already exists (boolean primitive — keeps the zustand `Object.is` rule).
- While a suggestion is pending, the block is "in review": drag, tap-select and the toolbar pill are intentionally unavailable for that block (the pill suppression already exists).
- Suggestions are only ever requested for text paragraphs (figures/tables use the tool flow), so replacing `DocBlock` loses no figure/table rendering.
- The proposed text must render in the **document's typography** (same family/size/line-height/alignment `DocBlock` uses for paragraph text) so it reads as the document, not as UI. Extract/export the paragraph text style from `DocBlock` rather than duplicating values.
- Text direction follows the **content** (`rtl` prop, as today); chrome rows follow the **app language** (`I18nManager.isRTL`). The green edge bar sits at the paragraph's logical start (right for RTL content, left for LTR).
- The suggestion surface sits on the white paper: all inks are the FIXED on-white constants (existing pattern in this file), never theme `textPrimary`.

### Component states

**1. Thinking (`status === "loading"`)**

- Header chip: `✦ <instruction>` (numberOfLines 1, ellipsized) + a live «💭 Xs» timer once reasoning tokens stream.
- Paragraph area: the original text dimmed to ~35% opacity with a looping shimmer sweep (Reanimated `withRepeat` translating a soft gradient overlay). Reads as "this paragraph is being rewritten".
- Tapping the chip (once reasoning exists) expands the **thinking trace** inline on a light on-paper slip (white/paper surface, dark ink) — reuse `ThinkingTrace` with `surfaceColor` set to the paper color; the dark `bgCard` trace card is removed entirely.
- No action pill while loading (nothing to approve yet). In-flight abort stays as today (reject drops the key; `isMine` guards stale streams).

**2. Ready (`status === "ready"`)**

- Header chip: `✦ <instruction> · 💭 Xs` — tap toggles the trace slip (collapsed by default; self-hides when no reasoning).
- Paragraph: the **proposed text** in doc typography + green edge bar (fixed on-white constant `#22C07A`, 3px, rounded).
- **Peek teaser** directly below: the original text clipped to one line-height (`maxHeight` = the slip's computed line-height, ≈26px) on a light gray slip with a bottom fade gradient. Always visible — it *is* the affordance. `accessibilityRole="button"`, label "Show original text" (localized).
  - **Expanded:** the slip springs open to the full original; removed words (`kind === "del"`) get red-tinted strikethrough marks; simultaneously the added words in the proposed paragraph above flash a soft green highlight (~700ms, staggered ≤3 groups) then settle. Tap again to collapse.
  - Diff segments come from `diffWords(original, proposed)`, memoized per suggestion.
- **Floating action pill** centered under the block (white, rounded-full, soft shadow):
  - `✓ <Approve label>` — solid `#0E7A46` fill, white ink, the only labeled action, visually dominant.
  - `✎` `↻` `✕` — icon-only, 44pt hit targets via `hitSlop`, `accessibilityLabel` = existing localized labels; Reject ink red, others dark.
  - Order follows the app language direction (Approve at the reading start).

**3. Edit-in-place (new, replaces approve-then-edit)**

- `✎` swaps the proposed paragraph for a multiline `TextInput` (same doc typography, autofocus, content direction) seeded with the proposal.
- The pill swaps to two actions: `✓ Done` (primary) and `✕ Cancel`.
- Done → `setProposed(index, text)` (already in the store), back to **Ready**. Cancel → back to Ready, proposal unchanged.
- **Nothing touches the document until Approve.** `useWorkspaceStore.setEditingBlock` is no longer called from here.
- Keyboard clearance is owned by the screen-level `KeyboardAvoidingView` (established pattern — no new keyboard handling here).

**4. Error (`status === "error"`)**

- One-line red slip on the paper (fixed on-white error ink + light red border) + `↻ Again` and `✕` in the pill. The block's original text renders normally above it (error state does NOT hide the document text): `InlineSuggestion` renders `sug.original` in doc typography, undimmed.

### Motion spec (Reanimated 4, springs; durations are ceilings)

| Moment | Animation |
|---|---|
| Suggestion arrives (loading→ready) | Shimmer fades out; proposed text `FadeInDown` spring; edge bar grows in; teaser slips in; pill pops (`ZoomIn` spring with slight overshoot) |
| Peek expand/collapse | Height spring on the slip (Reanimated `LinearTransition` on the row absorbs document reflow); gradient overlay fades out when open |
| Add-flash on expand | `withSequence` animated background color on added-word `<Text>` spans, staggered ≤3 groups |
| Approve | Call `approve()` immediately (data first). The suggestion surface unmounts with `exiting` fades (pill: spring `ZoomOut`); the returning `DocBlock` (already optimistically patched) plays a one-shot soft-green settle flash on its text (~600ms fade) — "the text became the document" |
| Reject | Whole suggestion surface `FadeOut` (~200ms); `DocBlock` returns with original text |
| Error | Slip `FadeInDown` small |
| Reduced motion | `useReducedMotion()` → replace springs/morphs with plain ≤150ms fades; shimmer becomes a static dimmed state with the timer chip as the only liveness signal |

### Store & data flow

- `suggestion-store.ts` keeps its API (`request`, `approve`, `reject`, `again`, `setProposed`); the approve-then-edit call pattern disappears with the UI.
- One addition for the approve settle flash: `justApplied: number | null` (block index), set by `approve`, cleared by `clearApplied()` which the flash animation calls when done. `Row`/`DocBlock` reads it via a boolean-primitive selector.
- Approve keeps routing through the durable op queue (`thesis-doc-store.mutate({ type: "editText" })`) — optimistic, offline-safe, unchanged.
- Local component state only: `peekOpen`, `editing`, `draft` (TextInput value). Nothing new persisted.

### i18n

Add to en/fr/ar: `suggestion.showOriginal` ("Show original text"), `suggestion.hideOriginal`, `suggestion.done`, `suggestion.cancel`. Existing keys (`approve`, `edit`, `again`, `reject`, `failed`) stay for accessibility labels.

## Error handling

- Empty/failed stream → error state (existing store logic, unchanged).
- Diff degenerate cases: identical texts → teaser still shows (original === proposal is already filtered by the store's empty-rewrite guard); oversized texts → capped diff (plain original, no word marks).
- Superseded/rejected in-flight requests: existing `isMine` guard, unchanged.

## Testing / verification

No JS test runner in this repo — gate with:

1. `npx tsc --noEmit` clean.
2. Manual device QA (Arabic RTL thesis + French LTR thesis):
   - request → thinking shimmer + live timer → ready transition
   - peek expand/collapse; word marks correct in Arabic; add-flash plays once
   - Edit → modify → Done → Approve applies the edited text (check via undo history)
   - Cancel restores the untouched proposal; Reject restores the original block
   - trace chip expands the reasoning on a light slip; no dark card anywhere
   - error path (airplane mode) shows slip + Again works
   - reduce-motion ON: no springs/shimmer, everything still reachable
3. Existing flows must still pass: block select/multi-select on non-review blocks, toolbar pill suppression, drag reorder.

## Out of scope

- Server / `proposeBlockEditStream` — unchanged.
- Suggestions in the Word (`WordDocxView`) and PDF views — outline-only, as today.
- Multi-suggestion pager/batch review (the "review bar" direction — possible later layer).
- Haptics (would need a new dependency; revisit if `expo-haptics` is ever added).
