import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getProfile, updateProfile } from "@/lib/api";
import type { Profile, ProfileUpdate } from "@/types/profile";

interface ProfileState {
  profile: Profile | null;
  isLoading: boolean;
  isSaving: boolean;
  /**
   * Why the last fetch failed, or null if it succeeded. A failed read used to be
   * indistinguishable from "this account has no details yet": the screen showed
   * an empty, editable form, and saving it would PUT those blanks over a profile
   * that was fine on the server. Screens MUST refuse to edit while this is set.
   */
  loadError: string | null;

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
      loadError: null,

      fetchProfile: async () => {
        set({ isLoading: true, loadError: null });
        try {
          const profile = await getProfile();
          set({ profile, loadError: null });
        } catch (err) {
          // Offline-safe: keep the persisted profile, never throw — but RECORD
          // the failure, so a screen can tell "couldn't reach the server" apart
          // from "this profile is genuinely empty".
          const message = err instanceof Error ? err.message : "Failed to load profile";
          console.warn("[profile] fetch failed", err);
          set({ loadError: message });
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

      reset: () => set({ profile: null, isLoading: false, isSaving: false, loadError: null }),
    }),
    {
      name: "modakerati-profile",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ profile: state.profile }),
    }
  )
);
