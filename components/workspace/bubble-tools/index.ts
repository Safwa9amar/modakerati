import type { ComponentType } from "react";
import type { ToolbarKind } from "@/stores/toolbar-store";
import { HeadingTools, ParagraphTools } from "./ParagraphToolbar";
import { FormatPanel } from "./FormatPanel";
import { ListTools } from "./ListToolbar";
import { ImageTools, MinimalTools } from "./ImageToolbar";
import { ChartPanel, ChartTools } from "./ChartToolbar";
import { TablePanel, TableTools } from "./TableToolbar";
import { HeaderFooterTools } from "./HeaderFooterToolbar";
import { SectionPanel, SectionTools } from "./SectionToolbar";

export { ToolbarProvider, useTools, useChipKit, type ToolbarCtx, type ChromeSelection, type ParagraphBlock, type Align } from "./context";
export { CHIP, toolStyles } from "./styles";

/** `full` = show the complete toolset rather than the curated compact one — true
 *  when the pill is expanded via (+) or docked on the keyboard. Toolbars whose set
 *  doesn't split (table, chart, chrome) simply ignore it. */
export interface ToolsProps {
  full: boolean;
}

export interface ToolbarModule {
  /** The chips, as a fragment — the shell owns the scroller they sit in. */
  Tools: ComponentType<ToolsProps>;
  /** The open category's options, or nothing if this toolbar has no sub-panels. Reads
   *  which category is open from the store; the shell keys it by target, so a panel
   *  holding a draft starts clean on a new selection. */
  Panel?: ComponentType<{}>;
}

/**
 * ONE module per selection kind. `useToolbarStore.kind` — resolved from the live
 * selection by FloatingPill — indexes straight into this table, so adding a block
 * kind means adding a file here and nothing else.
 *
 * "ai" (nothing selected) has no toolbar: that state belongs to the AI dock, and the
 * shell never renders a toolbar for it. It maps to the paragraph tools purely so the
 * record stays total.
 */
export const TOOLBARS: Record<ToolbarKind, ToolbarModule> = {
  ai: { Tools: ParagraphTools, Panel: FormatPanel },
  text: { Tools: ParagraphTools, Panel: FormatPanel },
  heading: { Tools: HeadingTools, Panel: FormatPanel },
  list: { Tools: ListTools, Panel: FormatPanel },
  image: { Tools: ImageTools },
  // A NATIVE Word chart is genuinely editable (type/legend/labels/colours), unlike
  // the line-art drawings that now fall to "other".
  chart: { Tools: ChartTools, Panel: ChartPanel },
  other: { Tools: MinimalTools },
  table: { Tools: TableTools, Panel: TablePanel },
  // No Panel: the header/footer flow lives in components/HeaderFooterSheet.
  hfTop: { Tools: HeaderFooterTools },
  hfBottom: { Tools: HeaderFooterTools },
  hfSection: { Tools: SectionTools, Panel: SectionPanel },
};
