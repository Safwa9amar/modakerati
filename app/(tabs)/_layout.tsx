import { View } from "react-native";
import { Tabs } from "expo-router";
import { FloatingNavBar } from "@/components/FloatingNavBar";
import { useThemeColors } from "@/hooks/useThemeColors";

export default function TabsLayout() {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={() => <FloatingNavBar />}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="thesis" />
        <Tabs.Screen name="notifications" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </View>
  );
}
