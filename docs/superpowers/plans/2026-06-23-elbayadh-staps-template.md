# Nour Bachir El Bayadh — Master STAPS Template

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. A faithful reproduction of the official El Bayadh sport-science (STAPS) Master template: exact page de garde (real logo banner + institutional lines + jury table), the exact body structure, and the exact formatting (Sakkal Majal / Times New Roman / APA / RTL).

**Goal:** Ship a pickable template "نور بشير البيض — ماستر علوم وتقنيات النشاطات البدنية والرياضية" whose generated `.docx` reproduces the official page de garde (with the real logo) and whose wizard plan pre-populates the official structure, formatted to the official norms.

**Branch:** `feat/thesis-hierarchy-p0` (continue), both repos.

**Assets ready:** `~/modakerati-server/assets/templates/elbayadh-staps-header.png` (the real 1290×265 header banner: Nour Bachir logos + «وزارة التعليم العالي والبحث العلمي / المركز الجامعي نور بشير البيض», extracted from the user's PDF/.docx). The full template source is also saved at `assets/templates/elbayadh-staps-template.docx` (reference only).

**Verified engine facts:** `engine.media.insertImage(buf,"png") → {relId}` + `engine.shapes.insertImage(relId,{width,height,paragraphIndex})` (EMU) place an inline image (P7b). `engine.document.insertTable(table, index)` inserts a table post-saveChanges. The export (`buildThesisDocxBuffer`) builds `paras`, `saveChanges(paras)`, then inserts tables+images by descending index. `docx-blocks` has `buildTable(header, rows, rtl)` + caption/heading helpers. `Run` supports `setBold/setItalic/setFontSize`; font family is set via the run's `rPr → w:rFonts` (confirm the exact API on `Run`; if no setter, inject `"w:rFonts": { $: { "w:ascii": font, "w:cs": font, "w:hAnsi": font } }` into the run rPr).

**Exact page de garde content (from the official template):**
- Header banner image (full width, centered).
- `معهد العلوم الإنسانية والاجتماعية`
- `قسم علوم وتقنيات النشاطات البدنية والرياضية`
- `فرع: تدريب رياضي`
- `تخصص: تدريب رياضي نخبوي`
- `مذكرة مقدمة ضمن متطلبات نيل شهادة الماستر في علوم وتقنيات النشاطات البدنية والرياضية`
- **Title** (centered, bold) — from `thesis.frontMatter.theme || thesis.title`.
- `من اعداد الطلبة الباحثين:` + authors (from `frontMatter.authors`)
- `تحت إشراف:` + `frontMatter.supervisor` (prefix `د/`)
- `أعضاء لجنة المناقشة` + jury table: header `[الاسم واللقب | الرتبة العلمية | الصفة]`, rows: `["", "", "رئيسا"]`, `["", "", "مشرفا ومقررا"]`, `["", "", "عضوا"]` (the names are left blank to fill, matching the template).
- Academic year line: `السنة الجامعية: <year>`.

**Exact body structure (sections → chapters), from the official قائمة المحتويات:**
```
[Section] الإطار المنهجي (kind: introduction)
  └─ (chapter) الفصل التمهيدي: التعريف بالبحث
[Section] الدراسة النظرية (kind: section)
  ├─ (chapter) الفصل الأول: عرض الدراسات السابقة والمشابهة والتعليق عليها
  └─ (chapter) الفصل الثاني: الخلفية النظرية للبحث
[Section] الدراسة التطبيقية (kind: section)
  ├─ (chapter) الفصل الأول: منهج البحث وإجراءاته الميدانية
  └─ (chapter) الفصل الثاني: عرض وتحليل ومناقشة نتائج البحث
[Section] الخاتمة والمراجع (kind: conclusion)
  └─ (chapter) الخاتمة العامة
```
Each chapter's `content` may be pre-seeded with the official sub-headings as a markdown skeleton (e.g. for الفصل التمهيدي: `# إشكالية البحث`, `# الفرض العام`, `# الهدف العام`, `# أهمية البحث`, `# المفاهيم والمصطلحات`) so the workspace shows the official outline to fill. (Optional but recommended — include at least the التمهيدي + التطبيقي skeletons.)

**Formatting (config):** paperSize A4; margins 2.5 cm all; Arabic font `Sakkal Majal` (titles 18 bold, body 16); Latin font `Times New Roman` (titles 14 bold, body 12); RTL; bindingSide right; citationStyle `apa`; line spacing 1.5; first-line indent.

---

## Task 1 (server): schema + seed the El Bayadh profile

**Files:** `src/db/schema.ts` (+ `bodyStructure jsonb` + `coverTemplate text` on `templates`), `src/db/index.ts` (ensureSchema ALTERs + add to seedTemplates), test.

- [ ] Add to `templates`: `bodyStructure jsonb default '[]'` (nested sections→chapters) and `coverTemplate text` (e.g. `"elbayadh-staps"` to select a custom cover renderer; null = generic cover). Add matching `ALTER TABLE templates ADD COLUMN IF NOT EXISTS ...` to `ensureSchema`.
- [ ] In `seedTemplates()`, add the El Bayadh profile (insert it even if other templates exist — guard by checking a row with this exact name/university doesn't already exist, so it's added once):
```typescript
{ university: "المركز الجامعي نور بشير البيض", type: "memoire_master", language: "ar",
  name: "ماستر علوم وتقنيات النشاطات البدنية والرياضية — نور بشير البيض",
  discipline: "science", bindingSide: "right", citationStyle: "apa", bodyPreset: "law-humanities",
  coverTemplate: "elbayadh-staps",
  config: { paperSize: "A4", lineSpacing: "1.5", margins: { top: "2.5cm", bottom: "2.5cm", left: "2.5cm", right: "2.5cm" }, bodyFont: "Sakkal Majal", bodySize: "16", headingFont: "Sakkal Majal", latinFont: "Times New Roman" },
  frontMatter: { pageDeGarde: ["institute","department","branch","specialty","theme","authors","supervisor","jury","academicYear"], ficheSynoptique: false, remerciements: true, dedicace: true, resumeLanguages: ["ar","en"], resumePlacement: "front", sommaire: true, listeTableaux: true, listeFigures: true, listeAbreviations: false,
    institute: "معهد العلوم الإنسانية والاجتماعية", department: "قسم علوم وتقنيات النشاطات البدنية والرياضية", branch: "تدريب رياضي", specialty: "تدريب رياضي نخبوي",
    submissionLine: "مذكرة مقدمة ضمن متطلبات نيل شهادة الماستر في علوم وتقنيات النشاطات البدنية والرياضية" },
  structure: { sectionLabel: "قسم", chapterLabel: "فصل" },
  styleMap: { section: "Heading1", chapter: "Heading1", contentHeadings: ["Heading2","Heading3","Heading4"], useDirectFormatting: true, headingSizes: { title: 18, body: 16 } },
  bodyStructure: [
    { title: "الإطار المنهجي", kind: "introduction", chapters: [ { title: "الفصل التمهيدي: التعريف بالبحث", content: "# إشكالية البحث\n\n# الفرض العام\n\n# الهدف العام\n\n# أهمية البحث\n\n# المفاهيم والمصطلحات المستخدمة في البحث\n" } ] },
    { title: "الدراسة النظرية", kind: "section", chapters: [ { title: "الفصل الأول: عرض الدراسات السابقة والمشابهة والتعليق عليها", content: "# تمهيد\n\n# عرض الدراسات السابقة والمشابهة\n\n# التعليق على الدراسات\n\n# أوجه الاستفادة\n\n# خلاصة الفصل\n" }, { title: "الفصل الثاني: الخلفية النظرية للبحث", content: "# تمهيد\n\n# المتغير الأول\n\n# المتغير الثاني\n\n# خلاصة الفصل\n" } ] },
    { title: "الدراسة التطبيقية", kind: "section", chapters: [ { title: "الفصل الأول: منهج البحث وإجراءاته الميدانية", content: "# تمهيد\n\n# الدراسة الاستطلاعية\n\n# المنهج العلمي المتبع\n\n# مجتمع البحث\n\n# عينة البحث\n\n# مجالات البحث\n\n# أدوات جمع البيانات\n\n# الأسس العلمية لأدوات البحث\n\n# الوسائل الإحصائية\n" }, { title: "الفصل الثاني: عرض وتحليل ومناقشة نتائج البحث", content: "# عرض وتحليل النتائج\n\n# مناقشة الفرضيات\n\n# الاستنتاجات والتوصيات\n" } ] },
    { title: "الخاتمة العامة", kind: "conclusion", chapters: [] },
  ],
  chapterStructure: ["الإطار المنهجي","الدراسة النظرية","الدراسة التطبيقية","الخاتمة العامة"], isActive: true }
```
- [ ] Test: seed (or upsert) it; `db.select` it; assert `coverTemplate==="elbayadh-staps"` and `bodyStructure.length===4`. tsc 0. Commit.

## Task 2 (server): El Bayadh cover renderer + wire into export

**Files:** Create `src/lib/docx-cover-elbayadh.ts`; modify `src/lib/docx.ts`.

- [ ] `docx-cover-elbayadh.ts`: export `buildElBayadhCover(tree) → { paragraphs: Paragraph[]; banner: { afterParaCount: number; png: Buffer; widthEmu: number; heightEmu: number } | null; juryTable: { afterParaCount: number; table: Table } | null }`. Build:
  - banner: read `assets/templates/elbayadh-staps-header.png` (fs); record it as an image insert at paragraph index 0 (full width: A4 content ~17cm; the banner is 1290×265 px → keep aspect; width ≈ 6.0in = 5_486_400 EMU, height = 5_486_400 * 265/1290).
  - centered Arabic paragraphs (Sakkal Majal): institute, department, `فرع: تدريب رياضي`, `تخصص: تدريب رياضي نخبوي`, submissionLine, blanks, the title (bold, larger), blanks, `من اعداد الطلبة الباحثين: …`, `تحت إشراف: د/ …`, `السنة الجامعية: …`, `أعضاء لجنة المناقشة` (bold, centered).
  - jury table via `buildTable(["الاسم واللقب","الرتبة العلمية","الصفة"], [["","","رئيسا"],["","","مشرفا ومقررا"],["","","عضوا"]], true)` recorded at its paragraph index.
  - All Arabic runs use font `Sakkal Majal` (set rFonts), right/center aligned, RTL.
- [ ] In `buildThesisDocxBuffer`: if `template?.coverTemplate === "elbayadh-staps"`, use `buildElBayadhCover` for the cover region (its paragraphs replace the generic `coverPage`; collect its banner image + jury table into the same post-saveChanges `imageInserts`/`tableInserts` (offset correctly), and add a page break after the cover before the body. Otherwise keep the generic cover.
- [ ] Extend `scripts/test-docx-norms.ts` (or a new `scripts/test-elbayadh.ts`): build a thesis whose template has `coverTemplate==="elbayadh-staps"`; assert the docx has a `word/media/*.png` (the banner), a `<w:tbl>` (jury), and the institutional text (`معهد العلوم`, `تدريب رياضي نخبوي`). Write `/tmp/test-elbayadh.docx`. Run → PASS. tsc 0. Commit.

## Task 3 (server): generate-plan uses the template's fixed structure

**Files:** `src/lib/thesis-plan.ts` and/or `src/routes/thesis.ts`.

- [ ] `generate-plan` accepts an optional `templateId`; if the template has a non-empty `bodyStructure`, RETURN it directly (no AI call) so the wizard pre-populates the official outline. Otherwise fall back to the AI generator. (Add `templateId` to the request + look up the template.) Commit.

## Task 4 (app): wire the template into the wizard

**Files:** `lib/api.ts` (Template type + generateThesisPlan passes templateId), `app/(app)/template-preview.tsx`.

- [ ] `Template` type: add `bodyStructure?: { title; kind; chapters: {title; content?}[] }[]` and `coverTemplate?: string`. `generateThesisPlan` already takes a shape — ensure `templateId` is passed (from `template.id`).
- [ ] `template-preview.tsx` "Use this template": pass `templateId: template.id` to `generateThesisPlan`. (Server returns the fixed El Bayadh structure for this template → the plan screen shows the official 3-partie outline pre-filled.) tsc clean. Commit.

## Task 5: verify
- [ ] Server tsc 0; `npx tsx scripts/test-elbayadh.ts` PASS (banner PNG + jury table + institutional text in the docx). Copy `/tmp/test-elbayadh.docx` to `~/Downloads/elbayadh-sample.docx` for the user to open in Word.
- [ ] App tsc clean (only the 8 pre-existing). (Manual) pick the El Bayadh template in the wizard → plan shows the official outline → create → workspace → ⤓ export → the page de garde shows the real logo + jury table.

## Definition of done
- A pickable "Nour Bachir El Bayadh — Master STAPS" template; selecting it pre-populates the official structure; export reproduces the page de garde (real logo banner + institutional lines + jury table) with Sakkal Majal/RTL/APA.

## Out of scope / notes
- Byte-exact preservation of the original .docx cover (declined — reproduction chosen). The dashed title box is rendered as a plain centered title.
- Filling the jury names automatically (left blank to match the template; the student fills them).
