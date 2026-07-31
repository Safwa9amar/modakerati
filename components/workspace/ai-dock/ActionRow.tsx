import React, { useEffect } from "react";
import { Text } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { ListPlus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { ComposerSuggestion } from "@/lib/api";
import type { DockAction } from "@/lib/ai-dock-scopes";
import { AnimatedChip } from "../AnimatedChip";
import { dockStyles as s } from "./styles";

/** One reserved slot, pulsing, occupying exactly a suggestion chip's box. */
function Slot({ color }: { color: string }) {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => {
      pulse.value = 0.35;
    };
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[s.slot, { backgroundColor: color }, style]} />;
}

interface Props {
  actions: DockAction[];
  suggestions: ComposerSuggestion[];
  loading: boolean;
  disabled: boolean;
  /** Gapped paragraph selection → offer the one-tap upgrade back to a
   *  reviewable range rewrite. */
  showSelectGaps: boolean;
  onSelectGaps: () => void;
  onPrompt: (prompt: string) => void;
}

/**
 * Row three: ONE horizontally scrolling row. Suggestions lead — they are the
 * scope-aware prompts a student can't easily type — and the canned actions
 * follow.
 *
 * While suggestions load, two reserved slots hold the leading positions, so the
 * chips under the student's thumb never move. If more than two arrive, the
 * extras append and push the canned block rightward: a horizontal shift inside
 * a scroller, not a reflow of the panel.
 *
 * gesture-handler's ScrollView, not RN's — nested inside the reorderable list,
 * RN's loses the horizontal pan to the list's gesture handler. Same reason
 * BlockContextBar and GlobalDockBar use it.
 */
export function ActionRow({
  actions,
  suggestions,
  loading,
  disabled,
  showSelectGaps,
  onSelectGaps,
  onPrompt,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();

  let enterIndex = 0;
  const next = () => enterIndex++;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={s.rowScroll}
      contentContainerStyle={[s.rowContent, { flexDirection }]}
    >
      {showSelectGaps ? (
        <AnimatedChip
          onPress={onSelectGaps}
          accessibilityLabel={t("aiDock.selectGaps", { defaultValue: "Select the gaps" })}
          enterIndex={next()}
          style={[s.chip, { flexDirection, borderColor: colors.semanticWarning, backgroundColor: colors.bgCard }]}
        >
          <ListPlus size={15} color={colors.semanticWarning} strokeWidth={2} />
          <Text numberOfLines={1} style={[s.chipText, { color: colors.semanticWarning }]}>
            {t("aiDock.selectGaps", { defaultValue: "Select the gaps" })}
          </Text>
        </AnimatedChip>
      ) : null}

      {loading ? (
        <>
          <Slot color={colors.bgCard} />
          <Slot color={colors.bgCard} />
        </>
      ) : (
        suggestions.map((sg, i) => (
          <AnimatedChip
            key={`sugg-${i}`}
            onPress={() => onPrompt(sg.prompt)}
            disabled={disabled}
            accessibilityLabel={sg.label}
            enterIndex={next()}
            style={[
              s.suggChip,
              { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "1A" },
              disabled && s.dim,
            ]}
          >
            <Text numberOfLines={1} style={[s.suggChipText, { color: colors.brandPrimary }]}>
              {sg.label}
            </Text>
          </AnimatedChip>
        ))
      )}

      {actions.map((a) => (
        <AnimatedChip
          key={a.key}
          onPress={() => onPrompt(a.prompt)}
          disabled={disabled}
          accessibilityLabel={t(a.labelKey, { defaultValue: a.labelFallback })}
          enterIndex={next()}
          style={[
            s.chip,
            { flexDirection, borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
            disabled && s.dim,
          ]}
        >
          <a.Icon size={15} color={colors.textPrimary} strokeWidth={2} />
          <Text numberOfLines={1} style={[s.chipText, { color: colors.textPrimary }]}>
            {t(a.labelKey, { defaultValue: a.labelFallback })}
          </Text>
        </AnimatedChip>
      ))}
    </ScrollView>
  );
}
