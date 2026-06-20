import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider } from "@/components/ThemeProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getStoredLanguage } from "@/lib/i18n";
import i18n from "@/lib/i18n";
import "../global.css";

SplashScreen.preventAutoHideAsync();

function useProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    // Small delay for Android — router needs a tick to be ready
    const timer = setTimeout(() => {
      if (!hasCompletedOnboarding) {
        router.replace("/(auth)/onboarding" as any);
      } else if (!isAuthenticated && !inAuthGroup) {
        router.replace("/(auth)/login" as any);
      } else if (isAuthenticated && inAuthGroup) {
        router.replace("/(tabs)" as any);
      }
    }, Platform.OS === "android" ? 100 : 0);

    return () => clearTimeout(timer);
  }, [isAuthenticated, isLoading, hasCompletedOnboarding, segments]);
}

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const initialize = useAuthStore((s) => s.initialize);

  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    async function prepare() {
      const lang = await getStoredLanguage();
      await i18n.changeLanguage(lang);
      await initialize();
      setAppReady(true);
    }
    prepare();
  }, []);

  useEffect(() => {
    if (appReady && fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [appReady, fontsLoaded]);

  useProtectedRoute();

  if (!appReady || !fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <NetworkBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
