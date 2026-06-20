import { Stack } from "expo-router";
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
    <Stack.Screen name="settings" />
    <Stack.Screen name="edit-profile" />
    <Stack.Screen name="subscription" />
  </Stack>;
}
