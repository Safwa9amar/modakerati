# Guided Thesis Creation + AI Document Workspace — Design

**Date:** 2026-06-23
**Status:** Approved (design); **v3 finalizes naming** (Section > Chapter) per user — pending re-approval.
**Repos touched:** `~/modakerati` (Expo app), `~/modakerati-server` (Hono/Drizzle), `~/mdocxengine` (docx engine). One shared Supabase project.

> **Overarching goal (user):** deliver a **full, correct `.docx` that follows real thesis norms** (page de garde, sections/parties, chapitres, numbered headings, tables/figures, sommaire, bibliographie, annexes). Every design choice must serve building a correct file. **Always follow the docx hierarchy.**

---

## 1. The correct structural hierarchy (user-confirmed naming)

The previous code model (`thesis → chapters → sections`) was **inverted and too shallow**. Verified against the user's real theses (`~/Downloads`: a French nursing *mémoire*, an Arabic sports *mémoire*, and the app's own exports). The correct hierarchy, **using the user's vocabulary**:

```
Thesis
├─ Front matter
│   ├─ Page de garde (université, faculté, département, filière, spécialité,
│   │                 diplôme, thème/titre, auteur(s), encadreur, co-encadreur,
│   │                 jury, année universitaire, ville)
│   ├─ Fiche synoptique (optional)
│   ├─ Remerciements
│   ├─ Dédicace
│   ├─ Résumé + mots-clés  /  Abstract + keywords  (often AR + FR + EN)
│   ├─ Sommaire / Table des matières (generated)
│   ├─ Liste des tableaux (generated)
│   └─ Liste des figures (generated)
│
├─ Section  ("Partie")                                 ← TOP structural level
│   ├─ kind: introduction | section | conclusion
│   ├─ content?  (markdown — for Intro/Conclusion-style sections with no chapters)
│   └─ Chapter  ("Chapitre")                            ← belongs to a Section
│         └─ content (markdown):
│               ├─ "#"   →  Heading 2   (numbered 1.,  2., …)
│               ├─ "##"  →  Heading 3   (numbered 1.1., 1.2., …)
│               ├─ "###" →  Heading 4   (numbered 1.1.1., …)
│               ├─ paragraphs, lists, blockquotes
│               ├─ tables   (markdown → real Word tables)
│               └─ figures  (image + caption)
│
└─ Back matter
    ├─ Conclusion générale (may be a Section of kind=conclusion)
    ├─ Bibliographie / Références
    └─ Annexes
```

**Terminology map (user ⇄ docx ⇄ this design):**

| User term | French | This design | Word/docx mapping |
|---|---|---|---|
| Section | Partie | **Section** (top) | divider page + (optional) outline-lvl-0 entry |
| Chapter | Chapitre | **Chapter** (in a Section) | `Heading 1` (e.g. "CHAPITRE 1: …") |
| Heading 1, 2, … | sous-titres numérotés | markdown headings **inside chapter content** | `Heading 2/3/4` (numbered) |

A Chapter's title renders as `Heading 1`; the multi-level numbered headings the user referred to live **inside** chapter content as markdown (`#`/`##`/`###`) → `Heading 2/3/4`. This keeps content editable as markdown (renders in-app, exports to the correct outline) without modelling dozens of heading rows per chapter.

> **⚠️ Naming inversion vs. current code:** today `chapters` is the TOP table and `sections` is the content leaf. The correct model **swaps** this: `sections` becomes the top container and `chapters` becomes the content-bearing level. The migration and every reference (MCP tools, store methods, API) must swap accordingly — see §4.1.

---

## 2. Goal & scope

Replace today's disjoint path (title sheet → template picker → immediate jump to Chat tab) with a coherent guided flow ending in a **document workspace** where the memoir is rendered as pages and edited primarily by chatting with the AI — built on the **correct hierarchy** so the exported `.docx` is norm-compliant. AI assists at **every** step.

Flow (5 steps):
1. **Title** — bottom sheet; AI title suggestions. *(exists, behavior changes)*
2. **Template (= norm)** — pick the university/faculty template that defines the **norm**: which front-matter pages, the Section/Chapter style mapping, fonts/margins/numbering. *(exists, extended)*
3. **Plan / Outline (NEW)** — AI generates a tailored **Section → Chapter** outline from title+template; user edits/reorders/approves. **Approval creates the thesis.**
4. **Document workspace (NEW)** — native "paper" cards: front matter → Section dividers → Chapter pages (markdown w/ numbered headings + tables/figures) → back matter.
5. **AI chat editing (NEW)** — composer pinned in the workspace; tap a Section/Chapter to target it; AI edits via MCP tools; workspace re-fetches and updates live. ⤢ **Expand** = exact A4 read-only preview + download.

**Plus — Source materials (NEW):** a per-thesis library where the user uploads **helper files** to feed the AI enough information to prepare the memoir. Each source = file + a **title** + a **short description of what to extract/use** from it. The AI draws on these when generating/editing (e.g. uploaded papers inform the revue de littérature; an uploaded data file informs the partie pratique). Accessible anytime from the workspace; can also be added during the plan step. Detailed in §14.

### Non-goals (separate future specs)
- **Scenario 2** — importing a ready `.docx`, scanning it, and auto-explaining its sections/chapters. Parked. *(Distinct from Source materials in §14: Scenario 2 imports a file to **become** the thesis; §14 uploads files as **reference input**.)*

### Decided during brainstorming
- Preview surface = **native paper cards** (Option A); ⤢ Expand = on-demand exact A4 WebView preview.
- Editing is **chat-primary**; direct manual editing layered later.
- **UI is free to change** to fit the corrected hierarchy (user granted latitude).

---

## 3. Current-state facts (verified in code)

| Concern | Reality | Source |
|---|---|---|
| Persistence | Server Drizzle tables `theses / chapters / sections / references / chatMessages`; Zustand `thesis-store` caches `/api/thesis`. **Names are inverted vs. the target model.** | `~/modakerati-server/src/db/schema.ts`; `lib/api.ts:278-312` |
| Content | leaf `content: string`, markdown. | `types/thesis.ts:4-12` |
| Markdown render | `components/Markdown.tsx` (react-native-marked) — already styles **tables**, headings, bold, lists, blockquote, code; RTL-aware. | `components/Markdown.tsx:135-137` |
| AI editing | Agentic streaming loop, MCP tools (`add_chapter`, `add_section`, `update_section_content`, `apply_template`, `ask_user`, `export_thesis`…); `/api/chat/stream` accepts `chapterId`. | `~/modakerati-server/src/mcp/server.ts`; `lib/ai-service.ts` |
| WebView | `react-native-webview@13.16.1` installed → A4 preview needs no new dep. | `package.json` |
| Title suggestions | `POST /api/thesis/title-suggestions` exists. | `lib/api.ts:292-304` |
| Templates | `config` (margins/fonts/paperSize) + `chapterStructure: string[]`. **No front matter, no Section level, no style mapping.** | `types/thesis.ts:37-52`; `stores/thesis-store.ts:283-428` |
| docx engine | `~/mdocxengine` loaded from a base template `.docx`; `applyStyle("Heading1"/"Heading2")`. | `~/modakerati-server/src/lib/docx.ts` |
| **Current export gap** | Builds cover + (top)`Heading1` + (leaf)`Heading2` + content split into **plain paragraphs** + references. **No Section dividers, no numbered Heading 2/3/4, no tables/figures, no real front matter (page de garde fields, fiche synoptique, remerciements, dédicace, résumé/keywords, lists), no generated TOC.** | `~/modakerati-server/src/lib/docx.ts:80-109` |

### Evidence from real theses
- French *mémoire*: proper Word `heading 1/2/3/4` styles; `PARTIE THÉORIQUE` (divider) → `CHAPITRE 1: …` (Heading 1) → `1.`/`1.1.`/`1.1.1.` (Heading 2/3/4); `toc 1/2/3` styles for the generated sommaire.
- Arabic *mémoire*: same conceptual hierarchy but **sections/chapters use direct bold formatting**, not heading styles → style mapping must be **template-driven**, and RTL.

---

## 4. Data-model changes

### 4.1 Restructure: top level = **Section**, content level = **Chapter**

The existing two-level shape (container → content-leaf) is the **right shape, inverted names + one level short**. Target:

```
thesis → sections → chapters(content)
```

Migration (server, Drizzle — source of truth in `~/modakerati-server`):
- **`sections`** = top container (today's `chapters` is renamed/repurposed to this): `{ id, thesisId, title, kind, orderIndex, content (nullable markdown) }`.
- **`chapters`** = content-bearing leaf (today's `sections` is renamed to this): `{ id, sectionId, title, orderIndex, content markdown, status }`.
- This **swaps the meaning** of the two existing tables; remap FKs and migrate rows (app is pre-production; verify low data volume before running — a clean drop/recreate may be simplest).
- Update every reference: MCP tools (`add_section`/`add_chapter` swap roles — see §5.3), store methods, API serializers, app types.
- Keep `references`; add `annexes` (see 4.3).

### 4.2 Thesis — front matter + résumé

```ts
interface Thesis {
  // …existing…
  frontMatter?: ThesisFrontMatter;  // page-de-garde fields + fiche synoptique + remerciements + dédicace
  resume?: ResumeBlock[];           // [{ language: "ar"|"fr"|"en", body, keywords[] }]
}
interface ThesisFrontMatter {
  university?: string; faculty?: string; department?: string; field?: string;
  specialty?: string; degree?: string; theme?: string;
  authors?: string[]; supervisor?: string; coSupervisor?: string;
  jury?: string[]; academicYear?: string; city?: string;
  ficheSynoptique?: string; acknowledgements?: string; dedication?: string;
}
```
Server: add `front_matter jsonb`, `resume jsonb` (nullable) to `theses`. Generated pages (sommaire, listes des tableaux/figures) are **derived at render/export time**, not stored.

### 4.3 Back matter
`references` (exists). Add optional `annexes` (markdown blocks / attachments) — minimal in v1.

### 4.4 Template = a **formatting profile** (research-driven)

> **Research finding (see [research/2026-06-23-algerian-thesis-norms.md](../../research/2026-06-23-algerian-thesis-norms.md)):** there is **NO single national Algerian standard** — every norm is per-university/faculty, and the two axes that drive everything are **language** (French/Latin vs Arabic/RTL) and **discipline** (science/experimental vs law/humanities). So a "template" is really a **formatting profile** keyed by (university/faculty, language, discipline); we ship a few real profiles + a generic French and a generic Arabic one, and let students adjust.

```ts
interface Template {            // = a formatting profile
  // …existing config (margins/fonts/paperSize)…
  language: "ar" | "fr" | "en";
  discipline: "science" | "law-humanities" | "generic";
  bindingSide: "left" | "right";          // left for FR/Latin, right for AR/RTL
  citationStyle: "apa" | "footnote-ar";   // APA (science/FR) vs التهميش footnotes (law/AR)
  bodyPreset: "imrad" | "chapters" | "law-humanities"; // seeds the plan (see below)
  frontMatter: {
    pageDeGarde: string[];                 // ordered field keys for the title page
    ficheSynoptique: boolean; remerciements: boolean; dedicace: boolean;
    resumeLanguages: Array<"ar"|"fr"|"en">;     // Arabic always included
    resumePlacement: "front" | "back";          // varies by institution
    sommaire: boolean; listeTableaux: boolean; listeFigures: boolean; listeAbreviations: boolean;
  };
  structure: { sectionLabel: string; chapterLabel: string };  // "Partie"/"Chapitre" | "قسم"/"فصل"
  styleMap: {                              // docx outline mapping for THIS norm
    section: "dividerPage" | "Heading1";
    chapter: "Heading1" | "Heading2";
    contentHeadings: ["Heading2","Heading3","Heading4"];  // for #/##/###
    useDirectFormatting?: boolean;         // Arabic norms that bold instead of styling
    headingSizes?: Record<string, number>; // institution-specific (e.g. Alger1 18/16/14/12)
  };
}
```

**Two preset body structures** the plan-generator picks from (per `bodyPreset`):
- **`imrad`** (science): Partie I *Synthèse Bibliographique* → Partie II *Matériel et Méthodes* → Partie III *Résultats et Discussion* (each a Section with chapters).
- **`law-humanities`**: sequential chapitres (فصول), each nesting section/مبحث → subsection/مطلب as numbered headings.
- **`chapters`**: simple Intro → N chapters → Conclusion (generic default).

### 4.5 Plan (transient)
`GeneratedPlan = { sections: Array<{ title, kind, chapters: Array<{ title, hint? }> }> }`. On approval, seeds the thesis (sections + chapters + front matter) in one `POST /api/thesis`.

---

## 5. Server work (`~/modakerati-server` + `~/mdocxengine`)

1. **`POST /api/thesis/generate-plan`** — `{ title, templateId, language }` → `GeneratedPlan` (Section→Chapter). Prompt-constrained JSON (same style as `routes/enhance.ts`), seeded by the template's expected structure. App falls back to a template default outline on failure.
2. **`POST /api/thesis`** — extend to accept the full `{ sections:[{title,kind,chapters:[{title}]}], frontMatter, resume, templateId, language }`. Keep old shape working during migration.
3. **Section/Chapter MCP tools** — after the rename, tools map to the new hierarchy: `add_section`/`update_section` (top container), `add_chapter`/`update_chapter_content` (content leaf under a section), `reorder_sections`/`reorder_chapters`. `ask_user`, `export_thesis` unchanged. **Note the role swap** vs. today's tool semantics.
4. **Targeted chat** — `/api/chat/stream` + `/send` accept optional `sectionId` / `chapterId`; the focused unit is passed to the tool system prompt.
5. **`GET /api/thesis/:id/preview-html`** — self-contained paginated HTML (template fonts/margins/paper, page de garde, résumé, generated sommaire, sections/chapters w/ numbered headings + tables/figures) for the A4 WebView. Read-only.
6. **★ docx export overhaul (`docx.ts` + `mdocxengine`) — the core goal.** Produce a **norm-compliant** document:
   - Page de garde from `frontMatter` (all required fields, centered, template fonts).
   - Optional fiche synoptique, remerciements, dédicace, résumé(s)+mots-clés.
   - **Generated sommaire/TOC** + liste des tableaux + liste des figures.
   - **Section dividers** (or Heading1) per `styleMap.section`; **Chapter** as Heading1.
   - **Parse chapter markdown** → `Heading 2/3/4` for `#/##/###`, real **Word tables** for markdown tables, **figures** (image + caption + auto-number), lists, bold/italic.
   - Bibliographie + annexes.
   - **Citations per `citationStyle`:** `apa` → author-date + APA reference list (electronic refs: "Consulté le" + URL in `< >`); `footnote-ar` → bottom-of-page footnotes (التهميش: Author, Title, Edition, Publisher, Country, Year, Page) with مرجع سابق / المرجع نفسه (Op. cit. / Ibid.) — uses the engine's `Footnote`/`CitationManager`.
   - **Page numbering:** lowercase Roman (ii, iii…) for front matter, Arabic (1, 2, 3…) from the introduction, centered at the bottom.
   - Honor RTL + `useDirectFormatting` for Arabic norms, and **mirror the binding margin** per `bindingSide` (left for FR, right for AR). Résumé page placed per `resumePlacement` (front vs back cover).
   - **The engine already supports this** — `mdocxengine` exposes `TableOfContentsManager` (TOC w/ `headingDepth`), `Table`/`TableRow`/`TableCell`, `MediaManager.insertImage` (figures), `ShapeManager`, and `Footnote`/`Endnote`/`CitationManager`. `docx.ts` simply never calls them (it only emits plain paragraphs). The work is **wiring `docx.ts` to these managers + a markdown→docx parser**, not building engine features.
   - Requires the base template `.docx` to define styles `Heading1-4`, `Title`, section/divider, `toc 1-3`, caption — **audit/extend the base template** as part of this work.

All routes use existing Supabase-JWT auth, scoped by `userId`.

---

## 6. App architecture (`~/modakerati`)

### 6.1 Routes / screens
| Route | File | Status | Purpose |
|---|---|---|---|
| `new-thesis` sheet | `components/NewThesisSheet.tsx` | changed | Capture title + AI suggestions; **no longer creates** the thesis. |
| `(app)/template-picker` / `template-preview` | exist | changed | Carry title; "Use this" → **plan** step. |
| `(app)/thesis-plan` | **NEW** | new | Editable AI **Section → Chapter** outline; "Create" persists + routes to workspace. |
| `(app)/thesis-workspace` | **NEW** | new | Paper-card preview + embedded chat composer. |
| `(app)/thesis-preview-a4` | **NEW** | new | WebView A4 preview + download. |

Wizard state (title, templateId, plan) in a transient `thesis-wizard-store`; the thesis row is created only at plan approval.

### 6.2 Components
- `ThesisPlanEditor` — reorderable **Sections** each containing reorderable **Chapters**; "Regenerate", per-section "AI suggest chapters".
- `DocumentWorkspace` — scroll of `PaperPage`s; owns `selected` (sectionId|chapterId); refetches `getThesis(id)` after each AI turn.
- `PaperPage` variants: `titlePage`, `frontMatter` (résumé, remerciements…), `sectionDivider`, `chapter`, `references`.
- `ChapterCard` — renders chapter markdown via existing `Markdown` (numbered headings, tables, figures); tap to target; empty → "Ask AI to draft this".
- `WorkspaceComposer` — chat input + "✎ editing <Section/Chapter>" chip; sends via `ai-service` with `sectionId`/`chapterId`; reuses streaming + thinking.
- `A4PreviewWebView` — loads `preview-html`; pager + ⤓ download.

### 6.3 State / reuse
- `thesis-wizard-store` (transient); extend `thesis-store` with `selected` + `refreshThesis(id)`.
- Reuse gorhom conditional-unmount sheet pattern, `Markdown`, `ai-service` streaming, thinking frames, pending-ask UI, `export_thesis`.

---

## 7. Live-edit data flow
Select Section/Chapter → composer chip → send `{ thesisId, sectionId?, chapterId?, message }` to `/api/chat/stream` → AI calls MCP tools mutating server tables → on completion `refreshThesis(id)` → affected card re-renders → ⤢ Expand re-requests `preview-html`. `ask_user` surfaces via existing pending-ask UI inside the workspace.

## 8. AI at every step
Title suggestions (exists) · Plan generation (new, uses the profile's `bodyPreset`) · Content/tables/figures via chat→MCP, section/chapter-targeted · optional per-chapter quick actions (Generate / Expand / Rephrase / Add table) routed through the same chat pipeline. **Research-driven emphasis:** weight the most AI help toward the stages students struggle with — *choix du sujet, problématique, démarche méthodologique* — surfaced as guided prompts at the relevant steps.

## 9. Error handling & edges
Plan/offline failure → template default outline (no blank wall) · chat-stream failure → `/send` fallback · empty chapter → draft placeholder · A4 render failure → toast, stay on cards · abandon wizard → store cleared, no orphan thesis · **RTL/Arabic** → `Markdown` + `getTextDirection`, and export honors `useDirectFormatting` · server is source of truth, workspace reconciles via `getThesis`.

## 10. i18n
New nested keys: `thesis.plan.*`, `thesis.workspace.*`, `thesis.preview.*`, `thesis.frontMatter.*` (en/fr/ar).

## 11. Phasing (foundation-first, because the goal is a correct .docx)
- **P0 — Model + migration:** swap to `sections`(top)/`chapters`(content) tables, thesis `frontMatter`/`resume`, template `frontMatter`/`structure`/`styleMap`; update types, API, MCP tools, stores.
- **P1 — ★ docx export correctness:** norm-compliant export (page de garde, front matter, section dividers, chapter/numbered-heading styles, **tables/figures**, sommaire/lists, bibliography, RTL). Validate against the user's real theses. *(Directly delivers the stated goal.)*
- **P2 — Wizard + Plan step:** generate-plan, `thesis-plan` editor, plan-approval creates thesis.
- **P3 — Document workspace (read):** paper cards rendering front matter + sections/chapters/headings/tables.
- **P4 — Embedded AI chat editing:** composer, section/chapter targeting, live `refreshThesis`, pending-ask.
- **P5 — A4 expand preview:** `preview-html` + WebView + download.

P0–P1 make the output correct; P2–P5 deliver the guided authoring UX. (If preferred, P0–P1 can be split into their own spec as a "correctness foundation" sub-project.)

## 12. Open risks
1. **DB migration / name swap** — `sections`/`chapters` swap meaning; backward-compatible during transition, coordinated with the live server; verify data volume first (clean recreate may be simplest pre-production).
2. **mdocxengine capability** — ✅ confirmed: engine ships `TableOfContentsManager`, `Table`, `MediaManager.insertImage`, `ShapeManager`, `Citation/Footnote/EndnoteManager`. Residual risk is only the **base template `.docx`** defining the needed styles (`Heading1-4`, section/divider, `toc 1-3`, caption) — audit/extend it.
3. **Per-norm style mapping** — French (heading styles) vs Arabic (direct bold) divergence handled via `styleMap.useDirectFormatting`; validate both.
4. **Plan JSON reliability** — constrained prompt + parse-with-fallback.
5. **A4 pagination in WebView** — keep read-only/simple; validate iOS+Android.

## 13. Testing
- **Engine/server:** golden-file export tests comparing generated `.docx` outline (sections/chapters/heading levels/tables/front matter) against fixtures derived from the user's real theses; `generate-plan` JSON parse+fallback; extended `POST /api/thesis`; `preview-html` snapshot.
- **App:** `ThesisPlanEditor` (reorder sections/chapters), `ChapterCard` (markdown incl. table + figure, empty placeholder, selection), `WorkspaceComposer` (chip set/clear, sends ids). Manual: full flow EN/FR/AR incl. RTL, offline fallback, ⤢ expand + download, and **open the exported `.docx` in Word to confirm norms**.

---

## 14. Source materials (helper files) — NEW

The user attaches reference files to a thesis so the AI has enough domain material to draft accurate content (literature, data, instructor guidelines, prior work). **Distinct from Scenario 2:** that imports a `.docx` to *become* the thesis; here files are **reference input**, not the document itself.

### 14.1 Per-source data (each upload)
- **File** — the document/image.
- **Title** — user-given name.
- **Description** — a short note of *what to take from it* (e.g. "use the methodology section", "extract the statistics table", "follow these formatting rules"). Guides extraction and tells the AI when the source is relevant.

### 14.2 Data model
New table **`thesis_sources`**: `{ id, thesisId, userId, title, description, filename, storagePath, fileType, extractedText (or chunk pointer), status, createdAt }`. Files in Supabase Storage, scoped by `userId`/`thesisId` (same pattern as `documents` + exports).

### 14.3 Supported file types
- **`.docx`** — reuse existing `mdocxengine` extraction (`document-service`). *(v1)*
- **PDF** — text extraction (NEW server dep). *(v1, flagged)*
- **Images** (charts/scans) — vision-model description / OCR (NEW). *(defer to v1.1)*
- **Plain text / markdown** — direct. *(v1)*

### 14.4 Server work (`~/modakerati-server`)
- `POST /api/thesis/:id/sources` — `{ base64, filename, title, description }` → extract text → store row + file → return source.
- `GET /api/thesis/:id/sources`, `DELETE /api/thesis/:id/sources/:sid`.
- **MCP tools** (fits the agentic-tool pattern): `list_sources(thesisId)` → titles + descriptions + ids; `get_source_content(sourceId)` → extracted text (chunked/summarized if large). AI calls these on demand → tool-based RAG, no always-on context bloat.

### 14.5 App
- **Sources panel** ("Sources" / "المصادر") reachable from the workspace (sheet or tab): list of files with title + description + type; add/remove.
- **Add-source bottom sheet** (gorhom pattern): file picker (`expo-document-picker`/`expo-image-picker`, already used) + title input + description input.
- Optional prompt at the plan step: "Add materials to help the AI draft your memoir."
- In chat the user can reference a source by title; the AI resolves it via `get_source_content`.

### 14.6 AI usage
On generate/edit: (1) `list_sources` to see what's available + each description; (2) pull relevant ones via `get_source_content`; (3) draft grounded in them, optionally citing them. The per-source **description** is the relevance routing signal.

### 14.7 Phasing
**P6 — Source materials:** table + upload/extract (`.docx` first, PDF next) + `list_sources`/`get_source_content` MCP tools + Sources panel/add-sheet + source-aware drafting. Depends on workspace/chat (P3–P4); independently shippable. Image/OCR → P6.1.

### 14.8 Risks
- **PDF/image extraction** — new deps; quality varies (scanned Arabic PDFs especially). Start `.docx` + text PDFs; OCR later.
- **Context size** — chunk/summarize large sources server-side before the AI reads them (reuse chat-memory summarization).
- **Storage/cleanup** — delete sources with the thesis.
