import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";

export function BackButton() {
  const router = useRouter();
  const colors = useThemeColors();
  const { isRTL } = useRTL();
  return (
    <Pressable onPress={() => router.back()} style={styles.button}>
      <ArrowLeft size={22} color={colors.textPrimary} strokeWidth={2} style={isRTL ? { transform: [{ scaleX: -1 }] } : undefined} />
    </Pressable>
  );
}
const styles = StyleSheet.create({ button: { padding: 4 } });
