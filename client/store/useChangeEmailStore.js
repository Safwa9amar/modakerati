import { create } from 'zustand';

export const useChangeEmailStore = create((set) => ({
  newEmail: '',
  password: '',
  loading: false,
  error: null,
  setNewEmail: (val) => set({ newEmail: val }),
  setPassword: (val) => set({ password: val }),
  setLoading: (val) => set({ loading: val }),
  setError: (val) => set({ error: val }),
  reset: () => set({ newEmail: '', password: '', loading: false, error: null }),
}));
