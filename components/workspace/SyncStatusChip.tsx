import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useNetworkStatus } from "@/lib/network";

// Subtle per-thesis sync status for the workspace header strip. Reflects the
// durable op queue (thesis-doc-store `pending`) and connectivity (the same
// NetInfo signal the global offline banner uses):
//   • offline           → "Offline · saved locally" (edits are queued on-device)
//   • online + pending  → "Syncing…"
//   • online + settled  → "Saved ✓" (flashes for a couple seconds, then hides)
// A small colored dot + label — no icons, so it reads correctly in LTR and RTL.
export function SyncStatusChip({ thesisId }: { thesisId: string }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { isOffline } = useNetworkStatus();
  // Primitive selector (never an object/array literal — see the store note in
  // thesis-workspace): number of queued-but-unconfirmed ops for this thesis.
  const pending = useThesisDocStore((s) => s.pending[thesisId] ?? 0);

  const status: "offline" | "syncing" | "saved" = isOffline
    ? "offline"
    : pending > 0
      ? "syncing"
      : "saved";

  // "Saved ✓" is transient — flash it for a couple seconds after a sync settles,
  // then hide (a persistent "Saved" is noise). Offline / syncing stay pinned.
  // No Date.now() in render: a timer drives visibility.
  const [savedVisible, setSavedVisible] = useState(true);
  useEffect(() => {
    if (status !== "saved") {
      setSavedVisible(true);
      return;
    }
    setSavedVisible(true);
    const id = setTimeout(() => setSavedVisible(false), 2500);
    return () => clearTimeout(id);
  }, [status]);

  if (status === "saved" && !savedVisible) return null;

  const { dot, label } =
    status === "offline"
      ? { dot: colors.semanticWarning, label: t("workspace.syncOffline", { defaultValue: "Offline · saved locally" }) }
      : status === "syncing"
        ? { dot: colors.brandPrimary, label: t("workspace.syncSyncing", { defaultValue: "Syncing…" }) }
        : { dot: colors.semanticSuccess, label: t("workspace.syncSaved", { defaultValue: "Saved ✓" }) };

  return (
    <View style={styles.chip} accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  text: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
