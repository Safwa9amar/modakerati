// components/workspace/ribbon/RibbonPopover.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { RibbonTool, ToolOption } from "./ribbon-config";
import { PresetListPopover } from "./PresetListPopover";
import { SegmentPicker } from "./SegmentPicker";
import { GridSizePicker } from "./GridSizePicker";

interface Props {
  tool: RibbonTool;
  onPick: (opt: { value: string; label: string }) => void;
  onClose: () => void;
}

/** Compact popover shown above the strip for preset/segment/grid tools. */
export function RibbonPopover({ tool, onPick, onClose }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const pickOpt = (o: ToolOption) => onPick({ value: o.value, label: t(o.labelKey) });

  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textSecondary }]}>{t(tool.labelKey)}</Text>
        <Pressable onPress={onClose} hitSlop={8}><Text style={{ color: colors.textSecondary }}>✕</Text></Pressable>
      </View>
      {tool.kind === "preset" && tool.options ? <PresetListPopover options={tool.options} onPick={pickOpt} /> : null}
      {tool.kind === "segment" && tool.options ? <SegmentPicker options={tool.options} onPick={pickOpt} /> : null}
      {tool.kind === "grid" ? <GridSizePicker onPick={onPick} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 10, marginBottom: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
});
