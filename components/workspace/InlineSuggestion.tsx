import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet, I18nManager } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Sparkles, Check, Pencil, X, RotateCw } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

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
  const onApprove = () => useSuggestionStore.getState().approve(thesisId, index);
  const onEdit = () => {
    // Apply the proposal, then drop straight into the block's inline editor at the
    // start of the paragraph so the student can tweak it further.
    useSuggestionStore.getState().approve(thesisId, index);
    useWorkspaceStore.getState().setEditingBlock(index, 0);
  };
  const onReject = () => useSuggestionStore.getState().reject(index);
  const onAgain = () => void useSuggestionStore.getState().again(thesisId, index);

  return (
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
          icon={<Check size={15} color="#fff" />}
          label={t("suggestion.approve", { defaultValue: "Approve" })}
          onPress={onApprove}
          bg={colors.semanticSuccess}
          fg="#fff"
        />
        <Btn
          colors={colors}
          icon={<Pencil size={14} color={colors.textPrimary} />}
          label={t("suggestion.edit", { defaultValue: "Edit" })}
          onPress={onEdit}
        />
        <Btn
          colors={colors}
          icon={<RotateCw size={14} color={colors.textPrimary} />}
          label={t("suggestion.again", { defaultValue: "Again" })}
          onPress={onAgain}
        />
        <Btn
          colors={colors}
          icon={<X size={14} color={colors.semanticError} />}
          label={t("suggestion.reject", { defaultValue: "Reject" })}
          onPress={onReject}
          fg={colors.semanticError}
        />
      </View>
    </View>
  );
}

// A compact icon+label action button. `bg` fills it (primary Approve); otherwise
// it's a subtle bordered chip. `fg` tints the label (defaults to textPrimary).
function Btn({
  colors,
  icon,
  label,
  onPress,
  bg,
  fg,
}: {
  colors: ReturnType<typeof useThemeColors>;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  bg?: string;
  fg?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg ?? colors.bgCard,
          borderColor: bg ? "transparent" : colors.borderDefault,
          borderWidth: bg ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon}
      <Text style={[styles.btnLabel, { color: fg ?? colors.textPrimary }]}>{label}</Text>
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
  readyActions: { flexWrap: "wrap", marginTop: 2 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 9,
  },
  btnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
