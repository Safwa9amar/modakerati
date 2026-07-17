import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { MoreVertical, Pencil, Download, Trash2 } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection } from "@/lib/text-direction";
import { updateThesis, deleteThesis as apiDeleteThesis } from "@/lib/api";
import { useThesisStore } from "@/stores/thesis-store";
import type { Thesis } from "@/types/thesis";

/**
 * The ⋯ header menu. Opens a bottom action sheet with Rename (inline modal),
 * Export (routes to the existing Export screen), and Delete (confirm → API →
 * store cleanup → back). Reuses existing API + store; no new endpoints.
 */
export function ThesisHeaderMenu({
  thesis,
  onRenamed,
}: {
  thesis: Thesis;
  onRenamed: (title: string) => void;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(thesis.title);
  const [busy, setBusy] = useState(false);

  const openRename = () => {
    setMenuOpen(false);
    setName(thesis.title);
    setRenameOpen(true);
  };

  const saveRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === thesis.title) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    try {
      await updateThesis(thesis.id, { title: trimmed });
      onRenamed(trimmed);
      setRenameOpen(false);
    } catch {
      Alert.alert(t("thesis.rename"), t("thesis.genericError"));
    }
    setBusy(false);
  };

  const doExport = () => {
    setMenuOpen(false);
    router.push({ pathname: "/(app)/export", params: { thesisId: thesis.id } });
  };

  const doDelete = () => {
    setMenuOpen(false);
    Alert.alert(t("thesis.deleteConfirmTitle"), t("thesis.deleteConfirmMessage"), [
      { text: t("thesis.renameCancel"), style: "cancel" },
      {
        text: t("thesis.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await apiDeleteThesis(thesis.id);
            useThesisStore.getState().deleteThesis(thesis.id);
            router.back();
          } catch {
            Alert.alert(t("thesis.delete"), t("thesis.genericError"));
          }
        },
      },
    ]);
  };

  const nameRtl = getTextDirection(name || thesis.title) === "rtl";

  return (
    <>
      <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.kebab}>
        <MoreVertical size={22} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>

      {/* action sheet */}
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.bgModal }]} onPress={() => {}}>
            <Text style={[styles.sheetTitle, { color: colors.textSecondary }]}>{t("thesis.menuTitle")}</Text>

            <Pressable onPress={openRename} style={styles.item}>
              <Pencil size={19} color={colors.textPrimary} strokeWidth={2} />
              <Text style={[styles.itemText, { color: colors.textPrimary }]}>{t("thesis.rename")}</Text>
            </Pressable>
            <Pressable onPress={doExport} style={styles.item}>
              <Download size={19} color={colors.textPrimary} strokeWidth={2} />
              <Text style={[styles.itemText, { color: colors.textPrimary }]}>{t("thesis.export")}</Text>
            </Pressable>
            <Pressable onPress={doDelete} style={styles.item}>
              <Trash2 size={19} color={colors.semanticError} strokeWidth={2} />
              <Text style={[styles.itemText, { color: colors.semanticError }]}>{t("thesis.delete")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* rename modal */}
      <Modal transparent visible={renameOpen} animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <View style={styles.centerBackdrop}>
          <View style={[styles.dialog, { backgroundColor: colors.bgModal }]}>
            <Text style={[styles.dialogTitle, { color: colors.textPrimary }]}>{t("thesis.renameTitle")}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              style={[
                styles.input,
                {
                  backgroundColor: colors.bgInput,
                  color: colors.textPrimary,
                  borderColor: colors.borderDefault,
                  textAlign: nameRtl ? "right" : "left",
                  writingDirection: nameRtl ? "rtl" : "ltr",
                },
              ]}
              placeholderTextColor={colors.textPlaceholder}
            />
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setRenameOpen(false)} style={styles.dialogBtn}>
                <Text style={[styles.dialogBtnText, { color: colors.textSecondary }]}>
                  {t("thesis.renameCancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={saveRename}
                disabled={busy}
                style={[styles.dialogBtn, { backgroundColor: colors.brandPrimary }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={[styles.dialogBtnText, { color: "#FFFFFF" }]}>{t("thesis.renameSave")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  kebab: { width: 40, alignItems: "flex-end" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { padding: 16, paddingBottom: 32, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 4 },
  sheetTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginLeft: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
  itemText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  centerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  dialog: { width: "100%", borderRadius: 18, padding: 20, gap: 16 },
  dialogTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_500Medium" },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  dialogBtn: { minWidth: 84, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  dialogBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
