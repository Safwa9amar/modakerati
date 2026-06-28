import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useCombineStore } from "@/stores/combine-store";
import { useThesisStore } from "@/stores/thesis-store";
import { BackButton } from "@/components/BackButton";
import { ChevronUp, ChevronDown, X } from "lucide-react-native";

export default function CombineArrangeScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const parts = useCombineStore((s) => s.parts);
  const status = useCombineStore((s) => s.status);
  const normProfileId = useCombineStore((s) => s.normProfileId);
  const normProfiles = useThesisStore((s) => s.normProfiles);

  useEffect(() => {
    useThesisStore.getState().loadNormProfiles();
  }, []);

  const canCombine = parts.length >= 2 && status !== "combining";
  const isBusy = status === "classifying" || status === "uploading";

  const onCombine = async () => {
    const result = await useCombineStore.getState().combine();
    if (result === "ok") {
      const thesis = useCombineStore.getState().thesis;
      if (thesis) {
        useThesisStore.getState().upsertThesis(thesis);
        useThesisStore.getState().setCurrentThesis(thesis.id);
        router.replace("/(app)/thesis-workspace");
      }
    } else {
      Alert.alert(t("combine.action"), useCombineStore.getState().errorMessage || "Failed");
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{t("combine.arrangeTitle")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isBusy ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={[styles.subtle, { color: colors.textSecondary }]}>{t("combine.classifying")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("combine.arrangeSubtitle")}</Text>

          {parts.map((p, i) => (
            <View
              key={p.id}
              style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
            >
              <View style={styles.rowBetween}>
                <Text style={[styles.role, { color: colors.brandPrimary }]}>{t(`combine.role_${p.role}`)}</Text>
                <View style={styles.actions}>
                  <Pressable
                    disabled={i === 0}
                    hitSlop={8}
                    onPress={() => useCombineStore.getState().reorder(i, i - 1)}
                  >
                    <ChevronUp size={20} color={i === 0 ? colors.borderDefault : colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    disabled={i === parts.length - 1}
                    hitSlop={8}
                    onPress={() => useCombineStore.getState().reorder(i, i + 1)}
                  >
                    <ChevronDown
                      size={20}
                      color={i === parts.length - 1 ? colors.borderDefault : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => useCombineStore.getState().removePart(p.id)}>
                    <X size={20} color={colors.semanticError} />
                  </Pressable>
                </View>
              </View>

              <TextInput
                value={p.title}
                onChangeText={(txt) => useCombineStore.getState().setPartTitle(p.id, txt)}
                placeholder={t("combine.partTitleLabel")}
                placeholderTextColor={colors.textPlaceholder}
                style={[
                  styles.input,
                  { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderSubtle },
                ]}
              />
              <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                {p.filename} · {p.wordCount} · ~{p.pageCount}p
              </Text>
            </View>
          ))}

          <Text style={[styles.label, { color: colors.textPrimary }]}>{t("combine.pickProfile")}</Text>
          <View style={styles.profileWrap}>
            {normProfiles.map((np) => {
              const active = normProfileId === np.id;
              return (
                <Pressable
                  key={np.id}
                  onPress={() => useCombineStore.getState().setNormProfileId(active ? null : np.id)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.brandPrimary : colors.borderDefault,
                      backgroundColor: colors.bgCard,
                    },
                  ]}
                >
                  <Text style={{ color: active ? colors.brandPrimary : colors.textSecondary, fontSize: 13 }}>
                    {np.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            disabled={!canCombine}
            onPress={onCombine}
            style={[styles.cta, { backgroundColor: canCombine ? colors.brandPrimary : colors.borderDefault }]}
          >
            {status === "combining" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>{t("combine.combineButton")}</Text>
            )}
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },
  headerSpacer: { width: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  subtle: { fontSize: 14 },
  subtitle: { fontSize: 14, marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  role: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, fontSize: 16 },
  meta: { fontSize: 12, marginTop: 6 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 8 },
  profileWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
