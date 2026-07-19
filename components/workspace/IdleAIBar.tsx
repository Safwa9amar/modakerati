import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { X, type LucideIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { GeneratingPhase } from "@/stores/chat-store";
import type { ComposerSuggestion } from "@/lib/api";
import { ComposerInput } from "./ComposerInput";
import { ComposerQuickActions } from "./ComposerQuickActions";
import { ComposerThinking } from "./ComposerThinking";

interface Props {
  rtl: boolean;
  /** Scope pill text — the whole memoir (idle) or the selected block snippet. */
  scopeLabel: string;
  /** Optional leading icon for the scope pill. */
  scopeIcon?: LucideIcon;
  /** When set, the scope pill shows an ✕ that returns to the previous surface
   *  (block-scoped Ask AI → the formatting bar). Omitted for the idle memoir bar. */
  onScopeClose?: () => void;

  // — Input —
  inputText: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  onMicPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
  isGenerating: boolean;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  micLabel: string;

  // — Thinking / status (hidden while docked to keep the bar compact) —
  generatingPhase: GeneratingPhase;
  thinking: string;
  thinkingMs?: number;
  statusReady: string;

  // — Quick-action chips (hidden while docked) —
  suggestions: ComposerSuggestion[];
  onPreset: (prompt: string) => void;

  /** Keyboard up → collapse to just the scope pill + input (drop chips/status). */
  keyboardVisible: boolean;
  /** Safe-area bottom inset, applied only while the keyboard is down. */
  bottomInset: number;
}

/**
 * The docked AI input surface. Used two ways:
 *   • Idle (nothing selected) → prompts the WHOLE memoir (scope pill + chips + input).
 *   • Block-scoped Ask AI → the same surface anchored to the selected block, with a
 *     closable scope pill that returns to the block formatting bar.
 * Reuses the existing ComposerInput / ComposerQuickActions / ComposerThinking leaves.
 */
export function IdleAIBar({
  rtl,
  scopeLabel,
  scopeIcon: ScopeIcon,
  onScopeClose,
  inputText,
  onChangeText,
  onSend,
  onStop,
  onMicPress,
  onFocus,
  onBlur,
  isGenerating,
  placeholder,
  sendLabel,
  stopLabel,
  micLabel,
  generatingPhase,
  thinking,
  thinkingMs,
  statusReady,
  suggestions,
  onPreset,
  keyboardVisible,
  bottomInset,
}: Props) {
  const colors = useThemeColors();
  // Compact when the keyboard is up: drop the status line + chips so the input
  // hugs the keyboard (mirrors the old sheet's docked presentation).
  const compact = keyboardVisible;

  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: colors.bgPrimary,
          borderTopColor: colors.borderSubtle,
          paddingBottom: compact ? 8 : bottomInset + 10,
        },
      ]}
    >
      <View style={[styles.scopeRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <View style={[styles.scopePill, { backgroundColor: colors.brandPrimary + "1A", flexDirection: rtl ? "row-reverse" : "row" }]}>
          {ScopeIcon ? <ScopeIcon size={13} color={colors.brandPrimary} strokeWidth={2.2} /> : null}
          <Text style={[styles.scopeText, { color: colors.brandPrimary }]} numberOfLines={1}>
            {scopeLabel}
          </Text>
          {onScopeClose ? (
            <Pressable onPress={onScopeClose} hitSlop={8} accessibilityRole="button">
              <X size={13} color={colors.brandPrimary} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!compact ? (
        <ComposerThinking
          isGenerating={isGenerating}
          reasoning={isGenerating && generatingPhase === "thinking"}
          thinking={thinking}
          durationMs={thinkingMs}
          statusReady={statusReady}
          rtl={rtl}
          scrollComponent={ScrollView}
        />
      ) : null}

      {!compact ? (
        <>
          <View style={styles.chipsSpacer} />
          <ComposerQuickActions suggestions={suggestions} onPreset={onPreset} />
        </>
      ) : null}

      <View style={styles.inputSpacer} />
      <ComposerInput
        value={inputText}
        onChangeText={onChangeText}
        onSend={onSend}
        onStop={onStop}
        onMicPress={onMicPress}
        onFocus={onFocus}
        onBlur={onBlur}
        isGenerating={isGenerating}
        placeholder={placeholder}
        sendLabel={sendLabel}
        stopLabel={stopLabel}
        micLabel={micLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: 14,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    // A soft lift off the document.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 10,
  },
  scopeRow: { marginBottom: 8 },
  scopePill: {
    alignItems: "center",
    gap: 6,
    maxWidth: "85%",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  scopeText: { flexShrink: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  chipsSpacer: { height: 10 },
  inputSpacer: { height: 8 },
});
