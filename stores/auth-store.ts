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
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
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
  signUpWithEmail: async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
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
