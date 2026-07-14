// components/workspace/ribbon/GridSizePicker.tsx
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

const MAX = 6;

export function GridSizePicker({ onPick }: { onPick: (opt: { value: string; label: string }) => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <View style={{ gap: 8, alignItems: "center" }}>
      <Text style={[styles.caption, { color: colors.textSecondary }]}>
        {hover.r > 0 ? `${hover.r} × ${hover.c}` : t("ribbon.opt.pickTableSize", { defaultValue: "Pick table size" })}
      </Text>
      <View>
        {Array.from({ length: MAX }).map((_, r) => (
          <View key={r} style={styles.gridRow}>
            {Array.from({ length: MAX }).map((_, c) => {
              const on = r < hover.r && c < hover.c;
              return (
                <Pressable
                  key={c}
                  onPressIn={() => setHover({ r: r + 1, c: c + 1 })}
                  onPress={() => onPick({ value: `${r + 1}x${c + 1}`, label: `${r + 1} × ${c + 1}` })}
                  style={[styles.cell, { borderColor: colors.borderDefault, backgroundColor: on ? colors.brandPrimary : colors.bgSurface }]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 12, fontFamily: "Inter_500Medium" },
  gridRow: { flexDirection: "row" },
  cell: { width: 26, height: 22, margin: 2, borderRadius: 3, borderWidth: 1 },
});
