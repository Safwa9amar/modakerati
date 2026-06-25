# L4 — AI inserts tables, charts & figures into the live .docx + cleanup

> Builds on L0–L2. Adds engine string-block builders for TABLE and DRAWING(image) blocks, server `insert_table`/`insert_chart` doc-tools (reusing the chart→SVG→PNG pipeline), real image rendering in the workspace, and a conservative retirement of the now-dead DB-content runtime path. (L3 skipped — DB has no legacy theses.)

**Repos:** engine `/Users/hamzasafwan/mdocxengine`, server `/Users/hamzasafwan/modakerati-server`, app `/Users/hamzasafwan/modakerati`.

**Grounding (verified):**
- Engine: `OrderedBody.ts` has `makeParagraphXml/Node` (string blocks); NO table/drawing builder yet. `XmlUtils.buildXml(obj, {rootName, headless:true})` serializes an xml2js object to a string. `Table` class + `docx-blocks.buildTable` produce a `<w:tbl>` object with borders/grid/header/100%-width/RTL. `MediaManager.insertImage(buf, ext) → {imagePath, relId}` (adds `word/media/imageN.png` + content-type + rel, collision-safe). `ShapeManager.insertImage` builds the `<w:drawing>/<wp:inline>/pic:pic/a:blip r:embed` (old paragraph-index path); it also ensures the drawing namespaces on `<w:document>`. `insertBlockAt(block, index)` takes `{kind,tag,xml}`. L1 DTO marks a paragraph block containing `<w:drawing>` as `kind:"image"`.
- Server: `chart-svg.ts chartToSvg(spec,{width,height,rtl})→svg`; `svg-to-png.ts svgToPng(svg,fitWidthPx)→{png,width,height}`; `docx-blocks.buildTable(header,rows,rtl)→Table`. `doc-tools.ts` has the L2 block tools + `requireLiveThesis`, `withThesisLock`, `loadThesisEngine`, `persist`. `mcp-bridge.ts` `LIVE_DOCX_TOOLS` set + `buildLiveDocxSystemPrompt`.

---

## L4a — ENGINE: table + drawing string-block builders (`/Users/hamzasafwan/mdocxengine`)
Add to `src/core/files/body/OrderedBody.ts` (+ export from `src/index.ts`):
- `makeTableXml(rows: string[][], opts?: { headerRow?: boolean; rtl?: boolean }): string` — build the `<w:tbl>` object (tblPr with single-line borders + `w:tblW 100% pct`; `tblGrid` with N gridCols; header row shaded+bold when `headerRow`; `w:bidiVisual` when rtl; each cell `<w:tc><w:p><w:r><w:t xml:space="preserve">…</w:t></w:r></w:p></w:tc>` with escaping) and serialize via `XmlUtils.buildXml(obj, {rootName:"w:tbl", headless:true})`. (Prefer reusing the existing `Table` class for parity with export — build the Table, `t.toObject()`, then `buildXml`. Keep it in the engine so the server just passes data.) `makeTableNode(...) → BodyBlock{kind:"table",tag:"w:tbl",xml}`.
- `makeDrawingParagraphXml(relId, widthEmu, heightEmu, shapeId, name): string` — a `<w:p>` containing a `<w:r><w:drawing><wp:inline>…<a:graphic><a:graphicData uri=picture><pic:pic>…<a:blip r:embed=relId>…</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`. **Declare needed namespaces locally** on `<wp:inline>` (xmlns:wp, xmlns:a) and `pic:pic` (xmlns:pic) so the block is self-contained regardless of host doc (r: is universally declared on w:document). Plain `<w:drawing>` (no mc:AlternateContent needed for modern Word). `makeDrawingParagraphNode(...) → BodyBlock{kind:"paragraph",tag:"w:p",xml}`.
- Shape/docPr id: a tiny helper `nextDrawingId(documentXml): number` (scan existing `wp:docPr @id` + `pic:cNvPr @id`, return max+1) OR have the server pass a unique id. Keep ids unique within the doc.
- **Tests (vitest):** `OrderedBody` — `makeTableXml` produces a `<w:tbl>` that, inserted via `insertBlockAt` into an interleaved fixture, round-trips: getBlocks sees a `table` block at the right index, OTHER blocks byte-identical, table has the right rows/cells. `makeDrawingParagraphXml` — inserted block is seen by getBlocks as a paragraph carrying `<w:drawing>` (image), `r:embed` preserved, other blocks byte-identical. Run `npx vitest run OrderedBody DocumentManager.blocks` → PASS.
- `npm run build`; confirm new exports in `dist`. Commit on a branch, then FF-merge to engine `main` (as in L0-fix) so the server's `file:` dep gets them; rebuild dist on main.

## L4b — SERVER: insert tools + image data in DTO (`/Users/hamzasafwan/modakerati-server`)
- `src/mcp/doc-tools.ts`: add (live-docx only, lock-wrapped, index-validated, like the L2 tools):
  - `insert_table(thesisId, afterIndex, rows: string[][], headerRow?, rtl?)` → `makeTableNode(rows,{headerRow,rtl})` → `insertBlockAt(block, afterIndex+1)` → persist. Returns `{ok,newIndex,blockCount}`.
  - `insert_chart(thesisId, afterIndex, spec:{type:"bar"|"line"|"pie",title?,labels[],values[]}, rtl?)` → `chartToSvg(spec,{rtl})` → `svgToPng(svg,520)` → `engine.media.insertImage(png,"png")→relId` → `nextDrawingId` → `makeDrawingParagraphNode(relId, pxW*9525, pxH*9525, id, title)` → `insertBlockAt(block, afterIndex+1)` → persist. On render error, FALL BACK to `insert_table` with a 2-col data table (label,value). Returns `{ok,newIndex,blockCount,mode:"image"|"table-fallback"}`.
  - (optional) `insert_figure(thesisId, afterIndex, sourceId)` — embed an image from an uploaded thesis source (if the source is an image); reuse the chart image path. Include only if cheap; else defer.
- Expose `insert_table`/`insert_chart` in the live-docx toolset (`mcp-bridge.ts LIVE_DOCX_TOOLS`) and describe them in `buildLiveDocxSystemPrompt` ("insert_table for tabular data; insert_chart for bar/line/pie — give labels+values; both take afterIndex; the chart renders as an image").
- **Image-in-DTO for rendering:** in `getThesisDocumentDTO` (thesis-doc.ts), for an `image` block, extract the embedded PNG (parse the block's `r:embed` → resolve via the doc rels → read `word/media/…` bytes from the engine zip) and include a base64 `dataUri` IF the image is ≤ ~200KB (charts are small); else omit (keep the placeholder). Add `dataUri?: string` + `caption?: string` to the image DTO. (Caption = the adjacent caption paragraph if present — optional.)
- **Test `scripts/test-live-docx-l4.ts` (tsx):** seed an El Bayadh live-docx thesis; `insert_table(afterIndex, [["A","B"],["1","2"]], headerRow:true)` → reload: table block present at the right index, **all original tables + logo preserved**, sectPr last; `insert_chart(afterIndex, {type:"bar",labels:["x","y"],values:[1,2],title:"T"})` → reload: a new image block present, a new `word/media/*.png` + rel exist, original tables+logo intact, doc is a valid zip and re-parses; `getThesisDocumentDTO` returns the chart image block WITH a `dataUri`. Save the final buffer to `/tmp/l4-elbayadh.docx` for manual open. Clean up thesis + storage. Run → PASS. `npx tsc --noEmit` → 0.

## L4c — APP: render real images + tables (`/Users/hamzasafwan/modakerati`)
- `DocBlock.tsx`: for `kind:"image"` with a `dataUri`, render an actual `<Image source={{uri:dataUri}} />` (fit width, keep aspect via the known px size if provided; else a sensible maxWidth) with the optional caption; fall back to the existing "🖼 figure" placeholder when no `dataUri`. Table rendering already exists (L1) — keep/tidy.
- Update the `DocBlockDTO` image variant types in `lib/api.ts` to include `dataUri?`/`caption?`/`width?`/`height?`.
- `npx tsc --noEmit` → 0 (touched files; leave the 3 known pre-existing errors).

## L4d — CLEANUP (conservative)
The DB is empty of legacy theses and every new thesis is live-docx, so the legacy DB-content path is no longer a runtime path. Do NOT delete shared building blocks still used by `buildThesisDocxBuffer` (the SEED/migration builder) — `Paragraph`, `Table`, `buildTable`, `renderBlocks`, `ShapeManager.insertImage`, `DocumentManager.insertTable`, `markdownToBlocks` all stay (the seed uses them). Instead:
- Add deprecation comments to the legacy CONTENT tools (`update_chapter_content` etc.) noting they only apply to `docMode!=="live-docx"` and that new theses never use them.
- Confirm no code path lets a `live-docx` thesis fall back to DB-content editing (the L2 gating already enforces this — assert it in a comment/test).
- LaTeX export: confirm it's already gated to non-live-docx (L2 S4) — for live-docx the deliverable is the `.docx`. Leave a note; don't rip out .tex for legacy.
- Inventory the dead-for-live paths in a short comment block (or a `docs/.../live-docx-cleanup-notes.md`) so a future pass can delete them once legacy is fully gone. NO large deletions in L4.

## Definition of done
- Engine: `makeTableXml/Node` + `makeDrawingParagraphXml/Node` exported, tested (round-trip preserves other blocks), merged to engine `main`, dist rebuilt.
- Server: `insert_table` + `insert_chart` live-docx tools work; inserting them into the El Bayadh seed preserves the cover/logo + original tables (proven by the L4 test); the DTO returns chart images as `dataUri`; tools exposed + described to the model.
- App: charts/figures render as real images in the workspace (with caption); tables render; placeholder only when no data.
- Cleanup: legacy content paths marked deprecated + provably unreachable for live-docx; no risky deletions; inventory noted.
- `tsc --noEmit` clean in both repos; engine vitest green.

## Out of scope
- True character-streamed edit animation; equation/footnote editing; deleting the legacy pipeline outright (future, once legacy theses are confirmed gone everywhere).
