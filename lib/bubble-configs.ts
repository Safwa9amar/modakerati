import { BarChart3, Heading1, Image as ImageIcon, Shapes, Sparkles, Table, Type, type LucideIcon } from "lucide-react-native";
import type { DocBlockDTO } from "@/lib/api";

/** Which bubble/toolset family a selection belongs to. "ai" = nothing selected. */
export type BubbleKind = "ai" | "text" | "heading" | "image" | "chart" | "table" | "other";

/** Resolve the sole selected block (or null) to its bubble kind. Charts arrive as
 *  image blocks WITHOUT media bytes (the placeholder case); headings are
 *  paragraphs with level ≥ 1. Multi-select / unknown → "text" (the safe default:
 *  text tools disable themselves when they don't apply). */
export function resolveBubbleKind(block: DocBlockDTO | null | undefined): BubbleKind {
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

/** Bubble icon per kind — the collapsed circle's glyph. */
export const BUBBLE_ICONS: Record<BubbleKind, LucideIcon> = {
  ai: Sparkles,
  text: Type,
  heading: Heading1,
  image: ImageIcon,
  chart: BarChart3,
  table: Table,
  other: Shapes,
};
