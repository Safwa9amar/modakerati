import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, I18nManager } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Sparkles, Check, Pencil, X, RotateCw } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { ThinkingTrace } from "@/components/ThinkingTrace";
import { hSuccess } from "@/lib/haptics";

// The ready card sits on the WHITE document paper (a pale mint success tint over
// white), so its controls use FIXED on-white ink — theme textPrimary/bgCard are
// light in dark mode and vanish here (same reason `proposed`/`original` below are
// hardcoded). These keep Approve/Edit/Again/Reject legible in both themes.
const CARD_INK = "#16311F"; // dark green ink for secondary labels/icons
const CARD_INK_BORDER = "rgba(22,49,31,0.20)";
const CARD_CHIP_BG = "#FFFFFF"; // white chip on the mint card
// Approve is the primary action — a SOLID dark-green fill with white ink stands
// out clearly on the pale-mint card (dark-green is dark enough that white never
// washes out).
const APPROVE_BG = "#0E7A46";
const APPROVE_INK = "#FFFFFF";
const REJECT_INK = "#C0392B"; // red that reads on white
const REJECT_BORDER = "rgba(192,57,43,0.22)";

/** A ✦ that spins while the AI drafts the suggestion. */
function Spinner({ color }: { color: string }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View style={st}>
      <Sparkles size={14} color={color} />
    </Animated.View>
  );
}

/**
 * The AI's reasoning for this suggestion, in the shared collapsible ThinkingTrace.
 * Rendered on a THEME surface (bgCard) — ThinkingTrace styles its text with theme
 * colors, which would be illegible on the white/mint document cards below. The
 * chrome follows the APP language (I18nManager.isRTL); the reasoning text itself
 * stays LTR (ThinkingTrace handles that). A plain RN ScrollView is passed because
 * this card is NOT inside a bottom sheet — ThinkingTrace's default
 * BottomSheetScrollView throws outside one. Renders nothing when the model emitted
 * no reasoning (a short rewrite often does), so the card keeps its simple spinner.
 */
function SuggestionTrace({
  reasoning,
  streaming,
  reasoningMs,
  colors,
}: {
  reasoning: string;
  streaming: boolean;
  reasoningMs?: number;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (!reasoning.trim()) return null;
  return (
    <View style={[styles.traceCard, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}>
      <ThinkingTrace
        text={reasoning}
        streaming={streaming}
        durationMs={reasoningMs}
        defaultOpen={false}
        rtl={I18nManager.isRTL}
        ScrollComponent={ScrollView}
        surfaceColor={colors.bgCard}
      />
    </View>
  );
}

interface Props {
  thesisId: string;
  index: number;
  rtl: boolean;
}

/**
 * The inline AI-suggestion card, rendered directly under its block in the outline.
 * Reads only ITS OWN pending suggestion via a stable-ref selector (the stored
 * PendingSuggestion object, or undefined → renders nothing). Three states:
 *   • loading → a subtle "✦ Thinking…" row.
 *   • error   → a message + Again / Reject.
 *   • ready   → the proposed rewrite in a green box (original dimmed + struck-through
 *               above it) with Approve / Edit / Again / Reject.
 * "Edit" applies the proposal (approve) then opens the block's inline editor.
 */
export function InlineSuggestion({ thesisId, index, rtl }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  // Stable ref: the stored object (or undefined). Never a fresh object/array
  // literal → safe against zustand's Object.is selector loop.
  const sug = useSuggestionStore((s) => s.byIndex[index]);
  if (!sug) return null;

  const rowDir = rtl ? "row-reverse" : "row";
  // The "Thinking…" chrome follows the APP language (not the document's), per the
  // app-lang alignment rule; the proposed/original TEXT keeps the doc direction.
  const appRowDir = I18nManager.isRTL ? "row-reverse" : "row";
  const textStyle = {
    writingDirection: rtl ? ("rtl" as const) : ("ltr" as const),
    textAlign: rtl ? ("right" as const) : ("left" as const),
  };

  if (sug.status === "loading") {
    // Once reasoning tokens arrive, the ThinkingTrace's own animated header IS the
    // loading indicator (expandable to watch the thinking stream live); before any
    // reasoning has streamed, keep the simple spinner row.
    if (sug.reasoning.trim()) {
      return <SuggestionTrace reasoning={sug.reasoning} streaming reasoningMs={sug.reasoningMs} colors={colors} />;
    }
    return (
      <View
        style={[
          styles.card,
          styles.thinkingCard,
          { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle, flexDirection: appRowDir },
        ]}
      >
        <Spinner color={colors.brandPrimary} />
        <Text style={[styles.thinking, { color: colors.textSecondary }]}>
          {t("composer.thinking", { defaultValue: "Thinking…" })}
        </Text>
      </View>
    );
  }

  if (sug.status === "error") {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.bgCard,
            borderColor: colors.semanticError + "55",
            flexDirection: rowDir,
            justifyContent: "space-between",
            alignItems: "center",
          },
        ]}
      >
        <Text style={[styles.errText, { color: colors.semanticError }]} numberOfLines={2}>
          {t("suggestion.failed", { defaultValue: "Couldn't generate a suggestion." })}
        </Text>
        <View style={[styles.actions, { flexDirection: rowDir }]}>
          <Btn
            colors={colors}
            icon={<RotateCw size={15} color={colors.brandPrimary} />}
            label={t("suggestion.again", { defaultValue: "Again" })}
            onPress={() => void useSuggestionStore.getState().again(thesisId, index)}
            fg={colors.brandPrimary}
          />
          <Btn
            colors={colors}
            icon={<X size={15} color={colors.textSecondary} />}
            label={t("suggestion.reject", { defaultValue: "Reject" })}
            onPress={() => useSuggestionStore.getState().reject(index)}
          />
        </View>
      </View>
    );
  }

  // status === "ready"
  const onApprove = () => {
    hSuccess();
    useSuggestionStore.getState().approve(thesisId, index);
  };
  const onEdit = () => {
    // Apply the proposal, then drop straight into the block's inline editor at the
    // start of the paragraph so the student can tweak it further.
    useSuggestionStore.getState().approve(thesisId, index);
    useWorkspaceStore.getState().setEditingBlock(index, 0);
  };
  const onReject = () => useSuggestionStore.getState().reject(index);
  const onAgain = () => void useSuggestionStore.getState().again(thesisId, index);

  return (
    <>
      {/* Collapsed "Thought for Xs" above the diff — the user can expand it to read
          how the AI approached the rewrite. Self-hides when there was no reasoning. */}
      <SuggestionTrace reasoning={sug.reasoning} streaming={false} reasoningMs={sug.reasoningMs} colors={colors} />
      <View
        style={[
          styles.readyCard,
          { backgroundColor: colors.semanticSuccess + "14", borderColor: colors.semanticSuccess + "66" },
        ]}
      >
        {!!sug.original && sug.original !== sug.proposed && (
          <Text style={[styles.original, textStyle, { color: "rgba(20,40,26,0.45)" }]} numberOfLines={3}>
            {sug.original}
          </Text>
        )}
        {/* The card sits on the WHITE document, so text must be dark ink (theme
            textPrimary is light in dark mode → invisible here). */}
        <Text style={[styles.proposed, textStyle, { color: "#16311F" }]}>{sug.proposed}</Text>
        <View style={[styles.actions, styles.readyActions, { flexDirection: rowDir }]}>
          <Btn
            colors={colors}
            flex
            icon={<Check size={15} color={APPROVE_INK} />}
            label={t("suggestion.approve", { defaultValue: "Approve" })}
            onPress={onApprove}
            bg={APPROVE_BG}
            fg={APPROVE_INK}
          />
          <Btn
            colors={colors}
            flex
            icon={<Pencil size={14} color={CARD_INK} />}
            label={t("suggestion.edit", { defaultValue: "Edit" })}
            onPress={onEdit}
            bg={CARD_CHIP_BG}
            fg={CARD_INK}
            border={CARD_INK_BORDER}
          />
          <Btn
            colors={colors}
            flex
            icon={<RotateCw size={14} color={CARD_INK} />}
            label={t("suggestion.again", { defaultValue: "Again" })}
            onPress={onAgain}
            bg={CARD_CHIP_BG}
            fg={CARD_INK}
            border={CARD_INK_BORDER}
          />
          <Btn
            colors={colors}
            flex
            icon={<X size={14} color={REJECT_INK} />}
            label={t("suggestion.reject", { defaultValue: "Reject" })}
            onPress={onReject}
            bg={CARD_CHIP_BG}
            fg={REJECT_INK}
            border={REJECT_BORDER}
          />
        </View>
      </View>
    </>
  );
}

// A compact icon+label action button. A `bg` with no `border` reads as a filled
// primary (Approve); pass `border` for an outlined chip on any surface. `fg` tints
// the label (defaults to textPrimary). Callers on the white document card pass
// FIXED on-white colors (theme colors flip light-on-dark and vanish there).
function Btn({
  colors,
  icon,
  label,
  onPress,
  bg,
  fg,
  border,
  flex,
}: {
  colors: ReturnType<typeof useThemeColors>;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  bg?: string;
  fg?: string;
  border?: string;
  flex?: boolean;
}) {
  // Filled = a background with no explicit border (the primary CTA). Everything
  // else is an outlined chip so it stays visible on light surfaces.
  const filled = !!bg && !border;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        flex && styles.btnFlex,
        {
          backgroundColor: bg ?? colors.bgCard,
          borderColor: border ?? (filled ? "transparent" : colors.borderDefault),
          borderWidth: filled ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon}
      <Text numberOfLines={1} style={[styles.btnLabel, { color: fg ?? colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 4,
    marginBottom: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  thinkingCard: { alignItems: "center" },
  thinking: { fontSize: 13, fontFamily: "Inter_500Medium" },
  // The reasoning trace card — a theme surface (bgCard) so ThinkingTrace's
  // theme-colored text stays legible (the diff card below is white/mint).
  traceCard: {
    marginTop: 4,
    marginBottom: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  readyCard: {
    marginTop: 4,
    marginBottom: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  original: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    textDecorationLine: "line-through",
  },
  proposed: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_500Medium" },
  actions: { alignItems: "center", gap: 8 },
  readyActions: { marginTop: 4 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  // Equal-width action buttons in a single row (icon + label centered together).
  btnFlex: { flex: 1 },
  btnLabel: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
});
