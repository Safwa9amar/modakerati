import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PushDrawer } from "@/components/PushDrawer";
import { ThemeProvider } from "@/components/ThemeProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
// import { ChatHead } from "@/components/ChatHead"; // disabled for now
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useProfileStore } from "@/stores/profile-store";
import { registerForPushNotificationsAsync, addNotificationListeners } from "@/lib/push-notifications";
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
      // PRIORITY-ORDERED, not three independent checks — otherwise the branches
      // fight and the router ping-pongs. Onboarding gates everything, then auth,
      // then the app. Each level only acts while the user is on the WRONG side,
      // and a lower level never runs until the higher condition is satisfied.
      //
      // The bug this fixes: an authenticated user who hasn't finished onboarding
      // used to bounce forever between (auth)/onboarding (sent there because
      // onboarding is incomplete) and (tabs) (sent there because "authenticated +
      // in (auth) → tabs"). Gating the tabs redirect behind hasCompletedOnboarding
      // breaks the loop — onboarding now wins until it's actually complete.
      if (!hasCompletedOnboarding) {
        // Must finish onboarding first; it lives in (auth). Don't redirect while
        // already inside (auth), or every step within the flow snaps back to it.
        if (!inAuthGroup) router.replace("/(auth)/onboarding" as any);
      } else if (!isAuthenticated) {
        if (!inAuthGroup) router.replace("/(auth)/login" as any);
      } else if (inAuthGroup) {
        router.replace("/(tabs)" as any);
      }
    }, Platform.OS === "android" ? 100 : 0);

    return () => clearTimeout(timer);
  }, [isAuthenticated, isLoading, hasCompletedOnboarding, segments]);
}

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const initialize = useAuthStore((s) => s.initialize);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const router = useRouter();

  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  useEffect(() => {
    async function prepare() {
      // Clear stale thesis cache (one-time migration)
      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      await AsyncStorage.removeItem("modakerati-thesis");

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

  // Push notifications bootstrap — runs only while authenticated.
  useEffect(() => {
    if (!isAuthenticated) return;

    registerForPushNotificationsAsync().catch(() => {});
    useProfileStore.getState().fetchProfile().catch(() => {});
    useNotificationStore.getState().loadPreferences().catch(() => {});
    useNotificationStore.getState().fetchNotifications().catch(() => {});

    const cleanup = addNotificationListeners((route) => router.push(route as never));
    return cleanup;
  }, [isAuthenticated]);

  useProtectedRoute();

  if (!appReady || !fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          {/* Root-level push drawer: opening the Thesis Structure outline slides
              the whole app left (header, document, tab bar) and reveals it on the
              right. Wraps everything so the push moves the entire tree as one. */}
          <PushDrawer>
            <BottomSheetModalProvider>
              <NetworkBanner />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="(app)" />
              </Stack>
              {/* Floating chat-head disabled for now — re-add <ChatHead /> here
                  (and its import) to restore the draggable bubble. */}
            </BottomSheetModalProvider>
          </PushDrawer>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
