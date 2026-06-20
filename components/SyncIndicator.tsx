import { View, Text, StyleSheet } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useOfflineStore } from "@/stores/offline-store";
import { useNetworkStatus } from "@/lib/network";
import { Cloud, CloudOff, RefreshCw } from "lucide-react-native";

export function SyncIndicator() {
  const colors = useThemeColors();
  const { isOffline } = useNetworkStatus();
  const pendingCount = useOfflineStore((s) => s.pendingActions.length);
  const lastSynced = useOfflineStore((s) => s.lastSyncedAt);

  if (isOffline && pendingCount > 0) {
    return (
      <View style={[styles.indicator, { backgroundColor: colors.semanticWarning + "20" }]}>
        <CloudOff size={12} color={colors.semanticWarning} strokeWidth={2} />
        <Text style={[styles.text, { color: colors.semanticWarning }]}>{pendingCount} pending</Text>
      </View>
    );
  }

  if (!isOffline && pendingCount > 0) {
    return (
      <View style={[styles.indicator, { backgroundColor: colors.brandPrimary + "20" }]}>
        <RefreshCw size={12} color={colors.brandPrimary} strokeWidth={2} />
        <Text style={[styles.text, { color: colors.brandPrimary }]}>Syncing...</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  indicator: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  text: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
