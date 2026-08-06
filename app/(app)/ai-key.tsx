import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomInset } from "@/hooks/useBottomInset";
import { useRTL } from "@/hooks/useRTL";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { useByokStore, type ByokErrorCode } from "@/stores/byok-store";
import { KeyRound, Eye, EyeOff, ExternalLink, AlertTriangle, Check } from "lucide-react-native";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

/** The provider dashboard a student has to visit to fix each failure. */
const ERROR_KEY: Record<ByokErrorCode, string> = {
  byok_key_rejected: "errorKeyRejected",
  byok_insufficient_credit: "errorInsufficientCredit",
  byok_rate_limited: "errorRateLimited",
  byok_model_denied: "errorModelDenied",
  byok_key_invalid: "errorKeyInvalid",
  byok_key_missing: "errorKeyInvalid",
  byok_provider_unsupported: "errorProviderUnsupported",
  byok_model_invalid: "errorModelInvalid",
};

/**
 * Bring-your-own-key: the student pastes their own AI provider key and pays for
 * their own usage. This is the free tier — with a key set we charge nothing for
 * the AI, because we never run a model on our own account for them.
 */
export default function AiKeyScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const bottomInset = useBottomInset(12);
  const { flexDirection, textAlign } = useRTL();

  const savedKey = useByokStore((s) => s.apiKey);
  const enabled = useByokStore((s) => s.enabled);
  const savedModel = useByokStore((s) => s.model);
  const lastError = useByokStore((s) => s.lastError);
  const setKey = useByokStore((s) => s.setKey);
  const setModel = useByokStore((s) => s.setModel);
  const setEnabled = useByokStore((s) => s.setEnabled);
  const clearKey = useByokStore((s) => s.clearKey);

  const [draftKey, setDraftKey] = useState(savedKey);
  const [draftModel, setDraftModel] = useState(savedModel);
  const [revealed, setRevealed] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = draftKey.trim() !== savedKey || draftModel.trim() !== savedModel;

  const handleSave = () => {
    setKey(draftKey);
    setModel(draftModel);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleRemove = () => {
    clearKey();
    setDraftKey("");
    setDraftModel("");
  };

  const active = enabled && savedKey.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("aiKey.title", { defaultValue: "Your own AI key" })}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.badge, { backgroundColor: colors.brandPrimary + "1F" }]}>
            <KeyRound size={28} color={colors.brandPrimary} />
          </View>

          <Text style={[styles.lead, { color: colors.textPrimary, textAlign }]}>
            {t("aiKey.lead", { defaultValue: "Use the app for free with your own key" })}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary, textAlign }]}>
            {t("aiKey.explainer", {
              defaultValue:
                "Add an API key from your own AI provider account and the app's AI runs on it. You pay your provider directly for what you use, and we charge you nothing.",
            })}
          </Text>

          {/* Where to get one — the single biggest drop-off point, so it's a
              button rather than a line of prose. */}
          <Pressable
            style={[styles.linkRow, { flexDirection, borderColor: colors.borderDefault }]}
            onPress={() => Linking.openURL(OPENROUTER_KEYS_URL)}
          >
            <ExternalLink size={18} color={colors.brandPrimary} />
            <Text style={[styles.linkText, { color: colors.brandPrimary, textAlign }]}>
              {t("aiKey.getKey", { defaultValue: "Get a key from OpenRouter" })}
            </Text>
          </Pressable>

          <Card style={styles.card}>
            <Text style={[styles.label, { color: colors.textSecondary, textAlign }]}>
              {t("aiKey.keyLabel", { defaultValue: "API key" })}
            </Text>
            <View style={[styles.inputRow, { flexDirection, borderColor: colors.borderDefault }]}>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, textAlign }]}
                value={draftKey}
                onChangeText={setDraftKey}
                placeholder="sk-or-v1-..."
                placeholderTextColor={colors.textSecondary}
                secureTextEntry={!revealed}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              <Pressable onPress={() => setRevealed((v) => !v)} hitSlop={8}>
                {revealed ? (
                  <EyeOff size={18} color={colors.textSecondary} />
                ) : (
                  <Eye size={18} color={colors.textSecondary} />
                )}
              </Pressable>
            </View>
            <Text style={[styles.hint, { color: colors.textSecondary, textAlign }]}>
              {t("aiKey.keyHint", {
                defaultValue: "Stored in your device's secure keychain. Sent to our server only to run your requests — never saved there.",
              })}
            </Text>
          </Card>

          <Card style={styles.card}>
            <Text style={[styles.label, { color: colors.textSecondary, textAlign }]}>
              {t("aiKey.modelLabel", { defaultValue: "Model (optional)" })}
            </Text>
            <View style={[styles.inputRow, { flexDirection, borderColor: colors.borderDefault }]}>
              <TextInput
                style={[styles.input, { color: colors.textPrimary, textAlign }]}
                value={draftModel}
                onChangeText={setDraftModel}
                placeholder="anthropic/claude-haiku-4.5"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
            </View>
            {/* Left empty on purpose by most students: the server then picks a
                cheap model, because the platform default is an expensive one
                that only makes sense on our wholesale pricing. */}
            <Text style={[styles.hint, { color: colors.textSecondary, textAlign }]}>
              {t("aiKey.modelHint", {
                defaultValue: "Leave empty to use an inexpensive model. A stronger model gives better writing and costs you more.",
              })}
            </Text>
          </Card>

          {savedKey.length > 0 && (
            <Card style={styles.card}>
              <View style={[styles.toggleRow, { flexDirection }]}>
                <View style={styles.toggleLabels}>
                  <Text style={[styles.toggleTitle, { color: colors.textPrimary, textAlign }]}>
                    {t("aiKey.useMyKey", { defaultValue: "Use my key" })}
                  </Text>
                  <Text style={[styles.hint, { color: colors.textSecondary, textAlign }]}>
                    {active
                      ? t("aiKey.statusOn", { defaultValue: "The AI runs on your key and your account is billed." })
                      : t("aiKey.statusOff", { defaultValue: "Turned off — the app uses our AI instead." })}
                  </Text>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  trackColor={{ false: colors.borderDefault, true: colors.brandPrimary }}
                />
              </View>
            </Card>
          )}

          {lastError && (
            <View style={[styles.errorCard, { backgroundColor: colors.semanticError + "14", flexDirection }]}>
              <AlertTriangle size={18} color={colors.semanticError} />
              <Text style={[styles.errorText, { color: colors.semanticError, textAlign }]}>
                {t(`aiKey.${ERROR_KEY[lastError]}`, {
                  defaultValue: "Your provider rejected the last request. Check your key and balance.",
                })}
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.borderSubtle, paddingBottom: bottomInset }]}>
          <Pressable
            style={[
              styles.saveButton,
              { backgroundColor: colors.brandPrimary, opacity: dirty || justSaved ? 1 : 0.5 },
            ]}
            onPress={handleSave}
            disabled={!dirty}
          >
            {justSaved ? (
              <View style={[styles.savedRow, { flexDirection }]}>
                <Check size={18} color={colors.bgPrimary} strokeWidth={3} />
                <Text style={[styles.saveButtonText, { color: colors.bgPrimary }]}>
                  {t("aiKey.saved", { defaultValue: "Saved" })}
                </Text>
              </View>
            ) : (
              <Text style={[styles.saveButtonText, { color: colors.bgPrimary }]}>
                {t("common.save", { defaultValue: "Save" })}
              </Text>
            )}
          </Pressable>

          {savedKey.length > 0 && (
            <Pressable style={styles.removeButton} onPress={handleRemove}>
              <Text style={[styles.removeButtonText, { color: colors.semanticError }]}>
                {t("aiKey.remove", { defaultValue: "Remove key" })}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 24, alignItems: "center" },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginTop: 8, marginBottom: 16 },
  lead: { fontSize: 18, fontFamily: "Inter_600SemiBold", alignSelf: "stretch", marginBottom: 8 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, alignSelf: "stretch", marginBottom: 16 },
  linkRow: { alignSelf: "stretch", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 20 },
  linkText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: { alignSelf: "stretch", gap: 8, marginBottom: 16 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  inputRow: { alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  toggleRow: { alignItems: "center", gap: 12 },
  toggleLabels: { flex: 1, gap: 4 },
  toggleTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  errorCard: { alignSelf: "stretch", alignItems: "flex-start", gap: 10, borderRadius: 12, padding: 14, marginBottom: 8 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, gap: 8 },
  saveButton: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  savedRow: { alignItems: "center", gap: 8 },
  saveButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  removeButton: { height: 44, alignItems: "center", justifyContent: "center" },
  removeButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
