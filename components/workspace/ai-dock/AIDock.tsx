import React from "react";
import { View, Keyboard } from "react-native";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/stores/chat-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { fillGaps, resolveDockScope } from "@/lib/ai-dock-scopes";
import type { DocBlockDTO } from "@/lib/api";
import { ScopeHeader } from "./ScopeHeader";
import { AskBar } from "./AskBar";
import { ActionRow } from "./ActionRow";
import { useDockSuggestions } from "./useDockSuggestions";
import { sendFromDock } from "./send";
// NOT aliased to `s` here (unlike the other parts): this file's Zustand
// selectors already bind `s`, and shadowing the styles inside them is a trap.
import { dockStyles } from "./styles";

interface Props {
  thesisId: string;
  /** Doc-block indices the chips and the ask target. Empty → whole memoir. */
  scopeIndices: number[];
  /** The sole selected block when scopeIndices.length === 1. */
  selectedBlock?: DocBlockDTO | null;
  /** Combined text of the selected blocks, sent as `selection` to ground the ask. */
  scopeText?: string;
  /** The selected PARAGRAPH blocks (index + text + level), in document order. */
  scopeBlocks?: { index: number; text: string; level: number }[];
  /** True when the bubble is targeting a header/footer band. */
  chrome?: boolean;
  /** All doc blocks — needed to fill the gaps in a gapped selection. */
  blocks: DocBlockDTO[];
}

/**
 * The AI-mode panel inside the floating ✦ bubble. Rendered INSIDE FloatingPill's
 * dark panel — it owns only its rows, not the container, position or drag.
 *
 * Three rows: ScopeHeader (what, and whether you get to review it), AskBar
 * (always live), ActionRow (suggestions then canned actions, one h-scroller).
 *
 * The dock is APP UI, so it lays out by the app language's direction via
 * useRTL() inside each part — NOT by the thesis document's direction.
 */
export function AIDock({
  thesisId,
  scopeIndices,
  selectedBlock,
  scopeText,
  scopeBlocks,
  chrome = false,
  blocks,
}: Props) {
  const { t } = useTranslation();
  const isGenerating = useChatStore((s) => s.isGenerating);
  const inputOpen = useFloatingPillStore((s) => s.inputOpen);
  const lexicalActive = useLexicalEditorStore((s) => s.active);

  const paragraphs = scopeBlocks ?? [];

  // PURE, during render — see resolveDockScope's doc comment. Going through
  // store state would paint one frame of the previous scope on every change.
  const scope = resolveDockScope({
    indices: scopeIndices,
    selectedBlock: selectedBlock ?? null,
    scopeBlocks: paragraphs,
    allBlocks: blocks,
    lexicalActive,
    chrome,
  });

  const { suggestions, loading } = useDockSuggestions(thesisId, scopeIndices);

  const onPrompt = (prompt: string) => {
    if (isGenerating) return;
    sendFromDock({
      thesisId,
      scope,
      prompt,
      indices: scopeIndices,
      selectedBlock: selectedBlock ?? null,
      scopeBlocks: paragraphs,
      scopeText,
    });
  };

  const onSelectGaps = () => {
    const filled = fillGaps(scopeIndices, blocks);
    if (!filled.length) return;
    useWorkspaceStore.getState().setSelection(filled, true);
    // FloatingPill closes the ask input on ANY selection change outside checkbox
    // select-mode. Filling the gaps IS a selection change, so without re-asserting
    // this the dock unmounts at the exact moment the scope upgrades to a reviewable
    // range — the precise opposite of what the chip promises. Reachable whenever the
    // gapped selection was built by long-press rather than the checkboxes.
    useFloatingPillStore.getState().setInputOpen(true);
  };

  const collapse = () => {
    const pill = useFloatingPillStore.getState();
    pill.setInputOpen(false);
    pill.setExpanded(false);
    Keyboard.dismiss();
  };

  return (
    <View style={dockStyles.container}>
      <ScopeHeader
        scope={scope}
        count={scopeIndices.length}
        onClear={() => useWorkspaceStore.getState().clearSelection()}
        onCollapse={collapse}
      />
      <AskBar
        placeholder={t(scope.placeholderKey, {
          defaultValue: scope.placeholderFallback,
          count: scopeIndices.length,
        })}
        autoFocus={inputOpen}
        disabled={isGenerating}
        onSend={onPrompt}
      />
      <ActionRow
        actions={scope.actions}
        suggestions={suggestions}
        loading={loading}
        disabled={isGenerating}
        showSelectGaps={scope.canSelectGaps}
        onSelectGaps={onSelectGaps}
        onPrompt={onPrompt}
      />
    </View>
  );
}
