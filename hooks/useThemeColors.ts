import { colors, type ThemeColors } from "@/constants/colors";
import { useSettingsStore } from "@/stores/settings-store";

export function useThemeColors(): ThemeColors {
  const theme = useSettingsStore((s) => s.theme);
  return colors[theme];
}
