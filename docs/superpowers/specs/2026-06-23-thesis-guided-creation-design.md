# Guided Thesis Creation + AI Document Workspace — Design

**Date:** 2026-06-23
**Status:** Approved (design v1); **v2 revises the structural model** per user correction — pending re-approval.
**Repos touched:** `~/modakerati` (Expo app), `~/modakerati-server` (Hono/Drizzle), `~/mdocxengine` (docx engine). One shared Supabase project.

> **Overarching goal (user):** deliver a **full, correct `.docx` that follows real thesis norms** (page de garde, parties, chapitres, numbered headings, tables/figures, sommaire, bibliographie, annexes). Every design choice must serve building a correct file. **Always follow the docx hierarchy.**

---

## 1. The correct structural hierarchy (user-corrected)

The previous model (thesis → chapters → sections) was **inverted and too shallow**. Verified against the user's real theses (`~/Downloads`: a French nursing *mémoire*, Arabic sports *mémoire*, and the app's own exports). The correct domain hierarchy is:

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
├─ Part  ("Partie" — the user's "Section")            ← TOP structural level
│   ├─ kind: introduction | part | conclusion
│   ├─ content?  (markdown — for Intro/Conclusion-style parts with no chapters)
│   └─ Chapter  ("Chapitre" — the user's "Chapter")    ← belongs to a Part
│         └─ content (markdown):
│               ├─ "#"   →  Heading 2   (numbered 1.,  2., …)
│               ├─ "##"  →  Heading 3   (numbered 1.1., 1.2., …)
│               ├─ "###" →  Heading 4   (numbered 1.1.1., …)
│               ├─ paragraphs, lists, blockquotes
│               ├─ tables   (markdown → real Word tables)
│               └─ figures  (image + caption)
│
└─ Back matter
    ├─ Conclusion générale (may be a Part of kind=conclusion)
    ├─ Bibliographie / Références
    └─ Annexes
```

**Terminology map (user ⇄ docx ⇄ this design):**

| User says | Real thesis term | This design | Word/docx mapping |
|---|---|---|---|
| Section | Partie | **Part** | divider page + (optional) outline-lvl-0 entry |
| Chapter | Chapitre | **Chapter** | `Heading 1` (e.g. "CHAPITRE 1: …") |
| Heading 1, 2, … | sous-titres numérotés | markdown headings **inside chapter content** | `Heading 2/3/4` (numbered) |

A Chapter's title is `Heading 1`; the multi-level numbered headings the user referred to live **inside** the chapter content as markdown (`#`/`##`/`###`) and map to `Heading 2/3/4`. This keeps content editable as markdown (renders in-app, exports to correct outline) without modelling dozens of heading rows per chapter.

---

## 2. Goal & scope

Replace today's disjoint path (title sheet → template picker → immediate jump to Chat tab) with a coherent guided flow that ends in a **document workspace** where the memoir is rendered as pages and edited primarily by chatting with the AI — built on the **correct hierarchy** so the exported `.docx` is norm-compliant. AI assists at **every** step.

Flow (5 steps):
1. **Title** — bottom sheet; AI title suggestions. *(exists, behavior changes)*
2. **Template (= norm)** — pick the university/faculty template that defines the **norm**: which front-matter pages, the Part/Chapter style mapping, fonts/margins/numbering. *(exists, extended)*
3. **Plan / Outline (NEW)** — AI generates a tailored **Part → Chapter** outline from title+template; user edits/reorders/approves. **Approval creates the thesis.**
4. **Document workspace (NEW)** — native "paper" cards: front matter → Part dividers → Chapter pages (markdown w/ numbered headings + tables/figures) → back matter.
5. **AI chat editing (NEW)** — composer pinned in the workspace; tap a Part/Chapter to target it; AI edits via MCP tools; workspace re-fetches and updates live. ⤢ **Expand** = exact A4 read-only preview + download.

### Non-goals (separate future specs)
- **Scenario 2** — importing a ready `.docx`, scanning it, and auto-explaining its parts/chapters. Parked.

### Decided during brainstorming
- Preview surface = **native paper cards** (Option A); ⤢ Expand = on-demand exact A4 WebView preview.
- Editing is **chat-primary**; direct manual editing layered later.
- **UI is free to change** to fit the corrected hierarchy (user granted latitude).

---

## 3. Current-state facts (verified in code)

| Concern | Reality | Source |
|---|---|---|
| Persistence | Server Drizzle tables `theses / chapters / sections / references / chatMessages`; Zustand `thesis-store` caches `/api/thesis`. | `~/modakerati-server/src/db/schema.ts`; `lib/api.ts:278-312` |
| Content | section `content: string`, markdown. | `types/thesis.ts:4-12` |
| Markdown render | `components/Markdown.tsx` (react-native-marked) — already styles **tables**, headings, bold, lists, blockquote, code; RTL-aware. | `components/Markdown.tsx:135-137` |
| AI editing | Agentic streaming loop, MCP tools (`add_chapter`, `add_section`, `update_section_content`, `apply_template`, `ask_user`, `export_thesis`…); `/api/chat/stream` accepts `chapterId`. | `~/modakerati-server/src/mcp/server.ts`; `lib/ai-service.ts` |
| WebView | `react-native-webview@13.16.1` installed → A4 preview needs no new dep. | `package.json` |
| Title suggestions | `POST /api/thesis/title-suggestions` exists. | `lib/api.ts:292-304` |
| Templates | `config` (margins/fonts/paperSize) + `chapterStructure: string[]`. **No front matter, no Part level, no style mapping.** | `types/thesis.ts:37-52`; `stores/thesis-store.ts:283-428` |
| docx engine | `~/mdocxengine` loaded from a base template `.docx`; `applyStyle("Heading1"/"Heading2")`. | `~/modakerati-server/src/lib/docx.ts` |
| **Current export gap** | Builds cover + chapters(`Heading1`) + sections(`Heading2`) + content split into **plain paragraphs** + references. **No Parties, no numbered Heading 2/3/4, no tables/figures, no real front matter (page de garde fields, fiche synoptique, remerciements, dédicace, résumé/keywords, lists), no generated TOC.** | `~/modakerati-server/src/lib/docx.ts:80-109` |

### Evidence from real theses
- French *mémoire*: proper Word `heading 1/2/3/4` styles; `PARTIE THÉORIQUE` (divider) → `CHAPITRE 1: …` (Heading 1) → `1.`/`1.1.`/`1.1.1.` (Heading 2/3/4); `toc 1/2/3` styles for the generated sommaire.
- Arabic *mémoire*: same conceptual hierarchy but **parts/chapters use direct bold formatting**, not heading styles → style mapping must be **template-driven**, and RTL.

---

## 4. Data-model changes

### 4.1 Restructure: introduce **Part**, rename **section → chapter (with content)**

The existing two-level shape (container → content-leaf) is the **right shape, wrong names + one level short**. Target:

```
thesis → parts → chapters(content)
```

Migration (server, Drizzle — source of truth in `~/modakerati-server`):
- New table **`parts`** = the top container (today's `chapters` becomes this): `{ id, thesisId, title, kind, orderIndex, content (nullable markdown) }`.
- Table **`chapters`** = content-bearing (today's `sections` becomes this): `{ id, partId, title, orderIndex, content markdown, status }`.
- Rename FKs accordingly; migrate existing rows (app is pre-production; low data volume expected — verify before running).
- Keep `references`; add `annexes` (see 4.3).

> If a clean rename is too risky on the live DB, fallback: add a new `parts` table above existing `chapters`, and treat existing `sections` as the content leaf — but the **names then mismatch the domain**, so the rename is preferred. Decide at plan time.

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
Server: add `front_matter jsonb`, `resume jsonb` (nullable) to `theses`. Generated pages (sommaire, liste des tableaux/figures) are **derived at render/export time**, not stored.

### 4.3 Back matter
`references` (exists). Add optional `annexes` (markdown blocks / attachments) — minimal in v1.

### 4.4 Template — encode the **norm**

```ts
interface Template {
  // …existing config…
  frontMatter: {                 // which front-matter pages this norm requires
    pageDeGarde: string[];       // ordered field keys to show on the title page
    ficheSynoptique: boolean; remerciements: boolean; dedicace: boolean;
    resumeLanguages: Array<"ar"|"fr"|"en">;
    sommaire: boolean; listeTableaux: boolean; listeFigures: boolean;
  };
  structure: { partLabel: string; chapterLabel: string };  // e.g. "Partie"/"Chapitre"
  styleMap: {                    // docx outline mapping for THIS norm
    part: "dividerPage" | "Heading1";
    chapter: "Heading1" | "Heading2";
    contentHeadings: ["Heading2","Heading3","Heading4"];  // for #/##/###
    useDirectFormatting?: boolean;  // Arabic norms that bold instead of styling
  };
}
```

### 4.5 Plan (transient)
`GeneratedPlan = { parts: Array<{ title, kind, chapters: Array<{ title, hint? }> }> }`. On approval, seeds the thesis (parts + chapters + front matter) in one `POST /api/thesis`.

---

## 5. Server work (`~/modakerati-server` + `~/mdocxengine`)

1. **`POST /api/thesis/generate-plan`** — `{ title, templateId, language }` → `GeneratedPlan` (Part→Chapter). Prompt-constrained JSON (same style as `routes/enhance.ts`), seeded by the template's expected structure. App falls back to a template default outline on failure.
2. **`POST /api/thesis`** — extend to accept the full `{ parts:[{title,kind,chapters:[{title}]}], frontMatter, resume, templateId, language }`. Keep old shape working during migration.
3. **Part/Chapter MCP tools** — rename/extend tools to the new hierarchy: `add_part`, `update_part`, `add_chapter` (now under a part), `update_chapter_content`, `reorder_parts/chapters`. `ask_user`, `export_thesis` unchanged.
4. **Section/part-targeted chat** — `/api/chat/stream` + `/send` accept optional `partId` / `chapterId`; the focused unit is passed to the tool system prompt.
5. **`GET /api/thesis/:id/preview-html`** — self-contained paginated HTML (template fonts/margins/paper, page de garde, résumé, generated sommaire, parts/chapters w/ numbered headings + tables/figures) for the A4 WebView. Read-only.
6. **★ docx export overhaul (`docx.ts` + `mdocxengine`) — the core goal.** Produce a **norm-compliant** document:
   - Page de garde from `frontMatter` (all required fields, centered, template fonts).
   - Optional fiche synoptique, remerciements, dédicace, résumé(s)+mots-clés.
   - **Generated sommaire/TOC** + liste des tableaux + liste des figures (field codes or pre-built, per engine capability).
   - **Part dividers** (or Heading1) per `styleMap.part`; **Chapter** as Heading1.
   - **Parse chapter markdown** → `Heading 2/3/4` for `#/##/###`, real **Word tables** for markdown tables, **figures** (image + caption + auto-number), lists, bold/italic.
   - Bibliographie + annexes.
   - Honor RTL + `useDirectFormatting` for Arabic norms.
   - **The engine already supports this** — `mdocxengine` exposes `TableOfContentsManager` (TOC w/ `headingDepth`), `Table`/`TableRow`/`TableCell`, `MediaManager.insertImage` (figures), `ShapeManager`, and `Footnote`/`Endnote`/`CitationManager`. `docx.ts` simply never calls them (it only emits plain paragraphs). The work is **wiring `docx.ts` to these managers + a markdown→docx parser**, not building engine features.
   - Requires the base template `.docx` to define styles `Heading1-4`, `Title`, part/divider, `toc 1-3`, caption — **audit/extend the base template** as part of this work.

All routes use existing Supabase-JWT auth, scoped by `userId`.

---

## 6. App architecture (`~/modakerati`)

### 6.1 Routes / screens
| Route | File | Status | Purpose |
|---|---|---|---|
| `new-thesis` sheet | `components/NewThesisSheet.tsx` | changed | Capture title + AI suggestions; **no longer creates** the thesis. |
| `(app)/template-picker` / `template-preview` | exist | changed | Carry title; "Use this" → **plan** step. |
| `(app)/thesis-plan` | **NEW** | new | Editable AI **Part → Chapter** outline; "Create" persists + routes to workspace. |
| `(app)/thesis-workspace` | **NEW** | new | Paper-card preview + embedded chat composer. |
| `(app)/thesis-preview-a4` | **NEW** | new | WebView A4 preview + download. |

Wizard state (title, templateId, plan) in a transient `thesis-wizard-store`; the thesis row is created only at plan approval.

### 6.2 Components
- `ThesisPlanEditor` — reorderable **Parts** each containing reorderable **Chapters**; "Regenerate", per-part "AI suggest chapters".
- `DocumentWorkspace` — scroll of `PaperPage`s; owns `selected` (partId|chapterId); refetches `getThesis(id)` after each AI turn.
- `PaperPage` variants: `titlePage`, `frontMatter` (résumé, remerciements…), `partDivider`, `chapter`, `references`.
- `ChapterCard` — renders chapter markdown via existing `Markdown` (numbered headings, tables, figures); tap to target; empty → "Ask AI to draft this".
- `WorkspaceComposer` — chat input + "✎ editing <Part/Chapter>" chip; sends via `ai-service` with `partId`/`chapterId`; reuses streaming + thinking.
- `A4PreviewWebView` — loads `preview-html`; pager + ⤓ download.

### 6.3 State / reuse
- `thesis-wizard-store` (transient); extend `thesis-store` with `selected` + `refreshThesis(id)`.
- Reuse gorhom conditional-unmount sheet pattern, `Markdown`, `ai-service` streaming, thinking frames, pending-ask UI, `export_thesis`.

---

## 7. Live-edit data flow
Select Part/Chapter → composer chip → send `{ thesisId, partId?, chapterId?, message }` to `/api/chat/stream` → AI calls MCP tools mutating server tables → on completion `refreshThesis(id)` → affected card re-renders → ⤢ Expand re-requests `preview-html`. `ask_user` surfaces via existing pending-ask UI inside the workspace.

## 8. AI at every step
Title suggestions (exists) · Plan generation (new) · Content/tables/figures via chat→MCP, part/chapter-targeted · optional per-chapter quick actions (Generate / Expand / Rephrase / Add table) routed through the same chat pipeline.

## 9. Error handling & edges
Plan/offline failure → template default outline (no blank wall) · chat-stream failure → `/send` fallback · empty chapter → draft placeholder · A4 render failure → toast, stay on cards · abandon wizard → store cleared, no orphan thesis · **RTL/Arabic** → `Markdown` + `getTextDirection`, and export honors `useDirectFormatting` · server is source of truth, workspace reconciles via `getThesis`.

## 10. i18n
New nested keys: `thesis.plan.*`, `thesis.workspace.*`, `thesis.preview.*`, `thesis.frontMatter.*` (en/fr/ar).

## 11. Phasing (foundation-first, because the goal is a correct .docx)
- **P0 — Model + migration:** `parts`/`chapters(content)` tables, thesis `frontMatter`/`resume`, template `frontMatter`/`structure`/`styleMap`; update types, API, MCP tools, stores.
- **P1 — ★ docx export correctness:** norm-compliant export (page de garde, front matter, part dividers, chapter/numbered-heading styles, **tables/figures**, sommaire/lists, bibliography, RTL). Validate against the user's real theses. *(Directly delivers the stated goal.)*
- **P2 — Wizard + Plan step:** generate-plan, `thesis-plan` editor, plan-approval creates thesis.
- **P3 — Document workspace (read):** paper cards rendering front matter + parts/chapters/headings/tables.
- **P4 — Embedded AI chat editing:** composer, part/chapter targeting, live `refreshThesis`, pending-ask.
- **P5 — A4 expand preview:** `preview-html` + WebView + download.

P0–P1 make the output correct; P2–P5 deliver the guided authoring UX. (If preferred, P0–P1 can be split into their own spec as a "correctness foundation" sub-project.)

## 12. Open risks
1. **DB migration / rename** — backward-compatible, coordinated with the live server; verify data volume first.
2. **mdocxengine capability** — ✅ confirmed: engine ships `TableOfContentsManager`, `Table`, `MediaManager.insertImage`, `ShapeManager`, `Citation/Footnote/EndnoteManager`. Residual risk is only the **base template `.docx`** defining the needed styles (`Heading1-4`, part/divider, `toc 1-3`, caption) — audit/extend it. Much lower risk than initially feared.
3. **Per-norm style mapping** — French (heading styles) vs Arabic (direct bold) divergence handled via `styleMap.useDirectFormatting`; validate both.
4. **Plan JSON reliability** — constrained prompt + parse-with-fallback.
5. **A4 pagination in WebView** — keep read-only/simple; validate iOS+Android.

## 13. Testing
- **Engine/server:** golden-file export tests comparing generated `.docx` outline (parts/chapters/heading levels/tables/front matter) against fixtures derived from the user's real theses; `generate-plan` JSON parse+fallback; extended `POST /api/thesis`; `preview-html` snapshot.
- **App:** `ThesisPlanEditor` (reorder parts/chapters), `ChapterCard` (markdown incl. table + figure, empty placeholder, selection), `WorkspaceComposer` (chip set/clear, sends ids). Manual: full flow EN/FR/AR incl. RTL, offline fallback, ⤢ expand + download, and **open the exported `.docx` in Word to confirm norms**.
