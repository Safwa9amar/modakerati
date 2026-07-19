# Workspace Writing Experience Redesign — Design

- **Date:** 2026-07-19
- **Status:** Approved for spec (brainstorming complete; awaiting user review before planning)
- **Scope:** The thesis/memoir workspace — the composer/formatting surface **and** the document view modes.
- **Related code recon:** captured inline below (file paths + line refs from read-only exploration on 2026-07-19).

---

## 1. Problem / Motivation

The workspace crams too many unrelated jobs into one place, on two axes:

**The composer sheet** (`components/workspace/WorkspaceComposerSheet.tsx`, 653 lines) is a single permanently-mounted bottom sheet that holds: a scope chip, an Edit⇄AI mode toggle, an AI status line, a prompt input, quick-action chips, and a mixed "TOOLS" row (Sources/Outline/Export/Regenerate/Think) — plus transient confirm/ask surfaces, bulk-select actions, keyboard-docking choreography, selection math, and business-logic dispatch. Users reported (all pain points selected, "Edit vs AI fight for space" loudest): too crammed, two modes fighting for one space, common tasks take too many steps, tools are a random grab-bag, scope is confusing, and the sheet eats the document.

**The view modes** — `docx`, `outline`, `pdf` (`workspace-store.ts` `DocViewMode`) — are three separately-rendered surfaces the user cycles through (`WorkspaceViewSwitcher.tsx` cycles docx→outline→pdf). Switching reloads/loses place, and two of the three (OnlyOffice docx + pdf) can't be edited. The docx-preview fallback that *is* editable relies on brittle text-matching to resolve a tapped paragraph.

**Primary usage** (confirmed by the user): **"AI writes, I steer"** — the AI assistant should be the star; manual formatting is secondary/contextual.

## 2. Goals

- Make **AI the permanent star**; demote manual formatting to a **contextual, on-canvas** helper.
- **Separate concerns** so each surface has one job (both in UX and in code).
- Make the **most common tasks 1-tap** and keep the document maximally visible.
- Collapse three view modes into **one fast editing surface + on-demand preview**.
- Layer in a set of **friendly & fast** enhancements the user selected.

## 3. Non-goals (explicitly deferred to a later phase)

- **Inline run-level formatting** — bold/italic/underline/color/size *inside* a paragraph. The data model (`DocBlockDTO`) does not carry it today; the toolbar's Bold/Italic/color buttons therefore do **not** render/edit natively yet. Deferred to "Phase 2" (§7).
- **Real tables** (borders, widths, merged cells) and **equations/math** as first-class blocks — also blocked on the DTO ceiling. Deferred.
- **Section "peek" preview overlay** (a mid-cost middle-ground preview). Deferred.

---

## 4. Part A — Block-anchored composer & formatting

The single overloaded sheet is replaced by a **clean header + a big document + one context-aware action zone** that changes shape based on selection and keyboard state.

### 4.1 Header (decluttered)

`back · title · undo · redo · ⋯`. **Everything else moves into the `⋯` overflow menu**: Sources, Outline, Export, History, Regenerate, and a Think toggle. Nothing else lives in the header.

- Impacts `thesis-workspace.tsx` header row (currently `:402`, `:439-457`) and the removal/relocation of `WorkspaceViewSwitcher` (see Part B).

### 4.2 Idle state — nothing selected → bottom AI input (whole memoir)

When no block is selected, a **docked AI input at the bottom** prompts the whole memoir:
- Scope pill (e.g. "كل المذكّرة" / "Whole memoir")
- Suggestion chips above the input (Continue writing / Improve flow / Add a section) — sourced from `hooks/useComposerSuggestions.ts`
- Text field + mic + send

This is the only bottom-docked surface, and only in the idle state.

### 4.3 Selected state — a context bar anchored to the block, in two forms

Selecting a block reveals **one context bar** that carries formatting **and** AI, anchored to that block (scope = the block). It has two forms driven by keyboard state:

**(a) Keyboard closed → floating pill** — a compact rounded pill positioned on/under the selected block that **follows the block** (as you scroll or reselect). Contents: the most-used tools + a **(+)** + **✦ Ask AI**. No bottom bar while a block is selected.

**(b) Keyboard open → full-width bar docked on top of the keyboard** — an edge-to-edge accessory bar. It shows the **complete** tool set in a **horizontal scroll**, with **✦ Ask AI pinned** (never scrolls off). The **selection box is hidden while typing** — only the caret shows, plus a scope pill for AI targeting.

Transition: opening the keyboard (tap-to-edit or Ask AI) morphs the pill → full-width bar and hides the selection box; dismissing the keyboard / deselecting collapses back to the pill (or to the idle bottom input if deselected).

### 4.4 Category expansion

- **Simple tools** (Bold, Italic, Underline, …) toggle instantly — no expansion.
- **Category tools** (Style, Align, Color, List, Image, …) **expand a contextual options row** above the bar (e.g. Style → عنوان ١/٢/٣ · نص عادي · اقتباس; Align → right/center/left/justify; Color → swatches; List → bullet/numbered/tasks). The active category is highlighted; ✕ or re-tap collapses. ✦ Ask AI stays pinned throughout.
- **Feasibility:** paragraph-level categories (**Style, Align, Direction, Lists, Move, Image, Delete**) map to existing ops and **work now** (`ComposerEditTools.tsx`, `thesis-ops.ts`: `format`/`move`/`insertImage`/`deleteBlocks`/`startOnNewPage`). Run-level tools (Bold/Italic/color) render but are **inert until Phase 2** — show them disabled/"coming soon" or omit from v1 (decision below in Open Questions).

### 4.5 AI results are inline suggestions

AI output lands **inline in the document as a tracked change**: old text dimmed/struck, new text green, anchored to the target block. Controls: **Approve · Edit (makes the suggestion editable before keeping) · ✗ (reject) · ↻ (ask again)**. Whole-memoir asks stream the same inline suggestions, block by block, reviewed the same way.

- Builds on existing AI dispatch (`lib/ai-service`, chat-store `pendingAsk`/`pendingConfirm`, `docChanges`) but relocates the *presentation* from the sheet into the document (a new inline-suggestion layer on `DocBlock`).

### 4.6 Direct keyboard editing

Tapping into a block lets the user **type and edit directly** with the keyboard (no AI required), via the existing `EditableParagraph` (`DocBlock.tsx:238-358`) → `editText`/`splitParagraph`/merge ops. The context bar (full-width form) rides above the keyboard so format + Ask AI stay one tap away.

### 4.7 Code decomposition (separate concerns in the source too)

`WorkspaceComposerSheet.tsx` (653 lines) is decomposed. Target extractions (leaf presentational components already exist and are clean — `ComposerInput`, `ComposerToolsTray`, `ComposerQuickActions`, `ComposerModeToggle`, `ComposerThinking`):

- `useComposerKeyboardDock` hook — the fragile keyboard listeners / measurement / docked-detent math (`:173-287`).
- `useBlockSelection` hook — the selection-derivation memos (`:94-129`).
- A **BlockContextBar** component family — the pill ⇄ full-width two-form bar + category expansion (new).
- An **InlineSuggestion** layer on `DocBlock` — the approve/edit/reject/again surface (relocated from `ComposerAsk`/`ComposerConfirm`).
- An **IdleAIBar** component — the whole-memoir bottom input.
- Business-logic dispatch (AI send/answer/approve, bulk mutations, tools array) moves into small handlers/hooks, not the view.

The `composerMode: "ai" | "edit"` toggle is **removed** — Edit and AI no longer share a surface (formatting is on the bar; AI is inline). `workspace-store` loses `composerMode`/`setComposerMode`.

---

## 5. Part B — Editing surface (Phase 1)

### 5.1 Outline becomes the single "Writer"

The **outline view** (`OutlineReorderable.tsx` + `DocBlock.tsx`, pure native RN) becomes the one editing surface. It already:
- reads the same `liveDoc.blocks`/`sections` DTO with **no extra fetch**,
- supports inline edit / split / merge, drag-reorder, block formatting, and image insert,
- uses **positional `index`** for selection (removing the docx-preview text-matching fragility).

### 5.2 docx + pdf collapse into one read-only "Preview" (معاينة)

Replace the 3-way `WorkspaceViewSwitcher` cycle with:
- The Writer (default, always editing), and
- A single **"معاينة / Preview"** action (in the header, next to ⋯) that opens a **read-only** rendered look, with a Word vs PDF choice. Exiting returns to the Writer at the same place.

Store changes (`workspace-store.ts`): `DocViewMode` reduces to the Writer + a `previewMode: "docx" | "pdf" | null` (or similar). The docx (`OnlyOfficeView`/`WordDocxView`) and pdf (`PdfView`) layers become preview-only surfaces; their existing lazy lifecycle keyed on `viewMode`/`docVersionKey` is repointed at the preview state. Editing dispatch is already view-agnostic (store-level ops), so the Writer needs no edit re-plumbing.

### 5.3 Focus / typewriter mode

A toggle that dims everything but the active paragraph and keeps the caret line comfortably placed. Pure native styling over the outline list — cheap.

### 5.4 Outline navigator

A collapsible chapter/section tree (from `sections` / the existing `OutlineDTO` heading tree) to **jump** instantly and **drag-reorder** sections. Reorder reuses the existing `move` op path.

---

## 6. Cross-cutting — friendly & fast enhancements (selected)

Fold these into Phase 1 (user-selected; effort tags):

1. **Local-first + batched sync + status chip** *(medium)* — editing is already local-first/optimistic with a durable offline op queue (`thesis-doc-store.ts`, `thesis-ops.ts`), and **sync already starts when the user leaves edit mode** (user-confirmed). Add: **coalesce rapid edits** and sync on a timer / on pause, a visible **Saved ✓ / Syncing… / Offline** chip, and a clear offline mode. **Caveat:** ops use positional indices and a rejected sync currently drops the whole queue — batching must keep the **server authoritative on reconcile** (don't let a coalesced batch desync indices).
2. **Skeleton screens, not spinners** *(cheap)* — replace the full-screen loader with greyed block placeholders on load.
3. **Warm the Preview in the background** *(medium)* — pre-convert docx/PDF while writing (idle) so Preview opens instantly instead of spinning (today it's ephemeral, converted on demand).
4. **Virtualize the outline** *(medium)* — render only on-screen blocks for long memoirs.
5. **Stream AI suggestions live** *(cheap)* — token-by-token into the inline diff.
6. **AI explains its change** *(cheap)* — a one-line rationale on each suggestion ("more formal · added a citation").
7. **Warm empty states** *(cheap)* — an empty section offers a draft ("This part's blank — want me to draft an intro?").
8. **Celebrate milestones** *(cheap)* — "Chapter 2 done 🎉", writing streaks.
9. **Haptics + micro-animations** *(cheap)* — subtle feedback on select / accept / done.
10. **Voice-to-write** *(medium, emphasized by user)* — the mic already exists; speak to draft or command edits. Strong for Arabic & accessibility.
11. **Progress & momentum** *(medium)* — per-chapter completion, word/page count, and a gentle progress ring. Thesis writers live on momentum — make it visible (derive from `sections` / heading tree + block text counts; surface in the header or navigator).

---

## 7. The data-model ceiling & Phase 2 (deferred, documented for continuity)

The fidelity ceiling lives in the DTO, not the UI. `DocBlockDTO` (app `lib/api.ts:547-566`; server `modakerati-server/src/lib/thesis-doc.ts` `blockToDTO`) captures only paragraph-level info (`text`, `styleId`, `level`, `alignment`, `direction`), `table` as `rows: string[][]` (cell text only), `image`, and `other` (dropped). It does **not** carry inline run formatting, real table structure, equations, columns, page layout, footnotes, or list numbering.

**Phase 2** (future spec) extends `DocBlockDTO` + `ThesisOp` + the server `blockToDTO` + the docx engine to carry **inline formatting** (unlocking Bold/Italic/color in the Part A toolbar) and **real tables/equations**, so the Writer renders/edits them natively and preview is needed less. This is intentionally out of scope here.

---

## 8. Component / file impact map (from recon)

- `app/(app)/thesis-workspace.tsx` (765) — header (relocate tools to ⋯, add Preview), swap the 3-layer view switch for Writer + preview layers, mount the new context bar / idle AI bar / inline-suggestion layer.
- `components/workspace/WorkspaceComposerSheet.tsx` (653) — **decomposed/retired** into: `BlockContextBar` (+ two forms + category expansion), `IdleAIBar`, `InlineSuggestion` (on `DocBlock`), `useComposerKeyboardDock`, `useBlockSelection`.
- `components/workspace/WorkspaceViewSwitcher.tsx` (52) — replaced by a Preview control.
- `stores/workspace-store.ts` (165) — `DocViewMode`→Writer + `previewMode`; drop `composerMode`; keep selection/inline-edit/think state.
- `stores/chat-store.ts` — AI status/suggestion state feeds the inline-suggestion layer.
- `components/workspace/OutlineReorderable.tsx` (152) / `DocBlock.tsx` (579) — host the Writer, focus mode, inline suggestions, virtualization.
- `components/workspace/OnlyOfficeView.tsx` / `WordDocxView.tsx` / `PdfView.tsx` — become preview-only; warm-preview lifecycle.
- `stores/thesis-doc-store.ts` (345) / `lib/thesis-ops.ts` (245) — batched-sync + status chip; unchanged op semantics.
- `components/workspace/ComposerEditTools.tsx` (192) — its actions feed the new category bar.

## 9. Open questions / risks

1. **Run-level toolbar buttons in v1:** show Bold/Italic/color **disabled with a "soon" hint**, or **omit** them until Phase 2? (Recommend: omit from the default category set; keep Style/Align/Direction/Lists/Color-as-paragraph? — decide during planning.)
2. **Preview default (Word vs PDF)** and whether Preview is a toggle vs a two-item menu.
3. **Batched-sync safety** vs the positional-index queue-drop behavior — needs a concrete reconcile rule so a coalesced batch never desyncs indices.
4. **Selection box vs scope pill** clarity when the keyboard is up (no box) — ensure users always know which block AI will act on.
5. **OnlyOffice/simulator** — Preview must gracefully fall back (OnlyOffice real-device only; docx-preview on simulator), same as today.

## 10. Rollout / phasing

- **Phase 1 (this spec):** Part A (block-anchored composer, inline suggestions, decluttered header) + Part B (Writer + Preview + Focus + Navigator) + the 10 selected friendly/fast enhancements.
- **Phase 2 (future):** DTO/ops/engine extension for inline formatting + real tables/equations; then the deferred toolbar buttons "light up," and optionally the section-peek preview.

Verification: no JS test runner in the app — gate with `npx tsc --noEmit` + running the app (real device for OnlyOffice-dependent preview paths).
