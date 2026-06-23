# Thesis as a Live .docx — Migration Design

**Date:** 2026-06-23
**Status:** Design — pending user review, then phased plans.
**Decision (user):** Full migrate — the thesis **is** a live `.docx` edited in the workspace. **Extend `mdocxengine`** for safe full-body round-trip (paragraphs + tables, in order). **Migrate existing** DB-markdown theses too.
**Repos:** `~/mdocxengine` (engine round-trip), `~/modakerati-server` (storage/tools/migration), `~/modakerati` (workspace).

> Reverses the prior model (DB markdown = source of truth → `.docx` generated on export). Now the `.docx` in storage is the single source of truth; the DB holds only metadata + a navigation outline derived from the doc.

---

## 1. Goal & motivation
The thesis content lives as one `.docx` per thesis, seeded from the chosen template's base `.docx` (e.g. the El Bayadh cover + heading skeleton). The workspace renders and edits **that file**; the AI edits it in place. The page de garde (logo, jury table) is the real template, never regenerated — full fidelity. Output `.docx` = the file itself.

## 2. The keystone: engine full-body round-trip (`~/mdocxengine`)
**Problem:** `DocumentManager` parses the body into separate `body["w:p"]` / `body["w:tbl"]` arrays (xml2js default), **losing the document order** of paragraphs vs tables. `saveChanges(paragraphs)` rewrites only `w:p` and regroups tables → scrambles/loses interleaving. This is why table-bearing docs are read-only today.

**Fix:** model the body as an **ordered children array**.
- Parse `word/document.xml` with xml2js options `explicitChildren: true, preserveChildrenOrder: true, childkey: "$$"` so the body's children come back as an ordered `$$` list, each node tagged with `#name` (`w:p`, `w:tbl`, `w:sectPr`, …).
- New API on `DocumentManager`:
  - `getBlocks(): Promise<BodyBlock[]>` — ordered list `{ kind: "paragraph" | "table" | "other"; index; node }` (skipping `w:sectPr`).
  - `saveBlocks(blocks: BodyBlock[]): Promise<void>` — rebuild the body `$$` from the ordered blocks + re-append the preserved `w:sectPr`, write back. Order preserved exactly.
  - Convenience: `insertBlockAt`, `editParagraphText(index, text)`, `deleteBlock(index)` operating on the ordered list.
- `saveChanges(paragraphs)` stays for back-compat (cover generation), but the new live-edit path uses `getBlocks`/`saveBlocks`.
- **Validation:** round-trip a fixture docx that interleaves p/tbl/p/tbl/image → assert byte-stable order + tables/images intact (golden test). This is the foundation; everything else depends on it.

## 3. Data model (`~/modakerati-server`)
- `theses`: keep (id, userId, title, templateId, language, status, **frontMatter**, **docPath** [storage key of the live `.docx`], **docMode** = `"live-docx" | "legacy-db"`, wordCount/pageCount). Add `docPath`, `docMode`.
- `sections` / `chapters`: **retired as content store.** Kept temporarily only to migrate legacy theses; new theses don't use them. The **navigation outline** is derived on the fly from the doc's heading paragraphs (Heading1/2/3 → section/chapter tree).
- The live `.docx` lives in Supabase Storage: `theses/<userId>/<thesisId>.docx` (private; signed URLs for download). Reuse `document-storage` patterns + bucket.

## 4. Creation flow
- Wizard: title → template → (the plan step becomes optional; or it seeds headings). On **create**: copy the template's base `.docx` (e.g. `assets/templates/elbayadh-staps-template.docx`, or a per-template `baseDocPath`) → the thesis's storage path; fill the page-de-garde fields (title/authors/supervisor/year) into the doc if locatable, else leave the template's blanks; set `theses` metadata + `docMode="live-docx"`.
- Generic templates: a clean base `.docx` (cover from front matter + heading skeleton from the chosen structure).

## 5. Workspace (`~/modakerati`)
- `getThesisDocument(thesisId)` → ordered blocks (paragraphs with index, text, styleId, level + table/figure markers), via the engine `getBlocks`.
- Render the document: paragraphs as styled text grouped under their headings into pages; tables rendered (read-rendered) inline; the cover/banner shown. Tap a paragraph/heading → selection (block index).
- Chat composer (reused) targets the selected block; live re-fetch after each AI turn (existing polling).
- ⤢ expand / ⤓ download = the actual `.docx` (signed URL). The A4 preview becomes "open the real doc".

## 6. AI editing — paragraph/block MCP tools (`~/modakerati-server`)
Replace the chapter/section content tools with document tools operating on the live `.docx` via the engine round-trip (load→getBlocks→mutate→saveBlocks→upload):
- `get_thesis_outline(thesisId)` → headings + indices (cheap navigation).
- `read_thesis_blocks(thesisId, fromIndex?, toIndex?)` → block text by range.
- `find_in_thesis(thesisId, query)` → matching block indices + snippets.
- `edit_paragraph(thesisId, index, text)`, `insert_paragraph(thesisId, afterIndex, text, styleId?)`, `delete_block(thesisId, index)`.
- `insert_table(thesisId, afterIndex, rows)`, `insert_chart(thesisId, afterIndex, spec)` (chart → SVG → PNG → `shapes.insertImage`, reusing P7b), `insert_image(...)`.
- The tool system prompt describes the doc model (ordered blocks, heading styles, edit-by-index after reading/finding) + confirms before destructive edits. `ask_user` unchanged.
- Concurrency: serialize edits per thesis (a per-thesis async lock) since each edit loads+saves the whole doc.

## 7. Migration of existing theses
- One-time + on-open: for each `docMode != "live-docx"` thesis, run the **current DB→docx export** (`buildThesisDocxBuffer`) to produce its `.docx`, upload to the thesis's storage path, set `docMode="live-docx"` + `docPath`. The DB section/chapter rows are kept as a backup but no longer the source.
- A `scripts/migrate-to-live-docx.ts` (guarded, idempotent) for the batch; lazy conversion on first open as a fallback.

## 8. What's retired / reworked
- **Retired as source:** DB section/chapter content; P8 block-selection (becomes paragraph selection); charts-as-data (charts become embedded PNGs the AI inserts); the norm-compliant DB→docx export (its logic is reused for the cover/migration but not as the runtime content path); **LaTeX export** (the deliverable is `.docx`).
- **Kept/re-pointed:** wizard, templates + El Bayadh cover (now the live doc's seed), chat UX, sources/RAG, the P7b image embedding (now core), the focus/selection plumbing (now block indices).

## 9. Phasing
- **L0 — Engine round-trip** (`~/mdocxengine`): `getBlocks`/`saveBlocks` + ordered-children parse + golden round-trip test (interleaved p/tbl/image). *Foundation; independently shippable.*
- **L1 — Storage + creation + read API:** `theses.docPath/docMode`; create seeds the template `.docx`; `getThesisDocument` endpoint + the workspace renders the doc (read-only first).
- **L2 — AI block-edit tools** + chat targeting + live refresh + per-thesis edit lock.
- **L3 — Migration** of existing theses (script + lazy on-open).
- **L4 — Charts/figures via AI insert** (reuse P7b) + retire/clean the old DB-content paths + nav outline from headings.
Each phase is a separate plan + subagent-driven execution.

## 10. Risks
1. **Engine round-trip correctness** — the keystone; complex docs (nested tables, drawings, content controls) must survive. Mitigate with broad golden tests against the user's real theses + the El Bayadh doc.
2. **Performance** — every edit loads+saves+uploads the whole `.docx`; large docs → latency. Mitigate: per-thesis lock, debounce, only re-upload on change.
3. **Targeting precision** — paragraph-index editing is less precise than DB ids; the AI must read/find before editing. Mitigate: robust `find_in_thesis` + outline.
4. **Rich content the engine can't model** — equations, footnotes, complex fields. Preserve untouched where possible; flag unsupported edits.
5. **Migration fidelity** — converting legacy DB theses must not lose content.

## 11. Testing
- Engine: golden round-trip (interleaved p/tbl/image order byte-stable) + edit/insert/delete-by-index tests.
- Server: tsx tests for create-from-template, getThesisDocument, each block tool (edit/insert/delete/find), migration of a fixture legacy thesis.
- App: workspace renders a seeded thesis doc; selection + chat edit → live refresh. Manual: open exported file in Word.

## 12. Open question for review
- The **plan step**: with the doc seeded from the template's heading skeleton, is the AI-plan step still wanted (to customize headings before/while editing), or does the template skeleton suffice? (Leaning: keep it optional — it can pre-edit the doc's headings.)
