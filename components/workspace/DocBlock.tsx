import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import type { DocBlockDTO } from "@/lib/api";

// Dark ink / muted ink for text rendered on the always-white PaperPage.
const INK = "#1A1A1A";
const MUTED = "#8A8A8A";
const BORDER = "#D8D8DE";

// Heading level → text style. Level 0 is justified body; 1 is the largest.
const HEADING_SIZE: Record<1 | 2 | 3 | 4, number> = { 1: 22, 2: 19, 3: 16, 4: 14 };

/**
 * Renders one live-.docx block (read-only). Paragraphs/tables are tappable and
 * select themselves by their engine block `index` (so L2 chat can target them);
 * images render as a light figure placeholder and `other` blocks render nothing.
 *
 * `rtl` reflects the thesis language (Arabic) so text aligns to the right.
 */
export function DocBlock({ block, rtl }: { block: DocBlockDTO; rtl: boolean }) {
  const colors = useThemeColors();
  const selectedIndex = useThesisStore((s) => s.selected.docBlockIndex);
  const hi = colors.brandPrimary;
  const isSelected = selectedIndex === block.index;
  const align = rtl ? "right" : "left";
  const writingDirection = rtl ? "rtl" : "ltr";

  if (block.kind === "other") {
    // Structural/unsupported block — render nothing (a tiny marker is noise).
    return null;
  }

  if (block.kind === "image") {
    return (
      <View style={[styles.figureCard, { borderColor: BORDER }]}>
        <Text style={styles.figureText}>🖼 figure</Text>
      </View>
    );
  }

  if (block.kind === "table") {
    return (
      <Pressable
        onPress={() =>
          useThesisStore.getState().selectDocBlock(block.index, tableToText(block.rows))
        }
        style={[
          styles.tableWrap,
          { borderColor: isSelected ? hi : BORDER },
          isSelected && { backgroundColor: hi + "18" },
        ]}
      >
        {block.rows.map((row, r) => (
          <View
            key={r}
            style={[
              styles.tableRow,
              { borderBottomColor: BORDER },
              r === block.rows.length - 1 && styles.tableRowLast,
            ]}
          >
            {row.map((cell, c) => (
              <View
                key={c}
                style={[
                  styles.tableCell,
                  { borderRightColor: BORDER },
                  c === row.length - 1 && styles.tableCellLast,
                ]}
              >
                <Text
                  style={[styles.tableCellText, { textAlign: align, writingDirection }]}
                >
                  {cell}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </Pressable>
    );
  }

  // paragraph
  const isHeading = block.level >= 1;
  const empty = !block.text.trim();
  return (
    <Pressable
      onPress={() =>
        useThesisStore.getState().selectDocBlock(block.index, block.text)
      }
      style={[
        styles.paraWrap,
        isSelected && { backgroundColor: hi + "18", borderColor: hi },
      ]}
    >
      <Text
        style={[
          isHeading
            ? { ...styles.heading, fontSize: HEADING_SIZE[block.level as 1 | 2 | 3 | 4] }
            : styles.body,
          {
            textAlign: isHeading ? align : "justify",
            writingDirection,
          },
          empty && styles.emptyPara,
        ]}
      >
        {empty ? "·" : block.text}
      </Text>
    </Pressable>
  );
}

// Flatten a table grid to a single string for the selection chip / L2 targeting.
function tableToText(rows: string[][]): string {
  return rows.map((r) => r.join(" | ")).join("\n");
}

const styles = StyleSheet.create({
  paraWrap: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginVertical: 2,
  },
  heading: {
    color: INK,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  body: {
    color: INK,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  emptyPara: { color: MUTED },

  figureCard: {
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingVertical: 22,
    marginVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAFC",
  },
  figureText: { color: MUTED, fontSize: 14, fontFamily: "Inter_500Medium" },

  tableWrap: {
    borderWidth: 1,
    borderRadius: 6,
    marginVertical: 8,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tableRowLast: { borderBottomWidth: 0 },
  tableCell: {
    flex: 1,
    minWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableCellLast: { borderRightWidth: 0 },
  tableCellText: { color: INK, fontSize: 12, fontFamily: "Inter_400Regular" },
});
