import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FileText, MessageSquare } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * Fixed bottom action bar: full-width "Open workspace" + an icon-only chat
 * button, over a fade so the section list scrolls out from under it. Render
 * this as a sibling AFTER the ScrollView; it is absolutely positioned.
 */
export function ThesisActionBar({
  onOpenWorkspace,
  onChat,
}: {
  onOpenWorkspace: () => void;
  onChat: () => void;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <LinearGradient
        colors={["transparent", colors.bgPrimary]}
        style={styles.fade}
        pointerEvents="none"
      />
      <View style={[styles.bar, { paddingBottom: (insets.bottom || 16) }]}>
        <Pressable
          onPress={onOpenWorkspace}
          style={[styles.primary, { backgroundColor: colors.brandPrimary }]}
        >
          <FileText size={18} color="#FFFFFF" strokeWidth={2} />
          <Text style={styles.primaryText}>{t("workspace.open", { defaultValue: "Open workspace" })}</Text>
        </Pressable>
        <Pressable
          onPress={onChat}
          style={[styles.iconBtn, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
        >
          <MessageSquare size={20} color={colors.brandPrimary} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, top: -28, height: 28 },
  bar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  primary: {
    flex: 1,
    height: 50,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { color: "#FFFFFF", fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  iconBtn: {
    width: 54,
    height: 50,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
