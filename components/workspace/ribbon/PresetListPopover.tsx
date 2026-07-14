// components/workspace/ribbon/PresetListPopover.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ToolOption } from "./ribbon-config";

export function PresetListPopover({ options, onPick }: { options: ToolOption[]; onPick: (opt: ToolOption) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={{ gap: 2 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onPick(o)} style={styles.row}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{t(o.labelKey)}</Text>
          {o.hint ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{o.hint}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, paddingHorizontal: 8, borderRadius: 8 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
