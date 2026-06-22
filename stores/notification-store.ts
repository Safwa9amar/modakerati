import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  listNotifications,
  getUnreadCount,
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

// How many notifications to pull per page for infinite scroll.
const PAGE_SIZE = 20;

function countUnread(notifications: AppNotification[]): number {
  return notifications.reduce((acc, n) => (n.isRead ? acc : acc + 1), 0);
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  preferences: NotificationPreferences;

  fetchNotifications: (opts?: { refresh?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
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
      isLoadingMore: false,
      hasMore: true,
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,

      fetchNotifications: async (opts) => {
        if (opts?.refresh) {
          set({ isRefreshing: true });
        } else {
          set({ isLoading: true });
        }
        try {
          // Fetch the first page and the authoritative unread total together.
          // The total comes from the server (not the loaded page) so the badge
          // stays correct even though only PAGE_SIZE rows are loaded.
          const [notifications, unread] = await Promise.all([
            listNotifications({ limit: PAGE_SIZE }),
            getUnreadCount().catch(() => null),
          ]);
          const list = notifications ?? EMPTY;
          set({
            notifications: list,
            unreadCount: unread?.count ?? countUnread(list),
            hasMore: list.length >= PAGE_SIZE,
          });
        } catch (err) {
          // Offline-safe: log and keep existing state, never throw.
          console.warn("[notifications] fetch failed", err);
        } finally {
          set({ isLoading: false, isRefreshing: false });
        }
      },

      loadMore: async () => {
        const { isLoadingMore, hasMore, isLoading, isRefreshing, notifications } =
          get();
        // Nothing more to fetch, or a fetch is already in flight.
        if (isLoadingMore || isLoading || isRefreshing || !hasMore) return;
        if (notifications.length === 0) return;

        const before = notifications[notifications.length - 1].createdAt;
        set({ isLoadingMore: true });
        try {
          const page = await listNotifications({ limit: PAGE_SIZE, before });
          const older = page ?? EMPTY;
          // De-dupe against what we already hold (guards against cursor ties).
          const seen = new Set(get().notifications.map((n) => n.id));
          const fresh = older.filter((n) => !seen.has(n.id));
          const merged = fresh.length
            ? [...get().notifications, ...fresh]
            : get().notifications;
          // unreadCount is the authoritative server total — revealing older
          // rows doesn't change it, so leave it untouched here.
          set({
            notifications: merged,
            hasMore: older.length >= PAGE_SIZE,
          });
        } catch (err) {
          console.warn("[notifications] loadMore failed", err);
        } finally {
          set({ isLoadingMore: false });
        }
      },

      markAsRead: async (id) => {
        // Optimistic local update. Adjust the authoritative count by delta.
        const { notifications, unreadCount } = get();
        const target = notifications.find((n) => n.id === id);
        const wasUnread = target ? !target.isRead : false;
        const next = notifications.map((n) =>
          n.id === id ? { ...n, isRead: true } : n
        );
        set({
          notifications: next,
          unreadCount: wasUnread ? Math.max(0, unreadCount - 1) : unreadCount,
        });
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
        const { notifications, unreadCount } = get();
        const target = notifications.find((n) => n.id === id);
        const wasUnread = target ? !target.isRead : false;
        const next = notifications.filter((n) => n.id !== id);
        set({
          notifications: next,
          unreadCount: wasUnread ? Math.max(0, unreadCount - 1) : unreadCount,
        });
        try {
          await deleteNotification(id);
        } catch (err) {
          console.warn("[notifications] remove failed", err);
        }
      },

      clearAll: async () => {
        set({ notifications: EMPTY, unreadCount: 0, hasMore: false });
        try {
          await clearAllNotifications();
        } catch (err) {
          console.warn("[notifications] clearAll failed", err);
        }
      },

      prependLocal: (n) => {
        // De-dupe by id, then prepend. Adjust the authoritative count by delta
        // so a foreground push updates the badge without a full refetch.
        const { notifications, unreadCount } = get();
        const prev = notifications.find((x) => x.id === n.id);
        const existing = notifications.filter((x) => x.id !== n.id);
        const next = [n, ...existing];
        const delta = (n.isRead ? 0 : 1) - (prev && !prev.isRead ? 1 : 0);
        set({ notifications: next, unreadCount: Math.max(0, unreadCount + delta) });
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
          isLoadingMore: false,
          hasMore: true,
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
