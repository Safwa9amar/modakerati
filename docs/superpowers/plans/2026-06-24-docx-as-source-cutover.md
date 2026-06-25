# Docx-as-source cutover — drop DB sections/chapters, derive structure from the .docx

**Date:** 2026-06-24  ·  **Branch:** `feat/thesis-hierarchy-p0` (app + server)  ·  **Engine:** `mdocxengine` (no changes needed)

## Goal (user)
> "In the DB we only save the thesis details — no chapters, no sections. All the parts live inside the `.docx` file itself, so remove them. Get the sections from the `.docx` instead of the DB. When the user exports, send the same `.docx` (don't regenerate from the DB). Editing a file uses our engine."

The backend live-docx machinery already exists (engine round-trip, AI block edits, export signs the stored docx). This cutover **removes the DB section/chapter model entirely** and makes the **`.docx` the only source of structure**.

## Locked decisions
- **Tap a section in Thesis Details → open the workspace** (live docx). Remove the `edit-chapter` + `section-editor` screens.
- **Full DB removal now**: drop `sections` + `chapters` tables, their CRUD endpoints, store actions, and the MCP DB-content tools. Refactor creation to seed the `.docx` straight from the generated outline (no DB rows).

## Default decisions (calling out — flag if you disagree)
1. **Counts on list/home/profile cards** ("X sections, Y chapters"): add cached `sectionCount` + `chapterCount` columns on `theses`, recomputed (alongside the existing `wordCount`/`pageCount`) at seed and after every docx edit. Keeps list screens cheap (no per-thesis docx load) and the UI unchanged. The **detail screen** reads the live outline endpoint.
2. **Heading-style mapping in the seed**: Partie → `Heading1`, Chapitre → `Heading2`, markdown `#/##/###` inside chapter bodies → `Heading3/4/5` (shift `headingBase` 2→3). Required so the outline is derivable from the docx.
3. **Legacy DB-rendered previews & exports become dead → removed**: the A4 DB preview (`document-preview.tsx`, `thesis-preview-a4.tsx`, server `preview-html`) and the DB-rebuild export/latex path (`buildThesisDocxBuffer`-from-DB, `buildThesisLatex`, `loadThesisTree`, the `BUILDERS` map). "Preview" = the live-docx view (OnlyOffice / `WordDocxView`). Export = sign the stored `.docx` (already live).
4. **LaTeX export** is dropped for now (it already only returned a docx-with-note). Live-LaTeX is a future feature, tracked separately.

---

## SERVER — `~/modakerati-server`

### S1. Schema migration (Drizzle) — `src/db/schema.ts`
- **Drop** `sections` and `chapters` tables.
- On `theses`: **add** `sectionCount int default 0`, `chapterCount int default 0`. Keep `wordCount`, `pageCount`, `docPath`, `docMode`, `frontMatter`, `resume`.
- Generate + apply the migration (`drizzle-kit`). NOTE: per memory all legacy/test theses were already deleted and all current theses are live-docx, so no data is lost; confirm the `theses` rows that exist are `docMode="live-docx"` before dropping.

### S2. Refactor the seed builder — `src/lib/docx.ts`, `src/lib/thesis-export.ts`, `src/lib/thesis-doc.ts`
- `buildThesisDocxBuffer(thesisId)` → `buildSeedDocxBuffer({ thesis, template, references, planSections })` where `planSections: Array<{ title; kind?; chapters: Array<{ title; content? }> }>` is the **in-memory** generated outline (no DB read for structure).
  - Partie → `headingPara(title, "Heading1", …)`; Chapitre → `headingPara(title, "Heading2", …)`; chapter body `renderBlocks(..., { headingBase: 3 })`.
- Split `loadThesisTree` → `loadThesisMeta(thesisId)` returning `{ thesis, profile, template, references }` (no sections). The El Bayadh cover / front-matter / résumé / references / TOC / pagination logic is unchanged — only the section/chapter source changes.
- `seedThesisDoc(thesisId, userId, planSections)` threads `planSections` through.

### S3. Create endpoint — `src/routes/thesis.ts` `POST /`
- Stop inserting `sections`/`chapters`. Build `planSections` from `body.sections` (or wrap legacy `body.chapters`), pass straight to `seedThesisDoc(thesis.id, userId, planSections)`.
- After seed, compute + store `sectionCount`/`chapterCount`/`wordCount`/`pageCount` from the seeded outline.
- Seed failure handling: if seed fails, still create the thesis (degrade) — but with no DB fallback now, surface a clear error state. (Decide: retry once, else return 201 with `docMode` left unseeded and the app shows an "open workspace to start" empty state.)

### S4. Read endpoints — `src/routes/thesis.ts`
- **NEW** `GET /:id/outline` → loads the engine, derives `{ available, title, wordCount, pageCount, sections: [{ index, title, chapters: [{ index, title }] }] }` by grouping `Heading1` (Partie) with the following `Heading2` (Chapitre) blocks. Powers the detail screen + tap-to-jump (carries block `index`).
- `GET /:id` → return just the thesis row (+ cached counts). Remove the sections/chapters join.
- `GET /` (list) → drop the sections/chapters count queries; return rows with the cached `sectionCount`/`chapterCount` columns.
- **Delete** `GET /:id/preview-html` (+ `src/lib/preview-html.ts`).

### S5. Delete section/chapter CRUD — `src/routes/thesis.ts`
- Remove `POST/PUT/DELETE /:id/sections…` and `…/chapters…` routes. Keep `/:id/sources` (sources/references stay).

### S6. MCP tools — `src/mcp/server.ts`, `src/lib/ai/mcp-bridge.ts`, `src/mcp/doc-tools.ts`
- Remove the DB-content tools (`add_section`, `update_section`, `delete_section`, `reorder_sections`, `add_chapter`, `update_chapter_content`, `update_chapter`, `list_chapters`, `delete_chapter`, `move_chapter`) and their bridge wiring.
- `doc-tools.ts` recompute step: also set `sectionCount`/`chapterCount` (count `Heading1`/`Heading2`) when it updates `wordCount`/`pageCount` after each save. The `get_thesis_outline` tool stays (used by the model).

### S7. Export & cleanup
- `src/lib/thesis-export-storage.ts`: keep only `exportLiveDocxIfApplicable` (sign the stored docx). Remove the `BUILDERS` map, the legacy `exportThesis` DB-rebuild, and the latex branch. `src/routes/export.ts`: always sign the stored `.docx`; if a thesis somehow isn't live-docx, 409 with a clear message.
- **Delete** `src/lib/latex.ts`, `src/lib/docx-frontmatter`/cover/etc. ONLY if unused after the seed refactor (the seed still uses cover + front matter, so those stay). Delete `loadThesisTree` once no caller remains.

---

## APP — `~/modakerati`

### A1. Types — `types/thesis.ts`
- Remove `Section`, `Chapter`, `SectionKind`, `ChapterStatus`, and `Thesis.sections`. Add `Thesis.sectionCount`/`chapterCount` (from API). Add an `OutlineDTO` (`{ available; sections: [{ index; title; chapters: [{ index; title }] }] }`).

### A2. API client — `lib/api.ts`
- `getThesis` → returns the thesis row (no sections). `createThesis` → keep accepting the generated `sections` payload (passed through to the seed; not persisted as rows). Add `getThesisOutline(id): Promise<OutlineDTO>`. Remove any section/chapter CRUD calls. `listTheses` still returns `sectionCount`/`chapterCount` (now cached columns).

### A3. Store — `stores/thesis-store.ts`
- Remove `addSection/updateSection/deleteSection/reorderSections/addChapter/updateChapter/deleteChapter` and `selected.sectionId/chapterId/blockIndex` (keep `docBlockIndex`). `theses` state no longer carries `sections`.

### A4. Thesis Details — `app/(app)/thesis-detail.tsx` (rewrite)
- Fetch `getThesisOutline(id)` (+ the thesis row for status/progress/title). Render counts from the outline (or cached columns) and the section list from the outline. Tap a section → `router.push("/(app)/thesis-workspace", { thesisId, blockIndex })`. Drop `normalize()`/`getThesis`-sections.

### A5. Remove the edit screens & nav
- Delete `app/(app)/edit-chapter.tsx`, `app/(app)/section-editor.tsx`; remove their `<Stack.Screen>` entries in `app/(app)/_layout.tsx`. Fix the `ThesisStructureSheet.tsx` `edit-chapter` nav + `addSection` (→ open workspace, or remove the sheet's edit affordances).

### A6. Creation wizard — `app/(app)/thesis-plan.tsx`, `template-preview.tsx`
- Keep generating + locally editing the outline (it's the seed input). `handleCreate` still sends `{ sections }` to `createThesis` (server seeds, doesn't persist). After create, navigate to the workspace. No change to `generateThesisPlan`.

### A7. Other readers
- `(tabs)/index.tsx`, `(tabs)/thesis.tsx`, `(tabs)/profile.tsx`: read `sectionCount`/`chapterCount` from the API row instead of iterating `sections` (profile aggregates from cached columns).
- `WorkspaceComposer.tsx` / `thesis-workspace.tsx`: drop `sectionId`/`chapterId` AI targeting (use `docBlockIndex` only).
- **Delete** `document-preview.tsx`, `thesis-preview-a4.tsx` + their nav; "preview" routes to the workspace/live-docx view.

---

## Verification
- Server: `tsc` clean; migration applies; create a thesis → outline endpoint returns the seeded Partie/Chapitre tree; export returns the stored docx bytes (not a rebuild); an AI edit bumps `sectionCount`/`chapterCount`.
- App: `tsc` clean; detail screen shows docx-derived sections; tap → workspace at the right block; list/home/profile counts render; no references to removed screens/types.
- Manual on device (user): create → detail shows sections from docx → open workspace → AI-edit → export = same docx.

## Risks
- **Migration is destructive** (DROP TABLE). Mitigated: all current theses are live-docx, no section/chapter data is load-bearing. Verify before applying.
- Seed heading-style change alters the live doc's visual hierarchy (more correct, but visible). 
- Any thesis stuck in `legacy-db` (failed seed) has no fallback now → must show an "open workspace to seed" empty state rather than a broken section list.

## Phasing (safe execution order)
1. **Server S2–S4** (seed refactor + outline endpoint) — additive, nothing removed yet.
2. **App A1–A4, A6–A7** (consume outline; rewrite detail) — app works on the new endpoints.
3. **Removal**: app A5 (delete edit screens) + server S5–S7 + S1 migration + S6 — drop the old model last, once nothing reads it.
