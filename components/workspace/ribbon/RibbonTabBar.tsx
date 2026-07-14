// components/workspace/ribbon/RibbonTabBar.tsx
import { Text, Pressable, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { RIBBON_TABS, type RibbonTabId } from "./ribbon-config";
import type { TabBarId } from "@/stores/ribbon-store";

interface Props {
  active: TabBarId;
  contextual: RibbonTabId | null;
  onSelect: (tab: TabBarId) => void;
}

export function RibbonTabBar({ active, contextual, onSelect }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();

  const fixed = RIBBON_TABS.filter((tab) => !tab.contextual);
  const items: { id: TabBarId; labelKey: string }[] = [
    { id: "home", labelKey: "ribbon.tab.home" },
    ...fixed.map((tab) => ({ id: tab.id as TabBarId, labelKey: tab.labelKey })),
  ];
  if (contextual) {
    const def = RIBBON_TABS.find((tab) => tab.id === contextual);
    if (def) items.push({ id: def.id, labelKey: def.labelKey });
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((it) => {
        const on = it.id === active;
        return (
          <Pressable key={it.id} onPress={() => onSelect(it.id)} style={styles.tab}>
            <Text style={[styles.label, { color: on ? colors.brandPrimary : colors.textSecondary }, on && { borderBottomColor: colors.brandPrimary, borderBottomWidth: 2 }]}>
              {t(it.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 16, paddingRight: 8, alignItems: "flex-end", paddingBottom: 2 },
  tab: { paddingBottom: 2 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", paddingBottom: 5 },
});
