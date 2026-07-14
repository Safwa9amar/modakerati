# Workspace Word-style Ribbon — Design Spec

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Area:** Expo app (`~/modakerati`) workspace composer + server (`~/modakerati-server`) formatting endpoints/MCP, `mdocxengine`

## Goal

Give the thesis workspace a Word-like **ribbon** of document tools, organized into tabs (Home, Layout, Design, Insert, References) inside the composer's **Edit** mode. Ship **all UI and buttons first**; wire backends **one tool at a time** afterward. AI (chat) mode is unchanged.

## Context

- The composer (`components/workspace/WorkspaceComposerSheet.tsx`) has an **AI ⇄ Edit** mode toggle. Edit mode today shows `ComposerEditTools` (paragraph style H1–H6, alignment, RTL/LTR direction, clear formatting, move up/down, insert image).
- Existing app→server formatting endpoints: `PUT /:id/paragraphs/:index`, `POST /:id/paragraphs/bulk`, `POST /:id/blocks/{delete,move,image,start-on-new-page}`, `POST /:id/format` (norm profile), `POST /:id/apply`. MCP doc-tools mirror these plus `set_header/set_footer/start_on_new_page/set_section_header/set_section_footer/insert_table/insert_chart`.
- `mdocxengine` is far richer than what's surfaced. Managers exist (unwired) for: page layout (margins/orientation/size/columns/breaks/line numbers), styles, tables (rich), shapes/text boxes, header/footer (page-number formats, different-first/odd-even), page numbering, footnotes/endnotes, TOC, captions/list-of-figures, citations/bibliography, cross-references, numbering (lists).
- **No engine support today** for: Themes, Page color, Page borders, Watermark, per-paragraph Indent/Spacing. These are the only `soon` items.
- Endpoint pattern to mirror: auth+parse → load row (require `docMode==="live-docx"`+`docPath`) → `withThesisLock` → `loadThesisEngine` → mutate via `engine.*`/`Doc` facade → `engine.zip.toBuffer()` → `uploadDocx` → `scheduleReconcile` (RAG) → bump `theses.updatedAt`.

## Design

### Placement & structure

Edit mode renders a **ribbon** below the existing focus chip + mode toggle:

```
[ favorites/recent quick-row ]            ← ★ pinned tools (enhancement 4)
[ 🔍 Tell me what to do…      ]           ← search (enhancement 2)
Home · Layout · Design · Insert · References  [ + contextual tab ]   ← tab bar
[ ◻ ◻ ◻ | ◻ ◻ ◻ ]  (horizontal scrolling strip for active tab)      ← tool strip
```

- **Single scrolling strip** per tab (chosen over a grouped grid): one horizontal row of labeled icon buttons with faint group dividers. Keeps the sheet compact; popovers carry options.
- Tools with choices open a **compact popover**, one of three variants:
  - **Preset list** — Margins (Normal/Narrow/Moderate/Wide/Mirrored), Breaks, Bibliography style.
  - **Grid picker** — Insert Table (rows × cols).
  - **Segmented control** — Columns (1/2/3), Orientation (Portrait/Landscape), Size (A4/Letter/…), Page # position.
- `ComposerEditTools` is refactored into the **Home** tab.

### Tabs & button inventory

Status: **wired** = engine method exists (Phase 1 wires it if an app endpoint already exists, else routes via AI bridge until its Phase-2 endpoint lands); **soon** = new engine code required (Phase 3).

**Home** — Style ▾ (Normal/H1–H6)·, Bold, Italic, Underline, Strikethrough, Font color ▾, Highlight ▾, Align ▾·, RTL/LTR·, Bullets ▾, Numbered ▾, Clear·.  (`·` = app endpoint already exists.)

**Layout** — Margins ▾, Orientation ▾, Size ▾, Columns ▾, Breaks ▾, Line numbers ▾. `soon`: Indent, Spacing (per-paragraph).

**Design** — ⚡ Thesis-ready· (norm profile), Fonts ▾ (doc font), Paragraph spacing ▾ (doc-wide). `soon`: Themes, Page color, Page borders, Watermark.

**Insert** — Table ▾, Picture·, Chart ▾, Shapes ▾, Text box, Header ▾, Footer ▾, Page # ▾, Footnote, Symbol ▾, Page break·.

**References** — Contents ▾ (TOC), Update TOC, Footnote, Endnote, Citation ▾, Style ▾ (APA/MLA/Chicago), Bibliography ▾, Caption, Figures list, Cross-reference ▾.

**Contextual (enhancement 3)** — appears on selection: **Table** (merge/insert row·col, header row, borders), **Picture** (resize, replace, caption), **Heading** (promote/demote level·).

### UX enhancements (all selected)

1. **AI-assist bridge** — every tool exposes an optional "Do it with AI"; all `soon` tools (and any not-yet-wired tool) route to the AI composer via a localized instruction so no button is ever a dead end. This is the mechanism that makes Phase-1 UI fully functional before backends exist.
2. **"Tell me what to do" search** — filters `RIBBON_TABS` by label/keywords across all tabs and runs the chosen tool.
3. **Contextual tabs** — `useContextualTab` derives an extra tab from the current selection.
4. **Favorites / Recent row** — pinned quick-access above the tabs; persisted.
5. **Live preview** — layout tools (margins/orientation/size/columns) show an optimistic document preview with **Apply / Cancel** before committing.

### Components (`components/workspace/ribbon/`)

Data-driven: one config file is the source of truth; adding/moving a button is a one-line change.

- `ribbon-config.ts` — `RIBBON_TABS`: `{ id, tab, group, label, icon, kind: "action"|"preset"|"grid"|"segment", options?, status: "wired"|"soon", actionKey }`.
- `ComposerRibbon.tsx` — orchestrator (favorites + search + tab bar + strip); owns active-tab state.
- `RibbonTabBar.tsx` — scrollable tabs incl. contextual.
- `RibbonToolStrip.tsx` — renders the active tab's buttons + group dividers.
- `RibbonToolButton.tsx` — one button; `soon` badge, disabled state, opens popover or dispatches.
- `RibbonPopover.tsx` + `PresetListPopover.tsx` / `GridSizePicker.tsx` / `SegmentPicker.tsx` — the three option UIs.
- `RibbonSearch.tsx` — search overlay.
- `RibbonFavorites.tsx` — pinned quick-row.
- `useContextualTab.ts` — selection → contextual tab.
- `useLivePreview.ts` + `RibbonPreviewBar.tsx` — optimistic preview + Apply/Cancel.

Support:
- `stores/ribbon-store.ts` (Zustand) — `activeTab`, `favorites`/`recent` (persisted), `searchOpen`, `previewDraft`.
- `lib/ribbon-actions.ts` — `dispatchRibbonAction(tool, params)`: maps `actionKey`→`lib/api` endpoint when `status:"wired"` and an endpoint exists; else delegates to the AI bridge. Owns busy state + error toast.
- `lib/ribbon-ai-bridge.ts` — `tool → localized natural-language instruction`, switches composer to AI mode and sends (e.g. Watermark → "Add a watermark reading '…'.").
- i18n: `ribbon.*` keys in `locales/{en,fr,ar}.json`.

### Phasing

- **Phase 1 (this task): all UI, no new backend.** Full ribbon + every button. Wire buttons whose endpoints already exist (Style, Align, RTL/LTR, Clear, Picture, Page break/new-page, ⚡Thesis-ready, move, contextual heading level). Every other button routes through the AI bridge.
- **Phase 2+: backend one by one.** New `/api/thesis/*` endpoints + matching MCP tools for the wire-now engine methods; swap each button from AI-bridge to direct call by flipping its config `actionKey`.
- **Phase 3: engine work** for the 6 `soon` features.

### Error handling

- Every dispatched action is wrapped: busy indicator on the button, localized error toast on failure, no partial UI state. Wired endpoints already run under `withThesisLock` server-side.
- Popovers close on selection or outside tap; a tool that needs a selection is disabled (greyed) with a hint when nothing applicable is selected (mirrors current `ComposerEditTools` hint behavior).
- AI-bridge failures fall back to the normal chat error path.

### Testing

- `ribbon-config.ts` is pure data: a unit test asserts every tool has either a real `actionKey` handler or `status:"soon"`, unique ids, and a valid `kind`/`options` shape.
- `dispatchRibbonAction` unit-tested with a mocked `lib/api` (wired path) and a mocked bridge (soon path).
- Each popover variant renders in isolation.
- Manual: drive the workspace on a device — open Edit mode, switch tabs, run a wired tool (e.g. Margins once its endpoint exists / Align now), confirm a `soon` tool routes to AI.

## Out of scope

- Actual Phase-2/3 backend endpoints, MCP tools, and engine features (Themes/Page color/Borders/Watermark/per-paragraph Indent+Spacing) — tracked as follow-up work, not this task.
- OnlyOffice-native ribbon integration; changes to AI (chat) mode.
```
