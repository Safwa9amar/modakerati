# Header / Footer Template Studio (dashboard) — Design

**Date:** 2026-07-25
**Status:** Design approved, ready for planning
**Repos touched:** `~/modakerati-dashboard` (Next.js staff console — the new section + visual editor), `~/modakerati-server` (Hono/Drizzle — new table + model→OOXML converter + AI/compile endpoints). No app (`~/modakerati`) changes in v1.

## Problem

Staff have no way to define the running **header** (letterhead / running title) and **footer** (page numbers, footer text) that theses should carry. Header/footer content today lives only inside each thesis `.docx` and can only be changed through the AI tool loop (`set_header` / `set_footer`). There is no reusable, authorable **template** for this chrome, and nothing that produces the real Word markup (OOXML) these headers require — including the **tables** Arabic theses use for official letterheads (ministry / logo / university, with a bottom rule).

## Goal

Add a **Header/Footer Template Studio** to `modakerati-dashboard`: a visual editor where content staff design a header and footer on a live page — including **tables with Word-class border control** — and save it as a reusable template. The template is stored as a **JSON model (source of truth)** and **compiled to OOXML** header/footer parts by the server. An **AI panel** can draft a template from a structure hint + a natural-language prompt, returning the same JSON model for the human to refine.

## Scope boundary (v1)

**In v1 (authoring only):**
- A new dashboard section `/d/header-footer-templates` (list / create / edit / activate), role `content_admin` (+ `super_admin`).
- A visual editor: page canvas with header + footer, each a stack of **blocks** (tab-stop line *or* table); element palette; options (different first page, page-number format, RTL); logo upload.
- Word-class table editing: variable columns/rows, per-cell content (text + fields), 6-edge borders (style/width/color) per-table and per-cell, **merged cells, cell shading, per-cell vertical align, embedded logo image**.
- Save = store the **JSON model** + the server-**compiled OOXML** header/footer parts (cached).
- An **AI generate** panel: structure hint + prompt → server returns a schema-valid, compile-checked model that populates the canvas (never auto-saved).

**Deferred (named next phases):**
- **Applying** a template onto a real thesis `.docx` (injecting the compiled parts + embedding logo media via mdocxengine). This is the last mile; the converter built here is its reusable core.
- Binding templates to universities / norm-profiles as defaults.
- Odd/even (mirrored) pages; per-run rich styling (bold/size per run); an app-side picker.

## Key decisions (from brainstorming)

1. **Target = the dashboard, not the mobile writer.** (A separate, already-approved plan — `2026-07-25-editable-document-chrome` — surfaces headers/footers *inline in the app writer*; this feature is unrelated to that and does not touch it.)
2. **Standalone entity.** A new `header_footer_templates` table — *not* folded into the existing `templates` table (docx-file thesis templates, owns `/d/templates`) or `norm_profiles` (formatting jsonb, no header/footer text). Distinct route/namespace/table to avoid the name collision with `templates`.
3. **JSON model is the source of truth**; OOXML is a derived, cached artifact. The editor always re-opens from the model.
4. **The converter lives in `modakerati-server`** (near mdocxengine), so the future apply phase reuses the exact same generator. The dashboard posts the model to a token-gated endpoint on save.
5. **Three-region + tables.** A header/footer is `{ blocks: Block[] }`; a block is a tab-stop line (left/center/right) or a table. L/C/R = OOXML tab stops; tables = `<w:tbl>`.
6. **AI returns the same model schema** (structured output), so an AI draft drops straight into the visual editor.
7. **Single-language per template.** Each template has one `language` (drives RTL + text direction); it is not trilingual-per-row like News. (The editor *chrome* is still localized en/fr/ar.)

## Data model

### Table `header_footer_templates`

Server-owned schema: declared in `src/db/schema.ts` (Drizzle `pgTable`) and mirrored by a `CREATE TABLE IF NOT EXISTS` in `ensureSchema()` (`src/db/index.ts`). Rows are read/written directly by the dashboard's service-role client.

| column | type | notes |
|---|---|---|
| `id` | uuid pk (default `gen_random_uuid()`) | |
| `name` | text notNull | e.g. "STAPS · Arabic · running head" |
| `language` | text notNull | `en` \| `fr` \| `ar` — single-language |
| `university` | text null | free text, optional (mirrors `norm_profiles.university`, no FK) |
| `discipline` | text null | optional, default `generic` |
| `model` | jsonb notNull | the structured design — **source of truth** |
| `header_ooxml` | text null | cached compiled header part |
| `footer_ooxml` | text null | cached compiled footer part |
| `sect_pr` | text null | cached compiled section-property snippet (numbering fmt / titlePg) |
| `is_active` | boolean notNull default true | |
| `created_at` | timestamptz notNull default now() | |
| `updated_at` | timestamptz notNull default now() | |

### `model` JSON schema

```jsonc
{
  "version": 1,
  "options": {
    "differentFirstPage": true,               // blank/own header+footer on page 1 → <w:titlePg/>
    "rtl": false,                             // Arabic → mirrors L/R, sets bidi
    "pageNumber": { "format": "decimal", "startAt": 1 },  // decimal|lowerRoman|upperRoman → <w:pgNumType>
    "frontMatterRoman": true                  // roman front-matter → arabic body restart (apply-phase hint)
  },
  "header":    { "blocks": [ /* Block[] */ ] },
  "footer":    { "blocks": [ /* Block[] */ ] },
  "firstPage": { "header": { "blocks": [] }, "footer": { "blocks": [] } } // only when differentFirstPage
}
```

**`Block`** =
```jsonc
// tab-stop line
{ "type": "paragraph", "left": Element[], "center": Element[], "right": Element[] }

// table
{
  "type": "table",
  "columns": 3,
  "columnWidths": [33, 34, 33],               // percent, length === columns
  "borders": BorderSet,                        // table-level default
  "rows": Cell[][]                             // rows of cells
}
```

**`Cell`** =
```jsonc
{
  "content": Element[],
  "align":  "left" | "center" | "right",     // horizontal → <w:jc> on the cell paragraph
  "vAlign": "top" | "center" | "bottom",     // → <w:vAlign>
  "shading": "F2F2F2",                        // hex fill → <w:shd w:fill>, optional
  "borders": Partial<BorderSet>,              // per-cell override → <w:tcBorders>, optional
  "colSpan": 1,                               // → <w:gridSpan>
  "rowSpan": 1,                               // → <w:vMerge restart/continue>
  "merged": false                             // true = continuation cell, not rendered/emitted directly
}
```

**`Element`** (a run inside a line region or a cell) =
```jsonc
{ "type": "text",       "value": "Université d'El Bayadh" } // literal run
{ "type": "pageNumber" }                                    // → PAGE field
{ "type": "totalPages" }                                    // → NUMPAGES field
{ "type": "styleRef",   "style": "Heading 1" }              // → STYLEREF (chapter/section title)
{ "type": "docTitle" }                                      // literal or DOCPROPERTY Title
{ "type": "author" }
{ "type": "university" }
{ "type": "date" }                                          // → DATE field
{ "type": "image",      "assetId": "hf-assets/uuid.png", "widthPt": 48, "heightPt": 48 } // logo
```

**`BorderSet`** =
```jsonc
{
  "top":     BorderEdge, "bottom":  BorderEdge,
  "left":    BorderEdge, "right":   BorderEdge,
  "insideH": BorderEdge, "insideV": BorderEdge
}
// BorderEdge = { "style": "single"|"double"|"dashed"|"dotted"|"none", "widthPt": 1, "color": "000000" }
// any edge omitted = no border on that edge
```

## OOXML mapping (converter contract)

`compileTemplate(model) → { headerXml, footerXml, sectPr, media[], warnings[] }`, produced by a new pure module `src/lib/hf-template-ooxml.ts` in `modakerati-server`.

| Model construct | OOXML |
|---|---|
| `paragraph` block, L/C/R | one `<w:p>` with `<w:tabs>` (center @ mid, right @ page-width) + tab runs between regions |
| `rtl: true` | `<w:bidi/>` on paragraph `<w:pPr>`; L/R roles mirror |
| `table` block | `<w:tbl>` + `<w:tblPr>` (+ `<w:tblBorders>` from `borders`) + `<w:tblGrid>` from `columnWidths` |
| `Cell` | `<w:tc>` + `<w:tcPr>` (`<w:tcBorders>`, `<w:shd>`, `<w:vAlign>`, `<w:gridSpan>`, `<w:vMerge>`) + content `<w:p>` (`<w:jc>` from `align`) |
| `text` | `<w:r><w:t xml:space="preserve">…</w:t></w:r>` |
| `pageNumber` / `totalPages` | `<w:fldSimple w:instr=" PAGE " />` / `" NUMPAGES "` |
| `styleRef` | `<w:fldSimple w:instr=' STYLEREF "Heading 1" ' />` |
| `docTitle` / `author` / `university` / `date` | literal text or field (`DATE`, `DOCPROPERTY`) |
| `image` | `<w:drawing>` run referencing a media rel; the asset is returned in `media[]` (id + storage path) for the apply phase to embed |
| `options.pageNumber.format`, `startAt` | `sectPr`: `<w:pgNumType w:fmt="…" w:start="…"/>` |
| `options.differentFirstPage` | `sectPr`: `<w:titlePg/>` (+ a `firstPage` header/footer part) |

The converter emits the **contents** of the `<w:hdr>` / `<w:ftr>` parts (block-level OOXML) plus a `sectPr` snippet — not a whole document. `media[]` lets the later apply step wire image relationships. `warnings[]` flags anything not fully representable (e.g. a field with no source at apply time).

## Architecture

### Server (`modakerati-server`)

- **Table** — `src/db/schema.ts` + `ensureSchema()` (`src/db/index.ts`). Re-export is automatic (`export * from "./schema"`).
- **Converter** — new `src/lib/hf-template-ooxml.ts` (pure, unit-testable; may reuse mdocxengine table/paragraph helpers but emits header/footer-part OOXML itself).
- **Routes** — new `src/routes/hf-templates.ts`, registered in `src/index.ts` alongside the other `app.route(...)` calls, both gated by the existing `requireAdmin` (`src/routes/admin.ts`, `x-admin-token` = `ADMIN_API_TOKEN`):
  - `POST /admin/hf-templates/compile` — body `{ model }` → `{ headerXml, footerXml, sectPr, media, warnings }`.
  - `POST /admin/hf-templates/generate` — body `{ prompt, language, structureHint }` → `{ model, warnings }`. Uses the server AI provider (`src/lib/ai/*`) with **structured output** constraining the model schema, then runs `compileTemplate` as a validity gate; returns the model (never persists).
- **No server CRUD** — the dashboard writes rows directly (Hybrid-C per the dashboard architecture: rows → Supabase, logic → server).

### Dashboard (`modakerati-dashboard`)

- **Feature** `src/features/hf-templates/` (patterns cloned from `news` + `templates`):
  - `types.ts` — TS mirror of `Model` / `Block` / `Cell` / `Element` / `BorderSet`.
  - `data.ts` — `listHfTemplates` / `getHfTemplate` via `createAdminClient()` (`src/lib/supabase/admin.ts`), `import "server-only"`.
  - `index.ts` — barrel.
  - `components/` — `hf-template-list.tsx` (`DataTable`); the editor split into focused units: `hf-template-editor.tsx` (orchestrator, owns the model state), `PageCanvas`, `LineEditor`, `TableEditor`, `BorderControl`, `ElementPalette`, `OptionsPanel`, `AiGeneratePanel`, `OoxmlPreview`.
  - `locales/{en,fr,ar}.json` — `hfTemplates` namespace.
- **Routes** `src/app/d/header-footer-templates/` — `page.tsx` + `client.tsx` + `action.ts`, `new/{page,client}.tsx`, `[id]/{page,client}.tsx`. Every `page.tsx` first line: `await requirePathAccess("/d/header-footer-templates")`; `export const dynamic = "force-dynamic"`.
- **Server actions** (`action.ts`, each `hasStaffRole("content_admin")`):
  - `createHfTemplate` / `updateHfTemplate` — **on save** call the server `/compile` (via `src/lib/api/server.ts` `adminFetch`), then write `model` + `header_ooxml` + `footer_ooxml` + `sect_pr` to Supabase; `revalidatePath`.
  - `deleteHfTemplate` — Supabase delete.
  - `generateHfTemplate` — calls server `/generate` (`adminFetch`), returns the model to the client.
  - `uploadHfAsset` — logo image → private Storage bucket, returns the asset path.
- **Wire-up (5 shared edits):** `src/lib/auth/access.ts` (add `/d/header-footer-templates` to the `content_admin` array), `src/components/sidebar.tsx` (nav item in the content group, Lucide icon), `src/i18n/messages.ts` (register the 3 locale files in the `byLocale` arrays), `src/i18n/messages/{en,fr,ar}.json` (`sidebar.hfTemplates` label), `src/lib/auth/access.test.ts` (a `describe` block for the new route).

### Logo assets

Private Supabase Storage bucket `hf-template-assets`. `uploadHfAsset` stores the image; the model references `assetId` = storage path. The compiler emits the image run + a `media[]` manifest; **embedding into a real thesis `.docx` is apply-phase**. Editor preview stays the HTML canvas.

### AI generation

The `/generate` endpoint feeds the AI: the user `prompt`, the `language` (RTL), and a `structureHint` (target block kind, column count, available STYLEREF style names, whether to include page numbers). The provider is constrained to emit the **model schema** via structured output; the server compile-checks the result and returns `{ model, warnings }`. The dashboard loads it into the canvas as an unsaved draft.

## Verification

- **Server:** `npx tsc --noEmit` (clean). Converter check: feed a representative model (3-col table, bottom border, merged title cell, shaded cell, logo, footer page number) and assert the XML parses and contains the expected `w:tbl` / `w:tblBorders` / `w:tcBorders` / `w:shd` / `w:gridSpan` / `w:fldSimple`. `/generate` returns a model that `compileTemplate` accepts.
- **Dashboard:** `npm run build` + `npx tsc --noEmit` + `vitest` (extend `access.test.ts`). Manual QA: create the above Arabic template, save, confirm the row holds `model` + cached OOXML, reopen and confirm the canvas round-trips from the model, run an AI generate from a prompt and confirm it populates the canvas, verify RTL mirroring and the OOXML preview.
- **Schema:** confirm `ensureSchema()` creates `header_footer_templates` on a fresh boot; `npx drizzle-kit push` stays consistent.

## Open questions (non-blocking; resolve during implementation)

1. Exact `structureHint` shape for `/generate` and how STYLEREF style names are surfaced (fixed `Heading 1/2` list vs. configurable).
2. Border **preview** fidelity in the canvas (approximate CSS vs. exact pt widths) — the OOXML is authoritative regardless.
3. Whether `updated_at` should auto-touch via a DB trigger or be set in the action (dashboard convention likely the latter).
4. Merged-cell UX in the editor (select-range-and-merge vs. per-cell colSpan/rowSpan steppers) — model supports both; pick the interaction during the editor build.
5. Whether to also expose a read-only `GET /api/hf-templates` now (for a future app picker) or defer entirely to the apply phase. Default: defer.
