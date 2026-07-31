import React from "react";
import { View, Text, Pressable } from "react-native";
import { ChevronsDownUp, Sparkles, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { DockScope } from "@/lib/ai-dock-scopes";
import { dockStyles as s } from "./styles";

interface Props {
  scope: DockScope;
  /** Number of selected blocks — interpolated into the count-bearing headers. */
  count: number;
  /** Clear the selection WITHOUT leaving select mode (matching today's split:
   *  "Clear selection" and "Done selecting" were separate controls, and exiting
   *  the mode now lives on GlobalDockBar). Hidden when nothing is selected. */
  onClear: () => void;
  onCollapse: () => void;
}

/**
 * The dock's first row: what the AI is about to act on, and — the point of this
 * redesign — whether the result is something the student reviews or something
 * that just happens. The outcome tints the ✦ glyph and the text, so the two are
 * distinguishable at a glance without spending a row on it.
 */
export function ScopeHeader({ scope, count, onClear, onCollapse }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();

  const tint = scope.outcome === "review" ? colors.semanticSuccess : colors.semanticWarning;
  const target = t(scope.headerKey, { defaultValue: scope.headerFallback, count });
  const outcome = t(scope.outcomeKey, { defaultValue: scope.outcomeFallback });

  return (
    <View style={[s.header, { flexDirection }]}>
      <Sparkles size={13} color={tint} strokeWidth={2.4} />
      <Text numberOfLines={1} style={[s.headerTarget, { color: tint }]}>
        {target}
      </Text>
      {/* Deliberately a separate, non-shrinking Text rather than one
          concatenated string: see headerOutcome in styles.ts for why. */}
      <Text numberOfLines={1} style={[s.headerOutcome, { color: tint }]}>
        {`· ${outcome}`}
      </Text>
      <View style={s.headerSpacer} />
      {count > 0 ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={t("dockBar.clearSelection", { defaultValue: "Clear selection" })}
          style={[s.headerBtn, { backgroundColor: colors.bgCard }]}
        >
          <X size={13} color={colors.textSecondary} strokeWidth={2.2} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onCollapse}
        accessibilityRole="button"
        accessibilityLabel={t("blockBar.collapse", { defaultValue: "Collapse" })}
        style={[s.headerBtn, { backgroundColor: colors.bgCard }]}
      >
        <ChevronsDownUp size={13} color={colors.textSecondary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
