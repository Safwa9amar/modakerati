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
