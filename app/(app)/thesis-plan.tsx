import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomInset } from "@/hooks/useBottomInset";
import { useThesisStore } from "@/stores/thesis-store";
import {
  useThesisWizard,
  type WizardPlanSection,
} from "@/stores/thesis-wizard-store";
import { useBillingStore } from "@/stores/billing-store";
import { generateThesisPlan, streamThesisPlan, createThesis, getThesis } from "@/lib/api";
import { isThesisLimitError } from "@/types/billing";
import { rememberThesisLimit, showThesisLimitAlert } from "@/lib/thesis-limit";
import { userFacingError } from "@/lib/safe-error";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react-native";

const LOGO = require("../../assets/icon.png");

const KIND_LABELS: Record<WizardPlanSection["kind"], string> = {
  introduction: "Introduction",
  section: "Partie",
  conclusion: "Conclusion",
};

export default function ThesisPlanScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const bottomInset = useBottomInset(30);
  const router = useRouter();

  const { plan, title, language, templateId, brief } = useThesisWizard();

  // The local copy is the editing surface; the wizard store is kept in sync.
  const [localPlan, setLocalPlan] = useState<WizardPlanSection[]>(plan ?? []);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  // Drives the narrated steps on the generating screen. The model streams without
  // per-phase events, so we advance on a short timer: 0=reading, 1=structure, 2=drafting.
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!generating) return;
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), 700);
    const t2 = setTimeout(() => setPhase(2), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [generating]);

  // If we arrived without a plan (e.g. plan generation failed upstream), kick
  // off generation on mount and show a centered loader.
  useEffect(() => {
    if (plan && plan.length > 0) return;
    let active = true;
    const controller = new AbortController();
    setGenerating(true);
    setLocalPlan([]);
    (async () => {
      const streamed: WizardPlanSection[] = [];
      try {
        await streamThesisPlan(
          { title, language, templateId: templateId ?? undefined, brief },
          (section) => {
            if (!active) return;
            streamed.push(section as WizardPlanSection);
            setLocalPlan((prev) => [...prev, section as WizardPlanSection]);
          },
          controller.signal,
        );
        if (active && streamed.length > 0) useThesisWizard.getState().set({ plan: streamed });
      } catch {
        // Streaming unavailable → one-shot fallback so a plan still appears.
        try {
          const { sections } = await generateThesisPlan({ title, language, templateId: templateId ?? undefined, brief });
          if (!active) return;
          setLocalPlan(sections);
          useThesisWizard.getState().set({ plan: sections });
        } catch (e) {
          if (active) Alert.alert(t("common.error", { defaultValue: "Error" }), userFacingError(e));
        }
      } finally {
        if (active) setGenerating(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every edit into local state immutably and mirror into the wizard.
  const applyPlan = (next: WizardPlanSection[]) => {
    setLocalPlan(next);
    useThesisWizard.getState().set({ plan: next });
  };

  const setSectionTitle = (si: number, value: string) => {
    applyPlan(
      localPlan.map((s, i) => (i === si ? { ...s, title: value } : s))
    );
  };

  const moveSection = (si: number, dir: -1 | 1) => {
    const target = si + dir;
    if (target < 0 || target >= localPlan.length) return;
    const next = [...localPlan];
    [next[si], next[target]] = [next[target], next[si]];
    applyPlan(next);
  };

  const deleteSection = (si: number) => {
    applyPlan(localPlan.filter((_, i) => i !== si));
  };

  const addSection = () => {
    applyPlan([
      ...localPlan,
      { title: "", kind: "section", chapters: [] },
    ]);
  };

  const setChapterTitle = (si: number, ci: number, value: string) => {
    applyPlan(
      localPlan.map((s, i) =>
        i === si
          ? {
              ...s,
              chapters: s.chapters.map((c, j) =>
                j === ci ? { ...c, title: value } : c
              ),
            }
          : s
      )
    );
  };

  const deleteChapter = (si: number, ci: number) => {
    applyPlan(
      localPlan.map((s, i) =>
        i === si
          ? { ...s, chapters: s.chapters.filter((_, j) => j !== ci) }
          : s
      )
    );
  };

  const addChapter = (si: number) => {
    applyPlan(
      localPlan.map((s, i) =>
        i === si ? { ...s, chapters: [...s.chapters, { title: "" }] } : s
      )
    );
  };

  const handleRegenerate = async () => {
    if (generating || creating) return;
    setGenerating(true);
    try {
      const { sections } = await generateThesisPlan({ title, language });
      setLocalPlan(sections);
      useThesisWizard.getState().set({ plan: sections });
    } catch (e) {
      Alert.alert(
        t("common.error", { defaultValue: "Error" }),
        userFacingError(e)
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (creating || generating) return;
    // Require at least one section with a non-empty title.
    const hasValid = localPlan.some((s) => s.title.trim().length > 0);
    if (localPlan.length === 0 || !hasValid) {
      Alert.alert(
        t("wizard.planTitle", { defaultValue: "Your plan" }),
        t("wizard.planEmpty", {
          defaultValue: "Add at least one part with a title before creating.",
        })
      );
      return;
    }
    setCreating(true);
    try {
      const wiz = useThesisWizard.getState();
      const hasBrief = Object.values(wiz.brief).some((v) => v && v.trim());
      const frontMatter: Record<string, unknown> = { ...wiz.fieldValues };
      if (hasBrief) frontMatter.brief = wiz.brief;
      const created = await createThesis({
        title,
        templateId: templateId ?? undefined,
        language,
        normProfileId: wiz.normProfileId || undefined,
        frontMatter: Object.keys(frontMatter).length ? frontMatter : undefined,
        sections: localPlan.map((s) => ({
          title: s.title || "Partie",
          kind: s.kind,
          chapters: s.chapters.map((c) => ({ title: c.title || "Chapitre", content: c.content })),
        })),
      });
      const full = await getThesis(created.id);
      useThesisStore.getState().upsertThesis(full);
      useThesisStore.getState().setCurrentThesis(full.id);
      // Count it locally so the next tap on "new thesis" is answered by the
      // starting-point screen instead of by a 402 at the end of another wizard.
      useBillingStore.getState().noteThesisCreated();
      useThesisWizard.getState().reset();
      router.replace({
        pathname: "/(app)/thesis-workspace",
        params: { thesisId: full.id },
      });
    } catch (e) {
      // The plan's thesis ceiling. The starting-point screen normally catches
      // this before a single question is answered; reaching it here means the
      // count moved underneath the student (another device, another tab), so it
      // gets the same wording rather than "Error: <arabic sentence>".
      if (isThesisLimitError(e)) {
        rememberThesisLimit(e);
        showThesisLimitAlert(e);
        return;
      }
      Alert.alert(
        t("common.error", { defaultValue: "Error" }),
        userFacingError(e)
      );
    } finally {
      setCreating(false);
    }
  };

  // Rich generating screen: context header + narrated steps + the outline
  // streaming in. Shown for the whole stream; flips to the editable list on done.
  if (generating) {
    const methodologyLabel = brief.methodology
      ? t(`wizard.topic.method.${brief.methodology}`)
      : null;
    const keywordCount = brief.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean).length;
    const stepStatus = (i: number): "done" | "active" | "pending" => {
      if (i === 0) return phase >= 1 ? "done" : "active";
      if (i === 1) return phase >= 2 ? "done" : phase === 1 ? "active" : "pending";
      if (i === 2) return phase >= 2 ? "active" : "pending";
      return "pending";
    };
    const STEP_KEYS = ["stepReading", "stepStructure", "stepDrafting", "stepFinalizing"] as const;
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bgPrimary }]}
        edges={["top"]}
      >
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
            {t("wizard.planTitle", { defaultValue: "Your plan" })}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.genContent} showsVerticalScrollIndicator={false}>
          <View style={styles.genHero}>
            <Image source={LOGO} style={styles.genLogo} resizeMode="contain" />
            <Text style={[styles.genTitle, { color: colors.textPrimary }]}>
              {t("wizard.gen.building", { defaultValue: "Building your plan" })}
            </Text>
            {!!title && (
              <Text style={[styles.genSubj, { color: colors.textSecondary }]} numberOfLines={2}>
                {`“${title}”`}
              </Text>
            )}
            {(methodologyLabel || keywordCount > 0) && (
              <View style={styles.genMeta}>
                {methodologyLabel && (
                  <View style={[styles.genPill, { backgroundColor: colors.brandPrimary + "18" }]}>
                    <Text style={[styles.genPillText, { color: colors.brandPrimary }]}>{methodologyLabel}</Text>
                  </View>
                )}
                {keywordCount > 0 && (
                  <Text style={[styles.genKw, { color: colors.textSecondary }]}>
                    {t("wizard.gen.keywords", { count: keywordCount, defaultValue: `${keywordCount} keywords` })}
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={[styles.genRule, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.genSteps}>
            {STEP_KEYS.map((key, i) => {
              const status = stepStatus(i);
              return (
                <View key={key} style={styles.genStep}>
                  <View style={styles.genIcWrap}>
                    {status === "done" ? (
                      <View style={[styles.genIc, { backgroundColor: "#22B573" }]}>
                        <Text style={styles.genIcCheck}>✓</Text>
                      </View>
                    ) : status === "active" ? (
                      <ActivityIndicator size="small" color={colors.brandPrimary} />
                    ) : (
                      <View style={[styles.genIc, styles.genIcPending, { borderColor: colors.borderDefault }]} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.genStepLbl,
                      {
                        color: status === "pending" ? colors.textPlaceholder : colors.textPrimary,
                        fontFamily: status === "active" ? "Inter_600SemiBold" : "Inter_400Regular",
                      },
                    ]}
                  >
                    {t(`wizard.gen.${key}`)}
                  </Text>
                </View>
              );
            })}
          </View>

          {localPlan.length > 0 && (
            <>
              <View style={[styles.genRule, { backgroundColor: colors.borderSubtle }]} />
              <Text style={[styles.genLabelSm, { color: colors.textSecondary }]}>
                {t("wizard.gen.outlineSoFar", { defaultValue: "Outline so far" })}
              </Text>
              <View style={styles.genOutline}>
                {localPlan.map((s, i) => (
                  <View key={i} style={[styles.genSec, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}>
                    <View style={[styles.genDot, { backgroundColor: colors.brandPrimary }]} />
                    <Text style={[styles.genSecText, { color: colors.textPrimary }]} numberOfLines={1}>{s.title}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={[styles.genCaption, { color: colors.textPlaceholder }]}>
            {t("wizard.gen.caption", { defaultValue: "This can take up to a minute — you can edit everything next." })}
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text
          style={[styles.topTitle, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {t("wizard.planTitle", { defaultValue: "Your plan" })}
        </Text>
        <Pressable
          onPress={handleRegenerate}
          disabled={generating || creating}
          style={styles.regenerateBtn}
          hitSlop={8}
        >
          {generating ? (
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          ) : (
            <Text
              style={[styles.regenerateText, { color: colors.brandPrimary }]}
            >
              {t("wizard.regenerate", { defaultValue: "Regenerate" })}
            </Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t("wizard.planSubtitle", {
            defaultValue:
              "Review and adjust the outline. The AI drafts; you decide.",
          })}
        </Text>

        {localPlan.map((section, si) => (
          <Card key={si} style={styles.sectionCard}>
            {/* Section header: kind badge + move/delete controls */}
            <View style={styles.sectionHeader}>
              <View
                style={[
                  styles.kindBadge,
                  { backgroundColor: colors.brandPrimary + "18" },
                ]}
              >
                <Text style={[styles.kindText, { color: colors.brandPrimary }]}>
                  {KIND_LABELS[section.kind]}
                </Text>
              </View>
              <View style={styles.sectionControls}>
                <Pressable
                  onPress={() => moveSection(si, -1)}
                  disabled={si === 0}
                  hitSlop={8}
                  style={styles.iconBtn}
                >
                  <ChevronUp
                    size={18}
                    color={si === 0 ? colors.textPlaceholder : colors.textSecondary}
                    strokeWidth={2}
                  />
                </Pressable>
                <Pressable
                  onPress={() => moveSection(si, 1)}
                  disabled={si === localPlan.length - 1}
                  hitSlop={8}
                  style={styles.iconBtn}
                >
                  <ChevronDown
                    size={18}
                    color={
                      si === localPlan.length - 1
                        ? colors.textPlaceholder
                        : colors.textSecondary
                    }
                    strokeWidth={2}
                  />
                </Pressable>
                <Pressable
                  onPress={() => deleteSection(si)}
                  hitSlop={8}
                  style={styles.iconBtn}
                >
                  <Trash2 size={16} color={colors.semanticError} strokeWidth={2} />
                </Pressable>
              </View>
            </View>

            {/* Section title (styled like a heading) */}
            <TextInput
              value={section.title}
              onChangeText={(v) => setSectionTitle(si, v)}
              placeholder={t("wizard.partPlaceholder", {
                defaultValue: "Part title",
              })}
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.sectionTitleInput,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.bgSurface,
                  borderColor: colors.borderSubtle,
                },
              ]}
              multiline
            />

            {/* Chapters (Chapitres) */}
            {section.chapters.map((chapter, ci) => (
              <View key={ci} style={styles.chapterRow}>
                <View
                  style={[
                    styles.chapterDot,
                    { backgroundColor: colors.brandPrimary },
                  ]}
                />
                <TextInput
                  value={chapter.title}
                  onChangeText={(v) => setChapterTitle(si, ci, v)}
                  placeholder={t("wizard.chapterPlaceholder", {
                    defaultValue: "Chapter title",
                  })}
                  placeholderTextColor={colors.textPlaceholder}
                  style={[
                    styles.chapterInput,
                    {
                      color: colors.textPrimary,
                      backgroundColor: colors.bgSurface,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                  multiline
                />
                <Pressable
                  onPress={() => deleteChapter(si, ci)}
                  hitSlop={8}
                  style={styles.iconBtn}
                >
                  <Trash2 size={15} color={colors.semanticError} strokeWidth={2} />
                </Pressable>
              </View>
            ))}

            <Pressable
              onPress={() => addChapter(si)}
              style={[
                styles.addChapterBtn,
                { backgroundColor: colors.brandPrimary + "12" },
              ]}
            >
              <Plus size={14} color={colors.brandPrimary} strokeWidth={2.5} />
              <Text
                style={[styles.addChapterText, { color: colors.brandPrimary }]}
              >
                {t("wizard.addChapter", { defaultValue: "Add chapter" })}
              </Text>
            </Pressable>
          </Card>
        ))}

        {/* Add part */}
        <Pressable
          onPress={addSection}
          style={[
            styles.addSectionBtn,
            { borderColor: colors.borderDefault },
          ]}
        >
          <Plus size={16} color={colors.brandPrimary} strokeWidth={2.5} />
          <Text style={[styles.addSectionText, { color: colors.brandPrimary }]}>
            {t("wizard.addSection", { defaultValue: "Add part" })}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Sticky footer: Create */}
      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <Pressable
          onPress={handleCreate}
          disabled={creating || generating}
          style={[
            styles.createBtn,
            {
              backgroundColor: colors.brandPrimary,
              opacity: creating || generating ? 0.6 : 1,
            },
          ]}
        >
          {creating ? (
            <View style={styles.createInner}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.createText}>
                {t("wizard.creating", { defaultValue: "Creating…" })}
              </Text>
            </View>
          ) : (
            <Text style={styles.createText}>
              {t("wizard.create", { defaultValue: "Create thesis" })}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  topTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  regenerateBtn: {
    minWidth: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  regenerateText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  genContent: { padding: 24, paddingBottom: 40 },
  genHero: { alignItems: "center", gap: 4, marginTop: 12 },
  genLogo: { width: 52, height: 52, borderRadius: 13 },
  genTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 6 },
  genSubj: { fontSize: 14, fontFamily: "Inter_400Regular", fontStyle: "italic", textAlign: "center", marginTop: 2 },
  genMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  genPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  genPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  genKw: { fontSize: 12, fontFamily: "Inter_400Regular" },
  genRule: { height: 1, marginVertical: 18 },
  genSteps: { gap: 14 },
  genStep: { flexDirection: "row", alignItems: "center", gap: 12 },
  genIcWrap: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  genIc: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  genIcPending: { borderWidth: 2, backgroundColor: "transparent" },
  genIcCheck: { color: "#FFFFFF", fontSize: 12, fontFamily: "Inter_700Bold" },
  genStepLbl: { fontSize: 14 },
  genLabelSm: { fontSize: 11, letterSpacing: 0.5, fontFamily: "Inter_600SemiBold", marginBottom: 10, textTransform: "uppercase" },
  genOutline: { gap: 8 },
  genSec: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  genDot: { width: 7, height: 7, borderRadius: 3.5 },
  genSecText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  genCaption: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 22 },
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  sectionCard: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kindBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  kindText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  sectionControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconBtn: {
    padding: 4,
  },
  sectionTitleInput: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chapterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chapterInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  addChapterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 9,
    borderRadius: 8,
  },
  addChapterText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  addSectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addSectionText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    padding: 20,
    paddingBottom: 30,
  },
  createBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  createInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  createText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
