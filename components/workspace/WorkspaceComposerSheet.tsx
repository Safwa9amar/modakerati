import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Alert, Keyboard, Text, Pressable } from "react-native";
import GorhomBottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  Paperclip,
  Paintbrush,
  ListTree,
  AlignLeft,
  Download,
  RotateCcw,
  Brain,
  SquarePen,
  X,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, regenerateLastResponse } from "@/lib/ai-service";
import { ComposerThinking } from "./ComposerThinking";
import { ComposerInput } from "./ComposerInput";
import { ComposerQuickActions } from "./ComposerQuickActions";
import { ComposerToolsTray, type ToolItem } from "./ComposerToolsTray";
import { ComposerAsk } from "./ComposerAsk";

/** Height of the collapsed peek (the doc area pads its bottom by this). */
export const COMPOSER_COLLAPSED_HEIGHT = 210;

interface Props {
  thesisId: string;
  isLiveDoc: boolean;
  rtl: boolean;
  /** Live-doc only; undefined disables the Export tool. */
  downloadUrl?: string;
  /** Underlying document id (live-doc only); undefined disables Edit block. */
  documentId?: string;
  onFormat: () => void;
  onOpenSources: () => void;
  onOpenOutline: () => void;
  onExport: () => void;
}

export function WorkspaceComposerSheet({
  thesisId,
  isLiveDoc,
  rtl,
  downloadUrl,
  documentId,
  onFormat,
  onOpenSources,
  onOpenOutline,
  onExport,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const sheetRef = useRef<React.ComponentRef<typeof GorhomBottomSheet>>(null);

  // Select primitives individually (object/array literals loop the render).
  const blockText = useWorkspaceStore((s) => s.selectedBlockText);
  const docBlockIndex = useWorkspaceStore((s) => s.selectedBlockIndex);
  const isFormatting = useWorkspaceStore((s) => s.isFormatting);
  const thinkingEnabled = useWorkspaceStore((s) => s.thinkingEnabled);

  const isGenerating = useChatStore((s) => s.isGenerating);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  // Read just the streaming message's reasoning (a string primitive) so the
  // composer re-renders only when that text changes — not on every token of an
  // unrelated message, and without re-scanning the whole array on each render.
  const thinking = useChatStore((s) => {
    const id = s.streamingId;
    if (!id) return "";
    return s.messages[thesisId]?.find((m) => m.id === id)?.thinking ?? "";
  });

  const [inputText, setInputText] = useState("");

  const snapPoints = useMemo(() => [COMPOSER_COLLAPSED_HEIGHT, "62%"], []);

  // Auto-expand when the AI starts working or asks a question; collapse back to
  // the peek once it finishes so the updated document is visible again.
  useEffect(() => {
    if (isGenerating || pendingAsk) sheetRef.current?.snapToIndex(1);
    else sheetRef.current?.snapToIndex(0);
  }, [isGenerating, pendingAsk]);

  // Focus chip: tapped block, deep-linked block, or the whole memoir.
  const hasSelection = !!blockText || docBlockIndex != null;
  let chipLabel = t("workspace.wholeMemoir", { defaultValue: "Whole memoir" });
  if (blockText) {
    chipLabel = `✎ ${blockText.replace(/\s+/g, " ").trim().slice(0, 40)}`;
  } else if (docBlockIndex != null) {
    chipLabel = `✎ ${t("workspace.selectedBlock", { defaultValue: "Selected section" })}`;
  }

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;
    setInputText("");
    Keyboard.dismiss();
    await sendMessageToAI(thesisId, text, {
      selection: blockText ?? undefined,
      docBlockIndex: docBlockIndex ?? null,
    });
  };

  const handleAnswer = (answer: string) => {
    useChatStore.getState().setPendingAsk(null);
    void sendMessageToAI(thesisId, answer, {
      selection: blockText ?? undefined,
      docBlockIndex: docBlockIndex ?? null,
    });
  };

  const tools: ToolItem[] = [
    { key: "sources", label: t("composer.tools.sources"), icon: Paperclip, onPress: onOpenSources },
    { key: "format", label: t("composer.tools.format"), icon: Paintbrush, onPress: onFormat, disabled: isFormatting },
    { key: "outline", label: t("composer.tools.outline"), icon: ListTree, onPress: onOpenOutline },
    { key: "view", label: t("composer.tools.view"), icon: AlignLeft, onPress: () => useWorkspaceStore.getState().toggleViewMode(), disabled: !isLiveDoc },
    { key: "export", label: t("composer.tools.export"), icon: Download, onPress: onExport, disabled: !downloadUrl },
    { key: "regenerate", label: t("composer.tools.regenerate"), icon: RotateCcw, onPress: () => void regenerateLastResponse(thesisId), disabled: isGenerating },
    { key: "thinking", label: t("composer.tools.thinking"), icon: Brain, active: thinkingEnabled, onPress: () => useWorkspaceStore.getState().setThinkingEnabled(!thinkingEnabled) },
    {
      key: "editBlock",
      label: t("composer.tools.editBlock"),
      icon: SquarePen,
      disabled: !documentId || docBlockIndex == null,
      onPress: () => {
        if (documentId && docBlockIndex != null) {
          router.push({
            pathname: "/(app)/block-editor",
            params: { thesisId, documentId, blockIndex: String(docBlockIndex) },
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
      enablePanDownToClose={false}
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

        {pendingAsk ? (
          <ComposerAsk ask={pendingAsk} onAnswer={handleAnswer} rtl={rtl} />
        ) : (
          <>
            <ComposerThinking
              isGenerating={isGenerating}
              phase={generatingPhase}
              thinking={thinking}
              statusReady={t("composer.status.ready")}
              thinkingLabel={t("composer.status.thinking")}
              writingLabel={t("composer.status.writing")}
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
            <ComposerQuickActions
              onPreset={(prompt) => {
                setInputText(prompt);
                sheetRef.current?.snapToIndex(1);
              }}
            />
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
});
