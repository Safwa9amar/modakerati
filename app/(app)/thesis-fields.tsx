import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { useProfileStore } from "@/stores/profile-store";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import type { TemplateField } from "@/types/thesis";

function currentAcademicYear(): string {
  const y = new Date().getFullYear();
  return `${y}/${y + 1}`;
}

function prefillFor(
  field: TemplateField,
  ctx: { wizardTitle: string; profile: { fullName?: string; university?: string | null; department?: string | null } | null },
): string {
  if (field.key === "title") return ctx.wizardTitle ?? "";
  switch (field.prefill) {
    case "profile.fullName": return ctx.profile?.fullName ?? "";
    case "profile.university": return ctx.profile?.university ?? "";
    case "profile.department": return ctx.profile?.department ?? "";
    case "currentYear": return currentAcademicYear();
    default: return "";
  }
}

export default function ThesisFieldsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { templateId, title } = useThesisWizard();
  const templates = useThesisStore((s) => s.templates);
  const profile = useProfileStore((s) => s.profile);

  const fields = useMemo<TemplateField[]>(() => {
    const tpl = templates.find((x) => x.id === templateId);
    return tpl?.config.placeholderFields ?? [];
  }, [templates, templateId]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = prefillFor(f, { wizardTitle: title, profile });
    return seed;
  });
  const [showErrors, setShowErrors] = useState(false);

  const missingRequired = fields.some((f) => f.required && !(values[f.key] ?? "").trim());

  const handleContinue = () => {
    if (missingRequired) { setShowErrors(true); return; }
    const patch: any = { fieldValues: values, step: "plan" };
    if (values.title != null) patch.title = values.title; // keep the edited title
    useThesisWizard.getState().set(patch);
    router.push("/(app)/thesis-plan");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("wizard.fieldsStepTitle")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("wizard.fieldsStepSubtitle")}</Text>

        {fields.map((f) => {
          const invalid = showErrors && f.required && !(values[f.key] ?? "").trim();
          return (
            <View key={f.key} style={styles.field}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t(`wizard.fields.${f.key}`, { defaultValue: f.key })}
                {f.required ? " *" : ""}
              </Text>
              <TextInput
                value={values[f.key] ?? ""}
                onChangeText={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                multiline={f.type === "multiline"}
                placeholder={f.type === "year" ? currentAcademicYear() : ""}
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    backgroundColor: colors.bgInput,
                    borderColor: invalid ? "#E5484D" : colors.borderDefault,
                    height: f.type === "multiline" ? 96 : 48,
                  },
                ]}
              />
              {invalid && <Text style={styles.errText}>{t("wizard.fieldsRequired")}</Text>}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button title={t("wizard.continue")} onPress={handleContinue} variant="accent" disabled={missingRequired && showErrors} />
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
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: "Inter_400Regular", textAlignVertical: "top",
  },
  errText: { fontSize: 12, color: "#E5484D", fontFamily: "Inter_400Regular" },
  bottomBar: { padding: 20, paddingBottom: 30 },
});
