import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Keyboard } from "react-native";
import { TextInput } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { ChevronsDownUp, FileText, LayoutPanelTop, Languages, MessageCircle, PenLine, Send, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useChatStore } from "@/stores/chat-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { sendMessageToAI } from "@/lib/ai-service";
import { getComposerSuggestions, type ComposerSuggestion, type DocBlockDTO } from "@/lib/api";
import { AnimatedChip } from "./AnimatedChip";

interface Props {
  thesisId: string;
  /** Scope pill text shown beside the on-demand Ask input (whole memoir / selected block). */
  scopeLabel: string;
  /** Doc-block indices the fixed/suggested chips and the Ask input target. Empty → whole memoir. */
  scopeIndices: number[];
  /** The sole selected block when scopeIndices.length === 1 — lets a single-block ask
   *  route through the inline-suggestion path (mirrors BlockComposer's legacy
   *  askAiOpen branch) instead of the plain chat/tool-loop send. Null/undefined for
   *  the whole-memoir or multi-block scope, where the plain send is always used. */
  selectedBlock?: DocBlockDTO | null;
}

interface QuickAction {
  key: string;
  Icon: LucideIcon;
  label: string;
  prompt: string;
}

/** One pulsing placeholder bar for the Suggested section while chips load. */
function ShimmerBar({ color }: { color: string }) {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => {
      pulse.value = 0.35;
    };
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[styles.shimmerBar, { backgroundColor: color }, style]} />;
}

/**
 * The AI-mode expanded panel for the always-on floating bubble (count===0, or a
 * block scope opened via the pill's ✦). Rendered INSIDE the parent FloatingPill's
 * dark panel — owns only its rows, not the outer container/position.
 *
 * Three stacked pieces:
 *   1. Fixed quick-action chips (Summarize/Improve/Format/Translate) — fire a canned
 *      prompt immediately and collapse the dock.
 *   2. Suggested chips — AI-generated, grounded in scopeIndices; shimmer while
 *      loading, hidden entirely on empty/error.
 *   3. An on-demand "Ask…" chip that swaps for an inline input row (scope tag +
 *      text + send) once tapped — the store's `inputOpen` drives which form shows,
 *      so the pill's own ✦ can also open it in block mode.
 */
export function AIDock({ thesisId, scopeLabel, scopeIndices, selectedBlock }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  // The dock is APP UI (labels are in the UI locale), so its layout follows the
  // app language's direction — NOT the thesis document's (user feedback).
  const { flexDirection, textAlign } = useRTL();
  const isGenerating = useChatStore((s) => s.isGenerating);
  const inputOpen = useFloatingPillStore((s) => s.inputOpen);
  // The "AI Suggestions" setting gates the Suggested section entirely: off → no
  // fetch and no chips. Subscribed (not read once) so toggling it in Settings
  // clears/restores the dock's chips live, mirroring useComposerSuggestions.
  const aiSuggestionsEnabled = useNotificationStore((s) => s.preferences.aiSuggestions);

  const [suggestions, setSuggestions] = useState<ComposerSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [askText, setAskText] = useState("");

  const scopeKey = scopeIndices.join(",");

  // Fetch on mount + whenever the scope identity or the preference changes; abort
  // a superseded fetch (context moved on) and on unmount. Empty/failure → []
  // (hides the section). `cancelled` guards the async callbacks too, so a response
  // that resolves after the scope/preference already moved on can't overwrite
  // fresher chips (mirrors useComposerSuggestions' pattern).
  useEffect(() => {
    // Off by user preference → clear any stale chips and never fetch.
    if (!aiSuggestionsEnabled) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoadingSuggestions(true);
    getComposerSuggestions(
      thesisId,
      {
        docBlockIndex: scopeIndices.length ? scopeIndices[0] : null,
        docBlockIndices: scopeIndices.length > 1 ? scopeIndices : undefined,
      },
      controller.signal,
    )
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSuggestions(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // scopeKey is the primitive identity of scopeIndices — see selectionKey in
    // useComposerSuggestions for the same pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thesisId, scopeKey, aiSuggestionsEnabled]);

  const quickActions: QuickAction[] = [
    {
      key: "summarize",
      Icon: FileText,
      label: t("aiDock.summarize", { defaultValue: "Summarize" }),
      prompt: "Summarize the current state of this thesis and its chapters.",
    },
    {
      key: "improve",
      Icon: PenLine,
      label: t("aiDock.improve", { defaultValue: "Improve writing" }),
      prompt: "Review the writing quality and improve weak passages.",
    },
    {
      key: "format",
      Icon: LayoutPanelTop,
      label: t("aiDock.format", { defaultValue: "Fix formatting" }),
      prompt: "Check and fix formatting, numbering and layout issues in the document.",
    },
    {
      key: "translate",
      Icon: Languages,
      label: t("aiDock.translate", { defaultValue: "Translate" }),
      prompt: "Help me translate parts of this thesis.",
    },
  ];

  // Shared send path: block-scoped when scopeIndices is non-empty, whole-memoir
  // otherwise (mirrors BlockComposer's focusOpts). Collapses the dock — the
  // bubble's own spinner (FloatingPill) takes over from here.
  //
  // A single selected PARAGRAPH or IMAGE is special-cased: it mirrors
  // BlockComposer's legacy askAiOpen branch and routes through the suggestion
  // store's `request` instead of the plain chat/tool-loop send, so the ask
  // produces an in-place proposal on the block (peek/diff/approve/reject via
  // InlineSuggestion) rather than a direct edit. Whole-memoir (empty scope) and
  // multi-block asks are unaffected — they keep the plain send.
  const sendPrompt = (prompt: string) => {
    if (isGenerating) return;
    if (scopeIndices.length === 1 && selectedBlock?.kind === "paragraph") {
      void useSuggestionStore.getState().request(thesisId, selectedBlock.index, selectedBlock.text, prompt);
      useFloatingPillStore.getState().setExpanded(false);
      return;
    }
    if (scopeIndices.length === 1 && selectedBlock?.kind === "image") {
      void useSuggestionStore
        .getState()
        .request(thesisId, selectedBlock.index, selectedBlock.caption ?? "", prompt, "image");
      useFloatingPillStore.getState().setExpanded(false);
      return;
    }
    void sendMessageToAI(thesisId, prompt, {
      docBlockIndex: scopeIndices.length ? scopeIndices[0] : null,
      docBlockIndices: scopeIndices.length > 1 ? scopeIndices : undefined,
    });
    useFloatingPillStore.getState().setExpanded(false);
  };

  const handleAskSend = () => {
    const trimmed = askText.trim();
    if (!trimmed || isGenerating) return;
    sendPrompt(trimmed);
    setAskText("");
    useFloatingPillStore.getState().setInputOpen(false);
    Keyboard.dismiss();
  };

  const showSuggested = aiSuggestionsEnabled && (loadingSuggestions || suggestions.length > 0);
  const askDisabled = !askText.trim() || isGenerating;

  return (
    <View style={styles.container}>
      {/* 1. Fixed quick-action chips — always present, wrap onto a 2nd line if needed.
             Leading collapse chevron mirrors the formatting pill's: back to the bubble. */}
      <View style={[styles.chipsRow, { flexDirection }]}>
        <AnimatedChip
          onPress={() => {
            useFloatingPillStore.getState().setInputOpen(false);
            useFloatingPillStore.getState().setExpanded(false);
          }}
          accessibilityLabel={t("blockBar.collapse", { defaultValue: "Collapse" })}
          enterIndex={0}
          style={[styles.collapseChip, { borderColor: colors.borderDefault, backgroundColor: colors.bgCard }]}
        >
          <ChevronsDownUp size={15} color={colors.textPrimary} strokeWidth={2} />
        </AnimatedChip>
        {quickActions.map(({ key, Icon, label, prompt }, i) => (
          <AnimatedChip
            key={key}
            onPress={() => sendPrompt(prompt)}
            disabled={isGenerating}
            accessibilityLabel={label}
            enterIndex={i + 1}
            style={[
              styles.actionChip,
              { flexDirection, borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
              isGenerating && styles.dim,
            ]}
          >
            <Icon size={15} color={colors.textPrimary} strokeWidth={2} />
            <Text numberOfLines={1} style={[styles.actionChipText, { color: colors.textPrimary }]}>
              {label}
            </Text>
          </AnimatedChip>
        ))}
      </View>

      {/* 2. Suggested — AI-generated chips grounded in the current scope. */}
      {showSuggested ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textPlaceholder }]}>
            {t("aiDock.suggested", { defaultValue: "Suggested" })}
          </Text>
          {loadingSuggestions ? (
            <View style={[styles.chipsRow, { flexDirection }]}>
              <ShimmerBar color={colors.bgCard} />
              <ShimmerBar color={colors.bgCard} />
            </View>
          ) : (
            <View style={[styles.chipsRow, { flexDirection }]}>
              {suggestions.map((s, i) => (
                <AnimatedChip
                  key={`sugg-${i}`}
                  onPress={() => sendPrompt(s.prompt)}
                  disabled={isGenerating}
                  accessibilityLabel={s.label}
                  enterIndex={quickActions.length + 1 + i}
                  style={[
                    styles.suggestedChip,
                    { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "1A" },
                    isGenerating && styles.dim,
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.suggestedChipText, { color: colors.brandPrimary }]}>
                    {s.label}
                  </Text>
                </AnimatedChip>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* 3. Ask… on demand — a chip until tapped (or the pill's ✦ opens it), then
             an inline scope + input + send row that lifts above the keyboard
             (the parent FloatingPill owns that positioning). */}
      <View style={styles.section}>
        {!inputOpen ? (
          <AnimatedChip
            onPress={() => useFloatingPillStore.getState().setInputOpen(true)}
            disabled={isGenerating}
            accessibilityLabel={t("aiDock.ask", { defaultValue: "Ask…" })}
            enterIndex={quickActions.length + suggestions.length + 1}
            style={[
              styles.askChip,
              { flexDirection, backgroundColor: colors.brandPrimary },
              isGenerating && styles.dim,
            ]}
          >
            <MessageCircle size={16} color={colors.bgPrimary} strokeWidth={2.2} />
            <Text style={[styles.askChipText, { color: colors.bgPrimary }]}>
              {t("aiDock.ask", { defaultValue: "Ask…" })}
            </Text>
          </AnimatedChip>
        ) : (
          <View style={[styles.askRow, { flexDirection }]}>
            <View style={[styles.scopeTag, { backgroundColor: colors.brandPrimary + "1A" }]}>
              <Text numberOfLines={1} style={[styles.scopeTagText, { color: colors.brandPrimary }]}>
                {scopeLabel}
              </Text>
            </View>
            <TextInput
              autoFocus
              value={askText}
              onChangeText={setAskText}
              placeholder={t("aiDock.askPlaceholder", { defaultValue: "Ask the AI…" })}
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.askInput,
                { color: colors.textPrimary, backgroundColor: colors.bgCard, textAlign },
              ]}
              multiline={false}
              returnKeyType="send"
              onSubmitEditing={handleAskSend}
              editable={!isGenerating}
            />
            <Pressable
              onPress={handleAskSend}
              disabled={askDisabled}
              accessibilityRole="button"
              accessibilityLabel={t("chat.send", { defaultValue: "Send" })}
              style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }, askDisabled && styles.dim]}
            >
              <Send size={16} color={colors.bgPrimary} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  chipsRow: { flexWrap: "wrap", alignItems: "center", gap: 8 },
  section: { gap: 6 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },

  actionChip: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // Icon-only leading chevron — same footprint as an action chip, no label.
  collapseChip: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },

  suggestedChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
  },
  suggestedChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  shimmerBar: { width: 96, height: 28, borderRadius: 14 },

  askChip: {
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  askChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  askRow: { alignItems: "center", gap: 8 },
  scopeTag: { maxWidth: 96, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, justifyContent: "center" },
  scopeTagText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  askInput: { flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },

  dim: { opacity: 0.4 },
});
