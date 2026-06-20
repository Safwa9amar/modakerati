import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface PendingAction {
  id: string;
  type: "create_thesis" | "update_thesis" | "update_section" | "delete_thesis" | "add_chapter" | "delete_chapter";
  payload: Record<string, any>;
  createdAt: string;
}

interface OfflineState {
  pendingActions: PendingAction[];
  lastSyncedAt: string | null;
  addPendingAction: (type: PendingAction["type"], payload: Record<string, any>) => void;
  clearPendingActions: () => void;
  setLastSynced: () => void;
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set) => ({
      pendingActions: [],
      lastSyncedAt: null,

      addPendingAction: (type, payload) =>
        set((s) => ({
          pendingActions: [
            ...s.pendingActions,
            {
              id: Math.random().toString(36).substring(2, 15),
              type,
              payload,
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      clearPendingActions: () => set({ pendingActions: [] }),

      setLastSynced: () => set({ lastSyncedAt: new Date().toISOString() }),
    }),
    {
      name: "modakerati-offline",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
