import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Send, Square, X } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI } from "@/lib/ai-service";
import type { ChatMessage } from "@/types/chat";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Stable reference so the zustand selector below doesn't return a fresh array
// every render (which would loop "Maximum update depth exceeded").
const EMPTY_MESSAGES: ChatMessage[] = [];

// Max characters of the live streaming text shown in the strip above the input.
const STREAM_PREVIEW = 120;

/**
 * The AI composer pinned to the bottom of the thesis workspace. Sends prompts
 * targeted at the currently-focused chapter/section (or the whole memoir when
 * nothing is selected), shows a live streaming strip while the AI writes, and
 * refreshes the thesis pages once a turn completes.
 */
export function WorkspaceComposer({
  thesisId,
  // Live-.docx theses refresh their rendered pages by polling the document model
  // in thesis-workspace.tsx (refreshDoc). To avoid double-fetching, skip the
  // legacy `refreshThesis` polling here when the thesis is live-.docx.
  isLiveDoc = false,
}: {
  thesisId: string;
  isLiveDoc?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  // Select primitives individually. Returning an object literal here would hand
  // useSyncExternalStore a fresh reference every render → "Maximum update depth
  // exceeded" (same trap EMPTY_MESSAGES guards against above).
  const blockText = useWorkspaceStore((s) => s.selectedBlockText);
  const docBlockIndex = useWorkspaceStore((s) => s.selectedBlockIndex);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const streamingId = useChatStore((s) => s.streamingId);
  const messages = useChatStore((s) => s.messages[thesisId] ?? EMPTY_MESSAGES);

  const [inputText, setInputText] = useState("");

  // Focus chip: the tapped .docx block (the AI targets it by block index), or the
  // whole memoir when nothing is selected. A selection can carry text (tap in the
  // doc) or just a block index (deep-link from the outline) — both count.
  let chipLabel = t("workspace.wholeMemoir", { defaultValue: "Whole memoir" });
  const hasSelection = !!blockText || docBlockIndex != null;
  if (blockText) {
    const excerpt = blockText.replace(/\s+/g, " ").trim().slice(0, 40);
    chipLabel = `✎ ${excerpt}`;
  } else if (docBlockIndex != null) {
    chipLabel = `✎ ${t("workspace.selectedBlock", { defaultValue: "Selected section" })}`;
  }

  // Legacy live refresh: when a turn finishes (isGenerating true → false), pull
  // the freshest thesis so the AI's chapter/section edits appear on the pages
  // above. Live-.docx theses refresh via refreshDoc in the workspace instead.
  const prevGenerating = useRef(isGenerating);
  useEffect(() => {
    if (prevGenerating.current && !isGenerating && !isLiveDoc) {
      useThesisStore.getState().refreshThesis(thesisId);
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating, thesisId, isLiveDoc]);

  // Legacy: stream the edits onto the pages — while the AI is generating it
  // commits each chapter edit to the server mid-turn (via its tools), so poll
  // the thesis so those changes appear live instead of only at the end.
  // Live-.docx theses are polled by refreshDoc in the workspace (no double-fetch).
  useEffect(() => {
    if (!isGenerating || isLiveDoc) return;
    const id = setInterval(() => {
      useThesisStore.getState().refreshThesis(thesisId);
    }, 1800);
    return () => clearInterval(id);
  }, [isGenerating, thesisId, isLiveDoc]);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || isGenerating) return;
    setInputText("");
    Keyboard.dismiss();
    await sendMessageToAI(thesisId, text, {
      selection: blockText ?? undefined,
      // Live-.docx (L2): the engine block index the student selected, so the AI
      // edits that exact paragraph. `null` when nothing block-specific is focused.
      docBlockIndex: docBlockIndex ?? null,
    });
  }

  // Live streaming text (truncated) shown in the strip while the AI writes.
  const streamingMsg = streamingId ? messages.find((m) => m.id === streamingId) : undefined;
  const streamingText = streamingMsg?.content?.slice(0, STREAM_PREVIEW) ?? "";

  const hasText = inputText.trim().length > 0;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bgPrimary, borderTopColor: colors.borderDefault },
      ]}
    >
      {/* Streaming strip — only while the AI is generating */}
      {isGenerating && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(120)}
          style={styles.streamStrip}
        >
          <ActivityIndicator size="small" color={colors.brandPrimary} />
          <Text
            style={[styles.streamText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {streamingText}
          </Text>
          <Pressable
            onPress={() => useChatStore.getState().stopGenerating()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("chat.stop", { defaultValue: "Stop" })}
            style={[styles.stopBtn, { backgroundColor: colors.semanticError }]}
          >
            <Square size={12} color="#FFFFFF" fill="#FFFFFF" />
          </Pressable>
        </Animated.View>
      )}

      {/* Focus chip */}
      <View style={styles.chipRow}>
        <View style={[styles.chip, { backgroundColor: colors.brandPrimaryLight + "22" }]}>
          <Text
            style={[styles.chipText, { color: colors.brandPrimary }]}
            numberOfLines={1}
          >
            {chipLabel}
          </Text>
          {hasSelection && (
            <Pressable
              onPress={() => useWorkspaceStore.getState().clearSelection()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("common.clear", { defaultValue: "Clear" })}
              style={styles.chipClear}
            >
              <X size={13} color={colors.brandPrimary} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Input row */}
      <View style={styles.inputRow}>
        <View style={[styles.inputWrapper, { backgroundColor: colors.bgSurface }]}>
          <TextInput
            style={[styles.input, { color: colors.textPrimary }]}
            placeholder={t("workspace.askPlaceholder", {
              defaultValue: "Ask the AI to write or edit…",
            })}
            placeholderTextColor={colors.textPlaceholder}
            value={inputText}
            onChangeText={setInputText}
            editable={!isGenerating}
            multiline
            maxLength={2000}
          />
          {hasText && !isGenerating ? (
            <AnimatedPressable
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(100)}
              onPress={handleSend}
              accessibilityRole="button"
              accessibilityLabel={t("chat.send", { defaultValue: "Send" })}
              style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }]}
            >
              <Send size={16} color="#FFFFFF" strokeWidth={2} />
            </AnimatedPressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  streamStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  streamText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  stopBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  chipRow: { flexDirection: "row", marginBottom: 8, paddingHorizontal: 2 },
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
  chipClear: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
  inputRow: { flexDirection: "row", alignItems: "flex-end" },
  inputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", maxHeight: 100, paddingVertical: 4 },
  sendBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginLeft: 6 },
});
