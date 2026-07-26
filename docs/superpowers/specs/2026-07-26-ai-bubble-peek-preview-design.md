# AI Bubble Peek/Preview (Messenger-style) — Design

**Date:** 2026-07-26
**Status:** Approved (visual-companion round + terminal Q&A)
**Builds on:** [always-on AI bubble + dock](2026-07-20-ai-bubble-dock-design.md), [floating draggable pill](2026-07-20-floating-draggable-pill-design.md)

## Problem

When a plain chat ask is fired from the ✦ AIDock bubble (whole-memoir or
multi-block scope, or a quick-action chip), `AIDock.sendPrompt` collapses the
dock back to the small ✦ circle immediately and the request runs in the
background. Today the only feedback is the existing spin (`busy` in
`FloatingPill`) while `isGenerating` is true — the actual answer text is never
surfaced anywhere in the workspace. It silently lands in the per-thesis chat
history, visible only by separately opening the Chat tab. The user has no way
to tell what happened, or to read the reply, without leaving the document.

## Locked decisions (user)

- **Scope:** the workspace ✦ bubble only (`FloatingPill`/`AIDock`). No
  cross-screen or cross-app persistence — if the user leaves the workspace
  screen, the indicator is gone, matching `FloatingPill`'s existing lifecycle
  (it unmounts with the workspace screen today).
- **Applies only to the plain chat-loop path** in `AIDock.sendPrompt` — the
  final branch that calls `sendMessageToAI` (whole-memoir asks, multi-block
  asks that aren't a Lexical range rewrite, and the fixed quick-action chips).
  Single paragraph/image/table asks and multi-block range rewrites already get
  their own in-place review UI (suggestion store / table-suggestion store /
  range store) — untouched, no peek for those.
- **Not ✦-icon-specific.** The collapsed `Bubble` in `FloatingPill` can show
  either the ✦ icon (no selection) or a block-kind icon (an active multi-block
  selection whose "Ask…" was routed through `AIDock` via `inputOpen`, per
  `FloatingPill.tsx`'s `count === 0 || inputOpen` branch). A plain multi-block
  ask falls through to the same `sendMessageToAI` branch as a whole-memoir ask,
  so `PeekCard` attaches to whichever collapsed `Bubble` is currently rendered
  — it does not require the bubble to be in its ✦/no-selection mode.
- **The AI-gate is untouched.** `pendingAsk`/`pendingConfirm` already force
  `BlockComposer`'s `Dock` open regardless of bubble state
  (`components/workspace/BlockComposer.tsx:114`) — that's a separate,
  already-working hard-interrupt path, out of scope here.
- **Visual style:** a Messenger "chat-heads" tail-bubble card above the ✦
  circle — chosen in the visual-companion round over a side capsule and a
  dot-only badge.
- **Persistence:** once a reply finishes, the card **stays** in its "unread"
  look until the user opens it. No auto-fade timer.
- **Reveal target:** tapping the card (or the bubble, while a reply is
  unread) opens the same full-thread panel `ChatHead.tsx` already defines —
  `ThesisChat` (from `app/(tabs)/chat.tsx`) with `variant="overlay"`, backdrop
  + zoom-in card — driven through the existing `useChatHead` store
  (`open()`/`expanded`/`close()`; its own doc comment already says "any screen
  can open/close it"). `ChatHead.tsx`'s draggable logo bubble and the
  Android system-overlay module stay disabled/unmounted at the root exactly as
  today — only the panel + store are reused, not the bubble.

## Lifecycle / state model

New field on `stores/floating-pill-store.ts`:

- `awaitingReply: boolean` (+ `setAwaitingReply`), default `false`. `hide()`
  and `reset()` clear it alongside the fields they already reset.

**Set:** in `AIDock.sendPrompt`'s final branch (the plain `sendMessageToAI`
call — the one case not already handled by the suggestion/table/range
stores), right next to the existing `pill.setExpanded(false)`, also call
`pill.setAwaitingReply(true)`.

**Clear:** only by the reveal action below (tapping the card, or tapping the
bubble while a reply is unread). Not cleared by any other interaction —
specifically not by drag-to-X dismiss (see Edge cases).

The card's content is derived live on every render from existing
`useChatStore` state — no copy of the message text is duplicated into
`floating-pill-store`:

- `isGenerating` + `generatingPhase` (`"thinking" | "writing" | "idle"`)
- `streamingId` + `messages[thesisId]` → the live or last assistant message

Card state machine (all conditioned on `awaitingReply === true`; the card is
unmounted entirely when `false`):

1. `generatingPhase === "thinking"` → label "Thinking" + a 3-dot pulse, no
   content. Raw reasoning tokens (`appendToThinking`) are intentionally never
   shown here — internal chain-of-thought, not user-facing prose.
2. `generatingPhase === "writing"` → a live truncated preview (~2 lines, ~80
   chars) of `messages[thesisId].find(m => m.id === streamingId)?.content`,
   updating on every `appendToMessage` tick.
3. `!isGenerating` (turn finished) → the "done/unread" visual variant, with a
   truncated snippet of the last assistant message in `messages[thesisId]`.
   Persists with no timer, per the locked decision above.

## Components

- `components/workspace/PeekCard.tsx` (new) — the tail-bubble card. Mounted
  by `FloatingPill` beside/above the collapsed `Bubble`, only while
  `awaitingReply`. Owns:
  - Anchor math: sits above the bubble by default, flips below when too
    close to `insets.top`; mirrors horizontally in RTL; clamped so it never
    runs off either screen edge — reuses the same `minX/maxX/minY/maxY`
    `FloatingPill` already computes for the pill itself (passed down, not
    recomputed).
  - The pulse-dot / shimmer animation for the "thinking" state (Reanimated,
    matching the existing `ShimmerBar` pattern in `AIDock.tsx`).
  - A tap handler that fires the reveal action below. No pan gesture of its
    own — the bubble's existing drag gesture keeps working underneath it,
    untouched.
- `components/ChatOverlayPanel.tsx` (new) — extracted from `ChatHead.tsx`'s
  existing expanded-panel JSX (backdrop + zoom-in card wrapping
  `<ThesisChat variant="overlay" onClose={...} />`), gated on
  `useChatHead((s) => s.expanded)`. `ChatHead.tsx` is refactored to render
  this shared component instead of its inline JSX (no behavior change there —
  it's still unmounted at the root). `FloatingPill` renders the same
  component, gated the same way, so the reveal panel is pixel-identical to
  the (currently dormant) chat-head overlay and only has one implementation
  to maintain.
- `components/workspace/FloatingPill.tsx`: the `Bubble`'s `onPress` checks
  `awaitingReply` first — if true, fires the reveal action instead of
  `setExpanded(true)`. Once a reply is read, tapping the bubble reverts to
  today's normal "expand AIDock" behavior.
- `components/workspace/AIDock.tsx`: `sendPrompt`'s final branch sets
  `awaitingReply` as described above.

## Tap behavior

Reveal action (shared by the card's tap and the bubble's tap-while-unread):

1. `useChatHead.getState().open()`
2. `useFloatingPillStore.getState().setAwaitingReply(false)`
3. `useFloatingPillStore.getState().setExpanded(false)` (stays collapsed
   underneath the overlay, so closing the overlay lands back on the plain ✦
   bubble, not a re-opened dock)

## Edge cases (accepted trade-offs, no extra machinery)

- Firing a second prompt before the first reply is read just supersedes the
  snippet — `awaitingReply` stays true, content re-derives from whichever
  turn is now current. Nothing is lost; both turns are in the persisted
  thread either way.
- Drag-to-X dismiss while a reply is unread hides the whole pill as it does
  today (`pill.hide()`) — the peek disappears with it, but the message
  itself is safely in the persisted chat history, reachable from the Chat tab
  as always.
- Only one AI turn can run app-wide at a time (`isGenerating` is a single
  pre-existing global flag) — so there's never more than one pending peek to
  reconcile at once.

## Verification

No JS test runner in this app — `npx tsc --noEmit` after each file, plus
device/simulator QA (per project convention, this app is gated by type
checking + manual run, not a test suite):

- Fire a whole-memoir "Ask…" → dock collapses → thinking dots → live
  streaming snippet → a done/unread card that survives scrolling the doc but
  not leaving the workspace screen.
- Tap the card → the `ThesisChat` overlay opens showing the full exchange;
  closing it returns to the plain collapsed ✦ bubble with no residual peek.
- Tap the bare bubble (not the card) while unread → the same reveal fires
  instead of the AIDock.
- Fire a second ask before reading the first → snippet updates, no
  crash/duplicate cards.
- RTL layout: card mirrors and stays clamped on-screen; same check with the
  bubble parked near the top edge or a screen edge.
- Confirm single-paragraph/table/image/range asks are unaffected — no peek
  card appears for those; they still show their existing inline diff UI.
- Confirm `pendingAsk`/`pendingConfirm` still force the bottom composer open
  regardless of `awaitingReply` state (untouched code path).
