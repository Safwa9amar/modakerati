# Add header / footer from the section bubble

**Date:** 2026-07-26
**Status:** Approved design — ready for implementation plan
**Related:** [[editable-document-chrome]] (the inline header/footer/section bands this extends)

## Problem

In the Lexical writer, `buildChrome` only emits a header band `if (s.header)` and a
footer band `if (s.footer)` ([`WorkspaceLexicalView.tsx:73-82`](../../../components/workspace/WorkspaceLexicalView.tsx)).
A section that has neither renders **no band**, so there is no tap target to create
one — the student cannot give such a section a running header or footer.

The section-break marker (`§ New section starts here`) is the one band that is always
present (for every section after the first). Its bubble — the `hfSection` toolset — is
therefore the natural place to add the missing affordance.

## Goal

From the section bubble, let the student **insert a header and/or a footer** for that
section. Adding a part only *creates the band*; all subsequent editing reuses the
existing header/footer band tooling (✦ AI, templates, edit-text, page numbers).

## Non-goals / scope

- **First section (index 0) is out of scope.** It has no `§` marker, hence no section
  bubble, so this entry point cannot reach it. Every section *after* the first is
  covered. A global entry for section 0 is a possible follow-up, not part of v1.
- No new server endpoint and no engine change: `setHeaderText` / `setFooter` already
  create the part from nothing.

## Decisions (locked with the user)

1. **Insert behavior = "add band, then edit."** Tapping "Add header"/"Add footer"
   creates an empty part, then auto-selects the new band so its existing bubble tools
   appear. Maximum reuse, least surprise.
2. **A newly added footer defaults to centered page numbers on** — the most common real
   footer. The student can still ✦/edit it afterward.
3. **One "Add" chip → labeled sub-pill** (not two top-level chips), mirroring the
   existing `hfLink` sub-pill. Keeps the already-crowded section bubble clean.

## Design

### 1. Know what's missing — enrich the section selection

`ChromeSelection` ([`stores/workspace-store.ts:7-19`](../../../stores/workspace-store.ts))
and the mirrored `chrome` prop on `BlockContextBar`
([`BlockContextBar.tsx:206-218`](../../../components/workspace/BlockContextBar.tsx))
gain two optional fields:

```ts
hasHeader?: boolean; // section band only: the section already renders a header band
hasFooter?: boolean; // section band only: the section already renders a footer band
```

In the chrome branch of `onState`
([`WorkspaceLexicalView.tsx:531-564`](../../../components/workspace/WorkspaceLexicalView.tsx)),
the containing section `sec` is already resolved by range. For `kind === "section"`,
set `hasHeader = !!sec?.header` and `hasFooter = !!sec?.footer` and pass them into
`setChromeSelection`. These read the **same inheritance-resolved `sections`** that
`buildChrome` keys off, so the "Add" affordance appears **exactly when no band renders**
(if a header is inherited, `s.header` is truthy → a top band already renders → no "Add
header").

### 2. Section bubble: "Add" chip + `hfAdd` sub-pill

- Extend the `Category` union ([`BlockContextBar.tsx:90`](../../../components/workspace/BlockContextBar.tsx))
  with `"hfAdd"`.
- In the `chrome?.kind === "section"` branch of `chromeTools`
  ([`BlockContextBar.tsx:935-979`](../../../components/workspace/BlockContextBar.tsx)),
  add a `Plus`-icon chip **shown only when** `!chrome.hasHeader || !chrome.hasFooter`.
  It toggles `activeCategory === "hfAdd"`. Place it first (enterIndex 0); shift the
  link / prev / next / new-page chips' `enterIndex` down by one.
- In the sub-pill render (alongside the `hfLink` branch,
  [`BlockContextBar.tsx:1111-1135`](../../../components/workspace/BlockContextBar.tsx)),
  add an `activeCategory === "hfAdd"` branch rendering:
  - **"Add header"** — only if `!chrome.hasHeader`
  - **"Add footer"** — only if `!chrome.hasFooter`

  using the same `optPill` label style as the link sub-pill. If both parts already
  exist, the Add chip never shows, so the sub-pill is never reachable.

### 3. Handlers (reuse `applyChrome` → existing `/chrome-op`)

```ts
const addHeader = () => {
  if (!chrome || chrome.kind !== "section") return;
  applyChrome({ op: "setHeaderText", index: chrome.index, text: "" });
  // Header band index == section start → this auto-select is exact.
  useWorkspaceStore.getState().setChromeSelection({
    kind: "top", index: chrome.index, text: "",
  });
  setActiveCategory(null);
};

const addFooter = () => {
  if (!chrome || chrome.kind !== "section") return;
  applyChrome({ op: "setFooter", index: chrome.index, text: "", pageNumbers: true, alignment: "center" });
  // index is the section-start block; the server resolves the section from any
  // in-section index, so both the op and the bottom band's ✦ tool work.
  useWorkspaceStore.getState().setChromeSelection({
    kind: "bottom", index: chrome.index, text: "", pageNumbers: true,
  });
  setActiveCategory(null);
};
```

`applyChrome` ([`BlockContextBar.tsx:780-789`](../../../components/workspace/BlockContextBar.tsx))
posts to `/chrome-op` and applies the echoed document to the optimistic doc store; the
doc change re-runs `buildChrome`, which now renders the real band. The optimistic
`setChromeSelection` lands the student on that band's tools immediately (it is not
cleared by the reseed, because `onState` only clears chrome on a *non-chrome* selection
with `index >= 0`).

### 4. i18n

Three new keys under `workspace.hf` in `locales/{en,fr,ar}.json`, added **surgically**
(never parse/re-dump — the files have duplicate keys, per [[locale-json-duplicate-keys]]):

| key | en | fr | ar |
|-----|----|----|----|
| `addHeaderFooter` | Add header / footer | Ajouter en-tête / pied de page | إضافة رأس / تذييل |
| `addHeader` | Add header | Ajouter un en-tête | إضافة رأس الصفحة |
| `addFooter` | Add footer | Ajouter un pied de page | إضافة تذييل الصفحة |

(French/Arabic strings to be confirmed against existing wording during implementation.)

## Data flow

```
tap § marker
  → Lexical NodeSelection on ChromeNode
  → onState (kind "section") enriches hasHeader/hasFooter from doc.sections
  → setChromeSelection → FloatingPill → BlockContextBar section toolset
tap Add ▾ → hfAdd sub-pill (Add header / Add footer, filtered by what's missing)
tap "Add header"
  → applyChrome(setHeaderText "", index) → POST /chrome-op → echoed document
  → setDoc → buildChrome renders new top band
  → optimistic setChromeSelection(kind "top") → bubble shows header ✦ tools
```

## Edge cases

- **Both parts already present** → Add chip hidden; nothing changes.
- **Header inherited from a previous section** → `s.header` truthy → a top band already
  renders → "Add header" correctly suppressed; only "Add footer" may show.
- **Rapid re-tap before the echo** → `applyChrome` is fire-and-forget with an error
  Alert; the optimistic selection carries the UI until the echo reconciles. A second
  add of the same region is idempotent server-side (replaces the part).
- **First section** → no marker, no bubble → not reachable (documented non-goal).

## Testing / verification

- `npx tsc --noEmit` in the app (no JS test runner — see [[app-verification-no-test-runner]]).
- Device QA: on a section (after the first) with no header/footer, tap the `§` marker →
  **Add ▾** → **Add header** ⇒ empty header band appears and is selected, ✦ works;
  **Add footer** ⇒ footer band with centered page numbers appears and is selected.
  Confirm the Add chip disappears once both parts exist, and never shows when a header
  is inherited.
- No new server code (reuses `/chrome-op`); existing `section-hf-dto` server tests still
  cover the DTO. No new server test required.
