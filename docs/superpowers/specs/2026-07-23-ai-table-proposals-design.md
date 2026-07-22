# AI Table Proposals — Inline Diff Design

**Date:** 2026-07-23
**Status:** Approved (brainstormed with visual companion; user selected each option)
**Repos:** `~/modakerati` (app) + `~/modakerati-server` (server)

## Goal

Let the user ask the AI to edit a table from the Writer and review the result as an
**in-place diff** of the table itself — added/edited/removed cells highlighted —
with one Approve / Compare / Again / Reject pill. Approve applies the change to the
live `.docx` through the existing formatting-preserving `tableOp` pipeline.

## Decisions (user-selected)

1. **Review UX:** in-place diff table. The proposal replaces the table in the
   Writer; cell-level tints (green = added, amber = edited with the old value
   struck inside the cell, red = removed). NOT a stacked compare, NOT op chips.
2. **Entry point:** table bubble ✦ only (AIDock). Chat-AI proposals surfacing as
   inline diffs are out of scope for v1 (the chat model got direct table tools
   separately — `add_table_row` … `set_table_layout`, confirm-gated deletes).
3. **Protocol:** AI returns the **full proposed grid** (+ optional layout); the
   app computes a deterministic diff. The AI never emits indices/ops (LLMs get
   indices wrong; the grid is robust).
4. **Granularity:** all-or-nothing. Approve applies everything; partial
   disagreement goes through Again with a note. (Tap-to-exclude is a possible v2;
   the diff model already supports it.)

## UX flow

1. User taps a table → bubble shows table tools; the ✦ AIDock swaps in
   **table quick-chips** + the Ask input:
   - صحّح الأرقام (check/fix numbers), أضف صف المجموع (add totals row),
     نسّق الجدول (format the table) — preset instructions, localized en/fr/ar.
   - Ask input = free-form instruction.
2. Send → the table dims with a **shimmer** (loading state, like the paragraph
   suggestion's "Thought for Xs"). The request is abortable; tapping elsewhere or
   ✕ cancels it.
3. Response → the table renders in **proposal mode** (diff view + pill).
4. Pill actions:
   - **Approve** — apply diff as ops (below), clear proposal.
   - **Compare** — while toggled, show the ORIGINAL table plain (toggle back).
   - **Again** — inline note input (optional), re-sends instruction + note +
     previous proposal context.
   - **Reject** — clear the proposal. Nothing was applied; no server call.
5. **Dismissible without answering** (standing product rule): ✕ / tapping another
   block / navigation clears the proposal, memory-only, no persistence.
6. Proposal invalidation: if the doc changes underneath (docTick change from any
   other edit, or the block at `index` is no longer a table with the same
   original grid), silently drop the proposal.

## Server

**New route** `POST /api/thesis/:id/table-suggest` (in `src/routes/thesis.ts`,
next to the existing paragraph suggest/rewrite endpoints; same auth + live-thesis
guards).

Request: `{ index: number, instruction: string }`
Response: `{ rows: string[][], layout?: { alignment?: "left"|"center"|"right", direction?: "rtl"|"ltr", headerRow?: boolean, borders?: boolean } }`

- Reads the CURRENT grid via `Table.fromXml(...).getAllCellText()` and current
  style via `parseTableStyle` (both already exist in `thesis-doc.ts`).
- Prompt: system = table-editing rules (keep unrelated cells verbatim, keep the
  language of the content, Arabic tables are RTL, return STRICT JSON
  `{rows, layout?}` only, no commentary); user = instruction + the current grid +
  current layout as JSON.
- Validation: parse + schema-check the reply; on failure, ONE repair retry that
  feeds the parse error back. On second failure → 422 `{ error }`.
- Guards: `rows` must be a non-empty rectangular-ish grid (each row an array of
  strings; ragged rows padded with "" server-side), size caps (≤ 60 rows,
  ≤ 12 cols) to bound token/apply cost.
- Uses the standard model provider stack (tool-loop/provider config not needed —
  single-shot completion like the paragraph suggest).

## App

### `lib/table-diff.ts` (new, pure)

```
diffGrids(oldRows: string[][], newRows: string[][]): TableDiff
TableDiff = {
  rowMap: (number|null)[]        // newRow -> oldRow (null = added)
  removedRows: number[]          // old row indices not mapped
  colMap: (number|null)[]        // newCol -> oldCol (null = added)
  removedCols: number[]
  editedCells: { r: number, c: number, oldText: string, newText: string }[]  // NEW coordinates
}
```

- Row alignment: LCS over row signatures (cells joined with ``).
- Column alignment: LCS over column signatures (transpose, same join).
- Edited cells: for each (newRow→oldRow, newCol→oldCol) mapped pair where texts
  differ.
- Deterministic; used for BOTH highlight painting and the approve ops.
- `diffToOps(index, diff, layoutChange): ThesisOp[]` — ordering:
  1. `deleteColumn` for `removedCols` DESCENDING
  2. `deleteRow` for `removedRows` DESCENDING
  3. `addColumn` for added cols ASCENDING (with `at` in evolving coordinates)
  4. `addRow` for added rows ASCENDING
  5. `editCell` for every edited cell AND every cell of added rows/cols
     (final NEW coordinates — valid after steps 1-4)
  6. `layout` once, if the proposal's layout differs from the current style
  All existing `tableOp` actions — no new server op types.

### Store: `stores/table-suggestion-store.ts` (new, zustand)

State: `{ proposal: { thesisId, index, originalRows, newRows, layout?, diff } | null,
loading: { index } | null, error: string | null }` + `request / clear / setError`.
Select primitives (zustand v5 rule). One proposal at a time.

### Render: proposal mode in `EditableTable`

- New `TableProposalContext` in `blockLexical.tsx` (same pattern as
  `EditCellContext`): `{ proposal, onAction } | null` provided by
  `LexicalDomEditor` from props (`tableProposal`, `onTableProposalAction` —
  serializable + function props, like `suggestion`/`onSuggestAction`).
- When `proposal.index === block.index`, `EditableTable` renders:
  - the PROPOSED grid with tints; edited cells show the struck old value inside;
    removed rows/cols appended as red-struck ghost rows/cols,
  - the pill (Approve ✓ / Compare ⇄ / Again ↻ / Reject ✕) under the table,
  - Compare toggled → render `originalRows` plain,
  - in-cell editing disabled while a proposal is showing.
- Loading state: `proposal === null && loading.index === block.index` → shimmer
  overlay on the table.
- Styling reuses the review mock palette: `#dcfce7` added, `#fef3c7` edited,
  `#fee2e2` removed.

### Wiring: `WorkspaceLexicalView`

- Fetch: new client fn in `lib/api.ts`-adjacent module (NOT `lib/api.ts` — it is
  do-not-touch; put `suggestTable()` in `lib/thesis-suggest.ts` with the existing
  suggest client code) with AbortController; superseded requests aborted.
- On response: `diffGrids`, store the proposal.
- `onTableProposalAction(action, note?)`:
  - approve → `diffToOps` → ONE `applyThesisOps(thesisId, ops)` batch →
    `requestSkipReseed()` + `setDoc(res.document)` (the same silent pattern as
    cell editing — no drainTick cascade, no scroll), clear proposal,
    `refreshHistoryState`.
  - reject/dismiss → clear proposal.
  - again → re-call `suggestTable` with `instruction + "\n" + note`, keep showing
    the old proposal dimmed until the new one lands (or error).
- Invalidation effect: on docTick change while a proposal exists → verify
  `blocks[index]` is still a table with rows === originalRows, else clear.

### AIDock: table chips

- When the selected bubble kind is `table`, quick chips swap to the table set
  (localized, `defaultValue` fallbacks). Chips call the same request path as Ask
  with preset instructions. Existing AIDock chip plumbing; no new UI primitives.

## Error handling

- Suggest failure/timeout → error chip over the table ("لم ينجح — حاول مجددًا")
  with a retry; clears on dismiss.
- Approve server rejection → `revalidate(thesisId)` (authoritative re-fetch),
  clear proposal, toast via existing banner path.
- The ops batch is positional: approve is REFUSED (with a small toast) if the
  durable op queue has pending ops for this thesis (`pending > 0`) — same
  ordering rule as `applyTableOpSilent`.

## Verification

- App: `npx tsc --noEmit` + on-device QA (repo has no JS test runner — do not add
  one). QA checklist: chip → shimmer → diff renders (RTL table), Compare toggle,
  Again with note, Approve persists to .docx (check PDF view), Reject leaves the
  doc untouched, dismiss-by-tap-away, proposal invalidated by an outside edit,
  approve refused while op queue pending.
- Server: vitest unit test for the route's validation/repair path if practical;
  manual curl otherwise.
- `lib/table-diff.ts` is pure — verify via a temporary node script in scratch
  during development (not committed as a test).

## Out of scope (v2+)

- Tap-to-exclude granular accept.
- Chat-AI tool calls surfacing as inline diffs (chat uses direct gated tools).
- Multi-table / table+caption combined proposals.
- Cell-level formatting proposals (bold/color inside cells).
