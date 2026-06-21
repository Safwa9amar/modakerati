import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearAllNotifications,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/api";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type AppNotification,
  type NotificationPreferences,
} from "@/types/notification";

// Stable reference for the "no notifications" case. Returning a fresh `[]`
// makes zustand's useSyncExternalStore see a new snapshot every render,
// causing an infinite render loop ("Maximum update depth exceeded").
const EMPTY: AppNotification[] = [];

function countUnread(notifications: AppNotification[]): number {
  return notifications.reduce((acc, n) => (n.isRead ? acc : acc + 1), 0);
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  preferences: NotificationPreferences;

  fetchNotifications: (opts?: { refresh?: boolean }) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  prependLocal: (n: AppNotification) => void; // called when a push arrives in foreground
  loadPreferences: () => Promise<void>;
  updatePreferences: (patch: Partial<NotificationPreferences>) => Promise<void>;
  reset: () => void; // on logout
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: EMPTY,
      unreadCount: 0,
      isLoading: false,
      isRefreshing: false,
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,

      fetchNotifications: async (opts) => {
        if (opts?.refresh) {
          set({ isRefreshing: true });
        } else {
          set({ isLoading: true });
        }
        try {
          const notifications = await listNotifications();
          const list = notifications ?? EMPTY;
          set({ notifications: list, unreadCount: countUnread(list) });
        } catch (err) {
          // Offline-safe: log and keep existing state, never throw.
          console.warn("[notifications] fetch failed", err);
        } finally {
          set({ isLoading: false, isRefreshing: false });
        }
      },

      markAsRead: async (id) => {
        // Optimistic local update.
        const next = get().notifications.map((n) =>
          n.id === id ? { ...n, isRead: true } : n
        );
        set({ notifications: next, unreadCount: countUnread(next) });
        try {
          await markNotificationRead(id);
        } catch (err) {
          // Best-effort: keep optimistic state, just log.
          console.warn("[notifications] markAsRead failed", err);
        }
      },

      markAllAsRead: async () => {
        const next = get().notifications.map((n) =>
          n.isRead ? n : { ...n, isRead: true }
        );
        set({ notifications: next, unreadCount: 0 });
        try {
          await markAllNotificationsRead();
        } catch (err) {
          console.warn("[notifications] markAllAsRead failed", err);
        }
      },

      remove: async (id) => {
        const next = get().notifications.filter((n) => n.id !== id);
        set({ notifications: next, unreadCount: countUnread(next) });
        try {
          await deleteNotification(id);
        } catch (err) {
          console.warn("[notifications] remove failed", err);
        }
      },

      clearAll: async () => {
        set({ notifications: EMPTY, unreadCount: 0 });
        try {
          await clearAllNotifications();
        } catch (err) {
          console.warn("[notifications] clearAll failed", err);
        }
      },

      prependLocal: (n) => {
        // De-dupe by id, then prepend.
        const existing = get().notifications.filter((x) => x.id !== n.id);
        const next = [n, ...existing];
        set({ notifications: next, unreadCount: countUnread(next) });
      },

      loadPreferences: async () => {
        try {
          const prefs = await getNotificationPreferences();
          set({
            preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs },
          });
        } catch (err) {
          console.warn("[notifications] loadPreferences failed", err);
        }
      },

      updatePreferences: async (patch) => {
        // Optimistic merge.
        const optimistic = { ...get().preferences, ...patch };
        set({ preferences: optimistic });
        try {
          const prefs = await updateNotificationPreferences(patch);
          set({
            preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs },
          });
        } catch (err) {
          console.warn("[notifications] updatePreferences failed", err);
        }
      },

      reset: () =>
        set({
          notifications: EMPTY,
          unreadCount: 0,
          isLoading: false,
          isRefreshing: false,
          preferences: DEFAULT_NOTIFICATION_PREFERENCES,
        }),
    }),
    {
      name: "modakerati-notifications",
      storage: createJSONStorage(() => AsyncStorage),
      // Persist ONLY preferences — the list is always refetched from server.
      partialize: (state) => ({ preferences: state.preferences }),
    }
  )
);
