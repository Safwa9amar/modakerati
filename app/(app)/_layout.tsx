import { Stack } from "expo-router";
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
    <Stack.Screen name="settings" />
    <Stack.Screen name="delete-account" />
    <Stack.Screen name="terms-of-service" />
    <Stack.Screen name="privacy-policy" />
    <Stack.Screen name="edit-profile" />
    <Stack.Screen name="subscription" />
    <Stack.Screen name="payment-checkout" />
    <Stack.Screen name="payment-success" />
    <Stack.Screen name="payment-failed" />
    <Stack.Screen name="template-picker" />
    <Stack.Screen name="thesis-title" />
    <Stack.Screen name="template-preview" />
    <Stack.Screen name="thesis-plan" />
    <Stack.Screen name="thesis-detail" />
    <Stack.Screen name="thesis-workspace" />
    <Stack.Screen name="block-editor" />
    <Stack.Screen name="lexical-lab" />
    <Stack.Screen name="lexical-roundtrip" />
    <Stack.Screen name="lexical-writeback" />
    <Stack.Screen name="news" />
    <Stack.Screen name="news-detail" />
    <Stack.Screen name="export" />
    <Stack.Screen name="export-success" />
    <Stack.Screen name="network-error" />
    <Stack.Screen name="import-analysis" />
    <Stack.Screen name="combine-arrange" />
  </Stack>;
}
