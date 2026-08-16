import { useState } from "react";
import { View, Text, TextInput as RNTextInput, StyleSheet, TextInputProps, Pressable } from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";

interface Props extends TextInputProps { label?: string; }

export function TextInput({ label, style, secureTextEntry, ...props }: Props) {
  const colors = useThemeColors();
  const { textAlign, end } = useRTL();
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  // Only a field that was asked to hide its content gets a way to show it.
  const isPassword = !!secureTextEntry;

  return (
    <View style={styles.container}>
      {label && <Text style={[styles.label, { color: colors.textSecondary, textAlign }]}>{label}</Text>}
      <View style={styles.field}>
        <RNTextInput
          style={[
            styles.input,
            { backgroundColor: colors.bgInput, color: colors.textPrimary, borderColor: colors.borderSubtle, textAlign },
            // Room for the toggle, on whichever side is the reading END — the
            // physical edge flips with the app's direction, so it comes from
            // useRTL rather than a hardcoded `right`.
            isPassword && { [end === "right" ? "paddingRight" : "paddingLeft"]: 48 },
            style,
          ]}
          placeholderTextColor={colors.textPlaceholder}
          // Revealing has to actually turn the prop OFF, not swap the font:
          // secureTextEntry also disables autocorrect and, on iOS, clears the
          // field on some keyboard changes.
          secureTextEntry={isPassword && !revealed}
          {...props}
        />
        {isPassword && (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            style={[styles.toggle, { [end]: 12 }]}
            // The tap target is bigger than the glyph — 20px of icon is well
            // under the 44pt Apple asks for.
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={
              revealed
                ? t("auth.hidePassword", { defaultValue: "Hide password" })
                : t("auth.showPassword", { defaultValue: "Show password" })
            }
          >
            {revealed ? (
              <EyeOff size={20} color={colors.textSecondary} strokeWidth={1.8} />
            ) : (
              <Eye size={20} color={colors.textSecondary} strokeWidth={1.8} />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  field: { justifyContent: "center" },
  input: { borderRadius: 12, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 16, fontSize: 14, fontFamily: "Inter_400Regular" },
  toggle: { position: "absolute", padding: 4 },
});
