# Header/Footer Template Studio — P1: Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `modakerati-server`, add the `header_footer_templates` table plus a pure **model→OOXML converter** and two token-gated endpoints — `POST /admin/hf-templates/compile` (model → header/footer OOXML parts) and `POST /admin/hf-templates/generate` (prompt → AI-drafted model) — that the dashboard (P2) consumes.

**Architecture:** A pure `compileTemplate(model)` turns the JSON model into `<w:hdr>`/`<w:ftr>` block-level OOXML (tab-stop paragraphs + `PAGE`/`NUMPAGES`/`STYLEREF` fields; `<w:tbl>` with `<w:tblBorders>`/`<w:tcBorders>`/`<w:shd>`/`<w:gridSpan>`/`<w:vAlign>`) plus a `sectPr` snippet (`<w:pgNumType>`/`<w:titlePg>`) and a media manifest. The endpoints are a thin Hono router mounted under `/admin` (skips the `/api/*` Supabase-auth middleware) and gated by the existing `ADMIN_API_TOKEN` / `x-admin-token` convention. Compile and generate are **stateless** transforms — the dashboard owns the DB rows; the table exists only so the dashboard can store them.

**Tech Stack:** Hono, Drizzle (pg), TypeScript, Vitest, the existing `src/lib/ai` provider layer.

**Consumed by:** P2 (dashboard). The endpoint contracts here are fixed and mirrored in P2's `src/lib/api/server.ts`:
- `POST /admin/hf-templates/compile` — `{ model }` → `{ headerXml, footerXml, sectPr, media: {assetPath}[], warnings: string[] }`
- `POST /admin/hf-templates/generate` — `{ prompt, language, structureHint }` → `{ model, warnings }`

---

## ⚠️ Verification model (read first)

- **Unit tests (Vitest):** this repo runs `npm test` (= `vitest run`), tests live in `src/__tests__/`. The model validator, the OOXML converter, and the AI-response parser get real Vitest tests — these are pure functions and are the bulk of the risk, so TDD them.
- **Type/build gate per task:** `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit` clean; `npm run build` for the final task.
- **DB:** `ensureSchema()` (raw SQL) creates the table at boot; there is no unit test for the DB — verify by `npm run build` and (if `DATABASE_URL` is reachable) booting once and checking the table exists.
- **Git (parallel-session safe):** `git add` exact paths only — never `git add -A`/`.`. Fresh commits, never `--amend`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

**Create:**
- `src/lib/hf-template-model.ts` — the model TS types (mirror of the dashboard's `src/features/hf-templates/types.ts`) + `validateHfModel`.
- `src/lib/hf-template-ooxml.ts` — `compileTemplate(model)` (pure).
- `src/lib/hf-template-ai.ts` — `buildGeneratePrompt` + `parseModelFromText` (pure) + `draftModelWithAi` (calls the provider).
- `src/routes/hf-templates.ts` — the `/compile` + `/generate` Hono router.
- `src/__tests__/hf-template-model.test.ts`
- `src/__tests__/hf-template-ooxml.test.ts`
- `src/__tests__/hf-template-ai.test.ts`

**Modify:**
- `src/db/schema.ts` — add the `headerFooterTemplates` pgTable.
- `src/db/index.ts` — add the `CREATE TABLE IF NOT EXISTS header_footer_templates …` block to `ensureSchema()`.
- `src/index.ts` — import + mount `app.route("/admin/hf-templates", hfTemplateRoutes)` **above** `app.route("/admin", adminRoutes)`.

---

## Task 1: Model types + validator

**Files:**
- Create: `src/lib/hf-template-model.ts`
- Create: `src/__tests__/hf-template-model.test.ts`

- [ ] **Step 1: Write the failing test** `src/__tests__/hf-template-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateHfModel, type HfModel } from "../lib/hf-template-model";

const good: HfModel = {
  version: 1,
  options: { differentFirstPage: false, rtl: true, pageNumber: { format: "decimal", startAt: 1 }, frontMatterRoman: true },
  header: { blocks: [{ type: "paragraph", left: [], center: [{ type: "styleRef", style: "Heading 1" }], right: [] }] },
  footer: { blocks: [{ type: "table", columns: 2, columnWidths: [50, 50], rows: [[{ content: [] }, { content: [{ type: "pageNumber" }] }]] }] },
};

describe("validateHfModel", () => {
  it("accepts a well-formed model", () => {
    expect(validateHfModel(good).ok).toBe(true);
  });

  it("rejects wrong version", () => {
    const bad = { ...good, version: 2 } as unknown;
    expect(validateHfModel(bad).ok).toBe(false);
  });

  it("rejects a block with an unknown type", () => {
    const bad = { ...good, header: { blocks: [{ type: "banner" }] } } as unknown;
    const r = validateHfModel(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/block/i);
  });

  it("rejects a table whose columnWidths length != columns", () => {
    const bad = { ...good, footer: { blocks: [{ type: "table", columns: 3, columnWidths: [50, 50], rows: [] }] } } as unknown;
    expect(validateHfModel(bad).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/hf-template-model.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/hf-template-model.ts`:**

```ts
// The header/footer template model. This is the SOURCE OF TRUTH shape, mirrored
// 1:1 in modakerati-dashboard (src/features/hf-templates/types.ts). Keep in sync.

export type HfLang = "en" | "fr" | "ar";
export type HfBorderStyle = "single" | "double" | "dashed" | "dotted" | "none";
export type HfBorderEdge = { style: HfBorderStyle; widthPt: number; color: string };
export type HfEdgeName = "top" | "bottom" | "left" | "right" | "insideH" | "insideV";
export type HfBorderSet = Partial<Record<HfEdgeName, HfBorderEdge>>;

export type HfElement =
  | { type: "text"; value: string }
  | { type: "pageNumber" }
  | { type: "totalPages" }
  | { type: "styleRef"; style: string }
  | { type: "docTitle" }
  | { type: "author" }
  | { type: "university" }
  | { type: "date" }
  | { type: "image"; assetPath: string; assetUrl?: string; widthPt: number; heightPt: number };

export type HfAlign = "left" | "center" | "right";
export type HfVAlign = "top" | "center" | "bottom";

export type HfCell = {
  content: HfElement[];
  align?: HfAlign;
  vAlign?: HfVAlign;
  shading?: string;
  borders?: HfBorderSet;
  colSpan?: number;
  rowSpan?: number;
  merged?: boolean;
};

export type HfParagraphBlock = { type: "paragraph"; left: HfElement[]; center: HfElement[]; right: HfElement[] };
export type HfTableBlock = { type: "table"; columns: number; columnWidths: number[]; borders?: HfBorderSet; rows: HfCell[][] };
export type HfBlock = HfParagraphBlock | HfTableBlock;
export type HfRegion = { blocks: HfBlock[] };
export type HfPageNumberFormat = "decimal" | "lowerRoman" | "upperRoman";

export type HfModel = {
  version: 1;
  options: {
    differentFirstPage: boolean;
    rtl: boolean;
    pageNumber: { format: HfPageNumberFormat; startAt: number };
    frontMatterRoman: boolean;
  };
  header: HfRegion;
  footer: HfRegion;
  firstPage?: { header: HfRegion; footer: HfRegion };
};

const ELEMENT_TYPES = new Set(["text", "pageNumber", "totalPages", "styleRef", "docTitle", "author", "university", "date", "image"]);

function checkRegion(region: any, where: string, errors: string[]): void {
  if (!region || !Array.isArray(region.blocks)) {
    errors.push(`${where}.blocks must be an array`);
    return;
  }
  region.blocks.forEach((b: any, i: number) => {
    if (b?.type === "paragraph") {
      for (const area of ["left", "center", "right"]) {
        if (!Array.isArray(b[area])) errors.push(`${where}.blocks[${i}].${area} must be an array`);
        else b[area].forEach((el: any, j: number) => { if (!ELEMENT_TYPES.has(el?.type)) errors.push(`${where}.blocks[${i}].${area}[${j}] bad element type`); });
      }
    } else if (b?.type === "table") {
      if (typeof b.columns !== "number" || b.columns < 1) errors.push(`${where}.blocks[${i}].columns invalid`);
      if (!Array.isArray(b.columnWidths) || b.columnWidths.length !== b.columns) errors.push(`${where}.blocks[${i}].columnWidths length must equal columns`);
      if (!Array.isArray(b.rows)) errors.push(`${where}.blocks[${i}].rows must be an array`);
      else b.rows.forEach((row: any, ri: number) => {
        if (!Array.isArray(row)) { errors.push(`${where}.blocks[${i}].rows[${ri}] must be an array`); return; }
        row.forEach((cell: any, ci: number) => {
          if (!cell || !Array.isArray(cell.content)) errors.push(`${where}.blocks[${i}].rows[${ri}][${ci}].content must be an array`);
          else cell.content.forEach((el: any, j: number) => { if (!ELEMENT_TYPES.has(el?.type)) errors.push(`${where}.blocks[${i}].rows[${ri}][${ci}].content[${j}] bad element type`); });
        });
      });
    } else {
      errors.push(`${where}.blocks[${i}] has unknown block type "${b?.type}"`);
    }
  });
}

export function validateHfModel(model: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const m = model as any;
  if (!m || typeof m !== "object") return { ok: false, errors: ["model must be an object"] };
  if (m.version !== 1) errors.push("version must be 1");
  const o = m.options;
  if (!o || typeof o !== "object") errors.push("options missing");
  else {
    if (typeof o.differentFirstPage !== "boolean") errors.push("options.differentFirstPage must be boolean");
    if (typeof o.rtl !== "boolean") errors.push("options.rtl must be boolean");
    if (!o.pageNumber || !["decimal", "lowerRoman", "upperRoman"].includes(o.pageNumber.format)) errors.push("options.pageNumber.format invalid");
  }
  checkRegion(m.header, "header", errors);
  checkRegion(m.footer, "footer", errors);
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/hf-template-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/hf-template-model.ts src/__tests__/hf-template-model.test.ts
git commit -m "feat(hf-templates): model types + validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: OOXML converter

**Files:**
- Create: `src/lib/hf-template-ooxml.ts`
- Create: `src/__tests__/hf-template-ooxml.test.ts`

- [ ] **Step 1: Write the failing test** `src/__tests__/hf-template-ooxml.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compileTemplate } from "../lib/hf-template-ooxml";
import type { HfModel } from "../lib/hf-template-model";

const model: HfModel = {
  version: 1,
  options: { differentFirstPage: true, rtl: true, pageNumber: { format: "lowerRoman", startAt: 1 }, frontMatterRoman: true },
  header: {
    blocks: [
      {
        type: "table",
        columns: 3,
        columnWidths: [33, 34, 33],
        borders: { bottom: { style: "single", widthPt: 1, color: "000000" } },
        rows: [[
          { content: [{ type: "text", value: "جامعة البيّض" }], align: "center", shading: "F2F2F2", vAlign: "center" },
          { content: [{ type: "image", assetPath: "logo.png", widthPt: 48, heightPt: 48 }], align: "center" },
          { content: [{ type: "styleRef", style: "Heading 1" }], align: "center", colSpan: 1 },
        ]],
      },
    ],
  },
  footer: { blocks: [{ type: "paragraph", left: [{ type: "university" }], center: [], right: [{ type: "pageNumber" }] }] },
};

describe("compileTemplate", () => {
  const out = compileTemplate(model);

  it("emits a table with grid + bottom border + gridSpan-free cells", () => {
    expect(out.headerXml).toContain("<w:tbl>");
    expect(out.headerXml).toContain("<w:tblGrid>");
    expect(out.headerXml).toContain("<w:tblBorders>");
    expect(out.headerXml).toMatch(/<w:bottom w:val="single"/);
    expect(out.headerXml).toContain("<w:gridCol");
  });

  it("emits cell shading + vAlign", () => {
    expect(out.headerXml).toMatch(/<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/);
    expect(out.headerXml).toContain('<w:vAlign w:val="center"/>');
  });

  it("emits STYLEREF for chapter title and records logo media", () => {
    expect(out.headerXml).toContain("STYLEREF");
    expect(out.media).toEqual([{ assetPath: "logo.png" }]);
    expect(out.warnings.join(" ")).toMatch(/image/i);
  });

  it("emits footer tab stops + PAGE field", () => {
    expect(out.footerXml).toContain('<w:tab w:val="center"');
    expect(out.footerXml).toContain('<w:tab w:val="right"');
    expect(out.footerXml).toContain("PAGE");
  });

  it("emits sectPr with lowerRoman numbering + titlePg", () => {
    expect(out.sectPr).toContain('<w:pgNumType w:fmt="lowerRoman"');
    expect(out.sectPr).toContain("<w:titlePg/>");
  });

  it("adds bidi on rtl paragraphs", () => {
    expect(out.footerXml).toContain("<w:bidi/>");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/hf-template-ooxml.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/hf-template-ooxml.ts`:**

```ts
import type {
  HfBorderEdge, HfBorderSet, HfCell, HfElement, HfModel, HfParagraphBlock, HfRegion, HfTableBlock, HfVAlign,
} from "./hf-template-model";

export type HfCompiled = {
  headerXml: string;
  footerXml: string;
  sectPr: string;
  media: { assetPath: string }[];
  warnings: string[];
};

// Usable text width for A4 with ~1in margins ≈ 6.5in = 9360 twips.
const RIGHT_TAB = 9360;
const CENTER_TAB = 4680;
const GRID_TOTAL = 9360;

const NUM_FMT: Record<string, string> = { decimal: "decimal", lowerRoman: "lowerRoman", upperRoman: "upperRoman" };
const VALIGN: Record<HfVAlign, string> = { top: "top", center: "center", bottom: "bottom" };

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fld(instr: string, sample = "1"): string {
  return `<w:fldSimple w:instr="${instr}"><w:r><w:t>${sample}</w:t></w:r></w:fldSimple>`;
}

// One run (or field) for a single element. Images are placeholders here; the
// assetPath is surfaced via media[] for the apply phase to embed.
function elementXml(el: HfElement, ctx: { media: { assetPath: string }[]; warnings: string[] }): string {
  switch (el.type) {
    case "text": return `<w:r><w:t xml:space="preserve">${xml(el.value)}</w:t></w:r>`;
    case "pageNumber": return fld(" PAGE  \\* MERGEFORMAT ", "1");
    case "totalPages": return fld(" NUMPAGES  \\* MERGEFORMAT ", "1");
    case "styleRef": return fld(` STYLEREF &quot;${xml(el.style)}&quot;  \\* MERGEFORMAT `, "");
    case "docTitle": return fld(" TITLE  \\* MERGEFORMAT ", "");
    case "author": return fld(" AUTHOR  \\* MERGEFORMAT ", "");
    case "date": return fld(" DATE  \\* MERGEFORMAT ", "");
    case "university":
      ctx.warnings.push("university resolves from the thesis at apply time (DOCPROPERTY).");
      return fld(" DOCPROPERTY &quot;University&quot;  \\* MERGEFORMAT ", "");
    case "image":
      ctx.media.push({ assetPath: el.assetPath });
      ctx.warnings.push(`image "${el.assetPath}" is embedded at apply time (placeholder emitted).`);
      return `<w:r><w:t>[logo]</w:t></w:r>`;
  }
}

function runs(list: HfElement[], ctx: { media: { assetPath: string }[]; warnings: string[] }): string {
  return list.map((el) => elementXml(el, ctx)).join("");
}

function edgeXml(name: string, e: HfBorderEdge): string {
  const val = e.style === "none" ? "none" : e.style;
  const sz = Math.max(2, Math.round(e.widthPt * 8)); // OOXML w:sz is in eighths of a point
  return `<w:${name} w:val="${val}" w:sz="${sz}" w:space="0" w:color="${e.color}"/>`;
}

function bordersXml(tag: "tblBorders" | "tcBorders", set: HfBorderSet | undefined): string {
  if (!set) return "";
  const order: (keyof HfBorderSet)[] = tag === "tblBorders"
    ? ["top", "left", "bottom", "right", "insideH", "insideV"]
    : ["top", "left", "bottom", "right"]; // cells have no inside edges
  const edges = order.filter((k) => set[k]).map((k) => edgeXml(k as string, set[k]!)).join("");
  return edges ? `<w:${tag}>${edges}</w:${tag}>` : "";
}

function paragraphBlockXml(b: HfParagraphBlock, rtl: boolean, ctx: { media: { assetPath: string }[]; warnings: string[] }): string {
  const tabs = `<w:tabs><w:tab w:val="center" w:pos="${CENTER_TAB}"/><w:tab w:val="right" w:pos="${RIGHT_TAB}"/></w:tabs>`;
  const bidi = rtl ? "<w:bidi/>" : "";
  const body = `${runs(b.left, ctx)}<w:r><w:tab/></w:r>${runs(b.center, ctx)}<w:r><w:tab/></w:r>${runs(b.right, ctx)}`;
  return `<w:p><w:pPr>${tabs}${bidi}</w:pPr>${body}</w:p>`;
}

function cellXml(cell: HfCell, rtl: boolean, ctx: { media: { assetPath: string }[]; warnings: string[] }): string {
  const parts: string[] = [];
  parts.push(`<w:tcW w:w="0" w:type="auto"/>`);
  if ((cell.colSpan ?? 1) > 1) parts.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
  parts.push(bordersXml("tcBorders", cell.borders));
  if (cell.shading) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${cell.shading}"/>`);
  if (cell.vAlign) parts.push(`<w:vAlign w:val="${VALIGN[cell.vAlign]}"/>`);
  const jc = cell.align ? `<w:jc w:val="${cell.align}"/>` : "";
  const bidi = rtl ? "<w:bidi/>" : "";
  const pPr = jc || bidi ? `<w:pPr>${bidi}${jc}</w:pPr>` : "";
  return `<w:tc><w:tcPr>${parts.join("")}</w:tcPr><w:p>${pPr}${runs(cell.content, ctx)}</w:p></w:tc>`;
}

function tableBlockXml(b: HfTableBlock, rtl: boolean, ctx: { media: { assetPath: string }[]; warnings: string[] }): string {
  const grid = b.columnWidths.map((pct) => `<w:gridCol w:w="${Math.round((pct / 100) * GRID_TOTAL)}"/>`).join("");
  const tblPr = `<w:tblPr><w:tblW w:w="0" w:type="auto"/>${rtl ? "<w:bidiVisual/>" : ""}${bordersXml("tblBorders", b.borders)}</w:tblPr>`;
  const rows = b.rows
    .map((row) => `<w:tr>${row.filter((c) => c.merged !== true).map((c) => cellXml(c, rtl, ctx)).join("")}</w:tr>`)
    .join("");
  return `<w:tbl>${tblPr}<w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

function regionXml(region: HfRegion, rtl: boolean, ctx: { media: { assetPath: string }[]; warnings: string[] }): string {
  return region.blocks
    .map((b) => (b.type === "paragraph" ? paragraphBlockXml(b, rtl, ctx) : tableBlockXml(b, rtl, ctx)))
    .join("");
}

export function compileTemplate(model: HfModel): HfCompiled {
  const ctx = { media: [] as { assetPath: string }[], warnings: [] as string[] };
  const rtl = model.options.rtl;
  const headerXml = regionXml(model.header, rtl, ctx);
  const footerXml = regionXml(model.footer, rtl, ctx);

  const fmt = NUM_FMT[model.options.pageNumber.format] ?? "decimal";
  const start = model.options.pageNumber.startAt ?? 1;
  const sectPr = `<w:pgNumType w:fmt="${fmt}" w:start="${start}"/>${model.options.differentFirstPage ? "<w:titlePg/>" : ""}`;

  if (model.options.differentFirstPage && model.firstPage) {
    ctx.warnings.push("first-page header/footer parts are compiled during the apply phase.");
  }

  return { headerXml, footerXml, sectPr, media: ctx.media, warnings: ctx.warnings };
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/hf-template-ooxml.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/hf-template-ooxml.ts src/__tests__/hf-template-ooxml.test.ts
git commit -m "feat(hf-templates): model→OOXML converter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: AI draft helper (prompt + parser)

**Files:**
- Create: `src/lib/hf-template-ai.ts`
- Create: `src/__tests__/hf-template-ai.test.ts`

- [ ] **Step 1: Write the failing test** `src/__tests__/hf-template-ai.test.ts` (tests the pure parser; the model call is not unit-tested):

```ts
import { describe, it, expect } from "vitest";
import { parseModelFromText, buildGeneratePrompt } from "../lib/hf-template-ai";

describe("parseModelFromText", () => {
  const valid = JSON.stringify({
    version: 1,
    options: { differentFirstPage: false, rtl: true, pageNumber: { format: "decimal", startAt: 1 }, frontMatterRoman: true },
    header: { blocks: [] },
    footer: { blocks: [] },
  });

  it("extracts JSON from a ```json fenced block", () => {
    const res = parseModelFromText("Here you go:\n```json\n" + valid + "\n```\nDone.");
    expect(res.model?.version).toBe(1);
    expect(res.error).toBeUndefined();
  });

  it("parses bare JSON", () => {
    expect(parseModelFromText(valid).model?.options.rtl).toBe(true);
  });

  it("returns an error when the JSON is invalid model", () => {
    const res = parseModelFromText(JSON.stringify({ version: 9 }));
    expect(res.model).toBeUndefined();
    expect(res.error).toBeTruthy();
  });

  it("returns an error when there is no JSON at all", () => {
    expect(parseModelFromText("sorry, no json here").error).toBeTruthy();
  });
});

describe("buildGeneratePrompt", () => {
  it("includes the prompt, language, and structure hint", () => {
    const { system, user } = buildGeneratePrompt({
      prompt: "official Algerian letterhead",
      language: "ar",
      structureHint: { block: "table", columns: 3, styles: ["Heading 1"], pageNumbers: true },
    });
    expect(system).toMatch(/JSON/);
    expect(user).toContain("official Algerian letterhead");
    expect(user).toMatch(/table/);
    expect(user).toMatch(/Heading 1/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/hf-template-ai.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/lib/hf-template-ai.ts`:**

```ts
import { getProvider } from "./ai";
import { validateHfModel, type HfModel } from "./hf-template-model";

export type HfStructureHint = { block: "line" | "table"; columns?: number; styles?: string[]; pageNumbers?: boolean };

const SCHEMA_HINT = `Return ONE JSON object, no prose, matching:
{
  "version": 1,
  "options": { "differentFirstPage": boolean, "rtl": boolean,
    "pageNumber": { "format": "decimal"|"lowerRoman"|"upperRoman", "startAt": number },
    "frontMatterRoman": boolean },
  "header": { "blocks": Block[] },
  "footer": { "blocks": Block[] }
}
Block = { "type":"paragraph", "left":Element[], "center":Element[], "right":Element[] }
      | { "type":"table", "columns":number, "columnWidths":number[] (length==columns, sum 100),
          "borders"?: BorderSet, "rows": Cell[][] }
Cell = { "content": Element[], "align"?:"left"|"center"|"right", "vAlign"?:"top"|"center"|"bottom",
         "shading"?: "RRGGBB", "colSpan"?: number, "borders"?: BorderSet }
Element = {"type":"text","value":string} | {"type":"pageNumber"} | {"type":"totalPages"}
        | {"type":"styleRef","style":string} | {"type":"docTitle"} | {"type":"author"}
        | {"type":"university"} | {"type":"date"}
BorderSet = { "top"?:Edge,"bottom"?:Edge,"left"?:Edge,"right"?:Edge,"insideH"?:Edge,"insideV"?:Edge }
Edge = { "style":"single"|"double"|"dashed"|"dotted"|"none", "widthPt":number, "color":"RRGGBB" }`;

export function buildGeneratePrompt(input: { prompt: string; language: string; structureHint: HfStructureHint }): { system: string; user: string } {
  const system = `You design Word header/footer templates for academic theses and output ONLY a JSON model. ${SCHEMA_HINT}`;
  const h = input.structureHint;
  const user = [
    `Language: ${input.language}${input.language === "ar" ? " (RTL — set options.rtl=true)" : ""}.`,
    `Preferred structure: a ${h.block} block${h.block === "table" && h.columns ? ` with ${h.columns} columns` : ""}.`,
    h.styles?.length ? `Chapter-title styles available for styleRef: ${h.styles.join(", ")}.` : "",
    h.pageNumbers ? `Include a page number in the footer.` : "",
    `Design this header/footer: ${input.prompt}`,
    `Respond with the JSON object only.`,
  ].filter(Boolean).join("\n");
  return { system, user };
}

// Pull the first JSON object out of a model reply and validate it.
export function parseModelFromText(text: string): { model?: HfModel; error?: string } {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `not valid JSON: ${(e as Error).message}` };
  }
  const v = validateHfModel(parsed);
  if (!v.ok) return { error: `invalid model: ${v.errors.slice(0, 3).join("; ")}` };
  return { model: parsed as HfModel };
}

// Call the active provider, parse + validate, one retry on failure.
export async function draftModelWithAi(input: { prompt: string; language: string; structureHint: HfStructureHint }): Promise<{ model: HfModel; warnings: string[] }> {
  const { system, user } = buildGeneratePrompt(input);
  const provider = getProvider();
  const warnings: string[] = [];
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await provider.chat(
      [
        { role: "system", content: system },
        { role: "user", content: attempt === 0 ? user : `${user}\n\nYour previous reply was not valid: ${lastErr}. Return ONLY the corrected JSON object.` },
      ],
      { temperature: 0.2, maxTokens: 2000 },
    );
    const parsed = parseModelFromText(res.content);
    if (parsed.model) {
      if (attempt > 0) warnings.push("model required a retry to produce valid JSON.");
      return { model: parsed.model, warnings };
    }
    lastErr = parsed.error ?? "unknown";
  }
  throw new Error(`AI did not return a valid model: ${lastErr}`);
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/hf-template-ai.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/lib/hf-template-ai.ts src/__tests__/hf-template-ai.test.ts
git commit -m "feat(hf-templates): AI draft prompt + response parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Endpoints (`/compile` + `/generate`) + registration

**Files:**
- Create: `src/routes/hf-templates.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write `src/routes/hf-templates.ts`** (mirrors the `x-admin-token` gate from `src/routes/template.ts`):

```ts
import { Hono } from "hono";
import type { AppVariables } from "../types";
import { validateHfModel } from "../lib/hf-template-model";
import { compileTemplate } from "../lib/hf-template-ooxml";
import { draftModelWithAi, type HfStructureHint } from "../lib/hf-template-ai";

export const hfTemplateRoutes = new Hono<{ Variables: AppVariables }>();

// Token gate identical to templateRoutes: requires ADMIN_API_TOKEN via header
// `x-admin-token`; disabled (403) if the env is unset.
function requireToken(c: any): boolean {
  const token = process.env.ADMIN_API_TOKEN;
  return !!token && c.req.header("x-admin-token") === token;
}

// POST /admin/hf-templates/compile  { model } -> { headerXml, footerXml, sectPr, media, warnings }
hfTemplateRoutes.post("/compile", async (c) => {
  if (!requireToken(c)) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json().catch(() => null);
  const model = body?.model;
  const v = validateHfModel(model);
  if (!v.ok) return c.json({ error: "Invalid model", details: v.errors }, 400);
  const out = compileTemplate(model);
  return c.json(out);
});

// POST /admin/hf-templates/generate  { prompt, language, structureHint } -> { model, warnings }
hfTemplateRoutes.post("/generate", async (c) => {
  if (!requireToken(c)) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json().catch(() => null);
  const prompt = String(body?.prompt ?? "").trim();
  const language = String(body?.language ?? "fr");
  const structureHint = (body?.structureHint ?? { block: "table", columns: 3 }) as HfStructureHint;
  if (!prompt) return c.json({ error: "prompt is required" }, 400);
  try {
    const { model, warnings } = await draftModelWithAi({ prompt, language, structureHint });
    return c.json({ model, warnings });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
```

- [ ] **Step 2: Register the router** in `src/index.ts`. Add the import near the other route imports:

```ts
import { hfTemplateRoutes } from "./routes/hf-templates";
```

Then mount it **immediately above** the existing `app.route("/admin", adminRoutes);` line (so the more specific prefix resolves first):

```ts
app.route("/admin/hf-templates", hfTemplateRoutes);
app.route("/admin", adminRoutes);
```

- [ ] **Step 3: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**
```bash
git add src/routes/hf-templates.ts src/index.ts
git commit -m "feat(hf-templates): /admin/hf-templates compile + generate endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `header_footer_templates` table

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`

- [ ] **Step 1: Add the pgTable** to `src/db/schema.ts` (append after the `pendingToolActions` table, end of file — it uses the already-imported `pgTable, uuid, text, boolean, timestamp, jsonb`):

```ts
// ============================================================
// Header / Footer templates (dashboard-authored page chrome)
// ============================================================
// The `model` jsonb is the source of truth (see lib/hf-template-model.ts); the
// *_ooxml / sect_pr columns cache the server-compiled parts. Rows are written by
// the dashboard via the service-role client; the server only compiles/generates.
export const headerFooterTemplates = pgTable("header_footer_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  language: text("language").notNull(),
  university: text("university"),
  discipline: text("discipline").default("generic"),
  model: jsonb("model").notNull(),
  headerOoxml: text("header_ooxml"),
  footerOoxml: text("footer_ooxml"),
  sectPr: text("sect_pr"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

- [ ] **Step 2: Add the `CREATE TABLE`** to `ensureSchema()` in `src/db/index.ts`. Inside the big `await pool.query(\` … \`)` template (the one that ends around line 200), add this block after the `norm_profiles` CREATE TABLE (after its closing `);`, ~line 131):

```sql
    CREATE TABLE IF NOT EXISTS header_footer_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      language text NOT NULL,
      university text,
      discipline text DEFAULT 'generic',
      model jsonb NOT NULL,
      header_ooxml text,
      footer_ooxml text,
      sect_pr text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hf_templates_active ON header_footer_templates (is_active, created_at DESC);
```

(The table is re-exported automatically by `export * from "./schema";` at the bottom of `src/db/index.ts`.)

- [ ] **Step 3: Verify tsc + build.** Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 4: Commit.**
```bash
git add src/db/schema.ts src/db/index.ts
git commit -m "feat(hf-templates): header_footer_templates table + ensureSchema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification (tests + build + manual)

**Files:** none (verification only).

- [ ] **Step 1: Full test suite.** Run: `cd /Users/hamzasafwan/modakerati-server && npm test`
Expected: all suites pass, including the three new ones.

- [ ] **Step 2: Build.** Run: `cd /Users/hamzasafwan/modakerati-server && npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual `/compile` smoke (server running with `ADMIN_API_TOKEN` set).** Run:

```bash
curl -sS -X POST http://localhost:3000/admin/hf-templates/compile \
  -H "content-type: application/json" -H "x-admin-token: $ADMIN_API_TOKEN" \
  -d '{"model":{"version":1,"options":{"differentFirstPage":false,"rtl":false,"pageNumber":{"format":"decimal","startAt":1},"frontMatterRoman":true},"header":{"blocks":[{"type":"table","columns":3,"columnWidths":[33,34,33],"borders":{"bottom":{"style":"single","widthPt":1,"color":"000000"}},"rows":[[{"content":[{"type":"text","value":"University"}],"align":"center"},{"content":[],"align":"center"},{"content":[{"type":"styleRef","style":"Heading 1"}],"align":"center"}]]}]},"footer":{"blocks":[{"type":"paragraph","left":[],"center":[{"type":"pageNumber"}],"right":[]}]}}}' | head -c 800
```
Expected: JSON with `headerXml` containing `<w:tbl>` + `<w:tblBorders>`, `footerXml` containing `PAGE`, non-empty `sectPr`.

- [ ] **Step 4: Manual `/generate` smoke** (only if an AI provider is configured):

```bash
curl -sS -X POST http://localhost:3000/admin/hf-templates/generate \
  -H "content-type: application/json" -H "x-admin-token: $ADMIN_API_TOKEN" \
  -d '{"prompt":"Official Algerian university letterhead: ministry, faculty, university, thin bottom rule; footer page number centered.","language":"ar","structureHint":{"block":"table","columns":3,"styles":["Heading 1"],"pageNumbers":true}}' | head -c 800
```
Expected: JSON `{ model: {...version:1...}, warnings: [...] }`. (A 502 means the provider failed — check provider config; the endpoint contract is still correct.)

- [ ] **Step 5: Bad-token check.** Run the compile curl again without `-H "x-admin-token: …"`.
Expected: `{"error":"Forbidden"}` with HTTP 403.

- [ ] **Step 6: Commit** any fixes (exact paths, fresh commits).

---

## Self-Review (author checklist — completed)

**Spec coverage:** table `header_footer_templates` (Task 5) · converter emitting tabs + `PAGE`/`NUMPAGES`/`STYLEREF` + `w:tbl`/`w:tblBorders`/`w:tcBorders`/`w:shd`/`w:gridSpan`/`w:vAlign` + `sectPr` `pgNumType`/`titlePg` + media manifest + warnings (Task 2) · `/compile` + `/generate` token-gated endpoints (Task 4) · AI structured-output-via-prompt + validate + compile contract (Tasks 3,4) · model validator gating both (Task 1) · schema via `ensureSchema()` (Task 5). ✅

**Placeholder scan:** every step ships real code/commands. No TBD/TODO. ✅

**Type consistency:** `HfModel`/`HfBlock`/`HfCell`/`HfElement`/`HfBorderSet`/`HfStructureHint`, `validateHfModel`, `compileTemplate`→`HfCompiled` (`headerXml,footerXml,sectPr,media,warnings`), `buildGeneratePrompt`/`parseModelFromText`/`draftModelWithAi` are used identically across Tasks 1–4. The `HfCompiled` shape and the `/generate` request/response match P2's `src/lib/api/server.ts` wrappers exactly. ✅

**Cross-plan contract:** `/admin/hf-templates/compile` ← P2 `compileHfTemplate`; `/admin/hf-templates/generate` ← P2 `generateHfTemplateAi`. Request/response shapes are fixed here and mirrored there — change both together. The model TS types are duplicated in both repos (`src/lib/hf-template-model.ts` here, `src/features/hf-templates/types.ts` there) — keep in sync.
```
