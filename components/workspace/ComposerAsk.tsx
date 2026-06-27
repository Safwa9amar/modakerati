import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { AskPayload } from "@/types/chat";

interface Props {
  ask: AskPayload;
  onAnswer: (answer: string) => void;
  rtl: boolean;
}

/**
 * The model's clarifying question, rendered inline inside the composer sheet
 * (replaces the standalone AskBottomSheet). Tapping an option answers
 * immediately; the free-text row (when allowed) submits typed answers.
 */
export function ComposerAsk({ ask, onAnswer, rtl }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [text, setText] = useState("");

  const submit = (answer: string) => {
    const a = answer.trim();
    if (a) onAnswer(a);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.question, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}>
        {ask.question}
      </Text>

      <View style={styles.options}>
        {ask.options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => submit(opt)}
            style={[styles.option, { backgroundColor: colors.bgCard, borderColor: colors.brandPrimary + "55" }]}
          >
            <Text style={[styles.optionText, { color: colors.textPrimary }]}>{opt}</Text>
          </Pressable>
        ))}
      </View>

      {ask.allowFreeText && (
        <View style={styles.inputRow}>
          <BottomSheetTextInput
            value={text}
            onChangeText={setText}
            placeholder={t("chat.typeYourOwn", { defaultValue: "Type your own…" })}
            placeholderTextColor={colors.textPlaceholder}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
            onSubmitEditing={() => submit(text)}
            returnKeyType="send"
          />
          <Pressable onPress={() => submit(text)} style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }]}>
            <Text style={styles.sendText}>{t("chat.send", { defaultValue: "Send" })}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, paddingTop: 4 },
  question: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1 },
  optionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12 },
  sendText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
