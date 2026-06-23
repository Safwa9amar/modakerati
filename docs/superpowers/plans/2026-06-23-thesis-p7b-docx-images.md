# Thesis P7b — Real Chart/Figure Images in the Exported .docx

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes. Highest-risk task: touches `~/mdocxengine` (new public method + OOXML), adds a server dep, and wires the export. Each phase has a standalone test; the export FALLS BACK to the existing data table if anything fails.

**Goal:** Embed charts (and uploaded figures) as real **images** in the exported `.docx` — not the data-table fallback. A chart's SVG is rasterized to PNG and placed as an inline picture in the Word body.

**Architecture:** (1) `~/mdocxengine`: add `ShapeManager.insertImage(relId, opts)` — builds a picture `graphicData` (`pic:pic` → `a:blip r:embed`), wraps it with the existing private `buildInline`, and injects via `insertDrawingParagraph` at a paragraph index (same post-`saveChanges` insertion model as tables). (2) Server: add `@resvg/resvg-js`; `svgToPng(svg) → { png, w, h }`. (3) `docx-blocks` records chart images (like it records tables); `docx.ts` after `saveChanges` registers each PNG via `engine.media.insertImage` then places it via `engine.shapes.insertImage`, interleaving image+table inserts by **descending paragraph index**. On any failure, keep the current caption+data-table output.

**Branch:** `feat/thesis-hierarchy-p0` (+ a commit in `~/mdocxengine`).

**Verified engine internals (from source):**
- `MediaManager.insertImage(buffer, ext) → { imagePath, relId }` — registers content-type (`contentTypes.addDefault`) + a relationship (`rels.addRelationship(relId, IMAGE_REL_TYPE, 'media/<name>')`). Confirm `this.rels` is the **document** rels (`word/_rels/document.xml.rels`) so `r:embed` resolves in `document.xml`.
- `ShapeManager` private helpers: `buildInline(id, name, size, graphicData)` → `{ "wp:inline": { ..., "wp:extent": {cx,cy}, "wp:docPr": {id,name}, "a:graphic": { "a:graphicData": graphicData } } }`; `insertDrawingParagraph(obj, drawing, paragraphIndex?)` injects a `<w:p><w:r>{drawing}</w:r></w:p>`; `readDocument()`/`writeDocument(obj)`; `nextShapeId()`. Public methods `insertShape`/`insertLine`/`insertTextBox` follow: build graphicData → buildInline/buildAnchor → readDocument → insertDrawingParagraph → writeDocument. Namespaces `a:`/`wp:`/`r:` are declared on the document root; `pic:` must be self-declared on the `pic:pic` element.
- `docx.ts` already inserts tables post-`saveChanges` by index, back-to-front.

---

## Task 1 (mdocxengine): `ShapeManager.insertImage`

**Files:** `~/mdocxengine/src/core/PartsManagers/ShapeManager.ts`; test `~/mdocxengine/src/core/PartsManagers/ShapeManager.image.spec.ts` (vitest, the engine's test runner)

- [ ] **Step 1:** Read `ShapeManager.ts` (esp. `buildInline`, `buildGraphicData`, `insertDrawingParagraph`, `readDocument`/`writeDocument`, `nextShapeId`, `insertShape`) + `MediaManager.insertImage` + the `RelManager` it uses (confirm document-rels). Confirm `ShapeSize = { width; height }` (EMU).
- [ ] **Step 2:** Add a public method (mirror `insertShape`'s structure):
```typescript
/** Insert an inline picture (image) referencing an already-registered relId (see MediaManager.insertImage). width/height in EMU. */
public async insertImage(
  relId: string,
  opts: { width: number; height: number; name?: string; paragraphIndex?: number } 
): Promise<number> {
  const id = await this.nextShapeId();
  const name = opts.name ?? `Image ${id}`;
  const size: ShapeSize = { width: opts.width, height: opts.height };
  const graphicData = {
    $: { uri: "http://schemas.openxmlformats.org/drawingml/2006/picture" },
    "pic:pic": {
      $: { "xmlns:pic": "http://schemas.openxmlformats.org/drawingml/2006/picture" },
      "pic:nvPicPr": {
        "pic:cNvPr": { $: { id: String(id), name } },
        "pic:cNvPicPr": {},
      },
      "pic:blipFill": {
        "a:blip": { $: { "r:embed": relId } },
        "a:stretch": { "a:fillRect": {} },
      },
      "pic:spPr": {
        "a:xfrm": {
          "a:off": { $: { x: "0", y: "0" } },
          "a:ext": { $: { cx: String(size.width), cy: String(size.height) } },
        },
        "a:prstGeom": { $: { prst: "rect" }, "a:avLst": {} },
      },
    },
  };
  const drawing = this.buildInline(id, name, size, graphicData);
  const obj = await this.readDocument();
  this.insertDrawingParagraph(obj, drawing, opts.paragraphIndex);
  await this.writeDocument(obj);
  return id;
}
```
Adjust to the EXACT private-helper signatures you read (e.g. if `buildInline`/`insertDrawingParagraph`/`readDocument` differ). If the xml2js builder needs explicit element ordering or the `a:graphic` needs `xmlns:a`, add it (test will reveal).
- [ ] **Step 3:** Standalone vitest `ShapeManager.image.spec.ts`: load/create a minimal doc (mirror an existing spec's zip fixture), `const {relId} = await media.insertImage(<tiny valid PNG buffer>, "png")`, `await shapes.insertImage(relId, { width: 2000000, height: 1500000 })`, then read `word/document.xml` and assert it contains `r:embed="<relId>"` and `<pic:pic` and `<wp:inline`; read `word/_rels/document.xml.rels` and assert it has a relationship with that relId pointing at `media/`. Use a real 1×1 PNG (a known base64 constant). Run `npx vitest run ShapeManager.image` → PASS.
- [ ] **Step 4:** Build the engine if it ships compiled (`npm run build` in `~/mdocxengine` if it has a build step and the server imports `dist/`; check `~/mdocxengine/package.json` `main`/`exports` — the server imports `mdocxengine` via `file:../mdocxengine`). If the server consumes TS source directly (tsx), no build needed; if it consumes `dist/`, run the build so the new method is available to the server. Report which.
- [ ] **Step 5:** Commit in `~/mdocxengine`: `git add -A && git commit -m "feat: ShapeManager.insertImage — inline picture from a relId"`.

---

## Task 2 (server): SVG→PNG

**Files:** `package.json`; Create `src/lib/svg-to-png.ts`; test `scripts/test-svg-to-png.ts`

- [ ] **Step 1:** `cd ~/modakerati-server && npm install @resvg/resvg-js`. (Prebuilt native binary; verify it loads: `node -e "require('@resvg/resvg-js')"`.) If it fails to install/load on this platform, STOP and report — fall back plan is to keep the data table (Task 4 handles the failure path anyway).
- [ ] **Step 2:** `src/lib/svg-to-png.ts`:
```typescript
import { Resvg } from "@resvg/resvg-js";
/** Rasterize an SVG string to PNG. Returns the PNG buffer + pixel dimensions. */
export function svgToPng(svg: string, fitWidthPx = 520): { png: Buffer; width: number; height: number } {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: fitWidthPx }, background: "white" });
  const img = r.render();
  const png = img.asPng();
  return { png: Buffer.from(png), width: img.width, height: img.height };
}
```
- [ ] **Step 3:** test `scripts/test-svg-to-png.ts`: `svgToPng(chartToSvg({type:"bar",title:"T",labels:["a","b"],values:[3,7]}))` → assert PNG magic bytes (`0x89 0x50 0x4e 0x47`) + width>0. Run → PASS.
- [ ] **Step 4:** tsc clean; commit: `git add package.json package-lock.json src/lib/svg-to-png.ts scripts/test-svg-to-png.ts && git commit -m "feat(server): SVG->PNG via @resvg/resvg-js"`.

---

## Task 3 (server): record chart images in docx-blocks

**Files:** `src/lib/docx-blocks.ts`

- [ ] **Step 1:** Extend `renderBlocks`'s return with `images: { afterParaCount: number; png: Buffer; widthEmu: number; heightEmu: number }[]`. In the `case "chart":` (added in the earlier fix), TRY the image path; FALL BACK to the existing caption+table on any throw:
```typescript
case "chart": {
  paragraphs.push(captionPara(spec.title || "Graphique", ctx.align)); // existing caption
  try {
    const { chartToSvg } = require("./chart-svg"); // or import at top
    const { svgToPng } = require("./svg-to-png");
    const svg = chartToSvg(spec, { rtl: ctx.rtl });
    const { png, width, height } = svgToPng(svg, 520);
    const EMU = 9525; // per px @96dpi
    images.push({ afterParaCount: paragraphs.length, png, widthEmu: width * EMU, heightEmu: height * EMU });
  } catch (e) {
    // image path failed → emit the data table fallback (existing behavior)
    const header = ctx.rtl ? ["الفئة", "القيمة"] : ["Catégorie", "Valeur"];
    const rows = (spec.labels || []).map((l, i) => [String(l), String(spec.values?.[i] ?? "")]);
    if (rows.length) tables.push({ afterParaCount: paragraphs.length, table: buildTable(header, rows, ctx.rtl) });
  }
  break;
}
```
(Prefer top-of-file `import` over `require` if the file is ESM — match the file's style. Keep `captionPara`/`buildTable` from the earlier fix.)
- [ ] **Step 2:** tsc clean; commit: `git add src/lib/docx-blocks.ts && git commit -m "feat(export): record chart images (SVG->PNG) with table fallback in docx-blocks"`.

---

## Task 4 (server): place images in docx.ts

**Files:** `src/lib/docx.ts`

- [ ] **Step 1:** `renderBlocks` now returns `images` too. In the chapter/section walk, collect images alongside tables, offsetting `afterParaCount` by the running paragraph base exactly like tables. After `await engine.document.saveChanges(paras)`, merge tables + images into ONE insertion list and apply in **descending `afterParaCount`** order so indices stay valid:
```typescript
type Insertion = { afterParaCount: number; kind: "table"; table: any } | { afterParaCount: number; kind: "image"; png: Buffer; widthEmu: number; heightEmu: number };
const insertions: Insertion[] = [
  ...tableInserts.map((t) => ({ ...t, kind: "table" as const })),
  ...imageInserts.map((im) => ({ ...im, kind: "image" as const })),
].sort((a, b) => b.afterParaCount - a.afterParaCount);
for (const ins of insertions) {
  if (ins.kind === "table") {
    await engine.document.insertTable(ins.table, ins.afterParaCount);
  } else {
    try {
      const { relId } = await engine.media.insertImage(ins.png, "png");
      await engine.shapes.insertImage(relId, { width: ins.widthEmu, height: ins.heightEmu, paragraphIndex: ins.afterParaCount });
    } catch (e) { console.warn("chart image embed failed:", (e as any)?.message); }
  }
}
```
- [ ] **Step 2:** Extend `scripts/test-docx-norms.ts` (which already has a chart fixture): assert the produced `.docx` now contains `word/media/` PNG(s) and `document.xml` has `<wp:inline`/`r:embed` — AND that it still opens as a valid zip (PK header). If `@resvg` is unavailable in the test env, the fallback table path keeps the test green (assert: EITHER an embedded image OR the data table is present). Run → PASS. Write the file to `/tmp/test-thesis-charts.docx` for manual Word inspection.
- [ ] **Step 3:** tsc clean; commit: `git add src/lib/docx.ts scripts/test-docx-norms.ts && git commit -m "feat(export): embed chart images in .docx (fallback to data table)"`.

---

## Task 5: Verify
- [ ] `cd ~/mdocxengine && npx vitest run ShapeManager.image` → PASS.
- [ ] `cd ~/modakerati-server && npx tsx scripts/test-svg-to-png.ts && npx tsx scripts/test-docx-norms.ts && npx tsc --noEmit && echo OK`.
- [ ] (Manual, user) export a thesis with a chart → open in Word → the chart appears as an image.

## Definition of done
- `~/mdocxengine` exposes `ShapeManager.insertImage(relId, opts)` (tested standalone).
- Exported `.docx` embeds charts as real PNG images; uploaded-figure embedding is now unblocked by the same method (wire markdown `![alt](url)` images in a follow-up if wanted).
- On any rasterize/embed failure, the export gracefully falls back to the caption + data table — never raw JSON, never a crash.

## Out of scope
- Markdown `![alt](url)` inline figure images in chapter content (the helper now exists; wiring fetch+embed is a small follow-up).
- SVG-native embedding (we rasterize to PNG for max compatibility).
- LaTeX chart rendering (latex.ts still emits the fenced text — separate follow-up).
