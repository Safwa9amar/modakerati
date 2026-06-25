import { Stack } from "expo-router";
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
    <Stack.Screen name="settings" />
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
    <Stack.Screen name="news" />
    <Stack.Screen name="news-detail" />
    <Stack.Screen name="documents" />
    <Stack.Screen name="document-editor" />
    <Stack.Screen name="document-view" />
    <Stack.Screen name="export" />
    <Stack.Screen name="export-success" />
    <Stack.Screen name="auto-layout" />
    <Stack.Screen name="auto-numbering" />
    <Stack.Screen name="auto-toc" />
    <Stack.Screen name="list-figures" />
    <Stack.Screen name="list-tables" />
    <Stack.Screen name="citations" />
    <Stack.Screen name="ai-enhance" />
    <Stack.Screen name="network-error" />
  </Stack>;
}
