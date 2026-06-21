import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getProfile, updateProfile } from "@/lib/api";
import type { Profile, ProfileUpdate } from "@/types/profile";

interface ProfileState {
  profile: Profile | null;
  isLoading: boolean;
  isSaving: boolean;

  fetchProfile: () => Promise<void>;
  saveProfile: (patch: ProfileUpdate) => Promise<{ error: string | null }>;
  reset: () => void; // on logout
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: null,
      isLoading: false,
      isSaving: false,

      fetchProfile: async () => {
        set({ isLoading: true });
        try {
          const profile = await getProfile();
          set({ profile });
        } catch (err) {
          // Offline-safe: keep the persisted profile, never throw.
          console.warn("[profile] fetch failed", err);
        } finally {
          set({ isLoading: false });
        }
      },

      saveProfile: async (patch) => {
        // Optimistic merge so the UI reflects the edit immediately.
        const current = get().profile;
        if (current) set({ profile: { ...current, ...patch } });
        set({ isSaving: true });
        try {
          const updated = await updateProfile(patch);
          set({ profile: updated });
          return { error: null };
        } catch (err) {
          // Roll back the optimistic merge and surface the error to the screen.
          if (current) set({ profile: current });
          const message =
            err instanceof Error ? err.message : "Failed to save profile";
          console.warn("[profile] save failed", err);
          return { error: message };
        } finally {
          set({ isSaving: false });
        }
      },

      reset: () => set({ profile: null, isLoading: false, isSaving: false }),
    }),
    {
      name: "modakerati-profile",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ profile: state.profile }),
    }
  )
);
