# Workspace Edit-Mode Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Edit" mode to the workspace composer bottom sheet — toggled by an ✨AI ⇄ ✏️Edit segmented control — that applies block-level paragraph style (Normal, H1–H6), alignment (left/center/right/justify), and clear-formatting to the selected paragraph, without the AI.

**Architecture:** Three layers. (1) **mdocxengine** (`/Users/hamzasafwan/mdocxengine`, editable `file:` dep) gains three order- and run-preserving block-indexed methods on `DocumentManager`. (2) **modakerati-server** extends `PUT /api/thesis/:id/paragraphs/:index` to call them, and reports the real heading level + alignment in the block DTO. (3) **modakerati** (Expo app) adds a `composerMode` store flag, a mode toggle, an edit-tools panel, and widens the client DTO + api call.

**Tech Stack:** TypeScript, mdocxengine (OOXML), Hono (server), Expo/React Native + Zustand + react-i18next (app), Vitest (engine + server unit tests).

**Cross-repo build note:** The server imports mdocxengine's built `dist/`. After editing engine source you MUST rebuild it (Task 4) before the server sees the new methods.

---

## File Structure

**mdocxengine** (`/Users/hamzasafwan/mdocxengine`)
- Modify: `src/core/PartsManagers/DocumentManager.ts` — add `setBlockStyle`, `setBlockAlignment`, `clearBlockFormatting`.
- Create/append test: `src/core/PartsManagers/DocumentManager.edits.spec.ts` — order + run + outline preservation.

**modakerati-server** (`/Users/hamzasafwan/modakerati-server`)
- Modify: `src/lib/thesis-doc.ts` — un-clamp DTO `level`, add `alignment` in `blockToDTO`; widen `DocBlockDTO`.
- Modify: `src/routes/thesis.ts:178` — extend `PUT /:id/paragraphs/:index`.
- Test: `src/__tests__/block-dto.test.ts` — mapper reports real level + alignment.

**modakerati** (`/Users/hamzasafwan/modakerati`)
- Modify: `lib/api.ts` — widen `DocBlockDTO` (`level: 0..6`, `alignment`), widen `editThesisParagraph`.
- Modify: `components/workspace/DocBlock.tsx:169` — clamp heading font-size lookup.
- Modify: `stores/workspace-store.ts` — add `composerMode` + `setComposerMode`.
- Create: `components/workspace/ComposerModeToggle.tsx` — the AI ⇄ Edit segmented control.
- Create: `components/workspace/ComposerEditTools.tsx` — style + alignment + clear rows.
- Modify: `components/workspace/WorkspaceComposerSheet.tsx` — render toggle + edit tools.
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json` — new strings.

---

## Task 1: Engine — `setBlockStyle(index, styleId)` on DocumentManager

Applies a paragraph style by block index, preserving order and runs. `"Normal"` demotes: removes `w:pStyle` + `w:outlineLvl`. `"Heading{n}"` sets style + `w:outlineLvl = n-1` (so the outline/TOC detects it).

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/DocumentManager.ts`
- Test: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/DocumentManager.edits.spec.ts`

- [ ] **Step 1: Confirm imports at top of DocumentManager.ts**

Ensure these are imported (add any missing). `splitDocument`, `BodyBlock`, `DOC_PATH` are already used by `getBlocks`/`saveBlocks`. Add `Paragraph` and `buildXml`:

```ts
import Paragraph from "../files/paragraph";
import { buildXml } from "../../utils/xmlUtils";
```

(Verify the relative paths resolve from `src/core/PartsManagers/`: paragraph is at `../files/paragraph/index.ts`; xmlUtils at `../../utils/xmlUtils.ts`.)

- [ ] **Step 2: Write the failing test**

Append to `DocumentManager.edits.spec.ts` (create the file with the same `makeZip`/`SAMPLE_DOC_XML` interleave helper used by `DocumentManager.blocks.spec.ts` — copy that spec's top-of-file setup verbatim so blocks are `paragraph,table,paragraph,table,paragraph`). Then:

```ts
import { paragraphStyleId, paragraphOutlineLevel } from "../files/body/OrderedBody";

test("setBlockStyle('Heading2') sets style+outline, keeps table order", async () => {
  await dm.setBlockStyle(2, "Heading2"); // block 2 is the "Middle" paragraph
  const blocks = await dm.getBlocks();
  expect(blocks.map((b) => b.kind)).toEqual(["paragraph","table","paragraph","table","paragraph"]);
  expect(paragraphStyleId(blocks[2].xml)).toBe("Heading2");
  expect(paragraphOutlineLevel(blocks[2].xml)).toBe(1); // level-1
});

test("setBlockStyle('Normal') removes heading style + outlineLvl", async () => {
  await dm.setBlockStyle(2, "Heading3");
  await dm.setBlockStyle(2, "Normal");
  const blocks = await dm.getBlocks();
  expect(paragraphStyleId(blocks[2].xml)).not.toBe("Heading3");
  expect(paragraphOutlineLevel(blocks[2].xml)).toBeNull();
});

test("setBlockStyle rejects a table block", async () => {
  await expect(dm.setBlockStyle(1, "Heading1")).rejects.toThrow(/no text paragraph/);
});
```

- [ ] **Step 3: Run the test — verify it fails**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/core/PartsManagers/DocumentManager.edits.spec.ts`
Expected: FAIL — `dm.setBlockStyle is not a function`.

- [ ] **Step 4: Implement `setBlockStyle`**

Add this method to the `DocumentManager` class (near `editParagraphText`):

```ts
/**
 * Set the paragraph style at block `index`, preserving order + runs.
 * "Normal" demotes to body (drops w:pStyle + w:outlineLvl). "Heading{n}"
 * sets the style AND w:outlineLvl = n-1 so the outline/TOC detects it.
 */
public async setBlockStyle(index: number, styleId: string): Promise<void> {
  const blocks = await this.getBlocks();
  const b = blocks[index];
  if (!b || b.kind !== "paragraph" || b.xml.includes("<w:drawing>")) {
    throw new Error(`setBlockStyle: no text paragraph at block index ${index}`);
  }
  const p = await Paragraph.createFromXml(b.xml);
  // ensurePPr is private; applyStyle() calls it. Access pPr after.
  if (styleId === "Normal") {
    p.applyStyle("Normal");
    const pPr = (p as any).paragraph["w:pPr"];
    delete pPr["w:pStyle"];
    delete pPr["w:outlineLvl"];
  } else {
    p.applyStyle(styleId);
    const m = /^Heading([1-6])$/.exec(styleId);
    if (m) {
      (p as any).paragraph["w:pPr"]["w:outlineLvl"] = { $: { "w:val": String(Number(m[1]) - 1) } };
    }
  }
  blocks[index] = { ...b, xml: buildXml((p as any).paragraph, { rootName: "w:p", headless: true, pretty: false }) };
  await this.saveBlocks(blocks);
}
```

Note: `(p as any).paragraph` reaches the inner xml2js node (the `Paragraph` field is private but this mirrors how the engine's own code round-trips it — see `editTableCell`'s `table.toObject()`). If DocumentManager's lint forbids `any`, add a small typed accessor on `Paragraph` in Task 1b, but `any` matches existing engine patterns.

- [ ] **Step 5: Run the test — verify it passes**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/core/PartsManagers/DocumentManager.edits.spec.ts`
Expected: PASS (all 3 tests in this task).

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/mdocxengine
git add src/core/PartsManagers/DocumentManager.ts src/core/PartsManagers/DocumentManager.edits.spec.ts
git commit -m "feat(engine): setBlockStyle — order+run-preserving paragraph style by block index"
```

---

## Task 2: Engine — `setBlockAlignment(index, alignment)`

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/DocumentManager.ts`
- Test: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/DocumentManager.edits.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the same spec. Use `SAMPLE_DOC_XML` where a paragraph has ≥1 run with formatting (e.g. `<w:r><w:rPr><w:b/></w:rPr><w:t>Middle</w:t></w:r>`; adjust the fixture's "Middle" paragraph to include a `<w:b/>` run so run-preservation is testable):

```ts
import { paragraphAlignment } from "../files/body/OrderedBody";

test("setBlockAlignment('center') sets jc and preserves runs + order", async () => {
  await dm.setBlockAlignment(2, "center");
  const blocks = await dm.getBlocks();
  expect(blocks.map((b) => b.kind)).toEqual(["paragraph","table","paragraph","table","paragraph"]);
  expect(paragraphAlignment(blocks[2].xml)).toBe("center");
  expect(blocks[2].xml).toContain("<w:b"); // bold run preserved (NOT flattened)
});

test("setBlockAlignment rejects non-paragraph", async () => {
  await expect(dm.setBlockAlignment(1, "center")).rejects.toThrow(/no text paragraph/);
});
```

- [ ] **Step 2: Run — verify fails**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/core/PartsManagers/DocumentManager.edits.spec.ts`
Expected: FAIL — `dm.setBlockAlignment is not a function`.

- [ ] **Step 3: Implement**

```ts
/** Set paragraph alignment at block `index`, preserving order + runs. */
public async setBlockAlignment(
  index: number,
  alignment: "left" | "center" | "right" | "both",
): Promise<void> {
  const blocks = await this.getBlocks();
  const b = blocks[index];
  if (!b || b.kind !== "paragraph" || b.xml.includes("<w:drawing>")) {
    throw new Error(`setBlockAlignment: no text paragraph at block index ${index}`);
  }
  const p = await Paragraph.createFromXml(b.xml);
  p.setAlignment(alignment);
  blocks[index] = { ...b, xml: buildXml((p as any).paragraph, { rootName: "w:p", headless: true, pretty: false }) };
  await this.saveBlocks(blocks);
}
```

- [ ] **Step 4: Run — verify passes**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/core/PartsManagers/DocumentManager.edits.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/hamzasafwan/mdocxengine
git add -A && git commit -m "feat(engine): setBlockAlignment by block index (run+order preserving)"
```

---

## Task 3: Engine — `clearBlockFormatting(index)`

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/DocumentManager.ts`
- Test: `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/DocumentManager.edits.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("clearBlockFormatting strips run props but keeps text + order", async () => {
  await dm.clearBlockFormatting(2); // "Middle" has a <w:b/> run
  const blocks = await dm.getBlocks();
  expect(blocks.map((b) => b.kind)).toEqual(["paragraph","table","paragraph","table","paragraph"]);
  expect(blocks[2].xml).not.toContain("<w:b"); // bold stripped
  expect(blocks[2].xml).toContain("Middle");   // text kept
});
```

- [ ] **Step 2: Run — verify fails**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/core/PartsManagers/DocumentManager.edits.spec.ts`
Expected: FAIL — `dm.clearBlockFormatting is not a function`.

- [ ] **Step 3: Implement**

```ts
/** Strip run-level formatting (bold/italic/font) at block `index`; keeps text. */
public async clearBlockFormatting(index: number): Promise<void> {
  const blocks = await this.getBlocks();
  const b = blocks[index];
  if (!b || b.kind !== "paragraph" || b.xml.includes("<w:drawing>")) {
    throw new Error(`clearBlockFormatting: no text paragraph at block index ${index}`);
  }
  const p = await Paragraph.createFromXml(b.xml);
  p.removeFormatting();
  blocks[index] = { ...b, xml: buildXml((p as any).paragraph, { rootName: "w:p", headless: true, pretty: false }) };
  await this.saveBlocks(blocks);
}
```

- [ ] **Step 4: Run — verify passes**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/core/PartsManagers/DocumentManager.edits.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full engine test + coverage gate**

Run: `cd /Users/hamzasafwan/mdocxengine && npm run test:ci`
Expected: PASS with coverage still ≥ thresholds (statements/functions/lines 100, branches 99.68). If the three new methods drop branch coverage, add tests covering the not-found branch for each (already covered by the "rejects" tests) — ensure every `throw` branch has a test.

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/mdocxengine
git add -A && git commit -m "feat(engine): clearBlockFormatting by block index"
```

---

## Task 4: Build the engine so the server sees the new methods

**Files:** none (build artifacts only)

- [ ] **Step 1: Build**

Run: `cd /Users/hamzasafwan/mdocxengine && npm run build`
Expected: `tsc` passes (no type errors), `vite build --ssr` emits `dist/`.

- [ ] **Step 2: Verify the server resolves the new methods**

Run:
```bash
cd /Users/hamzasafwan/modakerati-server && node -e "const {default:x}=require('mdocxengine'); const m=require('mdocxengine'); console.log(typeof m)" 2>/dev/null; \
grep -c "setBlockAlignment" node_modules/mdocxengine/dist/index.js
```
Expected: the grep prints a count ≥ 1 (the built dist contains the new method). (`node_modules/mdocxengine` is symlinked to the source, so the fresh `dist/` is picked up.)

- [ ] **Step 3: Commit the built dist (matches repo convention — dist is committed)**

```bash
cd /Users/hamzasafwan/mdocxengine
git add dist && git commit -m "build(engine): rebuild dist with block edit methods"
```
(If `dist/` is gitignored in this repo, skip this step — the `file:` symlink means the server reads the on-disk `dist/` regardless.)

---

## Task 5: Server — un-clamp DTO level + add alignment

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/lib/thesis-doc.ts` (type at line 28-29; mapper at ~113-120)
- Test: `/Users/hamzasafwan/modakerati-server/src/__tests__/block-dto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/block-dto.test.ts`. It builds a docx with a Heading5 + a centered paragraph via `Doc`, then maps blocks. (Use the exported `blockToDTO` — if it's not exported, this task also exports it. Add `export` to `blockToDTO` and `DocBlockDTO`.)

```ts
import { describe, it, expect } from "vitest";
import { Doc } from "mdocxengine";
import { blockToDTO } from "../lib/thesis-doc";

describe("blockToDTO", () => {
  it("reports real heading level (>4) and alignment", async () => {
    const doc = await Doc.open(new URL("../../assets/thesis-base.docx", import.meta.url).pathname);
    await doc.addHeading("Deep", 5);                 // Heading5
    await doc.addParagraph("Centered");
    const blocks = await doc.blocks();
    const engine = (doc as any).engine;
    const dtos = await Promise.all(blocks.map((b: any, i: number) => blockToDTO(b, i, engine)));
    const h5 = dtos.find((d) => d.kind === "paragraph" && d.text === "Deep");
    expect(h5.level).toBe(5);                          // NOT clamped to 4
    expect(dtos.some((d) => "alignment" in d)).toBe(true);
  });
});
```

(If `Doc.addHeading`/`addParagraph`/`blocks` signatures differ, adjust to the real ones — verified present in `Doc.ts`.)

- [ ] **Step 2: Run — verify fails**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/block-dto.test.ts`
Expected: FAIL — `blockToDTO` not exported, or `level` clamped to 4.

- [ ] **Step 3: Widen the DTO type + un-clamp + add alignment**

In `src/lib/thesis-doc.ts`, import `paragraphAlignment`:
```ts
import {
  paragraphStyleId,
  paragraphHeadingLevel,
  headingLevelFromStyleId,
  paragraphAlignment,
} from "mdocxengine";
```
Change the paragraph DTO union member (line ~29) to:
```ts
  | { index: number; kind: "paragraph"; text: string; styleId: string | null; level: 0 | 1 | 2 | 3 | 4 | 5 | 6; alignment: "left" | "center" | "right" | "both" | null }
```
Export it: `export type DocBlockDTO =`. In `blockToDTO`, replace the paragraph return (lines ~113-120) with:
```ts
    const styleId = paragraphStyleId(block.xml);
    const lvl = headingLevelFromStyleId(styleId);
    const align = paragraphAlignment(block.xml);
    return {
      index,
      kind: "paragraph",
      text: paragraphText(block.xml),
      styleId,
      level: (lvl < 0 ? 0 : lvl > 6 ? 6 : lvl) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      alignment: (align === "left" || align === "center" || align === "right" || align === "both") ? align : null,
    };
```
Also add `export` before `async function blockToDTO`.

- [ ] **Step 4: Run — verify passes**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/block-dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/thesis-doc.ts src/__tests__/block-dto.test.ts
git commit -m "feat(server): report real heading level + alignment in block DTO"
```

---

## Task 6: Server — extend `PUT /:id/paragraphs/:index`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/routes/thesis.ts:178-217`

- [ ] **Step 1: Replace the handler body**

Replace the parse + apply section (currently requires `text`) with support for `text?`, `level?`, `alignment?`, `clearFormatting?`. Keep the ownership/live-docx/lock/upload/reconcile scaffolding:

```ts
thesisRoutes.put("/:id/paragraphs/:index", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const index = Number(c.req.param("index"));
  if (!Number.isInteger(index) || index < 0) {
    return c.json({ error: "Invalid paragraph index" }, 400);
  }
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const text = typeof body?.text === "string" ? body.text : null;
  const level = typeof body?.level === "number" && Number.isInteger(body.level) && body.level >= 0 && body.level <= 6 ? body.level : null;
  const alignMap: Record<string, "left" | "center" | "right" | "both"> = { left: "left", center: "center", right: "right", justify: "both" };
  const alignment = typeof body?.alignment === "string" && body.alignment in alignMap ? alignMap[body.alignment] : null;
  const clearFormatting = body?.clearFormatting === true;
  if (text == null && level == null && alignment == null && !clearFormatting) {
    return c.json({ error: "Nothing to change (text/level/alignment/clearFormatting all absent)" }, 400);
  }

  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  if (thesis.docMode !== "live-docx" || !thesis.docPath) {
    return c.json({ error: "Thesis is not a live Word document" }, 400);
  }

  try {
    const result = await withThesisLock(id, async () => {
      const engine = await loadThesisEngine(thesis.docPath!);
      const blocks = await engine.document.getBlocks();
      if (index >= blocks.length) {
        return { error: `index ${index} out of range (0..${blocks.length - 1})` as string };
      }
      const target = blocks[index];
      if (target.kind !== "paragraph" || target.xml.includes("<w:drawing>")) {
        return { error: `block ${index} is not an editable paragraph` as string };
      }
      // Order matters: text first (rebuilds runs), then style/align/clear.
      if (text != null) await engine.document.editParagraphText(index, text);
      if (level != null) await engine.document.setBlockStyle(index, level === 0 ? "Normal" : `Heading${level}`);
      if (alignment != null) await engine.document.setBlockAlignment(index, alignment);
      if (clearFormatting) await engine.document.clearBlockFormatting(index);
      const buf = engine.zip.toBuffer();
      await uploadDocx(userId, id, Buffer.from(buf));
      scheduleReconcile(id, Buffer.from(buf));
      await db.update(theses).set({ updatedAt: new Date() }).where(eq(theses.id, id));
      return { ok: true as const };
    });
    if ("error" in result) return c.json({ error: result.error }, 400);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e?.message ?? "edit failed" }, 500);
  }
});
```

(Keep the existing `catch` tail if it already returns 500 — match the file's current final lines.)

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit`
Expected: 0 errors (requires Task 4 built dist so `engine.document.setBlockStyle` etc. are typed).

- [ ] **Step 3: Manual endpoint verification (uses the local Supabase + admin user)**

Run (admin token flow, against the running local server):
```bash
SVC="<local service_role key>"; API="http://127.0.0.1:54331"; SRV="http://127.0.0.1:3000"
TOKEN=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $SVC" -H "Content-Type: application/json" -d '{"email":"admin@admin.admin","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
TID=$(curl -s "$SRV/api/thesis" -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')
# find a body paragraph index from the document, then:
curl -s -X PUT "$SRV/api/thesis/$TID/paragraphs/5" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"level":2}'
curl -s -X PUT "$SRV/api/thesis/$TID/paragraphs/5" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"alignment":"center"}'
```
Expected: `{"ok":true}` for both; re-fetching the document shows block 5 with `level:2` then `alignment:"center"`; a block that is a table returns `{"error":"block N is not an editable paragraph"}`.

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/routes/thesis.ts
git commit -m "feat(server): PUT /paragraphs accepts level/alignment/clearFormatting"
```

---

## Task 7: App — widen client DTO + clamp heading render

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/lib/api.ts` (`DocBlockDTO`, ~line 450)
- Modify: `/Users/hamzasafwan/modakerati/components/workspace/DocBlock.tsx:169`

- [ ] **Step 1: Widen the client DTO**

In `lib/api.ts`, change the paragraph member of `DocBlockDTO` to match the server:
```ts
  | { index: number; kind: "paragraph"; text: string; styleId: string | null; level: 0 | 1 | 2 | 3 | 4 | 5 | 6; alignment: "left" | "center" | "right" | "both" | null }
```

- [ ] **Step 2: Clamp the render font-size lookup**

In `DocBlock.tsx` line 169, the lookup `HEADING_SIZE[block.level as 1 | 2 | 3 | 4]` must clamp to 4 now that level can be 5/6:
```tsx
            ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(block.level, 4) as 1 | 2 | 3 | 4] }
```
(`isHeading = block.level >= 1` on line 151 is unchanged.)

- [ ] **Step 3: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add lib/api.ts components/workspace/DocBlock.tsx
git commit -m "feat(app): widen block DTO to H1-H6 + alignment; clamp heading render size"
```

---

## Task 8: App — `composerMode` store flag + widen `editThesisParagraph`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/stores/workspace-store.ts`
- Modify: `/Users/hamzasafwan/modakerati/lib/api.ts` (`editThesisParagraph`, ~line 810)

- [ ] **Step 1: Add `composerMode` to the store**

In `stores/workspace-store.ts`:
- Add to the `WorkspaceState` interface:
```ts
  composerMode: "ai" | "edit";
  setComposerMode: (m: "ai" | "edit") => void;
```
- Add to `INITIAL`: `composerMode: "ai" as "ai" | "edit",`
- Add to the store body:
```ts
  setComposerMode: (m) => set({ composerMode: m }),
```

- [ ] **Step 2: Widen `editThesisParagraph`**

In `lib/api.ts` replace the `editThesisParagraph` signature + body:
```ts
export async function editThesisParagraph(
  thesisId: string,
  index: number,
  changes: { text?: string; level?: number; alignment?: "left" | "center" | "right" | "justify"; clearFormatting?: boolean }
): Promise<{ ok: true }> {
  return apiPut<{ ok: true }>(`/api/thesis/${thesisId}/paragraphs/${index}`, changes);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add stores/workspace-store.ts lib/api.ts
git commit -m "feat(app): composerMode store flag + editThesisParagraph accepts style/align"
```

---

## Task 9: App — `ComposerModeToggle` component

**Files:**
- Create: `/Users/hamzasafwan/modakerati/components/workspace/ComposerModeToggle.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { Sparkles, Pencil } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

type Mode = "ai" | "edit";

interface Props {
  mode: Mode;
  onChange: (m: Mode) => void;
  aiLabel: string;
  editLabel: string;
  rtl: boolean;
}

export function ComposerModeToggle({ mode, onChange, aiLabel, editLabel, rtl }: Props) {
  const colors = useThemeColors();
  const seg = (m: Mode, label: string, Icon: typeof Sparkles) => {
    const active = mode === m;
    return (
      <Pressable
        onPress={() => onChange(m)}
        style={[styles.seg, active && { backgroundColor: colors.brandPrimary }]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Icon size={14} color={active ? colors.bgPrimary : colors.textSecondary} strokeWidth={2.2} />
        <Text style={[styles.segText, { color: active ? colors.bgPrimary : colors.textSecondary }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.wrap, { backgroundColor: colors.bgSecondary, flexDirection: rtl ? "row-reverse" : "row" }]}>
      {seg("ai", aiLabel, Sparkles)}
      {seg("edit", editLabel, Pencil)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderRadius: 12, padding: 3, gap: 3, marginBottom: 8 },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 7, borderRadius: 9 },
  segText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
```

(Verify `Sparkles`/`Pencil` exist in the installed `lucide-react-native`; if not, use `Wand2`/`SquarePen` which are already imported elsewhere in the composer. Verify `colors.bgSecondary`/`textSecondary` exist in `useThemeColors` — the memory lists `bgPrimary`, `textPrimary`, `brandPrimary`, `borderDefault`; use the exact names present in the hook.)

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/ComposerModeToggle.tsx
git commit -m "feat(app): ComposerModeToggle segmented control"
```

---

## Task 10: App — `ComposerEditTools` component

**Files:**
- Create: `/Users/hamzasafwan/modakerati/components/workspace/ComposerEditTools.tsx`

- [ ] **Step 1: Create the component**

Renders the style row (Normal/H1–H6, horizontal scroll), alignment row, and clear button. Acts on the single selected block; shows a hint when 0 or >1 selected or the block is not a paragraph. Applies changes via `editThesisParagraph`, then calls `onAfterEdit()` (the sheet passes `refreshDoc`).

```tsx
import React, { useState } from "react";
import { View, ScrollView, Pressable, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Eraser } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { editThesisParagraph } from "@/lib/api";
import type { DocBlockDTO } from "@/lib/api";

type Align = "left" | "center" | "right" | "justify";

interface Props {
  thesisId: string;
  block: Extract<DocBlockDTO, { kind: "paragraph" }> | null; // the single selected paragraph block, else null
  hint: string;                 // "Select a paragraph to edit."
  styleLabels: { normal: string };
  onAfterEdit: () => void;      // refreshDoc
  rtl: boolean;
}

const STYLE_OPTIONS: Array<{ level: number; label: string }> = [
  { level: 0, label: "" }, // label filled from styleLabels.normal at render
  { level: 1, label: "H1" }, { level: 2, label: "H2" }, { level: 3, label: "H3" },
  { level: 4, label: "H4" }, { level: 5, label: "H5" }, { level: 6, label: "H6" },
];
const ALIGN_OPTIONS: Array<{ value: Align; Icon: typeof AlignLeft }> = [
  { value: "left", Icon: AlignLeft }, { value: "center", Icon: AlignCenter },
  { value: "right", Icon: AlignRight }, { value: "justify", Icon: AlignJustify },
];
// engine "both" == UI "justify"
const alignFromDoc = (a: string | null): Align | null => (a === "both" ? "justify" : (a as Align | null));

export function ComposerEditTools({ thesisId, block, hint, styleLabels, onAfterEdit, rtl }: Props) {
  const colors = useThemeColors();
  const [busy, setBusy] = useState(false);

  if (!block) {
    return <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>;
  }

  const apply = async (changes: Parameters<typeof editThesisParagraph>[2]) => {
    if (busy) return;
    setBusy(true);
    try {
      await editThesisParagraph(thesisId, block.index, changes);
      onAfterEdit();
    } catch {
      Alert.alert("Error");
    } finally {
      setBusy(false);
    }
  };

  const curAlign = alignFromDoc(block.alignment);
  const pill = (active: boolean) => [styles.pill, { borderColor: colors.borderDefault }, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }];
  const pillText = (active: boolean) => [styles.pillText, { color: active ? colors.bgPrimary : colors.textPrimary }];

  return (
    <View style={{ gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        {STYLE_OPTIONS.map((o) => {
          const active = block.level === o.level;
          return (
            <Pressable key={o.level} disabled={busy} onPress={() => apply({ level: o.level })} style={pill(active)}>
              <Text style={pillText(active)}>{o.level === 0 ? styleLabels.normal : o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        {ALIGN_OPTIONS.map(({ value, Icon }) => {
          const active = curAlign === value;
          return (
            <Pressable key={value} disabled={busy} onPress={() => apply({ alignment: value })} style={pill(active)}>
              <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
            </Pressable>
          );
        })}
        <Pressable disabled={busy} onPress={() => apply({ clearFormatting: true })} style={[styles.pill, { borderColor: colors.borderDefault }]}>
          <Eraser size={16} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
        {busy && <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 14, textAlign: "center" },
  row: { gap: 6, alignItems: "center", paddingVertical: 2 },
  pill: { minWidth: 40, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
```

(Verify the lucide icon names exist; verify `useThemeColors` exposes the referenced color keys — substitute the exact ones the hook provides.)

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/ComposerEditTools.tsx
git commit -m "feat(app): ComposerEditTools (style + alignment + clear formatting)"
```

---

## Task 11: App — wire into WorkspaceComposerSheet + i18n

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/components/workspace/WorkspaceComposerSheet.tsx`
- Modify: `/Users/hamzasafwan/modakerati/locales/en.json`, `fr.json`, `ar.json`

- [ ] **Step 1: Add i18n strings**

Add under a `composer.edit` key in each locale (translate fr/ar):
`en.json`:
```json
"composer": { "modeAi": "AI", "modeEdit": "Edit", "edit": { "normal": "Normal", "selectHint": "Select a paragraph to edit." } }
```
(Merge into the existing `composer` object; do not overwrite sibling keys.) fr: `"AI"/"Éditer"/"Normal"/"Sélectionnez un paragraphe à modifier."`; ar: `"ذكاء"/"تحرير"/"عادي"/"اختر فقرة لتحريرها."`.

- [ ] **Step 2: Import the new pieces + derive the selected paragraph block**

In `WorkspaceComposerSheet.tsx`:
- Add imports:
```ts
import { ComposerModeToggle } from "./ComposerModeToggle";
import { ComposerEditTools } from "./ComposerEditTools";
```
- Read the mode: `const composerMode = useWorkspaceStore((s) => s.composerMode);`
- The sheet already knows the live doc via its props/`liveDoc`. Derive the single selected paragraph block for edit tools (the sheet receives `documentId`/blocks via props; if the block list isn't already a prop, pass `blocks: DocBlockDTO[]` from the parent screen which holds `liveDoc`). Compute:
```ts
const editBlock = React.useMemo(() => {
  if (count !== 1) return null;
  const b = blocks.find((x) => x.index === selectedBlocks[0].index);
  return b && b.kind === "paragraph" ? b : null;
}, [count, blocks, selectedBlocks]);
```
(If `blocks` is not currently a prop of the sheet, add it to `Props` and pass `liveDoc.blocks` from `thesis-workspace.tsx` where the sheet is rendered.)

- [ ] **Step 3: Render the toggle + branch the content**

Inside `BottomSheetView`, after the focus chip, add the toggle (only for a live doc):
```tsx
{isLiveDoc && (
  <ComposerModeToggle
    mode={composerMode}
    onChange={(m) => useWorkspaceStore.getState().setComposerMode(m)}
    aiLabel={t("composer.modeAi", { defaultValue: "AI" })}
    editLabel={t("composer.modeEdit", { defaultValue: "Edit" })}
    rtl={rtl}
  />
)}
```
Then branch the non-`pendingAsk` body: when `composerMode === "edit" && isLiveDoc`, render `ComposerEditTools` in place of `ComposerThinking`+`ComposerInput`+`ComposerQuickActions` (keep `ComposerToolsTray` below in both modes):
```tsx
{composerMode === "edit" && isLiveDoc ? (
  <ComposerEditTools
    thesisId={thesisId}
    block={editBlock}
    hint={t("composer.edit.selectHint", { defaultValue: "Select a paragraph to edit." })}
    styleLabels={{ normal: t("composer.edit.normal", { defaultValue: "Normal" }) }}
    onAfterEdit={onAfterBulkEdit}
    rtl={rtl}
  />
) : (
  <>
    <ComposerThinking … />
    <View style={styles.inputSpacer} />
    <ComposerInput … />
    <ComposerQuickActions … />
  </>
)}
<ComposerToolsTray label={t("composer.toolsLabel")} tools={tools} />
```
(`onAfterBulkEdit` is the existing prop that triggers `refreshDoc` in the parent.)

- [ ] **Step 4: Guard — reset to AI mode when the doc isn't live**

Add an effect so a non-live doc never gets stuck in edit mode:
```ts
useEffect(() => {
  if (!isLiveDoc && composerMode === "edit") useWorkspaceStore.getState().setComposerMode("ai");
}, [isLiveDoc, composerMode]);
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Verify in the running app (real flow)**

With local Supabase + server running and logged in as `admin@admin.admin`: open a thesis, tap a paragraph (chip shows it), tap **Edit**, tap **H2** → the heading updates in the Word view and appears in the Outline; tap **center** → paragraph centers; toggle back to **AI** → the chat input returns. Confirm the style row scrolls to H6 and the active style/alignment are highlighted.

- [ ] **Step 7: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/WorkspaceComposerSheet.tsx locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(app): AI/Edit mode toggle + edit tools in the composer sheet"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** style (Task 1/6/10), alignment (Task 2/6/10), clear-formatting (Task 3/6/10), toggle (Task 9/11), single-block guard + hint (Task 10), non-live-docx disable (Task 11 step 4), un-clamp level (Task 5/7), alignment in DTO (Task 5/7), order+run preservation (Task 1-3 tests) — all mapped.
- **Index-space risk (spec §Server):** resolved — all three engine methods operate on the block-index space via `getBlocks()`/`saveBlocks()` (NOT `getParagraphByIndex`, which is paragraph-only and whose `saveChanges` reorders tables). Tests assert `["paragraph","table",…]` order survives.
- **Type consistency:** `DocBlockDTO.level: 0..6` and `alignment: "left"|"center"|"right"|"both"|null` identical in server (`thesis-doc.ts`) and app (`api.ts`); UI maps `both↔justify` at the edges (`alignFromDoc`, `alignMap`).
- **Open verification items flagged inline:** exact `useThemeColors` color keys, lucide icon names, and whether the sheet already receives `blocks` as a prop — each has a "verify/substitute" note at its step.
