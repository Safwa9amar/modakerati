# Enriched, Reordered Creation Wizard + Streaming Plan

**Date:** 2026-07-24
**Status:** Design approved, pending spec review
**Repos:** `~/modakerati` (Expo app) + `~/modakerati-server` (Hono/Drizzle)
**Builds on:** `2026-07-24-template-placeholders-design.md` (the Cover step is that feature's `thesis-fields` screen).

## Problem

Two issues with the current create-thesis wizard:

1. **The plan is generated too early and from too little.** Today `template-preview`'s "Use template" immediately calls `POST /api/thesis/generate-plan`, which feeds the AI **only the title** (`Thesis title: ${input.title}` — `src/lib/thesis-plan.ts:48`). The student has given no description, objectives, or methodology, so the outline is generic.
2. **The call takes ~61s and shows a blind wait.** `generate-plan` returns one JSON blob; there is no progress feedback.

The user wants the student to **fill all details first** (cover tokens **and** a topic brief), and **then** generate the plan from the full picture, with the outline **streaming in** so the wait feels alive.

### Current state (verified)

- **Flow:** `NewThesisSheet` (title+language) → `template-picker` → `template-preview` → `thesis-fields` (cover tokens) → `thesis-plan` (edit + create).
- `template-preview.tsx` `handleUseTemplate` sets the template **and** generates the plan, then routes to `thesis-fields` (if the template has placeholder fields) or `thesis-plan`.
- `thesis-fields.tsx` `handleContinue` routes to `thesis-plan`.
- `thesis-plan.tsx` reads `wiz.plan`; if absent on mount it generates once (`useEffect`), showing a centered loader. `handleCreate` calls `createThesis({ title, templateId, language, normProfileId, frontMatter, sections })`.
- **Endpoint:** `POST /api/thesis/generate-plan` (`src/routes/thesis/ai-suggest.ts:24`) → `generatePlan()` (`src/lib/thesis-plan.ts:15`). Non-streaming JSON. Input `{ title, language, bodyPreset, templateId }`. A template with a fixed `bodyStructure` returns it verbatim (no AI). On any AI error → deterministic fallback plan.
- **Client:** `generateThesisPlan()` (`lib/api.ts:457`) is a plain `apiPost` (non-streaming).
- **Streaming precedent:** the server already streams via hono `streamText` (`src/routes/thesis/ai-suggest.ts`, chat/completion routes); the app already consumes AI streams for chat.
- **Wizard store:** steps `"template" | "title" | "fields" | "plan" | "confirm"`; holds `title, language, templateId, normProfileId, supervisor, academicYear, fieldValues, plan`.

## Goals

1. Reorder so plan generation happens **after** the student fills everything.
2. Collect a **topic brief** (description, objectives/research-questions, keywords, methodology) and feed it into plan generation.
3. **Stream** the generated outline so sections appear one by one.
4. Persist the brief so it isn't lost (and can seed the abstract later).

## Non-goals (this build)

- Auto-generating a résumé/abstract from the description.
- Swapping the AI model for speed (a config lever; streaming addresses perceived latency).
- Changing the plan editor (`thesis-plan`) beyond adding a streaming/live-fill mode.

## Design

### 1. New flow

```
NewThesisSheet (title+lang) → template-picker → template-preview
  → Topic (new)  → Cover details (existing thesis-fields)  → thesis-plan (streams, then editable) → create
```

- `template-preview.tsx` **stops generating the plan.** "Use template" records the template + language and routes to the **Topic** step.
- Generation is triggered by the **last fill step's** Continue:
  - Topic Continue → if the template has `config.placeholderFields` → **Cover** (`thesis-fields`); else → `thesis-plan` (triggers streaming).
  - Cover Continue → `thesis-plan` (triggers streaming).
- `thesis-plan` is the streaming target: on arrival with no `wiz.plan`, it opens the stream and renders sections **as they arrive** (live-fill), then they become editable when the stream ends. This reuses the existing "generating" state instead of adding a separate screen.

### 2. Topic step — new screen `app/(app)/thesis-topic.tsx`

Fields, written to the wizard store as `brief`:

| field | widget | required |
|---|---|---|
| `description` | multiline textarea | **yes** |
| `objectives` | multiline textarea | no |
| `keywords` | single-line, comma-separated | no |
| `methodology` | single-select chips: `experimental \| theoretical \| case_study \| survey \| mixed` | no |

Required `description` gates Continue. RTL-aware. Labels via i18n `wizard.topic.*`.

### 3. Cover details step

The **existing** `thesis-fields.tsx` is **unchanged** — its Continue still routes to `thesis-plan`. What moves is *generation*: it no longer runs in `template-preview`; it runs in `thesis-plan`. The "does this template have placeholder fields?" branch that used to live in `template-preview` **relocates to the Topic step** (Topic Continue → `thesis-fields` if the template has fields, else straight to `thesis-plan`).

### 4. Streaming plan generation

**Server** — upgrade `POST /api/thesis/generate-plan` to stream via hono `streamText` (keep the same path; detect streaming by an `Accept: application/x-ndjson` header or a `stream: true` body flag so any non-streaming caller still works).

- **New input:** `brief: { description, objectives?, keywords?, methodology? }` alongside the existing `title/language/bodyPreset/templateId`.
- **Prompt** (`src/lib/thesis-plan.ts`) is refactored to include the brief — description, objectives, keywords — not just the title. `methodology` also selects the structure preset hint: `experimental → imrad`, `case_study/survey → chapters`, `theoretical → law-humanities`, else the template's `bodyPreset`.
- **Wire format: NDJSON, one section per line.** The system prompt instructs the model to emit **one JSON section object per line** (`{"title":…,"kind":…,"chapters":[…]}`), no wrapping array. The handler relays each completed line as it arrives. The client appends each parsed section → titles pop in. This avoids parsing a half-finished array. *(Rejected alternative: stream raw model tokens and parse JSON client-side — fragile on partial tokens.)*
- **Fixed-`bodyStructure` templates:** emit those sections immediately (no AI), one NDJSON line each — same client code path.
- **Fallback:** on model/stream error mid-way, finish the stream with the deterministic fallback sections (as today) so the client always ends with a usable plan. Generation never blocks creation.
- Extract the prompt/preset logic into a pure `buildPlanPrompt(input)` so it is unit-testable without a live model.

**Client** — new `streamThesisPlan(input, onSection, onDone)` in `lib/api.ts`.

- **RN caveat:** React Native's core `fetch` does not expose a readable stream body. Consume the NDJSON via the app's **existing AI-stream mechanism** (the same reader the chat/completion features use — `expo/fetch` streaming or the current SSE/XHR reader). The implementation plan will point at the exact existing util; do **not** hand-roll a new transport.
- `thesis-plan.tsx` calls `streamThesisPlan`, pushing each section into `localPlan` as it arrives (animated insert), and marks the list editable + syncs `wiz.plan` on `onDone`. On error → deterministic fallback already delivered by the server.

### 5. Persistence

`brief` is added to the wizard store and sent by `createThesis`. Stored in `theses.frontMatter.brief` (jsonb — **no migration**). `description` is thereby available to later seed the thesis abstract/résumé (out of scope now). The cover-token substitution is registry-gated, so the extra `brief` key is ignored by the `.docx` fill.

### 6. Error handling / edge cases

- Description empty → Continue disabled on the Topic step.
- Template with no placeholder fields → Cover step skipped; Topic routes to `thesis-plan`.
- Stream fails to start → fall back to the non-streaming `generateThesisPlan` (kept) so a plan still appears.
- Back-navigation from `thesis-plan` to Cover/Topic preserves `brief` and `fieldValues` (wizard store persists until `reset()` on successful create).
- Blank/no-template path (norm-profile / "Blank") is unchanged: it uses the existing `thesis-title` path and non-streaming generation (Topic/Cover are template-flow steps only). *(Optional future: bring the Topic step to the blank path too.)*

### 7. i18n & testing

- New keys under `wizard.topic.*` (step title/subtitle, description, objectives, keywords, methodology + the five methodology option labels) and generating-state strings, in `locales/{en,fr,ar}.json`, edited **surgically** (duplicate-key gotcha — never reserialize).
- **Server (vitest):** `buildPlanPrompt` includes brief fields and maps methodology→preset; NDJSON relay emits one valid JSON object per line and ends with fallback on simulated error.
- **App:** `npx tsc --noEmit` + device QA — the live-fill outline, description-required gate, methodology chips, and Arabic RTL, on the template flow.

## File-by-file change list

**Server**
- `src/lib/thesis-plan.ts` — accept `brief`; extract `buildPlanPrompt`; methodology→preset; NDJSON streaming generator + fallback-at-end.
- `src/routes/thesis/ai-suggest.ts` — `POST /generate-plan` streams (NDJSON) when requested; non-streaming path retained.
- `src/__tests__/thesis-plan.test.ts` — **new**: prompt builder + NDJSON relay/fallback tests.

**App**
- `stores/thesis-wizard-store.ts` — add `"topic"` step + `brief: { description, objectives, keywords, methodology }`.
- `app/(app)/thesis-topic.tsx` — **new**: topic brief form.
- `app/(app)/template-preview.tsx` — stop generating the plan; route to `thesis-topic` (unconditionally).
- `app/(app)/thesis-fields.tsx` — **no change** (still routes to `thesis-plan`); the has-fields branch it used to be selected by now lives in `thesis-topic`.
- `app/(app)/thesis-plan.tsx` — stream the plan on arrival (live-fill), then editable; back-nav preserves store.
- `lib/api.ts` — `streamThesisPlan()` (streaming) + `createThesis` sends `brief`; keep `generateThesisPlan` as fallback.
- `locales/{en,fr,ar}.json` — `wizard.topic.*` + generating strings (surgical).

## Open risks

1. **RN streaming transport** — must reuse the app's proven AI-stream reader (chat/completion); RN core `fetch` has no stream body. Confirmed as a design constraint; the plan pins the exact util.
2. **NDJSON discipline from the model** — the model must emit one object per line; the server parses defensively (skip un-parseable partial lines, buffer until newline) and always closes with the fallback if it produced nothing.
3. **Methodology→preset vs template `bodyPreset`** — methodology refines within the template's intent; if a template has a fixed `bodyStructure` it still wins (structure is the template's).
