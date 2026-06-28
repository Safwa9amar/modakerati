# Combine Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload several `.docx` parts and combine them — user-ordered, each part a titled section starting on a new page, formatting normalized — into one new `live-docx` thesis that opens in the workspace.

**Architecture:** A native cross-document merge primitive (`MergeManager.appendDocument`) in `~/mdocxengine` copies a source doc's body blocks into a target and remaps image rIds / footnote ids (Phase 1) and numbering ids / styles (Phase 2). Two new Hono endpoints in `~/modakerati-server` (`POST /api/thesis/combine/classify` for AI part-classification, `POST /api/thesis/combine` for the merge) reuse the existing seed/normalize/analysis machinery. A new `combine-store` + arrange screen in `~/modakerati` mirrors the import flow.

**Tech Stack:** TypeScript, mdocxengine (xml2js, adm-zip), Hono + Drizzle + Supabase storage, OpenRouter (AI), Expo SDK 56 / React Native, Zustand, react-i18next.

**Spec:** `docs/superpowers/specs/2026-06-28-combine-documents-design.md`

**Test runners:** `vitest` in both `~/mdocxengine` (`npm run test:ci`) and `~/modakerati-server` (`npm test`). Engine fixtures live in `~/mdocxengine/samples/`.

---

## Phase 1 — Engine: `MergeManager` (blocks + images + footnotes + equations + page break + light styles)

### Task 1: MergeManager scaffold + append plain blocks

**Files:**
- Create: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/MergeManager.ts`
- Modify: `/Users/hamzasafwan/mdocxengine/src/index.ts` (import + property + constructor + export)
- Test: `/Users/hamzasafwan/mdocxengine/src/integration/merge-manager.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/integration/merge-manager.spec.ts
import { describe, test, expect } from "vitest";
import { Mdocxengine, makeParagraphNode } from "@/index";

async function docWith(paragraphs: string[]): Promise<Buffer> {
  // Build a minimal doc by loading the base sample and replacing its body.
  const e = await Mdocxengine.loadFromFile("samples/example.docx");
  await e.document.saveBlocks(paragraphs.map((p) => makeParagraphNode(p)));
  return e.zip.toBuffer();
}

describe("MergeManager.appendDocument", () => {
  test("appends source body blocks after target blocks", async () => {
    const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A", "TARGET-B"]));
    const sourceBuf = await docWith(["SOURCE-X", "SOURCE-Y"]);

    await target.merge.appendDocument(sourceBuf);

    const blocks = await target.document.getBlocks();
    const texts = blocks.map((b) => b.xml).join("");
    expect(texts).toContain("TARGET-A");
    expect(texts).toContain("SOURCE-X");
    expect(texts).toContain("SOURCE-Y");
    // order: target before source
    expect(texts.indexOf("TARGET-B")).toBeLessThan(texts.indexOf("SOURCE-X"));
  });

  test("leadingBlocks are inserted before the copied body", async () => {
    const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A"]));
    const sourceBuf = await docWith(["BODY-1"]);

    await target.merge.appendDocument(sourceBuf, {
      leadingBlocks: [makeParagraphNode("PART TITLE", "Heading1")],
    });

    const xml = (await target.document.getBlocks()).map((b) => b.xml).join("");
    expect(xml.indexOf("PART TITLE")).toBeLessThan(xml.indexOf("BODY-1"));
  });

  test("startOnNewPage prepends a page break before everything appended", async () => {
    const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A"]));
    const sourceBuf = await docWith(["BODY-1"]);

    await target.merge.appendDocument(sourceBuf, { startOnNewPage: true });

    const xml = (await target.document.getBlocks()).map((b) => b.xml).join("");
    expect(xml).toContain('w:type="page"');
    expect(xml.indexOf('w:type="page"')).toBeLessThan(xml.indexOf("BODY-1"));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd ~/mdocxengine && npx vitest run src/integration/merge-manager.spec.ts`
Expected: FAIL — `target.merge` is undefined.

- [ ] **Step 3: Implement the MergeManager scaffold**

```typescript
// src/core/PartsManagers/MergeManager.ts
import AdmZip from "adm-zip";
import { Mdocxengine } from "@/index";
import { DocumentManager } from "./DocumentManager";
import { BodyBlock, makeParagraphXml } from "@/core/OrderedBody"; // adjust import path to where OrderedBody lives

const PAGE_BREAK_XML =
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function pageBreakBlock(): BodyBlock {
  return { kind: "paragraph", tag: "w:p", xml: PAGE_BREAK_XML };
}

export interface AppendOptions {
  startOnNewPage?: boolean;
  leadingBlocks?: BodyBlock[];
}

export class MergeManager {
  private zip: AdmZip;
  private document: DocumentManager;

  constructor(zip: AdmZip) {
    this.zip = zip;
    this.document = new DocumentManager(zip as any);
  }

  /** Copy a source .docx body into this document, fully remapped. */
  async appendDocument(sourceBuffer: Buffer, opts: AppendOptions = {}): Promise<void> {
    const source = await Mdocxengine.loadFromBuffer(sourceBuffer);
    let srcBlocks = await source.document.getBlocks();

    // Phase 2 hooks (media/footnote/numbering/style remap) wrap srcBlocks here.
    srcBlocks = await this.copyAndRemap(source, srcBlocks);

    const existing = await this.document.getBlocks();
    const prefix: BodyBlock[] = [];
    if (opts.startOnNewPage) prefix.push(pageBreakBlock());
    if (opts.leadingBlocks?.length) prefix.push(...opts.leadingBlocks);

    await this.document.saveBlocks([...existing, ...prefix, ...srcBlocks]);
  }

  /** Phase 1: pass-through. Later tasks add media + footnote + numbering remap. */
  protected async copyAndRemap(_source: Mdocxengine, blocks: BodyBlock[]): Promise<BodyBlock[]> {
    return blocks;
  }
}
```

NOTE for implementer: confirm the real import path of `BodyBlock` / `makeParagraphXml`. Per the engine digest they are exported from `@/index` (OrderedBody helpers re-exported). If `@/core/OrderedBody` is wrong, use `import { BodyBlock } from "@/index"`. Do not invent a path — grep first: `grep -rn "export interface BodyBlock" ~/mdocxengine/src`.

- [ ] **Step 4: Wire into Mdocxengine**

In `/Users/hamzasafwan/mdocxengine/src/index.ts`:
```typescript
import { MergeManager } from "./core/PartsManagers/MergeManager";
// in the class:
merge: MergeManager;
// in the constructor (after this.sections = ...):
this.merge = new MergeManager(zip as any);
// in the exports block:
export { MergeManager };
export type { AppendOptions } from "./core/PartsManagers/MergeManager";
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd ~/mdocxengine && npx vitest run src/integration/merge-manager.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/mdocxengine
git add src/core/PartsManagers/MergeManager.ts src/index.ts src/integration/merge-manager.spec.ts
git commit -m "feat(merge): MergeManager.appendDocument copies+orders source body blocks"
```

---

### Task 2: Copy images & remap `r:embed` / `r:link`

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/MergeManager.ts`
- Test: `/Users/hamzasafwan/mdocxengine/src/integration/merge-manager.spec.ts`

Source images are referenced inside copied block XML as `r:embed="rIdN"` (and occasionally `r:link="rIdN"`) within `<a:blip>`. We copy each referenced image into the target (new rId via `MediaManager.insertImage`) and rewrite those attribute values in the copied blocks.

- [ ] **Step 1: Write the failing test** (uses a fixture that contains an image — `samples/hanachi.docx` per digest has media; verify with `unzip -l samples/hanachi.docx | grep media`)

```typescript
test("copies images and remaps r:embed so the rId resolves in target", async () => {
  // hanachi.docx contains at least one image
  const sourceBuf = fs.readFileSync(path.resolve("samples/hanachi.docx"));
  const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A"]));

  const beforeImgs = target.media.listImages().length;
  await target.merge.appendDocument(sourceBuf);

  const afterImgs = target.media.listImages();
  expect(afterImgs.length).toBeGreaterThan(beforeImgs);

  // every r:embed in the merged doc must point to a relationship that exists
  const xml = (await target.document.getBlocks()).map((b) => b.xml).join("");
  const relsXml = target.zip.getFileAsString("word/_rels/document.xml.rels") ?? "";
  const embeds = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
  for (const rId of embeds) {
    expect(relsXml).toContain(`Id="${rId}"`);
  }
});
```
Add at top of spec: `import fs from "fs"; import path from "path";`

- [ ] **Step 2: Run, verify FAIL** (image not copied / dangling rId).

Run: `cd ~/mdocxengine && npx vitest run src/integration/merge-manager.spec.ts -t "copies images"`

- [ ] **Step 3: Implement media copy + remap**

```typescript
// MergeManager.ts — add imports
import { MediaManager } from "./MediaManager";
import * as XmlUtils from "@/utils/xmlUtils";

// add field + construct in constructor:
private media: MediaManager;
// constructor: this.media = new MediaManager(zip);

/** Reads source document.xml.rels → { rId: { type, target } }. */
private async readSourceRels(source: Mdocxengine): Promise<Record<string, { type: string; target: string }>> {
  const xml = source.zip.getFileAsString("word/_rels/document.xml.rels");
  if (!xml) return {};
  const obj: any = await XmlUtils.parseXml(xml);
  const rels = obj?.Relationships?.Relationship;
  const arr = Array.isArray(rels) ? rels : rels ? [rels] : [];
  const map: Record<string, { type: string; target: string }> = {};
  for (const r of arr) {
    map[r.$.Id] = { type: r.$.Type, target: r.$.Target };
  }
  return map;
}

private extOf(target: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(target);
  return (m ? m[1] : "png").toLowerCase();
}

/** Copy images referenced by the blocks; return oldRId → newRId map. */
private async remapMedia(source: Mdocxengine, blocksXml: string): Promise<Record<string, string>> {
  const srcRels = await this.readSourceRels(source);
  const refRIds = new Set(
    [...blocksXml.matchAll(/r:(?:embed|link)="([^"]+)"/g)].map((m) => m[1]),
  );
  const idMap: Record<string, string> = {};
  for (const rId of refRIds) {
    const rel = srcRels[rId];
    if (!rel) continue;
    // image target like "media/image1.png" (relative to word/)
    const name = rel.target.replace(/^.*\//, "");
    const buf = source.media.extractImage(name);
    if (!buf) continue;
    const { relId } = await this.media.insertImage(buf, this.extOf(rel.target));
    idMap[rId] = relId;
  }
  return idMap;
}
```

Then update `copyAndRemap`:
```typescript
protected async copyAndRemap(source: Mdocxengine, blocks: BodyBlock[]): Promise<BodyBlock[]> {
  let joined = blocks.map((b) => b.xml).join(" "); // NUL is not legal in XML → safe block delimiter
  const mediaMap = await this.remapMedia(source, joined);
  joined = this.applyAttrMap(joined, ["r:embed", "r:link"], mediaMap);
  return joined.split(" ").map((xml, i) => ({ kind: blocks[i].kind, tag: blocks[i].tag, xml }));
}

/** Replace attr="old" → attr="new" for the given attributes, scoped to the passed XML only. */
private applyAttrMap(xml: string, attrs: string[], idMap: Record<string, string>): string {
  if (Object.keys(idMap).length === 0) return xml;
  let out = xml;
  for (const attr of attrs) {
    out = out.replace(new RegExp(`(${attr.replace(":", "\\:")}=")([^"]+)(")`, "g"), (full, p1, val, p3) =>
      idMap[val] ? `${p1}${idMap[val]}${p3}` : full,
    );
  }
  return out;
}
```

- [ ] **Step 4: Run, verify PASS.**

Run: `cd ~/mdocxengine && npx vitest run src/integration/merge-manager.spec.ts`
Expected: PASS (all tests incl. image test).

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add -A && git commit -m "feat(merge): copy source images and remap r:embed/r:link rIds"
```

---

### Task 3: Copy footnotes (verbatim element) & remap `w:footnoteReference/@w:id`

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/MergeManager.ts`
- Test: same spec.

Footnotes referenced in copied blocks via `<w:footnoteReference w:id="N"/>`. We copy each source footnote ELEMENT verbatim (preserving rich content) into the target `word/footnotes.xml` under a fresh id, then remap the reference ids in the blocks. (Footnote-internal images are deferred to Phase 2.)

- [ ] **Step 1: Write failing test** (need a fixture with a footnote; create one if none — `grep -l footnoteReference` across `samples/*` after `unzip`. If none exists, build one in-test by injecting a footnote via `engine.footnotes.addFootnote` before exporting the source.)

```typescript
test("copies footnotes and remaps reference ids", async () => {
  // Build a source doc that HAS a footnote, with a unique footnote text.
  const e = await Mdocxengine.loadFromFile("samples/example.docx");
  const { id, run } = await e.footnotes.addFootnote("UNIQUE-FOOTNOTE-TEXT-ZZZ");
  // Inline the footnote reference run into a paragraph:
  await e.document.saveBlocks([
    makeParagraphNode("Body with note"),
  ]);
  // (Reference linkage is asserted at the footnotes.xml level below.)
  const sourceBuf = e.zip.toBuffer();

  const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A"]));
  await target.merge.appendDocument(sourceBuf);

  const fns = await target.footnotes.getFootnotes();
  expect(fns.some((f) => f.text.includes("UNIQUE-FOOTNOTE-TEXT-ZZZ"))).toBe(true);
});
```

NOTE: This asserts the footnote content lands in the target. A fuller test asserting id-remap on an actual in-body `w:footnoteReference` requires a fixture where the reference is in the body; if `addFootnote` does not insert the reference into the body, build the body paragraph XML to include `run` (the returned reference run). Implementer: inspect `createFootnoteRun`/`addFootnote` return and embed the reference run into a paragraph block so the remap path is exercised.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement footnote copy + remap**

```typescript
// MergeManager.ts
import { FootnoteManager } from "./FootnoteManager";
// field + constructor: this.footnotes = new FootnoteManager(zip);
private footnotes: FootnoteManager;

/** Copy source footnotes referenced by blocks; return oldId → newId map. */
private async remapFootnotes(source: Mdocxengine, blocksXml: string): Promise<Record<string, string>> {
  const refIds = new Set(
    [...blocksXml.matchAll(/<w:footnoteReference[^>]*\bw:id="([^"]+)"/g)].map((m) => m[1]),
  );
  if (refIds.size === 0) return {};
  const srcFns = await source.footnotes.getFootnotes(); // [{ id, text }]
  const byId = new Map(srcFns.map((f) => [String(f.id), f.text]));
  const idMap: Record<string, string> = {};
  for (const oldId of refIds) {
    const text = byId.get(oldId);
    if (text == null) continue;
    const { id: newId } = await this.footnotes.addFootnote(text);
    idMap[oldId] = String(newId);
  }
  return idMap;
}
```

In `copyAndRemap`, after media remap:
```typescript
const fnMap = await this.remapFootnotes(source, joined);
joined = this.applyFootnoteRefMap(joined, fnMap);
```

```typescript
/** Remap w:id only inside <w:footnoteReference .../> elements (scoped — never touches other w:id). */
private applyFootnoteRefMap(xml: string, idMap: Record<string, string>): string {
  if (Object.keys(idMap).length === 0) return xml;
  return xml.replace(/<w:footnoteReference\b[^>]*>/g, (tag) =>
    tag.replace(/\bw:id="([^"]+)"/, (full, val) => (idMap[val] ? `w:id="${idMap[val]}"` : full)),
  );
}
```

NOTE: Phase 1 copies footnote **text** via `addFootnote(text)` (the available primitive). This preserves note content & reference linkage; rich footnote run formatting is hardened in Phase 2 (verbatim `<w:footnote>` element copy). Flag this limitation in the commit body.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add -A && git commit -m "feat(merge): copy source footnotes and remap footnoteReference ids (text fidelity)"
```

---

### Task 4: Equations pass-through + multi-feature integration test

**Files:**
- Test: `/Users/hamzasafwan/mdocxengine/src/integration/merge-manager.spec.ts`

OMML equations live inline in the paragraph XML (`<m:oMath>…`) and are copied verbatim by the block copy — no remap. This task adds an assertion guarding that and a combined "two real docs" merge that opens cleanly.

- [ ] **Step 1: Write the test**

```typescript
test("equations (m:oMath) survive the merge verbatim", async () => {
  const omml = '<w:p><m:oMathPara><m:oMath><m:r><m:t>E=mc^2</m:t></m:r></m:oMath></m:oMathPara></w:p>';
  const e = await Mdocxengine.loadFromFile("samples/example.docx");
  const blocks = await e.document.getBlocks();
  await e.document.saveBlocks([...blocks, { kind: "other", tag: "w:p", xml: omml }]);
  const sourceBuf = e.zip.toBuffer();

  const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A"]));
  await target.merge.appendDocument(sourceBuf);

  const xml = (await target.document.getBlocks()).map((b) => b.xml).join("");
  expect(xml).toContain("<m:t>E=mc^2</m:t>");
});

test("merging two real sample docs produces a saveable buffer", async () => {
  const a = await Mdocxengine.loadFromFile("samples/example.docx");
  const aBuf = a.zip.toBuffer();
  const b = await Mdocxengine.loadFromFile("samples/hanachi.docx");

  await b.merge.appendDocument(aBuf, { startOnNewPage: true, leadingBlocks: [makeParagraphNode("APPENDED PART", "Heading1")] });

  const out = b.zip.toBuffer();
  expect(out.length).toBeGreaterThan(0);
  // Re-open to confirm it is still a valid package
  const reopened = await Mdocxengine.loadFromBuffer(out);
  const xml = (await reopened.document.getBlocks()).map((x) => x.xml).join("");
  expect(xml).toContain("APPENDED PART");
});
```

- [ ] **Step 2: Run, verify PASS** (no impl change expected; if equation fails, the block copy is dropping `kind:"other"` — fix `copyAndRemap` to preserve all kinds).

Run: `cd ~/mdocxengine && npx vitest run src/integration/merge-manager.spec.ts`

- [ ] **Step 3: Commit**

```bash
cd ~/mdocxengine && git add -A && git commit -m "test(merge): equations pass-through + two-doc integration smoke"
```

---

### Task 5: Light style mapping (Heading1..3 / Normal by name)

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/MergeManager.ts`
- Test: same spec.

Because the combined doc is normalized to one profile, we map source paragraph `w:pStyle/@w:val` to the target's equivalent style **by name**. Phase 1 maps the common heading + Normal styles; unmatched styles are left as-is (the server's normalize pass + target styles.xml absorb the rest). This avoids importing conflicting source style definitions.

- [ ] **Step 1: Write failing test**

```typescript
test("maps a source heading styleId to the target heading style by name", async () => {
  // Source uses styleId "Titre1" (French Word) named "heading 1"
  const srcXml = '<w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Chapitre</w:t></w:r></w:p>';
  const e = await Mdocxengine.loadFromFile("samples/example.docx");
  await e.document.saveBlocks([{ kind: "paragraph", tag: "w:p", xml: srcXml }]);
  const sourceBuf = e.zip.toBuffer();

  const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A"]));
  await target.merge.appendDocument(sourceBuf, { styleMap: { Titre1: "Heading1" } });

  const xml = (await target.document.getBlocks()).map((b) => b.xml).join("");
  expect(xml).toContain('w:val="Heading1"');
  expect(xml).not.toContain('w:val="Titre1"');
});
```

- [ ] **Step 2: Run, verify FAIL** (`styleMap` option not honored).

- [ ] **Step 3: Implement**

Extend `AppendOptions` with `styleMap?: Record<string, string>` and apply it in `copyAndRemap`:
```typescript
// AppendOptions:
styleMap?: Record<string, string>;

// appendDocument: pass opts.styleMap into copyAndRemap
srcBlocks = await this.copyAndRemap(source, srcBlocks, opts.styleMap ?? {});

// copyAndRemap signature: (source, blocks, styleMap)
// after footnote remap:
joined = this.applyStyleMap(joined, styleMap);

private applyStyleMap(xml: string, styleMap: Record<string, string>): string {
  if (Object.keys(styleMap).length === 0) return xml;
  return xml.replace(/<w:pStyle\b[^>]*\bw:val="([^"]+)"[^>]*\/>/g, (tag, val) =>
    styleMap[val] ? tag.replace(`w:val="${val}"`, `w:val="${styleMap[val]}"`) : tag,
  );
}
```

The default style map (French/English Word heading aliases) is owned by the SERVER (it knows the target profile). The engine just applies whatever map it's given. Provide a default export of common aliases for reuse:
```typescript
export const DEFAULT_STYLE_ALIASES: Record<string, string> = {
  Titre1: "Heading1", Titre2: "Heading2", Titre3: "Heading3",
  Heading1: "Heading1", Heading2: "Heading2", Heading3: "Heading3",
  Normal: "Normal", Standard: "Normal", "Corpsdetexte": "Normal",
};
```
Export it from index.ts.

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine && git add -A && git commit -m "feat(merge): map source paragraph styles to target by name (DEFAULT_STYLE_ALIASES)"
```

---

### Task 6: Build the engine & confirm the server picks it up

**Files:** none new.

- [ ] **Step 1: Build**

Run: `cd ~/mdocxengine && npm run build`
Expected: `tsc` + vite build succeed, `dist/` updated.

- [ ] **Step 2: Full engine test suite**

Run: `cd ~/mdocxengine && npm run test:ci`
Expected: all suites green (merge + pre-existing).

- [ ] **Step 3: Confirm consumption**

The server depends via `"mdocxengine": "file:../mdocxengine"`. Run: `cd ~/modakerati-server && npm run build` (or `npx tsc --noEmit`) and confirm `import { MergeManager }` resolves.

- [ ] **Step 4: Commit (if dist is committed in the engine repo)**

```bash
cd ~/mdocxengine && git add -A && git commit -m "build(merge): compile MergeManager into dist" || echo "no dist changes to commit"
```

---

## Phase 2 — Server: combine endpoints

### Task 7: `combineThesisDoc` core helper

**Files:**
- Create: `/Users/hamzasafwan/modakerati-server/src/lib/thesis-combine.ts`
- Test: `/Users/hamzasafwan/modakerati-server/src/__tests__/thesis-combine.test.ts`

Pure-ish helper that builds the merged docx buffer from ordered part buffers + titles, using the engine. Keeps the route thin and testable.

- [ ] **Step 1: Write failing test**

```typescript
// src/__tests__/thesis-combine.test.ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { Mdocxengine, paragraphText } from "mdocxengine";
import { mergePartsIntoBuffer } from "../lib/thesis-combine";

it("merges ordered parts into one buffer with titled sections", async () => {
  const base = fs.readFileSync(path.resolve("../mdocxengine/samples/example.docx"));
  const partA = fs.readFileSync(path.resolve("../mdocxengine/samples/example.docx"));
  const partB = fs.readFileSync(path.resolve("../mdocxengine/samples/hanachi.docx"));

  const out = await mergePartsIntoBuffer(base, [
    { title: "Introduction", buffer: partA },
    { title: "Partie pratique", buffer: partB },
  ]);

  const e = await Mdocxengine.loadFromBuffer(out);
  const texts = (await e.document.getBlocks()).map((b) => paragraphText(b.xml));
  expect(texts).toContain("Introduction");
  expect(texts).toContain("Partie pratique");
});
```

- [ ] **Step 2: Run, verify FAIL.**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-combine.test.ts`

- [ ] **Step 3: Implement**

```typescript
// src/lib/thesis-combine.ts
import { Mdocxengine, makeParagraphNode, DEFAULT_STYLE_ALIASES } from "mdocxengine";

export interface CombinePart {
  title: string;
  buffer: Buffer;
}

/** Build a single docx buffer: baseBuffer + each part as a titled section on a new page. */
export async function mergePartsIntoBuffer(baseBuffer: Buffer, parts: CombinePart[]): Promise<Buffer> {
  const target = await Mdocxengine.loadFromBuffer(baseBuffer);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    await target.merge.appendDocument(part.buffer, {
      startOnNewPage: i > 0,              // first part flows after the cover; rest break to a new page
      leadingBlocks: [makeParagraphNode(part.title, "Heading1")],
      styleMap: DEFAULT_STYLE_ALIASES,
    });
  }
  return Buffer.from(target.zip.toBuffer());
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/thesis-combine.ts src/__tests__/thesis-combine.test.ts
git commit -m "feat(combine): mergePartsIntoBuffer helper (titled sections, page breaks)"
```

---

### Task 8: AI part-classification helper + `POST /api/thesis/combine/classify`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/routes/thesis.ts` (add route — static, before `/:id`)
- Create: `/Users/hamzasafwan/modakerati-server/src/lib/thesis-classify.ts`
- Test: `/Users/hamzasafwan/modakerati-server/src/__tests__/thesis-classify.test.ts`

- [ ] **Step 1: Write failing test for the parser (deterministic; no live AI)**

```typescript
// src/__tests__/thesis-classify.test.ts
import { describe, it, expect } from "vitest";
import { ROLE_ORDER, parseClassification, orderByRole } from "../lib/thesis-classify";

it("parses the model JSON and falls back to 'autre' on bad role", () => {
  const raw = '```json\n[{"filename":"intro.docx","role":"introduction","title":"Introduction"},{"filename":"x.docx","role":"bogus","title":"X"}]\n```';
  const parsed = parseClassification(raw, ["intro.docx", "x.docx"]);
  expect(parsed.find((p) => p.filename === "intro.docx")!.role).toBe("introduction");
  expect(parsed.find((p) => p.filename === "x.docx")!.role).toBe("autre");
});

it("orders filenames by canonical role sequence", () => {
  const ordered = orderByRole([
    { filename: "b.docx", role: "conclusion", title: "C" },
    { filename: "a.docx", role: "introduction", title: "I" },
  ]);
  expect(ordered).toEqual(["a.docx", "b.docx"]);
  expect(ROLE_ORDER[0]).toBe("introduction");
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement the classifier lib**

```typescript
// src/lib/thesis-classify.ts
import { getProvider } from "./ai";

export const ROLE_ORDER = [
  "introduction", "revue_litterature", "partie_theorique", "methodologie",
  "partie_pratique", "resultats", "discussion", "conclusion", "annexe", "autre",
] as const;
export type PartRole = (typeof ROLE_ORDER)[number];

export interface ClassifiedPart {
  filename: string;
  role: PartRole;
  title: string;
}

const ROLE_SET = new Set<string>(ROLE_ORDER);

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Section";
}

/** Robustly parse the model's JSON array; fill gaps from filename, clamp bad roles to 'autre'. */
export function parseClassification(raw: string, filenames: string[]): ClassifiedPart[] {
  let arr: any[] = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    arr = match ? JSON.parse(match[0]) : [];
  } catch {
    arr = [];
  }
  const byName = new Map<string, any>(arr.filter((x) => x?.filename).map((x) => [x.filename, x]));
  return filenames.map((filename) => {
    const hit = byName.get(filename) ?? {};
    const role: PartRole = ROLE_SET.has(hit.role) ? hit.role : "autre";
    const title = typeof hit.title === "string" && hit.title.trim() ? hit.title.trim() : titleFromFilename(filename);
    return { filename, role, title };
  });
}

export function orderByRole(parts: ClassifiedPart[]): string[] {
  return [...parts]
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    .map((p) => p.filename);
}

/** Calls the model with each part's text snippet; returns classified parts. */
export async function classifyParts(
  inputs: { filename: string; snippet: string }[],
): Promise<ClassifiedPart[]> {
  const filenames = inputs.map((i) => i.filename);
  const userContent = inputs
    .map((i) => `FILE: ${i.filename}\n---\n${i.snippet.slice(0, 1500)}`)
    .join("\n\n========\n\n");
  const systemPrompt =
    `You classify uploaded thesis parts. For EACH file return its role and a clean French section title. ` +
    `Roles MUST be one of: ${ROLE_ORDER.join(", ")}. ` +
    `Respond ONLY with a JSON array: [{"filename": "...", "role": "...", "title": "..."}]. No prose.`;
  try {
    const ai = getProvider("openrouter");
    const res = await ai.chat([{ role: "user", content: userContent }], {
      systemPrompt,
      temperature: 0.2,
      maxTokens: 800,
    });
    return parseClassification(res.content, filenames);
  } catch {
    // Never block the flow on classification: fall back to filename-derived titles.
    return filenames.map((filename) => ({ filename, role: "autre" as PartRole, title: titleFromFilename(filename) }));
  }
}
```

NOTE: confirm `getProvider` import path. Per server digest the AI lives at `src/lib/ai/index.ts` and routes import via `import { getProvider } from "../lib/ai"` (or `"./ai"` from within `src/lib`). Grep: `grep -rn "getProvider" ~/modakerati-server/src/routes`.

- [ ] **Step 4: Run parser tests, verify PASS.**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-classify.test.ts`

- [ ] **Step 5: Add the route** in `src/routes/thesis.ts` (place with the other static routes, before `/:id`)

```typescript
import { classifyParts, orderByRole, type ClassifiedPart } from "../lib/thesis-classify";
import { Mdocxengine, paragraphText } from "mdocxengine";

thesisRoutes.post("/combine/classify", async (c) => {
  const { parts } = await c.req.json();
  if (!Array.isArray(parts) || parts.length === 0) {
    return c.json({ error: "parts array required" }, 400);
  }

  const inputs: { filename: string; snippet: string }[] = [];
  const meta: Record<string, { wordCount: number; pageCount: number }> = {};
  for (const p of parts) {
    if (!p?.base64 || !p?.filename) return c.json({ error: "each part needs base64 + filename" }, 400);
    const buf = Buffer.from(p.base64, "base64");
    const engine = await Mdocxengine.loadFromBuffer(buf);
    const blocks = await engine.document.getBlocks();
    const text = blocks.map((b: any) => paragraphText(b.xml)).filter(Boolean).join("\n");
    inputs.push({ filename: p.filename, snippet: text.slice(0, 1500) });
    const words = text.split(/\s+/).filter(Boolean).length;
    meta[p.filename] = { wordCount: words, pageCount: Math.max(1, Math.round(words / 350)) };
  }

  const classified: ClassifiedPart[] = await classifyParts(inputs);
  const suggestedOrder = orderByRole(classified);
  return c.json({
    parts: classified.map((cp) => ({
      filename: cp.filename,
      suggestedTitle: cp.title,
      role: cp.role,
      wordCount: meta[cp.filename]?.wordCount ?? 0,
      pageCount: meta[cp.filename]?.pageCount ?? 1,
    })),
    suggestedOrder,
  });
});
```

- [ ] **Step 6: Manual smoke** (optional, if a dev server + token are available)

Run a `curl` POST with two small base64 docx; expect roles + suggestedOrder. Document the command in the PR.

- [ ] **Step 7: Commit**

```bash
cd ~/modakerati-server
git add src/lib/thesis-classify.ts src/__tests__/thesis-classify.test.ts src/routes/thesis.ts
git commit -m "feat(combine): /combine/classify endpoint + AI part classifier"
```

---

### Task 9: `POST /api/thesis/combine`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/routes/thesis.ts`

Mirrors `/import`: create thesis row → seed base → merge parts → normalize → upload → analysis → return `{ thesis, analysisReport }`.

- [ ] **Step 1: Add the route** (static, before `/:id`, near `/import`)

```typescript
thesisRoutes.post("/combine", async (c) => {
  const userId = c.get("userId");
  const { title, normProfileId, language, parts } = await c.req.json();

  if (!Array.isArray(parts) || parts.length < 2) {
    return c.json({ error: "at least 2 parts required" }, 400);
  }
  const MAX_PARTS = 6;
  if (parts.length > MAX_PARTS) return c.json({ error: `max ${MAX_PARTS} parts` }, 400);

  // Decode + validate + enforce total size cap (≈50 MB)
  const MAX_TOTAL = 50 * 1024 * 1024;
  let total = 0;
  const decoded: { title: string; buffer: Buffer; order: number }[] = [];
  for (const p of parts) {
    if (!p?.base64 || !p?.filename) return c.json({ error: "each part needs base64 + filename" }, 400);
    const buffer = Buffer.from(p.base64, "base64");
    total += buffer.length;
    if (total > MAX_TOTAL) return c.json({ error: "Combined files too large (max 50 MB)" }, 400);
    decoded.push({
      title: (p.title || p.filename.replace(/\.[^.]+$/, "")).trim() || "Section",
      buffer,
      order: typeof p.order === "number" ? p.order : decoded.length,
    });
  }
  decoded.sort((a, b) => a.order - b.order);

  const docTitle = (typeof title === "string" && title.trim()) || "Combined thesis";

  // 1. Create thesis row
  const [thesis] = await db.insert(theses).values({
    userId,
    title: docTitle,
    language: language || "fr",
    docMode: "live-docx",
    normProfileId: normProfileId || null,
  }).returning();

  // 2. Seed a base doc (cover + base styles), then merge parts into it.
  const { seedThesisDoc, loadThesisEngine } = await import("../lib/thesis-doc");
  const { mergePartsIntoBuffer } = await import("../lib/thesis-combine");
  const { uploadDocx } = await import("../lib/document-storage");

  const seed = await seedThesisDoc(thesis.id, userId, []); // empty plan → bare base
  const baseEngine = await loadThesisEngine(seed.docPath);
  const baseBuffer = Buffer.from(baseEngine.zip.toBuffer());

  const mergedBuffer = await mergePartsIntoBuffer(
    baseBuffer,
    decoded.map((d) => ({ title: d.title, buffer: d.buffer })),
  );

  // 3. Normalize formatting if a profile is set
  let finalBuffer = mergedBuffer;
  if (normProfileId) {
    const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, normProfileId));
    if (profile) {
      const { applyFormattingToXml } = await import("../lib/thesis-formatting");
      const engine = await Mdocxengine.loadFromBuffer(mergedBuffer);
      const zip = engine.zip as unknown as { readAsText(name: string): string };
      const documentXml = zip.readAsText("word/document.xml");
      const { xml } = applyFormattingToXml(documentXml, profile.formatting, profile.bindingSide);
      engine.zip.addFile("word/document.xml", Buffer.from(xml, "utf-8"));
      finalBuffer = Buffer.from(engine.zip.toBuffer());
    }
  }

  // 4. Upload + persist docPath
  const docPath = await uploadDocx(userId, thesis.id, finalBuffer);
  await db.update(theses).set({ docPath }).where(eq(theses.id, thesis.id));
  thesis.docPath = docPath;

  // 5. Analysis (best-effort, mirrors /import)
  let analysisReport = null;
  if (normProfileId) {
    try {
      const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, normProfileId));
      if (profile) {
        const { paragraphText, paragraphStyleId } = await import("mdocxengine");
        const engine = await loadThesisEngine(docPath);
        const zip = engine.zip as unknown as { readAsText(name: string): string };
        const documentXml = zip.readAsText("word/document.xml");
        const blocks = await engine.document.getBlocks();
        const docBlocks = blocks.map((b: any) => ({
          type: b.kind ?? b.tag, xml: b.xml, text: paragraphText(b.xml), styleId: paragraphStyleId(b.xml),
        }));
        const meta = extractMetadata(docBlocks, documentXml, thesis.language || "fr");
        const detected = extractFormatting(documentXml);
        analysisReport = buildAnalysisReport(meta, detected, profile.formatting);
        await db.update(theses).set({ analysisReport }).where(eq(theses.id, thesis.id));
        thesis.analysisReport = analysisReport;
      }
    } catch (e: any) {
      console.error("combine analysis failed:", thesis.id, e?.message ?? e);
    }
  }

  return c.json({ thesis, analysisReport }, 201);
});
```

NOTE: ensure `extractMetadata`, `extractFormatting`, `buildAnalysisReport`, `db`, `theses`, `normProfiles`, `eq`, `Mdocxengine` are already imported at the top of `thesis.ts` (they are used by `/import`). If `Mdocxengine` is not yet imported there, add `import { Mdocxengine } from "mdocxengine";`.

- [ ] **Step 2: Type-check**

Run: `cd ~/modakerati-server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke** (optional, dev server): POST two small docx → 201 with a thesis whose `/:id/outline` shows N `Heading1` titles. Record the curl.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati-server
git add src/routes/thesis.ts
git commit -m "feat(combine): POST /api/thesis/combine — seed, merge, normalize, analyze"
```

---

### Task 10: Server route integration test

**Files:**
- Test: `/Users/hamzasafwan/modakerati-server/src/__tests__/thesis-combine-route.test.ts`

If the suite has a Hono app test harness, exercise the route with mocked db + storage. If route-level mocking is heavy, assert at the helper level (already covered by Task 7) and keep this a thin smoke test of `mergePartsIntoBuffer` producing the expected outline.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { Mdocxengine, paragraphText, paragraphStyleId } from "mdocxengine";
import { mergePartsIntoBuffer } from "../lib/thesis-combine";

it("produces one Heading1 per part, each after a page break (except first)", async () => {
  const base = fs.readFileSync(path.resolve("../mdocxengine/samples/example.docx"));
  const out = await mergePartsIntoBuffer(base, [
    { title: "Introduction", buffer: base },
    { title: "Conclusion", buffer: base },
  ]);
  const e = await Mdocxengine.loadFromBuffer(out);
  const blocks = await e.document.getBlocks();
  const headings = blocks.filter((b: any) => paragraphStyleId(b.xml) === "Heading1").map((b: any) => paragraphText(b.xml));
  expect(headings).toContain("Introduction");
  expect(headings).toContain("Conclusion");
  const xml = blocks.map((b: any) => b.xml).join("");
  expect(xml).toContain('w:type="page"'); // at least one part break
});
```

- [ ] **Step 2: Run, verify PASS.**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-combine-route.test.ts`

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati-server
git add src/__tests__/thesis-combine-route.test.ts
git commit -m "test(combine): assert merged outline has titled sections + page breaks"
```

---

## Phase 3 — App: combine flow

### Task 11: API client — types + `classifyCombineParts` + `combineThesis`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/lib/api.ts`

- [ ] **Step 1: Add types + functions** (after `importThesis`)

```typescript
export type PartRole =
  | "introduction" | "revue_litterature" | "partie_theorique" | "methodologie"
  | "partie_pratique" | "resultats" | "discussion" | "conclusion" | "annexe" | "autre";

export interface ClassifiedPartDTO {
  filename: string;
  suggestedTitle: string;
  role: PartRole;
  wordCount: number;
  pageCount: number;
}

export async function classifyCombineParts(
  parts: { filename: string; base64: string }[],
): Promise<{ parts: ClassifiedPartDTO[]; suggestedOrder: string[] }> {
  return apiPost("/api/thesis/combine/classify", { parts });
}

export async function combineThesis(input: {
  title: string;
  normProfileId?: string;
  language?: string;
  parts: { filename: string; base64: string; title: string; order: number }[];
}): Promise<{ thesis: Thesis; analysisReport: AnalysisReport | null }> {
  return apiPost("/api/thesis/combine", input);
}
```

- [ ] **Step 2: Type-check**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati && git add lib/api.ts
git commit -m "feat(combine): api client classifyCombineParts + combineThesis"
```

---

### Task 12: `combine-store`

**Files:**
- Create: `/Users/hamzasafwan/modakerati/stores/combine-store.ts`

Mirrors `import-store`, but multi-pick + ordered parts + classify/combine actions.

- [ ] **Step 1: Implement**

```typescript
// stores/combine-store.ts
import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { classifyCombineParts, combineThesis, type PartRole } from "@/lib/api";
import type { Thesis } from "@/types/thesis";
import type { AnalysisReport } from "@/lib/api";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface CombinePart {
  id: string;            // local id = filename + index
  filename: string;
  base64: string;
  suggestedTitle: string;
  title: string;         // user-editable
  role: PartRole;
  order: number;
  wordCount: number;
  pageCount: number;
}

type CombineStatus = "idle" | "picking" | "uploading" | "classifying" | "arranging" | "combining" | "done" | "error";

interface CombineState {
  status: CombineStatus;
  parts: CombinePart[];
  normProfileId: string | null;
  title: string;
  thesis: Thesis | null;
  analysisReport: AnalysisReport | null;
  errorMessage: string | null;

  setNormProfileId: (id: string | null) => void;
  setTitle: (title: string) => void;
  setPartTitle: (id: string, title: string) => void;
  removePart: (id: string) => void;
  reorder: (from: number, to: number) => void;
  pickAndClassify: () => Promise<"ok" | "canceled" | "error">;
  combine: () => Promise<"ok" | "error">;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as CombineStatus,
  parts: [] as CombinePart[],
  normProfileId: null as string | null,
  title: "",
  thesis: null as Thesis | null,
  analysisReport: null as AnalysisReport | null,
  errorMessage: null as string | null,
};

function renumber(parts: CombinePart[]): CombinePart[] {
  return parts.map((p, i) => ({ ...p, order: i }));
}

export const useCombineStore = create<CombineState>((set, get) => ({
  ...INITIAL,

  setNormProfileId: (id) => set({ normProfileId: id }),
  setTitle: (title) => set({ title }),
  setPartTitle: (id, title) =>
    set((s) => ({ parts: s.parts.map((p) => (p.id === id ? { ...p, title } : p)) })),
  removePart: (id) => set((s) => ({ parts: renumber(s.parts.filter((p) => p.id !== id)) })),
  reorder: (from, to) =>
    set((s) => {
      const next = [...s.parts];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { parts: renumber(next) };
    }),

  pickAndClassify: async () => {
    set({ status: "picking", errorMessage: null });
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: [DOCX_MIME],
        multiple: true,
        copyToCacheDirectory: true,
      });
    } catch {
      set({ status: "error", errorMessage: "Could not open the file picker" });
      return "error";
    }
    if (picked.canceled || !picked.assets?.length) {
      set({ status: "idle" });
      return "canceled";
    }
    if (picked.assets.length < 2) {
      set({ status: "error", errorMessage: "Pick at least 2 .docx files" });
      return "error";
    }

    set({ status: "uploading" });
    try {
      const raw = await Promise.all(
        picked.assets.map(async (a, i) => ({
          id: `${a.name}-${i}`,
          filename: a.name ?? `part-${i}.docx`,
          base64: await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }),
        })),
      );

      set({ status: "classifying" });
      const { parts: classified, suggestedOrder } = await classifyCombineParts(
        raw.map((r) => ({ filename: r.filename, base64: r.base64 })),
      );
      const byName = new Map(classified.map((c) => [c.filename, c]));

      // build parts in AI-suggested order
      const ordered = suggestedOrder.length ? suggestedOrder : raw.map((r) => r.filename);
      const parts: CombinePart[] = ordered
        .map((fn, idx) => {
          const r = raw.find((x) => x.filename === fn);
          const c = byName.get(fn);
          if (!r || !c) return null;
          return {
            id: r.id, filename: fn, base64: r.base64,
            suggestedTitle: c.suggestedTitle, title: c.suggestedTitle,
            role: c.role, order: idx, wordCount: c.wordCount, pageCount: c.pageCount,
          } as CombinePart;
        })
        .filter(Boolean) as CombinePart[];

      set({ status: "arranging", parts: renumber(parts) });
      return "ok";
    } catch (err) {
      set({ status: "error", errorMessage: err instanceof Error ? err.message : "Classification failed" });
      return "error";
    }
  },

  combine: async () => {
    const { parts, normProfileId, title } = get();
    if (parts.length < 2) {
      set({ status: "error", errorMessage: "Need at least 2 parts" });
      return "error";
    }
    set({ status: "combining", errorMessage: null });
    try {
      const { thesis, analysisReport } = await combineThesis({
        title: title || parts[0].title || "Combined thesis",
        normProfileId: normProfileId || undefined,
        parts: parts
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((p) => ({ filename: p.filename, base64: p.base64, title: p.title, order: p.order })),
      });
      set({ status: "done", thesis, analysisReport });
      return "ok";
    } catch (err) {
      set({ status: "error", errorMessage: err instanceof Error ? err.message : "Combine failed" });
      return "error";
    }
  },

  reset: () => set({ ...INITIAL }),
}));
```

- [ ] **Step 2: Type-check**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati && git add stores/combine-store.ts
git commit -m "feat(combine): combine-store (multi-pick, classify, reorder, combine)"
```

---

### Task 13: Home entry point — "Combine documents" quick action

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/app/(tabs)/index.tsx`
- Modify: `/Users/hamzasafwan/modakerati/locales/{en,fr,ar}.json`

- [ ] **Step 1: Add the quick action**

Import an icon (e.g. `Combine` from `lucide-react-native`) at the top, then add to the `quickActions` array:
```typescript
{ icon: Combine, label: t("combine.action"), color: "#1FB6A8", onPress: () => {
    useCombineStore.getState().reset();
    router.push("/(app)/combine-arrange" as any);
} },
```
Add `import { useCombineStore } from "@/stores/combine-store";` and start the pick in the arrange screen's mount (Task 14) OR call `pickAndClassify()` here before navigating. Per the import pattern (which navigates after pick), call it here:
```typescript
onPress: async () => {
  const store = useCombineStore.getState();
  store.reset();
  const result = await store.pickAndClassify();
  if (result === "ok") router.push("/(app)/combine-arrange" as any);
  else if (result === "error") Alert.alert(t("combine.action"), useCombineStore.getState().errorMessage || "Failed");
},
```

- [ ] **Step 2: Add i18n keys** to each of `locales/en.json`, `locales/fr.json`, `locales/ar.json` — a new top-level `combine` block:

en.json:
```json
"combine": {
  "action": "Combine documents",
  "arrangeTitle": "Arrange parts",
  "arrangeSubtitle": "Reorder and rename each part, then combine.",
  "partTitleLabel": "Section title",
  "pickProfile": "Choose formatting standard",
  "combineButton": "Combine",
  "combining": "Combining your documents…",
  "remove": "Remove",
  "needTwo": "Pick at least 2 .docx files",
  "role_introduction": "Introduction",
  "role_revue_litterature": "Literature review",
  "role_partie_theorique": "Theoretical part",
  "role_methodologie": "Methodology",
  "role_partie_pratique": "Practical part",
  "role_resultats": "Results",
  "role_discussion": "Discussion",
  "role_conclusion": "Conclusion",
  "role_annexe": "Appendix",
  "role_autre": "Other"
}
```
fr.json (French):
```json
"combine": {
  "action": "Combiner des documents",
  "arrangeTitle": "Organiser les parties",
  "arrangeSubtitle": "Réordonnez et renommez chaque partie, puis combinez.",
  "partTitleLabel": "Titre de section",
  "pickProfile": "Choisir la norme de mise en forme",
  "combineButton": "Combiner",
  "combining": "Combinaison de vos documents…",
  "remove": "Supprimer",
  "needTwo": "Choisissez au moins 2 fichiers .docx",
  "role_introduction": "Introduction",
  "role_revue_litterature": "Revue de littérature",
  "role_partie_theorique": "Partie théorique",
  "role_methodologie": "Méthodologie",
  "role_partie_pratique": "Partie pratique",
  "role_resultats": "Résultats",
  "role_discussion": "Discussion",
  "role_conclusion": "Conclusion",
  "role_annexe": "Annexe",
  "role_autre": "Autre"
}
```
ar.json (Arabic):
```json
"combine": {
  "action": "دمج المستندات",
  "arrangeTitle": "ترتيب الأجزاء",
  "arrangeSubtitle": "أعد ترتيب كل جزء وأعد تسميته ثم ادمج.",
  "partTitleLabel": "عنوان القسم",
  "pickProfile": "اختر معيار التنسيق",
  "combineButton": "دمج",
  "combining": "جارٍ دمج مستنداتك…",
  "remove": "إزالة",
  "needTwo": "اختر ملفين .docx على الأقل",
  "role_introduction": "مقدمة",
  "role_revue_litterature": "مراجعة الأدبيات",
  "role_partie_theorique": "الجزء النظري",
  "role_methodologie": "المنهجية",
  "role_partie_pratique": "الجزء التطبيقي",
  "role_resultats": "النتائج",
  "role_discussion": "المناقشة",
  "role_conclusion": "الخاتمة",
  "role_annexe": "ملحق",
  "role_autre": "أخرى"
}
```

- [ ] **Step 3: Type-check + run app lint**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add "app/(tabs)/index.tsx" locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(combine): home quick action + trilingual strings"
```

---

### Task 14: Arrange/rename screen

**Files:**
- Create: `/Users/hamzasafwan/modakerati/app/(app)/combine-arrange.tsx`

Renders the ordered parts (reorderable), per-part editable title, role chip, a norm-profile picker, and a "Combine" button. Uses `react-native-draggable-flatlist` if present; otherwise up/down arrow buttons (no new dep) — check `package.json` first. Phase-1 default: **up/down buttons** (zero new deps; reanimated drag can be a later polish).

- [ ] **Step 1: Implement (up/down reordering, no new deps)**

```tsx
// app/(app)/combine-arrange.tsx
import React, { useEffect, useMemo } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, X } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useCombineStore } from "@/stores/combine-store";
import { useThesisStore } from "@/stores/thesis-store";

export default function CombineArrangeScreen() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();

  const parts = useCombineStore((s) => s.parts);
  const status = useCombineStore((s) => s.status);
  const normProfileId = useCombineStore((s) => s.normProfileId);
  const normProfiles = useThesisStore((s) => s.normProfiles);

  useEffect(() => {
    useThesisStore.getState().loadNormProfiles();
  }, []);

  const canCombine = parts.length >= 2;

  const onCombine = async () => {
    const result = await useCombineStore.getState().combine();
    if (result === "ok") {
      const thesis = useCombineStore.getState().thesis;
      if (thesis) {
        useThesisStore.getState().upsertThesis?.(thesis);
        useThesisStore.getState().setCurrentThesis(thesis.id);
        router.replace("/(app)/thesis-workspace");
      }
    } else {
      Alert.alert(t("combine.action"), useCombineStore.getState().errorMessage || "Failed");
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[styles.h1, { color: colors.textPrimary }]}>{t("combine.arrangeTitle")}</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>{t("combine.arrangeSubtitle")}</Text>

      {parts.map((p, i) => (
        <View key={p.id} style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.role, { color: colors.brandPrimary }]}>{t(`combine.role_${p.role}`)}</Text>
            <View style={styles.rowEnd}>
              <Pressable disabled={i === 0} onPress={() => useCombineStore.getState().reorder(i, i - 1)}>
                <ChevronUp size={20} color={i === 0 ? colors.borderDefault : colors.textSecondary} />
              </Pressable>
              <Pressable disabled={i === parts.length - 1} onPress={() => useCombineStore.getState().reorder(i, i + 1)}>
                <ChevronDown size={20} color={i === parts.length - 1 ? colors.borderDefault : colors.textSecondary} />
              </Pressable>
              <Pressable onPress={() => useCombineStore.getState().removePart(p.id)}>
                <X size={20} color={colors.semanticError} />
              </Pressable>
            </View>
          </View>
          <TextInput
            value={p.title}
            onChangeText={(txt) => useCombineStore.getState().setPartTitle(p.id, txt)}
            placeholder={t("combine.partTitleLabel")}
            placeholderTextColor={colors.textPlaceholder}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderSubtle }]}
          />
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {p.filename} · {p.wordCount} words · ~{p.pageCount}p
          </Text>
        </View>
      ))}

      <Text style={[styles.label, { color: colors.textPrimary }]}>{t("combine.pickProfile")}</Text>
      <View style={styles.profileWrap}>
        {normProfiles.map((np) => (
          <Pressable
            key={np.id}
            onPress={() => useCombineStore.getState().setNormProfileId(np.id)}
            style={[
              styles.profileChip,
              { borderColor: normProfileId === np.id ? colors.brandPrimary : colors.borderDefault, backgroundColor: colors.bgCard },
            ]}
          >
            <Text style={{ color: normProfileId === np.id ? colors.brandPrimary : colors.textSecondary }}>{np.name}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={!canCombine || status === "combining"}
        onPress={onCombine}
        style={[styles.cta, { backgroundColor: canCombine ? colors.brandPrimary : colors.borderDefault }]}
      >
        {status === "combining" ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{t("combine.combineButton")}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  sub: { fontSize: 14, marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowEnd: { flexDirection: "row", alignItems: "center", gap: 12 },
  role: { fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8, fontSize: 16 },
  meta: { fontSize: 12, marginTop: 6 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 8, marginBottom: 8 },
  profileWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  profileChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  cta: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginBottom: 40 },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
```

NOTE: confirm `useThesisStore` exposes `normProfiles`, `loadNormProfiles`, `setCurrentThesis`, and `upsertThesis` (digest shows `normProfiles`, `loadNormProfiles`, `setCurrentThesis`, `upsertThesis`). If `upsertThesis` is absent, drop that line — `setCurrentThesis` is the required one.

- [ ] **Step 2: Register the route** — `app/(app)/_layout.tsx` likely uses a Stack that auto-registers files; confirm `combine-arrange` appears. If screens are explicitly listed, add `<Stack.Screen name="combine-arrange" />`.

- [ ] **Step 3: Type-check**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add "app/(app)/combine-arrange.tsx" "app/(app)/_layout.tsx"
git commit -m "feat(combine): arrange/rename screen with reorder + profile picker"
```

---

### Task 15: App smoke (manual) + analysis hand-off

**Files:** none new (optional reuse of `import-analysis.tsx`).

- [ ] **Step 1: Run the app**

Use the project `/run` flow or `npx expo start`. From Home → "Combine documents" → pick 2+ `.docx` → arrange → Combine → confirm it lands in the workspace with titled sections.

- [ ] **Step 2 (optional): route to analysis** — if you want the post-combine analysis review (like import), after `combine()` returns `ok` and `analysisReport` is non-null, `router.push("/(app)/import-analysis")` instead of straight to the workspace. The import-analysis screen reads from `import-store`; to reuse it, either (a) generalize it to accept a source store, or (b) skip analysis for combine in Phase 1 and go straight to workspace. **Phase 1 default: straight to workspace.**

- [ ] **Step 3: Commit any fixups**

```bash
cd ~/modakerati && git add -A && git commit -m "fix(combine): smoke-test fixups" || echo "nothing to fix"
```

---

## Phase 4 — Engine Phase 2 (hardening to full fidelity)

### Task 16: Numbered lists — copy `abstractNum` + `num`, remap `numId`

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/NumberingManager.ts` (add abstractNum read/copy)
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/MergeManager.ts`
- Test: `/Users/hamzasafwan/mdocxengine/src/integration/merge-manager.spec.ts`

Source numbered paragraphs reference `<w:numPr><w:numId w:val="N"/>`. Each `w:num` → `w:abstractNumId` → `w:abstractNum` definition. We copy abstractNum + num with fresh ids and remap `w:numId/@w:val` in copied blocks.

- [ ] **Step 1: Add NumberingManager primitives**

```typescript
// NumberingManager.ts — new methods
import * as XmlUtils from "@/utils/xmlUtils";

/** Read raw abstractNum + num arrays from this doc's numbering.xml. */
public async readRaw(): Promise<{ abstractNums: any[]; nums: any[] }> {
  const xml = this.zip.getFileAsString?.("word/numbering.xml")
    ?? (this.zip as any).readAsText?.("word/numbering.xml");
  if (!xml) return { abstractNums: [], nums: [] };
  const obj: any = await XmlUtils.parseXml(xml);
  const a = obj?.["w:numbering"]?.["w:abstractNum"];
  const n = obj?.["w:numbering"]?.["w:num"];
  return {
    abstractNums: Array.isArray(a) ? a : a ? [a] : [],
    nums: Array.isArray(n) ? n : n ? [n] : [],
  };
}

/** Append abstractNum + num nodes (already id-rewritten) into numbering.xml, creating it if absent. */
public async appendRaw(abstractNums: any[], nums: any[]): Promise<void> {
  let xml = this.zip.getFileAsString?.("word/numbering.xml")
    ?? (this.zip as any).readAsText?.("word/numbering.xml");
  let obj: any;
  if (!xml) {
    obj = { "w:numbering": { $: { "xmlns:w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main" } } };
    await (this as any).contentTypes?.addOverride?.("/word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml");
  } else {
    obj = await XmlUtils.parseXml(xml);
  }
  const root = obj["w:numbering"];
  const ensureArr = (k: string) => { root[k] = Array.isArray(root[k]) ? root[k] : root[k] ? [root[k]] : []; };
  ensureArr("w:abstractNum"); ensureArr("w:num");
  root["w:abstractNum"].push(...abstractNums);
  root["w:num"].push(...nums);
  const out = XmlUtils.buildXml(obj, { rootName: "w:numbering", headless: false, pretty: true });
  this.zip.addFile("word/numbering.xml", Buffer.from(out, "utf-8"));
}

/** Highest existing numeric id among abstractNum/num (for allocation). */
public async maxIds(): Promise<{ absMax: number; numMax: number }> {
  const { abstractNums, nums } = await this.readRaw();
  const absMax = abstractNums.reduce((m, x) => Math.max(m, parseInt(x?.$?.["w:abstractNumId"] ?? "0", 10) || 0), 0);
  const numMax = nums.reduce((m, x) => Math.max(m, parseInt(x?.$?.["w:numId"] ?? "0", 10) || 0), 0);
  return { absMax, numMax };
}
```

NOTE: confirm whether NumberingManager already holds a `contentTypes` instance; if not, instantiate one in its constructor or pass via MergeManager. Grep the file first.

- [ ] **Step 2: Add MergeManager numbering remap**

```typescript
// MergeManager.ts
import { NumberingManager } from "./NumberingManager";
// field + constructor: this.numbering = new NumberingManager(zip);
private numbering: NumberingManager;

private async remapNumbering(source: Mdocxengine, blocksXml: string): Promise<Record<string, string>> {
  const usedNumIds = new Set([...blocksXml.matchAll(/<w:numId\b[^>]*\bw:val="([^"]+)"/g)].map((m) => m[1]));
  if (usedNumIds.size === 0) return {};

  const srcNum = await (source.numbering as any).readRaw() as { abstractNums: any[]; nums: any[] };
  const { absMax, numMax } = await this.numbering.maxIds();
  let nextAbs = absMax + 1, nextNum = numMax + 1;

  const numIdMap: Record<string, string> = {};
  const absIdMap: Record<string, string> = {};
  const addAbs: any[] = [], addNum: any[] = [];

  for (const num of srcNum.nums) {
    const oldNumId = num?.$?.["w:numId"];
    if (!usedNumIds.has(oldNumId)) continue;
    const oldAbs = num?.["w:abstractNumId"]?.$?.["w:val"];
    // copy abstractNum once
    if (oldAbs != null && absIdMap[oldAbs] == null) {
      const absDef = srcNum.abstractNums.find((a) => a?.$?.["w:abstractNumId"] === oldAbs);
      if (absDef) {
        const newAbs = String(nextAbs++);
        const clone = JSON.parse(JSON.stringify(absDef));
        clone.$["w:abstractNumId"] = newAbs;
        if (clone["w:nsid"]) delete clone["w:nsid"]; // avoid nsid collisions
        addAbs.push(clone);
        absIdMap[oldAbs] = newAbs;
      }
    }
    const newNumId = String(nextNum++);
    const numClone = JSON.parse(JSON.stringify(num));
    numClone.$["w:numId"] = newNumId;
    if (numClone["w:abstractNumId"] && absIdMap[oldAbs] != null) {
      numClone["w:abstractNumId"].$["w:val"] = absIdMap[oldAbs];
    }
    addNum.push(numClone);
    numIdMap[oldNumId] = newNumId;
  }
  if (addAbs.length || addNum.length) await this.numbering.appendRaw(addAbs, addNum);
  return numIdMap;
}

private applyNumIdMap(xml: string, idMap: Record<string, string>): string {
  if (Object.keys(idMap).length === 0) return xml;
  return xml.replace(/<w:numId\b[^>]*\/>/g, (tag) =>
    tag.replace(/\bw:val="([^"]+)"/, (full, val) => (idMap[val] ? `w:val="${idMap[val]}"` : full)),
  );
}
```

Wire into `copyAndRemap` after footnotes:
```typescript
const numMap = await this.remapNumbering(source, joined);
joined = this.applyNumIdMap(joined, numMap);
```

- [ ] **Step 3: Test**

```typescript
test("numbered lists keep their own numbering (no cross-doc collision)", async () => {
  // Build a source with a numbered paragraph referencing numId 1
  const srcXml = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>';
  const e = await Mdocxengine.loadFromFile("samples/example.docx");
  await e.document.saveBlocks([{ kind: "paragraph", tag: "w:p", xml: srcXml }]);
  const sourceBuf = e.zip.toBuffer();

  const target = await Mdocxengine.loadFromBuffer(await docWith(["TARGET-A"]));
  await target.merge.appendDocument(sourceBuf);

  const xml = (await target.document.getBlocks()).map((b) => b.xml).join("");
  const newNumIds = [...xml.matchAll(/<w:numId\b[^>]*w:val="([^"]+)"/g)].map((m) => m[1]);
  // numbering remapped (not still "1" unless target had no numbering)
  expect(newNumIds.length).toBeGreaterThan(0);
  // numbering.xml now defines the referenced numId
  const numXml = target.zip.getFileAsString("word/numbering.xml") ?? "";
  for (const id of newNumIds) expect(numXml).toContain(`w:numId="${id}"`);
});
```

Run: `cd ~/mdocxengine && npx vitest run src/integration/merge-manager.spec.ts -t "numbered lists"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/mdocxengine && git add -A && git commit -m "feat(merge): copy numbering definitions and remap numId (Phase 2)"
```

---

### Task 17: Verbatim footnote element copy + hyperlink/endnote remap

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/MergeManager.ts`
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/FootnoteManager.ts` (add `appendRawFootnote(xmlNode, id)` if needed)
- Test: same spec.

Replace the Phase-1 text-only footnote copy with verbatim `<w:footnote>` element copy (preserves rich runs); also remap hyperlink `r:id` (external links in `document.xml.rels`) the same way as media.

- [ ] **Step 1: Hyperlink remap** — extend `remapMedia` to also copy non-image external rels (hyperlinks) OR add a sibling `remapHyperlinks` that copies `Type=…/hyperlink` rels with `TargetMode="External"` and maps `r:id`. Apply with `applyAttrMap(joined, ["r:id"], hyperlinkMap)` — but scope carefully: `r:id` appears in `<w:hyperlink r:id=…>`. Restrict the regex to hyperlink elements:
```typescript
private applyHyperlinkMap(xml: string, idMap: Record<string, string>): string {
  if (Object.keys(idMap).length === 0) return xml;
  return xml.replace(/<w:hyperlink\b[^>]*>/g, (tag) =>
    tag.replace(/\br:id="([^"]+)"/, (full, val) => (idMap[val] ? `r:id="${idMap[val]}"` : full)),
  );
}
```

- [ ] **Step 2: Verbatim footnote copy** — read source `word/footnotes.xml`, for each `<w:footnote w:id="N">` with N≥1 (skip separator/-1,0), allocate a new id in the target footnotes.xml, append the verbatim node with the new id, and (recursively) remap any media/numbering it references. Replace `remapFootnotes`'s text-based copy with this element-based copy.

- [ ] **Step 3: Tests** — a footnote with bold runs survives with formatting; a hyperlink resolves post-merge. Add assertions to the spec.

Run: `cd ~/mdocxengine && npx vitest run src/integration/merge-manager.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/mdocxengine && git add -A && git commit -m "feat(merge): verbatim footnote copy + hyperlink r:id remap (Phase 2)"
```

---

### Task 18: Full-fidelity end-to-end fixture

**Files:**
- Add fixture: `~/mdocxengine/samples/combine-fixture-{a,b}.docx` (each containing image + footnote + numbered list + equation + table)
- Test: `/Users/hamzasafwan/mdocxengine/src/integration/merge-manager.spec.ts`

- [ ] **Step 1: Author/record fixtures** (build them in a one-off script using the engine, or add real docx samples).

- [ ] **Step 2: Single assertion test** that merges a+b and verifies every feature survives:
```typescript
test("full fidelity: images, footnotes, numbering, equations, tables all survive", async () => {
  const a = fs.readFileSync(path.resolve("samples/combine-fixture-a.docx"));
  const b = await Mdocxengine.loadFromFile("samples/combine-fixture-b.docx");
  await b.merge.appendDocument(a, { startOnNewPage: true });
  const out = b.zip.toBuffer();
  const e = await Mdocxengine.loadFromBuffer(out);
  const xml = (await e.document.getBlocks()).map((x) => x.xml).join("");
  expect(e.media.listImages().length).toBeGreaterThan(1);
  expect(xml).toContain("<m:oMath");
  expect(xml).toContain("<w:tbl");
  const rels = e.zip.getFileAsString("word/_rels/document.xml.rels") ?? "";
  for (const r of [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1])) expect(rels).toContain(`Id="${r}"`);
});
```

Run: `cd ~/mdocxengine && npm run test:ci`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
cd ~/mdocxengine && git add -A && git commit -m "test(merge): full-fidelity end-to-end merge fixture"
```

---

## Done criteria

- Engine: `MergeManager.appendDocument` merges blocks + images + footnotes + equations + numbering with id remapping; full test suite green.
- Server: `/combine/classify` returns roles + order; `/combine` produces a `live-docx` thesis whose outline is N titled `Heading1` sections, each on a new page, formatting normalized, analysis attached.
- App: Home → Combine → pick ≥2 `.docx` → arrange/rename → Combine → lands in the workspace.
- Trilingual strings present in en/fr/ar.

## Deferred ("make it best" later)
- Drag-to-reorder via reanimated/gesture-handler (Phase 1 ships up/down buttons).
- Reuse of `import-analysis.tsx` for a post-combine review step (Phase 1 goes straight to workspace).
- Richer role/title detection; header/footer strategy across parts; per-part formatting overrides.
- Footnote-internal media recursion edge cases; charts/embedded objects (OLE) fidelity.
