import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BottomSheet } from "@/components/BottomSheet";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useThesisStore } from "@/stores/thesis-store";
import { createThesis, getThesis, suggestThesisTitles } from "@/lib/api";

// A blank thesis still seeds a standard chapter skeleton under a single body
// section (Partie); only the title is collected up front.
const DEFAULT_CHAPTERS = ["Introduction", "Literature Review", "Methodology", "Results", "Conclusion"];

/**
 * "Name your thesis" prompt shown before a blank thesis is created. Built on the
 * reusable <BottomSheet>; opened with useBottomSheet.getState().openSheet("new-thesis").
 * On submit it persists the title (POST /api/thesis), selects the thesis, and
 * opens the chat.
 */
export function NewThesisSheet() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
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

  const create = async () => {
    const name = title.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createThesis({
        title: name,
        sections: [{ title: "Corps", chapters: DEFAULT_CHAPTERS.map((t) => ({ title: t })) }],
      });
      // Fetch the full record (with nested sections/chapters) and mirror it
      // into the store so chat / editor screens have the complete thesis.
      const store = useThesisStore.getState();
      try {
        store.upsertThesis(await getThesis(created.id));
      } catch {
        store.upsertThesis(created);
      }
      store.setCurrentThesis(created.id);
      setTitle("");
      useBottomSheet.getState().closeSheet("new-thesis");
      router.push("/(tabs)/chat" as any);
    } catch (e) {
      console.error("Failed to create thesis:", e instanceof Error ? e.message : e);
    } finally {
      setCreating(false);
    }
  };

  const disabled = !title.trim() || creating;

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
        onSubmitEditing={create}
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
        onPress={create}
        disabled={disabled}
        style={[styles.btn, { backgroundColor: colors.brandPrimary, opacity: disabled ? 0.5 : 1 }]}
      >
        {creating ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.btnText}>{t("thesis.createThesis")}</Text>
        )}
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
