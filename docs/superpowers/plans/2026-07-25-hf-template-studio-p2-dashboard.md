# Header/Footer Template Studio — P2: Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/d/header-footer-templates` section to `modakerati-dashboard` — a visual editor where content staff design a header + footer (tab-stop lines *and* Word-class tables), an AI panel that drafts one from a prompt, and save = store the JSON model + server-compiled OOXML.

**Architecture:** Feature-first module (`src/features/hf-templates/`) cloned from the `news` feature. Rows are read/written directly via the Supabase service-role client (`createAdminClient`); the model→OOXML compile and the AI draft are the only calls to `modakerati-server` (P1's `/admin/hf-templates/compile` and `/generate`, reached through `src/lib/api/server.ts`). The `model` JSON is the source of truth; `header_ooxml`/`footer_ooxml`/`sect_pr` are cached on save.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), TypeScript, next-intl (en/fr/ar + RTL), react-hook-form, Tailwind v4, hand-rolled UI kit, Vitest.

**Depends on:** P1 (server) providing the `header_footer_templates` table and the `/admin/hf-templates/compile` + `/generate` endpoints. Tasks 1–8 (types/data/CRUD/wire-up/list) can be built and tsc-checked before P1 is deployed; save + AI (Tasks needing the endpoints) require P1 running for manual QA.

---

## ⚠️ Verification model (read first)

- **Type/build gate per task:** `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit` must be clean.
- **Unit tests (Vitest):** the repo runs `npm test` (= `vitest run`). Pure logic (the model helpers in `types.ts`, and the `access.ts` route map) gets real Vitest tests. UI components are verified by `npm run build` + manual QA, not unit tests (the repo has no component-test harness).
- **Manual QA** needs P1 running locally with `MODAKERATI_SERVER_URL` + `ADMIN_API_TOKEN` set in the dashboard `.env.local`, and the `header_footer_templates` table present (P1 Task 1).
- **Git (parallel-session safe):** `git add` the **exact paths only** — never `git add -A`/`.`. Fresh commits, never `--amend`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

**Create (feature):**
- `src/features/hf-templates/types.ts` — model + row types + `emptyModel`/helpers.
- `src/features/hf-templates/data.ts` — `listHfTemplates` / `getHfTemplate` (service-role reads).
- `src/features/hf-templates/index.ts` — barrel.
- `src/features/hf-templates/locales/{en,fr,ar}.json` — `hfTemplates` namespace.
- `src/features/hf-templates/components/hf-template-list.tsx` — DataTable list.
- `src/features/hf-templates/components/hf-template-editor.tsx` — orchestrator (owns model state).
- `src/features/hf-templates/components/options-panel.tsx` — template meta + options.
- `src/features/hf-templates/components/page-canvas.tsx` — WYSIWYG header/footer canvas.
- `src/features/hf-templates/components/element-palette.tsx` — insertable elements.
- `src/features/hf-templates/components/line-editor.tsx` — L/C/R paragraph block editor.
- `src/features/hf-templates/components/table-editor.tsx` — table block editor (cols/rows/cells/merges/shading/vAlign).
- `src/features/hf-templates/components/border-control.tsx` — 6-edge border picker.
- `src/features/hf-templates/components/ai-generate-panel.tsx` — prompt → draft.
- `src/features/hf-templates/components/ooxml-preview.tsx` — read-only compiled XML.

**Create (routes):**
- `src/app/d/header-footer-templates/{page,client,action}.tsx/ts`
- `src/app/d/header-footer-templates/new/{page,client}.tsx`
- `src/app/d/header-footer-templates/[id]/{page,client}.tsx`

**Modify (shared wire-up):**
- `src/lib/api/server.ts` — add `compileHfTemplate` + `generateHfTemplateAi` wrappers.
- `src/lib/auth/access.ts` — add route to `content_admin`.
- `src/lib/auth/access.test.ts` — add a `describe`/`it` for the new route.
- `src/components/sidebar.tsx` — add nav item to the `sidebar.content` group.
- `src/i18n/messages.ts` — register the 3 locale files.
- `src/i18n/messages/{en,fr,ar}.json` — add `sidebar.hfTemplates` label.

---

## Task 1: i18n namespace + sidebar labels

**Files:**
- Create: `src/features/hf-templates/locales/en.json`, `fr.json`, `ar.json`
- Modify: `src/i18n/messages/en.json`, `fr.json`, `ar.json` (the `sidebar` object)

- [ ] **Step 1: Create `src/features/hf-templates/locales/en.json`.**

```json
{
  "hfTemplates": {
    "title": "Header & Footer templates",
    "new": "New template",
    "columns": { "name": "Name", "language": "Language", "university": "University", "active": "Active" },
    "editor": {
      "name": "Template name",
      "language": "Language",
      "university": "University (optional)",
      "discipline": "Discipline (optional)",
      "header": "Header",
      "footer": "Footer",
      "firstPage": "First page",
      "addLine": "Add line",
      "addTable": "Add table",
      "removeBlock": "Remove block",
      "region": { "left": "Left", "center": "Center", "right": "Right" }
    },
    "options": {
      "title": "Options",
      "differentFirstPage": "Different first page",
      "rtl": "Right-to-left (Arabic)",
      "pageNumberFormat": "Page number format",
      "startAt": "Start at",
      "frontMatterRoman": "Roman front-matter → Arabic body",
      "formats": { "decimal": "1, 2, 3", "lowerRoman": "i, ii, iii", "upperRoman": "I, II, III" }
    },
    "elements": {
      "title": "Insert",
      "text": "Text", "pageNumber": "Page #", "totalPages": "of Total",
      "styleRef": "Chapter title", "docTitle": "Thesis title", "author": "Author",
      "university": "University", "date": "Date", "image": "Logo"
    },
    "table": {
      "columns": "Columns", "rows": "Rows", "addRow": "Add row", "removeRow": "Remove row",
      "columnWidths": "Column widths", "cell": "Cell",
      "align": "Align", "vAlign": "Vertical align",
      "vTop": "Top", "vCenter": "Middle", "vBottom": "Bottom",
      "shading": "Shading", "clearShading": "No fill",
      "merge": "Merge selected", "unmerge": "Unmerge"
    },
    "borders": {
      "title": "Borders",
      "top": "Top", "bottom": "Bottom", "left": "Left", "right": "Right",
      "insideH": "Inside —", "insideV": "Inside |",
      "style": "Style", "width": "Width", "color": "Color",
      "single": "Single", "double": "Double", "dashed": "Dashed", "dotted": "Dotted", "none": "None",
      "scopeTable": "Whole table", "scopeCell": "Selected cell"
    },
    "ai": {
      "title": "Generate with AI",
      "prompt": "Describe the header/footer",
      "block": "Structure", "line": "Line", "tableBlock": "Table",
      "columns": "Columns",
      "styles": "Available chapter-title styles",
      "generate": "Generate",
      "generating": "Generating…",
      "applied": "Draft loaded — edit and save",
      "error": "Generation failed"
    },
    "preview": { "title": "OOXML", "header": "Header part", "footer": "Footer part", "empty": "Save to compile the OOXML." },
    "actions": {
      "save": "Save", "saving": "Saving…", "saved": "Saved",
      "delete": "Delete", "confirmDelete": "Permanently delete this template? This cannot be undone.",
      "uploadLogo": "Uploading logo", "compileError": "Could not compile OOXML"
    }
  }
}
```

- [ ] **Step 2: Create `src/features/hf-templates/locales/fr.json`** (same keys, French values):

```json
{
  "hfTemplates": {
    "title": "Modèles d’en-tête et pied de page",
    "new": "Nouveau modèle",
    "columns": { "name": "Nom", "language": "Langue", "university": "Université", "active": "Actif" },
    "editor": {
      "name": "Nom du modèle", "language": "Langue", "university": "Université (facultatif)", "discipline": "Discipline (facultatif)",
      "header": "En-tête", "footer": "Pied de page", "firstPage": "Première page",
      "addLine": "Ajouter une ligne", "addTable": "Ajouter un tableau", "removeBlock": "Supprimer le bloc",
      "region": { "left": "Gauche", "center": "Centre", "right": "Droite" }
    },
    "options": {
      "title": "Options", "differentFirstPage": "Première page différente", "rtl": "De droite à gauche (arabe)",
      "pageNumberFormat": "Format du numéro de page", "startAt": "Commencer à", "frontMatterRoman": "Pages liminaires en romain → corps en arabe",
      "formats": { "decimal": "1, 2, 3", "lowerRoman": "i, ii, iii", "upperRoman": "I, II, III" }
    },
    "elements": {
      "title": "Insérer", "text": "Texte", "pageNumber": "N° de page", "totalPages": "sur Total",
      "styleRef": "Titre du chapitre", "docTitle": "Titre de la thèse", "author": "Auteur",
      "university": "Université", "date": "Date", "image": "Logo"
    },
    "table": {
      "columns": "Colonnes", "rows": "Lignes", "addRow": "Ajouter une ligne", "removeRow": "Supprimer la ligne",
      "columnWidths": "Largeurs des colonnes", "cell": "Cellule", "align": "Alignement", "vAlign": "Alignement vertical",
      "vTop": "Haut", "vCenter": "Milieu", "vBottom": "Bas", "shading": "Remplissage", "clearShading": "Aucun",
      "merge": "Fusionner", "unmerge": "Défusionner"
    },
    "borders": {
      "title": "Bordures", "top": "Haut", "bottom": "Bas", "left": "Gauche", "right": "Droite",
      "insideH": "Intérieur —", "insideV": "Intérieur |", "style": "Style", "width": "Épaisseur", "color": "Couleur",
      "single": "Simple", "double": "Double", "dashed": "Tirets", "dotted": "Pointillé", "none": "Aucune",
      "scopeTable": "Tout le tableau", "scopeCell": "Cellule sélectionnée"
    },
    "ai": {
      "title": "Générer avec l’IA", "prompt": "Décrivez l’en-tête / pied de page", "block": "Structure", "line": "Ligne", "tableBlock": "Tableau",
      "columns": "Colonnes", "styles": "Styles de titre disponibles", "generate": "Générer", "generating": "Génération…",
      "applied": "Brouillon chargé — modifiez et enregistrez", "error": "Échec de la génération"
    },
    "preview": { "title": "OOXML", "header": "Partie en-tête", "footer": "Partie pied de page", "empty": "Enregistrez pour compiler l’OOXML." },
    "actions": {
      "save": "Enregistrer", "saving": "Enregistrement…", "saved": "Enregistré", "delete": "Supprimer",
      "confirmDelete": "Supprimer définitivement ce modèle ? Action irréversible.", "uploadLogo": "Téléversement du logo", "compileError": "Impossible de compiler l’OOXML"
    }
  }
}
```

- [ ] **Step 3: Create `src/features/hf-templates/locales/ar.json`** (same keys, Arabic values):

```json
{
  "hfTemplates": {
    "title": "قوالب الترويسة والتذييل",
    "new": "قالب جديد",
    "columns": { "name": "الاسم", "language": "اللغة", "university": "الجامعة", "active": "مُفعّل" },
    "editor": {
      "name": "اسم القالب", "language": "اللغة", "university": "الجامعة (اختياري)", "discipline": "التخصص (اختياري)",
      "header": "الترويسة", "footer": "التذييل", "firstPage": "الصفحة الأولى",
      "addLine": "إضافة سطر", "addTable": "إضافة جدول", "removeBlock": "حذف الكتلة",
      "region": { "left": "يسار", "center": "وسط", "right": "يمين" }
    },
    "options": {
      "title": "خيارات", "differentFirstPage": "صفحة أولى مختلفة", "rtl": "من اليمين إلى اليسار (عربي)",
      "pageNumberFormat": "تنسيق رقم الصفحة", "startAt": "يبدأ من", "frontMatterRoman": "مقدمات بالأرقام الرومانية ← المتن بالعربية",
      "formats": { "decimal": "١، ٢، ٣", "lowerRoman": "i, ii, iii", "upperRoman": "I, II, III" }
    },
    "elements": {
      "title": "إدراج", "text": "نص", "pageNumber": "رقم الصفحة", "totalPages": "من الإجمالي",
      "styleRef": "عنوان الفصل", "docTitle": "عنوان الأطروحة", "author": "المؤلف",
      "university": "الجامعة", "date": "التاريخ", "image": "شعار"
    },
    "table": {
      "columns": "الأعمدة", "rows": "الصفوف", "addRow": "إضافة صف", "removeRow": "حذف صف",
      "columnWidths": "عرض الأعمدة", "cell": "خلية", "align": "المحاذاة", "vAlign": "المحاذاة العمودية",
      "vTop": "أعلى", "vCenter": "وسط", "vBottom": "أسفل", "shading": "تظليل", "clearShading": "بدون",
      "merge": "دمج", "unmerge": "إلغاء الدمج"
    },
    "borders": {
      "title": "الحدود", "top": "أعلى", "bottom": "أسفل", "left": "يسار", "right": "يمين",
      "insideH": "داخلي —", "insideV": "داخلي |", "style": "النمط", "width": "السماكة", "color": "اللون",
      "single": "مفرد", "double": "مزدوج", "dashed": "متقطع", "dotted": "منقّط", "none": "بدون",
      "scopeTable": "الجدول كامل", "scopeCell": "الخلية المحددة"
    },
    "ai": {
      "title": "توليد بالذكاء الاصطناعي", "prompt": "صف الترويسة / التذييل", "block": "البنية", "line": "سطر", "tableBlock": "جدول",
      "columns": "الأعمدة", "styles": "أنماط عناوين الفصول المتاحة", "generate": "توليد", "generating": "جارٍ التوليد…",
      "applied": "تم تحميل المسودة — عدّل واحفظ", "error": "فشل التوليد"
    },
    "preview": { "title": "OOXML", "header": "جزء الترويسة", "footer": "جزء التذييل", "empty": "احفظ لتوليد OOXML." },
    "actions": {
      "save": "حفظ", "saving": "جارٍ الحفظ…", "saved": "تم الحفظ", "delete": "حذف",
      "confirmDelete": "حذف هذا القالب نهائيًا؟ لا يمكن التراجع.", "uploadLogo": "جارٍ رفع الشعار", "compileError": "تعذّر توليد OOXML"
    }
  }
}
```

- [ ] **Step 4: Add the sidebar label** to `src/i18n/messages/en.json` inside the `"sidebar"` object (after `"universities"`): `"hfTemplates": "Headers & Footers",`. In `fr.json`: `"hfTemplates": "En-têtes & pieds de page",`. In `ar.json`: `"hfTemplates": "الترويسات والتذييلات",`. Edit surgically — insert the one key, keep the surrounding commas valid.

- [ ] **Step 5: Verify JSON parses.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && node -e "['src/features/hf-templates/locales/en.json','src/features/hf-templates/locales/fr.json','src/features/hf-templates/locales/ar.json','src/i18n/messages/en.json','src/i18n/messages/fr.json','src/i18n/messages/ar.json'].forEach(f=>require('./'+f)); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 6: Commit.**
```bash
git add src/features/hf-templates/locales src/i18n/messages/en.json src/i18n/messages/fr.json src/i18n/messages/ar.json
git commit -m "i18n(dashboard): hfTemplates namespace + sidebar label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Model types + helpers (with unit tests)

**Files:**
- Create: `src/features/hf-templates/types.ts`
- Create: `src/features/hf-templates/types.test.ts`

- [ ] **Step 1: Write the failing test** `src/features/hf-templates/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emptyModel, isMergedContinuation, normalizeColumnWidths } from "./types";

describe("hf-template model helpers", () => {
  it("emptyModel sets rtl true only for Arabic and gives empty header/footer", () => {
    expect(emptyModel("ar").options.rtl).toBe(true);
    expect(emptyModel("fr").options.rtl).toBe(false);
    expect(emptyModel("en").header.blocks).toEqual([]);
    expect(emptyModel("en").footer.blocks).toEqual([]);
    expect(emptyModel("en").version).toBe(1);
  });

  it("isMergedContinuation is true only for cells flagged merged", () => {
    expect(isMergedContinuation({ content: [], merged: true })).toBe(true);
    expect(isMergedContinuation({ content: [] })).toBe(false);
  });

  it("normalizeColumnWidths pads/truncates to the column count and sums ~100", () => {
    expect(normalizeColumnWidths([50, 50], 3)).toEqual([33, 33, 34]);
    expect(normalizeColumnWidths([25, 25, 25, 25], 2)).toEqual([50, 50]);
    const w = normalizeColumnWidths([], 4);
    expect(w).toHaveLength(4);
    expect(w.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx vitest run src/features/hf-templates/types.test.ts`
Expected: FAIL (module `./types` not found / exports missing).

- [ ] **Step 3: Write `src/features/hf-templates/types.ts`:**

```ts
// The header/footer template model. This shape is the SOURCE OF TRUTH and is
// mirrored 1:1 in modakerati-server (src/lib/hf-template-model.ts) — keep them in
// sync. Any change here needs the same change server-side.

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
  | { type: "image"; assetPath: string; assetUrl: string; widthPt: number; heightPt: number };

export type HfElementType = HfElement["type"];

export type HfAlign = "left" | "center" | "right";
export type HfVAlign = "top" | "center" | "bottom";

export type HfCell = {
  content: HfElement[];
  align?: HfAlign;
  vAlign?: HfVAlign;
  shading?: string; // hex fill, no leading '#'
  borders?: HfBorderSet;
  colSpan?: number;
  rowSpan?: number;
  merged?: boolean; // continuation cell absorbed by a colSpan/rowSpan — not emitted directly
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

// Row shape returned by data.ts (camelCase mirror of header_footer_templates).
export type HfTemplateRow = {
  id: string;
  name: string;
  language: HfLang;
  university: string | null;
  discipline: string | null;
  model: HfModel;
  headerOoxml: string | null;
  footerOoxml: string | null;
  sectPr: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export function emptyModel(lang: HfLang): HfModel {
  return {
    version: 1,
    options: {
      differentFirstPage: false,
      rtl: lang === "ar",
      pageNumber: { format: "decimal", startAt: 1 },
      frontMatterRoman: true,
    },
    header: { blocks: [] },
    footer: { blocks: [] },
  };
}

export function isMergedContinuation(cell: HfCell): boolean {
  return cell.merged === true;
}

// Force a column-width array to exactly `columns` entries summing to 100.
export function normalizeColumnWidths(widths: number[], columns: number): number[] {
  const base = widths.slice(0, columns);
  while (base.length < columns) base.push(Math.floor(100 / columns));
  const sum = base.reduce((a, b) => a + b, 0) || 1;
  const scaled = base.map((w) => Math.round((w / sum) * 100));
  // fix rounding drift onto the last column
  const drift = 100 - scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1] += drift;
  return scaled;
}

// A blank table with N columns, one row, even widths, no borders.
export function newTable(columns: number): HfTableBlock {
  const cols = Math.max(2, Math.min(6, columns));
  return {
    type: "table",
    columns: cols,
    columnWidths: normalizeColumnWidths([], cols),
    rows: [Array.from({ length: cols }, () => ({ content: [] as HfElement[], align: "center" as HfAlign }))],
  };
}

export function newLine(): HfParagraphBlock {
  return { type: "paragraph", left: [], center: [], right: [] };
}
```

- [ ] **Step 4: Run the test — expect PASS.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx vitest run src/features/hf-templates/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**
```bash
git add src/features/hf-templates/types.ts src/features/hf-templates/types.test.ts
git commit -m "feat(dashboard): hf-template model types + helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Data layer + barrel

**Files:**
- Create: `src/features/hf-templates/data.ts`
- Create: `src/features/hf-templates/index.ts`

- [ ] **Step 1: Write `src/features/hf-templates/data.ts`** (mirrors `news/data.ts`):

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { HfLang, HfModel, HfTemplateRow } from "./types";

const COLS =
  "id,name,language,university,discipline,model,header_ooxml,footer_ooxml,sect_pr,is_active,created_at,updated_at";

function mapRow(r: any): HfTemplateRow {
  return {
    id: r.id,
    name: r.name,
    language: r.language as HfLang,
    university: r.university,
    discipline: r.discipline,
    model: r.model as HfModel,
    headerOoxml: r.header_ooxml,
    footerOoxml: r.footer_ooxml,
    sectPr: r.sect_pr,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listHfTemplates(): Promise<HfTemplateRow[]> {
  const db = await createAdminClient();
  const { data } = await db
    .from("header_footer_templates")
    .select(COLS)
    .order("created_at", { ascending: false });
  return (data ?? []).map(mapRow);
}

export async function getHfTemplate(id: string): Promise<HfTemplateRow | null> {
  const db = await createAdminClient();
  const { data } = await db.from("header_footer_templates").select(COLS).eq("id", id).maybeSingle();
  return data ? mapRow(data) : null;
}
```

- [ ] **Step 2: Write `src/features/hf-templates/index.ts`:**

```ts
export * from "./types";
export * from "./data";
export { HfTemplateList } from "./components/hf-template-list";
export { HfTemplateEditor } from "./components/hf-template-editor";
```

Note: the barrel imports components created in Tasks 8–9; `tsc` will error until those exist. Build/verify this task's `tsc` only after Task 9, or temporarily comment the two component exports. Simplest: create empty stubs now —

- [ ] **Step 3: Create stub `src/features/hf-templates/components/hf-template-list.tsx`:**

```tsx
"use client";
import type { HfTemplateRow } from "../types";
export function HfTemplateList({ rows }: { rows: HfTemplateRow[] }) {
  return <div data-rows={rows.length} />;
}
```

- [ ] **Step 4: Create stub `src/features/hf-templates/components/hf-template-editor.tsx`:**

```tsx
"use client";
import type { HfTemplateRow } from "../types";
export function HfTemplateEditor({ mode, row }: { mode: "create" | "edit"; row?: HfTemplateRow }) {
  return <div data-mode={mode} data-id={row?.id} />;
}
```

- [ ] **Step 5: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/features/hf-templates/data.ts src/features/hf-templates/index.ts src/features/hf-templates/components/hf-template-list.tsx src/features/hf-templates/components/hf-template-editor.tsx
git commit -m "feat(dashboard): hf-template data layer + barrel (component stubs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Server API wrappers (compile + AI generate)

**Files:**
- Modify: `src/lib/api/server.ts`

- [ ] **Step 1: Append the two wrappers** to `src/lib/api/server.ts` (after `deleteThesisOnServer`). They reuse the existing module-private `adminFetch`:

```ts
// ---- Header/Footer template studio (server routes: /admin/hf-templates/*) ----

// Compiled OOXML bundle returned by the server converter (P1).
export type HfCompiled = {
  headerXml: string;
  footerXml: string;
  sectPr: string;
  media: { assetPath: string }[];
  warnings: string[];
};

// Compile a model → OOXML parts. Called on save so the row caches the XML.
export function compileHfTemplate(model: unknown) {
  return adminFetch<HfCompiled>("/admin/hf-templates/compile", {
    method: "POST",
    body: JSON.stringify({ model }),
  });
}

// AI-draft a model from a prompt + structure hint. Returns an unsaved model.
export function generateHfTemplateAi(body: {
  prompt: string;
  language: string;
  structureHint: { block: "line" | "table"; columns?: number; styles?: string[]; pageNumbers?: boolean };
}) {
  return adminFetch<{ model: unknown; warnings: string[] }>("/admin/hf-templates/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/lib/api/server.ts
git commit -m "feat(dashboard): server wrappers for hf-template compile + AI generate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Server actions (CRUD + compile-on-save + AI + logo upload)

**Files:**
- Create: `src/app/d/header-footer-templates/action.ts`

- [ ] **Step 1: Write `src/app/d/header-footer-templates/action.ts`:**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasStaffRole } from "@/lib/auth/staff";
import { compileHfTemplate, generateHfTemplateAi } from "@/lib/api/server";
import type { HfLang, HfModel } from "@/features/hf-templates/types";

const LOGO_BUCKET = process.env.HF_ASSETS_BUCKET ?? "hf-template-assets";
const ROUTE = "/d/header-footer-templates";

export type HfInput = {
  name: string;
  language: HfLang;
  university: string | null;
  discipline: string | null;
  model: HfModel;
  isActive: boolean;
};

// Compile the model to OOXML (via modakerati-server) and shape the DB row.
async function toRow(input: HfInput) {
  const compiled = await compileHfTemplate(input.model);
  return {
    name: input.name,
    language: input.language,
    university: input.university,
    discipline: input.discipline,
    model: input.model,
    header_ooxml: compiled.headerXml,
    footer_ooxml: compiled.footerXml,
    sect_pr: compiled.sectPr,
    is_active: input.isActive,
  };
}

export async function createHfTemplate(input: HfInput): Promise<string> {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  if (!input.name.trim()) throw new Error("Name is required");
  const db = await createAdminClient();
  const { data, error } = await db.from("header_footer_templates").insert(await toRow(input)).select("id").single();
  if (error) throw new Error(error.message);
  revalidatePath(ROUTE);
  return data.id as string;
}

export async function updateHfTemplate(id: string, input: HfInput): Promise<void> {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  const db = await createAdminClient();
  const { error } = await db
    .from("header_footer_templates")
    .update({ ...(await toRow(input)), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(ROUTE);
  revalidatePath(`${ROUTE}/${id}`);
}

export async function deleteHfTemplate(id: string): Promise<void> {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  const db = await createAdminClient();
  const { error } = await db.from("header_footer_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(ROUTE);
}

// AI draft — returns an unsaved model for the editor to load.
export async function generateHfTemplate(body: {
  prompt: string;
  language: HfLang;
  structureHint: { block: "line" | "table"; columns?: number; styles?: string[]; pageNumbers?: boolean };
}): Promise<{ model: HfModel; warnings: string[] }> {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  const res = await generateHfTemplateAi(body);
  return { model: res.model as HfModel, warnings: res.warnings };
}

// Upload a logo image to the public assets bucket; returns { path, url } for an image element.
export async function uploadHfLogo(formData: FormData): Promise<{ path: string; url: string }> {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) throw new Error("An image file is required");
  const db = await createAdminClient();
  const { data: bucket } = await db.storage.getBucket(LOGO_BUCKET);
  if (!bucket) await db.storage.createBucket(LOGO_BUCKET, { public: true });
  const ext = (file.name.toLowerCase().match(/\.(png|jpe?g|webp|gif|avif)$/)?.[0] ?? ".png").replace(".jpeg", ".jpg");
  const path = `${crypto.randomUUID()}${ext}`;
  const { error } = await db.storage.from(LOGO_BUCKET).upload(path, file, { upsert: false, contentType: file.type || "image/png" });
  if (error) throw new Error(error.message);
  return { path, url: db.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl };
}
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/app/d/header-footer-templates/action.ts
git commit -m "feat(dashboard): hf-template server actions (CRUD + compile-on-save + AI + logo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Routes (list / new / edit pages)

**Files:**
- Create: `src/app/d/header-footer-templates/page.tsx`, `client.tsx`
- Create: `src/app/d/header-footer-templates/new/page.tsx`, `client.tsx`
- Create: `src/app/d/header-footer-templates/[id]/page.tsx`, `client.tsx`

- [ ] **Step 1: `src/app/d/header-footer-templates/page.tsx`:**

```tsx
import { requirePathAccess } from "@/lib/auth/require-path";
import { listHfTemplates } from "@/features/hf-templates";
import HfTemplatesClient from "./client";

export const dynamic = "force-dynamic";

export default async function HfTemplatesPage() {
  await requirePathAccess("/d/header-footer-templates");
  const rows = await listHfTemplates();
  return <HfTemplatesClient rows={rows} />;
}
```

- [ ] **Step 2: `src/app/d/header-footer-templates/client.tsx`:**

```tsx
"use client";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui";
import { HfTemplateList } from "@/features/hf-templates/components/hf-template-list";
import type { HfTemplateRow } from "@/features/hf-templates/types";

export default function HfTemplatesClient({ rows }: { rows: HfTemplateRow[] }) {
  const t = useTranslations();
  return (
    <>
      <PageHeader title={t("hfTemplates.title")} />
      <HfTemplateList rows={rows} />
    </>
  );
}
```

- [ ] **Step 3: `src/app/d/header-footer-templates/new/page.tsx`:**

```tsx
import { requirePathAccess } from "@/lib/auth/require-path";
import NewHfTemplateClient from "./client";

export const dynamic = "force-dynamic";

export default async function NewHfTemplatePage() {
  await requirePathAccess("/d/header-footer-templates");
  return <NewHfTemplateClient />;
}
```

- [ ] **Step 4: `src/app/d/header-footer-templates/new/client.tsx`:**

```tsx
"use client";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/ui";
import { HfTemplateEditor } from "@/features/hf-templates/components/hf-template-editor";

export default function NewHfTemplateClient() {
  const t = useTranslations();
  return (
    <>
      <PageHeader title={t("hfTemplates.new")} />
      <HfTemplateEditor mode="create" />
    </>
  );
}
```

- [ ] **Step 5: `src/app/d/header-footer-templates/[id]/page.tsx`:**

```tsx
import { notFound } from "next/navigation";
import { requirePathAccess } from "@/lib/auth/require-path";
import { getHfTemplate } from "@/features/hf-templates";
import EditHfTemplateClient from "./client";

export const dynamic = "force-dynamic";

export default async function EditHfTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/d/header-footer-templates");
  const { id } = await params;
  const row = await getHfTemplate(id);
  if (!row) notFound();
  return <EditHfTemplateClient row={row} />;
}
```

- [ ] **Step 6: `src/app/d/header-footer-templates/[id]/client.tsx`:**

```tsx
"use client";
import { PageHeader } from "@/components/ui";
import { HfTemplateEditor } from "@/features/hf-templates/components/hf-template-editor";
import type { HfTemplateRow } from "@/features/hf-templates/types";

export default function EditHfTemplateClient({ row }: { row: HfTemplateRow }) {
  return (
    <>
      <PageHeader title={row.name} />
      <HfTemplateEditor mode="edit" row={row} />
    </>
  );
}
```

- [ ] **Step 7: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit.**
```bash
git add src/app/d/header-footer-templates/page.tsx src/app/d/header-footer-templates/client.tsx src/app/d/header-footer-templates/new src/app/d/header-footer-templates/[id]
git commit -m "feat(dashboard): hf-template routes (list/new/edit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire-up — access map, sidebar, i18n registration (with test)

**Files:**
- Modify: `src/lib/auth/access.ts`
- Modify: `src/lib/auth/access.test.ts`
- Modify: `src/components/sidebar.tsx`
- Modify: `src/i18n/messages.ts`

- [ ] **Step 1: Add the route to `content_admin`** in `src/lib/auth/access.ts` — change the `content_admin` line of `ROLE_ACCESS` to include the new prefix:

```ts
  content_admin: ["/d/news", "/d/notifications", "/d/templates", "/d/norm-profiles", "/d/knowledge", "/d/universities", "/d/header-footer-templates"],
```

- [ ] **Step 2: Add the access test** to `src/lib/auth/access.test.ts` inside the existing `describe("staff access map", …)` block:

```ts
  it("content_admin & super_admin reach header-footer-templates; other roles do not", () => {
    expect(canAccessPath("content_admin", "/d/header-footer-templates")).toBe(true);
    expect(canAccessPath("content_admin", "/d/header-footer-templates/123")).toBe(true);
    expect(canAccessPath("super_admin", "/d/header-footer-templates")).toBe(true);
    expect(canAccessPath("support_admin", "/d/header-footer-templates")).toBe(false);
    expect(canAccessPath("finance_admin", "/d/header-footer-templates")).toBe(false);
    expect(canAccessPath("platform_admin", "/d/header-footer-templates")).toBe(false);
  });
```

- [ ] **Step 3: Add the sidebar nav item** in `src/components/sidebar.tsx` — inside the `sidebar.content` group's `items` array, after the `templates` item:

```tsx
    { href: "/d/header-footer-templates", icon: "panel-top", labelKey: "sidebar.hfTemplates" },
```

- [ ] **Step 4: Register the locale files** in `src/i18n/messages.ts`. Add the three imports (next to the `features_news_*` imports):

```ts
import features_hf_templates_en from "@/features/hf-templates/locales/en.json";
import features_hf_templates_fr from "@/features/hf-templates/locales/fr.json";
import features_hf_templates_ar from "@/features/hf-templates/locales/ar.json";
```

Then append each to the matching array in `byLocale` (add `features_hf_templates_en` to the `en:` array, `_fr` to `fr:`, `_ar` to `ar:`).

- [ ] **Step 5: Run the access test — expect PASS.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx vitest run src/lib/auth/access.test.ts`
Expected: PASS (all existing + the new case).

- [ ] **Step 6: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/auth/access.ts src/lib/auth/access.test.ts src/components/sidebar.tsx src/i18n/messages.ts
git commit -m "feat(dashboard): wire hf-templates into access/sidebar/i18n

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: List component

**Files:**
- Modify: `src/features/hf-templates/components/hf-template-list.tsx` (replace the stub)

- [ ] **Step 1: Replace the stub** with the real list (mirrors `news-list.tsx`):

```tsx
"use client";

import { useMemo, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, Icon, type Column } from "@/components/ui";
import { deleteHfTemplate } from "@/app/d/header-footer-templates/action";
import type { HfTemplateRow } from "../types";

function DeleteButton({ id }: { id: string }) {
  const t = useTranslations("hfTemplates");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function onDelete(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm(t("actions.confirmDelete"))) return;
    startTransition(async () => {
      await deleteHfTemplate(id);
      router.refresh();
    });
  }
  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      aria-label={t("actions.delete")}
      className="inline-flex items-center justify-center rounded-lg p-1.5 text-danger hover:bg-card-hover transition-colors disabled:opacity-40 cursor-pointer"
    >
      <Icon name="trash-2" size={16} />
    </button>
  );
}

export function HfTemplateList({ rows }: { rows: HfTemplateRow[] }) {
  const t = useTranslations("hfTemplates");
  const router = useRouter();

  const columns: Column<HfTemplateRow>[] = useMemo(
    () => [
      {
        key: "name",
        label: t("columns.name"),
        render: (row) => (
          <Link href={`/d/header-footer-templates/${row.id}`} className="font-medium text-primary hover:underline">
            {row.name}
          </Link>
        ),
      },
      { key: "language", label: t("columns.language"), render: (row) => row.language.toUpperCase() },
      { key: "university", label: t("columns.university"), render: (row) => row.university || "—" },
      {
        key: "isActive",
        label: t("columns.active"),
        render: (row) =>
          row.isActive ? <Icon name="check" size={16} className="text-success" /> : <span className="text-subtext">—</span>,
      },
      {
        key: "actions",
        label: "",
        sortable: false,
        className: "text-end",
        render: (row) => (
          <div className="flex justify-end">
            <DeleteButton id={row.id} />
          </div>
        ),
      },
    ],
    [t]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button icon="plus" onClick={() => router.push("/d/header-footer-templates/new")}>
          {t("new")}
        </Button>
      </div>
      <DataTable columns={columns} data={rows} keyField="id" />
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc + build.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/features/hf-templates/components/hf-template-list.tsx
git commit -m "feat(dashboard): hf-template list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: BorderControl component

**Files:**
- Create: `src/features/hf-templates/components/border-control.tsx`

- [ ] **Step 1: Write `border-control.tsx`** — the 6-edge picker used by the table editor for table-scope and cell-scope borders:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Segmented } from "@/components/ui";
import type { HfBorderEdge, HfBorderSet, HfBorderStyle, HfEdgeName } from "../types";

const EDGES: HfEdgeName[] = ["top", "bottom", "left", "right", "insideH", "insideV"];
const STYLES: HfBorderStyle[] = ["single", "double", "dashed", "dotted"];
const WIDTHS = [0.5, 1, 1.5, 3];

const DEFAULT_EDGE: HfBorderEdge = { style: "single", widthPt: 1, color: "000000" };

export function BorderControl({
  value,
  onChange,
  showInside,
}: {
  value: HfBorderSet;
  onChange: (next: HfBorderSet) => void;
  showInside: boolean; // inside edges only make sense on a multi-cell table
}) {
  const t = useTranslations("hfTemplates.borders");
  const edges = showInside ? EDGES : EDGES.filter((e) => e !== "insideH" && e !== "insideV");

  function toggleEdge(edge: HfEdgeName) {
    const next = { ...value };
    if (next[edge]) delete next[edge];
    else next[edge] = { ...DEFAULT_EDGE };
    onChange(next);
  }

  // Apply a style/width/color change to every currently-on edge.
  function patchAll(patch: Partial<HfBorderEdge>) {
    const next: HfBorderSet = {};
    for (const e of EDGES) if (value[e]) next[e] = { ...value[e]!, ...patch };
    onChange(next);
  }

  const anyEdge = EDGES.find((e) => value[e]);
  const cur = anyEdge ? value[anyEdge]! : DEFAULT_EDGE;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-subtext">{t("title")}</div>
      <div className="flex flex-wrap gap-1.5">
        {edges.map((edge) => (
          <button
            key={edge}
            type="button"
            onClick={() => toggleEdge(edge)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              value[edge] ? "bg-primary text-white" : "bg-card text-subtext hover:bg-card-hover"
            }`}
          >
            {t(edge)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-subtext">
        {t("style")}
        <Segmented
          options={STYLES.map((s) => ({ value: s, label: t(s) }))}
          value={cur.style}
          onChange={(style) => patchAll({ style })}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-subtext">
        {t("width")}
        <Segmented
          options={WIDTHS.map((w) => ({ value: String(w), label: `${w}pt` }))}
          value={String(cur.widthPt)}
          onChange={(w) => patchAll({ widthPt: Number(w) })}
        />
        {t("color")}
        <input
          type="color"
          value={`#${cur.color}`}
          onChange={(e) => patchAll({ color: e.target.value.replace("#", "") })}
          className="h-6 w-8 rounded border border-border bg-card"
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/features/hf-templates/components/border-control.tsx
git commit -m "feat(dashboard): hf-template border control (6-edge picker)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: ElementPalette + LineEditor

**Files:**
- Create: `src/features/hf-templates/components/element-palette.tsx`
- Create: `src/features/hf-templates/components/line-editor.tsx`

- [ ] **Step 1: Write `element-palette.tsx`** — chips that build an `HfElement` for the active target (a line region or a cell):

```tsx
"use client";

import { useTranslations } from "next-intl";
import type { HfElement, HfElementType } from "../types";

const SIMPLE: Exclude<HfElementType, "text" | "styleRef" | "image">[] = [
  "pageNumber",
  "totalPages",
  "docTitle",
  "author",
  "university",
  "date",
];

export function ElementPalette({
  styles,
  onInsert,
  onInsertImage,
}: {
  styles: string[];
  onInsert: (el: HfElement) => void;
  onInsertImage: () => void; // triggers the file picker in the parent
}) {
  const t = useTranslations("hfTemplates.elements");
  const chip = "rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-text hover:bg-card-hover cursor-pointer";
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-subtext">{t("title")}</div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip} onClick={() => onInsert({ type: "text", value: t("text") })}>
          {t("text")}
        </button>
        {SIMPLE.map((type) => (
          <button key={type} type="button" className={chip} onClick={() => onInsert({ type } as HfElement)}>
            {t(type)}
          </button>
        ))}
        {styles.map((style) => (
          <button key={style} type="button" className={chip} onClick={() => onInsert({ type: "styleRef", style })}>
            {t("styleRef")} · {style}
          </button>
        ))}
        <button type="button" className={chip} onClick={onInsertImage}>
          {t("image")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `line-editor.tsx`** — edits a `paragraph` block's L/C/R regions; renders each element as a removable pill; a `text` element is editable inline:

```tsx
"use client";

import { useTranslations } from "next-intl";
import type { HfAlign, HfElement, HfParagraphBlock } from "../types";

const REGIONS: HfAlign[] = ["left", "center", "right"];

function elementLabel(el: HfElement, tEl: (k: string) => string): string {
  switch (el.type) {
    case "text": return el.value || tEl("text");
    case "styleRef": return `${tEl("styleRef")} · ${el.style}`;
    case "image": return tEl("image");
    default: return tEl(el.type);
  }
}

export function LineEditor({
  block,
  rtl,
  activeRegion,
  onFocusRegion,
  onChange,
}: {
  block: HfParagraphBlock;
  rtl: boolean;
  activeRegion: HfAlign | null;
  onFocusRegion: (r: HfAlign) => void;
  onChange: (next: HfParagraphBlock) => void;
}) {
  const t = useTranslations("hfTemplates.editor.region");
  const tEl = useTranslations("hfTemplates.elements");

  function setRegion(region: HfAlign, els: HfElement[]) {
    onChange({ ...block, [region]: els });
  }
  function removeAt(region: HfAlign, idx: number) {
    setRegion(region, block[region].filter((_, i) => i !== idx));
  }
  function editText(region: HfAlign, idx: number, value: string) {
    setRegion(region, block[region].map((el, i) => (i === idx && el.type === "text" ? { ...el, value } : el)));
  }

  const cols = rtl ? [...REGIONS].reverse() : REGIONS;

  return (
    <div className="grid grid-cols-3 gap-2" dir={rtl ? "rtl" : "ltr"}>
      {cols.map((region) => (
        <button
          key={region}
          type="button"
          onClick={() => onFocusRegion(region)}
          className={`min-h-14 rounded-lg border p-2 text-start transition-colors ${
            activeRegion === region ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-card-hover"
          }`}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase text-placeholder">{t(region)}</div>
          <div className="flex flex-wrap gap-1">
            {block[region].map((el, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {el.type === "text" ? (
                  <input
                    value={el.value}
                    onChange={(e) => editText(region, idx, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-20 bg-transparent outline-none"
                  />
                ) : (
                  elementLabel(el, tEl)
                )}
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(region, idx);
                  }}
                  className="cursor-pointer opacity-60 hover:opacity-100"
                >
                  ×
                </span>
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**
```bash
git add src/features/hf-templates/components/element-palette.tsx src/features/hf-templates/components/line-editor.tsx
git commit -m "feat(dashboard): hf-template element palette + line editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: TableEditor (cols/rows/cells/align/vAlign/shading/merge)

**Files:**
- Create: `src/features/hf-templates/components/table-editor.tsx`

- [ ] **Step 1: Write `table-editor.tsx`.** It renders the table grid, tracks a selected cell, and exposes cell content editing (via the palette in the parent), alignment, vAlign, shading, merge/unmerge, and per-cell/table borders (via `BorderControl`). Merged cells set `colSpan`/`rowSpan` on the anchor and mark absorbed cells `merged: true` (skipped when rendering + emitting).

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Segmented } from "@/components/ui";
import { BorderControl } from "./border-control";
import {
  isMergedContinuation,
  normalizeColumnWidths,
  type HfAlign,
  type HfCell,
  type HfElement,
  type HfTableBlock,
  type HfVAlign,
} from "../types";

export type CellPos = { row: number; col: number };

function blankCell(): HfCell {
  return { content: [], align: "center" };
}

// Rebuild rows for a new column count (pad/truncate each row), clearing merges.
function withColumns(block: HfTableBlock, columns: number): HfTableBlock {
  const rows = block.rows.map((r) => {
    const cells = r.filter((c) => !isMergedContinuation(c)).slice(0, columns).map((c) => ({ ...c, colSpan: 1, rowSpan: 1, merged: false }));
    while (cells.length < columns) cells.push(blankCell());
    return cells;
  });
  return { ...block, columns, columnWidths: normalizeColumnWidths(block.columnWidths, columns), rows };
}

export function TableEditor({
  block,
  selected,
  onSelectCell,
  onChange,
  elementSlot,
}: {
  block: HfTableBlock;
  selected: CellPos | null;
  onSelectCell: (pos: CellPos) => void;
  onChange: (next: HfTableBlock) => void;
  elementSlot: React.ReactNode; // the ElementPalette, wired by the parent to insert into the selected cell
}) {
  const t = useTranslations("hfTemplates.table");
  const tEl = useTranslations("hfTemplates.elements");

  const sel = selected && !isMergedContinuation(block.rows[selected.row]?.[selected.col] ?? blankCell()) ? selected : null;
  const cell = sel ? block.rows[sel.row][sel.col] : null;

  function patchCell(pos: CellPos, patch: Partial<HfCell>) {
    onChange({
      ...block,
      rows: block.rows.map((r, ri) => r.map((c, ci) => (ri === pos.row && ci === pos.col ? { ...c, ...patch } : c))),
    });
  }

  function addRow() {
    onChange({ ...block, rows: [...block.rows, Array.from({ length: block.columns }, blankCell)] });
  }
  function removeRow(ri: number) {
    if (block.rows.length <= 1) return;
    onChange({ ...block, rows: block.rows.filter((_, i) => i !== ri) });
  }

  // Merge the selected cell horizontally with the next non-merged cell in its row.
  function mergeRight() {
    if (!sel) return;
    const r = block.rows[sel.row];
    const anchor = r[sel.col];
    const span = anchor.colSpan ?? 1;
    const nextCol = sel.col + span;
    if (nextCol >= block.columns) return;
    onChange({
      ...block,
      rows: block.rows.map((row, ri) =>
        ri !== sel.row
          ? row
          : row.map((c, ci) => {
              if (ci === sel.col) return { ...c, colSpan: span + 1 };
              if (ci === nextCol) return { ...c, merged: true };
              return c;
            })
      ),
    });
  }
  function unmerge(pos: CellPos) {
    const anchor = block.rows[pos.row][pos.col];
    const span = anchor.colSpan ?? 1;
    onChange({
      ...block,
      rows: block.rows.map((row, ri) =>
        ri !== pos.row
          ? row
          : row.map((c, ci) => (ci >= pos.col && ci < pos.col + span ? { ...c, colSpan: 1, merged: false } : c))
      ),
    });
  }

  const cellStyle = (c: HfCell): React.CSSProperties => ({
    background: c.shading ? `#${c.shading}` : undefined,
    verticalAlign: c.vAlign === "top" ? "top" : c.vAlign === "bottom" ? "bottom" : "middle",
    textAlign: c.align ?? "center",
  });

  return (
    <div className="flex flex-col gap-3">
      {/* structure controls */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-subtext">
          {t("columns")}
          <Segmented
            options={[2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
            value={String(block.columns)}
            onChange={(v) => onChange(withColumns(block, Number(v)))}
          />
        </label>
        <button type="button" onClick={addRow} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-card-hover">
          + {t("addRow")}
        </button>
      </div>

      {/* the grid */}
      <table className="w-full table-fixed border-collapse">
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => {
                if (isMergedContinuation(c)) return null;
                const isSel = sel?.row === ri && sel?.col === ci;
                return (
                  <td
                    key={ci}
                    colSpan={c.colSpan ?? 1}
                    onClick={() => onSelectCell({ row: ri, col: ci })}
                    style={cellStyle(c)}
                    className={`h-14 cursor-pointer border p-2 text-xs ${isSel ? "border-primary outline outline-1 outline-primary" : "border-border"}`}
                  >
                    <div className="flex flex-wrap gap-1">
                      {c.content.map((el, i) => (
                        <span key={i} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          {el.type === "text" ? el.value || tEl("text") : el.type === "styleRef" ? `${tEl("styleRef")}` : tEl(el.type)}
                        </span>
                      ))}
                    </div>
                  </td>
                );
              })}
              <td className="w-8 align-middle">
                <button type="button" onClick={() => removeRow(ri)} aria-label={t("removeRow")} className="text-danger opacity-60 hover:opacity-100">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* table-scope borders */}
      <BorderControl value={block.borders ?? {}} onChange={(borders) => onChange({ ...block, borders })} showInside />

      {/* selected-cell controls */}
      {cell && sel && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-subtext">{t("cell")}</div>
          {elementSlot}
          <label className="flex items-center gap-2 text-xs text-subtext">
            {t("align")}
            <Segmented
              options={(["left", "center", "right"] as HfAlign[]).map((a) => ({ value: a, label: a[0].toUpperCase() }))}
              value={cell.align ?? "center"}
              onChange={(align) => patchCell(sel, { align })}
            />
            {t("vAlign")}
            <Segmented
              options={(["top", "center", "bottom"] as HfVAlign[]).map((v) => ({
                value: v,
                label: v === "top" ? t("vTop") : v === "bottom" ? t("vBottom") : t("vCenter"),
              }))}
              value={cell.vAlign ?? "center"}
              onChange={(vAlign) => patchCell(sel, { vAlign })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-subtext">
            {t("shading")}
            <input
              type="color"
              value={`#${cell.shading ?? "ffffff"}`}
              onChange={(e) => patchCell(sel, { shading: e.target.value.replace("#", "") })}
              className="h-6 w-8 rounded border border-border"
            />
            <button type="button" onClick={() => patchCell(sel, { shading: undefined })} className="text-xs text-subtext underline">
              {t("clearShading")}
            </button>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={mergeRight} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-card-hover">
              {t("merge")}
            </button>
            {(cell.colSpan ?? 1) > 1 && (
              <button type="button" onClick={() => unmerge(sel)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-card-hover">
                {t("unmerge")}
              </button>
            )}
          </div>
          <BorderControl value={cell.borders ?? {}} onChange={(borders) => patchCell(sel, { borders })} showInside={false} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/features/hf-templates/components/table-editor.tsx
git commit -m "feat(dashboard): hf-template table editor (cells/merge/shading/vAlign/borders)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: OptionsPanel + PageCanvas + OoxmlPreview

**Files:**
- Create: `src/features/hf-templates/components/options-panel.tsx`
- Create: `src/features/hf-templates/components/page-canvas.tsx`
- Create: `src/features/hf-templates/components/ooxml-preview.tsx`

- [ ] **Step 1: Write `options-panel.tsx`** — template meta (name/language/university/discipline) + model options:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Segmented } from "@/components/ui";
import { fInput, LANGS, type Lang } from "@/components/ui/primitives";
import type { HfModel, HfPageNumberFormat } from "../types";

const FORMATS: HfPageNumberFormat[] = ["decimal", "lowerRoman", "upperRoman"];

export function OptionsPanel({
  name, language, university, discipline, isActive, model,
  onMeta, onModel,
}: {
  name: string; language: Lang; university: string; discipline: string; isActive: boolean; model: HfModel;
  onMeta: (patch: Partial<{ name: string; language: Lang; university: string; discipline: string; isActive: boolean }>) => void;
  onModel: (next: HfModel) => void;
}) {
  const t = useTranslations("hfTemplates.editor");
  const tо = useTranslations("hfTemplates.options");

  function setOpt<K extends keyof HfModel["options"]>(key: K, value: HfModel["options"][K]) {
    onModel({ ...model, options: { ...model.options, [key]: value } });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-subtext">{t("name")}</span>
        <input className={fInput} value={name} onChange={(e) => onMeta({ name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-subtext">{t("language")}</span>
        <Segmented
          options={LANGS.map((l) => ({ value: l, label: l.toUpperCase() }))}
          value={language}
          onChange={(l) => {
            onMeta({ language: l });
            setOpt("rtl", l === "ar");
          }}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-subtext">{t("university")}</span>
        <input className={fInput} value={university} onChange={(e) => onMeta({ university: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-subtext">{t("discipline")}</span>
        <input className={fInput} value={discipline} onChange={(e) => onMeta({ discipline: e.target.value })} />
      </label>

      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-subtext">{tо("title")}</div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={model.options.differentFirstPage} onChange={(e) => setOpt("differentFirstPage", e.target.checked)} className="h-4 w-4 accent-primary" />
        {tо("differentFirstPage")}
      </label>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={model.options.rtl} onChange={(e) => setOpt("rtl", e.target.checked)} className="h-4 w-4 accent-primary" />
        {tо("rtl")}
      </label>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={model.options.frontMatterRoman} onChange={(e) => setOpt("frontMatterRoman", e.target.checked)} className="h-4 w-4 accent-primary" />
        {tо("frontMatterRoman")}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-subtext">{tо("pageNumberFormat")}</span>
        <Segmented
          options={FORMATS.map((f) => ({ value: f, label: tо(`formats.${f}`) }))}
          value={model.options.pageNumber.format}
          onChange={(format) => setOpt("pageNumber", { ...model.options.pageNumber, format })}
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={isActive} onChange={(e) => onMeta({ isActive: e.target.checked })} className="h-4 w-4 accent-primary" />
        <span className="text-sm text-text">{t("firstPage") /* reuse: "Active" label lives in columns.active; keep checkbox generic */}</span>
      </label>
    </div>
  );
}
```

Note: the `tо` identifier uses a Cyrillic "о" only to avoid clashing with `t`; if that reads oddly, rename to `to`/`opt` — just keep it distinct from `t`. Fix the last checkbox label to `t("... active")` using `useTranslations("hfTemplates.columns")("active")` if you prefer an "Active" label; the generic checkbox is functionally correct either way.

- [ ] **Step 2: Write `page-canvas.tsx`** — a read-only WYSIWYG render of a region's blocks (used to show header & footer as they'll look). Renders paragraph blocks as a 3-region row and table blocks as a bordered table:

```tsx
"use client";

import type { HfBorderEdge, HfBorderSet, HfCell, HfElement, HfRegion } from "../types";

function elText(el: HfElement): string {
  switch (el.type) {
    case "text": return el.value;
    case "pageNumber": return "1";
    case "totalPages": return "N";
    case "styleRef": return `‹${el.style}›`;
    case "docTitle": return "‹title›";
    case "author": return "‹author›";
    case "university": return "‹university›";
    case "date": return "‹date›";
    case "image": return "";
  }
}

function edgeCss(e?: HfBorderEdge): string | undefined {
  if (!e || e.style === "none") return undefined;
  const style = e.style === "double" ? "double" : e.style === "dashed" ? "dashed" : e.style === "dotted" ? "dotted" : "solid";
  return `${e.widthPt}px ${style} #${e.color}`;
}

function borderStyle(b?: HfBorderSet): React.CSSProperties {
  if (!b) return {};
  return {
    borderTop: edgeCss(b.top),
    borderBottom: edgeCss(b.bottom),
    borderLeft: edgeCss(b.left),
    borderRight: edgeCss(b.right),
  };
}

function Cell({ c, rtl }: { c: HfCell; rtl: boolean }) {
  return (
    <td
      colSpan={c.colSpan ?? 1}
      style={{
        ...borderStyle(c.borders),
        background: c.shading ? `#${c.shading}` : undefined,
        textAlign: c.align ?? "center",
        verticalAlign: c.vAlign === "top" ? "top" : c.vAlign === "bottom" ? "bottom" : "middle",
        padding: "6px 8px",
        fontSize: 10,
      }}
      dir={rtl ? "rtl" : "ltr"}
    >
      {c.content.map((el, i) => (el.type === "image" ? <span key={i} className="inline-block h-5 w-5 rounded border border-dashed border-border align-middle" /> : <span key={i}>{elText(el)} </span>))}
    </td>
  );
}

export function PageCanvas({ region, rtl, label }: { region: HfRegion; rtl: boolean; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3" dir={rtl ? "rtl" : "ltr"}>
      <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-primary">{label}</div>
      {region.blocks.length === 0 && <div className="text-[11px] text-placeholder">—</div>}
      {region.blocks.map((b, i) =>
        b.type === "paragraph" ? (
          <div key={i} className="flex justify-between gap-2 py-1 text-[10px] text-text">
            <span>{b.left.map(elText).join(" ")}</span>
            <span>{b.center.map(elText).join(" ")}</span>
            <span>{b.right.map(elText).join(" ")}</span>
          </div>
        ) : (
          <table key={i} className="my-1 w-full table-fixed border-collapse" style={borderStyle(b.borders)}>
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => (c.merged ? null : <Cell key={ci} c={c} rtl={rtl} />))}</tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `ooxml-preview.tsx`** — read-only compiled XML from the saved row:

```tsx
"use client";

import { useTranslations } from "next-intl";
import type { HfTemplateRow } from "../types";

export function OoxmlPreview({ row }: { row?: HfTemplateRow }) {
  const t = useTranslations("hfTemplates.preview");
  if (!row || (!row.headerOoxml && !row.footerOoxml)) {
    return <p className="text-sm text-subtext">{t("empty")}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase text-subtext">{t("header")}</div>
        <pre className="max-h-64 overflow-auto rounded-lg bg-[#2b2622] p-3 text-[11px] leading-relaxed text-[#e8ddcf]">{row.headerOoxml ?? "—"}</pre>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase text-subtext">{t("footer")}</div>
        <pre className="max-h-64 overflow-auto rounded-lg bg-[#2b2622] p-3 text-[11px] leading-relaxed text-[#e8ddcf]">{row.footerOoxml ?? "—"}</pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit.**
```bash
git add src/features/hf-templates/components/options-panel.tsx src/features/hf-templates/components/page-canvas.tsx src/features/hf-templates/components/ooxml-preview.tsx
git commit -m "feat(dashboard): hf-template options panel + canvas + ooxml preview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: AiGeneratePanel

**Files:**
- Create: `src/features/hf-templates/components/ai-generate-panel.tsx`

- [ ] **Step 1: Write `ai-generate-panel.tsx`** — collects prompt + structure hint, calls the `generateHfTemplate` action, and hands the returned model up to the editor:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button, Segmented } from "@/components/ui";
import { fInput, dirFor, type Lang } from "@/components/ui/primitives";
import { generateHfTemplate } from "@/app/d/header-footer-templates/action";
import type { HfModel } from "../types";

const STYLE_OPTIONS = ["Heading 1", "Heading 2"];

export function AiGeneratePanel({ language, onModel }: { language: Lang; onModel: (m: HfModel) => void }) {
  const t = useTranslations("hfTemplates.ai");
  const [prompt, setPrompt] = useState("");
  const [block, setBlock] = useState<"line" | "table">("table");
  const [columns, setColumns] = useState(3);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  function run() {
    setError(null);
    setApplied(false);
    startTransition(async () => {
      try {
        const { model } = await generateHfTemplate({
          prompt: prompt.trim(),
          language,
          structureHint: { block, columns: block === "table" ? columns : undefined, styles: STYLE_OPTIONS, pageNumbers: true },
        });
        onModel(model);
        setApplied(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-subtext">{t("title")}</div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-subtext">
          {t("block")}
          <Segmented
            options={[{ value: "table", label: t("tableBlock") }, { value: "line", label: t("line") }]}
            value={block}
            onChange={(v) => setBlock(v as "line" | "table")}
          />
        </label>
        {block === "table" && (
          <label className="flex items-center gap-2 text-xs text-subtext">
            {t("columns")}
            <Segmented options={[2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))} value={String(columns)} onChange={(v) => setColumns(Number(v))} />
          </label>
        )}
      </div>
      <textarea
        rows={4}
        className={`${fInput} resize-y`}
        dir={dirFor(language)}
        placeholder={t("prompt")}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="button" onClick={run} loading={pending} disabled={!prompt.trim()}>
          {pending ? t("generating") : t("generate")}
        </Button>
        {applied && !pending && <span className="text-sm text-success">{t("applied")}</span>}
        {error && <span className="text-sm text-danger">{t("error")}: {error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**
```bash
git add src/features/hf-templates/components/ai-generate-panel.tsx
git commit -m "feat(dashboard): hf-template AI generate panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Editor orchestrator (wires everything + save)

**Files:**
- Modify: `src/features/hf-templates/components/hf-template-editor.tsx` (replace the stub)

- [ ] **Step 1: Replace the stub** with the orchestrator. It owns `model` + meta state, renders the two regions (header/footer) with a block list, routes the selected block to `LineEditor` or `TableEditor`, wires the `ElementPalette` to the active target (line region or table cell), shows the `PageCanvas` previews, the `AiGeneratePanel`, and saves via the create/update actions.

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card } from "@/components/ui";
import type { Lang } from "@/components/ui/primitives";
import { createHfTemplate, updateHfTemplate, uploadHfLogo } from "@/app/d/header-footer-templates/action";
import {
  emptyModel, newLine, newTable,
  type HfAlign, type HfBlock, type HfElement, type HfModel, type HfRegion, type HfTemplateRow,
} from "../types";
import { OptionsPanel } from "./options-panel";
import { PageCanvas } from "./page-canvas";
import { LineEditor } from "./line-editor";
import { TableEditor, type CellPos } from "./table-editor";
import { ElementPalette } from "./element-palette";
import { AiGeneratePanel } from "./ai-generate-panel";

type RegionKey = "header" | "footer";
type Target =
  | { region: RegionKey; block: number; kind: "line"; area: HfAlign }
  | { region: RegionKey; block: number; kind: "cell"; pos: CellPos }
  | null;

const STYLES = ["Heading 1", "Heading 2"];

export function HfTemplateEditor({ mode, row }: { mode: "create" | "edit"; row?: HfTemplateRow }) {
  const t = useTranslations("hfTemplates");
  const tEditor = useTranslations("hfTemplates.editor");
  const router = useRouter();

  const [name, setName] = useState(row?.name ?? "");
  const [language, setLanguage] = useState<Lang>((row?.language as Lang) ?? "fr");
  const [university, setUniversity] = useState(row?.university ?? "");
  const [discipline, setDiscipline] = useState(row?.discipline ?? "");
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [model, setModel] = useState<HfModel>(row?.model ?? emptyModel((row?.language as Lang) ?? "fr"));
  const [target, setTarget] = useState<Target>(null);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const region = (k: RegionKey): HfRegion => model[k];
  function setRegion(k: RegionKey, next: HfRegion) {
    setModel((m) => ({ ...m, [k]: next }));
  }
  function setBlock(k: RegionKey, idx: number, next: HfBlock) {
    setRegion(k, { blocks: region(k).blocks.map((b, i) => (i === idx ? next : b)) });
  }
  function addBlock(k: RegionKey, block: HfBlock) {
    setRegion(k, { blocks: [...region(k).blocks, block] });
  }
  function removeBlock(k: RegionKey, idx: number) {
    setRegion(k, { blocks: region(k).blocks.filter((_, i) => i !== idx) });
    setTarget(null);
  }

  // Insert an element into whatever is currently targeted.
  function insertElement(el: HfElement) {
    if (!target) return;
    if (target.kind === "line") {
      const blk = region(target.region).blocks[target.block];
      if (blk.type !== "paragraph") return;
      setBlock(target.region, target.block, { ...blk, [target.area]: [...blk[target.area], el] });
    } else {
      const blk = region(target.region).blocks[target.block];
      if (blk.type !== "table") return;
      const { row: r, col: c } = target.pos;
      setBlock(target.region, target.block, {
        ...blk,
        rows: blk.rows.map((rr, ri) => rr.map((cc, ci) => (ri === r && ci === c ? { ...cc, content: [...cc.content, el] } : cc))),
      });
    }
  }

  async function pickLogo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      const { path, url } = await uploadHfLogo(fd);
      insertElement({ type: "image", assetPath: path, assetUrl: url, widthPt: 48, heightPt: 48 });
    };
    input.click();
  }

  function save() {
    setError(null);
    setSaved(false);
    const input = { name: name.trim(), language, university: university.trim() || null, discipline: discipline.trim() || null, model, isActive };
    startSave(async () => {
      try {
        if (mode === "create") {
          const id = await createHfTemplate(input);
          router.push(`/d/header-footer-templates/${id}`);
        } else {
          await updateHfTemplate(row!.id, input);
          setSaved(true);
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function RegionEditor({ k }: { k: RegionKey }) {
    const blocks = region(k).blocks;
    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-text">{k === "header" ? tEditor("header") : tEditor("footer")}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => addBlock(k, newLine())} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-card-hover">
              + {tEditor("addLine")}
            </button>
            <button type="button" onClick={() => addBlock(k, newTable(3))} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-card-hover">
              + {tEditor("addTable")}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {blocks.map((b, i) => (
            <div key={i} className="rounded-xl border border-border-subtle p-3">
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={() => removeBlock(k, i)} className="text-xs text-danger hover:underline">
                  {tEditor("removeBlock")}
                </button>
              </div>
              {b.type === "paragraph" ? (
                <LineEditor
                  block={b}
                  rtl={model.options.rtl}
                  activeRegion={target?.region === k && target.block === i && target.kind === "line" ? target.area : null}
                  onFocusRegion={(area) => setTarget({ region: k, block: i, kind: "line", area })}
                  onChange={(next) => setBlock(k, i, next)}
                />
              ) : (
                <TableEditor
                  block={b}
                  selected={target?.region === k && target.block === i && target.kind === "cell" ? target.pos : null}
                  onSelectCell={(pos) => setTarget({ region: k, block: i, kind: "cell", pos })}
                  onChange={(next) => setBlock(k, i, next)}
                  elementSlot={<ElementPalette styles={STYLES} onInsert={insertElement} onInsertImage={pickLogo} />}
                />
              )}
            </div>
          ))}
          {blocks.length === 0 && <p className="text-[11px] text-placeholder">—</p>}
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* editor column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <RegionEditor k="header" />
          <RegionEditor k="footer" />
          {/* palette for the active LINE region (tables carry their own palette in the cell panel) */}
          {target?.kind === "line" && (
            <Card>
              <ElementPalette styles={STYLES} onInsert={insertElement} onInsertImage={pickLogo} />
            </Card>
          )}
          <AiGeneratePanel language={language} onModel={(m) => setModel(m)} />
        </div>

        {/* side column: preview + options */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3">
              <PageCanvas region={model.header} rtl={model.options.rtl} label={tEditor("header")} />
              <PageCanvas region={model.footer} rtl={model.options.rtl} label={tEditor("footer")} />
            </div>
          </Card>
          <Card>
            <OptionsPanel
              name={name} language={language} university={university} discipline={discipline} isActive={isActive} model={model}
              onMeta={(p) => {
                if (p.name !== undefined) setName(p.name);
                if (p.language !== undefined) setLanguage(p.language);
                if (p.university !== undefined) setUniversity(p.university);
                if (p.discipline !== undefined) setDiscipline(p.discipline);
                if (p.isActive !== undefined) setIsActive(p.isActive);
              }}
              onModel={setModel}
            />
          </Card>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} loading={saving} disabled={!name.trim()}>
          {saving ? t("actions.saving") : t("actions.save")}
        </Button>
        {saved && !saving && <span className="text-sm text-success">{t("actions.saved")}</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc + build.** Run: `cd /Users/hamzasafwan/modakerati-dashboard && npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Commit.**
```bash
git add src/features/hf-templates/components/hf-template-editor.tsx
git commit -m "feat(dashboard): hf-template editor orchestrator + save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Full manual QA (needs P1 running)

**Files:** none (verification only). Requires: P1 deployed/running, `.env.local` has `MODAKERATI_SERVER_URL`, `ADMIN_API_TOKEN`, Supabase keys; `header_footer_templates` table present; signed in as a `content_admin`/`super_admin`.

- [ ] **Step 1:** `npm run dev`; confirm **Headers & Footers** appears in the sidebar under Content, and `/d/header-footer-templates` loads (empty list + "New template").
- [ ] **Step 2:** Create a template — set name, language = Arabic (canvas flips RTL), add a **table** block to the header, set 3 columns, put text in the outer cells + a **logo** in the middle cell, set a **bottom border** on the table; add a **footer line** with a centered **Page #**. Verify the canvas preview reflects each change (borders/shading/merge/logo).
- [ ] **Step 3:** Merge two header cells, set shading + vertical align on a cell; confirm the canvas renders the merge (spanned cell, absorbed cell hidden).
- [ ] **Step 4:** Save → confirm redirect to `/d/header-footer-templates/<id>`, the row exists in Supabase with `model` + non-null `header_ooxml`/`footer_ooxml`/`sect_pr`. Open the **OOXML preview** and confirm it shows `w:tbl`/`w:tblBorders`/`w:fldSimple`.
- [ ] **Step 5:** Reopen the row → confirm the canvas + editor **round-trip** from the stored model (same cells, borders, merges, options).
- [ ] **Step 6:** **AI generate** — type an Arabic letterhead prompt, choose Table/3, Generate → confirm the canvas populates with a drafted header/footer; tweak + save.
- [ ] **Step 7:** Switch dashboard language en/fr/ar → all editor labels re-localize; RTL layout correct. Delete the template from the list (confirm dialog) → row removed.
- [ ] **Step 8:** Commit any QA fixes (exact paths, fresh commits).

---

## Self-Review (author checklist — completed)

**Spec coverage:** dashboard section + routes (Tasks 6,7) · visual editor with L/C/R lines + tables (Tasks 10,11,14) · full table extras merge/shading/vAlign/logo (Tasks 11,14) · 6-edge borders per-table & per-cell (Task 9,11) · options incl. first-page/rtl/number-format/frontMatterRoman (Task 12) · JSON model source of truth + compile-on-save caching OOXML (Tasks 2,5) · AI generate returning the same model (Tasks 4,5,13) · logo bucket (Task 5) · role content_admin + wire-up (Task 7) · single-language per template (Tasks 2,12) · OOXML preview (Task 12). ✅

**Placeholder scan:** every step ships real code; the one flagged spot (OptionsPanel `tо`/last checkbox label) is an explicit rename note, not a missing implementation. ✅

**Type consistency:** `HfModel`/`HfBlock`/`HfCell`/`HfElement`/`HfBorderSet`, `emptyModel`/`newLine`/`newTable`/`normalizeColumnWidths`/`isMergedContinuation`, `createHfTemplate`/`updateHfTemplate`/`deleteHfTemplate`/`generateHfTemplate`/`uploadHfLogo`, `compileHfTemplate`/`generateHfTemplateAi`, and the `/d/header-footer-templates` route string are used identically across tasks. The server-wrapper `HfInput`/`HfCompiled` shapes match P1's endpoint contract. ✅

**Cross-plan dependency:** Tasks 5/13 call P1's `/admin/hf-templates/compile` + `/generate`; the request/response shapes here (`{model}` → `{headerXml,footerXml,sectPr,media,warnings}`; `{prompt,language,structureHint}` → `{model,warnings}`) are P1's contract — keep them in lockstep.
