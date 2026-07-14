import { View, Text, Pressable, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { LucideIcon } from "lucide-react-native";

export interface ToolItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  /** Renders in the brand-accent "on" style (used by the Thinking toggle). */
  active?: boolean;
}

interface Props {
  label: string;
  tools: ToolItem[];
}

/** The expanded tray: a horizontally-scrollable row of labelled icon buttons. */
export function ComposerToolsTray({ label, tools }: Props) {
  const colors = useThemeColors();

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.textPlaceholder }]}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {tools.map((tool) => {
          const Icon = tool.icon;
          const tint = tool.active ? colors.semanticSuccess : colors.textSecondary;
          const bg = tool.active ? colors.semanticSuccess + "1A" : colors.bgSurface;
          const border = tool.active ? colors.semanticSuccess + "55" : colors.borderSubtle;
          return (
            <Pressable
              key={tool.key}
              onPress={tool.onPress}
              disabled={tool.disabled}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              style={[
                styles.tool,
                { backgroundColor: bg, borderColor: border, opacity: tool.disabled ? 0.4 : 1 },
              ]}
            >
              <Icon size={18} color={tint} strokeWidth={2} />
              <Text style={[styles.toolLabel, { color: tint }]} numberOfLines={1}>
                {tool.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12 },
  heading: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: "row", gap: 8, paddingRight: 8 },
  tool: {
    width: 72,
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
});
