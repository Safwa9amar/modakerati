// components/workspace/ribbon/RibbonToolStrip.tsx
import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { RibbonToolButton } from "./RibbonToolButton";
import { RibbonPopover } from "./RibbonPopover";
import type { RibbonTool } from "./ribbon-config";
import { useThemeColors } from "@/hooks/useThemeColors";

interface Props {
  tools: RibbonTool[];
  /** Run a tool. `option` is set when the user chose a popover option. */
  onRun: (tool: RibbonTool, option?: { value: string; label: string }) => void;
  /** A tool is disabled when it needs a selection there isn't one for (caller decides). */
  isDisabled?: (tool: RibbonTool) => boolean;
}

export function RibbonToolStrip({ tools, onRun, isDisabled }: Props) {
  const colors = useThemeColors();
  const [openTool, setOpenTool] = useState<RibbonTool | null>(null);

  const press = (tool: RibbonTool) => {
    if (tool.kind === "action") { setOpenTool(null); onRun(tool); return; }
    setOpenTool((cur) => (cur?.id === tool.id ? null : tool)); // toggle popover
  };

  return (
    <View>
      {openTool && (
        <RibbonPopover
          tool={openTool}
          onClose={() => setOpenTool(null)}
          onPick={(opt) => { const tool = openTool; setOpenTool(null); onRun(tool, opt); }}
        />
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {tools.map((tool, i) => {
          const prev = tools[i - 1];
          const boundary = i > 0 && prev.group !== tool.group;
          return (
            <View key={tool.id} style={styles.item}>
              {boundary && <View style={[styles.divider, { backgroundColor: colors.borderDefault }]} />}
              <RibbonToolButton tool={tool} disabled={isDisabled?.(tool)} onPress={press} />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 7, paddingRight: 8, paddingVertical: 2, alignItems: "center" },
  item: { flexDirection: "row", alignItems: "center", gap: 7 },
  divider: { width: 1, height: 30, marginRight: 2 },
});
