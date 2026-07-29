import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useProfileStore } from "@/stores/profile-store";
import type { Session, User } from "@supabase/supabase-js";

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setSession: (session: Session | null) => void;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (
    email: string,
    password: string,
    fullName: string,
    university?: { id: string; name: string } | null
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,
  setSession: (session) => set({ session, user: session?.user ?? null, isAuthenticated: !!session, isLoading: false }),
  signInWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },
  // The university rides along in user_metadata because at signup there is no
  // session yet to PATCH a profile with — the DB trigger that creates the
  // profile row reads it from there (see supabase/migrations/003_profile_university.sql).
  // If that migration has not been applied the extra keys are simply ignored and
  // start-thesis asks for the institution inline instead; nothing breaks.
  signUpWithEmail: async (email, password, fullName, university) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(university ? { university: university.name, university_id: university.id } : {}),
        },
      },
    });
    return { error: error?.message ?? null };
  },
  signOut: async () => {
    await supabase.auth.signOut();
    useProfileStore.getState().reset();
    set({ session: null, user: null, isAuthenticated: false });
  },
  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    get().setSession(session);
    supabase.auth.onAuthStateChange((_event, session) => { get().setSession(session); });
  },
}));
