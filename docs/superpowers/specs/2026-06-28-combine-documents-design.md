# Combine Documents — Design Spec

**Date:** 2026-06-28
**Status:** Approved (brainstorming) → implementation
**Repos touched:** `~/mdocxengine` (engine), `~/modakerati-server` (Hono/Drizzle), `~/modakerati` (Expo app)

## 1. Summary

Let a user combine several separate `.docx` parts (e.g. `introduction.docx`,
`partie-theorique.docx`, `partie-pratique.docx`) into **one organized single
thesis document**. The combined result is a brand-new `live-docx` thesis that
opens in the workspace, exactly like a single-file import.

"Organized" means, per the agreed scope, the combine step:

1. **User-ordered** — the user arranges the parts; the AI proposes a sensible
   default order (intro → théorique → pratique → conclusion).
2. **Each part = a titled section** — a `Heading 1` with the part's title is
   inserted above its content, giving the result a clean outline.
3. **Each part starts on a new page** — a section/page break separates parts.
4. **Normalized formatting** — one norm profile (fonts, margins, spacing,
   heading styles) is applied across the whole merged document.

Titles are **typed by the user**, but the server **reads each file's content to
classify which part it is** (introduction vs. théorique vs. pratique …) and uses
that to pre-fill the suggested title and the default order.

**Fidelity bar: everything must survive** — images, equations (OMML), footnotes,
and auto-numbered lists. This requires a real cross-document merge primitive in
mdocxengine (it has none today), built **native and phased**.

## 2. Goals / Non-goals

**Goals**
- Multi-`.docx` upload → one combined `live-docx` thesis, landing in the workspace.
- AI classification of each part's role + suggested title + default order.
- Drag-to-reorder + per-part title editing before committing the merge.
- Full-fidelity merge: images, equations, footnotes, numbered lists preserved.
- Normalize the merged doc to a chosen norm profile.
- Reuse the existing post-import analysis report.

**Non-goals (this iteration)**
- Combining theses already in the app (only fresh uploaded files — confirmed).
- A Python/external merge sidecar (we chose native mdocxengine — approach A).
- Preserving each source's exact fonts/styles verbatim (we **retarget** styles to
  the template — normalization wins over byte-exact style preservation).
- Header/footer inheritance from sources (template/profile owns headers/footers).

## 3. Architecture decision

**Approach A — native merge in mdocxengine, phased.** A new `MergeManager`
(`engine.merge`) copies a source document's body blocks into a target and remaps
every cross-document reference (image rIds, footnote ids, numbering ids, hyperlink
rIds), retargeting styles to the template by name. Phased so a usable version
ships before the hardest work:

- **Phase 1** — blocks + **images** + **footnotes** + **equations** + page breaks
  + heading/Normal style mapping. Covers the majority of theses.
- **Phase 2** — **numbered-list** (abstractNum) copy/remap + fuller style mapping
  + hyperlink/endnote remap.

Rationale: keeps everything native (no new infra), reuses the existing import +
analysis + workspace machinery, and the engine primitive is reusable beyond this
feature. The cost (the ID-remapping pass) is accepted and isolated behind tests.

## 4. Engine — `MergeManager` (`~/mdocxengine`)

New manager exposed as `engine.merge`, main entry:

```
engine.merge.appendDocument(sourceBuffer: Buffer, opts?: { startOnNewPage?: boolean }): void
```

Copies the source body into the current document, fully remapped. Orchestration —
each step produces an `old→new` id map; all maps are applied to the copied block
XML in a single attribute-aware pass:

1. **Parse source** — `getBlocks()` + read `word/numbering.xml`,
   `word/footnotes.xml`, `word/media/*`, `word/_rels/document.xml.rels`,
   `word/styles.xml` from the source package.
2. **Media** — for each image referenced by source blocks, `insertImage()` on the
   target (auto-allocates a new rId + content-type) → map source rId → new rId.
   Remap `r:embed` / `r:link`.
3. **Footnotes** — for each source footnote, `addFootnote()` on the target
   (auto-allocates id) → map source id → new id. Remap `w:footnoteReference/@w:id`.
4. **Numbering (Phase 2)** — copy `w:abstractNum` + `w:num` with fresh ids,
   collision-safe → map source numId → new numId. Remap `w:numPr/w:numId/@w:val`.
5. **Styles** — map source paragraph/character `styleId` → the target's
   norm-profile style **by name**; unmatched → `Normal`. (Normalization means we
   do not copy source style definitions — we retarget to the template's styles.)
   Phase 1 handles headings + Normal; Phase 2 broadens coverage.
6. **Remap pass** — rewrite the mapped attributes inside the copied block strings.
   **Attribute-aware** (targeted per element), scoped to copied blocks only — never
   a blind global replace, so identically-named attributes elsewhere are untouched.
7. **Page break** — if `startOnNewPage`, prepend a page/section break to the first
   copied block.
8. **Append** — `saveBlocks([...existingBlocks, ...remappedSourceBlocks])`.

**Equations (OMML)** are inline in the paragraph XML and are copied verbatim by the
block copy — no remap needed (Phase 1, effectively free).

**Reused primitives (already exist):** `getBlocks/saveBlocks/insertBlockAt`,
`MediaManager.insertImage`, `RelManager.genId/addRelationship`,
`FootnoteManager.getFootnotes/addFootnote/createFootnoteRun`,
`ContentTypesManager.addDefault/addOverride`, `StylesManager.listStyles/getStyle/addStyle`.
**To build:** abstractNum read/copy in `NumberingManager` (Phase 2), the id-remap
pass, style name-mapping, the `MergeManager` orchestrator.

**Engine tests (correctness lives here):** per-feature fixtures (one image, one
footnote, one numbered list, one equation, one table). Merge two → assert image
bytes present and `r:embed` resolves, footnote text preserved + renumbered, list
continuous, no duplicate rIds, equation intact, and the result opens in
Word/OnlyOffice. Model after existing `src/integration/*.spec.ts`.

## 5. Server — combine endpoints (`~/modakerati-server`)

Two new static routes on the thesis router, registered **before** `/:id`.

### `POST /api/thesis/combine/classify`
Called after upload, before the arrange screen. Pure analysis — persists nothing.
- **In:** `{ parts: [{ filename, base64 }] }`
- For each part: `Mdocxengine.loadFromBuffer()` → extract first ~1–2k chars of text
  + heading list (reuse the import-analysis extraction).
- One **batched** AI call classifies each part into a fixed role enum and proposes
  a `suggestedTitle`.
- Role enum: `introduction | revue_litterature | partie_theorique |
  methodologie | partie_pratique | resultats | discussion | conclusion |
  annexe | autre`.
- **Out:** `{ parts: [{ filename, suggestedTitle, role, wordCount, pageCount }],
  suggestedOrder: [filename...] }` where `suggestedOrder` sorts by the canonical
  role sequence above.

### `POST /api/thesis/combine`
Called on "Combine". The only call that writes a thesis.
- **In:** `{ title, normProfileId, parts: [{ filename, base64, title, order }] }`
  (client sends parts already ordered).
- **Steps:**
  1. Create the thesis row (`docMode: "live-docx"`), seeded from `thesis-base.docx`
     so cover + base styles exist. Load its engine.
  2. Sort parts by `order`. For each part in order:
     - insert a part-title `Heading 1` block (the user's `title`),
     - `engine.merge.appendDocument(sourceBuffer, { startOnNewPage: true })`.
  3. **Normalize** — run the existing `applyFormattingToXml()` / norm-profile
     formatting over the whole merged document.
  4. `uploadDocx()` the result; persist `wordCount` / `pageCount`.
  5. Run `buildAnalysisReport()` and store it on the thesis row.
- **Out:** `{ thesis, analysisReport }` — **identical shape to `importThesis`**, so
  the app reuses the import result handling and the analysis screen.

**Limits:** per-file cap (reuse import's), total payload cap ≈ 50 MB, max parts ≈ 6.
Validate base64 + filename per part; reject empty/zero-block sources with a clear error.

## 6. App — combine flow (`~/modakerati`)

New **"Combine documents"** entry point beside "Import Document" on the home screen
(`app/(tabs)/index.tsx`). New `combine-store` (Zustand) mirroring `import-store`.

**Flow**
1. Multi-pick `.docx` (`expo-document-picker`, `multiple: true`).
2. Upload all → `POST /combine/classify` → draft parts with suggested titles/roles
   and default order.
3. **Arrange screen** (`app/(app)/combine-arrange.tsx`):
   - drag-to-reorder list (default = AI `suggestedOrder`),
   - per row: editable **Title** field, role chip, word/page count, remove button,
   - one **norm-profile picker** (reuse existing component),
   - "Combine" button.
4. `POST /combine` → new thesis → navigate to the workspace (same as import).
5. Optionally surface the analysis report (reuse `import-analysis.tsx`).

**`combine-store` state**
- `parts: { id, filename, base64, suggestedTitle, title, role, order, wordCount, pageCount }[]`
- `normProfileId`, `status: idle | classifying | arranging | combining | done | error`, `error`
- actions: `pickAndUpload()`, `reorder(from,to)`, `setTitle(id,title)`,
  `removePart(id)`, `setNormProfile(id)`, `combine()`, `reset()`.

**API client** (`lib/api.ts`): `classifyCombineParts(parts)` and
`combineThesis({ title, normProfileId, parts })` returning the `importThesis` shape.

**i18n:** add en/fr/ar strings for the entry point, arrange screen, role labels,
and errors (trilingual mandate).

## 7. Error handling & edge cases

- **A source fails to load / 0 editable blocks** → fail that part with a named
  error; let the user remove it and retry (don't abort the whole batch silently).
- **Duplicate filenames** → disambiguate by index; titles are user-owned anyway.
- **rId / numId / footnote-id collisions** → always allocate via the target's
  `genId`/`addFootnote`/numbering allocator; never trust source ids.
- **Remap must be scoped** to copied blocks only — guard against rewriting
  attributes in pre-existing target blocks.
- **Normalization vs. fidelity tension** → text formatting is normalized to the
  template; embedded objects (images/equations/footnotes/tables) are preserved.
- **Large merges** → enforce caps (§5); stream/transcode nothing unnecessarily.
- **AI classification low-confidence** → still return `autre` + filename-derived
  title; never block the flow on classification.

## 8. Testing strategy

- **Engine (primary):** per-feature merge fixtures + assertions (§4); opens-in-Word
  smoke. This is where merge correctness is proven.
- **Server:** `/combine/classify` returns roles/order for a known set; `/combine`
  produces a thesis whose outline shows N titled `Heading 1` sections, each on a new
  page, with preserved images/footnotes; analysis report present.
- **App:** store-level tests for reorder/title/remove; flow smoke from pick →
  arrange → combine → workspace.

## 9. Phasing / sequencing

1. **Engine Phase 1** — `MergeManager.appendDocument` (blocks + images + footnotes
   + equations + page break + heading/Normal style map) + tests. Publish/consume.
2. **Server** — `/combine/classify` + `/combine` wired to the Phase-1 engine.
3. **App** — `combine-store`, entry point, arrange screen, API client, i18n.
4. **Engine Phase 2** — numbered-list (abstractNum) remap + fuller style mapping +
   hyperlink/endnote remap; server/app pick it up transparently.

Ship after step 3 as the usable MVP; step 4 hardens to the full fidelity bar.
"Make it best" work (richer role detection, smarter title suggestions, header/footer
strategy, per-part formatting overrides) is deliberately deferred.
