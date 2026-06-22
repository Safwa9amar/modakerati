import { View, Text, Pressable, StyleSheet } from "react-native";
import { FileText, FileCode, Eye } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection } from "@/lib/text-direction";
import type { FilePayload } from "@/types/chat";

/**
 * A downloadable artifact (e.g. a thesis export) shown inline in the chat as a
 * tappable card. Laid out as a header (file-type icon, title, and a FORMAT badge
 * with "size · pages" meta) above a divided "Preview" footer. Tapping anywhere
 * opens the IN-APP preview — the file is never opened externally. The card flows
 * RTL when its title is in an RTL script, independent of the app's locale.
 */
export function FileCard({ file, onPress }: { file: FilePayload; onPress?: () => void }) {
  const colors = useThemeColors();
  const { t } = useTranslation();

  const format = (file.format || "file").toLowerCase();
  const isDoc = format === "docx";
  const Icon = isDoc ? FileText : FileCode;
  const tint = isDoc ? "#2B6CB0" : "#6B46C1"; // Word blue / LaTeX purple
  const title = file.title?.trim() || file.filename;
  const isRtl = getTextDirection(title) === "rtl";
  const align = isRtl ? "right" : "left";

  // Size and page count, joined into the muted line beside the format badge.
  const meta = [
    file.size,
    file.pages ? t("chat.pages", { n: file.pages, defaultValue: `${file.pages} pages` }) : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("chat.previewFile", { defaultValue: "Preview file" })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault, opacity: pressed ? 0.9 : 1 },
      ]}
    >
      <View style={[styles.header, isRtl && styles.rowReverse]}>
        <View style={[styles.iconBox, { backgroundColor: tint + "1A" }]}>
          <Icon size={24} color={tint} strokeWidth={1.8} />
        </View>

        <View style={styles.info}>
          <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary, textAlign: align }]}>
            {title}
          </Text>
          <View style={[styles.metaRow, isRtl && styles.rowReverse]}>
            <View style={[styles.badge, { backgroundColor: tint + "1A" }]}>
              <Text style={[styles.badgeText, { color: tint }]}>{format.toUpperCase()}</Text>
            </View>
            {!!meta && (
              <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary, textAlign: align }]}>
                {meta}
              </Text>
            )}
          </View>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.borderDefault }]}>
        <Eye size={15} color={colors.brandPrimary} strokeWidth={2} />
        <Text style={[styles.footerLabel, { color: colors.brandPrimary }]}>
          {t("preview.preview", { defaultValue: "Preview" })}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  rowReverse: { flexDirection: "row-reverse" },
  iconBox: { width: 46, height: 46, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  info: { flex: 1, gap: 6 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  meta: { flexShrink: 1, fontSize: 11.5, fontFamily: "Inter_500Medium" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerLabel: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
});
