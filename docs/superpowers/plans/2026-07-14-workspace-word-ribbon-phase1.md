# Workspace Word-style Ribbon — Phase 1 (UI + wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Word-style tabbed ribbon (Home · Layout · Design · Insert · References + contextual tabs) inside the workspace composer's Edit mode, with every button present — wiring the tools that already have endpoints and routing the rest through an AI bridge so nothing is a dead end.

**Architecture:** A single declarative config (`ribbon-config.ts`) is the source of truth for every tab/tool. Small, focused components read the config to render a scrolling tool strip per tab; a dispatcher maps a tool press to either an existing `lib/api` endpoint or the AI bridge. The existing `ComposerEditTools` is reused unchanged as the "Home" tab. AI (chat) mode is untouched.

**Tech Stack:** React Native (Expo v56), TypeScript (strict), Zustand, react-i18next, lucide-react-native, `@gorhom/bottom-sheet`.

**Verification model (read first):** This repo has **no JS test runner** (no jest/testing-library — confirmed in `package.json`). Per-task verification is therefore: (1) `npx tsc --noEmit` must be clean, and (2) a concrete behavioral check. Automated safety net for the pure data layer is a `validateRibbonConfig()` invariant run under `__DEV__` that throws on a malformed config. Formal unit-test tooling is intentionally out of scope for Phase 1 (matches the codebase's typecheck+manual pattern). Run `npx tsc --noEmit` from `/Users/hamzasafwan/modakerati`.

**Phase 1 scope boundary:** Home tab = existing `ComposerEditTools` (reused). New tabs are config-driven. Wired-now tools in the new tabs: **Insert→Picture** (`insertThesisImage`), **Insert→Page break** and **Layout→Breaks** (`startThesisBlocksOnNewPage`), **Design→Thesis-ready** (`formatThesis`), **contextual Heading→promote/demote** (`editThesisParagraphs`). Every other new-tab tool routes to the AI bridge. **Live preview (enhancement 5) is deferred to Phase 2** — it needs the direct layout endpoints that don't exist yet; a stub note is included, no component built.

---

## File Structure

Create (all under the app repo `/Users/hamzasafwan/modakerati`):

- `components/workspace/ribbon/ribbon-config.ts` — types + `RIBBON_TABS` data + `validateRibbonConfig()`.
- `components/workspace/ribbon/ribbon-icons.tsx` — `icon key → LucideIcon` map.
- `lib/ribbon-ai-bridge.ts` — pure `buildToolInstruction()`.
- `lib/ribbon-actions.ts` — `dispatchRibbonAction()` dispatcher.
- `stores/ribbon-store.ts` — `activeTab`, `favorites`, `searchOpen`.
- `components/workspace/ribbon/RibbonToolButton.tsx`
- `components/workspace/ribbon/RibbonPopover.tsx`
- `components/workspace/ribbon/PresetListPopover.tsx`
- `components/workspace/ribbon/GridSizePicker.tsx`
- `components/workspace/ribbon/SegmentPicker.tsx`
- `components/workspace/ribbon/RibbonToolStrip.tsx`
- `components/workspace/ribbon/useContextualTab.ts`
- `components/workspace/ribbon/RibbonTabBar.tsx`
- `components/workspace/ribbon/RibbonSearch.tsx`
- `components/workspace/ribbon/RibbonFavorites.tsx`
- `components/workspace/ribbon/ComposerRibbon.tsx` — orchestrator.

Modify:
- `components/workspace/WorkspaceComposerSheet.tsx` — Edit mode renders `<ComposerRibbon>` (Home tab = existing `ComposerEditTools`).
- `locales/en.json`, `locales/fr.json`, `locales/ar.json` — `ribbon.*` keys.

---

## Task 1: Ribbon config types + data + validation

**Files:**
- Create: `components/workspace/ribbon/ribbon-config.ts`

- [ ] **Step 1: Write the config module**

This file is pure data + a pure validator — no React Native imports, so it stays cheap to reason about and the invariant can run anywhere.

```ts
// components/workspace/ribbon/ribbon-config.ts
// Declarative source of truth for the workspace ribbon. Pure data (no RN imports)
// so it can be validated in isolation. UI reads this; the dispatcher reads actionKey.

export type RibbonTabId =
  | "layout" | "design" | "insert" | "references" // fixed new tabs
  | "table" | "picture" | "heading";              // contextual (selection-driven)

export type ToolKind = "action" | "preset" | "grid" | "segment";
export type ToolStatus = "wired" | "soon";

export interface ToolOption {
  value: string;      // passed to the dispatcher as params.value
  labelKey: string;   // i18n key for the option label
  hint?: string;      // small trailing hint (e.g. "1\"") — literal, not translated
}

export interface RibbonTool {
  id: string;            // unique, e.g. "layout.margins"
  tab: RibbonTabId;
  group: string;         // group label key; adjacent same-group tools share a divider boundary
  labelKey: string;      // i18n key, e.g. "ribbon.tools.margins"
  icon: string;          // key into ribbon-icons map
  kind: ToolKind;        // action = tap-to-run; preset/segment/grid = opens a popover
  options?: ToolOption[];// required for kind preset|segment
  status: ToolStatus;    // wired = has a real handler; soon = engine work pending → AI bridge
  actionKey: string;     // dispatcher switch key
  keywords?: string[];   // extra search terms (English is fine; matched case-insensitively)
}

export interface RibbonTabDef {
  id: RibbonTabId;
  labelKey: string;
  contextual?: boolean;  // only shown when the selection matches
  tools: RibbonTool[];
}

const MARGIN_OPTS: ToolOption[] = [
  { value: "normal", labelKey: "ribbon.opt.marginNormal", hint: "1\"" },
  { value: "narrow", labelKey: "ribbon.opt.marginNarrow", hint: "0.5\"" },
  { value: "moderate", labelKey: "ribbon.opt.marginModerate", hint: "0.75\"" },
  { value: "wide", labelKey: "ribbon.opt.marginWide", hint: "2\"" },
  { value: "mirrored", labelKey: "ribbon.opt.marginMirrored" },
];
const ORIENT_OPTS: ToolOption[] = [
  { value: "portrait", labelKey: "ribbon.opt.portrait" },
  { value: "landscape", labelKey: "ribbon.opt.landscape" },
];
const SIZE_OPTS: ToolOption[] = [
  { value: "A4", labelKey: "ribbon.opt.a4" },
  { value: "USLetter", labelKey: "ribbon.opt.letter" },
  { value: "USLegal", labelKey: "ribbon.opt.legal" },
  { value: "A3", labelKey: "ribbon.opt.a3" },
  { value: "A5", labelKey: "ribbon.opt.a5" },
];
const COLUMN_OPTS: ToolOption[] = [
  { value: "1", labelKey: "ribbon.opt.oneCol" },
  { value: "2", labelKey: "ribbon.opt.twoCol" },
  { value: "3", labelKey: "ribbon.opt.threeCol" },
];
const BREAK_OPTS: ToolOption[] = [
  { value: "nextPage", labelKey: "ribbon.opt.pageBreak" },
  { value: "evenPage", labelKey: "ribbon.opt.evenPage" },
  { value: "oddPage", labelKey: "ribbon.opt.oddPage" },
];
const CITATION_STYLE_OPTS: ToolOption[] = [
  { value: "apa", labelKey: "ribbon.opt.apa" },
  { value: "mla", labelKey: "ribbon.opt.mla" },
  { value: "chicago", labelKey: "ribbon.opt.chicago" },
];

export const RIBBON_TABS: RibbonTabDef[] = [
  {
    id: "layout", labelKey: "ribbon.tab.layout",
    tools: [
      { id: "layout.margins", tab: "layout", group: "ribbon.grp.pageSetup", labelKey: "ribbon.tools.margins", icon: "margins", kind: "preset", options: MARGIN_OPTS, status: "wired", actionKey: "layout.margins", keywords: ["margin"] },
      { id: "layout.orientation", tab: "layout", group: "ribbon.grp.pageSetup", labelKey: "ribbon.tools.orientation", icon: "orientation", kind: "segment", options: ORIENT_OPTS, status: "wired", actionKey: "layout.orientation", keywords: ["landscape", "portrait"] },
      { id: "layout.size", tab: "layout", group: "ribbon.grp.pageSetup", labelKey: "ribbon.tools.size", icon: "size", kind: "preset", options: SIZE_OPTS, status: "wired", actionKey: "layout.size", keywords: ["a4", "letter", "paper"] },
      { id: "layout.columns", tab: "layout", group: "ribbon.grp.pageSetup", labelKey: "ribbon.tools.columns", icon: "columns", kind: "segment", options: COLUMN_OPTS, status: "wired", actionKey: "layout.columns", keywords: ["column"] },
      { id: "layout.breaks", tab: "layout", group: "ribbon.grp.paragraph", labelKey: "ribbon.tools.breaks", icon: "breaks", kind: "preset", options: BREAK_OPTS, status: "wired", actionKey: "layout.breaks", keywords: ["break", "section"] },
      { id: "layout.lineNumbers", tab: "layout", group: "ribbon.grp.paragraph", labelKey: "ribbon.tools.lineNumbers", icon: "lineNumbers", kind: "action", status: "wired", actionKey: "layout.lineNumbers", keywords: ["line number"] },
      { id: "layout.indent", tab: "layout", group: "ribbon.grp.paragraph", labelKey: "ribbon.tools.indent", icon: "indent", kind: "action", status: "soon", actionKey: "layout.indent", keywords: ["indent"] },
      { id: "layout.spacing", tab: "layout", group: "ribbon.grp.paragraph", labelKey: "ribbon.tools.spacing", icon: "spacing", kind: "action", status: "soon", actionKey: "layout.spacing", keywords: ["spacing"] },
    ],
  },
  {
    id: "design", labelKey: "ribbon.tab.design",
    tools: [
      { id: "design.thesisReady", tab: "design", group: "ribbon.grp.format", labelKey: "ribbon.tools.thesisReady", icon: "thesisReady", kind: "action", status: "wired", actionKey: "design.thesisReady", keywords: ["format", "norm", "apply"] },
      { id: "design.fonts", tab: "design", group: "ribbon.grp.format", labelKey: "ribbon.tools.fonts", icon: "fonts", kind: "action", status: "soon", actionKey: "design.fonts", keywords: ["font"] },
      { id: "design.paraSpacing", tab: "design", group: "ribbon.grp.format", labelKey: "ribbon.tools.paraSpacing", icon: "spacing", kind: "action", status: "soon", actionKey: "design.paraSpacing", keywords: ["spacing", "line"] },
      { id: "design.themes", tab: "design", group: "ribbon.grp.pageDesign", labelKey: "ribbon.tools.themes", icon: "themes", kind: "action", status: "soon", actionKey: "design.themes", keywords: ["theme"] },
      { id: "design.pageColor", tab: "design", group: "ribbon.grp.pageDesign", labelKey: "ribbon.tools.pageColor", icon: "pageColor", kind: "action", status: "soon", actionKey: "design.pageColor", keywords: ["background", "color"] },
      { id: "design.pageBorders", tab: "design", group: "ribbon.grp.pageDesign", labelKey: "ribbon.tools.pageBorders", icon: "pageBorders", kind: "action", status: "soon", actionKey: "design.pageBorders", keywords: ["border"] },
      { id: "design.watermark", tab: "design", group: "ribbon.grp.pageDesign", labelKey: "ribbon.tools.watermark", icon: "watermark", kind: "action", status: "soon", actionKey: "design.watermark", keywords: ["watermark"] },
    ],
  },
  {
    id: "insert", labelKey: "ribbon.tab.insert",
    tools: [
      { id: "insert.table", tab: "insert", group: "ribbon.grp.tables", labelKey: "ribbon.tools.table", icon: "table", kind: "grid", status: "soon", actionKey: "insert.table", keywords: ["table"] },
      { id: "insert.picture", tab: "insert", group: "ribbon.grp.illustrations", labelKey: "ribbon.tools.picture", icon: "picture", kind: "action", status: "wired", actionKey: "insert.picture", keywords: ["image", "photo"] },
      { id: "insert.chart", tab: "insert", group: "ribbon.grp.illustrations", labelKey: "ribbon.tools.chart", icon: "chart", kind: "action", status: "soon", actionKey: "insert.chart", keywords: ["chart", "graph"] },
      { id: "insert.shapes", tab: "insert", group: "ribbon.grp.illustrations", labelKey: "ribbon.tools.shapes", icon: "shapes", kind: "action", status: "soon", actionKey: "insert.shapes", keywords: ["shape"] },
      { id: "insert.textBox", tab: "insert", group: "ribbon.grp.illustrations", labelKey: "ribbon.tools.textBox", icon: "textBox", kind: "action", status: "soon", actionKey: "insert.textBox", keywords: ["text box"] },
      { id: "insert.header", tab: "insert", group: "ribbon.grp.headerFooter", labelKey: "ribbon.tools.header", icon: "header", kind: "action", status: "soon", actionKey: "insert.header", keywords: ["header"] },
      { id: "insert.footer", tab: "insert", group: "ribbon.grp.headerFooter", labelKey: "ribbon.tools.footer", icon: "footer", kind: "action", status: "soon", actionKey: "insert.footer", keywords: ["footer"] },
      { id: "insert.pageNumber", tab: "insert", group: "ribbon.grp.headerFooter", labelKey: "ribbon.tools.pageNumber", icon: "pageNumber", kind: "action", status: "soon", actionKey: "insert.pageNumber", keywords: ["page number"] },
      { id: "insert.footnote", tab: "insert", group: "ribbon.grp.symbols", labelKey: "ribbon.tools.footnote", icon: "footnote", kind: "action", status: "soon", actionKey: "insert.footnote", keywords: ["footnote"] },
      { id: "insert.symbol", tab: "insert", group: "ribbon.grp.symbols", labelKey: "ribbon.tools.symbol", icon: "symbol", kind: "action", status: "soon", actionKey: "insert.symbol", keywords: ["symbol"] },
      { id: "insert.pageBreak", tab: "insert", group: "ribbon.grp.symbols", labelKey: "ribbon.tools.pageBreak", icon: "pageBreak", kind: "action", status: "wired", actionKey: "insert.pageBreak", keywords: ["page break"] },
    ],
  },
  {
    id: "references", labelKey: "ribbon.tab.references",
    tools: [
      { id: "ref.toc", tab: "references", group: "ribbon.grp.toc", labelKey: "ribbon.tools.toc", icon: "toc", kind: "action", status: "soon", actionKey: "ref.toc", keywords: ["table of contents", "toc"] },
      { id: "ref.updateToc", tab: "references", group: "ribbon.grp.toc", labelKey: "ribbon.tools.updateToc", icon: "updateToc", kind: "action", status: "soon", actionKey: "ref.updateToc", keywords: ["update toc"] },
      { id: "ref.footnote", tab: "references", group: "ribbon.grp.footnotes", labelKey: "ribbon.tools.footnote", icon: "footnote", kind: "action", status: "soon", actionKey: "ref.footnote", keywords: ["footnote"] },
      { id: "ref.endnote", tab: "references", group: "ribbon.grp.footnotes", labelKey: "ribbon.tools.endnote", icon: "endnote", kind: "action", status: "soon", actionKey: "ref.endnote", keywords: ["endnote"] },
      { id: "ref.citation", tab: "references", group: "ribbon.grp.citations", labelKey: "ribbon.tools.citation", icon: "citation", kind: "action", status: "soon", actionKey: "ref.citation", keywords: ["cite", "citation"] },
      { id: "ref.citationStyle", tab: "references", group: "ribbon.grp.citations", labelKey: "ribbon.tools.citationStyle", icon: "citationStyle", kind: "preset", options: CITATION_STYLE_OPTS, status: "soon", actionKey: "ref.citationStyle", keywords: ["apa", "mla", "chicago", "style"] },
      { id: "ref.bibliography", tab: "references", group: "ribbon.grp.citations", labelKey: "ribbon.tools.bibliography", icon: "bibliography", kind: "action", status: "soon", actionKey: "ref.bibliography", keywords: ["bibliography", "references"] },
      { id: "ref.caption", tab: "references", group: "ribbon.grp.captions", labelKey: "ribbon.tools.caption", icon: "caption", kind: "action", status: "soon", actionKey: "ref.caption", keywords: ["caption"] },
      { id: "ref.figuresList", tab: "references", group: "ribbon.grp.captions", labelKey: "ribbon.tools.figuresList", icon: "figuresList", kind: "action", status: "soon", actionKey: "ref.figuresList", keywords: ["list of figures"] },
      { id: "ref.crossRef", tab: "references", group: "ribbon.grp.captions", labelKey: "ribbon.tools.crossRef", icon: "crossRef", kind: "action", status: "soon", actionKey: "ref.crossRef", keywords: ["cross reference"] },
    ],
  },
  {
    id: "heading", labelKey: "ribbon.tab.heading", contextual: true,
    tools: [
      { id: "heading.promote", tab: "heading", group: "ribbon.grp.heading", labelKey: "ribbon.tools.promote", icon: "promote", kind: "action", status: "wired", actionKey: "heading.promote", keywords: ["promote heading"] },
      { id: "heading.demote", tab: "heading", group: "ribbon.grp.heading", labelKey: "ribbon.tools.demote", icon: "demote", kind: "action", status: "wired", actionKey: "heading.demote", keywords: ["demote heading"] },
    ],
  },
  {
    id: "table", labelKey: "ribbon.tab.table", contextual: true,
    tools: [
      { id: "table.insertRow", tab: "table", group: "ribbon.grp.tableRows", labelKey: "ribbon.tools.insertRow", icon: "insertRow", kind: "action", status: "soon", actionKey: "table.insertRow", keywords: ["row"] },
      { id: "table.insertCol", tab: "table", group: "ribbon.grp.tableRows", labelKey: "ribbon.tools.insertCol", icon: "insertCol", kind: "action", status: "soon", actionKey: "table.insertCol", keywords: ["column"] },
      { id: "table.headerRow", tab: "table", group: "ribbon.grp.tableStyle", labelKey: "ribbon.tools.headerRow", icon: "headerRow", kind: "action", status: "soon", actionKey: "table.headerRow", keywords: ["header row"] },
    ],
  },
  {
    id: "picture", labelKey: "ribbon.tab.picture", contextual: true,
    tools: [
      { id: "picture.replace", tab: "picture", group: "ribbon.grp.picture", labelKey: "ribbon.tools.replace", icon: "picture", kind: "action", status: "soon", actionKey: "picture.replace", keywords: ["replace image"] },
      { id: "picture.caption", tab: "picture", group: "ribbon.grp.picture", labelKey: "ribbon.tools.caption", icon: "caption", kind: "action", status: "soon", actionKey: "picture.caption", keywords: ["caption"] },
    ],
  },
];

/** Every icon key referenced by the config — the icon map (Task 2) must cover these. */
export const RIBBON_ICON_KEYS: string[] = Array.from(
  new Set(RIBBON_TABS.flatMap((t) => t.tools.map((x) => x.icon))),
);

/** Runtime integrity check. Throws (dev only) on a malformed config so a bad edit
 *  surfaces immediately instead of rendering a broken/blank strip. */
export function validateRibbonConfig(tabs: RibbonTabDef[] = RIBBON_TABS): void {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const tool of tab.tools) {
      if (ids.has(tool.id)) throw new Error(`ribbon-config: duplicate tool id "${tool.id}"`);
      ids.add(tool.id);
      if (tool.tab !== tab.id) throw new Error(`ribbon-config: tool "${tool.id}" tab mismatch`);
      if ((tool.kind === "preset" || tool.kind === "segment") && !tool.options?.length) {
        throw new Error(`ribbon-config: "${tool.id}" is ${tool.kind} but has no options`);
      }
      if (tool.kind === "action" && tool.options) {
        throw new Error(`ribbon-config: "${tool.id}" is action but has options`);
      }
    }
  }
}

if (__DEV__) {
  validateRibbonConfig();
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ribbon/ribbon-config.ts
git commit -m "feat(ribbon): declarative ribbon config + dev-time validator"
```

---

## Task 2: Icon map

**Files:**
- Create: `components/workspace/ribbon/ribbon-icons.tsx`

- [ ] **Step 1: Write the icon map**

Keeps the config RN-free by resolving icon strings to lucide components here. Every key in `RIBBON_ICON_KEYS` must be present.

```tsx
// components/workspace/ribbon/ribbon-icons.tsx
import type { LucideIcon } from "lucide-react-native";
import {
  Scaling, RotateCw, FileText, Columns3, SeparatorHorizontal, ListOrdered,
  IndentIncrease, MoveVertical, Sparkles, Type, Palette, PaintBucket, Square,
  Droplets, Table, ImagePlus, ChartBar, Shapes, TextCursorInput, PanelTop,
  PanelBottom, Hash, Superscript, Sigma, SquareSplitVertical, ListTree, RefreshCw,
  StickyNote, BookMarked, Quote, BookText, Tag, Images, CornerDownRight,
  ChevronUp, ChevronDown, Rows3, TableProperties,
} from "lucide-react-native";

/** icon key (from ribbon-config) → lucide component. Keep in sync with RIBBON_ICON_KEYS. */
export const RIBBON_ICONS: Record<string, LucideIcon> = {
  margins: Scaling,
  orientation: RotateCw,
  size: FileText,
  columns: Columns3,
  breaks: SeparatorHorizontal,
  lineNumbers: ListOrdered,
  indent: IndentIncrease,
  spacing: MoveVertical,
  thesisReady: Sparkles,
  fonts: Type,
  themes: Palette,
  pageColor: PaintBucket,
  pageBorders: Square,
  watermark: Droplets,
  table: Table,
  picture: ImagePlus,
  chart: ChartBar,
  shapes: Shapes,
  textBox: TextCursorInput,
  header: PanelTop,
  footer: PanelBottom,
  pageNumber: Hash,
  footnote: Superscript,
  symbol: Sigma,
  pageBreak: SquareSplitVertical,
  toc: ListTree,
  updateToc: RefreshCw,
  endnote: StickyNote,
  citation: BookMarked,
  citationStyle: Quote,
  bibliography: BookText,
  caption: Tag,
  figuresList: Images,
  crossRef: CornerDownRight,
  promote: ChevronUp,
  demote: ChevronDown,
  insertRow: Rows3,
  insertCol: TableProperties,
  headerRow: TableProperties,
};
```

- [ ] **Step 2: Guard that every config icon resolves — extend the dev validator call site**

Add an icon-coverage check next to the existing invariant. Edit `components/workspace/ribbon/ribbon-config.ts`, replacing the `if (__DEV__)` block at the end:

```ts
// (leave validateRibbonConfig as-is above; only the __DEV__ block changes)
if (__DEV__) {
  validateRibbonConfig();
  // Icon coverage is checked in ribbon-icons via RIBBON_ICON_KEYS to avoid an
  // RN import here; see components/workspace/ribbon/ribbon-icons.tsx.
}
```

Then, in `ribbon-icons.tsx`, add the import at the **top** with the other imports:

```tsx
import { RIBBON_ICON_KEYS } from "./ribbon-config";
```

and add the coverage check at the **bottom** of the file (after the `RIBBON_ICONS` map):

```tsx
if (__DEV__) {
  const missing = RIBBON_ICON_KEYS.filter((k) => !RIBBON_ICONS[k]);
  if (missing.length) throw new Error(`ribbon-icons: missing icons for ${missing.join(", ")}`);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If a lucide name doesn't exist in the installed version, tsc fails on the import — swap it for a valid one via `ls node_modules/lucide-react-native/dist/esm/icons/ | grep -i <name>`.)

- [ ] **Step 4: Commit**

```bash
git add components/workspace/ribbon/ribbon-icons.tsx components/workspace/ribbon/ribbon-config.ts
git commit -m "feat(ribbon): icon key→component map + coverage guard"
```

---

## Task 3: AI bridge (pure instruction builder)

**Files:**
- Create: `lib/ribbon-ai-bridge.ts`

- [ ] **Step 1: Write the builder**

Pure function: given a tool + optional chosen option + selection text, produce a natural-language instruction for the AI composer. No RN imports.

```ts
// lib/ribbon-ai-bridge.ts
// Turns a ribbon tool (that has no direct endpoint yet) into a natural-language
// instruction handed to the AI composer, so every button does something today.
import type { RibbonTool } from "@/components/workspace/ribbon/ribbon-config";

export interface AiBridgeParams {
  optionValue?: string;   // chosen preset/segment value, if any
  optionLabel?: string;   // localized label of that option
  selectionText?: string; // current focus selection (trimmed), if any
}

// English instruction templates keyed by actionKey. The model writes in the
// thesis's own language regardless (per the server system prompt); these just say
// WHAT to do. {opt} = option label, {sel} appended separately when present.
const TEMPLATES: Record<string, string> = {
  "layout.indent": "Adjust the indentation of the selected paragraph(s).",
  "layout.spacing": "Adjust the paragraph spacing (before/after) of the selection.",
  "design.fonts": "Change the document's base font.",
  "design.paraSpacing": "Change the document's line/paragraph spacing.",
  "design.themes": "Apply a document theme (coordinated fonts and colors).",
  "design.pageColor": "Set a page background color.",
  "design.pageBorders": "Add a page border to the document.",
  "design.watermark": "Add a watermark to the document.",
  "insert.table": "Insert a table into the document.",
  "insert.chart": "Insert a chart into the document.",
  "insert.shapes": "Insert a shape into the document.",
  "insert.textBox": "Insert a text box into the document.",
  "insert.header": "Add a header to the document.",
  "insert.footer": "Add a footer to the document.",
  "insert.pageNumber": "Add page numbers to the document.",
  "insert.footnote": "Insert a footnote at the selection.",
  "insert.symbol": "Insert a symbol at the cursor.",
  "ref.toc": "Insert a table of contents.",
  "ref.updateToc": "Update the table of contents.",
  "ref.footnote": "Insert a footnote at the selection.",
  "ref.endnote": "Insert an endnote at the selection.",
  "ref.citation": "Insert a citation at the selection.",
  "ref.citationStyle": "Set the citation/bibliography style to {opt}.",
  "ref.bibliography": "Insert a bibliography.",
  "ref.caption": "Insert a caption for the selected figure or table.",
  "ref.figuresList": "Insert a list of figures.",
  "ref.crossRef": "Insert a cross-reference.",
  "table.insertRow": "Insert a row into the selected table.",
  "table.insertCol": "Insert a column into the selected table.",
  "table.headerRow": "Make the first row of the selected table a header row.",
  "picture.replace": "Replace the selected image.",
  "picture.caption": "Add a caption to the selected image.",
};

export function buildToolInstruction(tool: RibbonTool, params: AiBridgeParams = {}): string {
  const base = TEMPLATES[tool.actionKey] ?? `Perform: ${tool.actionKey}.`;
  const withOpt = params.optionLabel ? base.replace("{opt}", params.optionLabel) : base.replace("{opt}", "");
  const sel = params.selectionText?.trim();
  return sel ? `${withOpt}\n\nSelected text: "${sel.slice(0, 400)}"` : withOpt;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Behavioral self-check (inline node eval of the pure logic)**

Because there's no test runner, verify the pure function by reasoning against these cases (the executor confirms by reading, not running):
- `buildToolInstruction({actionKey:"ref.citationStyle",...} as any, {optionLabel:"APA"})` → contains `"APA"` and no `"{opt}"`.
- With `selectionText:"hello"` → ends with `Selected text: "hello"`.
- Unknown actionKey → `Perform: <key>.`

- [ ] **Step 4: Commit**

```bash
git add lib/ribbon-ai-bridge.ts
git commit -m "feat(ribbon): AI-bridge instruction builder"
```

---

## Task 4: Dispatcher

**Files:**
- Create: `lib/ribbon-actions.ts`

- [ ] **Step 1: Write the dispatcher**

Maps a tool to a real endpoint (wired) or the AI bridge (everything else). Selection + callbacks are injected so the module stays UI-agnostic. Reuses existing `lib/api` endpoints only.

```ts
// lib/ribbon-actions.ts
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { RibbonTool } from "@/components/workspace/ribbon/ribbon-config";
import { buildToolInstruction } from "@/lib/ribbon-ai-bridge";
import {
  formatThesis,
  insertThesisImage,
  startThesisBlocksOnNewPage,
  editThesisParagraphs,
} from "@/lib/api";

export interface DispatchDeps {
  thesisId: string;
  /** Current focus selection (document order): block index + heading level + text. */
  selection: { index: number; text: string; level?: number }[];
  /** Refresh the document after a wired edit. */
  onAfterEdit: () => void;
  /** Route an AI-bridge action: fill the AI composer input + switch to AI mode. */
  onAiAction: (instruction: string) => void;
  /** Localized label of the chosen option (for AI instructions), if any. */
  optionLabel?: string;
}

/** Run a ribbon tool. `optionValue` is the chosen preset/segment value (if any). */
export async function dispatchRibbonAction(
  tool: RibbonTool,
  optionValue: string | undefined,
  deps: DispatchDeps,
): Promise<void> {
  const first = deps.selection[0];
  const selText = deps.selection.map((s) => s.text).filter(Boolean).join("\n\n");

  // AI-bridge path: any non-wired tool.
  const toAi = () =>
    deps.onAiAction(buildToolInstruction(tool, { optionValue, optionLabel: deps.optionLabel, selectionText: selText }));

  if (tool.status !== "wired") return toAi();

  try {
    switch (tool.actionKey) {
      case "design.thesisReady":
        await formatThesis(deps.thesisId);
        deps.onAfterEdit();
        return;

      case "insert.pageBreak":
      case "layout.breaks": {
        if (!first) return toAi(); // no anchor block → let AI decide placement
        const breakType = (optionValue as "nextPage" | "evenPage" | "oddPage") ?? "nextPage";
        await startThesisBlocksOnNewPage(deps.thesisId, [first.index], breakType);
        deps.onAfterEdit();
        return;
      }

      case "insert.picture": {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
        const asset = res.canceled ? null : res.assets[0];
        if (!asset?.base64) return;
        const mime = asset.mimeType ?? "";
        const format = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg";
        await insertThesisImage(deps.thesisId, {
          data: asset.base64, format, width: asset.width, height: asset.height,
          afterIndex: first?.index,
        });
        deps.onAfterEdit();
        return;
      }

      case "heading.promote":
      case "heading.demote": {
        if (!first) return;
        const cur = first.level ?? 0;
        // promote = smaller number (toward H1); demote = larger. Clamp 0..6.
        const next = tool.actionKey === "heading.promote" ? Math.max(1, cur - 1) : Math.min(6, cur + 1);
        await editThesisParagraphs(deps.thesisId, [first.index], { level: next });
        deps.onAfterEdit();
        return;
      }

      default:
        // Marked wired but unhandled → fail safe to AI.
        return toAi();
    }
  } catch {
    Alert.alert("Error");
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `editThesisParagraphs`/`insertThesisImage`/`startThesisBlocksOnNewPage`/`formatThesis` signatures differ, open `lib/api.ts` and match the exact params — these are the same calls `ComposerEditTools` already uses.)

- [ ] **Step 3: Commit**

```bash
git add lib/ribbon-actions.ts
git commit -m "feat(ribbon): action dispatcher (wired endpoints + AI-bridge fallback)"
```

---

## Task 5: Ribbon store

**Files:**
- Create: `stores/ribbon-store.ts`

- [ ] **Step 1: Write the store**

```ts
// stores/ribbon-store.ts
import { create } from "zustand";
import type { RibbonTabId } from "@/components/workspace/ribbon/ribbon-config";

// "home" is the existing edit-tools tab (not part of RIBBON_TABS); the rest are
// config tab ids. This union is the single tab identifier used across the ribbon.
export type TabBarId = "home" | RibbonTabId;

interface RibbonState {
  activeTab: TabBarId;
  searchOpen: boolean;
  // Tool ids pinned to the favorites quick-row (in-memory for Phase 1).
  favorites: string[];
  setActiveTab: (tab: TabBarId) => void;
  setSearchOpen: (open: boolean) => void;
  toggleFavorite: (toolId: string) => void;
  reset: () => void;
}

const INITIAL = {
  activeTab: "home" as TabBarId,
  searchOpen: false,
  // Seed the quick-row with a few high-value defaults.
  favorites: ["design.thesisReady", "layout.margins", "ref.toc"] as string[],
};

export const useRibbonStore = create<RibbonState>((set) => ({
  ...INITIAL,
  setActiveTab: (activeTab) => set({ activeTab }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  toggleFavorite: (toolId) =>
    set((s) => ({
      favorites: s.favorites.includes(toolId)
        ? s.favorites.filter((f) => f !== toolId)
        : [...s.favorites, toolId],
    })),
  reset: () => set(INITIAL),
}));
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean), then:

```bash
git add stores/ribbon-store.ts
git commit -m "feat(ribbon): ribbon store (active tab, search, favorites)"
```

---

## Task 6: RibbonToolButton

**Files:**
- Create: `components/workspace/ribbon/RibbonToolButton.tsx`

- [ ] **Step 1: Write the button**

```tsx
// components/workspace/ribbon/RibbonToolButton.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_ICONS } from "./ribbon-icons";
import type { RibbonTool } from "./ribbon-config";

interface Props {
  tool: RibbonTool;
  disabled?: boolean;
  onPress: (tool: RibbonTool) => void;
}

/** One labeled icon button in the strip. Shows a ▾ affordance for popover tools and
 *  a "soon" badge for tools whose backend isn't built yet (they route to AI). */
export function RibbonToolButton({ tool, disabled, onPress }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const Icon = RIBBON_ICONS[tool.icon];
  const hasMenu = tool.kind !== "action";
  const soon = tool.status === "soon";
  const hero = tool.actionKey === "design.thesisReady";

  return (
    <Pressable
      onPress={() => onPress(tool)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t(tool.labelKey)}
      style={[
        styles.btn,
        { backgroundColor: hero ? colors.brandPrimaryLight + "22" : colors.bgSurface, borderColor: hero ? colors.brandPrimary + "55" : colors.borderSubtle },
        disabled && styles.disabled,
      ]}
    >
      {soon && (
        <View style={[styles.soon, { backgroundColor: colors.semanticWarning }]}>
          <Text style={styles.soonText}>{t("ribbon.soon", { defaultValue: "soon" })}</Text>
        </View>
      )}
      {Icon ? <Icon size={18} color={hero ? colors.brandPrimary : colors.textSecondary} strokeWidth={2} /> : null}
      <Text style={[styles.label, { color: hero ? colors.brandPrimary : colors.textSecondary }]} numberOfLines={1}>
        {t(tool.labelKey)}{hasMenu ? " ▾" : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minWidth: 60, alignItems: "center", gap: 4, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 9.5, fontFamily: "Inter_500Medium", textAlign: "center" },
  disabled: { opacity: 0.4 },
  soon: { position: "absolute", top: -5, right: -3, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6, zIndex: 1 },
  soonText: { fontSize: 7, fontFamily: "Inter_700Bold", color: "#1a1300", letterSpacing: 0.3 },
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean). Note: if `colors.semanticWarning`/`brandPrimaryLight`/`borderSubtle` aren't on the theme, check `hooks/useThemeColors` and substitute the nearest token. Then:

```bash
git add components/workspace/ribbon/RibbonToolButton.tsx
git commit -m "feat(ribbon): RibbonToolButton with soon badge + menu affordance"
```

---

## Task 7: Popover host + three variants

**Files:**
- Create: `components/workspace/ribbon/PresetListPopover.tsx`
- Create: `components/workspace/ribbon/SegmentPicker.tsx`
- Create: `components/workspace/ribbon/GridSizePicker.tsx`
- Create: `components/workspace/ribbon/RibbonPopover.tsx`

- [ ] **Step 1: PresetListPopover**

```tsx
// components/workspace/ribbon/PresetListPopover.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ToolOption } from "./ribbon-config";

export function PresetListPopover({ options, onPick }: { options: ToolOption[]; onPick: (opt: ToolOption) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={{ gap: 2 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onPick(o)} style={styles.row}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{t(o.labelKey)}</Text>
          {o.hint ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{o.hint}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, paddingHorizontal: 8, borderRadius: 8 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
```

- [ ] **Step 2: SegmentPicker**

```tsx
// components/workspace/ribbon/SegmentPicker.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ToolOption } from "./ribbon-config";

export function SegmentPicker({ options, onPick }: { options: ToolOption[]; onPick: (opt: ToolOption) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onPick(o)} style={[styles.seg, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{t(o.labelKey)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6 },
  seg: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
```

- [ ] **Step 3: GridSizePicker**

Returns the chosen dimensions as `"RxC"` in `opt.value`.

```tsx
// components/workspace/ribbon/GridSizePicker.tsx
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

const MAX = 6;

export function GridSizePicker({ onPick }: { onPick: (opt: { value: string; label: string }) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <View style={{ gap: 8, alignItems: "center" }}>
      <Text style={[styles.caption, { color: colors.textSecondary }]}>
        {hover.r > 0 ? `${hover.r} × ${hover.c}` : t("ribbon.opt.pickTableSize", { defaultValue: "Pick table size" })}
      </Text>
      <View>
        {Array.from({ length: MAX }).map((_, r) => (
          <View key={r} style={styles.gridRow}>
            {Array.from({ length: MAX }).map((_, c) => {
              const on = r < hover.r && c < hover.c;
              return (
                <Pressable
                  key={c}
                  onPressIn={() => setHover({ r: r + 1, c: c + 1 })}
                  onPress={() => onPick({ value: `${r + 1}x${c + 1}`, label: `${r + 1} × ${c + 1}` })}
                  style={[styles.cell, { borderColor: colors.borderDefault, backgroundColor: on ? colors.brandPrimary : colors.bgSurface }]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 12, fontFamily: "Inter_500Medium" },
  gridRow: { flexDirection: "row" },
  cell: { width: 26, height: 22, margin: 2, borderRadius: 3, borderWidth: 1 },
});
```

- [ ] **Step 4: RibbonPopover host**

A gorhom-friendly anchored card that renders the right variant. Uses absolute positioning inside the composer (no new modal library).

```tsx
// components/workspace/ribbon/RibbonPopover.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { RibbonTool, ToolOption } from "./ribbon-config";
import { PresetListPopover } from "./PresetListPopover";
import { SegmentPicker } from "./SegmentPicker";
import { GridSizePicker } from "./GridSizePicker";

interface Props {
  tool: RibbonTool;
  onPick: (opt: { value: string; label: string }) => void;
  onClose: () => void;
}

/** Compact popover shown above the strip for preset/segment/grid tools. */
export function RibbonPopover({ tool, onPick, onClose }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const pickOpt = (o: ToolOption) => onPick({ value: o.value, label: t(o.labelKey) });

  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textSecondary }]}>{t(tool.labelKey)}</Text>
        <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: colors.textSecondary }}>✕</Text></Pressable>
      </View>
      {tool.kind === "preset" && tool.options ? <PresetListPopover options={tool.options} onPick={pickOpt} /> : null}
      {tool.kind === "segment" && tool.options ? <SegmentPicker options={tool.options} onPick={pickOpt} /> : null}
      {tool.kind === "grid" ? <GridSizePicker onPick={onPick} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 10, marginBottom: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
});
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean). Then:

```bash
git add components/workspace/ribbon/PresetListPopover.tsx components/workspace/ribbon/SegmentPicker.tsx components/workspace/ribbon/GridSizePicker.tsx components/workspace/ribbon/RibbonPopover.tsx
git commit -m "feat(ribbon): popover host + preset/segment/grid variants"
```

---

## Task 8: RibbonToolStrip

**Files:**
- Create: `components/workspace/ribbon/RibbonToolStrip.tsx`

- [ ] **Step 1: Write the strip**

Renders one tab's tools in a horizontal scroll, inserts a divider between groups, and manages the open popover locally.

```tsx
// components/workspace/ribbon/RibbonToolStrip.tsx
import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { RibbonToolButton } from "./RibbonToolButton";
import { RibbonPopover } from "./RibbonPopover";
import type { RibbonTool } from "./ribbon-config";
import { useThemeColors } from "@/hooks/useThemeColors";

interface Props {
  tools: RibbonTool[];
  /** Run a tool. `option` is set when the user chose a popover option. */
  onRun: (tool: RibbonTool, option?: { value: string; label: string }) => void;
  /** A tool is disabled when it needs a selection there isn't one for (caller decides). */
  isDisabled?: (tool: RibbonTool) => boolean;
}

export function RibbonToolStrip({ tools, onRun, isDisabled }: Props) {
  const colors = useThemeColors();
  const [openTool, setOpenTool] = useState<RibbonTool | null>(null);

  const press = (tool: RibbonTool) => {
    if (tool.kind === "action") { onRun(tool); return; }
    setOpenTool((cur) => (cur?.id === tool.id ? null : tool)); // toggle popover
  };

  return (
    <View>
      {openTool && (
        <RibbonPopover
          tool={openTool}
          onClose={() => setOpenTool(null)}
          onPick={(opt) => { const tool = openTool; setOpenTool(null); onRun(tool, opt); }}
        />
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {tools.map((tool, i) => {
          const prev = tools[i - 1];
          const boundary = i > 0 && prev.group !== tool.group;
          return (
            <View key={tool.id} style={styles.item}>
              {boundary && <View style={[styles.divider, { backgroundColor: colors.borderDefault }]} />}
              <RibbonToolButton tool={tool} disabled={isDisabled?.(tool)} onPress={press} />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 7, paddingRight: 8, paddingVertical: 2, alignItems: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: 7 },
  divider: { width: 1, height: 30, marginRight: 2 },
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean). Then:

```bash
git add components/workspace/ribbon/RibbonToolStrip.tsx
git commit -m "feat(ribbon): tool strip with group dividers + popover toggle"
```

---

## Task 9: Contextual tab hook

**Files:**
- Create: `components/workspace/ribbon/useContextualTab.ts`

- [ ] **Step 1: Write the hook**

Derives which contextual tab (if any) applies to the current selection: a heading paragraph → "heading", a table → "table", an image → "picture".

```ts
// components/workspace/ribbon/useContextualTab.ts
import { useMemo } from "react";
import type { RibbonTabId } from "./ribbon-config";
import type { DocBlockDTO } from "@/lib/api";

/** The contextual tab for a single-block selection, or null (0 or multi selection). */
export function useContextualTab(
  blocks: DocBlockDTO[],
  selectedIndices: number[],
): RibbonTabId | null {
  return useMemo(() => {
    if (selectedIndices.length !== 1) return null;
    const b = blocks.find((x) => x.index === selectedIndices[0]);
    if (!b) return null;
    if (b.kind === "table") return "table";
    if (b.kind === "image") return "picture";
    if (b.kind === "paragraph" && (b.level ?? 0) > 0) return "heading";
    return null;
  }, [blocks, selectedIndices]);
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean; confirm `DocBlockDTO` has `kind`/`level`/`index` — it does, per `ComposerEditTools`). Then:

```bash
git add components/workspace/ribbon/useContextualTab.ts
git commit -m "feat(ribbon): contextual-tab hook from selection"
```

---

## Task 10: RibbonTabBar

**Files:**
- Create: `components/workspace/ribbon/RibbonTabBar.tsx`

- [ ] **Step 1: Write the tab bar**

Shows Home + the four fixed tabs + an optional contextual tab, horizontally scrollable, active underlined.

```tsx
// components/workspace/ribbon/RibbonTabBar.tsx
import { Text, Pressable, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_TABS, type RibbonTabId } from "./ribbon-config";
import type { TabBarId } from "@/stores/ribbon-store";

interface Props {
  active: TabBarId;
  contextual: RibbonTabId | null;
  onSelect: (tab: TabBarId) => void;
}

export function RibbonTabBar({ active, contextual, onSelect }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();

  const fixed = RIBBON_TABS.filter((tab) => !tab.contextual);
  const items: { id: TabBarId; labelKey: string }[] = [
    { id: "home", labelKey: "ribbon.tab.home" },
    ...fixed.map((tab) => ({ id: tab.id as TabBarId, labelKey: tab.labelKey })),
  ];
  if (contextual) {
    const def = RIBBON_TABS.find((tab) => tab.id === contextual);
    if (def) items.push({ id: def.id, labelKey: def.labelKey });
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((it) => {
        const on = it.id === active;
        return (
          <Pressable key={it.id} onPress={() => onSelect(it.id)} style={styles.tab}>
            <Text style={[styles.label, { color: on ? colors.brandPrimary : colors.textSecondary }, on && { borderBottomColor: colors.brandPrimary, borderBottomWidth: 2 }]}>
              {t(it.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 16, paddingRight: 8, alignItems: "flex-end", paddingBottom: 2 },
  tab: { paddingBottom: 2 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", paddingBottom: 5 },
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean). Then:

```bash
git add components/workspace/ribbon/RibbonTabBar.tsx
git commit -m "feat(ribbon): scrollable tab bar with contextual tab"
```

---

## Task 11: RibbonSearch

**Files:**
- Create: `components/workspace/ribbon/RibbonSearch.tsx`

- [ ] **Step 1: Write search**

A compact "tell me what to do" input that filters all tools (label + keywords) and runs the pick.

```tsx
// components/workspace/ribbon/RibbonSearch.tsx
import { useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_TABS, type RibbonTool } from "./ribbon-config";

const ALL_TOOLS: RibbonTool[] = RIBBON_TABS.flatMap((t) => t.tools);

export function RibbonSearch({ onRun }: { onRun: (tool: RibbonTool) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return ALL_TOOLS.filter((tool) => {
      const label = t(tool.labelKey).toLowerCase();
      const kw = (tool.keywords ?? []).join(" ").toLowerCase();
      return label.includes(n) || kw.includes(n);
    }).slice(0, 8);
  }, [q, t]);

  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.bar, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
        <Text style={{ color: colors.textPlaceholder }}>🔍</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t("ribbon.searchPlaceholder", { defaultValue: "Tell me what you want to do…" })}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.input, { color: colors.textPrimary }]}
        />
      </View>
      {results.length > 0 && (
        <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
          {results.map((tool) => (
            <Pressable key={tool.id} onPress={() => onRun(tool)} style={styles.res}>
              <Text style={[styles.resLabel, { color: colors.textPrimary }]}>{t(tool.labelKey)}</Text>
              <Text style={[styles.resTab, { color: colors.textSecondary }]}>{t(`ribbon.tab.${tool.tab}`, { defaultValue: tool.tab })}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8 },
  input: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", padding: 0 },
  res: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, paddingHorizontal: 6 },
  resLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resTab: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean). Then:

```bash
git add components/workspace/ribbon/RibbonSearch.tsx
git commit -m "feat(ribbon): tell-me-what-to-do tool search"
```

---

## Task 12: RibbonFavorites

**Files:**
- Create: `components/workspace/ribbon/RibbonFavorites.tsx`

- [ ] **Step 1: Write favorites row**

```tsx
// components/workspace/ribbon/RibbonFavorites.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_TABS, type RibbonTool } from "./ribbon-config";
import { RIBBON_ICONS } from "./ribbon-icons";
import { useRibbonStore } from "@/stores/ribbon-store";

const BY_ID: Record<string, RibbonTool> = Object.fromEntries(
  RIBBON_TABS.flatMap((t) => t.tools).map((tool) => [tool.id, tool]),
);

export function RibbonFavorites({ onRun }: { onRun: (tool: RibbonTool) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const favorites = useRibbonStore((s) => s.favorites);
  const tools = favorites.map((id) => BY_ID[id]).filter(Boolean);
  if (!tools.length) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {tools.map((tool) => {
        const Icon = RIBBON_ICONS[tool.icon];
        return (
          <Pressable key={tool.id} onPress={() => onRun(tool)} style={[styles.chip, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
            {Icon ? <Icon size={13} color={colors.brandPrimary} strokeWidth={2} /> : null}
            <Text style={[styles.label, { color: colors.textPrimary }]} numberOfLines={1}>{t(tool.labelKey)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 7, paddingRight: 8, paddingVertical: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 11.5, fontFamily: "Inter_500Medium", maxWidth: 120 },
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean). Then:

```bash
git add components/workspace/ribbon/RibbonFavorites.tsx
git commit -m "feat(ribbon): favorites quick-row"
```

---

## Task 13: ComposerRibbon orchestrator

**Files:**
- Create: `components/workspace/ribbon/ComposerRibbon.tsx`

- [ ] **Step 1: Write the orchestrator**

Composes favorites + search toggle + tab bar + the active strip (or the Home slot). Owns run-routing to the dispatcher, including switching to the contextual tab when a matching block is selected.

```tsx
// components/workspace/ribbon/ComposerRibbon.tsx
import { useEffect } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { Search } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useTranslation } from "react-i18next";
import { RIBBON_TABS, type RibbonTool } from "./ribbon-config";
import { RibbonTabBar } from "./RibbonTabBar";
import { RibbonToolStrip } from "./RibbonToolStrip";
import { RibbonSearch } from "./RibbonSearch";
import { RibbonFavorites } from "./RibbonFavorites";
import { useContextualTab } from "./useContextualTab";
import { useRibbonStore } from "@/stores/ribbon-store";
import { dispatchRibbonAction } from "@/lib/ribbon-actions";
import type { DocBlockDTO } from "@/lib/api";
// TabBarId ("home" | RibbonTabId) is defined in the store.

interface Props {
  thesisId: string;
  blocks: DocBlockDTO[];
  selection: { index: number; text: string; level?: number }[];
  /** Home tab body (the existing ComposerEditTools), rendered by the parent. */
  homeSlot: React.ReactNode;
  onAfterEdit: () => void;
  onAiAction: (instruction: string) => void;
}

export function ComposerRibbon({ thesisId, blocks, selection, homeSlot, onAfterEdit, onAiAction }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const activeTab = useRibbonStore((s) => s.activeTab);
  const setActiveTab = useRibbonStore((s) => s.setActiveTab);
  const searchOpen = useRibbonStore((s) => s.searchOpen);
  const setSearchOpen = useRibbonStore((s) => s.setSearchOpen);

  const selectedIndices = selection.map((s) => s.index);
  const contextual = useContextualTab(blocks, selectedIndices);

  // Auto-focus the contextual tab when a matching block is selected; fall back to
  // Layout when the selection clears and the contextual tab was active.
  useEffect(() => {
    if (contextual) setActiveTab(contextual);
    else if (["table", "picture", "heading"].includes(activeTab)) setActiveTab("layout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextual]);

  const run = (tool: RibbonTool, option?: { value: string; label: string }) => {
    setSearchOpen(false);
    void dispatchRibbonAction(tool, option?.value, {
      thesisId, selection, onAfterEdit, onAiAction, optionLabel: option?.label,
    });
  };

  const activeDef = RIBBON_TABS.find((tab) => tab.id === activeTab);

  return (
    <View style={{ gap: 8 }}>
      <RibbonFavorites onRun={run} />

      <View style={styles.tabRow}>
        <View style={{ flex: 1 }}>
          <RibbonTabBar active={activeTab} contextual={contextual} onSelect={(tab) => { setSearchOpen(false); setActiveTab(tab); }} />
        </View>
        <Pressable onPress={() => setSearchOpen(!searchOpen)} hitSlop={8} style={styles.searchBtn} accessibilityRole="button" accessibilityLabel={t("ribbon.search", { defaultValue: "Search tools" })}>
          <Search size={18} color={searchOpen ? colors.brandPrimary : colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </View>

      {searchOpen ? (
        <RibbonSearch onRun={run} />
      ) : activeTab === "home" ? (
        <View>{homeSlot}</View>
      ) : activeDef ? (
        <RibbonToolStrip tools={activeDef.tools} onRun={run} isDisabled={(tool) => (tool.actionKey.startsWith("heading.") ? selection.length !== 1 : false)} />
      ) : (
        <Text style={{ color: colors.textSecondary, fontSize: 12, padding: 8 }}>{t("ribbon.empty", { defaultValue: "No tools." })}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: "row", alignItems: "flex-end", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#8883" },
  searchBtn: { paddingHorizontal: 6, paddingBottom: 6 },
});
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: clean). Then:

```bash
git add components/workspace/ribbon/ComposerRibbon.tsx
git commit -m "feat(ribbon): ComposerRibbon orchestrator"
```

---

## Task 14: i18n keys (en/fr/ar)

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Add the `ribbon` block to en.json**

Add this key block at the top level of `locales/en.json` (inside the root object, e.g. after the `"workspace"` block). Keep JSON valid (comma placement).

```json
"ribbon": {
  "soon": "soon",
  "search": "Search tools",
  "searchPlaceholder": "Tell me what you want to do…",
  "empty": "No tools.",
  "tab": { "home": "Home", "layout": "Layout", "design": "Design", "insert": "Insert", "references": "References", "heading": "Heading", "table": "Table", "picture": "Picture" },
  "grp": { "pageSetup": "Page setup", "paragraph": "Paragraph", "format": "Format", "pageDesign": "Page design", "tables": "Tables", "illustrations": "Illustrations", "headerFooter": "Header & footer", "symbols": "Symbols", "toc": "Contents", "footnotes": "Footnotes", "citations": "Citations", "captions": "Captions", "heading": "Heading", "tableRows": "Rows & columns", "tableStyle": "Table style", "picture": "Picture" },
  "tools": {
    "margins": "Margins", "orientation": "Orientation", "size": "Size", "columns": "Columns", "breaks": "Breaks", "lineNumbers": "Line numbers", "indent": "Indent", "spacing": "Spacing",
    "thesisReady": "Thesis-ready", "fonts": "Fonts", "paraSpacing": "Paragraph spacing", "themes": "Themes", "pageColor": "Page color", "pageBorders": "Page borders", "watermark": "Watermark",
    "table": "Table", "picture": "Picture", "chart": "Chart", "shapes": "Shapes", "textBox": "Text box", "header": "Header", "footer": "Footer", "pageNumber": "Page number", "footnote": "Footnote", "symbol": "Symbol", "pageBreak": "Page break",
    "toc": "Contents", "updateToc": "Update contents", "endnote": "Endnote", "citation": "Citation", "citationStyle": "Style", "bibliography": "Bibliography", "caption": "Caption", "figuresList": "Figures list", "crossRef": "Cross-reference",
    "promote": "Promote", "demote": "Demote", "insertRow": "Insert row", "insertCol": "Insert column", "headerRow": "Header row", "replace": "Replace"
  },
  "opt": {
    "marginNormal": "Normal", "marginNarrow": "Narrow", "marginModerate": "Moderate", "marginWide": "Wide", "marginMirrored": "Mirrored",
    "portrait": "Portrait", "landscape": "Landscape", "a4": "A4", "letter": "Letter", "legal": "Legal", "a3": "A3", "a5": "A5",
    "oneCol": "One", "twoCol": "Two", "threeCol": "Three", "pageBreak": "Page break", "evenPage": "Even page", "oddPage": "Odd page",
    "apa": "APA", "mla": "MLA", "chicago": "Chicago", "pickTableSize": "Pick table size"
  }
}
```

- [ ] **Step 2: Add the same block, translated, to fr.json**

```json
"ribbon": {
  "soon": "bientôt",
  "search": "Rechercher des outils",
  "searchPlaceholder": "Que voulez-vous faire ?…",
  "empty": "Aucun outil.",
  "tab": { "home": "Accueil", "layout": "Mise en page", "design": "Création", "insert": "Insertion", "references": "Références", "heading": "Titre", "table": "Tableau", "picture": "Image" },
  "grp": { "pageSetup": "Mise en page", "paragraph": "Paragraphe", "format": "Format", "pageDesign": "Conception", "tables": "Tableaux", "illustrations": "Illustrations", "headerFooter": "En-tête & pied", "symbols": "Symboles", "toc": "Sommaire", "footnotes": "Notes", "citations": "Citations", "captions": "Légendes", "heading": "Titre", "tableRows": "Lignes & colonnes", "tableStyle": "Style de tableau", "picture": "Image" },
  "tools": {
    "margins": "Marges", "orientation": "Orientation", "size": "Taille", "columns": "Colonnes", "breaks": "Sauts", "lineNumbers": "Numéros de ligne", "indent": "Retrait", "spacing": "Espacement",
    "thesisReady": "Prêt-mémoire", "fonts": "Polices", "paraSpacing": "Espacement paragraphe", "themes": "Thèmes", "pageColor": "Couleur de page", "pageBorders": "Bordures", "watermark": "Filigrane",
    "table": "Tableau", "picture": "Image", "chart": "Graphique", "shapes": "Formes", "textBox": "Zone de texte", "header": "En-tête", "footer": "Pied de page", "pageNumber": "Numéro de page", "footnote": "Note de bas", "symbol": "Symbole", "pageBreak": "Saut de page",
    "toc": "Sommaire", "updateToc": "Mettre à jour", "endnote": "Note de fin", "citation": "Citation", "citationStyle": "Style", "bibliography": "Bibliographie", "caption": "Légende", "figuresList": "Table des figures", "crossRef": "Renvoi",
    "promote": "Promouvoir", "demote": "Abaisser", "insertRow": "Insérer ligne", "insertCol": "Insérer colonne", "headerRow": "Ligne d'en-tête", "replace": "Remplacer"
  },
  "opt": {
    "marginNormal": "Normales", "marginNarrow": "Étroites", "marginModerate": "Modérées", "marginWide": "Larges", "marginMirrored": "En vis-à-vis",
    "portrait": "Portrait", "landscape": "Paysage", "a4": "A4", "letter": "Letter", "legal": "Legal", "a3": "A3", "a5": "A5",
    "oneCol": "Une", "twoCol": "Deux", "threeCol": "Trois", "pageBreak": "Saut de page", "evenPage": "Page paire", "oddPage": "Page impaire",
    "apa": "APA", "mla": "MLA", "chicago": "Chicago", "pickTableSize": "Choisir la taille"
  }
}
```

- [ ] **Step 3: Add the same block, translated, to ar.json**

```json
"ribbon": {
  "soon": "قريبًا",
  "search": "البحث عن الأدوات",
  "searchPlaceholder": "ماذا تريد أن تفعل؟…",
  "empty": "لا توجد أدوات.",
  "tab": { "home": "الرئيسية", "layout": "التخطيط", "design": "التصميم", "insert": "إدراج", "references": "المراجع", "heading": "عنوان", "table": "جدول", "picture": "صورة" },
  "grp": { "pageSetup": "إعداد الصفحة", "paragraph": "فقرة", "format": "تنسيق", "pageDesign": "تصميم الصفحة", "tables": "جداول", "illustrations": "رسومات", "headerFooter": "رأس وتذييل", "symbols": "رموز", "toc": "المحتويات", "footnotes": "الحواشي", "citations": "الاستشهادات", "captions": "التسميات", "heading": "عنوان", "tableRows": "صفوف وأعمدة", "tableStyle": "نمط الجدول", "picture": "صورة" },
  "tools": {
    "margins": "الهوامش", "orientation": "الاتجاه", "size": "الحجم", "columns": "الأعمدة", "breaks": "الفواصل", "lineNumbers": "أرقام الأسطر", "indent": "المسافة البادئة", "spacing": "التباعد",
    "thesisReady": "جاهزة للمذكرة", "fonts": "الخطوط", "paraSpacing": "تباعد الفقرات", "themes": "السمات", "pageColor": "لون الصفحة", "pageBorders": "حدود الصفحة", "watermark": "علامة مائية",
    "table": "جدول", "picture": "صورة", "chart": "مخطط", "shapes": "أشكال", "textBox": "مربع نص", "header": "رأس", "footer": "تذييل", "pageNumber": "رقم الصفحة", "footnote": "حاشية", "symbol": "رمز", "pageBreak": "فاصل صفحة",
    "toc": "المحتويات", "updateToc": "تحديث المحتويات", "endnote": "تعليق ختامي", "citation": "استشهاد", "citationStyle": "النمط", "bibliography": "المراجع", "caption": "تسمية", "figuresList": "قائمة الأشكال", "crossRef": "إحالة مرجعية",
    "promote": "ترقية", "demote": "خفض", "insertRow": "إدراج صف", "insertCol": "إدراج عمود", "headerRow": "صف رأس", "replace": "استبدال"
  },
  "opt": {
    "marginNormal": "عادية", "marginNarrow": "ضيقة", "marginModerate": "متوسطة", "marginWide": "واسعة", "marginMirrored": "متقابلة",
    "portrait": "طولي", "landscape": "عرضي", "a4": "A4", "letter": "Letter", "legal": "Legal", "a3": "A3", "a5": "A5",
    "oneCol": "واحد", "twoCol": "اثنان", "threeCol": "ثلاثة", "pageBreak": "فاصل صفحة", "evenPage": "صفحة زوجية", "oddPage": "صفحة فردية",
    "apa": "APA", "mla": "MLA", "chicago": "Chicago", "pickTableSize": "اختر حجم الجدول"
  }
}
```

- [ ] **Step 4: Validate JSON + typecheck**

Run: `for f in en fr ar; do node -e "JSON.parse(require('fs').readFileSync('locales/$f.json','utf8'));console.log('$f ok')"; done && npx tsc --noEmit`
Expected: `en ok / fr ok / ar ok` and no tsc errors.

- [ ] **Step 5: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(ribbon): trilingual i18n keys"
```

---

## Task 15: Integrate into the composer (Edit mode → ribbon)

**Files:**
- Modify: `components/workspace/WorkspaceComposerSheet.tsx`

Context: today Edit mode renders `<ComposerEditTools .../>` directly (see the `composerMode === "edit" && isLiveDoc` branch). We wrap it: `ComposerRibbon` renders the tab bar and, for the Home tab, shows the existing `ComposerEditTools` as `homeSlot`. `onAiAction` fills the AI input and switches to AI mode; `onAfterEdit` is the same `onAfterBulkEdit`/refresh already passed in.

- [ ] **Step 1: Import ComposerRibbon**

Add near the other ribbon/composer imports at the top of `components/workspace/WorkspaceComposerSheet.tsx`:

```tsx
import { ComposerRibbon } from "./ribbon/ComposerRibbon";
```

- [ ] **Step 2: Build the selection payload + AI-action handler**

Inside the component body (near the existing `editSelection`/`indices` memos), add a ribbon-selection array and the AI handler. `ordered` (already defined) is the selection in document order; enrich it with heading level from `blocks`.

```tsx
// Selection payload for the ribbon dispatcher: index + text + heading level.
const ribbonSelection = useMemo(
  () =>
    ordered.map((b) => {
      const doc = blocks.find((x) => x.index === b.index);
      const level = doc && doc.kind === "paragraph" ? doc.level ?? 0 : 0;
      return { index: b.index, text: b.text, level };
    }),
  [ordered, blocks],
);

// AI-bridge target: fill the composer input with the instruction and switch to AI
// mode + expand, matching the quick-action "fill, don't send" behavior.
const handleRibbonAiAction = (instruction: string) => {
  useWorkspaceStore.getState().setComposerMode("ai");
  setInputText(instruction);
  useWorkspaceStore.getState().setComposerOpen(true);
  sheetRef.current?.snapToIndex(1);
};
```

- [ ] **Step 3: Replace the Edit-mode body with the ribbon**

Find the Edit-mode branch (currently rendering `<ComposerEditTools .../>` when `composerMode === "edit" && isLiveDoc`). Replace the `<ComposerEditTools .../>` element with `<ComposerRibbon>`, passing the existing `ComposerEditTools` as `homeSlot` (keep its exact current props):

```tsx
<ComposerRibbon
  thesisId={thesisId}
  blocks={blocks}
  selection={ribbonSelection}
  onAfterEdit={onAfterBulkEdit}
  onAiAction={handleRibbonAiAction}
  homeSlot={
    <ComposerEditTools
      thesisId={thesisId}
      selection={editSelection}
      blockCount={blocks.length}
      hint={t("composer.edit.selectHint", { defaultValue: "Select a paragraph to edit." })}
      styleLabels={{ normal: t("composer.edit.normal", { defaultValue: "Normal" }) }}
      onAfterEdit={onAfterBulkEdit}
      rtl={rtl}
    />
  }
/>
```

(Keep the surrounding `pendingAsk`/mode conditionals unchanged. If the current `ComposerEditTools` props differ from the snippet, copy them verbatim from the existing call — do not invent props.)

- [ ] **Step 4: Reset ribbon state on leave**

In the workspace screen `app/(app)/thesis-workspace.tsx`, the cleanup effect already calls `useWorkspaceStore.getState().reset()`. Add a ribbon reset next to it so the tab/search don't persist across theses. Find that cleanup (the `return () => { ... }` in the mount effect) and add:

```tsx
useRibbonStore.getState().reset();
```

with the import at the top of `app/(app)/thesis-workspace.tsx`:

```tsx
import { useRibbonStore } from "@/stores/ribbon-store";
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/workspace/WorkspaceComposerSheet.tsx "app/(app)/thesis-workspace.tsx"
git commit -m "feat(ribbon): mount ribbon in composer Edit mode (Home = existing edit tools)"
```

---

## Task 16: Manual verification on device/simulator

**Files:** none (verification only).

- [ ] **Step 1: Launch and drive the flow**

Start the app (`npm run ios` or the project's run skill). Open a live-docx thesis → workspace → open the composer → tap **Edit**.

- [ ] **Step 2: Confirm each behavior**

- Tabs **Home · Layout · Design · Insert · References** appear; Home shows the existing edit tools (style/align/etc.).
- Layout → **Margins** opens a preset popover; **Columns/Orientation** show a segmented popover; **Insert → Table** shows the grid picker.
- A `soon` tool (e.g. Design → **Watermark**) switches to **AI** mode with the instruction pre-filled in the input (not auto-sent).
- **Design → Thesis-ready** runs formatting (spinner, then the doc refreshes).
- **Insert → Picture** opens the image picker and inserts.
- Select a single **heading** block → a **Heading** contextual tab appears with Promote/Demote; promote changes its level and the doc refreshes.
- **🔍 search**: type "apa" → **Style** appears in results; tapping it (a `soon` tool) routes to AI.
- Favorites row (Thesis-ready / Margins / Contents) runs the tools.

- [ ] **Step 2: Commit nothing / note issues**

If anything fails, fix in the owning component and re-run `npx tsc --noEmit` before re-testing. No commit for this task.

---

## Deferred (not this plan)

- **Phase 2 — backend, one tool at a time.** Add `/api/thesis/*` endpoints + MCP tools for the wire-now engine methods (Margins, Orientation, Size, Columns, Breaks, Line numbers, Table, Header/Footer, Page number, Footnote, Endnote, TOC, Update TOC, Citation, Bibliography, Caption, Figures list, Cross-reference, Table row/col ops, Picture replace/caption). For each, follow the `PUT /:id/paragraphs/:index` pattern (load→mutate via `doc.engine.*`→reupload→reindex→bump `updatedAt`), add a `lib/api` client fn, then flip that tool's `status` to `"wired"` and add a `case` in `dispatchRibbonAction`.
- **Live preview (enhancement 5).** Build `useLivePreview` + `RibbonPreviewBar` once the layout endpoints exist, so margins/orientation/size/columns preview before Apply.
- **Phase 3 — engine features** for the 6 `soon`-only tools: Themes, Page color, Page borders, Watermark, per-paragraph Indent, per-paragraph Spacing.
- **Favorites persistence** (AsyncStorage) — currently in-memory, reset per session.
