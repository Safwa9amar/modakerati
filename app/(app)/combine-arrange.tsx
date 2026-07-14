import {
  View,
  Text,
  TextInput,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import ReorderableList, {
  type ReorderableListReorderEvent,
  useReorderableDrag,
} from "react-native-reorderable-list";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useCombineStore, type CombinePart } from "@/stores/combine-store";
import { useThesisStore } from "@/stores/thesis-store";
import { BackButton } from "@/components/BackButton";
import { GripVertical, ChevronUp, ChevronDown, X } from "lucide-react-native";

// One reorderable part card. Long-press the grip handle to drag; the up/down
// chevrons remain for precise, accessible reordering.
function PartItem({ part, index, total }: { part: CombinePart; index: number; total: number }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const drag = useReorderableDrag();

  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
      <View style={styles.rowBetween}>
        <Text style={[styles.role, { color: colors.brandPrimary }]}>{t(`combine.role_${part.role}`)}</Text>
        <View style={styles.actions}>
          <Pressable onLongPress={drag} delayLongPress={150} hitSlop={8}>
            <GripVertical size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            disabled={index === 0}
            hitSlop={8}
            onPress={() => useCombineStore.getState().reorder(index, index - 1)}
          >
            <ChevronUp size={20} color={index === 0 ? colors.borderDefault : colors.textSecondary} />
          </Pressable>
          <Pressable
            disabled={index === total - 1}
            hitSlop={8}
            onPress={() => useCombineStore.getState().reorder(index, index + 1)}
          >
            <ChevronDown size={20} color={index === total - 1 ? colors.borderDefault : colors.textSecondary} />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => useCombineStore.getState().removePart(part.id)}>
            <X size={20} color={colors.semanticError} />
          </Pressable>
        </View>
      </View>

      <TextInput
        value={part.title}
        onChangeText={(txt) => useCombineStore.getState().setPartTitle(part.id, txt)}
        placeholder={t("combine.partTitleLabel")}
        placeholderTextColor={colors.textPlaceholder}
        style={[
          styles.input,
          { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderSubtle },
        ]}
      />
      <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
        {part.filename} · {part.wordCount} · ~{part.pageCount}p
      </Text>
    </View>
  );
}

export default function CombineArrangeScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const parts = useCombineStore((s) => s.parts);
  const status = useCombineStore((s) => s.status);
  const title = useCombineStore((s) => s.title);
  const normProfileId = useCombineStore((s) => s.normProfileId);
  const normProfiles = useThesisStore((s) => s.normProfiles);

  useEffect(() => {
    useThesisStore.getState().loadNormProfiles();
    // Seed a sensible default document title (becomes the cover title) if unset.
    if (!useCombineStore.getState().title.trim()) {
      useCombineStore.getState().setTitle(t("combine.defaultTitle"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCombine = parts.length >= 2 && status !== "combining";
  const isBusy = status === "classifying" || status === "uploading";

  const onReorder = ({ from, to }: ReorderableListReorderEvent) => {
    useCombineStore.getState().reorder(from, to);
  };

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

  const Footer = (
    <View>
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
                { borderColor: active ? colors.brandPrimary : colors.borderDefault, backgroundColor: colors.bgCard },
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
    </View>
  );

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
        <View style={styles.fill}>
          <View style={styles.titleWrap}>
            <Text style={[styles.label, { color: colors.textPrimary, marginTop: 0 }]}>
              {t("combine.docTitleLabel")}
            </Text>
            <TextInput
              value={title}
              onChangeText={(txt) => useCombineStore.getState().setTitle(txt)}
              placeholder={t("combine.defaultTitle")}
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.input,
                { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderSubtle, marginTop: 6 },
              ]}
            />
          </View>
          <ReorderableList
            data={parts}
            keyExtractor={(item) => item.id}
            onReorder={onReorder}
            renderItem={({ item, index }) => <PartItem part={item} index={index} total={parts.length} />}
            ListHeaderComponent={
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("combine.arrangeSubtitle")}</Text>
            }
            ListFooterComponent={Footer}
            contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  titleWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },
  headerSpacer: { width: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  subtle: { fontSize: 14 },
  subtitle: { fontSize: 14, marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  role: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", flex: 1 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, fontSize: 16 },
  meta: { fontSize: 12, marginTop: 6 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 8 },
  profileWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
