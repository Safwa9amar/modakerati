import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet, Alert, Keyboard, Platform } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { FileText, SquarePen } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, approvePendingAction, declinePendingAction } from "@/lib/ai-service";
import { type DocBlockDTO } from "@/lib/api";
import { deriveThinkingMs } from "@/lib/thinking";
import { useComposerSuggestions } from "@/hooks/useComposerSuggestions";
import { ComposerAsk } from "./ComposerAsk";
import { ComposerConfirm } from "./ComposerConfirm";
import { IdleAIBar } from "./IdleAIBar";
import { BlockContextBar } from "./BlockContextBar";

/** Initial reserved bottom inset (before the bar measures itself). */
export const BLOCK_COMPOSER_MIN_INSET = 150;

interface Props {
  thesisId: string;
  rtl: boolean;
  /** The doc area reserves this many px at the bottom so content clears the
   *  composer at any state (idle bar / pill / docked bar). Written on every layout. */
  insetValue: SharedValue<number>;
  /** Live-.docx block model — powers the block formatting tools. */
  blocks: DocBlockDTO[];
}

/**
 * The context-aware action zone that replaces the old always-present composer
 * sheet. Its shape follows selection + keyboard state:
 *   • pending confirm / ask → the AI's gate surface (docked).
 *   • nothing selected → the whole-memoir AI input (IdleAIBar, docked).
 *   • a block selected → the block-anchored BlockContextBar (floating pill when the
 *     keyboard is down, full-width docked bar when it's up); tapping ✦ Ask AI swaps
 *     in a block-scoped IdleAIBar.
 * Positioned absolutely at the container bottom; the parent's KeyboardAvoidingView
 * lifts it above the keyboard, so its own detent/docking math isn't needed.
 */
export function BlockComposer({ thesisId, rtl, insetValue, blocks }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  // Selection + edit state (primitives / stored refs only — never object literals).
  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const inlineEditing = useWorkspaceStore((s) => s.inlineEditing);
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);
  const composerInputFocused = useWorkspaceStore((s) => s.composerInputFocused);
  // The block-scoped "✦ Ask AI" input lives in the store now (the inline block pill
  // can open it, and it must survive across the pill/bar swaps).
  const askAiOpen = useWorkspaceStore((s) => s.askAiOpen);

  const isGenerating = useChatStore((s) => s.isGenerating);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);

  // Reasoning to surface: the live streaming turn's, else the last turn's (for
  // review). Both selectors return primitives → no fresh-object selector loop.
  const thinking = useChatStore((s) => {
    const list = s.messages[thesisId];
    if (!list) return "";
    if (s.streamingId) return list.find((m) => m.id === s.streamingId)?.thinking ?? "";
    if (s.isGenerating) return "";
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
      return undefined;
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
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ——— Selection derivations ———
  const ordered = useMemo(() => [...selectedBlocks].sort((a, b) => a.index - b.index), [selectedBlocks]);
  const indices = useMemo(() => ordered.map((b) => b.index), [ordered]);
  const count = selectedBlocks.length;
  const combinedSelection = useMemo(() => {
    const parts = ordered.map((b) => b.text).filter((x) => x && x.trim());
    if (!parts.length) return undefined;
    const joined = parts.join("\n\n");
    return joined.length > 6000 ? joined.slice(0, 6000) + "…" : joined;
  }, [ordered]);

  // The selected PARAGRAPH blocks (format tools act on these), in doc order.
  const paragraphSelection = useMemo(() => {
    if (!ordered.length) return [] as Extract<DocBlockDTO, { kind: "paragraph" }>[];
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    return ordered
      .map((s) => byIndex.get(s.index))
      .filter((b): b is Extract<DocBlockDTO, { kind: "paragraph" }> => !!b && b.kind === "paragraph");
  }, [ordered, blocks]);

  // ——— Keyboard tracking ———
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // AI activity forces the composer visible so its progress/question is seen even
  // if the user had hidden it via the header ⋯ menu.
  useEffect(() => {
    if (isGenerating || pendingAsk || pendingConfirm) useWorkspaceStore.getState().setComposerOpen(true);
  }, [isGenerating, pendingAsk, pendingConfirm]);

  // Deselecting drops the Ask-AI panel back to nothing (idle bar takes over).
  useEffect(() => {
    if (count === 0 && askAiOpen) useWorkspaceStore.getState().setAskAiOpen(false);
  }, [count, askAiOpen]);

  // Hidden via the header toggle → collapse the reserved inset so the doc reclaims
  // the full height (no bar is rendered to drive onLayout).
  useEffect(() => {
    if (!composerOpen) insetValue.value = 0;
  }, [composerOpen, insetValue]);

  // AI quick-action chips — grounded in the conversation + current selection.
  const { suggestions } = useComposerSuggestions(thesisId, {
    enabled: !pendingAsk && !pendingConfirm,
    selectedBlocks,
  });

  // Focus payload: combined text + every selected index (empty → whole memoir).
  const focusOpts = {
    selection: combinedSelection,
    docBlockIndex: indices.length ? indices[0] : null,
    docBlockIndices: indices.length > 1 ? indices : undefined,
  };

  const markInputFocused = useCallback(() => useWorkspaceStore.getState().setComposerInputFocused(true), []);
  const markInputBlurred = useCallback(() => {
    useWorkspaceStore.getState().setComposerInputFocused(false);
  }, []);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;
    setInputText("");
    Keyboard.dismiss();
    useWorkspaceStore.getState().setAskAiOpen(false);
    await sendMessageToAI(thesisId, text, focusOpts);
  };

  const handleAnswer = (answer: string) => {
    useChatStore.getState().setPendingAsk(null);
    void sendMessageToAI(thesisId, answer, focusOpts);
  };

  const handleApprove = () => {
    if (pendingConfirm) void approvePendingAction(thesisId, pendingConfirm.actionId);
  };
  const handleDecline = () => {
    if (pendingConfirm) void declinePendingAction(thesisId, pendingConfirm.actionId);
  };

  if (!composerOpen) return null;

  // Measure whatever surface renders → reserve exactly its height at the doc bottom.
  const onLayout = (h: number) => {
    insetValue.value = h;
  };

  const blockScopeLabel =
    count === 1
      ? (selectedBlocks[0]?.text?.replace(/\s+/g, " ").trim().slice(0, 32) || t("workspace.selectedBlock", { defaultValue: "Selected section" }))
      : t("workspace.nSelected", { count, defaultValue: `${count} selected` });

  // Which surface: confirm > ask > (block Ask-AI | keyboard-open block bar | idle).
  // Default null: a block selected with the keyboard DOWN docks nothing here — its
  // formatting pill floats inline on the block in the outline instead.
  const blockKeyboardOpen = keyboardVisible && (inlineEditing || composerInputFocused);

  let surface: React.ReactNode = null;
  if (pendingConfirm) {
    surface = (
      <Dock colors={colors} insets={insets} keyboardVisible={keyboardVisible}>
        <ComposerConfirm confirm={pendingConfirm} onApprove={handleApprove} onCancel={handleDecline} rtl={rtl} />
      </Dock>
    );
  } else if (pendingAsk) {
    surface = (
      <Dock colors={colors} insets={insets} keyboardVisible={keyboardVisible}>
        <ComposerAsk ask={pendingAsk} onAnswer={handleAnswer} rtl={rtl} onInputFocus={markInputFocused} onInputBlur={markInputBlurred} />
      </Dock>
    );
  } else if (count === 0) {
    surface = (
      <IdleAIBar
        rtl={rtl}
        scopeLabel={t("workspace.wholeMemoir", { defaultValue: "Whole memoir" })}
        scopeIcon={FileText}
        inputText={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        onStop={() => useChatStore.getState().stopGenerating()}
        onMicPress={() => Alert.alert(t("composer.voiceComingSoon", { defaultValue: "Voice input is coming soon." }))}
        onFocus={markInputFocused}
        onBlur={markInputBlurred}
        isGenerating={isGenerating}
        placeholder={t("workspace.askPlaceholder", { defaultValue: "Ask the AI to write or edit…" })}
        sendLabel={t("chat.send", { defaultValue: "Send" })}
        stopLabel={t("chat.stop", { defaultValue: "Stop" })}
        micLabel={t("composer.micLabel", { defaultValue: "Voice input" })}
        generatingPhase={generatingPhase}
        thinking={thinking}
        thinkingMs={thinkingMs}
        statusReady={t("composer.status.ready", { defaultValue: "Ready — ask me to write or edit." })}
        suggestions={suggestions}
        onPreset={(prompt) => setInputText(prompt)}
        keyboardVisible={keyboardVisible}
        bottomInset={insets.bottom}
      />
    );
  } else if (askAiOpen) {
    surface = (
      <IdleAIBar
        rtl={rtl}
        scopeLabel={blockScopeLabel}
        scopeIcon={SquarePen}
        onScopeClose={() => useWorkspaceStore.getState().setAskAiOpen(false)}
        inputText={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        onStop={() => useChatStore.getState().stopGenerating()}
        onMicPress={() => Alert.alert(t("composer.voiceComingSoon", { defaultValue: "Voice input is coming soon." }))}
        onFocus={markInputFocused}
        onBlur={markInputBlurred}
        isGenerating={isGenerating}
        placeholder={t("workspace.askPlaceholder", { defaultValue: "Ask the AI to write or edit…" })}
        sendLabel={t("chat.send", { defaultValue: "Send" })}
        stopLabel={t("chat.stop", { defaultValue: "Stop" })}
        micLabel={t("composer.micLabel", { defaultValue: "Voice input" })}
        generatingPhase={generatingPhase}
        thinking={thinking}
        thinkingMs={thinkingMs}
        statusReady={t("composer.status.ready", { defaultValue: "Ready — ask me to write or edit." })}
        suggestions={suggestions}
        onPreset={(prompt) => setInputText(prompt)}
        keyboardVisible={keyboardVisible}
        bottomInset={insets.bottom}
      />
    );
  } else if (blockKeyboardOpen) {
    // Keyboard UP with a block selected → the full-width formatting bar docked above
    // the keyboard (the pill can't float on a block that's scrolled behind the
    // keyboard). Keyboard DOWN → nothing docks here: the pill now floats inline on
    // the selected block in the outline (see OutlineReorderable's Row), so `surface`
    // stays null and the reserved bottom inset collapses (the doc reclaims height).
    surface = (
      <BlockContextBar
        thesisId={thesisId}
        rtl={rtl}
        paragraphSelection={paragraphSelection}
        selectedIndices={indices}
        count={count}
        blockCount={blocks.length}
        keyboardOpen
        scopeLabel={blockScopeLabel}
        onAskAI={() => useWorkspaceStore.getState().setAskAiOpen(true)}
        bottomInset={insets.bottom}
      />
    );
  }

  // Legacy / unseeded docs have no blocks → only the whole-memoir AI input ever
  // shows (there's nothing to select), so no live-doc guard is needed here.
  return (
    <View
      style={styles.host}
      pointerEvents="box-none"
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
    >
      {surface}
    </View>
  );
}

// A bottom-docked surface wrapper for the AI gate (ask / confirm).
function Dock({
  children,
  colors,
  insets,
  keyboardVisible,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useThemeColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  keyboardVisible: boolean;
}) {
  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: colors.bgPrimary,
          borderTopColor: colors.borderSubtle,
          paddingBottom: keyboardVisible ? 10 : insets.bottom + 12,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, bottom: 0 },
  dock: {
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 10,
  },
});
