import { Stack } from "expo-router";

// `gestureEnabled: false` — the LEADING EDGE BELONGS TO THE DRAWER. The native
// stack's interactive back-swipe lives in the same strip and, on any screen with
// something behind it, wins the touch, so the edge-swipe appeared to work on the
// workspace (stack root, nothing to pop) and nowhere else. Going back is the back
// arrow's job now, and every screen the drawer opens has one.
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "none", gestureEnabled: false }}>
    <Stack.Screen name="settings" />
    <Stack.Screen name="delete-account" />
    <Stack.Screen name="terms-of-service" />
    <Stack.Screen name="privacy-policy" />
    <Stack.Screen name="edit-profile" />
    <Stack.Screen name="subscription" />
    <Stack.Screen name="payment-checkout" />
    <Stack.Screen name="payment-success" />
    <Stack.Screen name="payment-failed" />
    <Stack.Screen name="start-thesis" />
    <Stack.Screen name="browse-templates" />
    <Stack.Screen name="university-templates" />
    <Stack.Screen name="thesis-title" />
    <Stack.Screen name="template-preview" />
    <Stack.Screen name="thesis-plan" />
    <Stack.Screen name="thesis-detail" />
    <Stack.Screen name="thesis-workspace" />
    <Stack.Screen name="block-editor" />
    <Stack.Screen name="lexical-lab" />
    <Stack.Screen name="lexical-roundtrip" />
    <Stack.Screen name="lexical-writeback" />
    <Stack.Screen name="voice-lab" />
    <Stack.Screen name="news" />
    <Stack.Screen name="news-detail" />
    <Stack.Screen name="export" />
    <Stack.Screen name="export-success" />
    <Stack.Screen name="network-error" />
    <Stack.Screen name="import-analysis" />
    <Stack.Screen name="combine-arrange" />
    {/* Former tab screens — every page is a push from the drawer now. */}
    <Stack.Screen name="chat" />
    <Stack.Screen name="notifications" />
    <Stack.Screen name="account" />
    <Stack.Screen name="library" />
    <Stack.Screen name="ai-key" />
  </Stack>;
}
