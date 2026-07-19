import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TriangleAlert } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ConfirmPayload } from "@/types/chat";

interface Props {
  confirm: ConfirmPayload;
  onApprove: () => void;
  onCancel: () => void;
  rtl: boolean;
}

// Localized preview line; falls back to the server-built English text.
function previewText(t: TFunction, c: ConfirmPayload): string {
  const d = c.preview.data as Record<string, string | number>;
  switch (c.preview.kind) {
    case "delete_block":
      return t("confirmAction.deleteBlock", { index: d.index, snippet: d.snippet, defaultValue: c.preview.text });
    case "replace_text":
      return t("confirmAction.replaceText", { find: d.find, replace: d.replace, count: d.count, defaultValue: c.preview.text });
    case "set_header": case "set_section_header":
      return t("confirmAction.overwriteHeader", { next: d.next, defaultValue: c.preview.text });
    case "set_footer": case "set_section_footer":
      return t("confirmAction.overwriteFooter", { next: d.next, defaultValue: c.preview.text });
    default:
      return t(`confirmAction.${c.preview.kind}`, { defaultValue: c.preview.text });
  }
}

/**
 * A destructive AI action awaiting the student's approval. Approve executes the
 * server-stored args (never a chat message); Cancel discards the action. Shown
 * in the composer sheet in place of the input, like ComposerAsk.
 */
export function ComposerConfirm({ confirm, onApprove, onCancel, rtl }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View style={styles.container}>
      <View style={[styles.titleRow, rtl && { flexDirection: "row-reverse" }]}>
        <TriangleAlert size={16} color={colors.semanticError} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("confirmAction.title", { defaultValue: "The AI wants to make a critical change" })}
        </Text>
      </View>
      <Text style={[styles.preview, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}>
        {previewText(t, confirm)}
      </Text>
      <Text style={[styles.note, { color: colors.textPlaceholder, textAlign: rtl ? "right" : "left" }]}>
        {t("confirmAction.undoNote", { defaultValue: "You can undo this later from History." })}
      </Text>
      <View style={[styles.actions, rtl && { flexDirection: "row-reverse" }]}>
        <Pressable
          onPress={onApprove}
          style={[styles.btn, { backgroundColor: colors.semanticError }]}
          accessibilityRole="button"
        >
          <Text style={styles.approveText}>{t("confirmAction.approve", { defaultValue: "Approve" })}</Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={[styles.btn, styles.cancelBtn, { borderColor: colors.borderDefault, backgroundColor: colors.bgCard }]}
          accessibilityRole="button"
        >
          <Text style={[styles.cancelText, { color: colors.textPrimary }]}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, paddingTop: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  preview: { fontSize: 14, fontFamily: "Inter_500Medium" },
  note: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10 },
  btn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12 },
  cancelBtn: { borderWidth: 1 },
  approveText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
