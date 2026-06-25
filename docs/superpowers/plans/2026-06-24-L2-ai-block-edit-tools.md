# L2 — AI edits the live .docx (block tools + per-thesis lock + live refresh)

> Builds on L0 (engine block API) + L1 (seed/read/render). L2 makes the AI chat EDIT the live `.docx` via block tools instead of mutating DB chapter markdown — for `docMode==="live-docx"` theses. Legacy theses keep using the existing chapter/section tools (until L3 migrates them). Paragraph/text editing only; tables/charts/images = L4.

**Repos:** server `/Users/hamzasafwan/modakerati-server` (+ `src/lib/ai`), app `/Users/hamzasafwan/modakerati`.

**Grounding (verified):** chat route `src/routes/chat.ts` `POST /chat/stream` (body: `thesisId, message, chapterId?, sectionId?, selection, docBlockIndex?, model?`); loop `src/lib/ai/tool-loop.ts` `streamChatWithTools(ai, history, {focus, ...})` (MAX_STEPS 16, OpenAI tool-call format); tools `src/mcp/server.ts` (33 tools; `update_chapter_content` is the content mutator); system prompt `src/lib/ai/types.ts` `buildToolSystemPrompt(ctx)`; provider `src/lib/ai/openrouter.ts`; **no lock anywhere**; engine helpers on the live doc via `src/lib/thesis-doc.ts` (`loadThesisEngine`, `getThesisDocumentDTO`) + `uploadDocx`. App: `WorkspaceComposer.tsx` polls `refreshThesis` every 1800ms while generating + once on completion; `thesis-workspace.tsx` holds the live `doc` in local state; `selected.docBlockIndex` exists from L1.

---

## SERVER

### S1 — per-thesis async lock (`src/lib/thesis-lock.ts`)
Module-level `Map<thesisId, Promise>` chain mutex:
```ts
const chains = new Map<string, Promise<unknown>>();
export async function withThesisLock<T>(thesisId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(thesisId) ?? Promise.resolve();
  let release: () => void; const gate = new Promise<void>(r => (release = r));
  chains.set(thesisId, prev.then(() => gate));
  try { await prev.catch(() => {}); return await fn(); }
  finally { release!(); if (chains.get(thesisId) === /* our gate chain */ undefined) {} }
}
```
(Implement a correct serial queue: each call waits for the previous to settle, then runs; clean up the map entry when the chain drains. Keep it simple + correct — add a tiny unit test.) Every live-doc load→edit→save cycle runs inside `withThesisLock(thesisId, …)` so concurrent turns/tool-calls on one thesis can't clobber each other's bytes.

### S2 — live-doc block tools (`src/mcp/doc-tools.ts`, registered in the toolset)
Each operates on the thesis's live `.docx` (load via `loadThesisEngine(docPath)` → mutate via engine → `engine.zip.toBuffer()` → `uploadDocx(userId, thesisId, buffer)`), wrapped in `withThesisLock`. All require the thesis to be `docMode==="live-docx"` (else return an error telling the model to use chapter tools). Tools:
- **`get_thesis_outline(thesisId)`** → `[{ index, level, text }]` for heading blocks (level 1–4) — cheap navigation. (Read-only; still inside lock-free read is fine, but read fresh each call.)
- **`read_thesis_blocks(thesisId, fromIndex?, toIndex?)`** → `[{ index, kind, text|rows }]` for a range (default a window) so the model can see context before editing.
- **`find_in_thesis(thesisId, query)`** → `[{ index, snippet, level }]` blocks whose text contains the query (case/diacritic-insensitive) — the model finds the block to edit.
- **`edit_paragraph(thesisId, index, text, expectSnippet?)`** → replace the paragraph at `index` with `text` (engine `editParagraphText`). If `expectSnippet` is given and the current block text doesn't contain it, REFUSE and return the actual current text (guards against stale indices). Returns `{ ok, index, newText, blockCount }`.
- **`insert_paragraph(thesisId, afterIndex, text, styleId?)`** → insert a new paragraph after `afterIndex` (engine `insertBlockAt` with `makeParagraphNode(text, styleId)`); `styleId` optional (e.g. `Heading2`). Returns `{ ok, newIndex, blockCount }`. NOTE: inserting shifts later indices by 1 — say so in the result.
- **`delete_block(thesisId, index, expectSnippet?)`** → delete block at `index` (engine `deleteBlockAt`); same stale-index guard. Returns `{ ok, blockCount }`.
- **`append_paragraphs(thesisId, afterIndex, paragraphs:[{text,styleId?}])`** (convenience) → insert several in order (one lock acquisition, sequential inserts) so drafting a chapter body isn't N round-trips. Returns the new index range + blockCount.
All tools: validate index bounds + kind; return clear JSON errors the model can recover from. After mutation, recompute and persist `theses.wordCount`/`pageCount` best-effort (optional).

### S3 — mode-aware toolset + system prompt
- The chat route already loads the thesis for focus titles; also read `docMode` + pass `docMode` and `docBlockIndex` into `streamChatWithTools` opts → into `buildToolSystemPrompt`.
- In the toolset assembly (where `toolset.tools` is built for the loop): when `docMode==="live-docx"`, INCLUDE the S2 doc tools and EXCLUDE (or hard-disable) `update_chapter_content`, `add_chapter`, `update_chapter`, `delete_chapter`, `move_chapter`, `add_section`, `update_section`, `delete_section`, `reorder_sections`, `apply_template` (the DB-content tools). Keep read tools, references, sources, `ask_user`, `export_thesis`, `notify_user`. When `docMode!=="live-docx"`, keep today's toolset unchanged (legacy path intact).
- `buildToolSystemPrompt`: add a live-docx variant describing the model: "This thesis is a live Word document — an ordered list of blocks (paragraphs with heading levels, tables, figures). To edit: FIRST call `get_thesis_outline` or `find_in_thesis` to locate the block index, optionally `read_thesis_blocks` for context, THEN `edit_paragraph`/`insert_paragraph`/`delete_block` by index. Indices shift after insert/delete — re-find if unsure. Pass `expectSnippet` when you can, to avoid editing the wrong block. The page de garde (cover/logo/jury table) is fixed — don't edit those blocks. Confirm via `ask_user` before large/destructive edits unless already authorized."
- Focus/selection variant: when `docBlockIndex` is set → "The student selected block #N (text: …). Apply the change THERE — call `edit_paragraph(index=N, …)` — unless they clearly mean elsewhere." When a free-text `selection` is set without an index, instruct to `find_in_thesis` for it.

### S4 — export + stats for live-docx
- `export_thesis` tool (`src/mcp/server.ts`) + any export route: when `docMode==="live-docx"`, DON'T rebuild from DB — return `signDownload(thesis.docPath, <slug>.docx)` (the live doc IS the deliverable). Keep the legacy build for legacy theses.
- (LaTeX export: for live-docx, respond that the deliverable is `.docx` — don't attempt .tex. Per spec, LaTeX is retired for live-docx.)

### S5 — server test (`scripts/test-live-docx-l2.ts`, tsx)
Seed a live-docx thesis from the El Bayadh template (reuse L1 path). Then exercise the tools directly (as the loop would):
- `get_thesis_outline` returns headings with indices.
- `find_in_thesis("الفصل")` (or a known heading) returns the right index.
- `edit_paragraph(index, "NEW SENTINEL")` → reload via `getBlocks` → that paragraph changed, **all tables + the logo image-block still present**, sectPr last, other paragraphs unchanged.
- `insert_paragraph(afterIndex, "body…", "Normal")` → blockCount+1, lands right after.
- `delete_block` a just-inserted block → blockCount back.
- `edit_paragraph` with a wrong `expectSnippet` → REFUSED with current text.
- **Lock test:** fire two `edit_paragraph` calls on the SAME thesis concurrently (Promise.all) → both succeed serially, final doc contains BOTH edits (no lost update); assert via reload.
Clean up the test thesis + storage at the end. Run `npx tsx` → PASS. `npx tsc --noEmit` → 0.

## APP

### A1 — send docBlockIndex + know docMode
- `WorkspaceComposer.tsx`: include `docBlockIndex: selected.docBlockIndex` in the `/chat/stream` request body (alongside the existing `selection`). The focus chip already shows the selected block text; keep it.
- The composer/store knows the thesis (`docMode`); nothing else needed server-trusts docMode from the DB.

### A2 — live block refresh during generation
- `thesis-workspace.tsx`: extract the doc fetch into a `refreshDoc()` (calls `getThesisDocument(thesisId)` → setDoc). While `isGenerating` is true AND the thesis is live-docx, poll `refreshDoc()` every ~1800ms (mirror the existing `refreshThesis` polling), and call it once on completion (generating true→false). This makes the AI's edits appear in the rendered pages as they're committed.
- Keep the existing `refreshThesis` polling for legacy theses. Don't double-fetch for live-docx (prefer `refreshDoc`).
- Selection highlight + scroll: when the AI edits a block, the re-fetch re-renders it; (optional) briefly highlight changed blocks — nice-to-have, skip if heavy.

### A3 — typecheck
`npx tsc --noEmit` in the app → 0 errors (touched files). Verify both paths compile: live-docx thesis edits render live; legacy thesis chat still works via the old refresh.

## Definition of done
- For a live-docx thesis, the AI chat edits the actual `.docx` via block tools (edit/insert/delete by index), serialized per-thesis by a lock; **tables + cover survive every edit** (proven by the L2 test on the El Bayadh seed).
- Legacy theses are completely unaffected (old chapter/section tools + refresh still used when `docMode!=="live-docx"`).
- The workspace shows edits appear live (poll `getThesisDocument` while generating); selection targets a paragraph by index; `export_thesis`/download return the live doc.
- Stale-index edits are guarded (`expectSnippet`); concurrent turns don't lose updates (lock test passes).
- `tsc --noEmit` clean in both repos.

## Out of scope (L3/L4)
- Migrating legacy theses to live-docx — L3. AI inserting tables/charts/images — L4. True character-streamed edit animation — later refinement (polling gives near-live updates now).
