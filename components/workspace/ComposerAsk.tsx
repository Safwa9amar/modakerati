import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
// Plain (unregistered) input on purpose — a BottomSheetTextInput would wake
// gorhom's own keyboard handling, which fights the composer sheet's manual
// keyboard docking (see WorkspaceComposerSheet).
import { TextInput } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { AskPayload } from "@/types/chat";

interface Props {
  ask: AskPayload;
  onAnswer: (answer: string) => void;
  rtl: boolean;
  /** The user always has the right to dismiss the question unanswered. */
  onDismiss?: () => void;
  /** Focus tracking for the sheet's keyboard docking. */
  onInputFocus?: () => void;
  onInputBlur?: () => void;
}

/**
 * The model's clarifying question, rendered inline inside the composer sheet
 * (replaces the standalone AskBottomSheet). Tapping an option answers
 * immediately; the free-text row (when allowed) submits typed answers.
 */
export function ComposerAsk({ ask, onAnswer, rtl, onDismiss, onInputFocus, onInputBlur }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [text, setText] = useState("");

  const submit = (answer: string) => {
    const a = answer.trim();
    if (a) onAnswer(a);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, rtl && styles.headerRtl]}>
        <Text style={[styles.question, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}>
          {ask.question}
        </Text>
        {onDismiss && (
          <Pressable
            onPress={onDismiss}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("chat.dismissQuestion", { defaultValue: "Dismiss question" })}
          >
            <X size={18} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        )}
      </View>

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
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("chat.typeYourOwn", { defaultValue: "Type your own…" })}
            placeholderTextColor={colors.textPlaceholder}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
            onSubmitEditing={() => submit(text)}
            onFocus={onInputFocus}
            onBlur={onInputBlur}
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
  header: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  headerRtl: { flexDirection: "row-reverse" },
  question: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1 },
  optionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12 },
  sendText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
