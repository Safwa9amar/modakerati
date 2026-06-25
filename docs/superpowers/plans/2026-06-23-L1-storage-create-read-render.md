# L1 — Live-.docx: storage + create-from-template + read API + read-only workspace render

> Builds on L0 (engine `getBlocks/saveBlocks/editParagraphText/insertBlockAt/deleteBlockAt`, string-splitter, on engine `main`). L1 makes a newly-created thesis seed a real `.docx` into storage and renders it (read-only) in the workspace. NO AI editing yet (that's L2).

**Repos:** server `/Users/hamzasafwan/modakerati-server`, app `/Users/hamzasafwan/modakerati`.

**Decision (resolves spec §12):** KEEP the wizard's plan step. The plan's Sections/Chapters are inserted into the DB at create (as today), then the seed `.docx` is built from them via the EXISTING `buildThesisDocxBuffer` (cover + heading skeleton, empty bodies). The live `.docx` becomes the source; sections/chapters rows stay as vestigial backup until L4 cleanup.

**Reuse map (verified):**
- Storage: `src/lib/document-storage.ts` — `uploadDocx(userId, docId, buffer)→path` (`${userId}/${docId}.docx` in private `documents` bucket), `downloadDocx(path)→Buffer`, `signDownload(path, filename)→url` (1h), `removeDocx(path)`. Admin client `src/lib/supabase.ts` `supabaseAdmin` (service role).
- Builder: `src/lib/docx.ts` `buildThesisDocxBuffer(thesisId): Promise<{buffer, ext, mime}>` — already builds the El Bayadh cover (logo + jury table) or generic cover + heading skeleton from the thesis tree. (Uses the OLD `saveChanges`+post-insert path, which is correct for table inserts at BUILD time; only runtime EDITS need the new round-trip.)
- Engine: `Mdocxengine.loadFromBuffer(buffer)` → `engine.document.getBlocks()`; `engine.zip.toBuffer()`.
- Create route: `src/routes/thesis.ts` `POST /api/thesis` (≈144–173) inserts thesis then sections→chapters in a txn.
- theses schema: `src/db/schema.ts` (54–73); `ensureSchema()` raw-SQL `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `src/db/index.ts` (17–96).
- App: workspace `app/(app)/thesis-workspace.tsx` renders `PaperPage` + `ChapterCard`; `stores/thesis-store.ts` (`refreshThesis`, `selected`, `selectBlock`); `lib/api.ts` (`apiGet`, `getThesis`, auth Bearer).

---

## SERVER

### S1 — schema: theses.docPath + docMode
- `schema.ts` theses: add `docPath: text("doc_path")`, `docMode: text("doc_mode").default("legacy-db").notNull()`.
- `ensureSchema()`: add idempotent ALTERs:
  `ALTER TABLE theses ADD COLUMN IF NOT EXISTS doc_path text;`
  `ALTER TABLE theses ADD COLUMN IF NOT EXISTS doc_mode text NOT NULL DEFAULT 'legacy-db';`

### S2 — seed the live .docx on create
- New helper `src/lib/thesis-doc.ts`:
  - `seedThesisDoc(thesisId, userId): Promise<{ docPath: string }>` — `const { buffer } = await buildThesisDocxBuffer(thesisId); const path = await uploadDocx(userId, thesisId, Buffer.from(buffer)); return { docPath: path };`
  - `loadThesisEngine(docPath)`: `Mdocxengine.loadFromBuffer(await downloadDocx(docPath))`.
  - `getThesisDocumentDTO(thesis)`: load engine → `getBlocks()` → map to DTO (see S3).
- In `POST /api/thesis`, AFTER the sections/chapters txn commits, wrap in try/catch:
  `try { const { docPath } = await seedThesisDoc(thesis.id, userId); await db.update(theses).set({ docPath, docMode: "live-docx" }).where(eq(theses.id, thesis.id)); thesis.docPath = docPath; thesis.docMode = "live-docx"; } catch (e) { logger.error(...); /* leave docMode legacy-db as fallback */ }`
  (Seed failure must NOT fail thesis creation.)

### S3 — read API: GET /api/thesis/:id/document
- New route in `src/routes/thesis.ts`: `GET /api/thesis/:id/document` (auth + ownership check like the other thesis routes).
- If `thesis.docMode !== "live-docx"` or no `docPath` → return `{ docMode: thesis.docMode, available: false }` (the app falls back to the legacy section/chapter render).
- Else load engine from `docPath`, `getBlocks()`, and build the DTO:
  ```ts
  type DocBlockDTO =
    | { index: number; kind: "paragraph"; text: string; styleId: string | null; level: 0|1|2|3|4 }
    | { index: number; kind: "table"; rows: string[][] }      // cell text grid
    | { index: number; kind: "image" }                          // a paragraph carrying a drawing
    | { index: number; kind: "other"; tag: string };
  type DocumentDTO = { id: string; title: string; docMode: "live-docx"; available: true; blocks: DocBlockDTO[]; downloadUrl: string };
  ```
  - `text` via the engine's `paragraphText`; `styleId` via `paragraphStyleId`. `level`: map styleId → heading level (`Heading1/Title→1`, `Heading2→2`, `Heading3→3`, `Heading4→4`, else `0`). A paragraph whose xml contains `<w:drawing>` → kind `"image"` (so the cover banner/logo shows as a figure placeholder, not empty text).
  - tables: parse the block xml into a `rows[][]` of cell text — extract `<w:tr>`→`<w:tc>`→concatenated `<w:t>`. (A small parser in `thesis-doc.ts`; read-only, best-effort.)
  - `downloadUrl`: `await signDownload(docPath, `${slug(title)}.docx`)`.
- Helper `index` = position among the editable blocks returned by `getBlocks()` (excludes sectPr), consistent with the engine's edit-by-index for L2.

### S4 — server tests (tsx, live DB)
`scripts/test-live-docx-l1.ts`: pick (or insert) a profile userId; create a thesis via the same path the route uses (call the handler logic or insert + seed) with a template that has `coverTemplate="elbayadh-staps"` AND a generic template; assert: (a) `docPath` set + object exists in storage (downloadDocx returns a non-empty buffer); (b) `getThesisDocumentDTO` returns blocks incl. ≥1 image block (logo) and ≥1 table block (jury) for El Bayadh, and heading blocks with correct levels; (c) the signed downloadUrl is returned. Clean up the test thesis + its storage object at the end. Run with `npx tsx`. Report PASS/FAIL with the block summary.

## APP

### A1 — api client
`lib/api.ts`: `export async function getThesisDocument(id: string): Promise<DocumentDTO>` → `apiGet('/api/thesis/'+id+'/document')`. Add the `DocumentDTO`/`DocBlockDTO` types (mirror server).

### A2 — workspace renders the live doc (read-only)
- `thesis-workspace.tsx`: on load, if `thesis.docMode === "live-docx"` (or always call getThesisDocument and use it when `available`), fetch the document and render its blocks as the paper pages INSTEAD of the section/chapter `ChapterCard` markdown path. Keep the legacy render as fallback when `available:false`.
- Render rules (read-only): group blocks into pages by heading level (a level-1 heading starts a new "Section" page; the cover/first page shows image blocks as a banner/logo placeholder + centered title lines). Paragraph blocks → styled `Text` (heading levels bigger/bold; body justified; RTL when language ar). Table blocks → a simple read-only table (rows/cells). Image blocks → a light "🖼 figure" placeholder card (real image rendering can come later; the cover logo is in the actual .docx).
- A new component `components/workspace/DocBlock.tsx` (or extend ChapterCard) renders one `DocBlockDTO`. Keep it presentational.
- ⤢ expand / ⤓ download buttons → open `downloadUrl` (the real .docx) via `Linking.openURL`.

### A3 — selection re-pointed to paragraph index
- Tapping a paragraph/table block selects it by its doc block `index`. Extend `thesis-store` `selected` to carry `{ docBlockIndex?: number, blockText?: string }` (keep the legacy fields for the fallback path). `selectBlock`-style action sets it. (Used by L2 chat targeting; for L1 it just highlights.)
- Visual: selected block highlighted (reuse the existing selection chip styling).

### A4 — app sanity
- `npx tsc --noEmit` (or the app's typecheck) → 0 errors. Manually reason through: a live-docx thesis renders its blocks; a legacy thesis still renders sections/chapters. (No device run required, but the code path must be coherent.)

## Definition of done
- New thesis (El Bayadh + generic) seeds a `.docx` to `documents/<userId>/<thesisId>.docx`; `theses.docPath` + `docMode="live-docx"` set; seed failure degrades gracefully.
- `GET /api/thesis/:id/document` returns ordered block DTOs (paragraphs w/ levels, tables as cell grids, image markers) + a signed download URL; legacy theses return `available:false`.
- Server tsx test passes (El Bayadh seed shows logo image-block + jury table-block + headings).
- Workspace renders a live-docx thesis read-only (pages, headings, tables, image placeholders); legacy theses unaffected; download opens the real file; tapping a block selects it by index.
- `tsc --noEmit` clean in both repos.

## Out of scope (L2+)
- AI editing the doc (block tools, chat targeting writes, per-thesis lock) — L2.
- Migrating existing legacy theses — L3. Real inline image rendering + charts — L4.
