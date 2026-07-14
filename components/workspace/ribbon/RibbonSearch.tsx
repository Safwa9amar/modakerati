// components/workspace/ribbon/RibbonSearch.tsx
import { useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_TABS, type RibbonTool } from "./ribbon-config";

const ALL_TOOLS: RibbonTool[] = RIBBON_TABS.flatMap((t) => t.tools);

export function RibbonSearch({ onRun }: { onRun: (tool: RibbonTool) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return ALL_TOOLS.filter((tool) => {
      const label = t(tool.labelKey).toLowerCase();
      const kw = (tool.keywords ?? []).join(" ").toLowerCase();
      return label.includes(n) || kw.includes(n);
    }).slice(0, 8);
  }, [q, t]);

  return (
    <View style={{ gap: 6 }}>
      <View style={[styles.bar, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
        <Text style={{ color: colors.textPlaceholder }}>🔍</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t("ribbon.searchPlaceholder", { defaultValue: "Tell me what you want to do…" })}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.input, { color: colors.textPrimary }]}
        />
      </View>
      {results.length > 0 && (
        <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
          {results.map((tool) => (
            <Pressable key={tool.id} onPress={() => onRun(tool)} style={styles.res}>
              <Text style={[styles.resLabel, { color: colors.textPrimary }]}>{t(tool.labelKey)}</Text>
              <Text style={[styles.resTab, { color: colors.textSecondary }]}>{t(`ribbon.tab.${tool.tab}`, { defaultValue: tool.tab })}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8 },
  input: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", padding: 0 },
  res: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, paddingHorizontal: 6 },
  resLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resTab: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
