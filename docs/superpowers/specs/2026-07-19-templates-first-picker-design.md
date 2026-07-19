# Templates-First Picker + Template Variable Filling — Design

**Date:** 2026-07-19
**Status:** Approved design, pre-implementation-plan
**Scope:** Cross-repo (app + server + dashboard). Delivered in two phases — Phase 1 is app-only and buildable now; Phase 2 needs the server tree unblocked.

---

## 1. Goal

1. **Templates-first picker (Phase 1):** the app's "Choose a template" screen lists the **uploaded `.docx` templates** (admin-imported, with PDF preview) instead of norm profiles. Model **A**.
2. **Template variable filling (Phase 2):** a template's `.docx` contains **`{token}` placeholders** (single braces) on its cover / front matter; when a student picks a template, the app collects their data and the server **replaces each `{token}` with the value** while seeding the thesis.

## 2. Placeholder convention

- **Single braces:** `{token}` — e.g. `{first_name}`, `{last_name}`, `{title}`, `{subtitle}`, `{institut_name}`, `{class_name}`, `{branch_name}`, `{specialty_name}`, `{supervisor}`, `{year}`.
  - Example cover line: `Hello {first_name} {last_name}` → `Hello Ahmed Belkacem`.
  - (The earlier sample template used `{{double}}` braces; we standardize on **single** `{token}` for uploaded templates. The legacy `assets/thesis-base.docx` keeps its own `{{…}}` cover — unaffected; this feature targets *uploaded* templates.)
- **Token grammar:** `{` + a name of word-chars/spaces + `}` → regex `\{([A-Za-z0-9_][A-Za-z0-9_ ]*)\}`. Minor caveat vs `{{…}}`: single braces are marginally more collision-prone, but on thesis cover pages this is safe.

## 3. Context (traced through code)

- **Picker** (`app/(app)/template-picker.tsx`) currently lists **norm profiles** (`loadNormProfiles`, sets `normProfileId`), not templates.
- **Templates** (`templates` table; `docx_path`; `config.pdfUrl` for preview) are surfaced only in `template-preview.tsx` (which now previews the PDF via `PdfView`).
- **Data model:** `theses.template_id` → the **starting document** (thesis `.docx` seeded by copying the template's `.docx` — `buildDocFromTemplate` in server `lib/docx.ts`). `theses.norm_profile_id` → **formatting rules**. Both nullable; `createThesis({ templateId?, normProfileId?, frontMatter?, … })` already accepts them.
- **The fill machinery mostly EXISTS server-side:**
  - `starter-template.ts` already uses `{{…}}` placeholders "the create flow fills."
  - `templates` and `theses` each have a **`front_matter` jsonb** ("page-de-garde fields").
  - `createThesis` (server `routes/thesis.ts`) already accepts `body.frontMatter` and builds defaults (`academicYear`, `university`, `authors` from `profile.fullName`).
  - **mdocxengine** exposes `replaceText(find, replace)` / `findAndReplaceAll` (tested) — so replacing `{token}` in a seeded `.docx` is a one-liner per token.
- **The gap:** uploaded templates use **custom** tokens beyond the standard set, and nothing discovers them or drives a fill form. Phase 2 closes this.

---

## 4. Phase 1 — Templates-first picker (app-only, buildable now)

### 4.1 What the picker shows
`template-picker.tsx` lists **active uploaded templates** (`is_active`) from the store's templates (same source `template-preview` reads). Each card keeps the current look — name + 🎓 `university`, 📖 `discipline`, 🌐 `language`, citation badges — plus a small doc **thumbnail** and a green **PDF** tag when `template.config.pdfUrl` exists. The filter row (university/discipline/language) and the **Blank** card stay.

### 4.2 Flow
Tap a template → `router.push("/(app)/template-preview?templateId=<id>")` → the preview screen (specs + chapter structure + **Preview document** PDF) → **"Use template"** (existing `handleUseTemplate`: sets `wizard.templateId` + language, generates plan, routes to `thesis-plan`) → `createThesis({ templateId })`. Server seeds the thesis `.docx` as a copy of the template's file.

### 4.3 Norm profiles — retained, not primary
- A bottom link **"No template fits? Start with a formatting profile"** opens the current norm-profile list (unchanged `handleSelect(normProfile)` → sets `normProfileId` → `thesis-title`).
- **Zero-template fallback:** if there are no active templates, the picker renders the norm-profile list (today's behavior) so it's never empty.
- Template-based theses keep `norm_profile_id = null`.

### 4.4 Files (Phase 1, app-only)
- `app/(app)/template-picker.tsx` — list active templates; thumbnail + PDF tag; tap → `template-preview?templateId=`; fallback link + zero-template fallback; keep filters + Blank.
- `stores/thesis-store.ts` — ensure a templates loader runs on picker mount (reuse whatever populates `templates` for `template-preview`).
- `types/thesis.ts` — `Template` already carries `university`, `language`, `citationStyle`, `config.pdfUrl`; confirm `discipline` is present (else drop that badge).
- `locales/{en,fr,ar}.json` — fallback-link text + any new labels, aligned.
- `template-preview.tsx` — no change (already accepts `templateId`, shows PDF, sets `templateId`).

---

## 5. Phase 2 — Template variable filling (cross-repo; server-gated)

### 5.1 Discover tokens at upload (server + dashboard)
When a template's `.docx` is created/replaced, the **server** scans it for `{token}` occurrences (mdocxengine reads the doc text; regex `\{([A-Za-z0-9_][A-Za-z0-9_ ]*)\}`, de-duplicated in first-seen order) and stores a **field list** on the template:
```
config.fields = [ { token: "institut_name", label: "Institut", labelFr, labelAr, autofill?: "author"|"title"|"year"|null }, ... ]
```
- **Where the parse runs:** the dashboard currently uploads the `.docx` straight to storage (bypassing the server), so it can't parse there. Options (decide in the plan): (a) route dashboard template create/replace **through the server's `POST /api/templates`** so the server parses + stores `config.fields`; or (b) add a small server endpoint `POST /api/templates/:id/scan` the dashboard calls after upload. Either way the parse is **server-side** (needs mdocxengine).
- **Admin control (dashboard):** the template detail shows the detected fields; the admin can edit each field's human label (fr/ar/en) and mark auto-fillable ones (`author`, `title`, `year`). Stored back in `config.fields`.
- **Auto-fill hints:** tokens matching known names get defaults — `author`/`{first_name}`/`{last_name}` → student profile, `title` → the wizard title step, `year` → `academic_year`.

### 5.2 Fill form (app)
After **"Use template"** (or as a step between preview and plan), the app shows **"Fill your details"** — one input per `template.config.fields` entry, labelled per locale, with auto-filled fields pre-populated (student name, title, year) and editable. On submit, the values become a `frontMatter` / `placeholderValues` map passed into `createThesis`.

### 5.3 Replace at seed (server)
During `seedThesisDoc` / `buildDocFromTemplate`, after copying the template `.docx`, the server calls `engine.replaceText("{" + token + "}", value)` for each provided value (and clears any unfilled `{token}` to empty). The thesis is stored with `front_matter` = the filled map.

### 5.4 Files (Phase 2)
- **server** (`~/modakerati-server`, **blocked on dirty tree**): token scan on template create/replace (+ store `config.fields`); `{token}` replacement in `buildDocFromTemplate`/`seedThesisDoc` from the passed values; accept the values map in `createThesis` (extends existing `frontMatter`).
- **dashboard** (`~/modakerati-dashboard`): route template create/replace through the server scan (or call the scan endpoint); a template-detail "Fields" panel to review/edit labels + auto-fill flags.
- **app** (`~/modakerati`): the "Fill your details" form driven by `template.config.fields`; pass values to `createThesis`; auto-fill from profile/wizard.

## 6. Phasing / blockers

- **Phase 1 (picker)** — app-only, buildable now (no server/dashboard change).
- **Phase 2 (fill)** — needs the **server tree committed/stashed** (currently 42 uncommitted files) before the server scan/replace can be implemented; the dashboard fields-panel and the app fill-form can be built against the `config.fields` contract once it's agreed, but they're inert until the server populates/consumes it.

## 7. Verification (app has no JS test runner → tsc + run)

- **Phase 1:** `npx tsc --noEmit` clean; run the app — picker lists uploaded templates, tap → preview (PDF), "Use template" creates a thesis copied from the `.docx`; zero-template fallback to profiles; filters + Blank work; trilingual + RTL.
- **Phase 2:** upload a template with `{tokens}` → dashboard shows detected fields → app fill form appears with those fields (auto-filled where known) → created thesis has the tokens replaced on its cover.

## 8. Non-goals

- No merging of the `templates` and `norm_profiles` tables.
- No new PDF rendering (reuse `PdfView`).
- No rich placeholder types beyond text fill (no conditionals/loops) in this iteration.
- Phase 1 makes **no** server or dashboard change.

## 9. Risks & notes

- **Single-brace collisions** — low risk on covers; the scan can ignore tokens with unusual characters.
- **Dashboard uploads bypass the server** — so the parse needs either routing template create through the server or a scan endpoint (decide in the plan).
- **App repo has unrelated chat WIP** — stage only feature files; never `git add -A`.
- **Server tree blocked** — Phase 2 server work waits on it (same gate as Plan 1).
