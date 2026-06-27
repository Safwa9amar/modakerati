import { Pressable, Text, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Preset keys map 1:1 to the composer.presets.* i18n entries. */
export const PRESET_KEYS = ["expand", "rephrase", "cite", "summarize", "improve"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

interface Props {
  /** Receives the localized prompt text to drop into the input. */
  onPreset: (prompt: string) => void;
}

/**
 * A horizontal row of quick-action chips. Tapping one hands its localized prompt
 * up to the composer, which fills (does NOT auto-send) the input so the student
 * can tweak it first.
 */
export function ComposerQuickActions({ onPreset }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {PRESET_KEYS.map((key) => (
        <Pressable
          key={key}
          onPress={() => onPreset(t(`composer.presets.${key}.prompt`))}
          style={[styles.chip, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
        >
          <Text style={[styles.chipText, { color: colors.textPrimary }]}>
            {t(`composer.presets.${key}.label`)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
