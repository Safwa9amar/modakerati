import { create } from 'zustand';

export const useChangePasswordStore = create((set) => ({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
  loading: false,
  error: null,
  setOldPassword: (val) => set({ oldPassword: val }),
  setNewPassword: (val) => set({ newPassword: val }),
  setConfirmPassword: (val) => set({ confirmPassword: val }),
  setLoading: (val) => set({ loading: val }),
  setError: (val) => set({ error: val }),
  reset: () => set({ oldPassword: '', newPassword: '', confirmPassword: '', loading: false, error: null }),
}));
