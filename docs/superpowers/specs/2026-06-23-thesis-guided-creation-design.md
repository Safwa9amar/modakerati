# Guided Thesis Creation + AI Document Workspace — Design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Repos touched:** `~/modakerati` (Expo app) and `~/modakerati-server` (Hono/Drizzle). One shared Supabase project.

---

## 1. Goal & scope

Replace today's disjoint "start a thesis" path (title sheet → template picker → immediate jump to the Chat tab) with a **coherent guided flow** that ends in a **document workspace**: the memoir rendered as pages, edited primarily by chatting with the AI. AI assists at **every** step.

The flow (5 steps):

1. **Title** — bottom sheet, user enters title; AI suggests titles. *(exists, behavior changes)*
2. **Template** — pick the university/college/faculty template that defines the layout. *(exists, behavior changes)*
3. **Plan / Outline (NEW)** — AI generates a tailored chapters+sections outline from title+template; the user edits/reorders/approves it. **Approval creates the thesis.**
4. **Document workspace (NEW)** — the memoir as native "paper" cards: title page → résumé → table of contents → chapters/sections, rendered from markdown.
5. **AI chat editing (NEW)** — a composer pinned in the workspace; tap a section to target it; the AI edits via existing MCP tools; the workspace re-fetches and updates live. An ⤢ **Expand** button opens an exact A4 read-only preview.

### Non-goals (separate future specs)

- **Scenario 2** — importing a ready `.docx`, scanning it, and auto-explaining its chapters/sections. Parked per the user.
- **Full export fidelity** — markdown tables/formatting surviving into `.docx`. Shipped as a later flagged phase (P5), not MVP.

### Chosen approach (decided during brainstorming)

- Preview rendering = **Option A, native "paper" cards** (reflow, not true pagination) as the live editing surface. Rejected: B (WebView A4 as the live surface — too heavy, laggy on edits) and C (server PDF as the live surface — not live).
- ⤢ **Expand** opens an exact A4 read-only preview rendered in a WebView (the faithful view, on demand).
- Editing is **chat-primary**; direct manual text editing is a secondary convenience, layered later.

---

## 2. Current-state facts (verified in code)

| Concern | Reality | Source |
|---|---|---|
| Thesis persistence | Server-backed Drizzle tables `theses / chapters / sections / references / chatMessages`; the Zustand `thesis-store` is a client cache over `/api/thesis`. | `~/modakerati-server/src/db/schema.ts`; `lib/api.ts:278-312` |
| Section content | `content: string`, markdown. | `types/thesis.ts:4-12` |
| Markdown rendering | `components/Markdown.tsx` uses `react-native-marked`; **already styles `table`/`tableRow`/`tableCell`**, headings, bold, lists, blockquote, code. | `components/Markdown.tsx:135-137` |
| AI editing | Agentic streaming loop with MCP tools: `add_chapter`, `add_section`, `update_section_content`, `update_section`, `apply_template`, `ask_user`, `export_thesis`, etc. `/api/chat/stream` already accepts `chapterId`. | `~/modakerati-server/src/mcp/server.ts`; `lib/ai-service.ts`; `lib/api.ts` chat fns |
| WebView | `react-native-webview@13.16.1` already installed → A4 preview needs no new dep. | `package.json` |
| Title suggestions | `POST /api/thesis/title-suggestions` exists. | `lib/api.ts:292-304` |
| Templates | `Template.config` (margins, fonts, paperSize) + `chapterStructure: string[]` (chapter titles only). 5 built-in DZ/international templates. **No front-matter definition.** | `types/thesis.ts:37-52`; `stores/thesis-store.ts:283-428` |
| Export | `docx.ts` builds a cover page + chapters(H1)/sections(H2) + content **split into plain paragraphs** + references. **No markdown table/format parsing; no résumé/TOC page.** | `~/modakerati-server/src/lib/docx.ts:80-109` |
| Bottom sheets | gorhom; **conditional-unmount** pattern (`if (!isOpen) return null`) + single `requestAnimationFrame(present)`; store-driven via `openSheet(name)`. | `components/BottomSheet.tsx`; `stores/bottom-sheet-store.ts` |
| i18n | `react-i18next`, nested keys in `locales/{en,fr,ar}.json`. | `locales/` |

### ⚠️ Key risk

`.docx` export treats section content as plain-text blocks. Markdown **tables and inline formatting render correctly in-app but will export as literal text** until `docx.ts` is upgraded (P5). The résumé and table-of-contents pages also do not exist in the exporter yet.

---

## 3. Data-model changes

### 3.1 Template — add front matter

Extend `Template` (`types/thesis.ts` + the server template source) with a `frontMatter` block:

```ts
interface TemplateFrontMatter {
  titlePage: {
    fields: Array<"university" | "faculty" | "department" | "degree"
      | "title" | "author" | "supervisor" | "coSupervisor" | "year" | "city">;
  };
  resume: boolean;          // include an abstract/résumé page
  tableOfContents: boolean; // include a generated TOC page
}
```

Built-in templates get sensible defaults (DZ mémoire/PFE → full title page, résumé true, TOC true).

### 3.2 Thesis — add front-matter values + résumé

Extend `Thesis`:

```ts
interface Thesis {
  // ...existing...
  frontMatter?: Record<string, string>; // author, supervisor, year, faculty, city, ...
  resume?: string;                        // abstract/résumé, markdown
}
```

Server: add nullable columns to `theses` (Drizzle migration) — `front_matter jsonb`, `resume text`. The DB schema lives in `~/modakerati-server` (source of truth).

### 3.3 Plan (transient)

Plan generation returns, but does not separately persist:

```ts
interface GeneratedPlan {
  chapters: Array<{ title: string; sections: Array<{ title: string; hint?: string }> }>;
}
```

On approval the plan seeds `POST /api/thesis` (chapters + their sections created in one shot).

---

## 4. Server work (`~/modakerati-server`)

1. **`POST /api/thesis/generate-plan`** — body `{ title, templateId, language }` → `GeneratedPlan`.
   - Prompt-constrained JSON (same manual-parse style as `routes/enhance.ts`), seeded by the template's `chapterStructure` so the outline respects the faculty's expected structure.
   - Best-effort: on failure the **app** falls back to the template's `chapterStructure` (chapters only, empty sections).
2. **`POST /api/thesis`** — extend to accept a full `{ chapters: [{ title, sections: [{title}] }], frontMatter, templateId, language }` so an approved plan is created in one call (today it takes `chapters: string[]`). Keep the old shape working.
3. **Section-targeted chat** — `/api/chat/stream` and `/api/chat/send` accept an optional `sectionId` (alongside the existing `chapterId`); the tool system prompt is told which section is in focus so edits land there.
4. **`GET /api/thesis/:id/preview-html`** — returns a self-contained paginated HTML document (template fonts/margins/paper size, title page, résumé, TOC, chapters) for the A4 WebView preview. Reuses the export tree builder; **read-only**.
5. **(P5) Export fidelity** — upgrade `docx.ts`/`latex.ts` to parse markdown (tables, bold, headings, lists) and emit résumé + TOC pages, so ⤓ download matches the in-app render.

All new routes use the existing Supabase-JWT auth middleware and scope by `userId`.

---

## 5. App architecture (`~/modakerati`)

### 5.1 Routes / screens

| Route | File | Status | Purpose |
|---|---|---|---|
| `new-thesis` sheet | `components/NewThesisSheet.tsx` | **changed** | Capture title + AI suggestions; **no longer creates** the thesis — routes to template picker carrying the title. |
| `(app)/template-picker` | exists | minor | "Blank" path also carries the title into the flow. |
| `(app)/template-preview` | exists | **changed** | "Use this template" → navigates to the **plan** step (not create+chat). |
| `(app)/thesis-plan` | **NEW** | new | Editable AI-generated outline; "Create" persists the thesis and routes to the workspace. |
| `(app)/thesis-workspace` | **NEW** | new | Paper-card preview + embedded chat composer. Primary authoring surface. |
| `(app)/thesis-preview-a4` | **NEW** | new | Full-screen WebView A4 preview + download. |

The wizard carries state (title, templateId, plan) in a small `thesis-wizard-store` Zustand slice (not route params) — the thesis row is **not** created until plan approval.

### 5.2 Components

- `ThesisPlanEditor` — reorderable list of chapters with add/remove/rename sections; "Regenerate plan" and per-row "AI suggest sections" actions.
- `DocumentWorkspace` — scrollable list of `PaperPage`s; owns `selectedSectionId`; refetches `getThesis(id)` after each AI turn.
- `PaperPage` — white card with shadow on a grey canvas; variants: `title`, `resume`, `toc`, `content`.
- `SectionCard` — renders section markdown via the existing `Markdown` component; tap selects (highlight + sets context chip); empty → "Ask AI to draft this" placeholder.
- `WorkspaceComposer` — chat input pinned at the bottom; shows the "✎ editing <section>" context chip (clearable); sends through `lib/ai-service` with `chapterId`/`sectionId`; reuses streaming + "thinking" indicator.
- `A4PreviewWebView` — loads `/api/thesis/:id/preview-html`; pager + ⤓ download (calls existing export).

### 5.3 State

- New `thesis-wizard-store` (transient wizard state: title, templateId, plan) — cleared on completion/cancel.
- Extend `thesis-store` with `selectedSectionId` and a `refreshThesis(id)` helper that calls `getThesis` and updates the cache.

### 5.4 Reuse

gorhom conditional-unmount sheet pattern, `Markdown`, `lib/ai-service` streaming, chat "thinking" frames, the `BottomSheet` store, and the existing `export_thesis` MCP tool / export route.

---

## 6. Live-edit data flow

1. User selects a section → `selectedSectionId` set → composer shows context chip.
2. User sends a message → `ai-service` streams `/api/chat/stream` with `{ thesisId, chapterId, sectionId, message }`.
3. AI calls MCP tools (`update_section_content`, `add_section`, …) which mutate the **server** tables.
4. On stream completion the workspace calls `refreshThesis(id)` (`getThesis`) and the affected `SectionCard` re-renders with new markdown.
5. ⤢ Expand re-requests `preview-html` to reflect the latest state.

`ask_user` mid-edit surfaces via the existing pending-ask UI (reused inside the workspace, not only the Chat tab).

---

## 7. AI at every step (requirement)

- **Title:** existing `title-suggestions`.
- **Plan:** new `generate-plan` endpoint; "Regenerate" / "suggest sections" inline.
- **Content & tables:** chat → MCP tools, now section-targeted; markdown tables render natively in-app.
- **Quick actions (optional):** per-section "Generate / Expand / Rephrase / Add table" buttons that send canned prompts through the same chat pipeline (no new backend).

---

## 8. Error handling & edge cases

- **Plan generation fails / offline** → fall back to template `chapterStructure` (chapters only); never a blank wall.
- **Chat stream fails** → existing `/send` fallback in `ai-service`.
- **Empty section** → placeholder card inviting an AI draft.
- **A4 render fails** → toast; stay on the cards surface.
- **Abandon wizard** → wizard store cleared; no orphan thesis (creation happens only at plan approval).
- **RTL (Arabic)** → handled by `Markdown` + `getTextDirection`; verify on `PaperPage` and the A4 HTML (`dir="rtl"`, mirrored margins).
- **Concurrency** → server is source of truth; workspace always reconciles via `getThesis` after a turn.

---

## 9. i18n

New nested keys in `locales/{en,fr,ar}.json`:
`thesis.plan.*` (title, regenerate, addSection, createThesis, generating…), `thesis.workspace.*` (titlePage, resume, tableOfContents, askToEdit, editingSection, expand), `thesis.preview.*` (a4Title, page, download, close).

---

## 10. Phasing

- **P1 — Wizard cohesion + Plan step:** wizard store; `generate-plan` endpoint; `thesis-plan` screen; plan-approval creates the thesis with chapters+sections+front matter.
- **P2 — Document workspace (read):** `thesis-workspace`, `PaperPage`, `SectionCard` rendering front matter + chapters/sections from markdown.
- **P3 — Embedded AI chat editing:** `WorkspaceComposer`, section targeting (`sectionId` end-to-end), live `refreshThesis`, pending-ask in workspace.
- **P4 — A4 expand preview:** `preview-html` endpoint + `A4PreviewWebView` + ⤓ download.
- **P5 — Export fidelity (flagged):** markdown→docx tables/formatting + résumé/TOC pages in `docx.ts`/`latex.ts`.

Each phase is independently shippable and testable. P1–P4 deliver Scenario 1 end to end; P5 closes the export gap.

---

## 11. Open risks

1. **Export fidelity (P5)** — accepted: tables render in-app first, faithful `.docx` later.
2. **Plan JSON reliability** — model returns malformed JSON. Mitigation: constrained prompt + parse-with-fallback to `chapterStructure`.
3. **A4 pagination in WebView** — CSS paged rendering across iOS/Android WebViews can vary. Mitigation: keep it read-only and simple (page-sized blocks), validate on both platforms in P4.
4. **DB migration** — adding `front_matter`/`resume` columns must be backward-compatible (nullable) and coordinated with the live server.

---

## 12. Testing

- **Server:** unit-test `generate-plan` JSON parsing + fallback; route tests for extended `POST /api/thesis` (plan shape) and `sectionId` plumbing; snapshot the `preview-html` for a fixture thesis.
- **App:** component tests for `ThesisPlanEditor` (reorder/add/remove), `SectionCard` (markdown incl. a table, empty placeholder, selection), `WorkspaceComposer` (context chip set/clear, sends `sectionId`). Manual: full flow EN/FR/AR incl. RTL, offline fallback, ⤢ expand + download.
