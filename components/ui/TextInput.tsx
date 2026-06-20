import { View, Text, TextInput as RNTextInput, StyleSheet, TextInputProps } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";

interface Props extends TextInputProps { label?: string; }

export function TextInput({ label, style, ...props }: Props) {
  const colors = useThemeColors();
  const { textAlign } = useRTL();
  return (
    <View style={styles.container}>
      {label && <Text style={[styles.label, { color: colors.textSecondary, textAlign }]}>{label}</Text>}
      <RNTextInput style={[styles.input, { backgroundColor: colors.bgInput, color: colors.textPrimary, borderColor: colors.borderSubtle, textAlign }, style]} placeholderTextColor={colors.textPlaceholder} {...props} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderRadius: 12, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 16, fontSize: 14, fontFamily: "Inter_400Regular" },
});
