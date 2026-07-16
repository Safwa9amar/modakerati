import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Alert, Keyboard, Text, Pressable } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import GorhomBottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  Paperclip,
  ListTree,
  Download,
  RotateCcw,
  Brain,
  SquarePen,
  Trash2,
  FileStack,
  X,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, regenerateLastResponse } from "@/lib/ai-service";
import { deleteThesisBlocks, startThesisBlocksOnNewPage, type DocBlockDTO } from "@/lib/api";
import { ComposerThinking } from "./ComposerThinking";
import { deriveThinkingMs } from "@/lib/thinking";
import { ComposerInput } from "./ComposerInput";
import { ComposerQuickActions } from "./ComposerQuickActions";
import { useComposerSuggestions } from "@/hooks/useComposerSuggestions";
import { ComposerToolsTray, type ToolItem } from "./ComposerToolsTray";
import { ComposerAsk } from "./ComposerAsk";
import { ComposerModeToggle } from "./ComposerModeToggle";
import { ComposerEditTools } from "./ComposerEditTools";
import { ComposerRibbon } from "./ribbon/ComposerRibbon";

/** Height of the collapsed peek (the doc area pads its bottom by this). */
export const COMPOSER_COLLAPSED_HEIGHT = 210;
/** Expanded snap point as a fraction of the container height. Shared with the
 *  workspace screen so the document's bottom spacing tracks the sheet height. */
export const COMPOSER_EXPANDED_FRACTION = 0.62;

interface Props {
  thesisId: string;
  isLiveDoc: boolean;
  rtl: boolean;
  /** gorhom writes the sheet's live top-edge Y here so the document area can
   *  reserve exactly the height the sheet covers, at any position. */
  animatedPosition?: SharedValue<number>;
  /** Live-.docx block model (empty for legacy docs) — powers the Edit-mode tools. */
  blocks: DocBlockDTO[];
  /** Live-doc only; undefined disables the Export tool. */
  downloadUrl?: string;
  /** Underlying document id (live-doc only); undefined disables Edit block. */
  documentId?: string;
  onOpenSources: () => void;
  onOpenOutline: () => void;
  onExport: () => void;
  /** Called after a bulk block edit (delete / start-on-new-page) rewrites the .docx. */
  onAfterBulkEdit: () => void;
}

export function WorkspaceComposerSheet({
  thesisId,
  isLiveDoc,
  rtl,
  animatedPosition,
  blocks,
  downloadUrl,
  documentId,
  onOpenSources,
  onOpenOutline,
  onExport,
  onAfterBulkEdit,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const sheetRef = useRef<React.ComponentRef<typeof GorhomBottomSheet>>(null);

  // Select primitives / the stored array individually (object/array literals
  // built INSIDE a selector loop the render; `selectedBlocks` is a stored ref).
  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const multiSelect = useWorkspaceStore((s) => s.multiSelect);
  const thinkingEnabled = useWorkspaceStore((s) => s.thinkingEnabled);
  const composerMode = useWorkspaceStore((s) => s.composerMode);
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);

  // Derived selection in document order: indices to act on, and the combined text
  // of the selected blocks (used as the AI focus and the chip preview).
  const ordered = useMemo(
    () => [...selectedBlocks].sort((a, b) => a.index - b.index),
    [selectedBlocks],
  );
  const indices = useMemo(() => ordered.map((b) => b.index), [ordered]);
  const combinedSelection = useMemo(() => {
    const parts = ordered.map((b) => b.text).filter((t) => t && t.trim());
    if (!parts.length) return undefined;
    // Cap before it leaves the device: the server's prompt truncates anyway, so a
    // big multi-selection shouldn't waste bandwidth on every request.
    const joined = parts.join("\n\n");
    return joined.length > 6000 ? joined.slice(0, 6000) + "…" : joined;
  }, [ordered]);
  const count = selectedBlocks.length;

  // Edit mode's formatting tools act on the selected PARAGRAPH blocks (one or many).
  // Resolve them from the doc model in document order, dropping non-paragraph
  // selections (tables/images) so a style tap never targets them. [] → the hint.
  const editSelection = useMemo(() => {
    if (!ordered.length) return [] as Extract<DocBlockDTO, { kind: "paragraph" }>[];
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    return ordered
      .map((s) => byIndex.get(s.index))
      .filter((b): b is Extract<DocBlockDTO, { kind: "paragraph" }> => !!b && b.kind === "paragraph");
  }, [ordered, blocks]);

  // Selection payload for the ribbon dispatcher: index + text + heading level.
  const ribbonSelection = useMemo(
    () =>
      ordered.map((b) => {
        const doc = blocks.find((x) => x.index === b.index);
        const level = doc && doc.kind === "paragraph" ? doc.level ?? 0 : 0;
        return { index: b.index, text: b.text, level };
      }),
    [ordered, blocks],
  );

  const isGenerating = useChatStore((s) => s.isGenerating);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  // Reasoning to surface: the live streaming message once tokens arrive, else the
  // most recent assistant message that produced reasoning (kept reviewable until
  // the next turn). During a new turn's pre-stream gap (generating, but no stream
  // yet) show nothing rather than the PREVIOUS turn's reasoning. Both selectors
  // return primitives so the composer re-renders only when the value changes (no
  // fresh-object selector loop).
  const thinking = useChatStore((s) => {
    const list = s.messages[thesisId];
    if (!list) return "";
    if (s.streamingId) return list.find((m) => m.id === s.streamingId)?.thinking ?? "";
    if (s.isGenerating) return ""; // new turn starting → don't fall back to the last turn
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "assistant" && list[i].thinking) return list[i].thinking ?? "";
    }
    return "";
  });
  const thinkingMs = useChatStore((s) => {
    const list = s.messages[thesisId];
    if (!list) return undefined;
    let msg: (typeof list)[number] | undefined;
    if (s.streamingId) {
      msg = list.find((m) => m.id === s.streamingId);
    } else if (s.isGenerating) {
      return undefined; // pre-stream gap of a new turn
    } else {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === "assistant" && list[i].thinking) {
          msg = list[i];
          break;
        }
      }
    }
    return msg ? deriveThinkingMs(msg) : undefined;
  });

  const [inputText, setInputText] = useState("");

  // AI-generated quick-action chips — only while the AI-mode composer is showing
  // them (open, not in Edit mode, and not while an ask sheet is open). Falls back to
  // the static presets whenever the list is empty (offline / fresh thesis / failure).
  const { suggestions } = useComposerSuggestions(thesisId, {
    enabled: composerOpen && composerMode === "ai" && !pendingAsk,
    selectedBlocks,
  });

  const snapPoints = useMemo(
    () => [COMPOSER_COLLAPSED_HEIGHT, `${COMPOSER_EXPANDED_FRACTION * 100}%`],
    [],
  );

  // AI activity forces the composer visible so its progress/question is seen even
  // if the user had closed the sheet via the header toggle.
  useEffect(() => {
    if (isGenerating || pendingAsk) useWorkspaceStore.getState().setComposerOpen(true);
  }, [isGenerating, pendingAsk]);

  // Single source of truth for the sheet's position: closed when toggled off;
  // otherwise expanded while the AI works / asks, and collapsed to the peek when
  // idle so the updated document is visible again. Driving it off `composerOpen`
  // (not just the generation flags) means a view-mode switch can't strand it.
  useEffect(() => {
    if (!composerOpen) {
      sheetRef.current?.close();
    } else if (isGenerating || pendingAsk) {
      sheetRef.current?.snapToIndex(1);
    } else {
      sheetRef.current?.snapToIndex(0);
    }
  }, [composerOpen, isGenerating, pendingAsk]);

  // A legacy (non-live) doc has no editable blocks — never let it get stuck in
  // Edit mode (the toggle is hidden there, so the user couldn't switch back).
  useEffect(() => {
    if (!isLiveDoc && composerMode === "edit") useWorkspaceStore.getState().setComposerMode("ai");
  }, [isLiveDoc, composerMode]);

  // Focus chip: one tapped block, a multi-selection count, or the whole memoir.
  const hasSelection = count > 0;
  const firstText = selectedBlocks[0]?.text?.replace(/\s+/g, " ").trim() ?? "";
  let chipLabel = t("workspace.wholeMemoir", { defaultValue: "Whole memoir" });
  if (count === 1) {
    chipLabel = `✎ ${firstText ? firstText.slice(0, 40) : t("workspace.selectedBlock", { defaultValue: "Selected section" })}`;
  } else if (count > 1) {
    chipLabel = `✎ ${t("workspace.nSelected", { count, defaultValue: `${count} selected` })}`;
  }

  // The AI focus payload for the current selection: combined text + every index
  // (and a single index for back-compat). Empty when nothing is selected.
  const focusOpts = {
    selection: combinedSelection,
    docBlockIndex: indices.length ? indices[0] : null,
    docBlockIndices: indices.length > 1 ? indices : undefined,
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;
    setInputText("");
    Keyboard.dismiss();
    await sendMessageToAI(thesisId, text, focusOpts);
  };

  const handleAnswer = (answer: string) => {
    useChatStore.getState().setPendingAsk(null);
    void sendMessageToAI(thesisId, answer, focusOpts);
  };

  // AI-bridge target: fill the composer input with the instruction and switch to AI
  // mode + expand, matching the quick-action "fill, don't send" behavior.
  const handleRibbonAiAction = (instruction: string) => {
    useWorkspaceStore.getState().setComposerMode("ai");
    setInputText(instruction);
    useWorkspaceStore.getState().setComposerOpen(true);
    sheetRef.current?.snapToIndex(1);
  };

  // Bulk actions on the multi-selection. Delete is destructive → confirm first.
  // Both rewrite the .docx, so clear the selection and ask the screen to refresh.
  const handleBulkDelete = () => {
    if (!indices.length) return;
    Alert.alert(
      t("workspace.deleteSelectedTitle", { defaultValue: "Delete selected blocks?" }),
      t("workspace.deleteSelectedBody", { count, defaultValue: `Remove ${count} block(s) from the document? This can't be undone.` }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        {
          text: t("common.delete", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteThesisBlocks(thesisId, indices);
              useWorkspaceStore.getState().clearSelection();
              onAfterBulkEdit();
            } catch {
              Alert.alert(t("common.error", { defaultValue: "Error" }), t("workspace.bulkEditError", { defaultValue: "Could not apply the change." }));
            }
          },
        },
      ],
    );
  };

  const handleBulkNewPage = async () => {
    if (!indices.length) return;
    try {
      await startThesisBlocksOnNewPage(thesisId, indices);
      useWorkspaceStore.getState().clearSelection();
      onAfterBulkEdit();
    } catch {
      Alert.alert(t("common.error", { defaultValue: "Error" }), t("workspace.bulkEditError", { defaultValue: "Could not apply the change." }));
    }
  };

  const tools: ToolItem[] = [
    { key: "sources", label: t("composer.tools.sources"), icon: Paperclip, onPress: onOpenSources },
    { key: "outline", label: t("composer.tools.outline"), icon: ListTree, onPress: onOpenOutline },
    { key: "export", label: t("composer.tools.export"), icon: Download, onPress: onExport, disabled: !downloadUrl },
    { key: "regenerate", label: t("composer.tools.regenerate"), icon: RotateCcw, onPress: () => void regenerateLastResponse(thesisId), disabled: isGenerating },
    { key: "thinking", label: t("composer.tools.thinking"), icon: Brain, active: thinkingEnabled, onPress: () => useWorkspaceStore.getState().setThinkingEnabled(!thinkingEnabled) },
    {
      key: "editBlock",
      label: t("composer.tools.editBlock"),
      icon: SquarePen,
      // Single-block editor — only meaningful when exactly one block is selected.
      disabled: !documentId || count !== 1,
      onPress: () => {
        if (documentId && count === 1) {
          router.push({
            pathname: "/(app)/block-editor",
            params: { thesisId, blockIndex: String(selectedBlocks[0].index) },
          });
        }
      },
    },
  ];

  return (
    <GorhomBottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      animatedPosition={animatedPosition}
      enablePanDownToClose={false}
      onChange={(index) => {
        // Guard against gorhom snapping the sheet shut on a layout re-measure
        // (happens when the sibling view swaps on a view-mode change). If it
        // collapsed to closed while we still intend it open, restore the peek.
        // An intentional toggle-close sets composerOpen=false FIRST, so this
        // won't fight it.
        if (index === -1 && useWorkspaceStore.getState().composerOpen) {
          requestAnimationFrame(() => sheetRef.current?.snapToIndex(0));
        }
      }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: colors.bgPrimary }}
      handleIndicatorStyle={{ backgroundColor: colors.textPlaceholder }}
      style={styles.sheetShadow}
    >
      <BottomSheetView style={styles.content}>
        {/* Focus chip */}
        <View style={[styles.chipRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <View style={[styles.chip, { backgroundColor: colors.brandPrimaryLight + "22" }]}>
            <Text style={[styles.chipText, { color: colors.brandPrimary }]} numberOfLines={1}>
              {chipLabel}
            </Text>
            {hasSelection && (
              <Pressable
                onPress={() => useWorkspaceStore.getState().clearSelection()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("common.clear", { defaultValue: "Clear" })}
              >
                <X size={13} color={colors.brandPrimary} strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
        </View>

        {/* AI ⇄ Edit mode toggle — only meaningful on a live .docx. */}
        {isLiveDoc && (
          <ComposerModeToggle
            mode={composerMode}
            onChange={(m) => useWorkspaceStore.getState().setComposerMode(m)}
            aiLabel={t("composer.modeAi", { defaultValue: "AI" })}
            editLabel={t("composer.modeEdit", { defaultValue: "Edit" })}
            rtl={rtl}
          />
        )}

        {/* Bulk actions — only while building a multi-selection on a live .docx. */}
        {isLiveDoc && multiSelect && count > 0 && (
          <View style={[styles.bulkRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
            <Pressable
              onPress={handleBulkNewPage}
              style={[styles.bulkBtn, { borderColor: colors.borderDefault }]}
              accessibilityRole="button"
            >
              <FileStack size={15} color={colors.textPrimary} strokeWidth={2} />
              <Text style={[styles.bulkText, { color: colors.textPrimary }]} numberOfLines={1}>
                {t("workspace.startOnNewPage", { count, defaultValue: "New page" })}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleBulkDelete}
              style={[styles.bulkBtn, { borderColor: colors.semanticError + "55", backgroundColor: colors.semanticError + "12" }]}
              accessibilityRole="button"
            >
              <Trash2 size={15} color={colors.semanticError} strokeWidth={2} />
              <Text style={[styles.bulkText, { color: colors.semanticError }]} numberOfLines={1}>
                {t("workspace.deleteSelected", { count, defaultValue: `Delete ${count}` })}
              </Text>
            </Pressable>
          </View>
        )}

        {pendingAsk ? (
          <ComposerAsk ask={pendingAsk} onAnswer={handleAnswer} rtl={rtl} />
        ) : (
          <>
            {composerMode === "edit" && isLiveDoc ? (
              <ComposerRibbon
                thesisId={thesisId}
                blocks={blocks}
                selection={ribbonSelection}
                onAfterEdit={onAfterBulkEdit}
                onAiAction={handleRibbonAiAction}
                homeSlot={
                  <ComposerEditTools
                    thesisId={thesisId}
                    selection={editSelection}
                    blockCount={blocks.length}
                    hint={t("composer.edit.selectHint", { defaultValue: "Select a paragraph to edit." })}
                    styleLabels={{ normal: t("composer.edit.normal", { defaultValue: "Normal" }) }}
                    onAfterEdit={onAfterBulkEdit}
                    rtl={rtl}
                  />
                }
              />
            ) : (
              <>
                <ComposerThinking
                  isGenerating={isGenerating}
                  reasoning={isGenerating && generatingPhase === "thinking"}
                  thinking={thinking}
                  durationMs={thinkingMs}
                  statusReady={t("composer.status.ready")}
                  rtl={rtl}
                />
                <View style={styles.inputSpacer} />
                <ComposerInput
                  value={inputText}
                  onChangeText={setInputText}
                  onSend={handleSend}
                  onStop={() => useChatStore.getState().stopGenerating()}
                  onMicPress={() => Alert.alert(t("composer.voiceComingSoon"))}
                  onFocus={() => sheetRef.current?.snapToIndex(1)}
                  isGenerating={isGenerating}
                  placeholder={t("workspace.askPlaceholder", { defaultValue: "Ask the AI to write or edit…" })}
                  sendLabel={t("chat.send", { defaultValue: "Send" })}
                  stopLabel={t("chat.stop", { defaultValue: "Stop" })}
                  micLabel={t("composer.micLabel", { defaultValue: "Voice input" })}
                />
                <View style={styles.quickActionsSpacer} />
                <ComposerQuickActions
                  suggestions={suggestions}
                  onPreset={(prompt) => {
                    setInputText(prompt);
                    sheetRef.current?.snapToIndex(1);
                  }}
                />
              </>
            )}
            <ComposerToolsTray label={t("composer.toolsLabel")} tools={tools} />
          </>
        )}
      </BottomSheetView>
    </GorhomBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 8 },
  chipRow: { marginBottom: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "85%",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  chipText: { flexShrink: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  inputSpacer: { height: 8 },
  quickActionsSpacer: { height: 12 },
  bulkRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  bulkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  bulkText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
