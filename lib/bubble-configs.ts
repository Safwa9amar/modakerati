import { BarChart3, Heading1, Image as ImageIcon, List, PanelBottom, PanelTop, SeparatorHorizontal, Shapes, Sparkles, Table, Type, type LucideIcon } from "lucide-react-native";
import type { DocBlockDTO } from "@/lib/api";

/** Which bubble/toolset family a selection belongs to. "ai" = nothing selected.
 *  The "hf*" kinds are the Word chrome bands (section top-of-page / bottom-of-page /
 *  section break) — they have no DocBlockDTO, so they never come from resolveBubbleKind.
 *  "list" is driven by the LIVE Lexical format (bullet/number/check), not the DTO. */
export type BubbleKind = "ai" | "text" | "heading" | "list" | "image" | "chart" | "table" | "other" | "hfTop" | "hfBottom" | "hfSection";

/** Resolve the sole selected block (or null) to its bubble kind. `listType` is the
 *  live Lexical block format ("bullet" | "number" | "check") when the Writer is
 *  active and the caret sits in a list — it takes precedence so a list item gets the
 *  dedicated list toolset instead of the plain text one (the DTO can't be trusted for
 *  list-ness: it lags the live editor and only round-trips bullets). Charts arrive as
 *  image blocks WITHOUT media bytes (the placeholder case); headings are paragraphs
 *  with level ≥ 1. Multi-select / unknown → "text" (the safe default: text tools
 *  disable themselves when they don't apply). */
export function resolveBubbleKind(block: DocBlockDTO | null | undefined, listType?: string | null): BubbleKind {
  if (listType === "bullet" || listType === "number" || listType === "check") return "list";
  if (!block) return "text";
  switch (block.kind) {
    case "paragraph":
      return block.level >= 1 ? "heading" : "text";
    case "image":
      return block.dataUri || block.hasMedia ? "image" : "chart";
    case "table":
      return "table";
    case "other":
      return "other";
    default:
      return "text";
  }
}

/** Map a chrome-band kind to its bubble family (chrome bands aren't DocBlockDTOs). */
export function chromeBubbleKind(kind: "top" | "bottom" | "section"): BubbleKind {
  return kind === "top" ? "hfTop" : kind === "bottom" ? "hfBottom" : "hfSection";
}

/** Bubble icon per kind — the collapsed circle's glyph. */
export const BUBBLE_ICONS: Record<BubbleKind, LucideIcon> = {
  ai: Sparkles,
  text: Type,
  heading: Heading1,
  list: List,
  image: ImageIcon,
  chart: BarChart3,
  table: Table,
  other: Shapes,
  hfTop: PanelTop,
  hfBottom: PanelBottom,
  hfSection: SeparatorHorizontal,
};
