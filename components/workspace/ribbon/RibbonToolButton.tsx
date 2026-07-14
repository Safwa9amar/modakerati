// components/workspace/ribbon/RibbonToolButton.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_ICONS } from "./ribbon-icons";
import type { RibbonTool } from "./ribbon-config";

interface Props {
  tool: RibbonTool;
  disabled?: boolean;
  onPress: (tool: RibbonTool) => void;
}

/** One labeled icon button in the strip. Shows a ▾ affordance for popover tools and
 *  a "soon" badge for tools whose backend isn't built yet (they route to AI). */
export function RibbonToolButton({ tool, disabled, onPress }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const Icon = RIBBON_ICONS[tool.icon];
  const hasMenu = tool.kind !== "action";
  const soon = tool.status === "soon";
  const hero = tool.actionKey === "design.thesisReady";

  return (
    <Pressable
      onPress={() => onPress(tool)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t(tool.labelKey)}
      style={[
        styles.btn,
        { backgroundColor: hero ? colors.brandPrimaryLight + "22" : colors.bgSurface, borderColor: hero ? colors.brandPrimary + "55" : colors.borderSubtle },
        disabled && styles.disabled,
      ]}
    >
      {soon && (
        <View style={[styles.soon, { backgroundColor: colors.semanticWarning }]}>
          <Text style={styles.soonText}>{t("ribbon.soon", { defaultValue: "soon" })}</Text>
        </View>
      )}
      {Icon ? <Icon size={18} color={hero ? colors.brandPrimary : colors.textSecondary} strokeWidth={2} /> : null}
      <Text style={[styles.label, { color: hero ? colors.brandPrimary : colors.textSecondary }]} numberOfLines={1}>
        {t(tool.labelKey)}{hasMenu ? " ▾" : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { minWidth: 60, alignItems: "center", gap: 4, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 9.5, fontFamily: "Inter_500Medium", textAlign: "center" },
  disabled: { opacity: 0.4 },
  soon: { position: "absolute", top: -5, right: -3, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6, zIndex: 1 },
  soonText: { fontSize: 7, fontFamily: "Inter_700Bold", color: "#1a1300", letterSpacing: 0.3 },
});
