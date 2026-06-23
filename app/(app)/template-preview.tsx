import { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { generateThesisPlan } from "@/lib/api";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function TemplatePreviewScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { templateId } = useLocalSearchParams<{ templateId: string }>();
  const { templates } = useThesisStore();
  const [generating, setGenerating] = useState(false);

  const template = templates.find((tpl) => tpl.id === templateId);

  if (!template) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bgPrimary }]}
        edges={["top"]}
      >
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {t("template.templatePreview")}
          </Text>
          <View style={{ width: 30 }} />
        </View>
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>Template not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const specs = [
    template.config.paperSize,
    `${template.config.bodyFont} ${template.config.bodySize}`,
    `${template.config.lineSpacing} spacing`,
    `${template.config.margins.left} binding`,
  ];

  // Record the chosen template on the wizard, generate an AI plan for the
  // captured title, then advance to the plan-review step. The thesis is not
  // created until the user confirms the plan.
  const handleUseTemplate = async () => {
    if (generating) return;
    const wizard = useThesisWizard.getState();
    wizard.set({ templateId: template.id, language: template.language });
    setGenerating(true);
    try {
      const { sections } = await generateThesisPlan({
        title: useThesisWizard.getState().title || template.name,
        language: template.language,
        bodyPreset: template.bodyPreset,
        templateId: template.id,
      });
      useThesisWizard.getState().set({ plan: sections });
      router.push("/(app)/thesis-plan");
    } catch (e) {
      console.error("Failed to generate plan:", e instanceof Error ? e.message : e);
      // The plan screen regenerates / falls back when no plan is present.
      router.push("/(app)/thesis-plan");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("template.templatePreview")}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Info card */}
        <Card>
          <Text style={[styles.universityName, { color: colors.textPrimary }]}>
            {template.university}
          </Text>
          <View style={styles.infoRow}>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              {template.type}
            </Text>
            <View
              style={[styles.langBadge, { backgroundColor: colors.bgSurface }]}
            >
              <Text style={[styles.langText, { color: colors.textSecondary }]}>
                {template.language}
              </Text>
            </View>
          </View>
          <View style={styles.specRow}>
            {specs.map((spec, i) => (
              <View
                key={i}
                style={[
                  styles.specBadge,
                  { backgroundColor: colors.brandPrimary + "18" },
                ]}
              >
                <Text
                  style={[
                    styles.specText,
                    { color: colors.brandPrimary },
                  ]}
                >
                  {spec}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Paper preview */}
        <View style={styles.paperWrapper}>
          <View style={[styles.paper, { borderColor: colors.borderSubtle }]}>
            <Text style={styles.paperSmall}>
              REPUBLIQUE ALGERIENNE DEMOCRATIQUE ET POPULAIRE
            </Text>
            <Text style={styles.paperSmall}>
              Ministere de l'Enseignement Superieur{"\n"}et de la Recherche
              Scientifique
            </Text>
            <View style={styles.paperDivider} />
            <Text style={styles.paperUniversity}>{template.university}</Text>
            <Text style={styles.paperFaculty}>
              Faculte des Sciences et Technologies
            </Text>
            <Text style={styles.paperDept}>Departement d'Informatique</Text>
            <View style={styles.paperDivider} />
            <Text style={styles.paperType}>{template.type.toUpperCase()}</Text>
            <View style={[styles.titleBox, { borderColor: "#999" }]}>
              <Text style={styles.titleBoxText}>
                Titre du memoire
              </Text>
            </View>
            <View style={styles.paperDivider} />
            <Text style={styles.paperSmall}>
              Presente par : __________
            </Text>
            <Text style={styles.paperSmall}>
              Encadre par : __________
            </Text>
            <View style={styles.paperSpacer} />
            <Text style={styles.paperYear}>
              Annee universitaire : 2025 / 2026
            </Text>
          </View>
        </View>

        {/* Chapter structure preview */}
        <Card>
          <Text style={[styles.chaptersLabel, { color: colors.textSecondary }]}>
            {t("thesis.sections")} ({template.chapterStructure.length})
          </Text>
          {template.chapterStructure.map((ch, i) => (
            <View key={i} style={styles.chapterRow}>
              <View
                style={[
                  styles.chapterDot,
                  { backgroundColor: colors.brandPrimary },
                ]}
              />
              <Text
                style={[styles.chapterText, { color: colors.textPrimary }]}
              >
                {ch}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>

      {/* Bottom button */}
      <View style={styles.bottomBar}>
        <Button
          title={
            generating
              ? t("wizard.generating", { defaultValue: "Generating your plan…" })
              : t("template.useTemplate")
          }
          onPress={handleUseTemplate}
          variant="accent"
          loading={generating}
          disabled={generating}
        />
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
  title: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  content: {
    padding: 20,
    gap: 20,
    paddingBottom: 100,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  universityName: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  infoText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  langBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  langText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  specRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  specBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  specText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  paperWrapper: {
    alignItems: "center",
  },
  paper: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  paperSmall: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: "#333",
    textAlign: "center",
    lineHeight: 14,
  },
  paperUniversity: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: "#222",
    textAlign: "center",
  },
  paperFaculty: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: "#444",
    textAlign: "center",
  },
  paperDept: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: "#555",
    textAlign: "center",
  },
  paperType: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#111",
    textAlign: "center",
    letterSpacing: 2,
    marginVertical: 4,
  },
  titleBox: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginVertical: 6,
  },
  titleBoxText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#333",
    textAlign: "center",
  },
  paperDivider: {
    height: 10,
  },
  paperSpacer: {
    height: 16,
  },
  paperYear: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    color: "#555",
    textAlign: "center",
  },
  chaptersLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 10,
  },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  chapterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chapterText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  bottomBar: {
    padding: 20,
    paddingBottom: 30,
  },
});
