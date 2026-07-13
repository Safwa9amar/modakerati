import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { Sparkles, Pencil } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

type Mode = "ai" | "edit";

interface Props {
  mode: Mode;
  onChange: (m: Mode) => void;
  aiLabel: string;
  editLabel: string;
  rtl: boolean;
}

export function ComposerModeToggle({ mode, onChange, aiLabel, editLabel, rtl }: Props) {
  const colors = useThemeColors();
  const seg = (m: Mode, label: string, Icon: typeof Sparkles) => {
    const active = mode === m;
    return (
      <Pressable
        onPress={() => onChange(m)}
        style={[styles.seg, active && { backgroundColor: colors.brandPrimary }]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Icon size={14} color={active ? colors.bgPrimary : colors.textSecondary} strokeWidth={2.2} />
        <Text style={[styles.segText, { color: active ? colors.bgPrimary : colors.textSecondary }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.wrap, { backgroundColor: colors.bgInput, flexDirection: rtl ? "row-reverse" : "row" }]}>
      {seg("ai", aiLabel, Sparkles)}
      {seg("edit", editLabel, Pencil)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", borderRadius: 12, padding: 3, gap: 3, marginBottom: 8 },
  seg: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 7, borderRadius: 9 },
  segText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
