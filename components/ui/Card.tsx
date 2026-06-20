import { View, StyleSheet, ViewProps } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

interface CardProps extends ViewProps { borderColor?: string; }

export function Card({ children, borderColor, style, ...props }: CardProps) {
  const colors = useThemeColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard }, borderColor && { borderWidth: 1, borderColor }, style]} {...props}>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({ card: { borderRadius: 14, padding: 16 } });
