import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { SplashScreen, Stack, useRouter, useSegments } from "expo-router";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PushDrawer } from "@/components/PushDrawer";
import { BottomInsertDrawer } from "@/components/BottomInsertDrawer";
import { DockToolsSheet } from "@/components/DockToolsSheet";
import { HeaderFooterSheet } from "@/components/HeaderFooterSheet";
import { CaptionSheet } from "@/components/CaptionSheet";
import { EquationSheet } from "@/components/EquationSheet";
import { ThemeProvider } from "@/components/ThemeProvider";
import { NetworkBanner } from "@/components/NetworkBanner";
// import { ChatHead } from "@/components/ChatHead"; // disabled for now
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useProfileStore } from "@/stores/profile-store";
import { useThesisStore } from "@/stores/thesis-store";
import { listTheses } from "@/lib/api";
import { registerForPushNotificationsAsync, addNotificationListeners } from "@/lib/push-notifications";
import { applyDeviceRTLOnFirstLaunch, getStoredLanguage, restartApp } from "@/lib/i18n";
import i18n from "@/lib/i18n";
import "../global.css";

SplashScreen.preventAutoHideAsync();

// The app's root surface is the chat, on the thesis you last worked on — there is
// no dashboard to land on any more. It takes no params (the chat reads the current
// thesis from the store, restored below), and with no thesis at all it renders the
// empty writer's starters, so this href is correct in every state.
const HOME_HREF = "/(app)/chat";

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
      // onboarding is incomplete) and the app (sent there because "authenticated +
      // in (auth) → app"). Gating the app redirect behind hasCompletedOnboarding
      // breaks the loop — onboarding now wins until it's actually complete.
      if (!hasCompletedOnboarding) {
        // Must finish onboarding first; it lives in (auth). Don't redirect while
        // already inside (auth), or every step within the flow snaps back to it.
        if (!inAuthGroup) router.replace("/(auth)/onboarding" as any);
      } else if (!isAuthenticated) {
        if (!inAuthGroup) router.replace("/(auth)/login" as any);
      } else if (inAuthGroup) {
        router.replace(HOME_HREF as any);
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

      // The student's chosen language, or the device's on a fresh install.
      const lang = await getStoredLanguage();
      await i18n.changeLanguage(lang);
      // The settings store is the other reader of this (the Settings radio, and
      // the language AI completions are written in). It holds its own persisted
      // copy, so line it up with i18next — the text on screen is the truth.
      // Deferred until `persist` has rehydrated: writing before that lands, then
      // gets replaced by whatever was on disk a tick later.
      const syncSettingsLanguage = () => {
        if (useSettingsStore.getState().language !== lang) {
          useSettingsStore.getState().setLanguage(lang);
        }
      };
      if (useSettingsStore.persist.hasHydrated()) syncSettingsLanguage();
      else useSettingsStore.persist.onFinishHydration(syncSettingsLanguage);
      // Arabic must be laid out right-to-left, and RN only mirrors at startup.
      // Still behind the splash screen here, so the reboot is invisible — and it
      // happens at most once per install (see applyDeviceRTLOnFirstLaunch).
      if (await applyDeviceRTLOnFirstLaunch(lang)) {
        // Nothing below runs once the reload lands. Give it a moment to, then
        // launch anyway — a mirrored-wrong first session beats a stuck splash.
        if (await restartApp(0)) await new Promise((r) => setTimeout(r, 2000));
      }
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

    // Restore WHICH thesis the app is about. The chat is the first screen and it
    // reads `currentThesisId` from the (in-memory) thesis store, so without this
    // every cold start would open on "pick a thesis" even for a returning student.
    // The id lands synchronously from the persisted setting; the list follows over
    // the network and only supplies titles.
    const remembered = useSettingsStore.getState().lastThesisId;
    if (remembered) useThesisStore.getState().setCurrentThesis(remembered);
    listTheses()
      .then((rows) => {
        const store = useThesisStore.getState();
        store.setTheses(rows);
        // The remembered thesis can be gone — deleted here or on another device.
        // Fall back to the most recently touched one rather than stranding the
        // chat on an id the server no longer knows.
        if (!rows.some((r) => r.id === store.currentThesisId)) {
          const newest = [...rows].sort((a, b) =>
            (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
          )[0];
          store.setCurrentThesis(newest?.id ?? null);
          useSettingsStore.getState().setLastThesisId(newest?.id ?? null);
        }
      })
      .catch(() => {
        // Offline / transient: keep whatever the persisted id gave us.
      });

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
            <BottomInsertDrawer>
            {/* Running header / footer editor — same push-drawer surface as the Insert
                menu. Nested INSIDE it: only one of the two is ever open. */}
            <HeaderFooterSheet>
            {/* Word's Insert Caption dialog — same push-drawer surface, nested the
                same way: only one of the three sheets is ever open. */}
            <CaptionSheet>
            {/* Word's Insert Equation — the same push-drawer surface again, nested
                the same way: only one of the sheets is ever open. */}
            <EquationSheet>
            {/* The writer's global document tools — same push-drawer surface again,
                opened by the bottom-edge grip or the bubble's ⋮⋮ drop target. */}
            <DockToolsSheet>
            <BottomSheetModalProvider>
              <NetworkBanner />
              {/* gestureEnabled: false — see app/(app)/_layout.tsx. The root stack
                  claims the same leading edge the drawer's open-swipe needs. */}
              <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(app)" />
              </Stack>
              {/* Floating chat-head disabled for now — re-add <ChatHead /> here
                  (and its import) to restore the draggable bubble. */}
            </BottomSheetModalProvider>
            </DockToolsSheet>
            </EquationSheet>
            </CaptionSheet>
            </HeaderFooterSheet>
            </BottomInsertDrawer>
          </PushDrawer>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
