// components/workspace/ribbon/ComposerRibbon.tsx
import { useEffect, useMemo } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { Search } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useTranslation } from "react-i18next";
import { RIBBON_TABS, type RibbonTool } from "./ribbon-config";
import { RibbonTabBar } from "./RibbonTabBar";
import { RibbonToolStrip } from "./RibbonToolStrip";
import { RibbonSearch } from "./RibbonSearch";
import { RibbonFavorites } from "./RibbonFavorites";
import { useContextualTab } from "./useContextualTab";
import { useRibbonStore } from "@/stores/ribbon-store";
import { dispatchRibbonAction } from "@/lib/ribbon-actions";
import type { DocBlockDTO } from "@/lib/api";
// TabBarId ("home" | RibbonTabId) is defined in the store.

interface Props {
  thesisId: string;
  blocks: DocBlockDTO[];
  selection: { index: number; text: string; level?: number }[];
  /** Home tab body (the existing ComposerEditTools), rendered by the parent. */
  homeSlot: React.ReactNode;
  onAfterEdit: () => void;
  onAiAction: (instruction: string) => void;
}

export function ComposerRibbon({ thesisId, blocks, selection, homeSlot, onAfterEdit, onAiAction }: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const activeTab = useRibbonStore((s) => s.activeTab);
  const setActiveTab = useRibbonStore((s) => s.setActiveTab);
  const searchOpen = useRibbonStore((s) => s.searchOpen);
  const setSearchOpen = useRibbonStore((s) => s.setSearchOpen);

  const selectedIndices = useMemo(() => selection.map((s) => s.index), [selection]);
  const contextual = useContextualTab(blocks, selectedIndices);

  // Auto-focus the contextual tab when a matching block is selected; fall back to
  // Layout when the selection clears and the contextual tab was active.
  useEffect(() => {
    if (contextual) setActiveTab(contextual);
    else if (["table", "picture", "heading"].includes(activeTab)) setActiveTab("layout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextual]);

  const run = (tool: RibbonTool, option?: { value: string; label: string }) => {
    setSearchOpen(false);
    void dispatchRibbonAction(tool, option?.value, {
      thesisId, selection, onAfterEdit, onAiAction, optionLabel: option?.label,
    });
  };

  const activeDef = RIBBON_TABS.find((tab) => tab.id === activeTab);

  return (
    <View style={{ gap: 8 }}>
      <RibbonFavorites onRun={run} />

      <View style={styles.tabRow}>
        <View style={{ flex: 1 }}>
          <RibbonTabBar active={activeTab} contextual={contextual} onSelect={(tab) => { setSearchOpen(false); setActiveTab(tab); }} />
        </View>
        <Pressable onPress={() => setSearchOpen(!searchOpen)} hitSlop={8} style={styles.searchBtn} accessibilityRole="button" accessibilityLabel={t("ribbon.search", { defaultValue: "Search tools" })}>
          <Search size={18} color={searchOpen ? colors.brandPrimary : colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </View>

      {searchOpen ? (
        <RibbonSearch onRun={run} />
      ) : activeTab === "home" ? (
        <View>{homeSlot}</View>
      ) : activeDef ? (
        <RibbonToolStrip key={activeTab} tools={activeDef.tools} onRun={run} isDisabled={(tool) => (tool.actionKey.startsWith("heading.") ? selection.length !== 1 : false)} />
      ) : (
        <Text style={{ color: colors.textSecondary, fontSize: 12, padding: 8 }}>{t("ribbon.empty", { defaultValue: "No tools." })}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: "row", alignItems: "flex-end", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#8883" },
  searchBtn: { paddingHorizontal: 6, paddingBottom: 6 },
});
