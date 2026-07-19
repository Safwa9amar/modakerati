import { Pressable, View, Text, StyleSheet } from "react-native";
import { Eye, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Header button: opens the read-only preview (defaults to Word-fidelity). While a
// preview is open, PreviewBar lets the user switch Word⇄PDF or close back to the
// Writer. Highlights (brand color) while a preview is showing.
export function PreviewButton() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const previewMode = useWorkspaceStore((s) => s.previewMode);
  return (
    <Pressable
      onPress={() => useWorkspaceStore.getState().openPreview("docx")}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t("workspace.preview", { defaultValue: "Preview" })}
      style={styles.btn}
    >
      <Eye size={22} color={previewMode ? colors.brandPrimary : colors.textPrimary} />
    </Pressable>
  );
}

// In-preview top toolbar: a Word | PDF segmented toggle + a close (✕) back to the
// Writer. Renders nothing while writing (previewMode === null).
export function PreviewBar() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const previewMode = useWorkspaceStore((s) => s.previewMode);
  if (!previewMode) return null;
  const isDocx = previewMode === "docx";
  return (
    <View style={[styles.bar, { backgroundColor: colors.bgSurface, borderBottomColor: colors.textPlaceholder }]}>
      <View style={[styles.seg, { borderColor: colors.textPlaceholder }]}>
        <Pressable
          onPress={() => useWorkspaceStore.getState().setPreviewMode("docx")}
          style={[styles.segItem, isDocx && { backgroundColor: colors.brandPrimary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.segText, { color: isDocx ? "#FFFFFF" : colors.textPrimary }]}>
            {t("workspace.previewWord", { defaultValue: "Word" })}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => useWorkspaceStore.getState().setPreviewMode("pdf")}
          style={[styles.segItem, !isDocx && { backgroundColor: colors.brandPrimary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.segText, { color: !isDocx ? "#FFFFFF" : colors.textPrimary }]}>
            {t("workspace.previewPdf", { defaultValue: "PDF" })}
          </Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => useWorkspaceStore.getState().closePreview()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.closePreview", { defaultValue: "Close preview" })}
        style={styles.close}
      >
        <X size={20} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, alignItems: "center", justifyContent: "center" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seg: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: "hidden" },
  segItem: { paddingHorizontal: 18, paddingVertical: 6 },
  segText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
