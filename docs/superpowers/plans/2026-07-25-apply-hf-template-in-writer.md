# Apply Header/Footer Studio Templates in the Writer — Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` for tracking.

**Goal:** From the writer's header band bubble, let a user pick one of the staff-authored **HF Studio templates** (dashboard `/d/header-footer-templates`, stored in `header_footer_templates`) and apply it to the current Word section at **full OOXML fidelity** — tab-stop segments, Word tables (shading/borders/merge), live page-number/STYLEREF/TITLE fields, **and embedded logo images**. A template bundles a header + footer + page-number options; applying it sets all three for the section containing the band.

**Decisions locked (from the user):** source = dashboard Studio templates (not built-in presets); fidelity = full OOXML incl. logos.

**Layers:** mdocxengine (image-in-header-part embedding + a `Doc.applySectionChrome` seam) → modakerati-server (list endpoint + apply-mode compile + `applyTemplate` chrome op) → modakerati app (list/apply wrappers + a `hfTemplate` picker panel in the chrome bubble + i18n).

---

## ⚠️ Cross-repo verification + safety (read first)

- **Engine (`~/mdocxengine`):** has **vitest**. After ANY `src/` change run `npm run build` (dist is gitignored, symlinked into the server, and **shared with other running sessions + production doc generation** — a bad header-rels write can corrupt real theses' `.docx`). Gate: `npm test` green + the new apply spec green + `npx tsc --noEmit`.
- **Server (`~/modakerati-server`):** has **vitest**. Gate: `npm run build` (tsc) clean + `npm test` green. Must restart to pick up the rebuilt engine dist + any new DTO/route.
- **App (`~/modakerati`):** **no JS test runner.** Gate: `cd ~/modakerati && npx tsc --noEmit` clean + on-device visual check. Do not add jest/vitest.
- **Git (parallel sessions):** the user runs concurrent sessions with uncommitted WIP across these repos. Every commit `git add` the **exact paths only** — never `-A`/`.`. Fresh commits, never `--amend`. Re-check `git status` if anything looks off. Standard trailer on every commit.
- **Locales:** `locales/{en,fr,ar}.json` have **duplicate keys** — edit surgically, never `JSON.parse`/`stringify`.

---

## Phase A — Engine: embed logos into a header/footer part + `Doc.applySectionChrome`

**Files (mdocxengine):**
- Modify: `src/core/PartsManagers/MediaManager.ts` — add `addImagePart(bytes, ext)` (write media bytes + content-type Default, NO document rel).
- Modify: `src/core/PartsManagers/HeaderManager.ts` + `FooterManager.ts` — add `embedImageInPart(partPath, bytes, ext): Promise<string>` returning a **part-local** `r:embed` id (creates `word/_rels/<partName>.xml.rels` if missing, via `new RelManager(zip, partRelsPath)`).
- Modify: `src/Doc.ts` — add `ChromeImage` type + `applySectionChrome(blockIndex, parts)`.
- Add: `src/Doc.applyChrome.spec.ts` — vitest asserting a Word-valid package.

- [ ] **A1 — `MediaManager.addImagePart`.** Mirror `insertImage` (MediaManager.ts:169) steps 1–3 (next `word/media/imageN.<ext>` path → `zip.addFile` → `contentTypes.addDefault(ext, contentType)`) but **do not** add the document-scoped relationship. Return `{ imagePath }`. Reuse the existing `CONTENT_TYPE_MAP` + next-path scan. (Rationale: the naive `insertImage` leaks an unusable `word/_rels/document.xml.rels` image rel that won't resolve inside a header.)

- [ ] **A2 — part-local image rel.** In `HeaderManager` add:
  ```ts
  // partPath e.g. "word/header1.xml" -> rels "word/_rels/header1.xml.rels".
  async embedImageInPart(partPath: string, bytes: Buffer, ext: string): Promise<string> {
    const { imagePath } = await this.media.addImagePart(bytes, ext); // A1 (inject MediaManager)
    const partName = partPath.replace(/^word\//, "");
    const relsPath = `word/_rels/${partName}.rels`;
    if (!this.zip.getEntry(relsPath)) {
      this.zip.addFile(relsPath, Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`));
    }
    const rels = new RelManager(this.zip, relsPath);
    const relId = await rels.genId();
    await rels.addRelationship(relId, IMAGE_REL_TYPE, `media/${imagePath.replace(/^word\/media\//, "")}`);
    return relId;
  }
  ```
  `HeaderManager` needs a `MediaManager` handle (pass in ctor, matching how it already gets `rels`/`contentTypes`) and `IMAGE_REL_TYPE` (= `MediaManager`'s image rel type). **VERIFY:** `RelManager.genId()`/`addRelationship()` read+write the given `relsPath` and tolerate a freshly-seeded empty `<Relationships>` (that's why we seed it). `FooterManager` gets the identical method.

- [ ] **A3 — `Doc.applySectionChrome`.** Add near `setSectionHeader`/`setSectionFooter` (Doc.ts:1045):
  ```ts
  export type ChromeImage = { token: string; bytes: Buffer; ext: string };
  export type ChromePart = { xml: string; images: ChromeImage[] };   // xml = region body, NOT wrapped
  async applySectionChrome(blockIndex: number, parts: {
    header?: ChromePart; footer?: ChromePart;
    pageNumber?: { format: "decimal"|"lowerRoman"|"upperRoman"; startAt: number };
    differentFirstPage?: boolean;
  }): Promise<this>
  ```
  Body:
  1. `const sectionIndex = await this.resolveSection(blockIndex);` (reuse the private, Doc.ts:1075).
  2. For header (mirror for footer):
     - Wrap the region body in a namespaced part: `<w:hdr xmlns:w=… xmlns:r=… xmlns:a=… xmlns:wp=… xmlns:pic=…>${parts.header.xml}</w:hdr>` (always include the DrawingML namespaces so image runs are valid). Provide a `HDR_NS`/`FTR_NS` const.
     - `const { headerPath, relId } = await this.engine.header.addHeader("", "default", wrappedXml, { registerInSectPr: false });`
     - For each `img` in `parts.header.images`: `const rid = await this.engine.header.embedImageInPart(headerPath, img.bytes, img.ext);` then `wrappedXml = wrappedXml.split(img.token).join(rid);`
     - `await this.engine.header.updateHeader(headerPath, wrappedXml);` (HeaderManager.ts:233 — rewrites bytes, no rel churn).
     - `await this.engine.sections.setSectionHeader(sectionIndex, relId, "default");`
  3. Page-number options: apply `pageNumber.format`/`startAt` to the section's sectPr. Prefer a section-scoped path; if only body-scoped `formatPageNumbers` exists, apply to body sectPr and note the limitation. `differentFirstPage` → `setDifferentFirstPage(true)` (body-level; per-section first-page parts remain deferred — see Deferred).
  4. `return this;`

- [ ] **A4 — spec.** `Doc.applyChrome.spec.ts`: build a 1-section doc, call `applySectionChrome(0, { header: { xml: '<w:p><w:r><w:drawing>…<a:blip r:embed="__IMG0__"/>…</w:drawing></w:r></w:p>', images:[{token:"__IMG0__",bytes:PNG,ext:"png"}] } })`. Assert: `word/header1.xml` exists & contains no literal `__IMG0__` (token replaced); `word/_rels/header1.xml.rels` exists with an `…/image` relationship whose Id === the `r:embed` in header1.xml and Target `media/image1.png`; `[Content_Types].xml` has a `png` Default; body/section sectPr has a `<w:headerReference r:id=…>` pointing at the part's rel. Use a tiny 1×1 PNG buffer.

- [ ] **A5 — build + gate.** `cd ~/mdocxengine && npm run build && npm test && npx tsc --noEmit` → all clean. Commit (exact paths).

---

## Phase B — Server: list endpoint + apply-mode compile + `applyTemplate` op

**Files (modakerati-server):**
- Modify: `src/lib/hf-template-ooxml.ts` — apply-mode image runs (real `<w:drawing>` with an embed token) + export an apply compile.
- Add: `src/lib/hf-template-apply.ts` — orchestrator: load template → fetch logos from storage → compile → call `Doc.applySectionChrome`.
- Modify: `src/routes/thesis/blocks.ts` — add `applyTemplate` case to `/:id/chrome-op`.
- Add: `src/routes/hf-templates-public.ts` (or extend an authed api group) — `GET /api/hf-templates`.
- Modify: `src/index.ts` — mount the public list route in the **authed** `/api` group (user Bearer, not admin token).
- Tests: extend `hf-template-ooxml` spec for the image-run path.

- [ ] **B1 — apply-mode image runs.** In `hf-template-ooxml.ts`, the `image` branch (line 49-53) currently emits `[logo]` text. Add an **apply context** variant: when compiling for apply, emit a real inline drawing referencing a per-image token, and collect `{ token, assetPath, widthEmu, heightEmu }`:
  ```ts
  // widthPt/heightPt -> EMU (1pt = 12700 EMU).
  function imageRunXml(token: string, wEmu: number, hEmu: number, name: string): string { /* <w:r><w:drawing><wp:inline><wp:extent cx=wEmu cy=hEmu/>…<a:blip r:embed="token"/>… */ }
  ```
  Implement as an opt-in: add `compileTemplateForApply(model): { headerXml, footerXml, sectPr, images: {token,assetPath,widthEmu,heightEmu}[], warnings }` that shares all the existing block/table/paragraph builders but swaps the `image` element to `imageRunXml` + pushes to `images` (token = `__HFIMG_${n}__`). Keep the existing `compileTemplate` (preview/`[logo]`) untouched so the dashboard compile route is unaffected. Add a unit test asserting the drawing XML + token collection.

- [ ] **B2 — apply orchestrator (`hf-template-apply.ts`).**
  ```ts
  export async function applyHfTemplateToSection(doc: Doc, templateId: string, blockIndex: number): Promise<{ warnings: string[] }>
  ```
  1. `db.select().from(headerFooterTemplates).where(and(eq(id,templateId), eq(isActive,true)))` → 404-style throw if missing.
  2. `compileTemplateForApply(row.model)`.
  3. For each `images[]`: download bytes from the public bucket — `supabaseAdmin.storage.from(process.env.HF_ASSETS_BUCKET ?? "hf-template-assets").download(assetPath)` → `Buffer`; infer ext from assetPath. Skip (warn) any that 404.
  4. `await doc.applySectionChrome(blockIndex, { header: { xml: headerXml, images: hdrImgs }, footer: { xml: footerXml, images: ftrImgs }, pageNumber: row.model.options.pageNumber, differentFirstPage: row.model.options.differentFirstPage });`
     - Split `images[]` into header vs footer by which region's XML contains the token.
  5. Return warnings. (Bytes → `Buffer`, matching engine `ChromeImage.bytes`.)

- [ ] **B3 — `applyTemplate` chrome op.** In `blocks.ts` `/:id/chrome-op` switch (after `linkToPrevious`, ~line 609), add:
  ```ts
  } else if (op === "applyTemplate") {
    const templateId = String((body as {templateId?: unknown}).templateId ?? "");
    if (!templateId) return { error: "templateId required" };
    const { warnings } = await applyHfTemplateToSection(doc, templateId, index);
    label = "Apply header/footer template";
    // (optional) surface warnings via the existing `note` echo channel.
  }
  ```
  It flows through the existing `persistThesisDocx` + `buildDocumentDTOFromEngine` echo — no new endpoint, so the app's optimistic-doc path is unchanged.

- [ ] **B4 — `GET /api/hf-templates`.** New authed route (Bearer user; the group that sets `c.get("userId")`). Returns active templates, newest first, optional `?language=`:
  ```ts
  // -> { templates: { id, name, language, university, discipline, updatedAt }[] }
  ```
  Select only list columns (never the full `model`/OOXML — keep it light). Mount in `src/index.ts` under the authed `/api` group (NOT `/admin`).

- [ ] **B5 — gate.** `cd ~/modakerati-server && npm run build && npm test` clean. Restart server (new engine dist + route). Commit exact paths.

---

## Phase C — App: list/apply wrappers + `hfTemplate` picker in the chrome bubble

**Files (modakerati):**
- Modify: `lib/api.ts` — `HfTemplateSummary` type, `listHfTemplates(language?)`, and `applyTemplate` added to the `ChromeOp` union.
- Modify: `components/workspace/BlockContextBar.tsx` — new `hfTemplate` category + chip (top band) + picker panel.
- Modify: `locales/{en,fr,ar}.json` — `workspace.hf.templates*` keys (surgical).

- [ ] **C1 — api wrappers.** In `lib/api.ts`:
  ```ts
  export type HfTemplateSummary = { id: string; name: string; language: string; university: string | null; discipline: string | null };
  export async function listHfTemplates(language?: string): Promise<{ templates: HfTemplateSummary[] }> {
    return apiGet(`/api/hf-templates${language ? `?language=${encodeURIComponent(language)}` : ""}`);
  }
  ```
  Add to `ChromeOp` (line 1098): `| { op: "applyTemplate"; index: number; templateId: string }`. (`chromeOp()` already posts to `/chrome-op` and echoes `document` — no new wrapper needed.)

- [ ] **C2 — `hfTemplate` picker panel.** In `BlockContextBar.tsx`:
  - Add `"hfTemplate"` to the `Category` union (line 89) and to the `!isChrome` skip-guard (line 948).
  - On the `top` band tools (line 810-815), add a chip (icon `LayoutTemplate` from lucide) `openHfTemplates` that sets `activeCategory = "hfTemplate"`.
  - Add a panel branch in the sub-pill renderer (~after the `hfAI` branch, line 1055): on open, `listHfTemplates(rtl ? "ar" : undefined)` into local state (loading/list/error); render a horizontal scroll of template chips (name + tiny lang/university caption). Tapping one calls `applyChrome({ op: "applyTemplate", index: chrome.index, templateId })` (reuses the existing `applyChrome` helper at line 736 → optimistic doc echo) and closes the panel. Show a spinner while applying.
  - Keep it dismissible (tap outside / band deselect already collapses the bubble).

- [ ] **C3 — i18n.** Surgically add to each `hf` block (after `ask`): `templates` ("Templates"/"Modèles"/"القوالب"), `templatesPick` ("Choose a header template" / …), `templatesEmpty`, `templatesApplying`, `templatesError`. Verify each file still `require()`s.

- [ ] **C4 — gate.** `cd ~/modakerati && npx tsc --noEmit` clean. On device: multi-section Arabic thesis → select a header band → **Templates** chip → picker lists real Studio templates → tap one → header band re-renders with the template's segments/table/logo after the doc reloads; footer + page numbers updated too. Trilingual + RTL correct. Commit exact paths.

---

## Deferred (explicit non-goals for v1)

- **Different-first-page parts** (`model.firstPage`): the compiler already warns; per-section first-page header/footer install is out of scope (body-level `titlePg` only).
- **Vertical (rowSpan) cell merge** — compiler already ignores + warns.
- **Editing a template from the app** — creation/edit stays in the dashboard Studio.
- **Undo of an applied template** beyond the existing doc-history snapshot ring (`persistThesisDocx` already snapshots, so the global undo covers it).

## Risk register

1. **Header-part `_rels` (A2)** — the only novel docx plumbing; a bad rel/embed = broken logo or a corrupt part. Mitigation: the A4 Word-validity spec + testing on a real device in Word before shipping.
2. **Shared engine dist** — rebuild affects other sessions/production. Mitigation: keep all engine changes additive (new methods only; do not alter existing `insertImage`/`addHeader` behavior); land + verify tests before the server restart.
3. **Section index resolution** — reuse `Doc.resolveSection` (already correct for block→section); do not hand-roll paragraph math.
