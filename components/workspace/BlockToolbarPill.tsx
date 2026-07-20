import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { DocBlockDTO } from "@/lib/api";
import { BlockContextBar } from "./BlockContextBar";

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;

interface Props {
  thesisId: string;
  /** Live-.docx block model — powers the block formatting tools. */
  blocks: DocBlockDTO[];
  rtl: boolean;
}

/**
 * The floating block-formatting pill, anchored INLINE directly under the selected
 * block in the outline (so it scrolls with the block). Self-contained: the outline
 * Row only passes the doc context ({ thesisId, blocks, rtl }); this reads the current
 * selection from the workspace store and derives everything BlockContextBar needs.
 *
 * It renders BlockContextBar in its keyboard-closed (compact pill) form — reusing
 * that component's tool JSX + optimistic format/move/insertImage/delete handlers and
 * its (+) / category expansions unchanged. "✦ Ask AI" flips the store's askAiOpen
 * flag, which swaps in the block-scoped AI input that still lives in BlockComposer at
 * the screen bottom (and hides this pill via the Row's gate).
 */
export function BlockToolbarPill({ thesisId, blocks, rtl }: Props) {
  const { t } = useTranslation();
  // Stable-ref selector only (the stored array reference; never a fresh
  // object/array literal → would trip zustand's Object.is and loop).
  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);

  // ——— Selection derivations (mirror BlockComposer) ———
  const ordered = useMemo(
    () => [...selectedBlocks].sort((a, b) => a.index - b.index),
    [selectedBlocks],
  );
  const indices = useMemo(() => ordered.map((b) => b.index), [ordered]);
  const count = selectedBlocks.length;

  // The selected PARAGRAPH blocks (format tools act on these), in doc order.
  const paragraphSelection = useMemo(() => {
    if (!ordered.length) return [] as ParagraphBlock[];
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    return ordered
      .map((s) => byIndex.get(s.index))
      .filter((b): b is ParagraphBlock => !!b && b.kind === "paragraph");
  }, [ordered, blocks]);

  const scopeLabel =
    count === 1
      ? (selectedBlocks[0]?.text?.replace(/\s+/g, " ").trim().slice(0, 32) ||
        t("workspace.selectedBlock", { defaultValue: "Selected section" }))
      : t("workspace.nSelected", { count, defaultValue: `${count} selected` });

  return (
    <View style={styles.host} pointerEvents="box-none">
      <BlockContextBar
        thesisId={thesisId}
        rtl={rtl}
        paragraphSelection={paragraphSelection}
        selectedIndices={indices}
        count={count}
        blockCount={blocks.length}
        // Anchored inline on the block → always the compact floating pill form.
        keyboardOpen={false}
        scopeLabel={scopeLabel}
        onAskAI={() => useWorkspaceStore.getState().setAskAiOpen(true)}
        // Inline (not screen-bottom) → no safe-area bottom inset to reserve.
        bottomInset={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits just under the block content; the pill inside is centered by BlockContextBar.
  host: { marginTop: 4, marginBottom: 2 },
});
