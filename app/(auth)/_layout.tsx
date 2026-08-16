import { Stack } from "expo-router";
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "none" }}>
    <Stack.Screen name="onboarding" />
    <Stack.Screen name="language" />
    <Stack.Screen name="login" />
    <Stack.Screen name="signup" />
    <Stack.Screen name="forgot-password" />
    {/* One waiting room, both emails that come back as a link — `flow` says which. */}
    <Stack.Screen name="check-email" />
    <Stack.Screen name="reset-password" />
    {/* Gesture off: this is the end of recovery and there is nothing valid
        behind it — see the screen's own note. */}
    <Stack.Screen name="password-changed" options={{ gestureEnabled: false }} />
  </Stack>;
}
