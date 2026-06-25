import React from "react";
import { Pressable, View, StyleSheet } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

export function PaperPage({ children, onPress, selected, center }: { children: React.ReactNode; onPress?: () => void; selected?: boolean; center?: boolean; }) {
  const colors = useThemeColors();
  const inner = (
    <View style={[styles.page, { backgroundColor: "#FFFFFF", borderColor: selected ? colors.brandPrimary : "transparent", borderWidth: selected ? 2 : 0 }, center && styles.center]}>
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={styles.wrap}>{inner}</Pressable> : <View style={styles.wrap}>{inner}</View>;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 8 },
  page: { borderRadius: 6, padding: 20, minHeight: 120, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  center: { alignItems: "center", justifyContent: "center", minHeight: 320 },
});
