# Thesis Foundation P1 — Norm-Compliant .docx Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the thesis `.docx` export (`~/modakerati-server/src/lib/docx.ts`) so it produces a **norm-compliant Algerian thesis document** — page de garde, front matter, Partie dividers, Chapitre headings, numbered sub-headings (Heading 2/3/4 from markdown `#`/`##`/`###`), **real Word tables**, a generated table of contents (sommaire), a bibliography rendered per the template's citation style, lowercase-roman front-matter page numbers switching to arabic in the body, and RTL/binding-margin mirroring — all driven by the template "formatting profile".

**Architecture:** Builds on P0's model (`thesis → sections(Partie) → chapters(Chapitre, markdown content)` + `theses.frontMatter`/`resume` + the `templates` profile columns). A new `marked`-based module turns chapter markdown into an ordered list of render blocks (heading / paragraph / list / table); the docx builder renders blocks to `mdocxengine` `Paragraph[]` (with `outlineLvl` on headings) plus `Table` objects inserted by index. Front matter, TOC, footers/section page-numbering, and citation rendering are separate focused modules so each stays testable.

**Tech Stack:** Node ESM + TypeScript; `mdocxengine` (local `file:../mdocxengine`); `marked` (new dep) for markdown lexing; Drizzle for loading the thesis tree + template. **No unit-test runner** — verify with `tsx` scripts that build a fixture thesis, export, and assert on the produced `.docx` (unzip + inspect `word/document.xml`), mirroring `scripts/test-export.ts` / `scripts/test-hierarchy.ts`.

**Repo:** `/Users/hamzasafwan/modakerati-server` (branch `feat/thesis-hierarchy-p0`, continuing — or a new `feat/thesis-docx-p1` branch; see Task 0).

**Audited engine facts this plan relies on (verified, not assumed):**
- `Table` (`src/core/files/table/index.ts`): `new Table(tableObject)`; no factory — build a `TableObject` literal `{ "w:tblGrid": { "w:gridCol": [{}…] }, "w:tr": [ { "w:tc": [ { "w:p": { "w:r": { "w:t": "…" } } } … ] } … ] }`. Methods: `setCellText(r,c,text)`, `setCellContent(r,c,text,{bold,alignment})`, `setHeaderRow(rowIdx,fill?)`, `setTableBorders({top,bottom,left,right,insideH,insideV})`, `setTableDirection(rtl)`, `setTableWidth(value,type)`.
- `DocumentManager.insertTable(table: Table, index?: number): Promise<void>` — writes directly to `word/document.xml`; tables and paragraphs share ONE body ordering; `index` is the position in that ordering; omit `index` to append.
- `DocumentManager.saveChanges(paragraphs: Paragraph[])` — rewrites the whole body from a Paragraph[]. **Ordering rule:** call `saveChanges(allParagraphs)` FIRST, then `insertTable(...)` for each table from **highest index to lowest** so earlier insertions don't shift later indices.
- `TableOfContentsManager.insertTOC(options: {headingDepth?, title?, includePageNumbers?, useHyperlinks?}, index=0)` — writes directly; populates from paragraph `outlineLvl`s (Word updates the field on open).
- `FootnoteManager.addFootnote(text): Promise<{id, run}>`, `createFootnoteRun(id)`; add the returned run to a `Paragraph` via `addRun(new Run(run))`.
- Page numbering (verified SUPPORTED): `FooterManager.addFooter(text, type?, xml?, {registerInSectPr?})` → `{footerPath, relId}`, `insertPageNumber(footerPath, {alignment:"center", format:"lowerRoman"|"decimal"})`, `formatPageNumbers({format, startAt})`; `SectionManager.setSectionFooter(sectionIndex, relId, type)`, `getSections()`, `setSectionLayout(idx, layout)`; `PageLayoutManager.insertBreak("nextPage", paragraphIndex)`.
- `StylesManager.addStyle(obj)`, `listStyles()`, `getStyle(id)`, `removeStyle(id)` — can ADD styles (e.g. `TOC1-3`, `Caption`) but cannot update in place (remove+re-add).
- Base template `assets/thesis-base.docx` defines: `Title`, `Heading1`–`Heading6`, `Strong`, `ListParagraph`, `Hyperlink`, `FootnoteReference`, `FootnoteText`. MISSING: `TOC1-3`, `Caption`, an explicit `Normal`, any part/divider style. Heading styles have NO `outlineLvl`. Page: A4 portrait, 1" margins, has a `sectPr`, no header/footer files.

**DEFERRED (explicitly out of P1 — flag, don't implement):**
- **Figure/image embedding** — no public API to place an image run from a `relId`. Render figures as a captioned placeholder paragraph (`[Figure: <alt>]` + caption) for now; real embedding is P1.x once the engine exposes a drawing-run helper.
- **Inline footnote citation markers in body prose** (التهميش numbered references mid-sentence) — requires the AI to author citation anchors in content. P1 renders the bibliography/references section formatted per `citationStyle`; inline-anchor wiring is a later sub-phase.

---

## Target output structure (what a correct export contains, in order)

1. **Page de garde** — université / faculté / département / filière / spécialité / diplôme / thème / auteur(s) / encadreur / jury / année universitaire (from `thesis.frontMatter`, falling back to `profile`), centered, on its own page.
2. **Remerciements**, **Dédicace** (if `template.frontMatter.remerciements/dedicace` and present on the thesis).
3. **Résumé / Abstract** block(s) from `thesis.resume[]` (each: body + keywords), per `template.frontMatter.resumeLanguages` and `resumePlacement` (front → here; back → before back cover).
4. **Sommaire** (generated TOC) + (later) lists of tables/figures.
5. **Body** — for each Section (Partie): a divider page (centered, large) → for each Chapter (Chapitre): `Heading1` → chapter markdown rendered (numbered `Heading2/3/4`, paragraphs, lists, tables). A Section may instead carry its own `content` (intro/conclusion).
6. **Bibliographie / Références** — formatted per `citationStyle` (`apa` list vs `footnote-ar` style list).
7. Page numbering: front matter = lowercase roman (i, ii…); body restarts at arabic 1; centered in footer.
8. RTL + right binding margin when `template.bindingSide === "right"` (Arabic); else left.

---

## Task 0: Branch + dependency + baseline

**Files:** `package.json` (add `marked`)

- [ ] **Step 1: Confirm branch + clean server tsc baseline**
```bash
cd /Users/hamzasafwan/modakerati-server && git status --short && git rev-parse --abbrev-ref HEAD && npx tsc --noEmit && echo "BASELINE_TSC_OK"
```
Expected: on `feat/thesis-hierarchy-p0` (P0 work present), `BASELINE_TSC_OK`. (If you prefer an isolated branch, `git checkout -b feat/thesis-docx-p1` first.)

- [ ] **Step 2: Add `marked`**
```bash
cd /Users/hamzasafwan/modakerati-server && npm install marked && node -e "console.log(require('marked/package.json').version)"
```
Expected: installs, prints a version (v12+). It's ESM-friendly; we import `{ marked, Lexer }` / token types from `"marked"`.

- [ ] **Step 3: Commit the dep**
```bash
cd /Users/hamzasafwan/modakerati-server
git add package.json package-lock.json
git commit -m "chore(server): add marked for markdown->docx parsing"
```

---

## Task 1: Markdown → render-blocks parser

**Files:**
- Create: `src/lib/md-blocks.ts`
- Test: `scripts/test-md-blocks.ts`

A pure function turning a chapter's markdown into an ordered, engine-agnostic block list. No mdocxengine here (keeps it unit-testable).

- [ ] **Step 1: Write the failing test**
```typescript
// scripts/test-md-blocks.ts
import { markdownToBlocks } from "../src/lib/md-blocks";

const md = `# Définitions
Le **soin** est important.

- a
- b

| H1 | H2 |
| --- | --- |
| x | y |

## Sous-titre
Texte.`;

const blocks = markdownToBlocks(md);
const kinds = blocks.map((b) => b.kind).join(",");
const ok =
  blocks[0].kind === "heading" && blocks[0].level === 1 && blocks[0].text.includes("Définitions") &&
  blocks[1].kind === "paragraph" &&
  blocks.some((b) => b.kind === "list") &&
  blocks.some((b) => b.kind === "table" && b.header.length === 2 && b.rows.length === 1 && b.rows[0][0] === "x") &&
  blocks.some((b) => b.kind === "heading" && b.level === 2);
console.log("kinds:", kinds);
console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run it, expect failure (module missing)**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-md-blocks.ts
```
Expected: error — cannot find `../src/lib/md-blocks`.

- [ ] **Step 3: Implement `src/lib/md-blocks.ts`**
```typescript
import { Lexer, type Tokens } from "marked";

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "quote"; text: string };

/** Strip markdown inline markup to plain text (bold/italic/code/links) for docx runs. */
function inlineText(s: string): string {
  return (s || "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .trim();
}

/** Parse a chapter's markdown into ordered, engine-agnostic blocks. */
export function markdownToBlocks(md: string): Block[] {
  const tokens = new Lexer().lex(md || "");
  const out: Block[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const level = Math.min(6, Math.max(1, h.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
        out.push({ kind: "heading", level, text: inlineText(h.text) });
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        out.push({ kind: "paragraph", text: inlineText(p.text) });
        break;
      }
      case "list": {
        const l = t as Tokens.List;
        out.push({ kind: "list", ordered: !!l.ordered, items: l.items.map((it) => inlineText(it.text)) });
        break;
      }
      case "table": {
        const tb = t as Tokens.Table;
        out.push({
          kind: "table",
          header: tb.header.map((c) => inlineText(c.text)),
          rows: tb.rows.map((r) => r.map((c) => inlineText(c.text))),
        });
        break;
      }
      case "blockquote": {
        const q = t as Tokens.Blockquote;
        out.push({ kind: "quote", text: inlineText(q.text) });
        break;
      }
      case "space":
      case "hr":
        break;
      default: {
        const raw = (t as any).text ?? (t as any).raw;
        if (typeof raw === "string" && raw.trim()) out.push({ kind: "paragraph", text: inlineText(raw) });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test, expect PASS**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-md-blocks.ts
```
Expected: `RESULT: PASS`.

- [ ] **Step 5: Commit**
```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/md-blocks.ts scripts/test-md-blocks.ts
git commit -m "feat(export): markdown -> render-blocks parser (marked lexer)"
```

---

## Task 2: docx primitives — heading with outline level + table builder

**Files:**
- Create: `src/lib/docx-blocks.ts` (renders `Block[]` → `{ paragraphs: Paragraph[]; tables: { afterParaCount: number; table: Table }[] }`)
- Test: `scripts/test-docx-blocks.ts`

This module owns the mdocxengine specifics for body blocks: heading paragraphs with `outlineLvl`, body paragraphs, list items, and `Table` construction. It records, for each table, how many paragraphs precede it (so the builder can compute insertion indices later).

- [ ] **Step 1: Write the failing test**
```typescript
// scripts/test-docx-blocks.ts
import { renderBlocks } from "../src/lib/docx-blocks";
import type { Block } from "../src/lib/md-blocks";

const blocks: Block[] = [
  { kind: "heading", level: 1, text: "A" },        // -> Heading2 (chapter content base)
  { kind: "paragraph", text: "para" },
  { kind: "table", header: ["H1", "H2"], rows: [["x", "y"]] },
  { kind: "heading", level: 2, text: "B" },        // -> Heading3
];

const { paragraphs, tables } = renderBlocks(blocks, { align: "both", rtl: false });
const ok =
  paragraphs.length >= 3 &&            // heading, para, heading (+ maybe blank); table not a paragraph
  tables.length === 1 &&
  typeof tables[0].afterParaCount === "number" &&
  tables[0].afterParaCount === 2;      // table comes after the heading + paragraph
console.log("paras:", paragraphs.length, "tables:", tables.length, "afterParaCount:", tables[0]?.afterParaCount);
console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run, expect failure**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-docx-blocks.ts
```

- [ ] **Step 3: Implement `src/lib/docx-blocks.ts`**
```typescript
import { Paragraph, Run, Table } from "mdocxengine";
import type { Block } from "./md-blocks";

type Align = "left" | "center" | "right" | "both";
export interface RenderCtx { align: Align; rtl: boolean; headingBase?: 2 | 3; }

/** Paragraph with an explicit outline level injected into pPr (so TOC can discover it). */
export function headingPara(text: string, styleId: string, outlineLvl: number, align: Align): Paragraph {
  const p = new Paragraph({ $: {}, "w:pPr": { "w:outlineLvl": { $: { "w:val": String(outlineLvl) } } }, "w:r": [] } as any);
  p.applyStyle(styleId);
  p.setAlignment(align);
  const run = Run.fromText(text);
  run.setBold();
  p.addRun(run);
  return p;
}

export function bodyPara(text: string, align: Align): Paragraph {
  const p = new Paragraph({ $: {}, "w:pPr": {}, "w:r": [] } as any);
  p.setAlignment(align);
  p.addRun(Run.fromText(text));
  return p;
}

function listPara(text: string, ordered: boolean, idx: number, align: Align): Paragraph {
  const bullet = ordered ? `${idx + 1}. ` : "• ";
  const p = new Paragraph({ $: {}, "w:pPr": {}, "w:r": [] } as any);
  p.applyStyle("ListParagraph");
  p.setAlignment(align);
  p.addRun(Run.fromText(bullet + text));
  return p;
}

function buildTable(header: string[], rows: string[][], rtl: boolean): Table {
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const mkRow = (cells: string[]) => ({
    "w:tc": Array.from({ length: cols }, (_, c) => ({ "w:p": { "w:r": { "w:t": cells[c] ?? "" } } })),
  });
  const tableObj: any = {
    "w:tblPr": {},
    "w:tblGrid": { "w:gridCol": Array.from({ length: cols }, () => ({})) },
    "w:tr": [mkRow(header), ...rows.map(mkRow)],
  };
  const t = new Table(tableObj);
  t.setHeaderRow(0);
  t.setTableBorders({
    top: { style: "single", size: 4, color: "808080" },
    bottom: { style: "single", size: 4, color: "808080" },
    left: { style: "single", size: 4, color: "808080" },
    right: { style: "single", size: 4, color: "808080" },
    insideH: { style: "single", size: 2, color: "BFBFBF" },
    insideV: { style: "single", size: 2, color: "BFBFBF" },
  });
  t.setTableWidth(100, "pct");
  if (rtl) t.setTableDirection(true);
  return t;
}

/**
 * Render chapter-content blocks. Headings map markdown level -> Word Heading
 * (base 2: md "#"->Heading2/outline1, "##"->Heading3/outline2, "###"->Heading4/outline3).
 * Tables are returned separately with the count of paragraphs that precede them.
 */
export function renderBlocks(blocks: Block[], ctx: RenderCtx): { paragraphs: Paragraph[]; tables: { afterParaCount: number; table: Table }[] } {
  const base = ctx.headingBase ?? 2;
  const paragraphs: Paragraph[] = [];
  const tables: { afterParaCount: number; table: Table }[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "heading": {
        const word = Math.min(6, base + (b.level - 1)); // md level 1 -> base
        paragraphs.push(headingPara(b.text, `Heading${word}`, word - 1, ctx.align));
        break;
      }
      case "paragraph":
        paragraphs.push(bodyPara(b.text, ctx.align));
        break;
      case "quote":
        paragraphs.push(bodyPara(b.text, ctx.align));
        break;
      case "list":
        b.items.forEach((it, i) => paragraphs.push(listPara(it, b.ordered, i, ctx.align)));
        break;
      case "table":
        tables.push({ afterParaCount: paragraphs.length, table: buildTable(b.header, b.rows, ctx.rtl) });
        break;
    }
  }
  return { paragraphs, tables };
}
```

- [ ] **Step 4: Run, expect PASS**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-docx-blocks.ts
```
Expected: `RESULT: PASS`. If `Table`/`Run`/`Paragraph` named exports differ, adjust imports to match `mdocxengine`'s actual exports (the audit confirmed `Paragraph`, `Run`, `Table` are all exported from the package root) and report.

- [ ] **Step 5: Commit**
```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/docx-blocks.ts scripts/test-docx-blocks.ts
git commit -m "feat(export): render blocks to docx paragraphs (outlineLvl headings) + tables"
```

---

## Task 3: Template profile loader + front-matter builder

**Files:**
- Modify: `src/lib/thesis-export.ts` (load the template row alongside the tree)
- Create: `src/lib/docx-frontmatter.ts`
- Test: `scripts/test-docx-frontmatter.ts`

- [ ] **Step 1: Extend `loadThesisTree` to include the template profile**
In `src/lib/thesis-export.ts`, after loading `thesis`, also load its template (or null) and add to the returned object + `ThesisTree` type:
```typescript
// add to imports: templates
const [template] = thesis.templateId
  ? await db.select().from(templates).where(eq(templates.id, thesis.templateId))
  : [null as any];
// ...add `template: template ?? null` to the returned object
// ...add `template: TemplateRow | null` to ThesisTree (type TemplateRow = typeof templates.$inferSelect)
```

- [ ] **Step 2: Write the failing test**
```typescript
// scripts/test-docx-frontmatter.ts
import { buildFrontMatter } from "../src/lib/docx-frontmatter";

const paras = buildFrontMatter({
  thesis: { title: "Mon Mémoire", language: "fr",
    frontMatter: { university: "Université d'Alger 1", supervisor: "Dr X", academicYear: "2025-2026", authors: ["Étudiant Y"] },
    resume: [{ language: "fr", body: "Résumé court.", keywords: ["a", "b"] }] } as any,
  profile: null,
  template: { frontMatter: { remerciements: false, dedicace: false, resumeLanguages: ["fr"], resumePlacement: "front", sommaire: true }, bindingSide: "left" } as any,
});
const text = paras.map((p: any) => p?.toString?.() ?? "").join(" ");
// We can't easily read paragraph text here; assert non-empty paragraph array + count > 5.
const ok = Array.isArray(paras) && paras.length >= 5;
console.log("frontmatter paras:", paras.length);
console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
```
(Asserting exact text from a Paragraph object is awkward; this test asserts the builder produces a sensible number of paragraphs. The end-to-end Task 6 test inspects real document.xml text.)

- [ ] **Step 3: Implement `src/lib/docx-frontmatter.ts`**
```typescript
import { Paragraph, Run } from "mdocxengine";

type Align = "left" | "center" | "right" | "both";
function p(text: string, opts: { bold?: boolean; size?: number; align?: Align } = {}): Paragraph {
  const par = new Paragraph({ $: {}, "w:pPr": {}, "w:r": [] } as any);
  par.setAlignment(opts.align ?? "center");
  const r = Run.fromText(text);
  if (opts.bold) r.setBold();
  if (opts.size) r.setFontSize(opts.size * 2);
  par.addRun(r);
  return par;
}
function blank(): Paragraph { return new Paragraph({ $: {}, "w:pPr": {}, "w:r": [] } as any); }

const LABELS: Record<string, Record<string, string>> = {
  fr: { supervisor: "Encadré par", author: "Présenté par", year: "Année universitaire", resume: "Résumé", keywords: "Mots-clés", thanks: "Remerciements", dedication: "Dédicace" },
  ar: { supervisor: "إشراف", author: "إعداد الطالب", year: "السنة الجامعية", resume: "ملخص", keywords: "الكلمات المفتاحية", thanks: "شكر وتقدير", dedication: "إهداء" },
  en: { supervisor: "Supervised by", author: "Presented by", year: "Academic year", resume: "Abstract", keywords: "Keywords", thanks: "Acknowledgements", dedication: "Dedication" },
};

export function buildFrontMatter(tree: { thesis: any; profile: any; template: any }): Paragraph[] {
  const { thesis, profile, template } = tree;
  const lang = (thesis.language || "fr") as "fr" | "ar" | "en";
  const L = LABELS[lang] ?? LABELS.fr;
  const fm = thesis.frontMatter ?? {};
  const tfm = template?.frontMatter ?? {};
  const out: Paragraph[] = [];

  // --- Page de garde ---
  const uni = fm.university ?? profile?.university;
  if (uni) out.push(p(uni, { bold: true, size: 14 }));
  if (fm.faculty) out.push(p(fm.faculty, { size: 12 }));
  if (fm.department ?? profile?.department) out.push(p(fm.department ?? profile.department, { size: 12 }));
  for (let i = 0; i < 5; i++) out.push(blank());
  out.push(p(thesis.title, { bold: true, size: 24 }));
  if (fm.specialty) out.push(p(fm.specialty, { size: 13 }));
  for (let i = 0; i < 4; i++) out.push(blank());
  const authors = (fm.authors ?? (profile?.fullName ? [profile.fullName] : [])).filter(Boolean);
  if (authors.length) out.push(p(`${L.author}: ${authors.join(" • ")}`, { size: 13 }));
  if (fm.supervisor) out.push(p(`${L.supervisor}: ${fm.supervisor}`, { size: 13 }));
  const year = fm.academicYear ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  out.push(p(`${L.year}: ${year}`, { size: 12 }));

  // --- Remerciements / Dédicace ---
  if (tfm.remerciements && fm.acknowledgements) { out.push(blank()); out.push(p(L.thanks, { bold: true, size: 16 })); out.push(p(fm.acknowledgements, { align: lang === "ar" ? "right" : "both" })); }
  if (tfm.dedicace && fm.dedication) { out.push(blank()); out.push(p(L.dedication, { bold: true, size: 16 })); out.push(p(fm.dedication, { align: lang === "ar" ? "right" : "both" })); }

  // --- Résumé(s) (front placement) ---
  if ((tfm.resumePlacement ?? "front") === "front") out.push(...buildResume(thesis, template, L, lang));
  return out;
}

export function buildResume(thesis: any, template: any, L: Record<string, string>, lang: string): Paragraph[] {
  const blocks = Array.isArray(thesis.resume) ? thesis.resume : [];
  const wanted: string[] = template?.frontMatter?.resumeLanguages ?? [lang];
  const out: Paragraph[] = [];
  for (const rb of blocks) {
    if (wanted.length && !wanted.includes(rb.language)) continue;
    const ll = LABELS[rb.language] ?? L;
    out.push(blank());
    out.push(p(ll.resume, { bold: true, size: 16, align: rb.language === "ar" ? "right" : "left" }));
    out.push(p(rb.body, { align: rb.language === "ar" ? "right" : "both" }));
    if (rb.keywords?.length) out.push(p(`${ll.keywords}: ${rb.keywords.join(", ")}`, { bold: true, align: rb.language === "ar" ? "right" : "left" }));
  }
  return out;
}
```

- [ ] **Step 4: Run the test, expect PASS**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-docx-frontmatter.ts
```

- [ ] **Step 5: Commit**
```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/thesis-export.ts src/lib/docx-frontmatter.ts scripts/test-docx-frontmatter.ts
git commit -m "feat(export): load template profile + build page de garde / résumé front matter"
```

---

## Task 4: Citation / bibliography rendering per style

**Files:**
- Modify: `src/lib/thesis-export.ts` (the existing `formatReference`/`referencesLabel` helpers — confirm signatures) OR create `src/lib/docx-references.ts`
- Test: `scripts/test-docx-references.ts`

- [ ] **Step 1: Write the failing test**
```typescript
// scripts/test-docx-references.ts
import { formatReferenceEntry } from "../src/lib/docx-references";
const apa = formatReferenceEntry({ author: "Smith, J.", year: "2020", title: "Methods", source: "Univ Press" } as any, "apa");
const fn = formatReferenceEntry({ author: "سميث", year: "2020", title: "المناهج", source: "دار النشر" } as any, "footnote-ar");
const ok = apa.includes("Smith") && apa.includes("2020") && fn.includes("المناهج");
console.log("apa:", apa, "\nfn:", fn);
console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run, expect failure**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-docx-references.ts
```

- [ ] **Step 3: Implement `src/lib/docx-references.ts`**
```typescript
type Ref = { author: string; year?: string | null; title: string; source?: string | null };

/** Format one bibliography entry per citation style. */
export function formatReferenceEntry(ref: Ref, style: "apa" | "footnote-ar"): string {
  const author = ref.author?.trim() || "—";
  const year = ref.year?.trim();
  const title = ref.title?.trim() || "";
  const source = ref.source?.trim();
  if (style === "footnote-ar") {
    // الكاتب، العنوان، دار النشر، السنة.
    return [author, title, source, year].filter(Boolean).join("، ") + ".";
  }
  // APA-ish: Author (Year). Title. Source.
  const parts = [author + (year ? ` (${year}).` : "."), title ? `${title}.` : "", source ? `${source}.` : ""];
  return parts.filter(Boolean).join(" ").trim();
}
```
(If `thesis-export.ts` already has a `formatReference`, keep it for backward compat but route the docx builder through `formatReferenceEntry` so style is honored.)

- [ ] **Step 4: Run, expect PASS**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-docx-references.ts
```

- [ ] **Step 5: Commit**
```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/docx-references.ts scripts/test-docx-references.ts
git commit -m "feat(export): citation entry formatting per style (apa | footnote-ar)"
```

---

## Task 5: Page-numbering + section helper (roman → arabic)

**Files:**
- Create: `src/lib/docx-pagination.ts`
- Test: covered by the Task 6 end-to-end test (this helper is hard to unit-test in isolation; verify via the produced docx)

- [ ] **Step 1: Implement `src/lib/docx-pagination.ts`**
```typescript
import type { Mdocxengine } from "mdocxengine";

/**
 * Front matter pages numbered lowerRoman (i, ii…); body restarts at arabic 1.
 * Both centered in the footer. `bodyStartParaIndex` = paragraph index where the
 * body section begins (a "nextPage" section break is inserted there).
 * Verified APIs: FooterManager.addFooter/insertPageNumber/formatPageNumbers,
 * SectionManager.getSections/setSectionFooter, PageLayoutManager.insertBreak.
 */
export async function applyRomanThenArabicNumbering(engine: Mdocxengine, bodyStartParaIndex: number): Promise<void> {
  const footer = engine.footer as any;
  const sectionMgr = engine.sections as any;
  const pageLayout = engine.pageLayout as any;

  // 1. Section break before the body so we have two sections (front matter | body).
  await pageLayout.insertBreak("nextPage", bodyStartParaIndex);

  // 2. Front-matter footer: lowercase roman, centered.
  const front = await footer.addFooter("", "default", undefined, { registerInSectPr: false });
  await footer.insertPageNumber(front.footerPath, { alignment: "center", format: "lowerRoman" });

  // 3. Body footer: decimal, centered, restart at 1.
  const body = await footer.addFooter("", "default", undefined, { registerInSectPr: false });
  await footer.insertPageNumber(body.footerPath, { alignment: "center", format: "decimal" });

  // 4. Attach footers per section + set formats/restart.
  const sections = await sectionMgr.getSections();
  if (sections.length >= 2) {
    await sectionMgr.setSectionFooter(0, front.relId, "default");
    await sectionMgr.setSectionFooter(1, body.relId, "default");
  }
  // Restart body numbering at 1 (formatPageNumbers targets the final/ body section).
  await footer.formatPageNumbers({ format: "decimal", startAt: 1 });
}
```
> NOTE: the exact per-section footer wiring is the riskiest engine interaction. Task 6's verification opens the produced `.docx` and checks numbering. If `setSectionFooter`/`formatPageNumbers` don't behave as the audit suggested, fall back to: body-only arabic numbering (skip roman front matter) and flag roman front-matter numbering as P1.x — do NOT block the whole export on it. Report which path you landed on.

- [ ] **Step 2: Type-check**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit 2>&1 | grep "docx-pagination" | head
```
Expected: no errors from `docx-pagination.ts`. (Casts to `any` are intentional where engine manager types aren't exported.)

- [ ] **Step 3: Commit**
```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/docx-pagination.ts
git commit -m "feat(export): roman front-matter -> arabic body page numbering helper"
```

---

## Task 6: Assemble the norm-compliant builder

**Files:**
- Modify: `src/lib/docx.ts` (`buildThesisDocxBuffer` — full rewrite of the body assembly; keep the `BuiltDoc` return shape)
- Test: `scripts/test-docx-norms.ts`

- [ ] **Step 1: Rewrite `buildThesisDocxBuffer`**
```typescript
import { fileURLToPath } from "url";
import { Mdocxengine, Paragraph, Run } from "mdocxengine";
import { loadThesisTree, referencesLabel, type BuiltDoc } from "./thesis-export";
import { markdownToBlocks } from "./md-blocks";
import { renderBlocks, headingPara, bodyPara } from "./docx-blocks";
import { buildFrontMatter, buildResume } from "./docx-frontmatter";
import { formatReferenceEntry } from "./docx-references";
import { applyRomanThenArabicNumbering } from "./docx-pagination";

const TEMPLATE_PATH = process.env.THESIS_DOCX_TEMPLATE || fileURLToPath(new URL("../../assets/thesis-base.docx", import.meta.url));

export async function buildThesisDocxBuffer(thesisId: string): Promise<BuiltDoc> {
  const tree = await loadThesisTree(thesisId);
  const { thesis, template } = tree as any;
  const lang = (thesis.language || "fr");
  const rtl = (template?.bindingSide === "right") || lang === "ar";
  const bodyAlign: "right" | "both" = rtl ? "right" : "both";
  const headAlign: "right" | "left" = rtl ? "right" : "left";

  const engine = await Mdocxengine.loadFromFile(TEMPLATE_PATH);

  const paras: Paragraph[] = [];
  // 1. Front matter (page de garde, remerciements, dédicace, résumé[front]).
  paras.push(...buildFrontMatter(tree as any));
  const frontMatterCount = paras.length;

  // 2. Body: sections (Partie) -> chapters (Chapitre) -> markdown blocks.
  const tableInserts: { afterParaCount: number; table: any }[] = [];
  for (const sec of tree.sections) {
    // Partie divider (centered, large, own page handled by Word via Heading1 + page break is optional).
    paras.push(headingPara(sec.title, "Heading1", 0, "center"));
    if (sec.content) {
      const r = renderBlocks(markdownToBlocks(sec.content), { align: bodyAlign, rtl, headingBase: 2 });
      r.tables.forEach((t) => tableInserts.push({ afterParaCount: paras.length + t.afterParaCount, table: t.table }));
      paras.push(...r.paragraphs);
    }
    for (const ch of sec.chapters) {
      paras.push(headingPara(ch.title, "Heading1", 0, headAlign));
      const r = renderBlocks(markdownToBlocks(ch.content || ""), { align: bodyAlign, rtl, headingBase: 2 });
      r.tables.forEach((t) => tableInserts.push({ afterParaCount: paras.length + t.afterParaCount, table: t.table }));
      paras.push(...r.paragraphs);
    }
  }

  // 3. Résumé (back placement).
  if (template?.frontMatter?.resumePlacement === "back") {
    paras.push(...buildResume(thesis, template, {} as any, lang));
  }

  // 4. Bibliographie / Références per citation style.
  if (tree.references.length) {
    const style = (template?.citationStyle === "footnote-ar" ? "footnote-ar" : "apa") as "apa" | "footnote-ar";
    paras.push(headingPara(referencesLabel(thesis.language), "Heading1", 0, headAlign));
    for (const ref of tree.references) paras.push(bodyPara(formatReferenceEntry(ref as any, style), bodyAlign));
  }

  // 5. Write body, then insert tables high-index -> low-index so indices stay valid.
  await engine.document.saveChanges(paras);
  for (const t of [...tableInserts].sort((a, b) => b.afterParaCount - a.afterParaCount)) {
    await engine.document.insertTable(t.table, t.afterParaCount);
  }

  // 6. Sommaire (TOC) at the top of the front matter region (after page de garde).
  try { await (engine.toc as any).insertTOC({ title: lang === "ar" ? "الفهرس" : "Sommaire", headingDepth: 3, useHyperlinks: true }, frontMatterCount); } catch (e) { console.warn("TOC insert skipped:", (e as any)?.message); }

  // 7. Page numbering: roman front matter -> arabic body (best-effort; see helper note).
  try { await applyRomanThenArabicNumbering(engine, frontMatterCount + 1); } catch (e) { console.warn("Pagination skipped:", (e as any)?.message); }

  await engine.metadata.setCoreProperties({ title: thesis.title, creator: "Modakerati", description: "Thesis exported from Modakerati", modified: new Date().toISOString() });

  const buffer = engine.zip.toBuffer();
  return { buffer, ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}
```
> Implementer judgment: the interplay of `saveChanges` + `insertTable` + `insertTOC` + `insertBreak` (all writing to `document.xml`) is the integration crux. Insert tables AFTER `saveChanges`. Insert the TOC and the section break AFTER tables (their indices refer to paragraph positions; if table insertion shifts the body, prefer inserting TOC/break relative to the FRONT region which precedes all tables, so `frontMatterCount` indices stay valid — front matter has no tables). If an ordering conflict surfaces, prefer correctness of the visible body over the TOC/pagination niceties and flag the degraded item.

- [ ] **Step 2: Write the end-to-end norms test**
```typescript
// scripts/test-docx-norms.ts
import "dotenv/config";
import AdmZip from "adm-zip"; // already a dep of mdocxengine; if not resolvable, use the unzip approach from test-export
import { eq } from "drizzle-orm";
import { db, profiles, theses, sections, chapters, references, templates } from "../src/db";
import { buildThesisDocxBuffer } from "../src/lib/docx";

async function main() {
  const [user] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!user) { console.error("No profiles"); process.exit(1); }
  const [tpl] = await db.insert(templates).values({
    university: "Univ Test", type: "Master", language: "fr", name: "T", discipline: "science",
    bindingSide: "left", citationStyle: "apa", bodyPreset: "imrad",
    frontMatter: { remerciements: true, dedicace: true, resumeLanguages: ["fr"], resumePlacement: "front", sommaire: true, listeTableaux: true, listeFigures: true, listeAbreviations: false, pageDeGarde: [] },
    structure: { sectionLabel: "Partie", chapterLabel: "Chapitre" }, styleMap: {}, chapterStructure: [],
  } as any).returning();
  const [thesis] = await db.insert(theses).values({
    userId: user.id, title: "Mémoire de Test", language: "fr", templateId: tpl.id,
    frontMatter: { university: "Université d'Alger 1", supervisor: "Dr Encadreur", authors: ["Étudiant"], academicYear: "2025-2026", acknowledgements: "Merci.", dedication: "À ma famille." },
    resume: [{ language: "fr", body: "Ceci est le résumé.", keywords: ["ia", "thèse"] }],
  } as any).returning();
  const [secT] = await db.insert(sections).values({ thesisId: thesis.id, title: "Partie Théorique", kind: "section", orderIndex: 0 }).returning();
  await db.insert(chapters).values({ sectionId: secT.id, title: "Chapitre 1", orderIndex: 0,
    content: "# Définitions\n\nLe soin est important.\n\n| Méthode | Score |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n\n## Détails\n\nTexte." });
  await db.insert(references).values({ thesisId: thesis.id, author: "Smith, J.", year: "2020", title: "Methods", source: "Univ Press" });

  try {
    const docx = await buildThesisDocxBuffer(thesis.id);
    const zip = new AdmZip(docx.buffer);
    const xml = zip.readAsText("word/document.xml");
    const checks = {
      validZip: docx.buffer[0] === 0x50 && docx.buffer[1] === 0x4b,
      hasTitle: xml.includes("Mémoire de Test"),
      hasPartie: xml.includes("Partie Théorique"),
      hasChapitre: xml.includes("Chapitre 1"),
      hasSubHeading: xml.includes("Définitions") && xml.includes("Détails"),
      hasOutline: xml.includes("w:outlineLvl"),
      hasTable: xml.includes("<w:tbl>") && xml.includes("Méthode") && xml.includes("Score"),
      hasResume: xml.includes("Ceci est le résumé") && xml.includes("ia, thèse"),
      hasRef: xml.includes("Smith") && xml.includes("2020"),
    };
    console.log(checks);
    const ok = Object.values(checks).every(Boolean);
    // Write to disk for manual Word inspection.
    require("fs").writeFileSync("/tmp/test-thesis-norms.docx", docx.buffer);
    console.log(`\nWrote /tmp/test-thesis-norms.docx\nRESULT: ${ok ? "PASS" : "FAIL"}`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await db.delete(theses).where(eq(theses.id, thesis.id));
    await db.delete(templates).where(eq(templates.id, tpl.id));
    process.exit(process.exitCode ?? 0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
(If `adm-zip` isn't directly importable, reuse the unzip-to-text approach already proven in `scripts/check-thesis-data.ts`/`test-export.ts`, or `import AdmZip from "adm-zip"` since mdocxengine depends on it.)

- [ ] **Step 3: Run, iterate to PASS**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-docx-norms.ts
```
Expected: all checks true, `RESULT: PASS`, and `/tmp/test-thesis-norms.docx` written. If a check fails, fix the corresponding builder piece and re-run. The table/outline/résumé/ref checks are the must-pass core; if TOC/pagination degrade (warnings printed), that's acceptable for P1 — note it.

- [ ] **Step 4: Type-check whole server**
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit && echo "TSC_OK"
```
Expected: `TSC_OK`.

- [ ] **Step 5: Commit**
```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/docx.ts scripts/test-docx-norms.ts
git commit -m "feat(export): assemble norm-compliant docx (front matter, partie/chapitre, headings, tables, TOC, refs, pagination)"
```

---

## Task 7: Manual fidelity check against a real thesis + LaTeX parity

**Files:** none (verification) + optional `src/lib/latex.ts` parity tweak

- [ ] **Step 1: Open the generated file in Word and verify norms**
Open `/tmp/test-thesis-norms.docx` in Microsoft Word (or LibreOffice). Confirm: page de garde on page 1; Partie/Chapitre as real headings; the markdown `#`/`##` rendered as Heading 2/3; the table rendered as a real Word table with a header row + borders; résumé + keywords present; references list present. Update the TOC field (right-click → Update Field) and confirm entries populate from the headings. Note any visual gap vs. the user's real theses in `~/Downloads` (e.g. `memoire qualite final.docx`).

- [ ] **Step 2: (Optional) bring LaTeX export to parity**
If desired, mirror the markdown rendering in `src/lib/latex.ts` so `.tex` export also renders sub-headings/tables (using `marked` blocks → `\subsection`, `tabular`). If skipped, leave a `// TODO(P1.x): latex markdown parity` note and report it. Not required for P1 done.

- [ ] **Step 3: Commit any latex change (if made)**
```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/latex.ts && git commit -m "feat(export): latex markdown parity (headings/tables)"
```

---

## Definition of done (P1)
- `buildThesisDocxBuffer` produces a document with: page de garde from front matter, résumé+keywords, Partie dividers, Chapitre Heading1, markdown sub-headings as Heading 2/3/4 with `outlineLvl`, **real Word tables** from markdown tables, a bibliography formatted per `citationStyle`, and (best-effort) a generated sommaire + roman→arabic page numbering.
- RTL + right binding margin when the profile is Arabic.
- `scripts/test-docx-norms.ts` core checks PASS; file opens correctly in Word.
- `npx tsc --noEmit` exits 0.

## Out of scope / flagged
- **Figure/image embedding** (no public engine API) — captioned placeholder only; revisit in P1.x.
- **Inline footnote citation anchors** in body prose — bibliography is styled now; inline التهميش anchors later.
- **Per-university binding-margin numeric values** and exact heading point sizes — P1 uses the base template's sizes + direct formatting; precise per-profile margins/sizes can be layered via `styleMap.headingSizes` + `SectionManager.setSectionLayout` in a follow-up.
- LaTeX markdown parity is optional (Task 7 Step 2).
