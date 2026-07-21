# Document Search (Find & Replace + Semantic) — Design

**Date:** 2026-07-21
**Status:** Approved, ready for implementation

## Summary

Add in-document search to the thesis workspace. Today the app has **no body-text
search at all** — only the outline drawer's heading-title filter and the ribbon's
tool search. This feature adds a single **top-pinned search panel** combining:

1. **Exact find & replace** — instant, offline, Arabic-aware, over the blocks
   already loaded in `thesis-doc-store`, with jump/highlight and replace via the
   existing durable op queue.
2. **Semantic search** — "search by meaning" in natural language, served by a new
   thin server route over the existing RAG index (`searchThesisBlocks` already
   returns block indices).

### Locked decisions (from brainstorming, chosen visually)

- **Experience:** combine A (Word-style find bar) + C (semantic search). One
  panel, **progressive**: one input; exact matches count live as you type;
  a **"✦ Search by meaning"** row is always one tap away (no mode toggle).
  Semantic is the natural escape hatch when exact shows `0/0`.
- **Replace:** in scope (Replace + Replace all), riding the op queue.
- **Views:** **Writer view only** (native `OutlineReorderable`). No docx-WebView
  or PDF highlighting in v1. Opening search implies/returns to Writer view.
- **Placement:** **top-pinned panel** sliding down under the workspace header,
  persistent until ✕ — independent of the keyboard (the GlobalDockBar dies with
  the keyboard, so search cannot live there). Semantic results drop down over
  the doc as an overlay list.
- **Entry points:** a new **🔍 chip on the GlobalDockBar** (while editing) **and**
  a **"Search" item in the header ⋯ menu** (while reading — the dock bar only
  exists when the keyboard is up).

## Architecture

### New: `stores/search-store.ts` (zustand)

State (all consumed via primitive selectors — see the selector-loop rule):

- `open: boolean`
- `query: string`, `replaceText: string`, `replaceOpen: boolean`
- `matches: { blockIndex: number; start: number; end: number }[]` — spans in the
  ORIGINAL block text (post offset-mapping), recomputed on query/doc change
  (debounced ~150 ms)
- `currentMatch: number` (index into `matches`, clamped on recompute)
- `semanticResults: { blockIndex: number; headingPath: string; snippet: string; score: number }[] | null`
- `semanticLoading: boolean`, `semanticError: string | null`
- Actions: `openSearch()`, `close()` (full reset), `setQuery`, `setReplaceText`,
  `next()` / `prev()` (jump via `requestScrollToBlock` + flash), `replaceCurrent()`,
  `replaceAll()`, `runSemantic()`.

### New: `components/workspace/SearchPanel.tsx`

The pinned panel, rendered in `app/(app)/thesis-workspace.tsx` directly under the
header row. Rows, top to bottom:

1. **Find row:** 🔍 icon, `TextInput`, live counter `n/total`, ↑ ↓ chevrons, ✕.
2. **Replace row** (collapsed behind a ⇄ toggle): `TextInput` +
   **Replace** / **All** buttons. Disabled when the current hit is not a
   paragraph block (table/caption hits are jump-only).
3. **Meaning row:** "✦ Search by meaning" — runs `runSemantic()`; shows a spinner
   while loading; disabled with a hint when offline.
4. **Semantic results list** (when results exist): snippet with heading path and
   score-ordered rows; tap → `requestScrollToBlock(blockIndex)` + flash.

While `open`, the header's auto-hide-on-scroll (from the header-cleanup work) is
suppressed so the panel stays anchored. If a preview mode (docx/PDF) is active
when search opens, the workspace switches back to Writer view.

### Touched: existing components

- **`components/workspace/GlobalDockBar.tsx`** — one new 🔍 chip (dock chip row,
  next to the nav group): dismisses the keyboard and calls `openSearch()`.
- **Header ⋯ menu** (`thesis-workspace.tsx`) — new "Search" item → `openSearch()`.
- **`components/workspace/DocBlock.tsx`** — when search is active AND this block
  has matches, paragraph text renders as segments with highlight spans (normal
  hits: soft tint; current hit: stronger tint). Store-gated so closed search costs
  zero renders. Jump target flash reuses the existing `flashBlock` mechanism.

### New: `lib/text-normalize.ts`

Extract the Arabic-aware `normalize()` from `ThesisOutlinePanel.tsx` (case fold +
tashkeel/tatweel strip + alef/ya/ta-marbuta variant folding) into a shared util,
extended with an **offset map**: `normalizeWithMap(text) → { norm, map }` where
`map[i]` = index in the original string of normalized char `i`. Matching runs on
`norm`; match spans convert back through `map` to original-text spans for
highlighting and replace. `ThesisOutlinePanel` switches to the shared util
(behavior unchanged).

## Exact find & replace mechanics

- **Corpus:** `useThesisDocStore.getState().byId[thesisId].blocks` — already in
  memory. Searchable text per kind: paragraph `text`, table `rows` flattened,
  image `caption`. (Same extraction pattern as `textOf` in GlobalDockBar.)
- **Matching:** normalized substring match (no regex in v1), all occurrences per
  block, ordered by `blockIndex` then `start`.
- **Navigation:** ↑↓ move `currentMatch` cyclically; each move calls
  `requestScrollToBlock(blockIndex)` — the exact mechanism outline taps use — and
  the block flash highlights on arrival.
- **Replace (paragraph blocks only):** splice `replaceText` into the ORIGINAL
  text at the current match span, then enqueue
  `{ type: "editText", index, text }` — the identical path as manual typing:
  optimistic, offline-queued, undoable via doc history, same formatting behavior
  as a typed edit. After replacing, matches recompute and `currentMatch` stays at
  the same position (next hit slides into place).
- **Replace all:** group matches by block, apply all splices per block
  right-to-left (so earlier spans stay valid), enqueue ONE `editText` per
  affected paragraph. Table/caption matches are skipped and reported in the
  completion toast ("Replaced 12 in 5 paragraphs · 2 non-editable hits skipped").
- **No table-cell replace in v1:** the op queue has no table-cell edit op;
  inventing one is out of scope.

## Semantic search

### New server route: `GET /api/thesis/:id/search?q=<query>&k=<topK>`

In `modakerati-server/src/routes/thesis.ts`:

1. Auth + thesis ownership check (same guard as sibling routes).
2. Run the same index-reconcile step chat RAG uses (hash-reconcile
   `thesis_block_chunks` before retrieval) so results track the latest synced doc.
3. Embed `q` via the embedding service.
4. `searchThesisBlocks(thesisId, embedding, k)` (existing, `lib/rag/retrieval.ts`)
   → respond `{ results: [{ blockIndex, headingPath, snippet, score }] }`
   (snippet = chunk `content`, truncated ~200 chars).

Default `k` = 8. No new tables, no schema change.

### App side

- `runSemantic()` first **flushes the op queue** (same rule as AI turns — never
  query the server doc while the composing gate holds unsynced edits), then calls
  the route via `lib/api.ts`.
- Offline / request failure → `semanticError`, meaning row shows the hint;
  exact search is unaffected (fully client-side).
- Results are jump-only (no replace from semantic results).

## Edge cases

- **0 exact matches:** counter shows `0/0`; the meaning row is the escape hatch.
- **Doc mutates while searching** (AI edit, sync reconcile, undo): matches
  recompute from the store subscription; `currentMatch` clamps into range.
- **Performance:** debounced ~150 ms; plain JS substring scan over in-memory
  blocks (a thesis is at most a few thousand paragraphs) — no worker, no index.
- **RTL:** matching is span-based, direction-agnostic; the query input inherits
  the app's RTL text handling; Arabic diacritics in the DOC match diacritic-free
  queries via the normalizer (and vice versa).
- **Keyboard interplay:** opening from the dock chip dismisses the keyboard; the
  panel's own inputs bring it back; the panel never moves (top-pinned).

## i18n

New trilingual strings (en/fr/ar): search placeholder, replace placeholder,
Replace / All buttons, match counter a11y labels, "Search by meaning", offline
hint, replace-all toast (with skipped-hits variant), ⋯-menu "Search" item.

## Out of scope (v1)

- Highlight/jump inside the Word-docx WebView and PDF views.
- Regex / whole-word / case-sensitive toggles.
- Table-cell and caption replace.
- Search history, cross-thesis search.

## Verification

No JS test runner in this repo (no jest). Gates:

- `npx tsc --noEmit` after each task.
- Server route: exercise with a real thesis id (local Supabase up) — exact JSON
  shape, auth rejection, empty-index behavior.
- On-device QA: open from dock chip AND ⋯ menu; Arabic query with diacritics in
  the doc; ↑↓ navigation flashes and scrolls in Writer view; replace + replace-all
  then undo via doc history; table hit shows jump-only (replace disabled);
  semantic query jumps to a correct block; airplane mode → meaning row disabled,
  exact search still works; close resets all state.
