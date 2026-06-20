import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "accent" | "destructive";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = "primary", loading, disabled, style }: ButtonProps) {
  const colors = useThemeColors();
  const bgMap = { primary: colors.brandPrimary, secondary: colors.bgSurface, accent: colors.brandAccent, destructive: colors.semanticError };
  const textMap = { primary: "#FFFFFF", secondary: colors.textPrimary, accent: colors.bgPrimary, destructive: "#FFFFFF" };
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={[styles.button, { backgroundColor: bgMap[variant], opacity: disabled ? 0.5 : 1 }, style]}>
      {loading ? <ActivityIndicator color={textMap[variant]} /> : <Text style={[styles.text, { color: textMap[variant] }]}>{title}</Text>}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { borderRadius: 14, paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  text: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
