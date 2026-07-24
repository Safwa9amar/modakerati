# Template Placeholders → Wizard-Filled Covers

**Date:** 2026-07-24
**Status:** Design approved, pending spec review
**Repos:** `~/modakerati` (Expo app) + `~/modakerati-server` (Hono/Drizzle)

## Problem

A template `.docx` can contain placeholders for user-specific data — e.g. the
Nour Bachir El Bayadh cover uses `{title}`, `{subtitle}`, `{student_name}`,
`{supervisor_name}`, `{institute_name}`, `{class_name}`, `{branch_name}`,
`{specialty_name}`. Today nothing collects that data from the user at create
time and writes it into the copied template, so the cover ships with raw tokens
still in it.

### Current state (verified)

- **Docx-as-template model.** A thesis is created by copying a ready `.docx`
  from the `templates` Supabase bucket (`src/lib/template-storage.ts`). The seed
  builder copies it when `template.docxPath` is set
  (`src/lib/docx.ts:141-153` `buildSeedDocxBuffer` → `buildDocFromTemplate`).
- **Substitution exists but is hardcoded and double-brace only.**
  `templatePlaceholders()` (`src/lib/docx.ts:158-176`) maps a *fixed* token set
  (`title`, `author`/`authors`, `supervisor`, `university`, `faculty`,
  `department`, `specialty`, `year`/`academicYear`) and the replace loop
  (`docx.ts:199-204`) only handles `{{token}}`. There is **no** `{single_brace}`
  support and **no** `student_name`/`institute_name`/`class_name`/`branch_name`
  tokens.
- **Values come from `theses.frontMatter` (jsonb) with profile fallback.** But
  `frontMatter` is populated only from `body.frontMatter` on create
  (`src/routes/thesis.ts:2045`).
- **The data pipe is broken end-to-end.** The wizard's template path
  (`NewThesisSheet` → `template-picker` → `template-preview` → `thesis-plan`)
  **skips** `thesis-title`, so it collects no cover data; and `createThesis()`
  (`lib/api.ts:406-416`) sends only `{ title, templateId, language,
  normProfileId, sections }` — never `frontMatter`. So `theses.frontMatter`
  stays `{}` and every cover token resolves to empty/profile-fallback.
- **No template declares its required fields.** A template only implicitly
  "declares" fields by containing token strings; nothing lists which inputs a
  template needs.

## Goals

1. A template's needed fields are **auto-detected** from its `.docx` and looked
   up in a **single canonical registry** (label/type/required/prefill).
2. The create wizard shows a **dedicated form step** for exactly the fields the
   chosen template needs, prefilled from the user's profile.
3. Those values are sent on create and **substituted into the copied `.docx`**,
   robustly (RTL, run-split-safe), leaving no raw tokens in the delivered doc.
4. Works for **any** template (generality), proven end-to-end on the
   starter/generic template.

## Non-goals (this build)

- Authoring the real Nour Bachir cover `.docx` with tokens (that cover's
  bordered/RTL textbox layout is authored separately once the mechanism is
  trusted).
- Re-editable/live placeholders after create — substitution is one-shot; later
  edits happen in the workspace as normal body text.
- A live client-side cover preview that fills as you type.

## Design

### 1. Canonical field registry — server source of truth

New `src/lib/template-fields.ts` exporting one constant. Each field:

```ts
type TemplateField = {
  key: string;                    // canonical, e.g. "student_name"
  type: "text" | "multiline" | "year";
  required: boolean;
  prefill?: "profile.fullName" | "profile.university"
          | "profile.department" | "currentYear";
  aliases?: string[];             // legacy/alt tokens that map to this field
};
```

Initial registry:

| key | type | required | prefill | aliases |
|---|---|---|---|---|
| `title` | text | yes | — | — |
| `subtitle` | text | no | — | — |
| `student_name` | text | yes | profile.fullName | `author`, `authors` |
| `supervisor_name` | text | no | — | `supervisor` |
| `institute_name` | text | no | profile.university | `university` |
| `class_name` | text | no | profile.department | `department` |
| `branch_name` | text | no | — | `branch` |
| `specialty_name` | text | no | — | `specialty` |
| `academic_year` | year | no | currentYear | `year`, `academicYear` |

The registry is the **single source of truth** driving (a) which tokens are
recognized during scan, (b) the wizard form's field types/required/prefill, and
(c) the substitution loop. Adding a new field = one registry row (+ three i18n
label strings).

### 2. Token format & matching

- **Single-brace `{key}` is the authoring convention** (matches the real
  templates). **Double-brace `{{key}}` stays supported** for the existing
  starter template.
- **Registry-gated matching.** Only tokens whose key is a registry key *or
  alias* are treated as placeholders. A stray `{foo}` (unknown key) is left
  untouched — this removes single-brace's false-match risk.
- **Run-split safe.** Word fragments a token across runs (the red squiggles in
  the source template are `w:proofErr` marks that split runs). Substitution must
  match a token even when `{`, `title`, `}` land in separate runs.
  - **Risk / verification:** confirm whether `mdocxengine`'s
    `findAndReplaceAll` already normalizes cross-run text. If it does not, add a
    paragraph-level pass that concatenates run text, locates token spans against
    the registry, and rewrites the runs. This is the primary technical risk and
    is verified first during implementation with a fixture `.docx` that contains
    a proofErr-split token.

### 3. Auto-detect — scan at publish, store on the template

At template publish/upload (admin `POST /api/templates`
`src/routes/template.ts:21-60`, and the `publish-*-template.ts` scripts):

1. After the `.docx` is stored, scan its full text for `{key}` / `{{key}}`
   tokens.
2. Intersect found keys with the registry (resolving aliases → canonical key).
3. Store the resulting ordered, deduped descriptor list on
   **`templates.config.placeholderFields`** (jsonb — **no DB migration**), as
   `[{ key, type, required, prefill }]` in registry order.

`GET /api/templates` (and `GET /api/template/:id`) then already carry each
template's field list; the app needs no extra call.

**Backfill:** a one-shot `scripts/backfill-template-fields.ts` re-scans every
active template and populates `config.placeholderFields`.

### 4. App — dedicated form step

- **Store** (`stores/thesis-wizard-store.ts`): add `"fields"` to `WizardStep`;
  add `fieldValues: Record<string, string>` (+ setter).
- **Screen** `app/(app)/thesis-fields.tsx`, inserted **after `template-preview`,
  before `thesis-plan`**. `template-preview` routes to `fields` when the chosen
  template has ≥1 `placeholderFields`, else straight to `thesis-plan`.
- Renders one input per descriptor:
  - input widget from `type` (`text`/`multiline`/`year`),
  - **label from i18n `wizard.fields.<key>`** (en/fr/ar),
  - **prefilled** by resolving `prefill` against the loaded user profile
    (fullName/university/department) or current academic year.
- **Required fields gate Continue.** Optional fields may be left blank.
- **RTL** honored (the screen already runs under `I18nManager` for `ar`).

### 5. Data flow on create

- `thesis-fields.tsx` writes `fieldValues` into the wizard store.
- `thesis-plan.tsx` `handleCreate` builds `frontMatter` from `fieldValues`
  (canonical keys) and passes it to `createThesis()`.
- `lib/api.ts` `createThesis()` gains an optional `frontMatter` field in its
  input and forwards it in the `POST /api/thesis` body.
- Server `POST /api/thesis` already stores `body.frontMatter` on
  `theses.frontMatter` (`thesis.ts:2045`) — no change there.
- `src/lib/docx.ts`: **refactor `templatePlaceholders()` to iterate the
  registry** — for each registry field, value = `frontMatter[key]` (or an
  aliased key) with profile fallback; the replace loop matches both `{key}` and
  `{{key}}`, registry-gated and run-split-safe.

### 6. Substitution behavior

- **Alias direction (disambiguation).** The app always writes **canonical
  keys** into `frontMatter` (e.g. `frontMatter.student_name`). Aliases exist
  only to recognize *doc tokens*: a template containing either `{student_name}`
  or the legacy `{author}` is filled with the value of the canonical
  `student_name` field. So each canonical field is filled once, regardless of
  which alias token the template used.
- Required fields always have a value (form-enforced).
- **Optional blanks → replaced with `""`** — never leave a literal token in the
  delivered doc.
- Unknown `{...}` preserved.
- Runs over body **and headers/footers** if the engine's replace covers them
  (verify; boilerplate identity lines often live in the header).

### 7. Edge cases & errors

- Template with **zero detected fields** → wizard skips the `fields` step.
- **Scan failure** at publish → store empty list; template still usable (no
  form, no fill).
- **Substitution failure** → keep the existing fallback (log, leave the doc,
  don't crash).
- **Blank / no-template path** → no `fields` step; unchanged behavior.
- **Profile missing** a prefill source → that field renders empty (user fills).

### 8. Testing & i18n

- **App:** no JS test runner — gate with `npx tsc --noEmit` + running the app
  (device QA of the new step on the template path, incl. `ar` RTL).
- **Server unit tests:**
  - scan: fixture `.docx` → expected canonical key list (incl. alias
    resolution and a proofErr-split token);
  - substitution: `frontMatter` values fill both `{key}` and `{{key}}`, unknown
    tokens preserved, optional blank → `""`, cross-run token replaced.
- **i18n:** add `wizard.fields.<key>` for every registry field + step title/CTA
  to `locales/{en,fr,ar}.json`, edited **surgically** (duplicate-key gotcha —
  never `json.load`/`dump`; the files contain duplicate keys and reserializing
  drops them).

## File-by-file change list

**Server**
- `src/lib/template-fields.ts` — **new**: registry + helpers
  (`scanPlaceholders(text)`, `resolveAlias(key)`, `fieldDescriptors(keys)`).
- `src/lib/docx.ts` — refactor `templatePlaceholders()` to be registry-driven;
  make the replace loop single+double brace, registry-gated, run-split-safe.
- `src/routes/template.ts` — scan on publish; write `config.placeholderFields`.
- `src/routes/thesis.ts` — (no logic change; confirm `body.frontMatter` path).
- `scripts/publish-starter-template.ts`, `publish-elbayadh-template.ts` — scan
  + persist `config.placeholderFields` on publish.
- `scripts/backfill-template-fields.ts` — **new**: backfill existing templates.
- `src/__tests__/template-fields.test.ts` — **new**: scan + substitution tests.

**App**
- `stores/thesis-wizard-store.ts` — add `"fields"` step + `fieldValues`.
- `app/(app)/thesis-fields.tsx` — **new**: dynamic form screen.
- `app/(app)/template-preview.tsx` — route to `fields` (or skip to `plan`).
- `app/(app)/thesis-plan.tsx` — build + send `frontMatter` from `fieldValues`.
- `lib/api.ts` — `createThesis()` accepts + forwards `frontMatter`.
- `locales/{en,fr,ar}.json` — `wizard.fields.*` + step labels (surgical edit).

## Open risks

1. **Cross-run / proofErr token splitting** (§2) — the make-or-break detail;
   verified first with a fixture.
2. **Prefill mapping correctness** — `institute_name` ← profile.university and
   `class_name` ← profile.department are best-guess mappings; confirm against
   real profile data during device QA.
3. **Alias collisions** — the starter template's `{{author}}`/`{{university}}`
   must resolve to `student_name`/`institute_name` without double-filling.
