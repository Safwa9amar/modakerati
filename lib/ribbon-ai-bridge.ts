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
  "layout.margins": "Set the page margins to {opt}.",
  "layout.orientation": "Set the page orientation to {opt}.",
  "layout.size": "Set the page size to {opt}.",
  "layout.columns": "Set the number of text columns to {opt}.",
  "layout.lineNumbers": "Add line numbers to the document.",
  "insert.table": "Insert a {opt} table into the document.",
  "heading.promote": "Promote the selected heading one level (toward Heading 1).",
  "heading.demote": "Demote the selected heading one level.",
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
  let out = params.optionLabel ? base.replace("{opt}", params.optionLabel) : base.replace("{opt}", "");
  // If the template had no {opt} slot but the user chose an option, keep it.
  if (params.optionLabel && !base.includes("{opt}")) out += ` (${params.optionLabel})`;
  const sel = params.selectionText?.trim();
  return sel ? `${out}\n\nSelected text: "${sel.slice(0, 400)}"` : out;
}
