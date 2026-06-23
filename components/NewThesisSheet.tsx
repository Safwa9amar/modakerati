import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BottomSheet } from "@/components/BottomSheet";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { suggestThesisTitles } from "@/lib/api";
import i18n from "@/lib/i18n";

/**
 * "Name your thesis" prompt — the first step of the thesis-creation wizard.
 * Built on the reusable <BottomSheet>; opened with
 * useBottomSheet.getState().openSheet("new-thesis"). On continue it stores the
 * title + language in the wizard store and routes to the template picker; no
 * thesis is created until later in the wizard.
 */
export function NewThesisSheet() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const canSuggest = title.trim().length >= 3;

  // On-demand AI autocomplete: only fetch when the user taps "Suggest titles".
  const fetchSuggestions = async () => {
    if (!canSuggest || loadingSuggestions) return;
    setLoadingSuggestions(true);
    try {
      setSuggestions(await suggestThesisTitles(title.trim()));
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleChangeText = (text: string) => {
    setTitle(text);
    // Existing suggestions are stale once the input changes.
    if (suggestions.length) setSuggestions([]);
  };

  const pickSuggestion = (s: string) => {
    setTitle(s);
    setSuggestions([]);
  };

  // Capture the title + language into the wizard store and advance to the
  // template picker. The thesis itself is created later in the wizard flow.
  const handleContinue = () => {
    const name = title.trim();
    if (!name) return;
    useThesisWizard.getState().set({ title: name, language: i18n.language || "fr" });
    setTitle("");
    setSuggestions([]);
    useBottomSheet.getState().closeSheet("new-thesis");
    router.push("/(app)/template-picker");
  };

  const disabled = !title.trim();

  return (
    <BottomSheet name="new-thesis" snapPoints={["40%", "80%"]} keyboardBehavior="extend">
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t("thesis.nameThesis")}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("thesis.nameThesisHint")}</Text>

      <BottomSheetTextInput
        value={title}
        onChangeText={handleChangeText}
        placeholder={t("thesis.titlePlaceholder")}
        placeholderTextColor={colors.textPlaceholder}
        returnKeyType="done"
        onSubmitEditing={handleContinue}
        style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
      />

      <Pressable
        onPress={fetchSuggestions}
        disabled={!canSuggest || loadingSuggestions}
        style={[
          styles.suggestBtn,
          { borderColor: colors.brandPrimary + "55", opacity: !canSuggest || loadingSuggestions ? 0.5 : 1 },
        ]}
      >
        {loadingSuggestions ? (
          <ActivityIndicator size="small" color={colors.brandPrimary} />
        ) : (
          <Sparkles size={15} color={colors.brandPrimary} strokeWidth={2} />
        )}
        <Text style={[styles.suggestBtnText, { color: colors.brandPrimary }]}>
          {t("thesis.suggestTitles")}
        </Text>
      </Pressable>

      {suggestions.length > 0 && (
        <View style={styles.suggestWrap}>
          <View style={styles.suggestHeader}>
            <Sparkles size={13} color={colors.brandPrimary} strokeWidth={2} />
            <Text style={[styles.suggestLabel, { color: colors.textSecondary }]}>
              {t("thesis.aiSuggestions")}
            </Text>
          </View>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              onPress={() => pickSuggestion(s)}
              style={[styles.suggestItem, { backgroundColor: colors.bgCard }]}
            >
              <Text style={[styles.suggestItemText, { color: colors.textPrimary }]} numberOfLines={2}>
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        onPress={handleContinue}
        disabled={disabled}
        style={[styles.btn, { backgroundColor: colors.brandPrimary, opacity: disabled ? 0.5 : 1 }]}
      >
        <Text style={styles.btnText}>{t("wizard.continue", { defaultValue: "Continue" })}</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  suggestBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginBottom: 16,
  },
  suggestBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  suggestWrap: { marginBottom: 16, gap: 8 },
  suggestHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  suggestLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
  suggestItem: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  suggestItemText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 19 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#FFFFFF", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
