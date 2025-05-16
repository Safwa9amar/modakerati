import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import ContextProvider from '@/components/ContextProvider';

export default function RootLayout() {

  return (
    <ContextProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen
          name="(onboarding)/index"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen name="auth/login" options={{ headerShown: false }} />
        <Stack.Screen name="auth/register" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" options={{ title: 'Not Found' }} />
      </Stack>
      <StatusBar style="auto" />
    </ContextProvider>
  );
}
