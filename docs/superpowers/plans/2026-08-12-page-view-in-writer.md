# Page View in the Writer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Writer render the thesis as paginated paper — running header at the top of every page, footer with a real page number at the foot — by measuring the document offscreen at true A4 geometry.

**Architecture:** The engine gains a read of per-section page geometry (twips). The server forwards it on `DocSectionDTO`, along with two flags that already exist for the AI (`dividerPage`, `pageOrnament`) but have never reached the DTO. The app derives pixel geometry, measures each block's height offscreen inside the `'use dom'` Lexical WebView, accumulates heights into pages, and inserts one `PageBreakNode` per boundary rendering `[footer][gutter][header]`. The bands are the existing header/footer chrome, so tapping them opens the sheet that already ships.

**Tech Stack:** TypeScript throughout. `mdocxengine` (vitest) → Hono server (vitest) → Expo app (no test runner: `npx tsc --noEmit` + a node verification script + device QA).

**Spec:** [docs/superpowers/specs/2026-08-12-page-view-in-writer-design.md](../specs/2026-08-12-page-view-in-writer-design.md)

---

## Read this before Task 1

Three facts that will otherwise cost you an afternoon each:

1. **`~/mdocxengine` ships from `dist/`, which is gitignored.** After any engine change run `npm run build` in `~/mdocxengine`, or the server keeps loading the old code and your change appears to do nothing.
2. **The app's locale JSONs contain ~155 duplicate keys each.** `json.load`/`json.dump` silently drops them. Edit `locales/*.json` **surgically** with Edit — never round-trip a whole file.
3. **`LexicalDomEditor.tsx` is an Expo `'use dom'` component.** It runs as React inside a WebView. Only *serializable* props cross the native↔web boundary — no functions except top-level async callbacks. Anything needing `t()` must be localized natively and passed in as a string, exactly as `buildChrome` already bakes in `label`.

## File Structure

| File | Repo | Responsibility |
|---|---|---|
| `src/Doc.ts` | engine | `SectionInfo.page` — per-section geometry with body inheritance |
| `src/Doc.layout.spec.ts` | engine | its tests |
| `src/lib/page-marks.ts` | server | **new** — shared divider/ornament bookmark detection |
| `src/mcp/doc-section-map.ts` | server | consumes the shared helper instead of inline regex |
| `src/lib/thesis-doc.ts` | server | `DocSectionDTO.page` / `dividerPage` / `pageOrnament` |
| `src/__tests__/page-geometry.test.ts` | server | **new** — DTO tests |
| `lib/api.ts` | app | mirrored optional DTO fields |
| `lib/page-layout.ts` | app | **new** — pure geometry, pagination, page numbering |
| `scripts/verify-page-layout.mjs` | app | **new** — node verification of the pure module |
| `components/workspace/lexical/blockLexical.tsx` | app | `PageBreakNode`, `PageBreakBand`, `$isDisplayOnlyNode` |
| `components/workspace/lexical/LexicalDomEditor.tsx` | app | measurement host, `PaginationPlugin`, skip-list audit |
| `components/workspace/WorkspaceLexicalView.tsx` | app | builds the serializable `pageSetup` prop |
| `stores/workspace-store.ts` | app | `showPages` + `toggleShowPages` |
| `components/DockToolsSheet.tsx` | app | the toggle's UI |
| `locales/{en,fr,ar}.json` | app | 4 new keys |

`lib/page-layout.ts` is deliberately pure — no React, no RN, no DOM — because it holds the two rules most likely to be wrong (pagination accumulation and the numbering conventions) and it is the only app code in this feature that can be verified without a device.

---

## Task 1: Engine — read per-section page geometry

`SectionEntry` already carries `pageSize` and `margins` (parsed by `parseSectPr`), but `SectionInfo` — the resolved view `Doc.sections()` returns — drops them. Sections created by our own `addSectionBreak` write `<w:sectPr><w:type w:val="nextPage"/></w:sectPr>` with **no** `pgSz`/`pgMar`, so those must inherit from the body (final) entry.

**Files:**
- Modify: `~/mdocxengine/src/Doc.ts` (the `SectionInfo` interface ~line 390; `Doc.sections()` ~line 1272)
- Test: `~/mdocxengine/src/Doc.layout.spec.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("Doc layout / section verbs", …)` block in `src/Doc.layout.spec.ts`:

```ts
  test("sections() reports page geometry, inheriting the body sectPr", async () => {
    const doc = await Doc.open(INPUT);
    const base = await doc.sections();
    expect(base[0].page).not.toBeNull();
    expect(base[0].page!.widthTwips).toBeGreaterThan(0);
    expect(base[0].page!.heightTwips).toBeGreaterThan(0);
    expect(base[0].page!.margins.top).toBeGreaterThanOrEqual(0);

    // A section made by startOnNewPage writes only <w:type/> — no pgSz/pgMar —
    // so it must inherit the body sectPr's geometry rather than report null.
    await doc.addHeading("Part Two", 1);
    const headingIdx = (await doc.blocks()).length - 1;
    await doc.startOnNewPage(headingIdx);

    const after = await doc.sections();
    expect(after.length).toBeGreaterThan(base.length);
    const inherited = after[after.length - 2]; // the section the break created
    expect(inherited.page).not.toBeNull();
    expect(inherited.page!.widthTwips).toBe(base[0].page!.widthTwips);
    expect(inherited.page!.heightTwips).toBe(base[0].page!.heightTwips);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd ~/mdocxengine && npx vitest run src/Doc.layout.spec.ts -t "page geometry"
```

Expected: FAIL — `Property 'page' does not exist on type 'SectionInfo'` (a TypeScript error inside vitest), or `expected undefined not to be null`.

- [ ] **Step 3: Add the type**

In `src/Doc.ts`, immediately above `export interface SectionInfo`:

```ts
/** A section's page geometry in twips (1440 = 1 inch), inheritance resolved. */
export interface SectionPageGeometry {
  widthTwips: number;
  heightTwips: number;
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
}
```

Then add this final member to `SectionInfo`, after `pageNumberStart`:

```ts
  /**
   * Page size + margins for this section, in twips. A section's own w:sectPr
   * wins; a sectPr that omits w:pgSz/w:pgMar (every section our own
   * addSectionBreak creates) inherits the body sectPr, which is what Word
   * renders. null only when the body sectPr declares neither.
   */
  page: SectionPageGeometry | null;
```

- [ ] **Step 4: Resolve it in `Doc.sections()`**

`Doc.sections()` already has `entries` from `this.engine.sections.getSections()`. The body sectPr is always the final entry (`isFinal: true`). Insert this immediately before the `for (let k = 0; …)` loop:

```ts
    // The body sectPr is always the last entry; it is what a section omitting
    // w:pgSz/w:pgMar inherits.
    const bodyEntry = entries[entries.length - 1];
    const resolveGeometry = (e: (typeof entries)[number] | undefined): SectionPageGeometry | null => {
      const size = e?.pageSize ?? bodyEntry?.pageSize;
      const mar = e?.margins ?? bodyEntry?.margins;
      if (!size) return null;
      return {
        widthTwips: size.width,
        heightTwips: size.height,
        margins: {
          top: mar?.top ?? 1440,
          bottom: mar?.bottom ?? 1440,
          left: mar?.left ?? 1440,
          right: mar?.right ?? 1440,
          header: mar?.header ?? 720,
          footer: mar?.footer ?? 720,
        },
      };
    };
```

Then add `page: resolveGeometry(entries[k]),` to the object pushed into `out` inside the loop, beside `pageNumberStart`.

- [ ] **Step 5: Run the test**

```bash
cd ~/mdocxengine && npx vitest run src/Doc.layout.spec.ts -t "page geometry"
```

Expected: PASS.

- [ ] **Step 6: Run the whole engine suite for regressions**

```bash
cd ~/mdocxengine && npx vitest run
```

Expected: all pass (a small number of pre-existing skips is normal).

- [ ] **Step 7: Rebuild dist and commit**

```bash
cd ~/mdocxengine && npm run build
git add src/Doc.ts src/Doc.layout.spec.ts
git commit -m "feat(sections): report per-section page geometry with body inheritance

A sectPr written by addSectionBreak carries only w:type, so geometry has to
fall back to the body sectPr — which is what Word renders. Without this the
app has no page size to paginate against."
```

Note: `dist/` is gitignored but **must** be rebuilt, or the server keeps loading the old engine.

---

## Task 2: Server — extract divider/ornament detection into a shared helper

`doc-section-map.ts` detects both marks inline with regexes over raw block XML. The Writer needs the same answer, and two copies of a bookmark regex will drift.

**Files:**
- Create: `~/modakerati-server/src/lib/page-marks.ts`
- Modify: `~/modakerati-server/src/mcp/doc-section-map.ts` (the `dividerPage` / `pageOrnament` fields, ~lines 108-117)
- Test: `~/modakerati-server/src/__tests__/page-geometry.test.ts` (created here, extended in Task 3)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/page-geometry.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { detectPageMarks } from "../lib/page-marks";

const para = (xml: string) => ({ kind: "paragraph" as const, tag: "w:p", xml });

describe("detectPageMarks", () => {
  test("finds a divider bookmark inside the range", () => {
    const blocks = [para("<w:p/>"), para('<w:p><w:bookmarkStart w:name="modk_divider_7"/></w:p>'), para("<w:p/>")];
    expect(detectPageMarks(blocks, 1, 3)).toEqual({ dividerPage: true, pageOrnament: null });
  });

  test("ignores a bookmark outside the range", () => {
    const blocks = [para('<w:p><w:bookmarkStart w:name="modk_divider_7"/></w:p>'), para("<w:p/>")];
    expect(detectPageMarks(blocks, 1, 2)).toEqual({ dividerPage: false, pageOrnament: null });
  });

  test("reads the ornament kind out of the bookmark name", () => {
    const blocks = [para('<w:p><w:bookmarkStart w:name="modk_pageorn_dedication_3"/></w:p>')];
    expect(detectPageMarks(blocks, 0, 1)).toEqual({ dividerPage: false, pageOrnament: "dedication" });
  });

  test("a plain section is neither", () => {
    expect(detectPageMarks([para("<w:p>hello</w:p>")], 0, 1)).toEqual({ dividerPage: false, pageOrnament: null });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/page-geometry.test.ts
```

Expected: FAIL — `Cannot find module '../lib/page-marks'`.

- [ ] **Step 3: Create the helper**

Create `src/lib/page-marks.ts`:

```ts
import type { BodyBlock } from "mdocxengine";

/**
 * The two invisible bookmarks that mark a section as a page which carries no
 * page number by design:
 *   • modk_divider_*        — a chapter divider built by add_divider_pages
 *   • modk_pageorn_<kind>_* — a front-matter page decorated by add_page_ornament
 *
 * Both are invisible to BlockInfo, so detection reads raw block XML
 * (engine.document.getBlocks()). This is the ONLY place either regex lives —
 * doc-section-map (the AI's get_sections) and thesis-doc (the Writer's DTO)
 * both call it, so the two views can never disagree about what a divider is.
 */
export type PageMarks = { dividerPage: boolean; pageOrnament: string | null };

const DIVIDER = /w:name="modk_divider_/;
const ORNAMENT = /w:name="modk_pageorn_([a-z]+)_/;

/** `start` inclusive, `end` exclusive — a section's block range. */
export function detectPageMarks(rawBlocks: BodyBlock[], start: number, end: number): PageMarks {
  const within = rawBlocks.slice(start, end);
  let pageOrnament: string | null = null;
  for (const b of within) {
    const m = ORNAMENT.exec(b.xml);
    if (m) { pageOrnament = m[1]; break; }
  }
  return {
    dividerPage: within.some((b) => b.kind === "paragraph" && DIVIDER.test(b.xml)),
    pageOrnament,
  };
}
```

- [ ] **Step 4: Run the test**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/page-geometry.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Use it in `doc-section-map.ts`**

Add to the imports at the top of `src/mcp/doc-section-map.ts`:

```ts
import { detectPageMarks } from "../lib/page-marks";
```

Replace the inline `dividerPage:` and `pageOrnament:` fields in the returned object with:

```ts
      ...detectPageMarks(rawBlocks, info.startBlockIndex, end),
```

Delete the two inline regex expressions this replaces — behaviour is identical, including `pageOrnament` returning the first match in document order.

- [ ] **Step 6: Confirm no regression in the section-map suite**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/section-isolation.test.ts --testTimeout=60000
```

Expected: PASS, including `expect(map.filter((s) => s.dividerPage).length).toBe(1)`.

Some server suites are slow under load and time out at the 5s default — `--testTimeout=60000` before treating a timeout as a failure.

- [ ] **Step 7: Commit**

```bash
cd ~/modakerati-server
git add src/lib/page-marks.ts src/mcp/doc-section-map.ts src/__tests__/page-geometry.test.ts
git commit -m "refactor(sections): one home for the divider/ornament bookmark scan

The Writer's page view needs the same answer get_sections already computes.
Two copies of a bookmark regex would drift, and a divider the AI sees but the
Writer doesn't would number a page that must not be numbered."
```

---

## Task 3: Server — carry geometry and the marks on `DocSectionDTO`

**Files:**
- Modify: `~/modakerati-server/src/lib/thesis-doc.ts` (`DocSectionDTO` ~lines 110-142; `sectionHFDTO` ~lines 881-930)
- Test: `~/modakerati-server/src/__tests__/page-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/page-geometry.test.ts`:

```ts
import path from "path";
import { Mdocxengine } from "mdocxengine";
import { sectionHFDTO } from "../lib/thesis-doc";

describe("sectionHFDTO page geometry", () => {
  test("every section reports page geometry in twips", async () => {
    const engine = new Mdocxengine();
    await engine.load(path.resolve(process.cwd(), "assets/thesis-base.docx"));
    const sections = await sectionHFDTO(engine);

    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) {
      expect(s.page).toBeTruthy();
      expect(s.page!.widthTwips).toBeGreaterThan(0);
      expect(s.page!.heightTwips).toBeGreaterThan(s.page!.widthTwips); // portrait
      expect(s.page!.margins.left).toBeGreaterThanOrEqual(0);
    }
  });

  test("a plain section is neither a divider nor ornamented", async () => {
    const engine = new Mdocxengine();
    await engine.load(path.resolve(process.cwd(), "assets/thesis-base.docx"));
    const sections = await sectionHFDTO(engine);
    expect(sections[0].dividerPage).toBe(false);
    expect(sections[0].pageOrnament).toBeNull();
  });
});
```

If `assets/thesis-base.docx` is not at that path in this checkout, locate it with `ls ~/modakerati-server/assets/*.docx` and use the real filename — it is a critical seed asset and it does exist.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/page-geometry.test.ts --testTimeout=60000
```

Expected: FAIL — `Property 'page' does not exist on type 'DocSectionDTO'`.

- [ ] **Step 3: Extend the DTO type**

In `src/lib/thesis-doc.ts`, add to `DocSectionDTO` after `ownFooter`:

```ts
  /** Page size + margins in twips (1440 = 1 inch), inheritance resolved by the
   *  engine. null when the document declares no page size at all. */
  page: { widthTwips: number; heightTwips: number;
          margins: { top: number; bottom: number; left: number; right: number;
                     header: number; footer: number; gutter: number } } | null;
  /** This section IS a chapter divider page (add_divider_pages). Such a page
   *  carries no page number by design — see the Writer's page view. */
  dividerPage: boolean;
  /** Front-matter page decorated by add_page_ornament ("dedication", "thanks",
   *  "abstract"), else null. Also unnumbered by convention. */
  pageOrnament: string | null;
```

- [ ] **Step 4: Populate them in `sectionHFDTO`**

Add the import at the top of `src/lib/thesis-doc.ts`:

```ts
import { detectPageMarks } from "./page-marks";
```

`sectionHFDTO(engine, blocks?)` receives the same raw `engine.document.getBlocks()` array that `buildDocumentDTOFromEngine` already passes. Load it when absent. Inside `sectionHFDTO`, after `const entryByIndex = …`:

```ts
    // Raw blocks (with .xml) — the divider/ornament bookmarks are invisible to
    // the DTO block model, so the marks must be read off the raw XML.
    const rawBlocks = blocks ?? (await engine.document.getBlocks());
```

Then inside the `infos.map((s, idx) => { … })` callback, before the `return`:

```ts
      const sectionEnd = infos[idx + 1]?.startBlockIndex ?? rawBlocks.length;
      const marks = detectPageMarks(rawBlocks, s.startBlockIndex, sectionEnd);
```

And add to the returned object, after `ownFooter`:

```ts
        page: s.page,
        dividerPage: marks.dividerPage,
        pageOrnament: marks.pageOrnament,
```

- [ ] **Step 5: Run the tests**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/page-geometry.test.ts --testTimeout=60000
```

Expected: PASS (6 tests).

- [ ] **Step 6: Run the full server suite**

```bash
cd ~/modakerati-server && npx vitest run --testTimeout=60000
```

Expected: pass. `destructive-gate.test.ts` has a known pre-existing failure unrelated to this work — confirm with `git stash && npx vitest run src/__tests__/destructive-gate.test.ts; git stash pop` before attributing it to your change.

- [ ] **Step 7: Commit**

```bash
cd ~/modakerati-server
git add src/lib/thesis-doc.ts src/__tests__/page-geometry.test.ts
git commit -m "feat(document): carry page geometry and unnumbered-page marks on DocSectionDTO

The Writer cannot paginate without a page size, and cannot know which pages
are deliberately unnumbered without the divider/ornament marks. Both already
existed server-side; neither had ever reached the DTO."
```

---

## Task 4: App — mirror the new DTO fields

**Files:**
- Modify: `~/modakerati/lib/api.ts` (`DocSectionDTO`, ~line 1224)

- [ ] **Step 1: Add the fields**

All three are **optional** — older SQLite-cached DTOs predate them and every consumer must tolerate `undefined`. Add to `DocSectionDTO` after `startsOnNewPage`:

```ts
  /** Page size + margins in twips (1440 = 1 inch). Optional: older cached DTOs
   *  predate it — absent means "assume A4 at 1 inch" (lib/page-layout.ts). */
  page?: {
    widthTwips: number;
    heightTwips: number;
    margins: { top: number; bottom: number; left: number; right: number;
               header: number; footer: number; gutter: number };
  } | null;
  /** This section is a chapter divider page — no page number by design. */
  dividerPage?: boolean;
  /** Ornamented front-matter page ("dedication" | "thanks" | "abstract"), else
   *  null. Also unnumbered by convention. */
  pageOrnament?: string | null;
```

- [ ] **Step 2: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean. This is the only automated check the app has.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati && git add lib/api.ts
git commit -m "feat(api): mirror page geometry and unnumbered-page marks

Optional, because older SQLite-cached DTOs predate all three fields."
```

---

## Task 5: App — the pure page-layout module

This holds pagination accumulation and both page-numbering conventions: the two rules most likely to be wrong, and the only app code in this feature verifiable without a device.

**Files:**
- Create: `~/modakerati/lib/page-layout.ts`
- Create: `~/modakerati/scripts/verify-page-layout.mjs`

- [ ] **Step 1: Write the verification script first**

`scripts/verify-ask-parse.mjs` sets the precedent for verifying logic in this runner-less repo, but it *re-implements* the logic, so it cannot catch drift. This one transpiles and imports the real module using the `typescript` package the repo already depends on.

Create `scripts/verify-page-layout.mjs`:

```js
// Verifies lib/page-layout.ts by transpiling the REAL module and importing it,
// so this cannot drift from shipping code. The app has no test runner; this and
// `npx tsc --noEmit` are the automated gate. Run: node scripts/verify-page-layout.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ts from "typescript";

const src = fs.readFileSync(path.resolve("lib/page-layout.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = path.join(os.tmpdir(), `page-layout-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const M = await import(`file://${tmp}`);
fs.unlinkSync(tmp);

let failures = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok  ${name}`); return; }
  failures++;
  console.log(`FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
};

// ── geometry ────────────────────────────────────────────────────────────────
const a4 = M.geometryFromSection(undefined);
check("A4 fallback text column ≈ 601.7px", Math.round(a4.textColumnPx * 10) / 10, 601.7);
check("A4 fallback content height ≈ 930.5px", Math.round(a4.contentHeightPx * 10) / 10, 930.5);

// ── pagination ──────────────────────────────────────────────────────────────
const limits = (n, v) => Array.from({ length: n }, () => v);
check("fills a page then breaks",
  M.paginate({ heights: [400, 400, 400, 400], pageContentPx: limits(4, 900), forcedStarts: new Set() }),
  [0, 2]);
check("a block taller than a page stands alone",
  M.paginate({ heights: [100, 2000, 100], pageContentPx: limits(3, 900), forcedStarts: new Set() }),
  [0, 1, 2]);
check("a forced start begins a page even mid-fill",
  M.paginate({ heights: [100, 100, 100], pageContentPx: limits(3, 900), forcedStarts: new Set([2]) }),
  [0, 2]);
check("empty document paginates to nothing",
  M.paginate({ heights: [], pageContentPx: [], forcedStarts: new Set() }), []);

// ── numbering: the two divider conventions from the spec ────────────────────
const starts = [0, 10, 20, 30, 40, 50];   // six pages
const counted = [
  { startBlockIndex: 0,  unnumbered: false, pageNumberStart: null, pageNumberFormat: "decimal" },
  { startBlockIndex: 50, unnumbered: true,  pageNumberStart: null, pageNumberFormat: "decimal" },
];
check("divider COUNTED — page after a divider is divider+1",
  M.numberPages([0, 10, 50, 60], [
    ...counted,
    { startBlockIndex: 60, unnumbered: false, pageNumberStart: null, pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["1", "2", null, "4"]);

check("divider NOT COUNTED — the next section restarts and reclaims the number",
  M.numberPages([0, 10, 50, 60], [
    ...counted,
    { startBlockIndex: 60, unnumbered: false, pageNumberStart: 3, pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["1", "2", null, "3"]);

check("an unnumbered page reports no number at all",
  M.numberPages([0], [{ startBlockIndex: 0, unnumbered: true, pageNumberStart: null, pageNumberFormat: "decimal" }])
    .map((p) => [p.number, p.text])[0],
  [null, null]);

check("roman front matter renumbers to decimal at the body",
  M.numberPages(starts, [
    { startBlockIndex: 0,  unnumbered: false, pageNumberStart: null, pageNumberFormat: "lowerRoman" },
    { startBlockIndex: 30, unnumbered: false, pageNumberStart: 1,    pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["i", "ii", "iii", "1", "2", "3"]);

// ── number formats ──────────────────────────────────────────────────────────
check("lowerRoman 4/9/14/40", [4, 9, 14, 40].map((n) => M.formatPageNumber(n, "lowerRoman")), ["iv", "ix", "xiv", "xl"]);
check("upperRoman 1990", M.formatPageNumber(1990, "upperRoman"), "MCMXC");
check("upperLetter wraps Word-style at 27", [1, 26, 27, 28].map((n) => M.formatPageNumber(n, "upperLetter")), ["A", "Z", "AA", "BB"]);
check("an unknown format degrades to decimal", M.formatPageNumber(7, "chicago"), "7");

console.log(failures ? `\n${failures} FAILED` : "\nAll page-layout checks passed");
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd ~/modakerati && node scripts/verify-page-layout.mjs
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../lib/page-layout.ts'`.

- [ ] **Step 3: Write the module**

Create `lib/page-layout.ts`:

```ts
// Pure page geometry, pagination and page numbering for the Writer's page view.
//
// PURE ON PURPOSE — no React, no react-native, no DOM. This module holds the two
// rules most likely to be wrong (height accumulation and the divider-numbering
// conventions) and the app has no test runner, so purity is what lets
// scripts/verify-page-layout.mjs check it. Keep it free of imports that need a
// bundler.
//
// Spec: docs/superpowers/specs/2026-08-12-page-view-in-writer-design.md
import type { DocSectionDTO } from "@/lib/api";

/** Word measures in twips: 1440 per inch. CSS is 96px per inch. */
const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;
const TWIPS_TO_PX = PX_PER_INCH / TWIPS_PER_INCH;

/** A4 portrait at 1-inch margins — the fallback when a cached DTO predates
 *  `page`, matching the engine's PAGE_SIZES.A4 and MARGIN_PRESETS.normal. */
const A4_FALLBACK = {
  widthTwips: 11906,
  heightTwips: 16838,
  margins: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 720, footer: 720, gutter: 0 },
};

/** The two numbers pagination actually needs, in CSS pixels. */
export type PageGeometry = {
  /** Width of the text column — the measuring host's width. */
  textColumnPx: number;
  /** Height of the text area on one page: page height less top and bottom margins. */
  contentHeightPx: number;
};

/** Derive pixel geometry from a section's twips. `undefined`/`null` → A4 at 1". */
export function geometryFromSection(page: DocSectionDTO["page"] | undefined): PageGeometry {
  const p = page ?? A4_FALLBACK;
  const m = p.margins;
  return {
    // The gutter is the BINDING allowance — extra width stolen from the text
    // column on the bound edge. These theses are bound, so ignoring it makes
    // every column systematically too wide and under-counts pages.
    textColumnPx: (p.widthTwips - m.left - m.right - (m.gutter ?? 0)) * TWIPS_TO_PX,
    contentHeightPx: (p.heightTwips - m.top - m.bottom) * TWIPS_TO_PX,
  };
}

export type PaginateInput = {
  /** Measured height of each block, in document order, including its bottom margin. */
  heights: number[];
  /** Content height of the page each block would sit on — parallel to `heights`,
   *  because geometry can differ per section. */
  pageContentPx: number[];
  /** Block indices that MUST begin a page (a section with startsOnNewPage). */
  forcedStarts: ReadonlySet<number>;
};

/**
 * Accumulate block heights into pages.
 *
 * Returns the positions in `heights` that START each page — always beginning
 * with 0 for a non-empty document. Breaks land BETWEEN blocks, never inside a
 * paragraph, so a page under-fills by up to one block's height and the error
 * accumulates down the document. That is the accepted inaccuracy in D1 of the
 * spec; the PDF layer remains the source of exact truth.
 *
 * A block taller than a whole page occupies one alone rather than looping.
 */
export function paginate({ heights, pageContentPx, forcedStarts }: PaginateInput): number[] {
  if (heights.length === 0) return [];
  const starts: number[] = [0];
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    const limit = pageContentPx[i] || pageContentPx[0] || 1;
    const forced = i > 0 && forcedStarts.has(i);
    // `used > 0` is what stops an over-tall block looping: it always gets placed,
    // and the NEXT block opens a fresh page.
    if (forced || (used > 0 && used + heights[i] > limit)) {
      starts.push(i);
      used = heights[i];
      continue;
    }
    used += heights[i];
  }
  return starts;
}

/** The per-section facts numbering needs. Built natively; serializable. */
export type PageSectionInput = {
  startBlockIndex: number;
  /** Divider page or ornamented front matter — carries no number by design. */
  unnumbered: boolean;
  /** This section's own w:pgNumType start value, when it restarts numbering. */
  pageNumberStart: number | null;
  /** w:pgNumType vocabulary: "decimal" | "lowerRoman" | "upperRoman" |
   *  "lowerLetter" | "upperLetter". Anything else renders decimal. */
  pageNumberFormat: string;
};

export type PageNumbering = {
  /** The block index this page begins at. */
  startBlockIndex: number;
  sectionIndex: number;
  unnumbered: boolean;
  /** The counter value, or null when the page is unnumbered. */
  number: number | null;
  /** Formatted per the owning section, or null when unnumbered. */
  text: string | null;
};

/** The section a block belongs to: the last one starting at or before it. */
export function sectionForBlock(sections: PageSectionInput[], blockIndex: number): number {
  let found = 0;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].startBlockIndex <= blockIndex) found = i;
    else break;
  }
  return found;
}

/**
 * Number the pages.
 *
 * EVERY physical page advances the counter, including an unnumbered one — that
 * is the "divider counted" convention (5, blank-6, 7) and it is what
 * add_divider_pages builds today. The "not counted" convention (5, blank, 6) is
 * nothing but a pageNumberStart restart on the FOLLOWING section, which the
 * reset below already honours. So there is no convention switch here: the Writer
 * renders whichever the .docx encodes and never picks one (spec D7).
 */
export function numberPages(pageStarts: number[], sections: PageSectionInput[]): PageNumbering[] {
  let counter = 1;
  let lastSection = -1;
  return pageStarts.map((startBlockIndex) => {
    const sectionIndex = sectionForBlock(sections, startBlockIndex);
    const sec = sections[sectionIndex];
    if (sectionIndex !== lastSection) {
      if (sec && sec.pageNumberStart != null) counter = sec.pageNumberStart;
      lastSection = sectionIndex;
    }
    const unnumbered = !!sec?.unnumbered;
    const value = counter;
    counter += 1;
    return {
      startBlockIndex,
      sectionIndex,
      unnumbered,
      number: unnumbered ? null : value,
      text: unnumbered ? null : formatPageNumber(value, sec?.pageNumberFormat ?? "decimal"),
    };
  });
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function toRoman(n: number): string {
  let out = "";
  let rest = n;
  for (const [value, sym] of ROMAN) {
    while (rest >= value) { out += sym; rest -= value; }
  }
  return out;
}

/** Word's alphabetic numbering REPEATS the letter past Z: A…Z, AA, BB, CC. */
function toLetter(n: number): string {
  const i = n - 1;
  return String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1);
}

/** Render a page number in w:pgNumType vocabulary. Unknown formats → decimal. */
export function formatPageNumber(n: number, format: string): string {
  if (n < 1) return String(n);
  switch (format) {
    case "lowerRoman": return toRoman(n).toLowerCase();
    case "upperRoman": return toRoman(n);
    case "lowerLetter": return toLetter(n).toLowerCase();
    case "upperLetter": return toLetter(n);
    default: return String(n);
  }
}
```

- [ ] **Step 4: Run the verification**

```bash
cd ~/modakerati && node scripts/verify-page-layout.mjs
```

Expected: every line prefixed `ok`, ending `All page-layout checks passed`, exit 0.

- [ ] **Step 5: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati && git add lib/page-layout.ts scripts/verify-page-layout.mjs
git commit -m "feat(page-view): pure pagination and page numbering

Both divider conventions fall out of one rule — every physical page advances
the counter, and 'not counted' is just a pageNumberStart restart on the next
section. No convention switch: the Writer renders what the .docx encodes.

Verified by transpiling and importing the real module, so the script cannot
drift from shipping code the way verify-ask-parse.mjs can."
```

---

## Task 6: App — `PageBreakNode` and its band

One decorator node per boundary renders `[footer][gutter][header]`. No page wrapper elements: the chrome work already shipped two off-by-N bugs (`c28d406`, `6eae8ee`) from nodes the index walkers didn't expect, and a nesting level would reopen that whole class.

**Files:**
- Modify: `~/modakerati/components/workspace/lexical/blockLexical.tsx`

- [ ] **Step 1: Add the data type**

Immediately after the `ChromeData` type (~line 97):

```ts
/** One page boundary: the ending page's footer, the gutter, the next page's
 *  header. Rendered by PageBreakNode; never serialized to a block. */
export type PageBreakData = {
  /**
   * A boundary node sits BETWEEN two pages, so the first page would have no
   * header and the last no footer. Two edge variants close that:
   *   • "leading"  — before the first block: header only, no gutter
   *   • "boundary" — between pages: footer, gutter, header
   *   • "trailing" — after the last block: footer only, no gutter
   */
  variant: "leading" | "boundary" | "trailing";
  /** 1-based number of the page the footer belongs to. */
  endingPage: number;
  /** Footer of the ending page. null → the paper shows nothing (spec D5/D6). */
  footer: {
    text: string;
    /** The resolved, formatted page number, or null when the footer carries no
     *  PAGE field or the page is unnumbered. */
    pageText: string | null;
    sectionIndex: number;
    startBlockIndex: number;
  } | null;
  /** Header of the page BEGINNING after the gutter. null → no header. */
  header: {
    text: string;
    segments: string[];
    border: { bottom: boolean; color: string | null } | null;
    sectionIndex: number;
    startBlockIndex: number;
  } | null;
  /** Names the page beginning after the gutter — "p. 14", or for an unnumbered
   *  page its NAME ("divider page"). Never a number on an unnumbered page. */
  gutterLabel: string;
  /** Where a gutter tap goes when the ending page has NO footer: the section's
   *  footer, so the sheet opens and the student can ask for page numbers. null
   *  when the page is deliberately unnumbered — there is nothing to offer. */
  gutterTarget: { sectionIndex: number; startBlockIndex: number; text: string } | null;
  rtl: boolean;
};
```

- [ ] **Step 2: Add the band component**

After the `ChromeBand` function (~line 1140). `noFocus` guards the iOS scroll-to-top and Android sticky-caret bugs exactly as `ChromeBand` does — it is duplicated rather than shared because `ChromeBand` closes over its own props:

```tsx
function PageBreakBand({
  data, onPickHeader, onPickFooter,
}: { data: PageBreakData; onPickHeader: () => void; onPickFooter: () => void }): React.ReactElement {
  const noFocus = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      window.getSelection?.()?.removeAllRanges?.();
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  };
  const ruleColor = data.header?.border?.bottom
    ? (data.header.border.color ? `#${data.header.border.color}` : "#9A5A31")
    : null;
  const footerLine = [data.footer?.text, data.footer?.pageText].filter(Boolean).join("   ");

  return React.createElement(
    "div",
    { className: "lx-pagebreak", dir: data.rtl ? "rtl" : "ltr" },
    // Foot of the ending page — omitted entirely when the document has no
    // footer there, so the paper only ever shows what Word will print.
    data.footer
      ? React.createElement(
          "div",
          { className: "lx-pb-footer", onMouseDown: noFocus, onClick: onPickFooter },
          React.createElement("span", { className: "lx-pb-footer-txt" }, footerLine || " "),
        )
      : null,
    // The gutter is APP CHROME, not paper: its label can never be mistaken for
    // something that will print, which is why an unnumbered page's name lives
    // here. Only a real boundary has one — the edge variants open or close the
    // document rather than separating two pages.
    data.variant === "boundary"
      ? React.createElement(
          "div",
          {
            className: "lx-pb-gutter",
            // Only tappable when there is no footer to tap instead — then it is
            // the way in to "add page numbers here".
            ...(data.footer || !data.gutterTarget
              ? {}
              : { onMouseDown: noFocus, onClick: onPickFooter, style: { cursor: "pointer" } }),
          },
          React.createElement("span", { className: "lx-pb-gutter-lbl" }, data.gutterLabel),
        )
      : null,
    // Top of the page starting after the gutter.
    data.header
      ? React.createElement(
          "div",
          { className: "lx-pb-header", onMouseDown: noFocus, onClick: onPickHeader },
          React.createElement(
            "div",
            { className: "lx-pb-header-row" },
            (data.header.segments.length ? data.header.segments : [data.header.text]).map((seg, i) =>
              React.createElement("span", { key: i, className: "lx-chrome-hdr-seg" }, seg || " "),
            ),
          ),
          ruleColor
            ? React.createElement("div", { className: "lx-chrome-hdr-rule", style: { background: ruleColor } })
            : null,
        )
      : null,
  );
}
```

- [ ] **Step 3: Add the node**

After the `ChromeNode` class and its helpers (~line 1207). It mirrors `ChromeNode`'s decorator shape exactly, including how a tap reaches native: `decorate(editor)` puts a `NodeSelection` on the node itself, and `onState` turns that into a `blockType`.

`ChromeNode` already imports `$createNodeSelection`, `$setSelection`, `SKIP_DOM_SELECTION_TAG` and `type LexicalEditor`. Add `$getNodeByKey` from `lexical` if it is not imported yet.

```ts
type SerializedPageBreakNode = SerializedLexicalNode & { data: PageBreakData };

export class PageBreakNode extends DecoratorNode<React.ReactNode> {
  __data: PageBreakData;

  static getType(): string { return "modk-pagebreak"; }
  static clone(node: PageBreakNode): PageBreakNode { return new PageBreakNode(node.__data, node.__key); }

  constructor(data: PageBreakData, key?: NodeKey) { super(key); this.__data = data; }

  getData(): PageBreakData { return this.__data; }
  setData(data: PageBreakData): void { this.getWritable().__data = data; }

  /** Display-only: contributes no text, so it can never leak into a block. */
  getTextContent(): string { return ""; }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.contentEditable = "false";
    // Same reason ChromeNode marks its wrapper: the reorder-mode grip CSS
    // excludes wrappers, and the lx-* classes live on the inner React band.
    el.className = "lx-chrome-wrap lx-pagebreak-host";
    return el;
  }
  updateDOM(): false { return false; }

  isInline(): false { return false; }

  /** Which half of the band was last tapped. onState reads this to decide
   *  whether to report the header or the footer — the node is ONE selectable
   *  node but carries TWO targets, which is the only way it differs from
   *  ChromeNode. */
  __pick: "top" | "bottom" = "bottom";
  setPick(side: "top" | "bottom"): void { this.getWritable().__pick = side; }
  getPick(): "top" | "bottom" { return this.__pick; }

  decorate(editor: LexicalEditor): React.ReactNode {
    const key = this.getKey();
    // Mirrors ChromeNode.decorate exactly: record the side, then put a
    // NodeSelection on ourselves. onState turns that into "chrome:top" /
    // "chrome:bottom", so the whole native chrome path is reused unchanged.
    const pick = (side: "top" | "bottom") => () =>
      editor.update(
        () => {
          const self = $getNodeByKey(key);
          if ($isPageBreakNode(self)) self.setPick(side);
          const ns = $createNodeSelection();
          ns.add(key);
          $setSelection(ns);
        },
        { tag: SKIP_DOM_SELECTION_TAG },
      );
    return React.createElement(PageBreakBand, {
      data: this.__data,
      onPickHeader: pick("top"),
      onPickFooter: pick("bottom"),
    });
  }

  exportJSON(): SerializedPageBreakNode {
    return { ...super.exportJSON(), type: PageBreakNode.getType(), version: 1, data: this.__data };
  }
  static importJSON(json: SerializedPageBreakNode): PageBreakNode { return new PageBreakNode(json.data); }
}

export function $createPageBreakNode(data: PageBreakData): PageBreakNode { return new PageBreakNode(data); }
export function $isPageBreakNode(node: LexicalNode | null | undefined): node is PageBreakNode {
  return node instanceof PageBreakNode;
}

/**
 * Every node that exists only to be LOOKED at — chrome bands and page
 * boundaries. Block-index walkers must skip these or every index past the first
 * one is off by N. This predicate is the single place that list is defined;
 * adding a display-only node kind means adding it HERE, not at each call site.
 */
export function $isDisplayOnlyNode(node: LexicalNode | null | undefined): boolean {
  return $isChromeNode(node) || $isPageBreakNode(node);
}
```

If `ChromeNode.decorate` uses a different bridge than `window.__lxPickChrome`, use whatever it actually uses — the requirement is that a page band's tap reaches `onState` the same way a chrome band's does.

- [ ] **Step 4: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati && git add components/workspace/lexical/blockLexical.tsx
git commit -m "feat(page-view): PageBreakNode renders footer, gutter and header as one node

One node per boundary rather than page wrapper elements — the chrome work
already shipped two off-by-N bugs from nodes the index walkers didn't expect
(c28d406, 6eae8ee), and nesting would reopen that class.

\$isDisplayOnlyNode is the single definition of what walkers must skip."
```

---

## Task 7: App — route every walker through `$isDisplayOnlyNode`

**This is the highest-risk task in the plan.** A missed site silently targets the wrong block, corrupting a student's thesis with no error.

**Files:**
- Modify: `~/modakerati/components/workspace/lexical/blockLexical.tsx` (~line 2074, ~line 2139)
- Modify: `~/modakerati/components/workspace/lexical/LexicalDomEditor.tsx` (`$anyNodeAtBlockIndex` ~line 1372; `ScrollSyncPlugin` ~lines 1207 and 1279)

- [ ] **Step 1: Find every site**

```bash
cd ~/modakerati && rg -n '\$isChromeNode' components/ lib/ stores/
```

Expected: the four sites listed above plus the definition and the new `$isDisplayOnlyNode`. **If this prints a site not listed here, it still needs changing** — the list is a starting point, not an allowlist.

- [ ] **Step 2: Replace each skip**

At each site where `$isChromeNode(node)` decides *"skip this, it is not a block"*, substitute `$isDisplayOnlyNode(node)`. In `blockLexical.tsx`:

```ts
    if ($isDisplayOnlyNode(node)) continue; // display-only — never serializes to a block
```

```ts
    if ($isDisplayOnlyNode(node)) continue;           // display-only, not draggable
```

In `LexicalDomEditor.tsx`, add `$isDisplayOnlyNode` to the existing import from `./blockLexical` and use it inside `$anyNodeAtBlockIndex` and in `ScrollSyncPlugin`'s DOM-index mapping wherever chrome is currently skipped.

Do **not** change sites that ask *"is this specifically a chrome band?"* — that is identity, not index arithmetic. `onState`'s `blockType: "chrome:" + cd.kind` reporting is one such site, and Step 3 extends it deliberately rather than by substitution.

- [ ] **Step 3: Report a tapped page band as a chrome selection**

In `LexicalDomEditor.tsx`'s `onState`, the `$isNodeSelection(sel)` branch currently derives `cn` (a `ChromeNode`) and `bd` (a `BlockDataNode`). Add a third, checked **before** `bd` — a selection is exactly one node, so the three are mutually exclusive:

```ts
          const pb = nodes.length === 1 && $isPageBreakNode(nodes[0]) ? nodes[0] : null;
```

Then, between the `if (cn) { … }` and `else if (bd) { … }` arms:

```ts
          } else if (pb) {
            // A tapped page band. It carries BOTH a header and a footer, so the
            // side the student actually touched decides which we report — then
            // it rides the EXISTING chrome path, so the native sheet, the ✦
            // panel and the template picker all work with no native change.
            const d = pb.getData();
            const side = pb.getPick();
            // A gutter tap on a footerless page falls back to gutterTarget, so
            // the footer sheet still opens and can offer page numbers.
            const part = side === "top" ? d.header : (d.footer ?? d.gutterTarget);
            if (part) {
              key = pb.getKey();
              payload = {
                bold: false, italic: false, underline: false,
                blockType: "chrome:" + side,   // "chrome:top" | "chrome:bottom"
                isRTL: d.rtl, alignment: null,
                index: part.startBlockIndex, text: part.text,
                blocks: [{ index: part.startBlockIndex, text: part.text }],
                y: -1,
              };
            }
```

Import `$isPageBreakNode` from `./blockLexical`. Because the reported `blockType` is one the native side already handles, `WorkspaceLexicalView`'s `onState` routing, `chromeSelection`, `chromeBubbleKind` and `BlockContextBar` need **no** changes.

- [ ] **Step 4: Confirm nothing was missed**

```bash
cd ~/modakerati && rg -n '\$isChromeNode' components/ lib/ stores/
```

Expected: only the definition in `blockLexical.tsx`, its use inside `$isDisplayOnlyNode`, and any genuine identity check. No remaining `continue`/skip site.

- [ ] **Step 5: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati && git add components/workspace/lexical/
git commit -m "fix(writer): index walkers skip page nodes as well as chrome

A walker that counts a display-only node as a block puts every index after it
off by N — which is how c28d406 and 6eae8ee both happened. One predicate now
owns that list."
```

---

## Task 8: App — the offscreen measuring host

**Files:**
- Modify: `~/modakerati/components/workspace/lexical/LexicalDomEditor.tsx` (the `CSS` template literal ~line 240; a new module-level function)

- [ ] **Step 1: Add the host's CSS**

Append to the `CSS` template literal in `LexicalDomEditor.tsx`:

```css
/* Offscreen measuring host for the page view. Content is rendered here at TRUE
   A4 text-column width, in the document's own point sizes, purely to learn how
   tall each block is on a real page — the visible editor keeps writing-size text.
   visibility:hidden, NEVER display:none: a display:none subtree reports zero
   heights and every page would hold the whole document. */
.lx-measure {
  position: absolute; left: -10000px; top: 0;
  visibility: hidden; pointer-events: none;
  font-family: sans-serif; color: #1a1a1a;
}
.lx-measure * { max-width: none; }

/* ── Page boundary: footer, gutter, header ────────────────────────────────── */
.lx-pagebreak-host { user-select: none; -webkit-user-select: none; }
.lx-pagebreak { margin: 0 -18px; }            /* bleed past .lx-content padding to the paper edge */
.lx-pb-footer { padding: 10px 18px 14px; text-align: center; cursor: pointer;
  box-shadow: 0 6px 8px -8px rgba(0,0,0,.35); }
.lx-pb-footer-txt { font-size: 12px; color: #3a3a46; }
.lx-pb-gutter { height: 17px; background: #dcdde3; display: flex; align-items: center;
  justify-content: center; }
.lx-pb-gutter-lbl { font-size: 9.5px; font-weight: 700; color: #979daa; letter-spacing: .04em; }
.lx-pb-header { padding: 13px 18px 5px; cursor: pointer;
  box-shadow: 0 -6px 8px -8px rgba(0,0,0,.35); }
.lx-pb-header-row { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; }
```

- [ ] **Step 2: Add the measuring function**

At module level in `LexicalDomEditor.tsx`, below the `CSS` constant:

```ts
/**
 * Measure each block's rendered height at TRUE page geometry.
 *
 * Renders one block at a time into an offscreen host whose width is the real
 * text column (≈601.7px for A4 at 1"), so the heights returned are the heights
 * Word would produce — not the heights of the readable-size visible editor.
 *
 * Heights are cached under a content hash, so a keystroke re-measures exactly
 * one block. Never call this per keystroke regardless: the caller debounces.
 */
const measureCache = new Map<string, number>();

function blockMeasureKey(el: HTMLElement, columnPx: number): string {
  return `${Math.round(columnPx)}|${el.className}|${el.innerHTML}`;
}

export function measureBlockHeights(
  sources: HTMLElement[],
  columnPx: number,
  rtl: boolean,
): number[] {
  let host = document.querySelector<HTMLDivElement>(".lx-measure");
  if (!host) {
    host = document.createElement("div");
    host.className = "lx-measure";
    document.body.appendChild(host);
  }
  host.style.width = `${columnPx}px`;
  // Arabic line-breaking differs from Latin, so the host must measure in the
  // DOCUMENT's direction — which is content-driven here, never locale-driven.
  host.dir = rtl ? "rtl" : "ltr";

  return sources.map((src) => {
    const key = `${rtl ? "r" : "l"}|${blockMeasureKey(src, columnPx)}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) return hit;

    const clone = src.cloneNode(true) as HTMLElement;
    host.innerHTML = "";
    host.appendChild(clone);
    // getBoundingClientRect excludes margins, which DO occupy page height —
    // .lx-p alone carries a 10px bottom margin, ~8% of a page over 8 blocks.
    const cs = window.getComputedStyle(clone);
    const h = clone.getBoundingClientRect().height
      + parseFloat(cs.marginTop || "0")
      + parseFloat(cs.marginBottom || "0");
    host.innerHTML = "";

    // Bound the cache so a long editing session cannot grow it without limit.
    if (measureCache.size > 4000) measureCache.clear();
    measureCache.set(key, h);
    return h;
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati && git add components/workspace/lexical/LexicalDomEditor.tsx
git commit -m "feat(page-view): offscreen measuring host at true page geometry

Heights come from rendering each block at the real text-column width, so a page
holds what Word's page holds while the visible editor stays at writing size.
Margins are added explicitly — getBoundingClientRect drops them, and .lx-p's
10px alone is ~8% of a page."
```

---

## Task 9: App — build the serializable `pageSetup` prop

`LexicalDomEditor` is `'use dom'`: only serializable props cross into it, and `t()` lives natively. So sections, geometry and every user-visible string are prepared on the native side — exactly as `buildChrome` already bakes in `label`.

**Files:**
- Modify: `~/modakerati/components/workspace/WorkspaceLexicalView.tsx` (beside `buildChrome`, ~line 66)

- [ ] **Step 1: Add the builder**

Add these imports at the top of `WorkspaceLexicalView.tsx`:

```ts
import { geometryFromSection, type PageSectionInput } from "@/lib/page-layout";
```

Then, immediately after `buildChrome`:

```ts
/** Everything the DOM editor needs to paginate, all serializable. Strings are
 *  localized HERE because t() cannot cross the 'use dom' boundary. */
export type PageSetup = {
  sections: (PageSectionInput & {
    /** Why the page is unnumbered, so the gutter can NAME it correctly.
     *  null when the page is numbered normally. */
    unnumberedKind: "divider" | "ornament" | null;
    textColumnPx: number;
    contentHeightPx: number;
    startsOnNewPage: boolean;
    header: { text: string; segments: string[]; border: { bottom: boolean; color: string | null } | null } | null;
    footer: { text: string; hasPageNumbers: boolean } | null;
  })[];
  /** "p. {n}" with {n} substituted by the DOM side. */
  gutterNumberTemplate: string;
  /** Names an unnumbered page in the gutter, e.g. "divider page". */
  gutterDividerLabel: string;
  gutterOrnamentLabel: string;
  rtl: boolean;
};

function buildPageSetup(
  sections: DocSectionDTO[] | undefined,
  rtl: boolean,
  t: (k: string, o?: Record<string, unknown>) => string,
): PageSetup | null {
  if (!sections || sections.length === 0) return null;
  return {
    sections: sections.map((s) => {
      const g = geometryFromSection(s.page);
      return {
        startBlockIndex: s.startBlockIndex,
        // A divider page and an ornamented front-matter page carry no number by
        // design — the paper shows nothing and the gutter names them instead.
        unnumbered: !!s.dividerPage || !!s.pageOrnament,
        unnumberedKind: s.dividerPage ? "divider" : s.pageOrnament ? "ornament" : null,
        pageNumberStart: s.footer?.pageNumbers?.startAt ?? null,
        pageNumberFormat: s.footer?.pageNumbers?.format ?? "decimal",
        textColumnPx: g.textColumnPx,
        contentHeightPx: g.contentHeightPx,
        startsOnNewPage: s.startsOnNewPage,
        header: s.header
          ? { text: s.header.text, segments: s.header.segments, border: s.header.border }
          : null,
        footer: s.footer ? { text: s.footer.text, hasPageNumbers: !!s.footer.pageNumbers } : null,
      };
    }),
    gutterNumberTemplate: t("workspace.pages.gutterPage", { defaultValue: "p. {{n}}" }),
    gutterDividerLabel: t("workspace.pages.dividerPage", { defaultValue: "divider page" }),
    gutterOrnamentLabel: t("workspace.pages.frontMatterPage", { defaultValue: "unnumbered page" }),
    rtl,
  };
}
```

- [ ] **Step 2: Memoize it beside the existing `chrome` memo**

`showPages` arrives in Task 11; until then it is gated on `showChrome` only so this task compiles and can be verified alone. Beside the `chrome` `useMemo` (~line 279):

```ts
  const pageSetup = useMemo(
    () => buildPageSetup(doc?.available ? doc.sections : undefined, rtl, t),
    [doc, rtl, t],
  );
```

- [ ] **Step 3: Retire the section-start header band while pages are on**

With a header at the top of every page, `buildChrome`'s `kind: "top"` band at each section start is a second copy of the same running head, a few lines below the first. Give `buildChrome` a parameter and skip it:

```ts
function buildChrome(
  sections: DocSectionDTO[] | undefined,
  blocks: DocBlockDTO[],
  rtl: boolean,
  t: (k: string, o?: Record<string, unknown>) => string,
  /** When the page view is on it renders a header at every page top, so the
   *  section-start copy is a duplicate — the footer band goes the same way. */
  pagesOn: boolean,
): ChromeData[] {
```

Then guard both band pushes: `if (s.header && !pagesOn) { … }` and `if (s.footer && !pagesOn) { … }`. The **§ section-break band is structural and always stays** — do not guard it.

Update all four `buildChrome(…)` call sites (the `useMemo` ~line 279 and the three `setReseed` calls ~lines 527 and 669) to pass `!!pageSetup` as the new argument. The `useMemo` dependency array must gain `pageSetup`.

- [ ] **Step 4: Pass it down**

At the `LexicalDomEditor` element (~line 1056), beside `chrome={chrome}`:

```tsx
          pageSetup={pageSetup}
```

And accept it in `LexicalDomEditor`'s props type:

```ts
  pageSetup?: PageSetup | null;
```

Import the type there: `import type { PageSetup } from "../WorkspaceLexicalView";`

- [ ] **Step 5: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean. `pageSetup` is accepted and unused for now — Task 10 consumes it.

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati && git add components/workspace/
git commit -m "feat(page-view): build the serializable pageSetup prop natively

Only serializable props cross the 'use dom' boundary and t() cannot, so
geometry and every user-visible string are prepared native-side — the same
contract buildChrome already follows for its label."
```

---

## Task 10: App — the pagination plugin

**Files:**
- Modify: `~/modakerati/components/workspace/lexical/LexicalDomEditor.tsx`

- [ ] **Step 1: Add the plugin**

Add to the imports from `./blockLexical`: `$createPageBreakNode`, `$isPageBreakNode`, `$isDisplayOnlyNode`, `PageBreakNode`, `type PageBreakData`. Add `paginate`, `numberPages` from `@/lib/page-layout`, and confirm `$getRoot` and `type LexicalNode` are imported from `lexical` (both are already used in this file).

Add `PageBreakNode` to the editor config's `nodes` array beside `ChromeNode` — **a node class missing from that array throws at registration and the editor renders nothing at all**.

Add this component beside the other plugins:

```tsx
/**
 * Insert one PageBreakNode per measured page boundary.
 *
 * Runs on idle, never per keystroke: measurement touches layout, and the
 * Writer's rule is that nothing updates per input event (see createStreamPump's
 * 90ms batching for the same discipline applied to streaming).
 */
function PaginationPlugin({ setup }: { setup?: PageSetup | null }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!setup || setup.sections.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const repaginate = () => {
      if (cancelled) return;

      // 1 ─ Collect the block-bearing DOM rows, in order, skipping display-only
      //     nodes. Their positions ARE block indices — the same contract
      //     $anyNodeAtBlockIndex relies on.
      const rows: HTMLElement[] = [];
      editor.getEditorState().read(() => {
        const root = $getRoot();
        root.getChildren().forEach((node) => {
          if ($isDisplayOnlyNode(node)) return;
          const el = editor.getElementByKey(node.getKey());
          if (el) rows.push(el);
        });
      });
      if (rows.length === 0) return;

      // 2 ─ Measure at true geometry and paginate.
      const sectionOf = (blockIndex: number) => {
        let found = 0;
        for (let i = 0; i < setup.sections.length; i++) {
          if (setup.sections[i].startBlockIndex <= blockIndex) found = i;
          else break;
        }
        return found;
      };
      // One column width for the whole document: a thesis mixing page sizes
      // mid-document is vanishingly rare, and a per-section width would mean
      // re-laying out the measuring host per block. Page HEIGHT is per-section
      // below, which is the one that actually varies (landscape appendices).
      const columnPx = setup.sections[0].textColumnPx;
      const heights = measureBlockHeights(rows, columnPx, setup.rtl);
      const pageContentPx = rows.map((_, i) => setup.sections[sectionOf(i)].contentHeightPx);
      const forcedStarts = new Set(
        setup.sections.filter((s) => s.startsOnNewPage && s.startBlockIndex > 0).map((s) => s.startBlockIndex),
      );
      const starts = paginate({ heights, pageContentPx, forcedStarts });
      const numbering = numberPages(starts, setup.sections);
      if (cancelled) return;

      // 3 ─ Build the node data.
      //     An unnumbered page shows NOTHING on the paper — that is the whole
      //     point of a divider — so its footer is dropped even when the section
      //     has one, and the gutter NAMES it rather than numbering it.
      const footerFor = (page: (typeof numbering)[number]) => {
        const sec = setup.sections[page.sectionIndex];
        if (!sec.footer || page.unnumbered) return null;
        return {
          text: sec.footer.text,
          pageText: sec.footer.hasPageNumbers ? page.text : null,
          sectionIndex: page.sectionIndex,
          startBlockIndex: sec.startBlockIndex,
        };
      };
      const headerFor = (page: (typeof numbering)[number]) => {
        const sec = setup.sections[page.sectionIndex];
        if (!sec.header) return null;
        return {
          text: sec.header.text,
          segments: sec.header.segments,
          border: sec.header.border,
          sectionIndex: page.sectionIndex,
          startBlockIndex: sec.startBlockIndex,
        };
      };
      const gutterFor = (page: (typeof numbering)[number]) => {
        if (!page.unnumbered) return setup.gutterNumberTemplate.replace("{{n}}", page.text ?? "");
        return setup.sections[page.sectionIndex].unnumberedKind === "divider"
          ? setup.gutterDividerLabel
          : setup.gutterOrnamentLabel;
      };

      // Boundaries sit immediately BEFORE the first block of each page after
      // the first.
      const gutterTargetFor = (page: (typeof numbering)[number]) => {
        // Nothing to offer on a page that is unnumbered by design.
        if (page.unnumbered) return null;
        const sec = setup.sections[page.sectionIndex];
        return { sectionIndex: page.sectionIndex, startBlockIndex: sec.startBlockIndex, text: sec.footer?.text ?? "" };
      };

      const boundaries = new Map<number, PageBreakData>();
      for (let p = 1; p < starts.length; p++) {
        boundaries.set(starts[p], {
          variant: "boundary",
          endingPage: numbering[p - 1].number ?? 0,
          footer: footerFor(numbering[p - 1]),
          header: headerFor(numbering[p]),
          gutterLabel: gutterFor(numbering[p]),
          gutterTarget: gutterTargetFor(numbering[p - 1]),
          rtl: setup.rtl,
        });
      }
      // The edge nodes: a boundary separates two pages, so without these the
      // FIRST page would have no header and the LAST no footer.
      const first = numbering[0];
      const last = numbering[numbering.length - 1];
      const leading: PageBreakData | null = headerFor(first)
        ? { variant: "leading", endingPage: 0, footer: null, header: headerFor(first),
            gutterLabel: "", gutterTarget: null, rtl: setup.rtl }
        : null;
      const trailing: PageBreakData | null = footerFor(last)
        ? { variant: "trailing", endingPage: last.number ?? 0, footer: footerFor(last), header: null,
            gutterLabel: "", gutterTarget: null, rtl: setup.rtl }
        : null;

      editor.update(() => {
        const root = $getRoot();
        // Drop the previous nodes wholesale, then re-insert. Simpler than
        // diffing, and the node carries no state worth preserving.
        root.getChildren().forEach((n) => { if ($isPageBreakNode(n)) n.remove(); });

        let blockIndex = 0;
        let firstBlockNode: LexicalNode | null = null;
        let lastBlockNode: LexicalNode | null = null;
        root.getChildren().forEach((node) => {
          if ($isDisplayOnlyNode(node)) return;
          if (blockIndex === 0) firstBlockNode = node;
          lastBlockNode = node;
          const data = boundaries.get(blockIndex);
          if (data) node.insertBefore($createPageBreakNode(data));
          blockIndex++;
        });
        if (leading && firstBlockNode) firstBlockNode.insertBefore($createPageBreakNode(leading));
        if (trailing && lastBlockNode) lastBlockNode.insertAfter($createPageBreakNode(trailing));
      }, { discrete: false });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Pagination is a nicety; writing is not. A throw here must leave the
        // student with a plain continuous flow, never a broken editor.
        try { repaginate(); }
        catch (err) { console.warn("[pages] pagination failed, continuing unpaginated", err); }
      }, 400);
    };

    schedule();
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      // Our own insert/remove of boundary nodes fires this too — the content
      // hash cache makes the re-run cheap and it converges after one pass.
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      schedule();
    });

    return () => { cancelled = true; if (timer) clearTimeout(timer); unregister(); };
  }, [editor, setup]);

  return null;
}
```

Import `paginate` and `numberPages` from `@/lib/page-layout` at the top of the file.

- [ ] **Step 2: Mount it**

Beside the other plugins in the editor's JSX (near `<ScrollSyncPlugin … />`, ~line 3052):

```tsx
        <PaginationPlugin setup={pageSetup} />
```

- [ ] **Step 3: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati && git add components/workspace/lexical/LexicalDomEditor.tsx
git commit -m "feat(page-view): paginate on idle and insert the boundary nodes

Measurement touches layout, so it runs 400ms after the last edit and never per
keystroke. Boundaries are rebuilt wholesale rather than diffed — the node holds
no state worth preserving and the height cache makes the re-run cheap."
```

---

## Task 11: App — the `showPages` toggle

**Files:**
- Modify: `~/modakerati/stores/workspace-store.ts` (~line 79, ~line 209, ~line 306)
- Modify: `~/modakerati/components/workspace/WorkspaceLexicalView.tsx`
- Modify: `~/modakerati/components/DockToolsSheet.tsx`

- [ ] **Step 1: Add the store state**

Mirroring `showChrome` exactly. In the state type (~line 79):

```ts
  showPages: boolean;
```

In the initial state (~line 209):

```ts
  showPages: true,
```

In the actions (~line 306):

```ts
  toggleShowPages: () => set((s) => ({ showPages: !s.showPages })),
```

Add `toggleShowPages: () => void;` to the actions type beside `toggleShowChrome`.

- [ ] **Step 2: Gate `pageSetup` on it**

In `WorkspaceLexicalView.tsx`, beside `const showChrome = …` (~line 260):

```ts
  const showPages = useWorkspaceStore((s) => s.showPages);
```

Select the **primitive**, never an object literal — a fresh object each render throws "Maximum update depth exceeded".

Then replace the `pageSetup` memo from Task 9:

```ts
  const pageSetup = useMemo(
    () => {
      if (!showPages) return null;
      // A very large document paginates too slowly to be pleasant; the student
      // can still turn pages on explicitly from the ✦ dock.
      if (blocks.length > 4000) return null;
      return buildPageSetup(doc?.available ? doc.sections : undefined, rtl, t);
    },
    [showPages, doc, blocks.length, rtl, t],
  );
```

- [ ] **Step 3: Add the dock tool**

`DockToolsSheet.tsx` builds its grid from an array of tool descriptors, not from JSX rows. Subscribe to the flag beside the existing `reorderMode` selector (~line 249) — a **primitive**, never an object literal, or you get "Maximum update depth exceeded":

```ts
  const showPages = useWorkspaceStore((s) => s.showPages);
```

Add `BookOpenText` to the `lucide-react-native` import block, then add this descriptor immediately after the `reorderMode` entry (~line 513-521). `enterIndex` orders the sheet's entrance animation, so renumber the entries after it rather than reusing 10:

```ts
    {
      key: "showPages",
      Icon: BookOpenText,
      active: showPages,
      label: t("workspace.pages.toggle", { defaultValue: "Show pages" }),
      a11y: t("workspace.pages.toggle", { defaultValue: "Show pages" }),
      enterIndex: 10,
      onPress: () => useWorkspaceStore.getState().toggleShowPages(),
    },
```

Add `"showPages"` to the `STAYS_OPEN` set (~line 61) beside `"reorderMode"` — the result lands behind the sheet in the document, and flipping pages on only to have the sheet vanish makes it impossible to compare.

The descriptor's `active` drives the existing selected styling, so no colour work is needed. Never hardcode one — colours come from `useThemeColors()`.

- [ ] **Step 4: Typecheck**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati && git add stores/workspace-store.ts components/
git commit -m "feat(page-view): Show pages toggle, and an escape hatch

Mirrors showChrome. Also the escape hatch if a device paginates badly, and the
gate that keeps a 4000-block thesis from paginating on open."
```

---

## Task 12: App — trilingual strings

**Files:**
- Modify: `~/modakerati/locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Add four keys per file, surgically**

⚠️ These files contain ~155 duplicate keys each. `json.load`/`json.dump` **silently drops them**. Use the Edit tool to insert next to the existing `workspace.hf.*` block. Never read-and-rewrite a whole file, and never run a formatter over it.

`en.json`:

```json
    "pages": {
      "toggle": "Show pages",
      "gutterPage": "p. {{n}}",
      "dividerPage": "divider page",
      "frontMatterPage": "unnumbered page"
    },
```

`fr.json`:

```json
    "pages": {
      "toggle": "Afficher les pages",
      "gutterPage": "p. {{n}}",
      "dividerPage": "page de garde",
      "frontMatterPage": "page non numérotée"
    },
```

`ar.json`:

```json
    "pages": {
      "toggle": "إظهار الصفحات",
      "gutterPage": "ص. {{n}}",
      "dividerPage": "صفحة فاصلة",
      "frontMatterPage": "صفحة غير مرقّمة"
    },
```

Nest under the same parent as `workspace.hf` so the keys resolve as `workspace.pages.*`.

- [ ] **Step 2: Confirm each file still parses**

```bash
cd ~/modakerati && for f in en fr ar; do node -e "JSON.parse(require('fs').readFileSync('locales/$f.json','utf8')); console.log('$f ok')"; done
```

Expected: `en ok`, `fr ok`, `ar ok`.

- [ ] **Step 3: Confirm no key was lost**

```bash
cd ~/modakerati && git diff --stat locales/
```

Expected: three files, a handful of insertions each and **zero deletions**. Any deletion means a round-trip dropped duplicate keys — revert and redo with Edit.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati && git add locales/
git commit -m "i18n(page-view): page-view strings in en/fr/ar"
```

---

## Task 13: Full verification

- [ ] **Step 1: Run every automated gate**

```bash
cd ~/mdocxengine       && npx vitest run
cd ~/modakerati-server && npx vitest run --testTimeout=60000
cd ~/modakerati        && npx tsc --noEmit && node scripts/verify-page-layout.mjs
```

Expected: engine green; server green apart from the known pre-existing `destructive-gate.test.ts` failure; app typecheck clean and every page-layout check `ok`.

- [ ] **Step 2: Rebuild the engine and restart the server**

```bash
cd ~/mdocxengine && npm run build
```

Then restart `~/modakerati-server`. Without both, `DocSectionDTO.page` arrives `undefined`, every section silently falls back to A4, and a non-A4 thesis paginates wrongly with no error.

- [ ] **Step 3: Device QA**

The app has no test runner, so these are the only checks that cover the integration. Run on a **real device** — pagination and the WebView both behave differently in a simulator.

- [ ] Block indices survive: select a block near the end of a long thesis and ask the AI to edit it. It must edit **that** block. This is the real test of Task 7 — if it fails, a walker still counts page nodes.
- [ ] Reopen the thesis; scroll restore lands on the same block.
- [ ] Drag-reorder a block across a page boundary; the intended block moves.
- [ ] A section with "start on new page" begins a page.
- [ ] Roman front matter renumbers to decimal at the body section.
- [ ] A page-numbers-only footer shows a number, not `—`.
- [ ] A chapter divider page shows no number on the paper **and none in the gutter** — the gutter names it. Same for an ornamented dedication / acknowledgements / abstract page.
- [ ] With no numbering restart, the page after a divider is *divider + 1*. With `pageNumberStart` set on the following section, it is *divider*.
- [ ] Tapping the header band opens the "Top of every page" sheet; tapping the footer band opens the bottom sheet; a template applies from either.
- [ ] No **duplicate** running header: with pages on, a section start shows one header (the page's), not two. The § section-break band is still there.
- [ ] On a numbered page whose section has no footer, tapping the grey gutter opens the footer sheet.
- [ ] The first page has a header and the last page has a footer — the edge cases a between-pages boundary node cannot cover.
- [ ] An Arabic (RTL) thesis paginates, and both bands render right-to-left.
- [ ] Typing near a boundary does not visibly stutter.
- [ ] Turning "Show pages" off returns the editor to a plain continuous flow.

- [ ] **Step 4: Commit any fixes, then update the memory**

Record what shipped and the non-obvious constraints in
`~/.claude/projects/-Users-hamzasafwan-modakerati/memory/`, and add a pointer line to `MEMORY.md`.

---

## Notes for whoever executes this

- **Order matters across repos.** Tasks 1→3 must land and the engine must be rebuilt before the app sees geometry. The app tasks (4→12) can be written against the A4 fallback and will work; they will just paginate every thesis as A4 until the server ships.
- **The riskiest thing here is Task 7**, and it fails silently. If a device QA item about block targeting fails, go back to it before debugging anything else.
- **If pagination looks wildly wrong** — one page holding the entire document — the measuring host is almost certainly `display:none` somewhere in its cascade rather than `visibility:hidden`. That single mistake produces exactly that symptom.
