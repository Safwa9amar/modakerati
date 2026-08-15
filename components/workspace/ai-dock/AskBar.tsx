import React, { useState } from "react";
import { View, Pressable, Keyboard } from "react-native";
import { TextInput } from "react-native-gesture-handler";
import { Send } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { dockStyles as s } from "./styles";

interface Props {
  placeholder: string;
  /** floating-pill-store's `inputOpen` — which now means "focus me", not
   *  "exist". The bar itself is always rendered. */
  autoFocus: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
}

/** Row two: the free-form ask. Always present — the tap-to-reveal step this
 *  replaced put the one thing a student can't get from a chip behind an extra
 *  tap, at the bottom of the panel. */
export function AskBar({ placeholder, autoFocus, disabled, onSend }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();
  const [text, setText] = useState("");

  const empty = !text.trim();

  const send = () => {
    if (empty || disabled) return;
    onSend(text.trim());
    setText("");
    Keyboard.dismiss();
  };

  return (
    <View
      style={[s.askBar, { flexDirection, backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
    >
      <TextInput
        autoFocus={autoFocus}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        style={[s.askInput, { color: colors.textPrimary, textAlign }]}
        multiline={false}
        returnKeyType="send"
        onSubmitEditing={send}
        editable={!disabled}
      />
      <Pressable
        onPress={send}
        disabled={empty || disabled}
        accessibilityRole="button"
        accessibilityLabel={t("chat.send", { defaultValue: "Send" })}
        style={[s.sendBtn, { backgroundColor: colors.brandPrimary }, (empty || disabled) && s.dim]}
      >
        <Send size={15} color={colors.brandOnPrimary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
