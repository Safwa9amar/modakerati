# Inline Caret Editing in the Document (docx-preview) — Design

**Date:** 2026-07-19
**Status:** Approved
**Scope:** `modakerati` app (`WordDocxView`, `thesis-workspace`, `thesis-ops`, `lib/api`) + `modakerati-server` (one new `thesis.ts` route for paragraph split)

## Problem

In the workspace, tapping a paragraph in the live `.docx` view highlights the
whole block (a heavy blue box) and hands its index+text to the AI composer. The
render is **read-only** — there is no caret and no keyboard, so a student cannot
place a cursor and type into the document the way they do in Word. Manual text
edits happen only on a separate screen ([`block-editor.tsx`](../../../app/(app)/block-editor.tsx))
or through the AI/Edit tools.

The student wants: tap into the document to get a **Word-like caret**, type
directly into the paragraph with the keyboard, and have the app **auto-select
the surrounding block behind the scenes** (so the AI still has a target) instead
of showing the heavy "locked box" selection.

## Constraints that shaped the design

- The "docx" view has **two renderers** ([`thesis-workspace.tsx:439-466`](../../../app/(app)/thesis-workspace.tsx#L439-L466)):
  - **OnlyOffice** — a real Word editor, used only on physical devices when a
    Document Server is configured; currently loaded in **view-only** mode.
  - **docx-preview** ([`WordDocxView.tsx`](../../../components/workspace/WordDocxView.tsx)) —
    a read-only HTML render inside a WebView; the fallback on simulators and
    whenever no Document Server is available. **This is the surface the student
    sees in the reported screenshot** (the blue block box is a docx-preview-only
    feature).
- The app already has a complete manual-edit pipeline: serializable **ops**
  ([`thesis-ops.ts`](../../../lib/thesis-ops.ts)) applied optimistically, persisted to
  a durable SQLite queue, flushed strictly in order by a per-thesis pump, with
  the edit endpoints echoing the mutated document for reconcile
  ([`thesis-doc-store.ts`](../../../stores/thesis-doc-store.ts)). An `editText` op is
  exactly what `block-editor.tsx` emits to save a paragraph today.

## Decisions (from brainstorm)

1. **Type directly into the doc** (not "caret targets, composer edits" nor
   "caret opens the block-editor screen"). A real caret, keyboard types into the
   paragraph, block auto-selected in the background.
2. **Build on docx-preview (`WordDocxView`) first.** It is the surface the
   student sees, it reuses the entire op/engine pipeline, and "auto-select the
   block" is trivial (the focused paragraph's index). OnlyOffice edit mode is a
   **separate future spec**.
3. **Tap = select, second tap = edit.** First tap selects (light outline, no
   keyboard). A second tap on the already-sole-selected paragraph places the
   caret + raises the keyboard. Long-press still does multi-select.
4. **Save live, debounced (~900 ms)** while typing, plus a final commit on blur —
   not save-only-on-blur. The silent refresh is suppressed while a paragraph is
   focused so it can't clobber the caret.
5. **Enter splits the paragraph.** Requires a new `splitParagraph` op end-to-end
   (the stack supports it: engine `addParagraph`, `paragraphStyleId`; the AI
   already inserts paragraphs via the `insert_paragraph` MCP tool). Backspace at
   offset 0 merges into the previous paragraph.
6. **OnlyOffice deferred.** On real devices where OnlyOffice loads, the document
   stays read-only until a later phase. Accepted, per "do what our stack
   provides."

## Design

Two phases in this spec; a third (OnlyOffice) is explicitly deferred to its own
spec.

### Phase 1 — Core inline editing (`WordDocxView` only, no server change)

All of this lives in the WebView shell built by
`WordDocxView.buildHtml(...)` plus its RN `onMessage`/prop wiring.

**Gesture (select → edit).**
- The WebView already knows the selected set (pushed via `__setSelected`). Track
  the current **sole-selected** paragraph index locally.
- On a tap (`touchend`/`click` in `wireContainerEvents`): if the tapped block is
  a `paragraph` AND it is already the sole selected block → **enter edit mode**;
  otherwise post `select` as today.
- **Enter edit mode:** set the paragraph `<p>` `contentEditable="true"`, `focus()`
  it, and let the native tap place the caret at the tap point (or
  `caretRangeFromPoint(x, y)`). Add `input` + `keydown` + `blur` listeners.
  Post `editStart { index }`.
- **Exit edit mode** (blur, or tapping another block): commit if changed, set
  `contentEditable="false"`, post `editEnd { index }`.
- Tables, images, and `other` blocks are never inline-editable — they keep
  select-only. Headings are paragraphs, so they are editable.
- Long-press keeps its multi-select behavior for non-editing blocks; inside an
  editing paragraph, native text selection takes over (Word-like).

**Save path (live + blur).**
- An `input` listener debounces **~900 ms** after typing stops; on fire it reads
  the paragraph's `textContent`, and only if it differs from the baseline
  captured at `editStart`, posts `editCommit { index, text }`.
- A final `editCommit` also fires on blur (flush the pending debounce).
- RN's `onMessage` maps `editCommit` → `useThesisDocStore.getState().mutate(
  thesisId, { type: "editText", index, text })` — the same op
  `block-editor.tsx` uses. The whole optimistic-patch → durable-queue →
  in-order-flush → reconcile machinery is reused unchanged.

**The two clobber guards (correctness crux).**
- **`__applyOp` echo.** `mutate` fires `opListeners` → the WebView's `__applyOp`,
  which for our own `editText` would call `setBlockText` on the very `<p>` being
  typed in, moving the caret. Guard: while `editingIndex` is set, `__applyOp`
  **skips any op whose target is `editingIndex`** (the DOM is already
  authoritative for it). Other blocks are not being edited during a manual edit
  (see AI gating), so this is sufficient.
- **Silent refresh.** When the op later flushes, `setDoc` bumps `tick` → RN
  injects `__refresh`, re-rendering the whole doc and destroying the caret.
  Guard: RN tracks an `isEditing` flag from `editStart`/`editEnd` and **defers
  `maybeRefresh()` while editing**, running the deferred refresh on `editEnd`.
  As a belt-and-braces backstop, the WebView's `__refresh` no-ops (and records a
  pending flag) while `editingIndex` is set.
- Note: an optimistic `editText` does **not** bump `tick`
  ([`thesis-doc-store.ts:274-283`](../../../stores/thesis-doc-store.ts#L274-L283)),
  so our own live edits never trigger a refresh mid-typing — only the post-flush
  reconcile does, which the guard defers to blur.

**AI-turn gating.**
- A new `editable` prop (`= !isGenerating`) is threaded from the workspace into
  `WordDocxView`. When false, a tap never enters edit mode (mirrors
  `block-editor.tsx`'s `editable={!isGenerating}`).
- If a turn starts while a paragraph is being edited, RN injects a "force commit
  + blur" so the in-flight edit is saved before the AI's edits land.

**New RN⇄WebView bridge.**
- WebView → RN: `editStart { index }`, `editCommit { index, text }`,
  `editEnd { index }`.
- RN → WebView: an `editable` flag carried in the props/refresh payload (and a
  one-shot `__forceCommit()` inject for the AI-turn race).

**Selection model after this phase.**
- The heavy full-block highlight (`mk-sel`) is softened to a light active
  outline for the sole-selected paragraph; multi-select highlighting is
  unchanged. First tap still calls `selectBlock` (the "auto-select behind the
  scenes"); the composer chip and quick-actions continue to target it.

### Phase 2 — Enter splits / Backspace merges (adds one op end-to-end)

**New op `splitParagraph { index, before, after }`** in `thesis-ops.ts`:
- `applyOpToBlocks`: set block `index`'s text to `before`, insert a new
  `paragraph` block immediately after with text `after` (inheriting the source
  block's `level`/`styleId`/`alignment`/`direction`), then `reindex`.
- `applyOpToSections`: shift `startBlockIndex` for sections after the insert
  point by +1 (mirrors `insertImage`).
- `executeOp`: call a new client fn `insertThesisParagraphSplit(thesisId, index,
  { before, after })` in [`lib/api.ts`](../../../lib/api.ts).

**New server route `POST /:id/paragraphs/:index/split`** in
`modakerati-server/src/routes/thesis.ts`, following the existing
`PUT /:id/paragraphs/:index` handler:
- `withThesisLock`, read blocks, verify block `index` is an editable paragraph
  (`kind === "paragraph"` && not a `<w:drawing>`).
- Read the source paragraph's `styleId` (via `paragraphStyleId`, already imported
  in this file).
- Set the source paragraph text to `before`; insert a new paragraph after it
  with text `after` and the same `styleId`, using the engine's `addParagraph(
  text, { styleId }, at)`. **Map the block index to the engine's paragraph index**
  (engine counts paragraphs only) exactly as the `startOnNewPage` handler does:
  `blocks.slice(0, i).filter(b => b.kind === "paragraph").length`.
- `commitDocx(engine, { label: "Split paragraph", source: "manual" })`, return
  the echoed document.

**WebView Enter handling:**
- `keydown` Enter → `preventDefault`. Split the paragraph `textContent` at the
  caret offset into `before`/`after`. Optimistically split the DOM (`<p>` keeps
  `before`; a cloned `<p>` after it holds `after`), place the caret at the start
  of the new paragraph, and post a `split { index, before, after }` message. RN
  maps it to `mutate({ type: "splitParagraph", … })`.

**Backspace-at-offset-0 (merge):**
- When Backspace is pressed with the caret at offset 0 of a paragraph, merge into
  the previous paragraph using **composed existing ops**: `editText(prevIndex,
  prevText + curText)` then `deleteBlocks([curIndex])`. Place the caret at the
  join point. No new endpoint. (This is the deferrable half — if the DOM/caret
  handling proves fiddly, split ships first and merge follows.)

### Deferred to a separate spec — OnlyOffice edit mode

Flipping OnlyOffice to edit mode gives genuine Word editing on real devices but
**bypasses the op/engine pipeline** (edits save through OnlyOffice's own
callback) and needs a plugin/connector to extract "which block is the caret in"
back to the app. Out of scope here. Consequence: on a real device where
OnlyOffice loads, the document remains read-only until that phase; inline editing
appears on the docx-preview renderer (simulators, and real devices with no
Document Server).

## Out of scope / known limitations

- **Mixed per-run styling.** `editText` reflows a paragraph to its dominant run
  style, so a lone bold word mid-sentence is lost on inline edit — identical to
  `block-editor.tsx` today.
- **`block-editor.tsx` stays.** Still reachable from the composer's Edit-block
  tool; not removed or refactored in this work.
- **Outline view unchanged.** `OutlineReorderable` keeps select + drag-reorder;
  inline text editing is docx-preview only in this spec.
- **No rich formatting via the caret** (bold/italic keyboard shortcuts, etc.) —
  formatting stays in the Edit tools.

## Files touched

- `components/workspace/WordDocxView.tsx` — bulk of Phase 1 + Phase 2 WebView
  logic (gesture, contentEditable, debounce, guards, bridge, Enter/Backspace).
- `app/(app)/thesis-workspace.tsx` — pass `editable`/`isGenerating`, map
  `editStart`/`editCommit`/`editEnd`/`split` to store `mutate`, manage the
  refresh-deferral flag.
- `lib/thesis-ops.ts` — new `splitParagraph` op (type, `applyOpToBlocks`,
  `applyOpToSections`, `executeOp`).
- `lib/api.ts` — `insertThesisParagraphSplit` client fn.
- `modakerati-server/src/routes/thesis.ts` — new `POST /:id/paragraphs/:index/split`
  route (locked-edit pattern, style inheritance, block→paragraph index map,
  commit + echo).

## Verification

- **App:** `npx tsc --noEmit` (no JS test runner for the Expo app), then run on a
  simulator and exercise: tap→select, second-tap→caret+keyboard, type→live save,
  blur→reconcile, Enter→split, Backspace-at-start→merge, and an AI turn during an
  active edit (edit commits first, doc reconciles after).
- **Server:** the new route follows the existing `withThesisLock` +
  `commitDocx(source:"manual")` pattern; verify against the running Document
  Server that a split returns an echoed document with the two paragraphs and the
  inherited style, and that section boundaries survive.
