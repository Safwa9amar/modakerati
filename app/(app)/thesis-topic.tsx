import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisWizard, type WizardBrief } from "@/stores/thesis-wizard-store";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";

const METHODOLOGIES = ["experimental", "theoretical", "case_study", "survey", "mixed"] as const;

export default function ThesisTopicScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { templateId, brief } = useThesisWizard();
  const templates = useThesisStore((s) => s.templates);

  const [values, setValues] = useState<WizardBrief>(brief);
  const [showErrors, setShowErrors] = useState(false);

  const descMissing = !values.description.trim();

  const handleContinue = () => {
    if (descMissing) { setShowErrors(true); return; }
    useThesisWizard.getState().set({ brief: values });
    const tpl = templates.find((x) => x.id === templateId);
    const hasFields = (tpl?.config.placeholderFields?.length ?? 0) > 0;
    router.push(hasFields ? "/(app)/thesis-fields" : "/(app)/thesis-plan");
  };

  const patch = (k: keyof WizardBrief, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("wizard.topic.stepTitle")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("wizard.topic.stepSubtitle")}</Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.description")} *</Text>
          <TextInput
            value={values.description}
            onChangeText={(v) => patch("description", v)}
            multiline
            placeholder={t("wizard.topic.descriptionPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: showErrors && descMissing ? "#E5484D" : colors.borderDefault, height: 120 }]}
          />
          {showErrors && descMissing && <Text style={styles.errText}>{t("wizard.fieldsRequired")}</Text>}
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.objectives")}</Text>
          <TextInput
            value={values.objectives}
            onChangeText={(v) => patch("objectives", v)}
            multiline
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderDefault, height: 96 }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.keywords")}</Text>
          <TextInput
            value={values.keywords}
            onChangeText={(v) => patch("keywords", v)}
            placeholder={t("wizard.topic.keywordsPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderDefault, height: 48 }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.methodology")}</Text>
          <View style={styles.chips}>
            {METHODOLOGIES.map((m) => {
              const selected = values.methodology === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => patch("methodology", selected ? "" : m)}
                  style={[styles.chip, { borderColor: selected ? colors.brandPrimary : colors.borderDefault, backgroundColor: selected ? colors.brandPrimary : "transparent" }]}
                >
                  <Text style={[styles.chipText, { color: selected ? "#FFFFFF" : colors.textPrimary }]}>{t(`wizard.topic.method.${m}`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button title={t("wizard.continue")} onPress={handleContinue} variant="accent" disabled={showErrors && descMissing} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  content: { padding: 20, gap: 18, paddingBottom: 100 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 4 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular", textAlignVertical: "top" },
  errText: { fontSize: 12, color: "#E5484D", fontFamily: "Inter_400Regular" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  bottomBar: { padding: 20, paddingBottom: 30 },
});
