# Workspace Edit-Mode Tools — Design

Date: 2026-07-13
Status: Approved (pending spec review)

## Summary

Add an **Edit mode** to the workspace composer bottom sheet, reached from an
**✨ AI ⇄ ✏️ Edit** segmented toggle. Edit mode gives the user direct,
block-level formatting of the **currently selected paragraph** — paragraph
style, alignment, and clear-formatting — without going through the AI chat.

All operations are **block-level** and map to primitives the mdocxengine
already exposes. No AI round-trip, no run-level (inline) editing.

## Decisions (from brainstorming)

- Mode switch: a **segmented toggle at the top** of the sheet content.
- Tool set (the full feasible block-level set):
  - **Paragraph style:** Normal, Heading 1–6.
  - **Alignment:** left, center, right, justify.
  - **Clear formatting:** strip run formatting (bold/italic/…) from the paragraph.
- Edit tools act on **exactly one selected block**.
- Server: **extend** `PUT /api/thesis/:id/paragraphs/:index` (not a new endpoint).

### Explicitly deferred (with reason)

- **Inline bold/italic on a text selection** — requires run-level editing plus a
  text-selection UI in the WebView; far larger than block-level styling.
- **Real bullet/numbered lists** — the engine only prepends a literal bullet
  character (`Paragraph.make(bullet + text, …)`), not true Word numbering
  (`numbering.xml`/`numId`). A proper implementation is a separate effort.

## Engine capabilities relied on (verified)

- `Paragraph.applyStyle(styleId)` — e.g. `"Normal"`, `"Heading1"`.
- `Paragraph.setAlignment("left"|"center"|"right"|"both")`.
- `Paragraph.removeFormatting()` — strips run properties, keeps text.
- `getParagraphByIndex(index)` — Paragraph handle by block index.
- `document.setHeadingLevel(index, level)` — convenience for headings 1–6; sets
  `Heading{level}` + `outlineLevel = level-1`, preserves RTL + alignment.
- `paragraphAlignment(xml)` — read current alignment (for DTO + active-state).

Note: the block **render** clamps heading display size to H4
(`thesis-doc.ts` maps deeper levels to size 4), but the real style/outline level
(H1–H6) is preserved in the document and the outline/TOC.

## UI (app — `components/workspace/WorkspaceComposerSheet.tsx`)

New store field in `stores/workspace-store.ts`:
`composerMode: "ai" | "edit"` (default `"ai"`) + `setComposerMode`.

Layout:

```
[ <selection chip>  ✕ ]
┌───────────────┬────────────────┐
│    ✨ AI       │   ✏️ Edit ●     │   segmented toggle (top of content)
└───────────────┴────────────────┘
 AI mode  → thinking status + "Ask the AI…" input + quick chips
 Edit mode→ Style row:  Normal H1 H2 H3 H4 H5 H6   (horizontal scroll)
            Align row:  ⬅  ⬌(center)  ➡  ▤(justify)
            Clear formatting
—— TOOLS ——  (Sources/Format/Outline/View/PDF/Export/Regenerate/Thinking/Edit block — visible in BOTH modes)
```

- **Always visible:** selection chip, TOOLS grid, the toggle.
- **AI mode (unchanged):** thinking status, AI text input, quick-action chips.
- **Edit mode (new):** the AI input + chips are replaced by the Style row,
  Align row, and Clear-formatting button.
- **Active state:** the current block's `level` highlights the active style
  button; the block's `alignment` (new DTO field) highlights the active
  alignment button.

## Behavior & edge cases

- Edit tools require **exactly one** selected block. With 0 or >1 selected → the
  rows are disabled with a hint ("Select a paragraph to edit."). (Multi-select
  keeps its existing delete / new-page row.)
- Selected block is a **table/image** (`kind !== "paragraph"` or contains
  `<w:drawing>`) → style/align/clear disabled.
- **Non-live-docx** thesis → the **Edit segment is disabled** (same guard the
  View/PDF tools already use via `isLiveDoc`).
- After any successful change → call `refreshDoc()` (the same hook the bulk
  actions use) so the Word view + Outline update immediately.
- RTL: alignment values are literal Word values (left/center/right/both); icons
  laid out to respect the sheet's `rtl` direction.

## Server (`src/routes/thesis.ts`)

Extend `PUT /api/thesis/:id/paragraphs/:index`. Today it **requires** `text`;
change to accept an optional set: `{ text?, level?, alignment?, clearFormatting? }`.
At least one must be present.

- `text` (string): existing behavior — `editParagraphText(index, text)`.
- `level` (int): `0` → Normal (`applyStyle("Normal")` **and clear the paragraph's
  `outlineLvl`** so it leaves the TOC); `1–6` → `setHeadingLevel(index, level)`.
- `alignment` (`"left"|"center"|"right"|"justify"`): map `justify→both`, apply via
  `getParagraphByIndex(index).setAlignment(...)`.
- `clearFormatting` (bool): `getParagraphByIndex(index).removeFormatting()`.

Unchanged plumbing: thesis ownership check, `live-docx` guard, reject
tables/images (matches `edit_paragraph`), `withThesisLock`, `uploadDocx`,
`scheduleReconcile`, `updatedAt`.

The app sends **one field per tap**, so mixed-mutation ordering is not exercised;
the handler still applies fields in a defined order (text → style → alignment →
clearFormatting) for safety.

**Index-space caveat (implementation risk):** `setHeadingLevel(index, …)` and the
existing `editParagraphText(index, …)` operate on the **block index**
(`getBlocks()[index]`). `getParagraphByIndex(index)` may use a *paragraph-only*
index space (the documented BLOCK→PARAGRAPH gotcha — block index ≠ paragraph
index when the doc has tables/section breaks/front-matter). The plan MUST either
(a) confirm `getParagraphByIndex` is block-indexed, or (b) apply alignment &
clearFormatting through the **same block-node path** `setHeadingLevel` uses
(`getBlocks()` → mutate node → `saveBlocks()`), so all edits target the same
paragraph the UI selected. A test with a thesis containing a table before the
target paragraph should be part of verification.

*Why extend, not add a new endpoint:* identical target (a single paragraph
mutation) and identical load/guard/lock/upload/reconcile plumbing — a new route
would duplicate all of it.

## Client (`lib/api.ts`)

- `updateThesisParagraph(thesisId, index, changes)` already exists; widen
  `changes` to `{ text?; level?; alignment?; clearFormatting? }` and send those.
- **DTO change — alignment:** add `alignment: "left"|"center"|"right"|"both"|null`
  to `ThesisDocBlock` so Edit mode can highlight the active alignment. Server maps
  it from `paragraphAlignment(b.xml)` in the block→DTO mapper (`thesis-doc.ts`).
- **DTO change — un-clamp `level`:** today the DTO reports `level: 0|1|2|3|4`
  (`thesis-doc.ts` clamps deeper headings to 4 so the block render can pick a font
  size). Since Edit mode offers H1–H6, widen the DTO `level` to `0..6` and report
  the **real** level; move the size clamp INTO the block render
  (`Math.min(level, 4)` for font size only). Without this, H5/H6 highlight wrong
  and reads back as H4.

## Data flow

1. Tap a block → `selectBlock(index, text)`; chip shows it.
2. Tap **Edit** → `composerMode = "edit"`.
3. Style/align rows read the selected block's `level` + `alignment` from the
   loaded `liveDoc.blocks` to show active state.
4. Tap e.g. **H2** → `updateThesisParagraph(id, index, { level: 2 })` → server
   applies via engine → uploads docx → `scheduleReconcile` → `{ ok: true }`.
5. App `refreshDoc()` → Word view + Outline reflect the change.

## Testing

- **Server:** `PUT /paragraphs` with `{level:2}`, `{level:0}`, `{alignment:"center"}`,
  `{clearFormatting:true}` → assert `pStyle`/`outlineLvl`/`w:jc`/run-props changed;
  assert tables/images and non-live-docx are rejected (400).
- **App:** toggle renders and switches; style/align/clear act on the selection and
  are disabled for none/multi/non-paragraph selections and non-live-docx theses.
- **Manual:** set a paragraph to H2 in the app → the Structure/Outline picks it up
  and the Word view reflects it; set back to Normal → it leaves the outline.

## Out of scope

Inline bold/italic, real lists, any change to the AI chat flow, any new
text-entry surface (text edits stay in the existing `block-editor` screen).
