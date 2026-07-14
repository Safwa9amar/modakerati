// components/workspace/ribbon/RibbonFavorites.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_TABS, type RibbonTool } from "./ribbon-config";
import { RIBBON_ICONS } from "./ribbon-icons";
import { useRibbonStore } from "@/stores/ribbon-store";

const BY_ID: Record<string, RibbonTool> = Object.fromEntries(
  RIBBON_TABS.flatMap((t) => t.tools).map((tool) => [tool.id, tool]),
);

export function RibbonFavorites({ onRun }: { onRun: (tool: RibbonTool) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const favorites = useRibbonStore((s) => s.favorites);
  const tools = favorites.map((id) => BY_ID[id]).filter(Boolean);
  if (!tools.length) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {tools.map((tool) => {
        const Icon = RIBBON_ICONS[tool.icon];
        return (
          <Pressable key={tool.id} onPress={() => onRun(tool)} style={[styles.chip, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
            {Icon ? <Icon size={13} color={colors.brandPrimary} strokeWidth={2} /> : null}
            <Text style={[styles.label, { color: colors.textPrimary }]} numberOfLines={1}>{t(tool.labelKey)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 7, paddingRight: 8, paddingVertical: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 11.5, fontFamily: "Inter_500Medium", maxWidth: 120 },
});
