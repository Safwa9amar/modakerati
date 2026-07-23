# AI Inline Autocomplete (Ghost Text) for the Lexical Writer — Design

**Date:** 2026-07-23
**Branch:** `spike/lexical-bubble` (Lexical writer spike)
**Status:** Design approved — pending implementation plan

## Summary

As the student types prose in a text block of the Lexical thesis writer, the app
predicts the continuation and shows it as **grey ghost text right after the
caret** (Gmail Smart Compose / Copilot style). The student **taps the ghost text**
(or swipes in the writing direction) to accept, or **keeps typing / moves the
caret** to dismiss. Completions are **document-aware and RAG-grounded** — the
model sees the surrounding document, the heading chain, thesis metadata, and the
most relevant thesis sources / norm chunks — so suggestions fit the argument and
the section rather than being generic filler. A **Settings toggle** turns the
feature on and off.

This reuses the existing Lexical DOM-editor bridge, the streaming-suggestion
plumbing (`lib/thesis-suggest.ts`), the per-thesis RAG retrieval, and the durable
op queue. Ghost text is **never part of the saved document** until accepted.

## Goals

- Inline, streamed, document-aware completions while typing in text blocks.
- Grounded in the thesis (nearby blocks + heading chain + metadata) and, where it
  helps, in RAG (thesis sources + norm/exemplar chunks).
- Feel near-instant: fast model, lean RAG, streaming, hard abort on every
  keystroke.
- Accept with a discoverable touch gesture (tap the ghost); swipe as a shortcut.
- User-controllable via a persisted Settings toggle.
- No new sync path: an accepted completion is an ordinary `editText` op that
  flows through the durable queue and undoes like normal typing.

## Non-goals (deferred — YAGNI for v1)

- Word-by-word / partial accept.
- Mid-block (mid-paragraph) completion — v1 completes at **end of block** only.
- Empty-block "sentence starter" suggestions (require some content to ground on).
- An in-toolbar / dock quick toggle — Settings only for v1.
- Multiple alternative completions to choose between.

## UX decisions (validated in brainstorming)

- **Presentation:** inline ghost text (option A), chosen over a keyboard
  prediction bar and over a ghost+explicit-pill hybrid.
- **Accept:** primary = **tap the ghost text** (most discoverable). Secondary =
  **swipe in the writing direction** (left, for RTL) as a power-user shortcut.
- **Dismiss:** any real keystroke, caret move, selection, blur, or block change.

## Architecture

Responsibility split follows the existing DOM-component contract (serializable
props native→web; async function props web→native):

- **Web side (Lexical DOM editor)** owns *detection* (accurate caret/selection
  state) and *rendering* (the ghost node, accept/dismiss interactions).
- **Native side (RN store)** owns the *network* (abortable streaming fetch), the
  *Settings gate*, *context assembly*, and committing the accepted text through
  the *op queue*.
- **Server (Hono)** owns *RAG retrieval* and the *fast model* call, streaming the
  continuation back.

### Data flow

1. **Detect (web):** on editor update, if the selection is collapsed at the end
   of a text block, content exists, and no other proposal is showing, the
   `CompletionPlugin` starts/resets a **~600 ms debounce**.
2. **Request (web→native):** on debounce fire, the plugin calls the async prop
   `onRequestCompletion(ctx)` with the current block index and the block's text.
3. **Gate + context (native):** `completion-store` checks the Settings toggle,
   builds the context payload (nearby blocks + heading chain + thesis metadata),
   and starts an **abortable** `proposeCompletionStream()`.
4. **Server:** `POST /api/thesis/:id/complete/stream` runs RAG (top 2–3 chunks),
   prompts a **fast model** for a ≤1-sentence same-language continuation, and
   streams the tokens.
5. **Stream back (native→web):** native pushes deltas into the `completion` prop
   `{ text, nonce, status }`; the plugin renders them into the **GhostCompletionNode**
   after the caret, streaming in.
6. **Resolve (web):**
   - **Accept** (tap ghost / swipe) → plugin merges the ghost into the real text,
     calls `onCommitCompletion(blockIndex, fullText)`.
   - **Dismiss** (keystroke / caret move / blur / block change) → plugin removes
     the ghost node and calls `onCancelCompletion()`.
7. **Commit (native):** accept sets the block's text to `existing + completion`
   and enqueues an **`editText` op** (coalesces with typing; syncs + undoes for
   free).

## Components

### 1. `GhostCompletionNode` (web — `components/workspace/lexical/blockLexical.tsx`)

- A `TextNode` subclass rendered with the grey ghost style (`.lx-ghost`).
- **Excluded from the document model:** `$lexicalToBlocks` skips it;
  `exportJSON`/`exportDOM` produce nothing meaningful; the node is unmergeable and
  ignored by history/undo (mirrors how `SuggestionNode` / `RangeSuggestionNode`
  are handled). It must never survive into a serialized block.
- Inserted directly after the caret's text node so bidi/RTL layout is automatic.

### 2. `CompletionPlugin` (web — `components/workspace/lexical/LexicalDomEditor.tsx`)

- Registers an update listener; detects **collapsed-at-end-of-text-block** with
  content, debounces ~600 ms, and fires `onRequestCompletion`.
- Suppressed when `completionEnabled` is false, when a selection is active, or
  when a `suggestion` / `rangeSuggestion` / `tableProposal` is present.
- Renders/streams the ghost node from the `completion` prop.
- Handles accept (tap on the ghost element; swipe in the writing direction) and
  dismiss (any editor mutation that isn't the ghost stream, caret move, blur).
- On accept: merges ghost text into the real node inside a tagged update
  (`SKIP_DOM_SELECTION_TAG`, scroll-pinned) and calls `onCommitCompletion`.
- Guarantees only one ghost exists at a time; clears on unmount.

### 3. New `LexicalDomEditor` props

```ts
// gate — from the persisted settings-store
completionEnabled?: boolean;
// web → native: request a completion for a block (async fn prop)
onRequestCompletion?: (ctx: { index: number; text: string }) => void;
// native → web: streamed completion for the pending request
completion?: { text: string; nonce: number; status: "loading" | "done" | "error" };
// web → native: accept / dismiss
onCommitCompletion?: (index: number, fullText: string) => void;
onCancelCompletion?: () => void;
```

### 4. `stores/completion-store.ts` (native)

- Mirrors `suggestion-store` / `table-suggestion-store`.
- State: pending request (index, nonce), streamed `text`, `status`, `AbortController`.
- `request(ctx)`: gate on settings → assemble context → stream → push deltas to
  the editor via the `completion` prop.
- `accept(index, fullText)`: enqueue an `editText` op (via the existing durable
  op path) and clear pending state.
- `cancel()`: abort the fetch and clear.
- Context assembly: current block + preceding blocks (~1–1.5 k chars) + light
  look-ahead + nearest heading chain + thesis metadata (title, discipline,
  language). Language is detected from content per the RTL-detection convention
  (thesis.language is unreliable).

### 5. `lib/thesis-suggest.ts` — `proposeCompletionStream()`

- New streaming client mirroring `proposeBlockEditStream`, minus the THINK/action
  framing (completion is answer-only). Uses `expo/fetch`, the emoji `\uXXXX`
  unescape, and the chunk-boundary hold logic already in the file.
- Signature: `(thesisId, index, context, handlers: { onDelta }, signal)`.

### 6. Server — `POST /api/thesis/:id/complete/stream`

- Mirrors `paragraphs/:index/suggest/stream` in the modakerati-server routes.
- Body: `{ index, before, contextBlocks, headingChain, meta }`.
- Runs the existing per-thesis RAG retrieval (top **2–3** source/norm chunks),
  keeps context lean, and streams a fast-model completion.
- Prompt intent: *continue the text naturally in the same language and register;
  output ONLY the continuation (≤ 1 sentence, ~25 words); never repeat existing
  text; return empty if there is nothing useful to add.*
- **Model:** a fast/cheap model (not the heavy chat model), env-configurable like
  the other AI features; reuse the AI prompt-caching breakpoints for the stable
  document prefix.
- Emoji-safe ASCII/`\uXXXX` streaming per the RN fetch convention.

### 7. Settings toggle

- Add `autocompleteEnabled: boolean` (**default `true`**) to the persisted
  `stores/settings-store.ts`.
- Add a toggle row in `app/(app)/settings.tsx` labelled trilingually (ar/fr/en),
  e.g. "AI text completion" / "الإكمال التلقائي بالذكاء الاصطناعي" / "Complétion
  automatique par IA".
- Off ⇒ `completionEnabled` is false ⇒ the plugin never triggers (no fetches, no
  ghost).

## Error handling & edge cases

- **Latency (primary risk):** fast model + lean RAG (2–3) + streaming + ≤1-sentence
  cap + 600 ms debounce + hard abort on every keystroke + prompt caching. Fallback
  if device latency disappoints: drop RAG from the hot path (doc-context only) and
  keep RAG for an on-demand "expand" — attempt the full version first.
- **Race / stale streams:** every request carries a `nonce`; deltas for a
  superseded nonce are ignored; a new trigger aborts the previous fetch.
- **Other proposals active:** completion is suppressed while a suggestion / range
  / table proposal is showing.
- **Server error / empty completion:** status `error` / empty ⇒ no ghost, silent
  (autocomplete must never interrupt typing).
- **IME / fast typing:** debounce + abort absorb bursts; ghost only appears on a
  genuine pause.
- **RTL/LTR & bidi:** handled automatically because the ghost is a real in-flow
  text node under `dir="auto"` content.
- **Op-queue integrity:** accept is a positional-safe `editText` on the same
  index — no new positional hazard; coalesces with debounced typing.

## Verification

- App: `npx tsc --noEmit` (the app has no JS test runner) + on-device QA in the
  Lexical Lab and the workspace writer (device QA is the real gate for WebView +
  RTL behavior).
- Server: build + a manual `curl` of `/complete/stream` to confirm streaming and
  emoji-safety.
- Toggle: verify off ⇒ zero completion fetches.

## Open tuning knobs (safe to adjust during implementation)

- Debounce (start 600 ms), completion length cap (~25 words / 1 sentence),
  preceding-context size (~1–1.5 k chars), RAG top-k (2–3), and the exact fast
  model id (env-configurable).
