import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { TriangleAlert } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ConfirmPayload } from "@/types/chat";
import { visualTextAlign } from "@/lib/rtl-layout";

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
      // The snippet identifies it, not `d.index` — the student never sees a
      // position (see the server's lib/ai/no-index-leak.ts for the same rule).
      return t("confirmAction.deleteBlock", { snippet: d.snippet, defaultValue: c.preview.text });
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
 * A destructive action awaiting the student's approval. Approve executes the
 * server-stored args (never a chat message); Cancel discards the action. Shown
 * in the composer sheet in place of the input, like ComposerAsk.
 *
 * Worded throughout as KWILL doing the thing, never as "the AI" wanting to: the
 * student asked Kwill, and Kwill is what answers for the change afterwards.
 */
export function ComposerConfirm({ confirm, onApprove, onCancel, rtl }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View style={styles.container}>
      <View style={[styles.titleRow, rtl && { flexDirection: "row-reverse" }]}>
        <TriangleAlert size={16} color={colors.semanticError} />
        {/* Kwill's own voice, not "the AI wants to…". The student asked Kwill for
            something; a third party asking permission to touch their thesis is
            both stranger and less accountable than the product saying what it is
            about to do. Same reason the assistant never narrates its tools. */}
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("confirmAction.title", { defaultValue: "Kwill is about to make a big change to your thesis" })}
        </Text>
      </View>
      <Text style={[styles.preview, { color: colors.textSecondary, textAlign: visualTextAlign(rtl) }]}>
        {previewText(t, confirm)}
      </Text>
      <Text style={[styles.note, { color: colors.textPlaceholder, textAlign: visualTextAlign(rtl) }]}>
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
