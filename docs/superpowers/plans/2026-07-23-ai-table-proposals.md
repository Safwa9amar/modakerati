# AI Table Proposals (Inline Diff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ✦ on a table → AI proposes a full new grid → in-place cell-level diff in the Writer → Approve applies via one silent tableOp batch.

**Architecture:** New read-only suggest endpoint returns `{rows, layout?}`; the app computes a deterministic LCS grid diff used for BOTH highlight painting (proposal mode inside the existing `EditableTable`) and the approve ops (existing `tableOp` actions, silent `/ops` batch + skipReseed). No new Lexical node, no new server op types.

**Tech Stack:** Hono route (mirrors `/paragraphs/:index/suggest`), zustand store, React context into the DOM editor (mirrors `EditCellContext`), existing `applyThesisOps` client.

**Spec:** `docs/superpowers/specs/2026-07-23-ai-table-proposals-design.md`

**Verification constraint:** the app has NO JS test runner — gate with `npx tsc --noEmit` + device QA. Server verified with tsc + manual curl. `lib/api.ts` is DO NOT TOUCH.

---

### Task 1: Server — `POST /api/thesis/:id/table-suggest`

**Files:** Modify `~/modakerati-server/src/routes/thesis.ts` (next to the paragraph suggest, ~line 405).

- [ ] Add `TABLE_SUGGEST_SYSTEM_PROMPT`: academic table assistant; STRICT JSON `{"rows": string[][], "layout"?: {alignment?, direction?, headerRow?, borders?}}` output only; keep unrelated cells VERBATIM; same language as content; Arabic tables rtl.
- [ ] Handler: auth+live-docx guards (copy from paragraph suggest); read current grid via `Table.fromXml(block.xml).getAllCellText()` + `parseTableStyle(block.xml)` (import from `../lib/thesis-doc`) under `withThesisLock` (read-only); 400 if not a table.
- [ ] Call `getProvider("openrouter").chat` with instruction + current grid+layout JSON; parse reply (strip ```json fences); validate: rows non-empty array of string-arrays, pad ragged rows to rectangular, caps ≤60 rows ≤12 cols; ONE repair retry feeding the parse/validation error back; 422 on second failure.
- [ ] Return `{ rows, layout?, original: { rows, layout } }`.
- [ ] `npx tsc --noEmit` clean → commit (server repo, exact path).

### Task 2: App — `lib/table-diff.ts` (pure)

**Files:** Create `lib/table-diff.ts`.

- [ ] `export type TableDiff = { rowMap: (number|null)[]; removedRows: number[]; colMap: (number|null)[]; removedCols: number[]; editedCells: {r:number;c:number;oldText:string;newText:string}[] }`.
- [ ] `diffGrids(oldRows, newRows)`: LCS over row signatures (`row.join("␟")`), then LCS over column signatures on the row-aligned grids (transpose); editedCells from mapped pairs with different text. Reuse the LCS shape from `lib/lexical-writeback.ts`'s `lcsScript` (copy, keep pure/local).
- [ ] `diffToOps(index, diff, newRows, layoutChange?): ThesisOp[]` ordering: removedCols DESC → removedRows DESC → added cols ASC (`addColumn` with `at` = engine insert-right-of semantics; `at` omitted appends) → added rows ASC (`addRow`, `at` = insert-below; omitted appends) → `editCell` for editedCells AND every cell of added rows/cols at FINAL new coordinates → one `layout` op if layoutChange.
- [ ] Sanity-verify with a throwaway node script in scratchpad (not committed): add col + edit cell + remove row round-trips.
- [ ] tsc clean → commit.

### Task 3: App — store + client

**Files:** Create `stores/table-suggestion-store.ts`; modify `lib/thesis-suggest.ts`.

- [ ] `suggestTable(thesisId, index, instruction, signal?)` in `lib/thesis-suggest.ts` → POST the new endpoint, returns `{rows, layout?, original}`.
- [ ] Store state: `proposal: {thesisId; index; originalRows: string[][]; newRows: string[][]; layout?; diff: TableDiff} | null; loadingIndex: number | null; error: string | null;` actions `request(thesisId,index,instruction)` (aborts superseded via module-level AbortController; on success computes `diffGrids` and sets proposal), `again(note)`, `clear()`. Primitives-only selectors (zustand v5).
- [ ] tsc clean → commit.

### Task 4: App — proposal mode render in the DOM editor

**Files:** Modify `components/workspace/lexical/blockLexical.tsx`, `components/workspace/lexical/LexicalDomEditor.tsx`, `components/workspace/WorkspaceLexicalView.tsx`.

- [ ] `blockLexical.tsx`: `TableProposalContext` (`{proposal: {index; originalRows; newRows; layout?; diff} ; loadingIndex: number|null; onAction(action: "approve"|"reject"|"again", note?: string): void} | null`). In `EditableTable`: when `proposal?.index === block.index` render DIFF MODE — proposed grid with tints (`#dcfce7` added col/row cells, `#fef3c7` edited with struck old value inside, ghost red `#fee2e2` struck rows/cols for removals appended at mapped positions), pill under the table (✓ Approve / ⇄ Compare toggle → renders originalRows plain / ↻ Again → small inline note input / ✕ Reject), in-cell editing disabled. When `loadingIndex === block.index`: shimmer overlay. All events `stopPropagation` + `preventDefault` on mousedown (same focus rules as cell editing).
- [ ] `LexicalDomEditor.tsx`: props `tableProposal?`, `tableLoadingIndex?`, `onTableProposalAction?`; provide the context (mirrors `EditCellContext`).
- [ ] `WorkspaceLexicalView.tsx`: subscribe to the store (primitives), map to props; `onTableProposalAction`: approve → `diffToOps` → guard `pending>0` refuse (banner) → `applyThesisOps` one batch → `requestSkipReseed()` + `setDoc` + `refreshHistoryState` + clear; reject → clear; again → `store.again(note)`. Invalidation effect on docTick: drop proposal if `blocks[index]` isn't a table or its rows ≠ originalRows.
- [ ] tsc clean → commit.

### Task 5: App — AIDock table chips + wiring the ask path

**Files:** Modify `components/workspace/AIDock.tsx`.

- [ ] When sole selected block kind is `table`: fixed chips become table set — `صحّح الأرقام` / `أضف صف المجموع` / `نسّق الجدول` (i18n keys `aiDock.table.*` with defaultValue fallbacks) → `useTableSuggestionStore.request(thesisId, index, <preset instruction>)`. Ask input on a table routes to the same request with the free-form text.
- [ ] tsc clean → commit.

### Task 6: Final verification

- [ ] `npx tsc --noEmit` clean in BOTH repos.
- [ ] Re-check `git status` in both repos; commit exact paths only (parallel sessions).
- [ ] USER: restart server; device QA checklist from the spec.
