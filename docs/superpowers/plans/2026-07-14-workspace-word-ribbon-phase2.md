# Workspace Word-Ribbon — Phase 2 (direct page-layout endpoints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the four document-level layout ribbon tools — **Margins, Orientation, Size, Columns** — real behaviour: a byte-safe server endpoint that edits the docx section properties (`<w:sectPr>`) without corrupting the document, wired into the existing composer refresh so the change shows immediately in the live preview.

**Architecture:** Three layers, built bottom-up (engine → server → app), each independently verifiable.
1. **Engine (`mdocxengine`):** a new *byte-safe* page-layout writer, `applyBodyPageLayout(documentXml, opts)`, built on the existing order-preserving `editBodySectPr()` primitive — NOT on `PageLayoutManager`'s xml2js rebuild, which silently reorders tables to the end of the document.
2. **Server (`modakerati-server`):** one new endpoint `POST /api/thesis/:id/page-setup` that loads the docx, applies `applyBodyPageLayout` to `word/document.xml`, and persists — following the existing `start-on-new-page` endpoint pattern (guard → `withThesisLock` → mutate → `uploadDocx` → bump `updatedAt`).
3. **App (`modakerati`):** a `setThesisPageSetup()` api client + four `dispatchRibbonAction` cases (`layout.margins` / `layout.orientation` / `layout.size` / `layout.columns`) that call it and reuse the existing `onAfterEdit()` refresh path.

**Tech Stack:** TypeScript (strict in engine + app). Engine: vitest specs, xml string surgery. Server: Hono + Drizzle + Supabase Storage + `mdocxengine` (file: dependency). App: Expo v56 / React Native, `lib/api.ts` fetch helpers, the ribbon config/dispatcher from Phase 1.

**Why byte-safe (read first):** The engine's `PageLayoutManager.setMargins/setOrientation/setPageSizePreset/setColumns` all round-trip `word/document.xml` through `xml2js` (`PageLayoutManager.ts:106-113`), which the sectPr module docstring warns **silently REORDERS tables to the end of the document** (`mdocxengine/src/core/files/body/sectPr.ts:1-12`). Theses routinely contain tables, so we must NOT use those setters here. Instead we compose an order-preserving transform on top of `editBodySectPr(documentXml, transform)` (`sectPr.ts:100`), which edits only the final body `<w:sectPr>` fragment and leaves the rest of the document byte-for-byte intact.

**Scope boundary:** Only the four `<w:sectPr>`-scoped, document-wide tools that are already `status: "wired"` in the ribbon config: `layout.margins`, `layout.orientation`, `layout.size`, `layout.columns`. Explicitly OUT of scope (they need real engine work and stay on the AI bridge — candidate Phase 3): `layout.spacing` / `design.paraSpacing` (per-paragraph + before/after spacing — no engine API), `design.fonts` (true default/base font in `styles.xml` — no engine API), themes, watermark, line numbers, references/table/picture tools.

**Verification model:**
- **Engine layer** has a real test runner (vitest — see `mdocxengine/src/integration/page-layout.spec.ts`). Use TDD: write the failing spec, implement, green.
- **Server + App layers** follow the repo convention (no app JS test runner): `npx tsc --noEmit` must be clean **plus** a concrete behavioral check (a `curl` for the server, a driven ribbon tap for the app). The engine's pure `applyBodyPageLayout` carries the correctness burden, so the server/app layers are thin wiring verified by tsc + one real call.

---

## File Structure

**Create:**
- `/Users/hamzasafwan/mdocxengine/src/core/files/body/pageLayout.ts` — pure functions: `applyBodyPageLayout(documentXml, opts)` + the `<w:sectPr>`-child upsert helpers. No I/O, no xml2js.
- `/Users/hamzasafwan/mdocxengine/src/integration/page-layout-bytesafe.spec.ts` — vitest specs for the above (table-order preservation is the key assertion).

**Modify:**
- `/Users/hamzasafwan/mdocxengine/src/index.ts` — export `applyBodyPageLayout` and its `BodyPageLayoutOpts` type.
- `/Users/hamzasafwan/modakerati-server/src/routes/thesis.ts` — add `POST /:id/page-setup`.
- `/Users/hamzasafwan/modakerati/lib/api.ts` — add `setThesisPageSetup()`.
- `/Users/hamzasafwan/modakerati/lib/ribbon-actions.ts` — add the four dispatcher cases.

**Untouched (already correct from Phase 1):** `ribbon-config.ts` (the four tools are already `status: "wired"` with the right option values), the refresh chain (`onAfterEdit → onAfterBulkEdit → refreshDoc + refreshEditorCfg`), `ribbon-ai-bridge.ts` (the templates stay as the fallback for anything not wired).

---

## Reference: exact ground truth this plan builds on

**Ribbon config (app) — the four target tools** (`components/workspace/ribbon/ribbon-config.ts`), each already `status: "wired"`, dispatched via `dispatchRibbonAction(tool, optionValue, deps)`:
- `layout.margins` — `kind: "preset"`, values `normal | narrow | moderate | wide | mirrored`.
- `layout.orientation` — `kind: "segment"`, values `portrait | landscape`.
- `layout.size` — `kind: "preset"`, values `A4 | USLetter | USLegal | A3 | A5`.
- `layout.columns` — `kind: "segment"`, values `1 | 2 | 3` (arrive as strings).

**Engine primitive** — `mdocxengine/src/core/files/body/sectPr.ts:100`:
```ts
// Applies `transform` to the final body <w:sectPr> fragment (creating an empty one
// if absent), order-preserving; returns the full modified documentXml.
export function editBodySectPr(documentXml: string, transform: (sectPrXml: string) => string): string
```

**Engine preset constants** — `mdocxengine/src/core/PartsManagers/PageLayoutManager.ts`, exported from `index.ts:273`:
- `PAGE_SIZES: Record<PageSizePreset, { w: number; h: number }>` — twips. A4 = 11906×16838, USLetter = 12240×15840, USLegal = 12240×20160, A3 = 16838×23811, A5 = 8391×11906.
- `MARGIN_PRESETS: Record<MarginPreset, PageMargins>` — twips. `PageMargins = { top; right; bottom; left; header; footer; gutter }`. normal = 1440 all; narrow = 720 all; moderate = top/bottom 1440, left/right 1080; wide = top/bottom 1440, left/right 2160; mirrored = asymmetric left/right.
- Types `MarginPreset`, `PageSizePreset`, `Orientation`, `PageMargins`.

**Server persist pattern** — `modakerati-server/src/routes/thesis.ts:458-505` (`POST /:id/blocks/start-on-new-page`): guard (`docMode === "live-docx"` + `docPath`) → `withThesisLock(id, async () => { const engine = await loadThesisEngine(thesis.docPath!); … const buf = engine.zip.toBuffer(); await uploadDocx(userId, id, Buffer.from(buf)); await db.update(theses).set({ updatedAt: new Date() })… })`. Helpers: `loadThesisEngine` (`src/lib/thesis-doc.ts:80`), `uploadDocx` (`src/lib/document-storage.ts:24`), `withThesisLock` (`src/lib/thesis-lock.ts`). Auth: `authMiddleware` on `/api/*` sets `c.get("userId")`.

**App api client pattern** — `lib/api.ts` (e.g. `startThesisBlocksOnNewPage` at `:884`): `export async function fn(thesisId, …): Promise<{ ok: true; … }> { return apiPost(\`/api/thesis/${thesisId}/…\`, body); }`.

**App dispatch + refresh** — `lib/ribbon-actions.ts`: wired branch does `await <apiCall>(...)` then `deps.onAfterEdit()`. `onAfterEdit` chains to the screen's `refreshDoc()` + `refreshEditorCfg()` which reload docx-preview (via `docTick`), OnlyOffice (via `document.key` from `updatedAt`), and PDF. Document-level tools do NOT need `deps.selection[0]`.

---

## Task 1: Engine — byte-safe `applyBodyPageLayout` (pure) + specs

**Files:**
- Create: `/Users/hamzasafwan/mdocxengine/src/core/files/body/pageLayout.ts`
- Create: `/Users/hamzasafwan/mdocxengine/src/integration/page-layout-bytesafe.spec.ts`
- Reference (do not modify): `/Users/hamzasafwan/mdocxengine/src/core/files/body/sectPr.ts`, `/Users/hamzasafwan/mdocxengine/src/core/PartsManagers/PageLayoutManager.ts`

- [ ] **Step 1: Write the failing spec**

Create `src/integration/page-layout-bytesafe.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyBodyPageLayout } from "../core/files/body/pageLayout";
import { PAGE_SIZES, MARGIN_PRESETS } from "../core/PartsManagers/PageLayoutManager";

// Minimal document.xml with a table BEFORE the final body sectPr. The whole point
// of byte-safe editing is that this table must NOT move.
const DOC_WITH_TABLE =
  `<?xml version="1.0"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
  `<w:p><w:r><w:t>Intro</w:t></w:r></w:p>` +
  `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>CELL</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  `<w:p><w:r><w:t>After table</w:t></w:r></w:p>` +
  `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
  `</w:body></w:document>`;

describe("applyBodyPageLayout (byte-safe)", () => {
  it("sets A4 page size without moving the table", () => {
    const out = applyBodyPageLayout(DOC_WITH_TABLE, { pageSizePreset: "A4" });
    // table still before "After table" and before the sectPr
    expect(out.indexOf("<w:tbl>")).toBeLessThan(out.indexOf("After table"));
    expect(out.indexOf("<w:tbl>")).toBeLessThan(out.indexOf("<w:sectPr>"));
    expect(out).toContain(`w:w="${PAGE_SIZES.A4.w}"`);
    expect(out).toContain(`w:h="${PAGE_SIZES.A4.h}"`);
    expect(out).not.toContain(`w:orient`); // portrait => no orient attr
  });

  it("applies a margin preset by replacing pgMar in place", () => {
    const out = applyBodyPageLayout(DOC_WITH_TABLE, { marginPreset: "narrow" });
    expect(out).toContain(`w:top="${MARGIN_PRESETS.narrow.top}"`);
    expect(out).toContain(`w:left="${MARGIN_PRESETS.narrow.left}"`);
    // exactly one pgMar element remains
    expect(out.match(/<w:pgMar\b/g)?.length).toBe(1);
  });

  it("landscape orientation swaps w/h and adds orient, only once", () => {
    const out = applyBodyPageLayout(DOC_WITH_TABLE, { orientation: "landscape" });
    // original was 12240x15840 => landscape swaps so width > height
    expect(out).toContain(`w:w="15840"`);
    expect(out).toContain(`w:h="12240"`);
    expect(out).toContain(`w:orient="landscape"`);
    expect(out.match(/<w:pgSz\b/g)?.length).toBe(1);
  });

  it("sets columns and is idempotent (one <w:cols>)", () => {
    const twice = applyBodyPageLayout(applyBodyPageLayout(DOC_WITH_TABLE, { columns: 2 }), { columns: 3 });
    expect(twice).toContain(`w:num="3"`);
    expect(twice.match(/<w:cols\b/g)?.length).toBe(1);
  });

  it("combines multiple ops in one call and preserves table order", () => {
    const out = applyBodyPageLayout(DOC_WITH_TABLE, {
      pageSizePreset: "A4", orientation: "landscape", marginPreset: "narrow", columns: 2,
    });
    expect(out).toContain(`w:orient="landscape"`);
    expect(out).toContain(`w:num="2"`);
    expect(out).toContain(`w:top="${MARGIN_PRESETS.narrow.top}"`);
    expect(out.indexOf("<w:tbl>")).toBeLessThan(out.indexOf("<w:sectPr>"));
  });

  it("no-ops (returns input unchanged) when opts is empty", () => {
    expect(applyBodyPageLayout(DOC_WITH_TABLE, {})).toBe(DOC_WITH_TABLE);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/integration/page-layout-bytesafe.spec.ts`
Expected: FAIL — `Cannot find module ".../pageLayout"` (or `applyBodyPageLayout is not a function`).

- [ ] **Step 3: Implement `pageLayout.ts`**

Create `src/core/files/body/pageLayout.ts`:

```ts
// Byte-safe, order-preserving page-layout writers for the FINAL body <w:sectPr>.
// Built on editBodySectPr (string surgery) — NOT on PageLayoutManager's xml2js
// rebuild, which reorders tables. Only touches the sectPr fragment; the rest of
// document.xml (paragraphs, tables) is left byte-for-byte intact.
import { editBodySectPr } from "./sectPr";
import { PAGE_SIZES, MARGIN_PRESETS } from "../../PartsManagers/PageLayoutManager";
import type { MarginPreset, PageSizePreset, Orientation } from "../../PartsManagers/PageLayoutManager";

export interface BodyPageLayoutOpts {
  marginPreset?: MarginPreset;
  orientation?: Orientation;
  pageSizePreset?: PageSizePreset;
  columns?: number; // 1..3 (equal-width)
}

// Canonical OOXML order of the sectPr children we manage. We remove any existing
// instance of a managed tag, then re-insert new ones in this order at the point
// AFTER the reference/type children (which must stay first) — Word repairs docs
// whose sectPr children are out of schema order, so we keep them ordered.
const MANAGED_ORDER = ["w:pgSz", "w:pgMar", "w:cols"] as const;

/** Strip every self-closing (or paired) instance of `tag` from a sectPr fragment. */
function stripTag(sectPrInner: string, tag: string): string {
  const selfClosing = new RegExp(`<${tag}\\b[^>]*/>`, "g");
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "g");
  return sectPrInner.replace(paired, "").replace(selfClosing, "");
}

/** Insert `elements` (already in MANAGED_ORDER) right after the leading
 *  headerReference/footerReference/type children, else at the very start. */
function insertManaged(sectPrInner: string, elements: string): string {
  if (!elements) return sectPrInner;
  // Find the end of the last leading reference/type element, if any.
  const lead = /^(?:\s*<w:(?:headerReference|footerReference|type)\b[^>]*\/?>(?:[\s\S]*?<\/w:(?:headerReference|footerReference|type)>)?)+/;
  const m = sectPrInner.match(lead);
  if (m) {
    const at = m[0].length;
    return sectPrInner.slice(0, at) + elements + sectPrInner.slice(at);
  }
  return elements + sectPrInner;
}

/** Read current pgSz width/height (twips) from a sectPr fragment, if present. */
function readPgSz(sectPrInner: string): { w: number; h: number } | null {
  const m = sectPrInner.match(/<w:pgSz\b[^>]*\/?>/);
  if (!m) return null;
  const w = Number(m[0].match(/\bw:w="(\d+)"/)?.[1]);
  const h = Number(m[0].match(/\bw:h="(\d+)"/)?.[1]);
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
}

function pgSzXml(w: number, h: number, orientation?: Orientation): string {
  const orient = orientation === "landscape" ? ` w:orient="landscape"` : "";
  return `<w:pgSz w:w="${w}" w:h="${h}"${orient}/>`;
}

function pgMarXml(p: (typeof MARGIN_PRESETS)[MarginPreset]): string {
  return `<w:pgMar w:top="${p.top}" w:right="${p.right}" w:bottom="${p.bottom}" w:left="${p.left}" w:header="${p.header}" w:footer="${p.footer}" w:gutter="${p.gutter}"/>`;
}

function colsXml(count: number): string {
  const n = Math.max(1, Math.min(3, Math.round(count)));
  return `<w:cols w:num="${n}" w:space="720" w:equalWidth="1"/>`;
}

export function applyBodyPageLayout(documentXml: string, opts: BodyPageLayoutOpts): string {
  const wants = opts.marginPreset || opts.orientation || opts.pageSizePreset || opts.columns != null;
  if (!wants) return documentXml;

  return editBodySectPr(documentXml, (sectPrInner) => {
    // Resolve target pgSz. Priority: explicit preset > current > A4 default.
    // Orientation always normalizes w/h so landscape has width > height.
    let next = sectPrInner;

    if (opts.pageSizePreset || opts.orientation) {
      const base = opts.pageSizePreset
        ? { w: PAGE_SIZES[opts.pageSizePreset].w, h: PAGE_SIZES[opts.pageSizePreset].h }
        : readPgSz(sectPrInner) ?? { w: PAGE_SIZES.A4.w, h: PAGE_SIZES.A4.h };
      // Determine desired orientation: explicit wins, else infer from current pgSz.
      const orient: Orientation =
        opts.orientation ?? (readPgSz(sectPrInner) && readPgSz(sectPrInner)!.w > readPgSz(sectPrInner)!.h ? "landscape" : "portrait");
      const portraitW = Math.min(base.w, base.h);
      const portraitH = Math.max(base.w, base.h);
      const [w, h] = orient === "landscape" ? [portraitH, portraitW] : [portraitW, portraitH];
      next = stripTag(next, "w:pgSz");
      next = insertManaged(next, pgSzXml(w, h, orient === "landscape" ? "landscape" : undefined));
    }

    if (opts.marginPreset) {
      next = stripTag(next, "w:pgMar");
      next = insertManaged(next, pgMarXml(MARGIN_PRESETS[opts.marginPreset]));
    }

    if (opts.columns != null) {
      next = stripTag(next, "w:cols");
      next = insertManaged(next, colsXml(opts.columns));
    }

    return next;
  });
}
```

> **Note on ordering:** `insertManaged` inserts each managed element after the leading reference/type children. Because we insert pgSz, then pgMar, then cols in that call order, and each inserts at the same anchor point, the final order is `cols, pgMar, pgSz` (last-inserted is first). If a spec asserts strict schema order and fails, change `applyBodyPageLayout` to build all three managed elements into one string in `MANAGED_ORDER` and do a single `insertManaged(next, ordered)` after all `stripTag`s. The specs in Step 1 assert presence + counts + table-order, not sibling order, so the simple version passes; keep this note for the implementer.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run src/integration/page-layout-bytesafe.spec.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Run the full engine suite (no regressions)**

Run: `cd /Users/hamzasafwan/mdocxengine && npx vitest run`
Expected: all existing specs still PASS (page-layout.spec.ts, FormattingManager.spec.ts, etc.).

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/mdocxengine
git add src/core/files/body/pageLayout.ts src/integration/page-layout-bytesafe.spec.ts
git commit -m "feat(engine): byte-safe applyBodyPageLayout (sectPr margins/size/orientation/columns)"
```

---

## Task 2: Engine — export `applyBodyPageLayout` + rebuild for the server

**Files:**
- Modify: `/Users/hamzasafwan/mdocxengine/src/index.ts`

- [ ] **Step 1: Add the export**

`src/index.ts` does not currently re-export anything from `core/files/body/sectPr`, so just add these two lines alongside the other top-level `export`/`export type` statements (e.g. right after the `PageLayoutManager` re-exports around `index.ts:263-273`):

```ts
export { applyBodyPageLayout } from "./core/files/body/pageLayout";
export type { BodyPageLayoutOpts } from "./core/files/body/pageLayout";
```

- [ ] **Step 2: Typecheck + build the engine**

Run: `cd /Users/hamzasafwan/mdocxengine && npx tsc --noEmit && npm run build`
Expected: clean typecheck; `dist/` rebuilt so the server's `file:../mdocxengine` dependency sees `applyBodyPageLayout`.

- [ ] **Step 3: Confirm the server resolves the new export**

Run: `cd /Users/hamzasafwan/modakerati-server && node -e "console.log(typeof require('mdocxengine').applyBodyPageLayout)"`
Expected: `function`. (If it prints `undefined`, the engine `dist` did not rebuild or the server has a stale copy — re-run `npm run build` in the engine, and `npm install` in the server if it vendors a copy.)

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/mdocxengine
git add src/index.ts
git commit -m "feat(engine): export applyBodyPageLayout + BodyPageLayoutOpts"
```

---

## Task 3: Server — `POST /api/thesis/:id/page-setup`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/routes/thesis.ts`

- [ ] **Step 1: Add the endpoint**

Insert after the `POST /:id/blocks/start-on-new-page` handler (near `thesis.ts:505`). It mirrors that handler's guard + lock + persist, but calls the pure engine function on `word/document.xml` and skips RAG reconcile (layout changes don't alter text). Put the allow-lists at module scope near the top of the file if you prefer; inline is fine.

```ts
// Document-wide page setup: margins / orientation / page size / columns. Byte-safe
// (does not reorder tables) via mdocxengine's applyBodyPageLayout on the final
// <w:sectPr>. Layout changes don't alter text, so we skip scheduleReconcile but
// still bump updatedAt so the client preview (OnlyOffice document.key) refreshes.
const MARGIN_PRESETS_ALLOWED = new Set(["normal", "narrow", "moderate", "wide", "mirrored"]);
const ORIENTATION_ALLOWED = new Set(["portrait", "landscape"]);
const PAGE_SIZE_ALLOWED = new Set(["A4", "USLetter", "USLegal", "A3", "A5"]);

thesisRoutes.post("/:id/page-setup", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  // Validate + collect only the recognised fields.
  const opts: {
    marginPreset?: string; orientation?: string; pageSizePreset?: string; columns?: number;
  } = {};
  if (typeof body.marginPreset === "string" && MARGIN_PRESETS_ALLOWED.has(body.marginPreset)) opts.marginPreset = body.marginPreset;
  if (typeof body.orientation === "string" && ORIENTATION_ALLOWED.has(body.orientation)) opts.orientation = body.orientation;
  if (typeof body.pageSize === "string" && PAGE_SIZE_ALLOWED.has(body.pageSize)) opts.pageSizePreset = body.pageSize;
  if (typeof body.columns === "number" && body.columns >= 1 && body.columns <= 3) opts.columns = Math.round(body.columns);
  const applied = Object.keys(opts);
  if (!applied.length) return c.json({ error: "No valid page-setup fields provided" }, 400);

  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  if (thesis.docMode !== "live-docx" || !thesis.docPath) {
    return c.json({ error: "Thesis is not a live Word document" }, 400);
  }

  try {
    const result = await withThesisLock(id, async () => {
      const { applyBodyPageLayout } = await import("mdocxengine");
      const engine = await loadThesisEngine(thesis.docPath!);
      const zip = engine.zip as unknown as { readAsText(name: string): string };
      const documentXml = zip.readAsText("word/document.xml");
      const nextXml = applyBodyPageLayout(documentXml, opts as any);
      if (nextXml === documentXml) return { ok: true as const, applied: [] as string[] };
      engine.zip.addFile("word/document.xml", Buffer.from(nextXml, "utf-8"));
      const buf = engine.zip.toBuffer();
      await uploadDocx(userId, id, Buffer.from(buf));
      await db.update(theses).set({ updatedAt: new Date() }).where(eq(theses.id, id));
      return { ok: true as const, applied };
    });
    return c.json(result);
  } catch (e: any) {
    console.error("thesis page-setup failed:", id, e?.message ?? e);
    return c.json({ error: "Operation failed" }, 500);
  }
});
```

> The `zip.readAsText` / `zip.addFile` pattern is copied verbatim from the `POST /:id/format` handler (`thesis.ts:1011-1016`). `loadThesisEngine`, `uploadDocx`, `withThesisLock`, `db`, `theses`, `and`, `eq` are already imported in this file.

- [ ] **Step 2: Typecheck the server**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 3: Behavioral check — real request against the running dev server**

Pick a live-docx thesis id and a Supabase bearer token (from the app session or a test user). With the dev server running (`npm run dev`):

```bash
# Replace TID and TOKEN. Set narrow margins, then confirm no error + applied list.
curl -s -X POST "http://localhost:3000/api/thesis/TID/page-setup" \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"marginPreset":"narrow"}'
# Expected: {"ok":true,"applied":["marginPreset"]}

curl -s -X POST "http://localhost:3000/api/thesis/TID/page-setup" \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"orientation":"landscape","pageSize":"A4"}'
# Expected: {"ok":true,"applied":["orientation","pageSizePreset"]}

# Invalid field is rejected:
curl -s -X POST "http://localhost:3000/api/thesis/TID/page-setup" \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"marginPreset":"bogus"}'
# Expected: {"error":"No valid page-setup fields provided"} (400)
```

Then re-download the docx (`GET /api/thesis/TID/document` → open `downloadUrl`) or open the workspace and confirm the margins/orientation actually changed **and any tables are still in place** (the table-order guarantee from Task 1).

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/routes/thesis.ts
git commit -m "feat(thesis): POST /:id/page-setup — byte-safe margins/orientation/size/columns"
```

---

## Task 4: App — `setThesisPageSetup()` client + dispatcher cases

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/lib/api.ts`
- Modify: `/Users/hamzasafwan/modakerati/lib/ribbon-actions.ts`

- [ ] **Step 1: Add the api client function**

In `lib/api.ts`, next to `startThesisBlocksOnNewPage` (`:884`), add:

```ts
export interface ThesisPageSetup {
  marginPreset?: "normal" | "narrow" | "moderate" | "wide" | "mirrored";
  orientation?: "portrait" | "landscape";
  pageSize?: "A4" | "USLetter" | "USLegal" | "A3" | "A5";
  columns?: 1 | 2 | 3;
}

/** Document-wide page setup (margins / orientation / size / columns). Byte-safe on
 *  the server; pass only the field(s) you want to change. */
export async function setThesisPageSetup(
  thesisId: string,
  setup: ThesisPageSetup,
): Promise<{ ok: true; applied: string[] }> {
  return apiPost<{ ok: true; applied: string[] }>(`/api/thesis/${thesisId}/page-setup`, setup);
}
```

- [ ] **Step 2: Add the four dispatcher cases**

In `lib/ribbon-actions.ts`, (a) extend the import from `@/lib/api` to include `setThesisPageSetup`, and (b) add the cases inside the `switch (tool.actionKey)` block (before `default:`):

```ts
// import line becomes:
import {
  formatThesis,
  insertThesisImage,
  startThesisBlocksOnNewPage,
  editThesisParagraphs,
  setThesisPageSetup,
} from "@/lib/api";
```

```ts
      case "layout.margins": {
        // MARGIN_OPTS values: normal | narrow | moderate | wide | mirrored
        if (!optionValue) return toAi();
        await setThesisPageSetup(deps.thesisId, { marginPreset: optionValue as any });
        deps.onAfterEdit();
        return;
      }

      case "layout.orientation": {
        // ORIENT_OPTS values: portrait | landscape
        if (optionValue !== "portrait" && optionValue !== "landscape") return toAi();
        await setThesisPageSetup(deps.thesisId, { orientation: optionValue });
        deps.onAfterEdit();
        return;
      }

      case "layout.size": {
        // SIZE_OPTS values: A4 | USLetter | USLegal | A3 | A5
        if (!optionValue) return toAi();
        await setThesisPageSetup(deps.thesisId, { pageSize: optionValue as any });
        deps.onAfterEdit();
        return;
      }

      case "layout.columns": {
        // COLUMN_OPTS values: "1" | "2" | "3" (arrive as strings)
        const count = Number(optionValue);
        if (!(count === 1 || count === 2 || count === 3)) return toAi();
        await setThesisPageSetup(deps.thesisId, { columns: count as 1 | 2 | 3 });
        deps.onAfterEdit();
        return;
      }
```

> These sit alongside the existing wired cases and use the same `deps.onAfterEdit()` refresh. On any thrown error the outer `try/catch` (`ribbon-actions.ts:87-92`) shows the localized error alert — same as the other wired tools. The `return toAi()` guards keep behaviour safe if an unexpected option value ever arrives.

- [ ] **Step 3: Typecheck the app**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add lib/api.ts lib/ribbon-actions.ts
git commit -m "feat(ribbon): wire Margins/Orientation/Size/Columns to /page-setup"
```

---

## Task 5: End-to-end behavioral verification

**Files:** none (verification only).

- [ ] **Step 1: Reload the app on a live-docx thesis**

Fully reload the Expo app (shake → Reload, or `r` in Metro) so the new bundle loads. Open a thesis whose `docMode === "live-docx"` and open the workspace composer in **Edit** mode → **Layout** ribbon tab.

- [ ] **Step 2: Margins**

Tap **Margins → Narrow**. Expected: the composer's document preview (docx-preview / OnlyOffice) reloads within ~1–2s showing tighter margins. No error alert.

- [ ] **Step 3: Orientation**

Tap **Orientation → Landscape**. Expected: the page becomes wider-than-tall in the preview.

- [ ] **Step 4: Page size + Columns**

Tap **Size → A4**, then **Columns → 2**. Expected: page re-sizes; body text flows into two columns.

- [ ] **Step 5: Table-safety check (the critical one)**

On a thesis that contains a **table**, apply **Margins → Wide**. Expected: margins change **and the table stays in its original position** (not moved to the end). This is the guarantee Task 1's byte-safe writer provides; if the table jumps to the end, the endpoint is using `PageLayoutManager` instead of `applyBodyPageLayout` — fix Task 3.

- [ ] **Step 6: AI-bridge untouched**

Tap a still-`soon` Layout tool (e.g. **Spacing** or **Indent**). Expected: it still drops an instruction into the AI composer (switches to AI mode) — confirming we only wired the four page-setup tools and left the rest on the bridge.

- [ ] **Step 7: Update the Phase-2 progress + Phase-1 note**

Tick this plan's checkboxes for the completed tasks. Optionally flip the four tools' inline comments in `ribbon-ai-bridge.ts` are now dead paths for these actionKeys (they remain as harmless fallbacks; no change required).

---

## Self-Review

**Spec coverage:** The Phase-1 plan deferred to Phase 2 exactly "live preview + the direct layout endpoints." Direct layout endpoints for the four `<w:sectPr>` tools = Tasks 1–4. "Live preview" = reused existing `onAfterEdit` refresh (verified in recon; Task 5 confirms it). Out-of-scope tools (spacing/font/themes/watermark/references/table/picture) are explicitly deferred with the engine-gap reason. ✔

**Placeholder scan:** Every code step contains complete code; every run step has an exact command + expected output. No TBD/TODO. ✔

**Type consistency:** `BodyPageLayoutOpts` (engine) uses `marginPreset/orientation/pageSizePreset/columns`. The server maps request `pageSize` → engine `pageSizePreset` (explicit, noted). The app `ThesisPageSetup` uses request-shape names (`marginPreset/orientation/pageSize/columns`) matching the server body. `applyBodyPageLayout` signature identical in engine export, server import, and specs. Dispatcher option values (`normal…mirrored`, `portrait/landscape`, `A4…A5`, `"1"/"2"/"3"`) match `ribbon-config.ts` `*_OPTS`. ✔

**Known limitations to keep in mind (not blockers):**
- `columns` uses equal-width only (engine limitation) — fine for a thesis.
- `mirrored` margins set asymmetric left/right values, not a true `<w:mirrorMargins>` toggle (engine limitation) — acceptable; note in UI copy later if needed.
- The endpoint edits only the FINAL body section's `<w:sectPr>` (document-wide). Per-section page setup is not in scope.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-workspace-word-ribbon-phase2.md`.**
