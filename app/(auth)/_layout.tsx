import { Stack } from "expo-router";
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }}>
    <Stack.Screen name="onboarding" />
    <Stack.Screen name="language" />
    <Stack.Screen name="login" />
    <Stack.Screen name="signup" />
    <Stack.Screen name="forgot-password" />
    <Stack.Screen name="otp" />
    <Stack.Screen name="reset-password" />
  </Stack>;
}
