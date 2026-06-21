import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

import type { NotificationData } from "@/types/notification";
import { registerPushToken, unregisterPushToken } from "@/lib/api";
import { useNotificationStore } from "@/stores/notification-store";

// SDK 56: NotificationBehavior uses shouldShowBanner / shouldShowList
// (replacing the deprecated shouldShowAlert), plus shouldPlaySound / shouldSetBadge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function resolveProjectId(): string | undefined {
  try {
    return (
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId ??
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * Registers the device for Expo push notifications and best-effort syncs the
 * token to the backend. Returns the Expo push token string, or null when push
 * is unavailable (simulator, denied permission, missing projectId, etc.).
 * Never throws.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    // Expo Go (SDK 53+) removed remote push support — getExpoPushTokenAsync
    // throws on Android there. Remote push requires a development build.
    if (isRunningInExpoGo()) {
      console.log("[push] skipping — remote push requires a development build, not Expo Go");
      return null;
    }

    if (!Device.isDevice) {
      console.log("[push] skipping — push notifications require a physical device");
      return null;
    }

    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          lightColor: "#5C6BFF",
        });
      } catch (err) {
        console.warn("[push] setNotificationChannelAsync failed", err);
      }
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.log("[push] permission not granted");
      return null;
    }

    const projectId = resolveProjectId();

    let token: string;
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      token = result.data;
    } catch (err) {
      console.warn("[push] getExpoPushTokenAsync failed", err);
      return null;
    }

    try {
      await registerPushToken(token, Platform.OS);
    } catch (err) {
      console.warn("[push] registerPushToken failed", err);
    }

    return token;
  } catch (err) {
    console.warn("[push] registerForPushNotificationsAsync failed", err);
    return null;
  }
}

/**
 * Best-effort: re-derive the current push token and unregister it on the
 * backend (used on logout if wired). Swallows all errors.
 */
export async function unregisterCurrentPushToken(): Promise<void> {
  try {
    if (isRunningInExpoGo()) return;
    const projectId = resolveProjectId();
    let token: string | undefined;
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      token = result.data;
    } catch {
      return;
    }
    if (!token) return;
    try {
      await unregisterPushToken(token);
    } catch {
      // swallow — best-effort
    }
  } catch {
    // swallow — best-effort
  }
}

/**
 * Subscribes to foreground arrival and tap-response events.
 * - On foreground arrival: refetch the authoritative list from the server.
 * - On tap: refetch, then route via onTapRoute if the payload carries a route.
 * Returns a cleanup function that removes both subscriptions.
 */
export function addNotificationListeners(
  onTapRoute: (route: string, data: NotificationData) => void
): () => void {
  let receivedSub: Notifications.EventSubscription | undefined;
  let responseSub: Notifications.EventSubscription | undefined;

  try {
    receivedSub = Notifications.addNotificationReceivedListener(() => {
      try {
        useNotificationStore.getState().fetchNotifications();
      } catch (err) {
        console.warn("[push] fetchNotifications (received) failed", err);
      }
    });
  } catch (err) {
    console.warn("[push] addNotificationReceivedListener failed", err);
  }

  try {
    responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response.notification.request.content.data as NotificationData;
        useNotificationStore.getState().fetchNotifications();
        if (data?.route) {
          onTapRoute(data.route, data);
        }
      } catch (err) {
        console.warn("[push] notification response handling failed", err);
      }
    });
  } catch (err) {
    console.warn("[push] addNotificationResponseReceivedListener failed", err);
  }

  return () => {
    try {
      receivedSub?.remove();
    } catch {
      // swallow
    }
    try {
      responseSub?.remove();
    } catch {
      // swallow
    }
  };
}
