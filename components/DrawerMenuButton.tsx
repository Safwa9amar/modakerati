import { Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useNavDrawerStore } from "@/stores/nav-drawer-store";

/**
 * The ☰ that opens the app index. It replaces `BackButton` on root surfaces (the
 * writer, chat): those have nothing behind them to go back TO, and the drawer is
 * now the only way out. Same footprint as BackButton so headers don't reflow.
 */
export function DrawerMenuButton() {
  const colors = useThemeColors();
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={() => useNavDrawerStore.getState().openView("app")}
      style={styles.button}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t("drawer.openMenu")}
    >
      <Menu size={22} color={colors.textPrimary} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { padding: 4 } });
