# L0-fix — Replace fast-xml-parser body round-trip with a string-level splitter

**Why:** the fast-xml-parser `preserveOrder` implementation of `OrderedBody` **silently deletes tables** on the real El Bayadh template — it mis-nests two sibling `<w:tbl>` inside paragraph 0's run, and `editParagraphText` (which rebuilds the paragraph's children) then discards them. Identity round-trip looked fine; an actual edit loses data. The golden specs used clean fixtures and missed it. Verified independently against `elbayadh-staps-template.docx` (4 tbl → 2 tbl after editing the cover paragraph).

**Fix:** reimplement `OrderedBody` as a **string-level, depth-aware body splitter** that never re-serializes untouched blocks. Each top-level child of `<w:body>` is kept as its **exact original XML substring**. This makes identity round-trip byte-perfect by construction and makes it impossible for a paragraph edit to corrupt a sibling table. Removes the vendored `fast-xml-parser`/`strnum` dependency entirely.

**Repo:** `/Users/hamzasafwan/mdocxengine`. Keep the SAME public API on `DocumentManager` (`getBlocks`/`saveBlocks`/`editParagraphText`/`insertBlockAt`/`deleteBlockAt`) and the SAME exported types (`BodyBlock`/`BlockKind`) — only the internals change. Do not touch xml2js paths used elsewhere.

---

## Block model (string-based)
```typescript
export type BlockKind = "paragraph" | "table" | "sectPr" | "other";
export interface BodyBlock { kind: BlockKind; tag: string; xml: string; } // xml = exact original substring of this top-level child
```

## Task 1 — string splitter core (`src/core/files/body/OrderedBody.ts`, rewrite)
Implement, with NO XML library (pure string scanning):
- `splitDocument(documentXml: string): { pre: string; bodyOpen: string; blocks: BodyBlock[]; post: string }` — locate `<w:body ...>` (its open tag, possibly with attrs; could be `<w:body>`), and the matching `</w:body>`. `pre` = everything up to & including `<w:body...>`; `post` = `</w:body>` and everything after (e.g. trailing whitespace). `blocks` = the top-level children in order. **Edge:** a self-closing `<w:body/>` (no children) → empty blocks.
- The scanner walks the body inner XML tracking element depth. At depth 0 it identifies each top-level element: read its tag name from `<w:NAME` (namespaced). Handle: self-closing tags (`<w:p/>` → one block, depth-neutral), normal open/close pairs (advance depth, capture from `<w:NAME` to its matching `</w:NAME>`), attributes containing `>` inside quotes (ignore `>`/`<` while inside a quoted attribute value), XML comments `<!-- ... -->` and processing instructions/CDATA (skip/attach as "other"). Whitespace/text between top-level children is rare in document.xml but if present, attach it to the following block's leading or keep as an "other" text block so join is loss-less. **Whatever the scheme, `blocks.map(b=>b.xml).join("")` reconstructed with pre/post MUST equal the original body region byte-for-byte.**
- `kindOf(tag)`: `w:p`→paragraph, `w:tbl`→table, `w:sectPr`→sectPr, else other.
- `assembleDocument({pre, blocks, post})` (or reuse the split parts): `pre + blocks.map(b=>b.xml).join("") + post`. Byte-identical when blocks unchanged.
- `makeParagraphXml(text, styleId?, rtl?): string` — returns `<w:p>(<w:pPr>(<w:pStyle w:val="ID"/>)(<w:bidi/>)</w:pPr>)?<w:r><w:t xml:space="preserve">ESCAPED</w:t></w:r></w:p>`. Escape `& < > " '` in text.
- `paragraphText(xml: string): string` — concatenate the decoded contents of all `<w:t ...>...</w:t>` in the block (handle `<w:t/>` empty, and decode the 5 XML entities).
- `paragraphStyleId(xml: string): string | null` — extract `<w:pStyle w:val="...">` if present.
- `setParagraphText(paragraphXml: string, text: string): string` — **in-place, run-preserving where it matters:**
  - If the paragraph contains a `<w:drawing>`, `<w:pict>`, or `<w:object>` (an image/embedded object), DO NOT strip runs — instead replace only the text inside the FIRST `<w:t>` (or append a text run after pPr if none) and leave drawing runs intact. (Defends against ever destroying an inline image.)
  - Otherwise (plain text paragraph): preserve `<w:pPr>...</w:pPr>` (if any) and replace ALL `<w:r>...</w:r>` runs with a single `<w:r><w:t xml:space="preserve">ESCAPED</w:t></w:r>`. Keep everything in `<w:pPr>` (style, bidi, alignment) untouched.
  - Operates ONLY on the given paragraph's XML string — cannot affect any other block.

## Task 2 — DocumentManager methods (adapt to string blocks)
Rewrite the bodies of `getBlocks/saveBlocks/editParagraphText/insertBlockAt/deleteBlockAt` to use the new string model:
- `getBlocks()`: read `word/document.xml`, `splitDocument`, return `blocks.filter(b => b.kind !== "sectPr")`? — NO: keep returning ALL editable blocks but EXCLUDE the trailing `w:sectPr` from the indexable list, consistent with before. (Match the prior index semantics: index = position among non-sectPr blocks.) Document the exact semantics in a comment.
- `saveBlocks(blocks)`: reassemble = pre + (given blocks, in order, joined) + the preserved trailing sectPr (and post). Write `word/document.xml` via `zip.addFile`. **Important:** preserve the original sectPr block exactly; callers pass only the editable blocks.
- `editParagraphText(index, text)`: split, find the index-th editable block, assert it's a paragraph, `block.xml = setParagraphText(block.xml, text)`, reassemble, write. Untouched blocks keep exact bytes.
- `insertBlockAt(block, index)` / `deleteBlockAt(index)`: splice the editable-block list, reassemble, write.
- `makeParagraphNode(text, styleId?, rtl?)` (keep the exported name for API stability) now returns a `BodyBlock` `{kind:"paragraph", tag:"w:p", xml: makeParagraphXml(...)}`.

## Task 3 — tests (the real bug must be covered)
- Update `OrderedBody.spec.ts`: identity round-trip on an interleaved fixture is **byte-identical** now (assert string equality, not just structural). Split→assemble round-trips a fixture with attrs, self-closing tags, nested tables-in-cells, a drawing, escaped entities, and sectPr → byte-identical.
- Update `DocumentManager.blocks.spec.ts`: existing cases + insert/delete/order.
- **NEW regression test `DocumentManager.elbayadh.spec.ts` (the gate):** copy `/Users/hamzasafwan/modakerati-server/assets/templates/elbayadh-staps-template.docx` into the engine test fixtures (or read it directly by absolute path in the test). Load → `getBlocks` → record `<w:tbl>` count and `word/media/*` set → `editParagraphText` on a PARAGRAPH block (e.g. the first paragraph block) with a sentinel → `saveBlocks`/reload → assert: sentinel present in exactly that paragraph, **`<w:tbl>` count UNCHANGED (all 4 tables survive)**, `word/media/*` UNCHANGED (logo survives), every other paragraph's text unchanged, sectPr still last. This test MUST FAIL on the old fast-xml-parser implementation and PASS on the new one.
- Run `npx vitest run OrderedBody DocumentManager.blocks DocumentManager.elbayadh` → all PASS.

## Task 4 — remove vendored fast-xml-parser, rebuild, re-verify
- Remove the `import` of fast-xml-parser from `OrderedBody.ts`. If nothing else in the repo imports it, remove the `vendor/fast-xml-parser` + `vendor/strnum` dirs and the `fast-xml-parser` entry from `package.json` (and any vite `commonjsOptions.include` referencing it). Confirm `grep -r "fast-xml-parser" src/ dist/` is clean after rebuild. (If removal is risky, leave vendor/ but ensure it's unused — prefer removal.)
- Fix the stale `package.json` `main` field: it says `dist/index.cjs.js` but the file is `dist/index.js`; align `main` with the actual emitted file (and `vite.config.ts` fileName) so metadata is correct (resolution already works via `exports`, but fix the dead field).
- `npm run build` → `dist/index.js` + `dist/index.mjs` regenerate, contain the 5 methods, and no longer require an external `strnum`/`fast-xml-parser` at runtime (`grep require dist/index.js` for those names → none).
- Re-run the adversarial harness `scripts/verify-roundtrip.ts` BUT extend it to also do an **edit round-trip** (not just identity): for each real file, `editParagraphText` on a clean paragraph + reload + assert tbl count / media set / other-text unchanged. Run against all 5 real files (copy to /tmp first; never mutate originals):
  - `/Users/hamzasafwan/Downloads/هيكل المذكرة.docx`
  - `/Users/hamzasafwan/modakerati-server/assets/templates/elbayadh-staps-template.docx`
  - `/Users/hamzasafwan/Downloads/memoire qualite final.docx`
  - `/Users/hamzasafwan/Downloads/مذكرة_بلعربي_علي_-_النسخة_النهائية.docx`
  - `/Users/hamzasafwan/Downloads/الجانب_التطبيقي_بوصبيع_قويدر_v3_with_charts.docx`
  ALL must pass identity AND edit round-trips (order, tables, media, text preserved). Report the matrix.

## Definition of done
- `editParagraphText` on the El Bayadh cover paragraph preserves all 4 tables + the logo (regression test proves it).
- Identity round-trip is byte-identical on all 5 real files; edit round-trip preserves tables/media/other-text on all 5.
- Public API + exported types unchanged; server import path still works.
- fast-xml-parser/strnum removed (or provably unused); `main` field fixed; `dist` rebuilt.
- Commit with a clear message referencing the data-loss fix.
