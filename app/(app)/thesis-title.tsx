import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { useNotificationStore } from "@/stores/notification-store";
import { BackButton } from "@/components/BackButton";
import { suggestThesisTitles } from "@/lib/api";
import { ChevronRight } from "lucide-react-native";

// ---------------------------------------------------------------------------
// Language toggle options
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { key: "fr", label: "FR" },
  { key: "ar", label: "AR" },
  { key: "en", label: "EN" },
] as const;

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ThesisTitleScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  // Pre-fill from wizard store (user might navigate back)
  const wizardState = useThesisWizard.getState();
  const [title, setTitle] = useState(wizardState.title);
  const [language, setLanguage] = useState(wizardState.language || "fr");
  const [supervisor, setSupervisor] = useState(wizardState.supervisor);
  const [academicYear, setAcademicYear] = useState(wizardState.academicYear);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [titleError, setTitleError] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // -- debounced AI title suggestions --

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      setTitleError(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (text.length < 5) {
        setSuggestions([]);
        return;
      }
      timerRef.current = setTimeout(async () => {
        // Gated by the "AI Suggestions" setting — skip the request when it's off.
        if (!useNotificationStore.getState().preferences.aiSuggestions) {
          setSuggestions([]);
          return;
        }
        setLoadingSuggestions(true);
        const results = await suggestThesisTitles(text, language);
        setSuggestions(results);
        setLoadingSuggestions(false);
      }, 500);
    },
    [language],
  );

  const handleSuggestionTap = (suggestion: string) => {
    setTitle(suggestion);
    setSuggestions([]);
    setTitleError(false);
  };

  // -- next handler --

  const handleNext = () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    useThesisWizard.getState().set({
      title: title.trim(),
      language,
      supervisor,
      academicYear,
      step: "plan",
    });
    router.push("/(app)/thesis-plan" as any);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
            {t("wizard.titleScreen")}
          </Text>
          <View style={{ width: 30 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title field */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              {t("wizard.enterTitle")} *
            </Text>
            <TextInput
              value={title}
              onChangeText={handleTitleChange}
              placeholder={t("wizard.titlePlaceholder")}
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.input,
                {
                  backgroundColor: colors.bgInput,
                  color: colors.textPrimary,
                  borderColor: titleError
                    ? colors.semanticError
                    : colors.borderDefault,
                },
              ]}
              multiline={false}
              returnKeyType="next"
            />
            {titleError && (
              <Text style={[styles.errorText, { color: colors.semanticError }]}>
                {t("wizard.titleRequired")}
              </Text>
            )}
          </View>

          {/* AI suggestions */}
          {loadingSuggestions && (
            <ActivityIndicator
              size="small"
              color={colors.brandPrimary}
              style={styles.suggestionsLoader}
            />
          )}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsRow}>
              {suggestions.map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => handleSuggestionTap(s)}
                  style={[
                    styles.suggestionChip,
                    {
                      backgroundColor: colors.brandPrimary + "18",
                      borderColor: colors.brandPrimary + "44",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.suggestionChipText,
                      { color: colors.brandPrimary },
                    ]}
                    numberOfLines={2}
                  >
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Language toggle */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              {t("wizard.language")}
            </Text>
            <View style={styles.languageRow}>
              {LANGUAGES.map((lang) => {
                const active = language === lang.key;
                return (
                  <Pressable
                    key={lang.key}
                    onPress={() => setLanguage(lang.key)}
                    style={[
                      styles.languageButton,
                      {
                        backgroundColor: active
                          ? colors.brandPrimary
                          : colors.bgCard,
                        borderColor: active
                          ? colors.brandPrimary
                          : colors.borderDefault,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.languageButtonText,
                        {
                          color: active ? "#FFFFFF" : colors.textPrimary,
                        },
                      ]}
                    >
                      {lang.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Supervisor */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              {t("wizard.supervisor")}
            </Text>
            <TextInput
              value={supervisor}
              onChangeText={setSupervisor}
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.input,
                {
                  backgroundColor: colors.bgInput,
                  color: colors.textPrimary,
                  borderColor: colors.borderDefault,
                },
              ]}
              returnKeyType="next"
            />
          </View>

          {/* Academic year */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              {t("wizard.academicYear")}
            </Text>
            <TextInput
              value={academicYear}
              onChangeText={setAcademicYear}
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.input,
                {
                  backgroundColor: colors.bgInput,
                  color: colors.textPrimary,
                  borderColor: colors.borderDefault,
                },
              ]}
              returnKeyType="done"
            />
          </View>

          {/* Next button */}
          <Pressable
            onPress={handleNext}
            style={[
              styles.nextButton,
              { backgroundColor: colors.brandPrimary },
            ]}
          >
            <Text style={styles.nextButtonText}>{t("wizard.next")}</Text>
            <ChevronRight size={18} color="#FFFFFF" strokeWidth={2.5} />
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  content: {
    padding: 20,
    gap: 20,
    paddingBottom: 40,
  },

  // Field groups
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  // Suggestions
  suggestionsLoader: {
    alignSelf: "flex-start",
  },
  suggestionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  suggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: "100%",
  },
  suggestionChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },

  // Language toggle
  languageRow: {
    flexDirection: "row",
    gap: 10,
  },
  languageButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  languageButtonText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },

  // Next button
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 6,
    marginTop: 8,
  },
  nextButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
