import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useTranslation } from "react-i18next";
import { getProviderHealth, type ProviderHealth } from "@/lib/api";
import { setAIProvider, getAIProvider, type AIProvider } from "@/lib/ai-service";
import { Cloud, Server, Monitor, Check, ChevronDown } from "lucide-react-native";

const PROVIDER_ICONS: Record<string, any> = {
  openrouter: Cloud,
  ollama: Server,
  lmstudio: Monitor,
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "Cloud AI",
  ollama: "Ollama",
  lmstudio: "LM Studio",
};

export function ProviderSelector() {
  const colors = useThemeColors();
  const [visible, setVisible] = useState(false);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const { provider, model } = getAIProvider();
  const [selected, setSelected] = useState<{ provider: AIProvider; model?: string }>({ provider, model });

  async function loadProviders() {
    setLoading(true);
    try {
      const data = await getProviderHealth();
      setProviders(data.providers);
    } catch {
      // Fallback
      setProviders([
        { name: "openrouter", available: true, models: ["anthropic/claude-sonnet-4", "openai/gpt-4o-mini"] },
        { name: "ollama", available: false, models: [] },
        { name: "lmstudio", available: false, models: [] },
      ]);
    }
    setLoading(false);
  }

  function handleSelect(providerName: AIProvider, modelName?: string) {
    setSelected({ provider: providerName, model: modelName });
    setAIProvider(providerName, modelName);
    setVisible(false);
  }

  const Icon = PROVIDER_ICONS[selected.provider] || Cloud;
  const displayModel = selected.model?.split("/").pop() || PROVIDER_LABELS[selected.provider];

  return (
    <>
      {/* Compact chip */}
      <Pressable
        onPress={() => { setVisible(true); loadProviders(); }}
        style={[styles.chip, { backgroundColor: colors.bgSurface }]}
      >
        <Icon size={12} color={colors.brandPrimary} strokeWidth={2} />
        <Text style={[styles.chipText, { color: colors.textSecondary }]} numberOfLines={1}>
          {displayModel}
        </Text>
        <ChevronDown size={10} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>

      {/* Provider modal */}
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={() => setVisible(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.bgModal }]}>
            <View style={styles.handleRow}>
              <View style={[styles.handle, { backgroundColor: colors.textSecondary }]} />
            </View>
            <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Choose AI Provider</Text>

            {loading ? (
              <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 20 }} />
            ) : (
              <ScrollView style={styles.providerList}>
                {providers.map((p) => {
                  const PIcon = PROVIDER_ICONS[p.name] || Cloud;
                  const isAvailable = p.available;
                  const isSelected = selected.provider === p.name;

                  return (
                    <View key={p.name}>
                      {/* Provider header */}
                      <View style={[styles.providerHeader, { opacity: isAvailable ? 1 : 0.4 }]}>
                        <View style={[styles.providerIconBg, { backgroundColor: colors.brandPrimary + "1A" }]}>
                          <PIcon size={18} color={colors.brandPrimary} strokeWidth={2} />
                        </View>
                        <View style={styles.providerInfo}>
                          <Text style={[styles.providerName, { color: colors.textPrimary }]}>
                            {PROVIDER_LABELS[p.name] || p.name}
                          </Text>
                          <Text style={[styles.providerStatus, { color: isAvailable ? colors.brandAccent : colors.semanticError }]}>
                            {isAvailable ? `${p.models.length} models` : "Offline"}
                          </Text>
                        </View>
                      </View>

                      {/* Models */}
                      {isAvailable && p.models.slice(0, 6).map((m) => {
                        const isModelSelected = isSelected && selected.model === m;
                        return (
                          <Pressable
                            key={m}
                            onPress={() => handleSelect(p.name as AIProvider, m)}
                            style={[
                              styles.modelRow,
                              { backgroundColor: isModelSelected ? colors.brandPrimary + "15" : "transparent" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.modelName,
                                { color: isModelSelected ? colors.brandPrimary : colors.textSecondary },
                              ]}
                              numberOfLines={1}
                            >
                              {m}
                            </Text>
                            {isModelSelected && <Check size={16} color={colors.brandPrimary} strokeWidth={2.5} />}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
                <View style={{ height: 40 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    maxWidth: 160,
  },
  chipText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "70%", paddingBottom: 32 },
  handleRow: { alignItems: "center", paddingVertical: 12 },
  handle: { width: 40, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", paddingHorizontal: 20, marginBottom: 16 },
  providerList: { paddingHorizontal: 20 },
  providerHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, marginBottom: 8 },
  providerIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  providerStatus: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginLeft: 48,
    borderRadius: 10,
    marginBottom: 2,
  },
  modelName: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
});
