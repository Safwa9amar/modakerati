import { Pressable, Text, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ComposerSuggestion } from "@/lib/api";

/** Preset keys map 1:1 to the composer.presets.* i18n entries. */
export const PRESET_KEYS = ["expand", "rephrase", "cite", "summarize", "improve"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

interface Props {
  /** Receives the localized prompt text to drop into the input. */
  onPreset: (prompt: string) => void;
  /** AI-generated chips (grounded in the conversation + selection + RAG). When
   *  present they replace the static presets; empty → the static presets show. */
  suggestions?: ComposerSuggestion[];
}

/**
 * A horizontal row of quick-action chips. When AI suggestions are available they
 * are shown; otherwise it falls back to the static localized presets (also used
 * offline / before the first suggestion resolves / on a fresh thesis). Tapping a
 * chip hands its prompt up to the composer, which fills (does NOT auto-send) the
 * input so the student can tweak it first.
 */
export function ComposerQuickActions({ onPreset, suggestions }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const dynamic = suggestions && suggestions.length > 0;
  const chips = dynamic
    ? suggestions!.map((s, i) => ({ key: `ai-${i}`, label: s.label, prompt: s.prompt }))
    : PRESET_KEYS.map((k) => ({
        key: k,
        label: t(`composer.presets.${k}.label`),
        prompt: t(`composer.presets.${k}.prompt`),
      }));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          onPress={() => onPreset(chip.prompt)}
          style={[styles.chip, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
        >
          <Text style={[styles.chipText, { color: colors.textPrimary }]} numberOfLines={1}>
            {chip.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", maxWidth: 220 },
});
