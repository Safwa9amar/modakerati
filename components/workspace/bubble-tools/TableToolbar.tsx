import React from "react";
import { Text, View } from "react-native";
import {
  AlignCenter,
  AlignHorizontalSpaceAround,
  AlignLeft,
  AlignRight,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Columns3,
  Grid2x2,
  LayoutGrid,
  Palette,
  PanelTop,
  PilcrowLeft,
  PilcrowRight,
  Rows3,
  Search,
  Square,
  StretchHorizontal,
  Trash2,
  X,
} from "lucide-react-native";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useToolbarStore, type BorderStyleKey } from "@/stores/toolbar-store";
import type { ThesisOp } from "@/lib/thesis-ops";
import { AnimatedChip } from "../AnimatedChip";
import { useChipKit, useTools } from "./context";
import { toolStyles } from "./styles";

// Border pickers: OOXML line styles (glyph labels), widths in points, line colours
// (6-hex, no '#').
const BORDER_STYLES: { key: BorderStyleKey; glyph: string }[] = [
  { key: "single", glyph: "─" },
  { key: "double", glyph: "═" },
  { key: "dashed", glyph: "┄" },
  { key: "dotted", glyph: "┈" },
  { key: "thick", glyph: "━" },
];
const BORDER_WIDTHS: { pt: number; label: string }[] = [
  { pt: 0.5, label: "½" },
  { pt: 1, label: "1" },
  { pt: 2, label: "2" },
];
const BORDER_COLORS = ["000000", "808080", "4472C4", "ED7D31", "C00000"];

// Header-fill swatches — the classic Word accent set plus neutral grey.
const TABLE_FILLS = ["ED7D31", "4472C4", "70AD47", "FFC000", "D9D9D9"];
const ZEBRA_FILL = "F2F2F2";

/** Every table edit goes through the SILENT sync path (shared with in-cell editing):
 *  an optimistic patch plus a direct server apply, with no durable-queue refetch
 *  cascade. The engine's Doc facade preserves the table's existing formatting. */
function useTableEdit(thesisId: string, soleIndex: number | null) {
  return (op: Omit<Extract<ThesisOp, { type: "tableOp" }>, "type" | "index">) => {
    if (soleIndex == null) return;
    void useThesisDocStore.getState().applyTableOpSilent(thesisId, { type: "tableOp", index: soleIndex, ...op });
  };
}

/** Read the Word table styling the server rides on the table DTO (see the server's
 *  parseTableStyle) — it isn't on the base api type, so it comes through a cast. */
function tableFacts(selectedBlock: ReturnType<typeof useTools>["selectedBlock"]) {
  const rows = selectedBlock?.kind === "table" ? selectedBlock.rows.length : 0;
  const cols = selectedBlock?.kind === "table" ? (selectedBlock.rows[0]?.length ?? 0) : 0;
  const style =
    selectedBlock?.kind === "table"
      ? (selectedBlock as { align?: "left" | "center" | "right" | null; direction?: "rtl" | "ltr"; header?: boolean })
      : null;
  return { rows, cols, align: style?.align ?? null, direction: style?.direction ?? null, header: !!style?.header };
}

/**
 * A Word table. Structure and layout editing is organised into CATEGORIES that each
 * open a sub-panel (Rows / Columns / Layout / Colors / Borders), mirroring the
 * paragraph Style/Align/Direction pattern. The row also carries move/delete of the
 * whole table plus document search. No compact/full split — the toolset is the same
 * either way.
 */
export function TableTools() {
  const { chip, categoryChip, sep, t } = useChipKit();
  const { canUp, canDown, move, del, openSearch } = useTools();
  return (
    <>
      {categoryChip("tblRows", Rows3, t("blockBar.rows", { defaultValue: "Rows" }), 0)}
      {categoryChip("tblCols", Columns3, t("blockBar.columns", { defaultValue: "Columns" }), 1)}
      {categoryChip("tblLayout", LayoutGrid, t("blockBar.tableLayout", { defaultValue: "Table layout" }), 2)}
      {categoryChip("tblShade", Palette, t("blockBar.tableShading", { defaultValue: "Table colors" }), 3)}
      {categoryChip("tblBorders", Grid2x2, t("blockBar.tableBorders", { defaultValue: "Borders" }), 4)}
      {sep("ts1")}
      {chip({ keyProp: "img-up", Icon: ChevronUp, accessibilityLabel: t("blockBar.moveUp", { defaultValue: "Move up" }), disabled: !canUp, enterIndex: 5, onPress: () => move("up") })}
      {chip({ keyProp: "img-down", Icon: ChevronDown, accessibilityLabel: t("blockBar.moveDown", { defaultValue: "Move down" }), disabled: !canDown, enterIndex: 6, onPress: () => move("down") })}
      {chip({ keyProp: "img-del", Icon: Trash2, accessibilityLabel: t("common.delete", { defaultValue: "Delete" }), enterIndex: 7, onPress: del })}
      {chip({ keyProp: "tbl-search", Icon: Search, accessibilityLabel: t("dockBar.search", { defaultValue: "Search" }), enterIndex: 8, onPress: openSearch })}
    </>
  );
}

/** The table sub-panels. Which one shows is the store's `category`. */
export function TablePanel() {
  const { iconOpt, optPill, colors, t } = useChipKit();
  const { thesisId, soleIndex, selectedBlock } = useTools();
  const category = useToolbarStore((s) => s.category);
  const delPick = useToolbarStore((s) => s.delPick);
  const setDelPick = useToolbarStore((s) => s.setDelPick);
  const border = useToolbarStore((s) => s.border);
  const setBorder = useToolbarStore((s) => s.setBorder);
  const tableEdit = useTableEdit(thesisId, soleIndex);
  const { rows, cols, align, direction, header } = tableFacts(selectedBlock);

  /** 1..N picker chip — "delete a SPECIFIC row/column", not just the last one. */
  const numChip = (i: number, onPress: () => void) => (
    <AnimatedChip key={`n${i}`} enterIndex={i + 1} onPress={onPress} accessibilityLabel={String(i + 1)} style={optPill(false)}>
      <Text style={[toolStyles.optText, { color: colors.textPrimary }]}>{i + 1}</Text>
    </AnimatedChip>
  );

  if (category === "tblRows") {
    return delPick === "row" ? (
      <>
        {iconOpt("tr-back", X, t("common.cancel", { defaultValue: "Cancel" }), 0, () => setDelPick(null))}
        {Array.from({ length: Math.min(rows, 20) }, (_, i) =>
          numChip(i, () => { setDelPick(null); void tableEdit({ action: "deleteRow", row: i }); }),
        )}
      </>
    ) : (
      <>
        {iconOpt("tr-top", ArrowUpToLine, t("blockBar.rowAbove", { defaultValue: "Insert row at top" }), 0, () => void tableEdit({ action: "addRow", at: 0, before: true }))}
        {iconOpt("tr-bot", ArrowDownToLine, t("blockBar.rowBelow", { defaultValue: "Add row at bottom" }), 1, () => void tableEdit({ action: "addRow" }))}
        {iconOpt("tr-dist", AlignVerticalSpaceAround, t("blockBar.distributeRows", { defaultValue: "Equalize row heights" }), 2, () => void tableEdit({ action: "layout", opts: { distributeRows: true } }))}
        {iconOpt("tr-del", Trash2, t("blockBar.deleteRowPick", { defaultValue: "Delete a row…" }), 3, () => setDelPick("row"), { disabled: rows <= 1 })}
      </>
    );
  }

  if (category === "tblCols") {
    return delPick === "col" ? (
      <>
        {iconOpt("tc-back", X, t("common.cancel", { defaultValue: "Cancel" }), 0, () => setDelPick(null))}
        {Array.from({ length: Math.min(cols, 20) }, (_, i) =>
          numChip(i, () => { setDelPick(null); void tableEdit({ action: "deleteColumn", col: i }); }),
        )}
      </>
    ) : (
      <>
        {iconOpt("tc-left", ArrowLeftToLine, t("blockBar.colLeft", { defaultValue: "Insert column at left" }), 0, () => void tableEdit({ action: "addColumn", at: 0, before: true }))}
        {iconOpt("tc-right", ArrowRightToLine, t("blockBar.colRight", { defaultValue: "Add column at right" }), 1, () => void tableEdit({ action: "addColumn" }))}
        {iconOpt("tc-dist", AlignHorizontalSpaceAround, t("blockBar.distributeCols", { defaultValue: "Equalize column widths" }), 2, () => void tableEdit({ action: "layout", opts: { distributeColumns: true } }))}
        {iconOpt("tc-del", Trash2, t("blockBar.deleteColumnPick", { defaultValue: "Delete a column…" }), 3, () => setDelPick("col"), { disabled: cols <= 1 })}
      </>
    );
  }

  if (category === "tblShade") {
    // Manual parity with the AI's colouring: header fill, zebra striping (alternating
    // data rows) and header text white/black — all through the silent tableOp path.
    const zebra = () => {
      const fills = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, () => (r > 0 && r % 2 === 1 ? ZEBRA_FILL : null)),
      );
      void tableEdit({ action: "shade", fills });
    };
    const headerText = (hex: string) => {
      void tableEdit({ action: "shade", textColors: [Array.from({ length: cols }, () => hex)] });
    };
    return (
      <>
        {TABLE_FILLS.map((hex, i) => (
          <AnimatedChip
            key={`tf${hex}`}
            enterIndex={i}
            onPress={() => void tableEdit({ action: "layout", opts: { headerFill: hex } })}
            accessibilityLabel={t("blockBar.headerFill", { defaultValue: `Header color #${hex}`, hex })}
            style={optPill(false)}
          >
            <View style={[toolStyles.swatch, { backgroundColor: `#${hex}`, borderColor: colors.borderDefault }]} />
          </AnimatedChip>
        ))}
        {iconOpt("ts-zebra", Rows3, t("blockBar.zebra", { defaultValue: "Zebra rows" }), TABLE_FILLS.length, zebra)}
        <AnimatedChip
          key="ts-txt-w"
          enterIndex={TABLE_FILLS.length + 1}
          onPress={() => headerText("FFFFFF")}
          accessibilityLabel={t("blockBar.headerTextWhite", { defaultValue: "White header text" })}
          style={optPill(false)}
        >
          <Text style={[toolStyles.optText, { color: colors.textPrimary }]}>A</Text>
        </AnimatedChip>
        <AnimatedChip
          key="ts-txt-b"
          enterIndex={TABLE_FILLS.length + 2}
          onPress={() => headerText("000000")}
          accessibilityLabel={t("blockBar.headerTextBlack", { defaultValue: "Black header text" })}
          style={optPill(false)}
        >
          <Text style={[toolStyles.optText, { color: colors.textPlaceholder }]}>A</Text>
        </AnimatedChip>
      </>
    );
  }

  if (category === "tblBorders") {
    // style × width × colour combine, and every tap applies the combined config to
    // ALL sides immediately. The trailing "none" removes borders.
    const applyBorders = (style = border.style, sizePt = border.sizePt, color = border.color) =>
      void tableEdit({ action: "layout", opts: { borders: { style, sizePt, color } } });
    return (
      <>
        {BORDER_STYLES.map(({ key, glyph }, i) => (
          <AnimatedChip
            key={`bs-${key}`}
            enterIndex={i}
            onPress={() => { setBorder({ style: key }); applyBorders(key); }}
            active={border.style === key}
            accessibilityLabel={t(`blockBar.borderStyle.${key}`, { defaultValue: `${key} border` })}
            style={optPill(border.style === key)}
          >
            <Text style={[toolStyles.optText, { color: border.style === key ? colors.bgPrimary : colors.textPrimary }]}>{glyph}</Text>
          </AnimatedChip>
        ))}
        {BORDER_WIDTHS.map(({ pt, label }, i) => (
          <AnimatedChip
            key={`bw-${pt}`}
            enterIndex={BORDER_STYLES.length + i}
            onPress={() => { setBorder({ sizePt: pt }); applyBorders(undefined, pt); }}
            active={border.sizePt === pt}
            accessibilityLabel={t("blockBar.borderWidth", { defaultValue: `${label}pt border`, label })}
            style={optPill(border.sizePt === pt)}
          >
            <Text style={[toolStyles.optText, { color: border.sizePt === pt ? colors.bgPrimary : colors.textPrimary }]}>{label}</Text>
          </AnimatedChip>
        ))}
        {BORDER_COLORS.map((hex, i) => (
          <AnimatedChip
            key={`bc-${hex}`}
            enterIndex={BORDER_STYLES.length + BORDER_WIDTHS.length + i}
            onPress={() => { setBorder({ color: hex }); applyBorders(undefined, undefined, hex); }}
            active={border.color === hex}
            accessibilityLabel={t("blockBar.borderColor", { defaultValue: `Border color #${hex}`, hex })}
            style={optPill(false)}
          >
            <View
              style={[
                toolStyles.swatch,
                { backgroundColor: `#${hex}`, borderColor: colors.borderDefault },
                border.color === hex && { borderColor: colors.brandPrimary, borderWidth: 2 },
              ]}
            />
          </AnimatedChip>
        ))}
        {iconOpt(
          "bd-none",
          Square,
          t("blockBar.bordersOff", { defaultValue: "No borders" }),
          BORDER_STYLES.length + BORDER_WIDTHS.length + BORDER_COLORS.length,
          () => void tableEdit({ action: "layout", opts: { borders: false } }),
        )}
      </>
    );
  }

  if (category !== "tblLayout") return null;

  return (
    <>
      {iconOpt("tl-header", PanelTop, t("blockBar.headerRow", { defaultValue: "Header row" }), 0, () => void tableEdit({ action: "layout", opts: { headerRow: true } }), { active: header })}
      {iconOpt("tl-al", AlignLeft, t("blockBar.alignLeft", { defaultValue: "Left" }), 1, () => void tableEdit({ action: "layout", opts: { alignment: "left" } }), { active: align === "left" })}
      {iconOpt("tl-ac", AlignCenter, t("blockBar.alignCenter", { defaultValue: "Center" }), 2, () => void tableEdit({ action: "layout", opts: { alignment: "center" } }), { active: align === "center" })}
      {iconOpt("tl-ar", AlignRight, t("blockBar.alignRight", { defaultValue: "Right" }), 3, () => void tableEdit({ action: "layout", opts: { alignment: "right" } }), { active: align === "right" })}
      {iconOpt("tl-rtl", PilcrowLeft, t("blockBar.dirRtl", { defaultValue: "Right to left" }), 4, () => void tableEdit({ action: "layout", opts: { direction: "rtl" } }), { active: direction === "rtl" })}
      {iconOpt("tl-ltr", PilcrowRight, t("blockBar.dirLtr", { defaultValue: "Left to right" }), 5, () => void tableEdit({ action: "layout", opts: { direction: "ltr" } }), { active: direction === "ltr" })}
      {iconOpt("tl-fit", StretchHorizontal, t("blockBar.fitPageWidth", { defaultValue: "Fit page width" }), 6, () => void tableEdit({ action: "layout", opts: { widthPct: 100 } }))}
    </>
  );
}
