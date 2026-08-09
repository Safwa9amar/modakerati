import {
  View,
  Text,
  TextInput,
  Pressable,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  BackHandler,
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
import { ProcessingSteps, type ProcessingStep } from "@/components/ProcessingSteps";
import { GripVertical, ChevronUp, ChevronDown, X, Sparkles, Check } from "lucide-react-native";

/** A square that fills with a check when on — the app has no checkbox of its own. */
function CheckBox({ on }: { on: boolean }) {
  const colors = useThemeColors();
  return (
    <View
      style={[
        styles.checkbox,
        on
          ? { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }
          : { borderColor: colors.borderDefault },
      ]}
    >
      {on && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
    </View>
  );
}

// One reorderable part card. Long-press the grip handle to drag; the up/down
// chevrons remain for precise, accessible reordering.
function PartItem({ part, index, total }: { part: CombinePart; index: number; total: number }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const drag = useReorderableDrag();
  const continues = index > 0 && part.continuesPrevious;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.bgCard, borderColor: colors.borderDefault },
        // A continuation is visually subordinate to the part it belongs to.
        continues && { marginLeft: 20, borderStyle: "dashed" },
      ]}
    >
      <View style={styles.rowBetween}>
        <Text style={[styles.role, { color: continues ? colors.textSecondary : colors.brandPrimary }]}>
          {continues ? t("combine.continuesRole") : t(`combine.role_${part.role}`)}
        </Text>
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

      {/* A continuation prints no title of its own — it flows into the part
          above — so the field would be a lie. */}
      {!continues && (
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
      )}
      <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
        {part.filename} · {part.wordCount} · ~{part.pageCount}p
      </Text>

      {/* One section split across two files — the second gets no heading, no
          divider page and no section break of its own. */}
      {index > 0 && (
        <Pressable
          onPress={() => useCombineStore.getState().toggleContinuesPrevious(part.id)}
          style={styles.checkRow}
          hitSlop={6}
        >
          <CheckBox on={!!part.continuesPrevious} />
          <Text style={[styles.checkLabel, { color: colors.textSecondary }]}>
            {t("combine.continuesPrevious")}
          </Text>
        </Pressable>
      )}
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
  const readDone = useCombineStore((s) => s.readDone);
  const readTotal = useCombineStore((s) => s.readTotal);
  const totalBytes = useCombineStore((s) => s.totalBytes);
  const uploadProgress = useCombineStore((s) => s.uploadProgress);
  const classifiedBy = useCombineStore((s) => s.classifiedBy);
  const classifyReason = useCombineStore((s) => s.classifyReason);
  const fullSetup = useCombineStore((s) => s.fullSetup);
  const errorMessage = useCombineStore((s) => s.errorMessage);
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
  // Reading + classifying (we land here straight from the picker) and the merge
  // itself. Both own the whole screen: there is nothing to arrange until the
  // parts exist, and nothing to change once the merge is in flight.
  const isPreparing = status === "picking" || status === "uploading" || status === "classifying";
  const isCombining = status === "combining";
  const isBusy = isPreparing || isCombining;
  // Classification failed before any part landed — the arrange list would be an
  // empty page with a Combine button, so say what happened instead.
  const failedEmpty = status === "error" && parts.length === 0;
  // The model didn't produce the names. They decide the chapter headings, the
  // divider pages and the running headers, so the flow waits here.
  const aiFailed = !isBusy && !failedEmpty && classifiedBy === "heuristic" && parts.length > 0;

  // A job that writes a thesis server-side can't be taken back by leaving the
  // screen, so Android's hardware back is swallowed for as long as one runs.
  useEffect(() => {
    if (!isBusy) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [isBusy]);

  const onReorder = ({ from, to }: ReorderableListReorderEvent) => {
    useCombineStore.getState().reorder(from, to);
  };

  const megabytes = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : null;

  // Two real client-side stages: the local base64 read (countable, one tick per
  // file) and the server's classify call (opaque, so it just spins).
  const prepareSteps: ProcessingStep[] = [
    {
      key: "read",
      label: t("combine.stepUpload"),
      status: status === "classifying" ? "done" : "active",
      detail: readTotal > 0 ? `${Math.min(readDone, readTotal)} / ${readTotal}` : undefined,
      progress: readTotal > 0 ? readDone / readTotal : 0,
    },
    {
      key: "classify",
      label: t("combine.stepRead"),
      status: status === "classifying" ? "active" : "pending",
    },
  ];

  // The merge is ONE server call with no progress frames, so these rows describe
  // the work rather than claiming to tick through it (mode="list").
  const combineSteps: ProcessingStep[] = [
    {
      // Measured: the request's own progress events. Everything after it is the
      // server working, which the client cannot see into.
      key: "send",
      label: t("combine.stepSend"),
      status: uploadProgress >= 1 ? "done" : "active",
      detail: uploadProgress > 0 && uploadProgress < 1 ? `${Math.round(uploadProgress * 100)}%` : undefined,
      progress: uploadProgress > 0 ? uploadProgress : undefined,
    },
    { key: "merge", label: t("combine.stepMerge"), status: "active" },
    // Only the full setup restyles and decorates; plain mode just joins.
    ...(fullSetup
      ? [
          { key: "headings", label: t("combine.stepHeadings"), status: "active" as const },
          { key: "normalize", label: t("combine.stepNormalize"), status: "active" as const },
        ]
      : [{ key: "sections", label: t("combine.stepSections"), status: "active" as const }]),
    { key: "analyze", label: t("combine.stepAnalyze"), status: "active" },
  ];

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

      {/* The student's call: a thesis rebuilt with our tools, or their own files
          joined and otherwise untouched. */}
      <Pressable
        onPress={() => useCombineStore.getState().setFullSetup(!fullSetup)}
        style={[
          styles.modeBox,
          {
            backgroundColor: colors.bgCard,
            borderColor: fullSetup ? colors.brandPrimary : colors.borderDefault,
          },
        ]}
      >
        <CheckBox on={fullSetup} />
        <View style={styles.modeText}>
          <Text style={[styles.modeTitle, { color: colors.textPrimary }]}>
            {t("combine.fullSetupLabel")}
          </Text>
          <Text style={[styles.willDo, { color: colors.textSecondary }]}>
            {fullSetup ? t("combine.fullSetupOn") : t("combine.fullSetupOff")}
          </Text>
        </View>
      </Pressable>

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
        {/* No way back out of a running job — the merge is already writing a
            thesis on the server, and the picker's files only live in this store. */}
        {isBusy ? <View style={styles.headerSpacer} /> : <BackButton />}
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {isCombining ? t("combine.action") : t("combine.arrangeTitle")}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {isBusy ? (
        <ScrollView contentContainerStyle={styles.busyContent} showsVerticalScrollIndicator={false}>
          {isCombining ? (
            <ProcessingSteps
              mode="list"
              title={t("combine.combiningTitle")}
              subtitle={[
                title.trim() ? `“${title.trim()}”` : null,
                t("combine.partsCount", { n: parts.length }),
              ]
                .filter(Boolean)
                .join(" · ")}
              steps={combineSteps}
              note={t("combine.keepOpen")}
              liveness={`${status}:${Math.round(uploadProgress * 100)}`}
            />
          ) : (
            <ProcessingSteps
              title={t("combine.preparingTitle")}
              subtitle={
                readTotal > 0
                  ? megabytes
                    ? `${t("combine.filesCount", { n: readTotal })} · ${megabytes} MB`
                    : t("combine.filesCount", { n: readTotal })
                  : null
              }
              steps={prepareSteps}
              liveness={`${status}:${readDone}`}
            />
          )}
        </ScrollView>
      ) : aiFailed ? (
        // The AI did not name these parts, and the names decide the chapter
        // headings, the divider pages and the running headers. Stop here and let
        // the student choose, rather than quietly shipping a guess.
        <ScrollView contentContainerStyle={styles.busyContent} showsVerticalScrollIndicator={false}>
          <View style={styles.aiFailWrap}>
            <View style={[styles.iconCircle, { backgroundColor: colors.bgSurface }]}>
              <Sparkles size={26} color={colors.textSecondary} />
            </View>
            <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>
              {t("combine.aiFailedTitle")}
            </Text>
            <Text style={[styles.subtle, { color: colors.textSecondary, textAlign: "center" }]}>
              {t(`combine.aiFailed_${classifyReason ?? "error"}`, {
                defaultValue: t("combine.heuristicNotice"),
              })}
            </Text>

            <Pressable
              onPress={() => useCombineStore.getState().reclassify()}
              style={[styles.retry, { backgroundColor: colors.brandPrimary }]}
            >
              <Text style={styles.ctaText}>{t("combine.tryAiAgain")}</Text>
            </Pressable>
            <Pressable
              onPress={() => useCombineStore.getState().acceptHeuristicNames()}
              style={styles.secondaryBtn}
            >
              <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>
                {t("combine.continueWithoutAi")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : failedEmpty ? (
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>
            {t("combine.failedTitle")}
          </Text>
          <Text style={[styles.subtle, { color: colors.textSecondary, textAlign: "center" }]}>
            {errorMessage || t("thesis.genericError")}
          </Text>
          <Pressable
            onPress={() => useCombineStore.getState().pickAndClassify()}
            style={[styles.retry, { backgroundColor: colors.brandPrimary }]}
          >
            <Text style={styles.ctaText}>{t("common.retry")}</Text>
          </Pressable>
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
              <View>
                <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                  {t("combine.arrangeSubtitle")}
                </Text>
              </View>
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
  // flexGrow, not flex: the processing view must be free to outgrow a small
  // screen and scroll rather than being clipped to the viewport.
  busyContent: { flexGrow: 1 },
  titleWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },
  headerSpacer: { width: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  subtle: { fontSize: 14 },
  errorTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  retry: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 8 },
  aiFailWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  secondaryBtn: { paddingVertical: 12, paddingHorizontal: 20 },
  secondaryText: { fontSize: 14, fontFamily: "Inter_500Medium", textDecorationLine: "underline" },
  subtitle: { fontSize: 14, marginBottom: 16 },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  role: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", flex: 1 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, fontSize: 16 },
  meta: { fontSize: 12, marginTop: 6 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 8 },
  profileWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  willDo: { fontSize: 12, lineHeight: 17 },
  modeBox: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  modeText: { flex: 1, gap: 4 },
  modeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  checkLabel: { flex: 1, fontSize: 12 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  cta: { borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
