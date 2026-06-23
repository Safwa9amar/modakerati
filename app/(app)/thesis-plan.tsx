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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import {
  useThesisWizard,
  type WizardPlanSection,
} from "@/stores/thesis-wizard-store";
import { generateThesisPlan, createThesis, getThesis } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react-native";

const KIND_LABELS: Record<WizardPlanSection["kind"], string> = {
  introduction: "Introduction",
  section: "Partie",
  conclusion: "Conclusion",
};

export default function ThesisPlanScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const { plan, title, language, templateId } = useThesisWizard();

  // The local copy is the editing surface; the wizard store is kept in sync.
  const [localPlan, setLocalPlan] = useState<WizardPlanSection[]>(plan ?? []);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);

  // If we arrived without a plan (e.g. plan generation failed upstream), kick
  // off generation on mount and show a centered loader.
  useEffect(() => {
    if (plan && plan.length > 0) return;
    let active = true;
    setGenerating(true);
    (async () => {
      try {
        const { sections } = await generateThesisPlan({ title, language });
        if (!active) return;
        setLocalPlan(sections);
        useThesisWizard.getState().set({ plan: sections });
      } catch (e) {
        if (active) {
          Alert.alert(
            t("common.error", { defaultValue: "Error" }),
            e instanceof Error ? e.message : String(e)
          );
        }
      } finally {
        if (active) setGenerating(false);
      }
    })();
    return () => {
      active = false;
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
        e instanceof Error ? e.message : String(e)
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
      const created = await createThesis({
        title,
        templateId: templateId ?? undefined,
        language,
        sections: localPlan.map((s) => ({
          title: s.title || "Partie",
          kind: s.kind,
          chapters: s.chapters.map((c) => ({ title: c.title || "Chapitre", content: c.content })),
        })),
      });
      const full = await getThesis(created.id);
      useThesisStore.getState().upsertThesis(full);
      useThesisStore.getState().setCurrentThesis(full.id);
      useThesisWizard.getState().reset();
      router.replace({
        pathname: "/(app)/thesis-workspace",
        params: { thesisId: full.id },
      });
    } catch (e) {
      Alert.alert(
        t("common.error", { defaultValue: "Error" }),
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setCreating(false);
    }
  };

  // Centered loader while generating an initial plan (no plan to edit yet).
  if (generating && localPlan.length === 0) {
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
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            {t("wizard.generating", { defaultValue: "Generating your plan…" })}
          </Text>
        </View>
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
      <View style={styles.footer}>
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
