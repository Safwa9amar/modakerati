import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { BottomSheetModal, BottomSheetFlatList, BottomSheetBackdrop, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Bot, User, FileInput, RotateCcw, PenLine } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { getThesisHistory, restoreThesisHistory, type HistoryEntryDTO } from "@/lib/api";

interface Props {
  thesisId: string;
  onClose: () => void;
}

const SOURCE_ICON = { ai: Bot, manual: User, onlyoffice: PenLine, restore: RotateCcw, import: FileInput } as const;

function relativeTime(iso: string | null, t: TFunction): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t("history.justNow", { defaultValue: "just now" });
  if (mins < 60) return t("history.minsAgo", { count: mins, defaultValue: `${mins} min ago` });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("history.hoursAgo", { count: hours, defaultValue: `${hours} h ago` });
  return new Date(iso).toLocaleDateString();
}

/**
 * Recent document states (the undo ring buffer), newest first. Tapping Restore
 * confirms, then rolls the working .docx back to that snapshot — itself undoable
 * (the server snapshots the current state before restoring).
 */
export function HistorySheet({ thesisId, onClose }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const ref = useRef<BottomSheetModal>(null);
  const [entries, setEntries] = useState<HistoryEntryDTO[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.present());
    getThesisHistory(thesisId)
      .then((h) => setEntries(h.entries))
      .catch(() => setEntries([]));
    return () => cancelAnimationFrame(id);
  }, [thesisId]);

  const restore = (entry: HistoryEntryDTO) => {
    Alert.alert(
      t("history.restoreTitle", { defaultValue: "Restore this version?" }),
      t("history.restoreBody", { defaultValue: "The document will roll back to this state. You can undo the restore afterwards." }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        {
          text: t("history.restore", { defaultValue: "Restore" }),
          style: "destructive",
          onPress: () => {
            setBusy(true);
            restoreThesisHistory(thesisId, entry.seq)
              .then((res) => {
                useThesisDocStore.getState().applyRestoredDoc(thesisId, res.document, { canUndo: res.canUndo, canRedo: res.canRedo });
                ref.current?.dismiss();
              })
              .catch((e: any) => Alert.alert(t("workspace.historyFailed", { defaultValue: "Couldn't restore the document" }), e?.message ?? ""))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={["60%"]}
      enableDynamicSizing={false}
      onDismiss={onClose}
      backdropComponent={(props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
      )}
      backgroundStyle={{ backgroundColor: colors.bgModal }}
      handleIndicatorStyle={{ backgroundColor: colors.borderDefault }}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("history.title", { defaultValue: "Document history" })}
        </Text>
      </View>
      {entries === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.brandPrimary} />
      ) : entries.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textPlaceholder }]}>
          {t("history.empty", { defaultValue: "No earlier versions yet — they appear as you edit." })}
        </Text>
      ) : (
        <BottomSheetFlatList
          data={entries}
          keyExtractor={(e: HistoryEntryDTO) => String(e.seq)}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: HistoryEntryDTO }) => {
            const Icon = SOURCE_ICON[item.source] ?? User;
            return (
              <View style={[styles.row, { borderColor: colors.borderDefault }]}>
                <Icon size={16} color={colors.textPlaceholder} />
                <View style={styles.rowBody}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                    {item.label || t(`history.source.${item.source}`, { defaultValue: item.source })}
                  </Text>
                  <Text style={[styles.rowTime, { color: colors.textPlaceholder }]}>
                    {relativeTime(item.createdAt, t)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => restore(item)}
                  disabled={busy}
                  style={[styles.restoreBtn, { borderColor: colors.brandPrimary + "55" }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.restoreText, { color: colors.brandPrimary }]}>
                    {t("history.restore", { defaultValue: "Restore" })}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  spinner: { marginTop: 32 },
  empty: { marginTop: 32, textAlign: "center", fontSize: 14, fontFamily: "Inter_400Regular", paddingHorizontal: 32 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  rowTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  restoreBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 },
  restoreText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
