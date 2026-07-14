// components/workspace/ribbon/SegmentPicker.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ToolOption } from "./ribbon-config";

export function SegmentPicker({ options, onPick }: { options: ToolOption[]; onPick: (opt: ToolOption) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onPick(o)} style={[styles.seg, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{t(o.labelKey)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6 },
  seg: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
