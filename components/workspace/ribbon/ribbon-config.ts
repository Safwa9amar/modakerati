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
  // Icon coverage is checked in ribbon-icons via RIBBON_ICON_KEYS to avoid an
  // RN import here; see components/workspace/ribbon/ribbon-icons.tsx.
}
