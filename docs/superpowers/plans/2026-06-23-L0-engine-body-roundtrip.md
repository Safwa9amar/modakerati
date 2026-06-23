# L0 — mdocxengine Full-Body Round-Trip (Ordered Blocks)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The keystone of the live-`.docx` migration: the engine must read the document body as an **ordered list of blocks (paragraphs + tables + drawings)** and write it back **preserving order and content exactly**. Everything else depends on this.

**Repo:** `~/mdocxengine` (its own git repo; built to `dist/`, server consumes `dist/`). Test runner: **vitest**.

**Problem (verified):** `src/utils/xmlUtils.ts` `parseXml` uses xml2js with `preserveChildrenOrder: true` but WITHOUT `explicitChildren`/`childkey`, so the body parses into separate `w:p` / `w:tbl` arrays — **document order between paragraphs and tables is lost**. `DocumentManager.saveChanges` rewrites only `w:p`, regrouping tables → scramble. xml2js's `Builder` also can't faithfully round-trip `explicitChildren`'s `$$` form. This is why table-bearing docs are read-only.

**Goal:** add `getBlocks()` / `saveBlocks()` (and edit/insert/delete helpers) to `DocumentManager` that round-trip the body's ordered children — paragraphs, tables, and drawing-bearing paragraphs — with **byte-stable order and preserved content**, including images (media parts) and the trailing `w:sectPr`.

---

## Decision: order-faithful parse/build for the body
xml2js can't cleanly round-trip ordered mixed children. Use **`fast-xml-parser`** (add as an `~/mdocxengine` dependency) **only for the body round-trip path** — its `preserveOrder: true` mode parses to an **ordered array of single-key nodes** and its `XMLBuilder` rebuilds that array faithfully (true order-preserving round-trip). Keep xml2js for everything else (no broad refactor).
- Parse `word/document.xml` with `new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", ... })`.
- The body (`w:document → w:body`) becomes an ordered array of nodes like `{ "w:p": [...], ":@": {attrs} }`, `{ "w:tbl": [...] }`, `{ "w:sectPr": [...] }`.
- Build back with `new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", format: true, suppressEmptyNode: false })`.
- **Validate round-trip is loss-less BEFORE building any API on top** (golden test, below). If `fast-xml-parser` proves unfaithful for some OOXML construct, fall back to a string-level body-children splitter (split the `<w:body>…</w:body>` inner XML into top-level child elements by tag-depth scanning, manipulate as strings, reassemble) — but prefer fast-xml-parser.

> Note: this is a SEPARATE representation from the existing xml2js-based `Paragraph`/`Table` classes. Keep the new ordered-block path self-contained (a new module + new DocumentManager methods); do not break existing `saveChanges`/`insertTable` used by the current export.

---

## Task 1: order-faithful body parser/serializer
**Files:** `~/mdocxengine/package.json` (+`fast-xml-parser`), `src/core/files/body/OrderedBody.ts` (new), test `src/core/files/body/OrderedBody.spec.ts`.

- [ ] **Step 1:** `cd ~/mdocxengine && npm install fast-xml-parser`. Confirm it imports.
- [ ] **Step 2:** Read the existing zip access (`this.zip.readAsText(DOC_PATH)` / `addFile`) + `DocumentManager` to match conventions.
- [ ] **Step 3:** `OrderedBody.ts` — pure helpers:
```typescript
export type BlockKind = "paragraph" | "table" | "sectPr" | "other";
export interface BodyBlock { kind: BlockKind; tag: string; node: any; } // node = the fast-xml-parser ordered node ({ [tag]: [...], ":@"?: {...} })

// Parse full document.xml → { docNodes (ordered top-level), bodyChildren (ordered array ref), body (the w:body node) }
export function parseOrderedDoc(xml: string): { doc: any[]; bodyChildren: any[] };
// Map the body's ordered children to typed blocks (skip sectPr from editable set but keep it for write).
export function toBlocks(bodyChildren: any[]): BodyBlock[];
// Serialize the (possibly mutated) ordered doc back to XML (XMLBuilder preserveOrder).
export function buildOrderedDoc(doc: any[]): string;
// Helpers to make a paragraph node from plain text + optional styleId (fast-xml-parser ordered shape).
export function makeParagraphNode(text: string, styleId?: string, rtl?: boolean): any;
export function paragraphText(node: any): string; // extract concatenated w:t text from a paragraph node
export function paragraphStyleId(node: any): string | null;
```
Implement with `fast-xml-parser` `XMLParser`/`XMLBuilder` (`preserveOrder: true`). The `w:sectPr` is typically the LAST body child — keep it in place. `makeParagraphNode` builds the ordered node for `<w:p><w:pPr>(pStyle)(rtl)</w:pPr><w:r><w:t xml:space="preserve">text</w:t></w:r></w:p>`.
- [ ] **Step 4 — GOLDEN round-trip test (the gate):** `OrderedBody.spec.ts`: take a fixture `document.xml` that interleaves `p, tbl, p, tbl, p-with-drawing` (build a string fixture inline, or read one from a real docx — see Task 3). Assert: `buildOrderedDoc(parseOrderedDoc(xml).doc)` reproduces the SAME ordered sequence of top-level body tags (p,tbl,p,tbl,p) and preserves the `w:tbl` content, the `w:drawing`, attributes, and `w:sectPr`. Compare by re-parsing both and checking the ordered tag list + key contents are equal (don't require byte-identical whitespace, but require structural+order equality). Run `npx vitest run OrderedBody` → PASS.
- [ ] **Step 5:** Commit.

## Task 2: DocumentManager ordered-block API
**Files:** `src/core/PartsManagers/DocumentManager.ts` (+ methods), `src/index.ts` (export types if needed), test `DocumentManager.blocks.spec.ts`.

- [ ] **Step 1:** Add methods that use `OrderedBody` against `word/document.xml` in the zip:
```typescript
async getBlocks(): Promise<BodyBlock[]>                 // ordered, excluding sectPr from the returned editable list (but it stays in the doc)
async saveBlocks(blocks: BodyBlock[]): Promise<void>    // rebuild body children = blocks (in order) + preserved sectPr, write document.xml
async editParagraphText(index: number, text: string): Promise<void>   // replaces the w:t runs of the block at index (must be a paragraph)
async insertBlockAt(block: BodyBlock, index: number): Promise<void>
async deleteBlockAt(index: number): Promise<void>
```
`index` is the position in the ordered editable block list (paragraphs+tables+drawings), NOT counting sectPr. These load the xml, parse ordered, mutate the ordered children, rebuild, and `zip.addFile(DOC_PATH, ...)`.
- [ ] **Step 2:** Tests `DocumentManager.blocks.spec.ts` (vitest, using a fixture docx zip like other specs): 
  - `getBlocks` returns blocks in document order with correct kinds for an interleaved fixture.
  - `editParagraphText(i, "X")` changes only that paragraph's text; re-`getBlocks` confirms; **all tables still present and in the same relative positions**.
  - `insertBlockAt(makeParagraphNode("new"), i)` inserts at the right spot; order preserved.
  - `deleteBlockAt(i)` removes only that block.
  - A drawing/image-bearing paragraph survives an unrelated edit (media part intact).
  Run → PASS.
- [ ] **Step 3:** Build the engine (`npm run build`) so `dist/` has the new API (server consumes `dist/index.js`). Confirm `getBlocks`/`saveBlocks` appear in the build. Commit.

## Task 3: adversarial verification against REAL theses (Ultracode)
**Files:** `scripts/verify-roundtrip.ts` (in `~/mdocxengine`, tsx) — NOT committed to the engine necessarily; a verification harness.

- [ ] **Step 1:** Write a tsx harness that, given a list of real `.docx` paths, for each: `Mdocxengine.loadFromFile(path)` → `getBlocks()` → `saveBlocks(sameBlocks)` (identity round-trip) → save to a temp file → reload → assert: the ordered top-level body tag sequence is unchanged, the `<w:tbl>` count is unchanged, the `word/media/*` image set is unchanged, and the concatenated document text is unchanged (modulo whitespace). Report per-file PASS/FAIL with diffs.
- [ ] **Step 2:** Run it against the user's REAL files (read-only copies): `~/Downloads/هيكل المذكرة.docx` (El Bayadh template — has the logo + 4 tables), `~/Downloads/memoire qualite final.docx` (French nursing, tables/figures), `~/Downloads/مذكرة_بلعربي_علي_-_النسخة_النهائية.docx` (Arabic, RTL), `~/Downloads/الجانب_التطبيقي_بوصبيع_قويدر_v3_with_charts.docx` (charts/images), and `~/modakerati-server/assets/templates/elbayadh-staps-template.docx`. (Copy each to /tmp first; never mutate the originals.) ALL must round-trip loss-lessly (order + tables + images + text).
- [ ] **Step 3:** Report the matrix. If ANY file fails, that's a real defect — fix `OrderedBody` (or fall back to the string-splitter approach) until all pass. This is the correctness gate for the whole migration.

## Definition of done (L0)
- `mdocxengine` exposes `getBlocks/saveBlocks/editParagraphText/insertBlockAt/deleteBlockAt` that preserve body order, tables, images, and `sectPr`.
- Golden spec + the adversarial real-docx matrix all PASS (incl. the El Bayadh template with its 4 tables + logo).
- `dist/` rebuilt; server can import the new API.

## Out of scope (later L-phases)
- Storage/creation (L1), AI block tools (L2), migration (L3), charts (L4). L0 is purely the engine round-trip + its verification.
