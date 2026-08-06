import type { LucideIcon } from "lucide-react-native";
import {
  Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, Quote, List, ListOrdered,
  Image as ImageIcon, ClipboardPaste, SquareSplitVertical, Table, Minus, Sigma, ListTree, Superscript,
  Heading, Type as TypeIcon, Pilcrow, Baseline,
} from "lucide-react-native";
import type { BlockKind } from "@/stores/insert-menu-store";

export type InsertCategory = "text" | "styles" | "lists" | "media" | "academic" | "layout";

export interface InsertBlockDef {
  kind: BlockKind;
  category: InsertCategory;
  Icon: LucideIcon;
  labelKey: string;        // → t(`insertMenu.block.${...}`)
  status: "ready" | "soon"; // Phase 1 wires "ready"; "soon" render disabled
  styleId?: string; // Word named paragraph style to apply (styles category); undefined for block kinds
}

// Order here is the render order inside each category.
export const INSERT_BLOCKS: InsertBlockDef[] = [
  { kind: "h1",       category: "text",     Icon: Heading1,            labelKey: "h1",       status: "ready" },
  { kind: "h2",       category: "text",     Icon: Heading2,            labelKey: "h2",       status: "ready" },
  { kind: "h3",       category: "text",     Icon: Heading3,            labelKey: "h3",       status: "ready" },
  { kind: "h4",       category: "text",     Icon: Heading4,            labelKey: "h4",       status: "ready" },
  { kind: "h5",       category: "text",     Icon: Heading5,            labelKey: "h5",       status: "ready" },
  { kind: "h6",       category: "text",     Icon: Heading6,            labelKey: "h6",       status: "ready" },
  { kind: "quote",    category: "text",     Icon: Quote,               labelKey: "quote",    status: "ready" },
  { kind: "normal",       category: "styles", Icon: Pilcrow,  labelKey: "normal",       status: "ready", styleId: "Normal" },
  { kind: "title",        category: "styles", Icon: Heading,  labelKey: "title",        status: "ready", styleId: "Title" },
  { kind: "subtitle",     category: "styles", Icon: TypeIcon, labelKey: "subtitle",     status: "ready", styleId: "Subtitle" },
  { kind: "intenseQuote", category: "styles", Icon: Quote,    labelKey: "intenseQuote", status: "ready", styleId: "IntenseQuote" },
  { kind: "noSpacing",    category: "styles", Icon: Baseline, labelKey: "noSpacing",    status: "ready", styleId: "NoSpacing" },
  { kind: "bullet",   category: "lists",    Icon: List,                labelKey: "bullet",   status: "ready" },
  { kind: "number",   category: "lists",    Icon: ListOrdered,         labelKey: "number",   status: "ready" },
  { kind: "table",    category: "media",    Icon: Table,               labelKey: "table",    status: "soon" },  // Phase 2
  { kind: "figure",   category: "media",    Icon: ImageIcon,           labelKey: "figure",   status: "ready" },
  { kind: "pasteImage", category: "media",  Icon: ClipboardPaste,      labelKey: "pasteImage", status: "ready" },
  { kind: "divider",  category: "media",    Icon: Minus,               labelKey: "divider",  status: "soon" },  // Phase 2
  { kind: "equation", category: "academic", Icon: Sigma,               labelKey: "equation", status: "soon" },  // Phase 3
  { kind: "toc",      category: "academic", Icon: ListTree,            labelKey: "toc",      status: "soon" },  // Phase 3
  { kind: "footnote", category: "academic", Icon: Superscript,         labelKey: "footnote", status: "soon" },  // Phase 3
  { kind: "pageBreak",category: "layout",   Icon: SquareSplitVertical, labelKey: "pageBreak",status: "ready" },
];

export const INSERT_CATEGORIES: InsertCategory[] = ["text", "styles", "lists", "media", "academic", "layout"];

// Filter helper shared by compact (/query) and full-screen (search field). Matches
// the localized label OR the kind — caller passes the already-localized label getter.
export function filterBlocks(query: string, label: (def: InsertBlockDef) => string): InsertBlockDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return INSERT_BLOCKS;
  return INSERT_BLOCKS.filter((b) => b.kind.toLowerCase().includes(q) || label(b).toLowerCase().includes(q));
}
