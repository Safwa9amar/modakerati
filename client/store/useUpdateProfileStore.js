import { create } from 'zustand';

export const useUpdateProfileStore = create((set) => ({
  displayName: '',
  phone: '',
  photoURL: '',
  email: '',
  loading: false,
  setDisplayName: (val) => set({ displayName: val }),
  setPhone: (val) => set({ phone: val }),
  setPhotoURL: (val) => set({ photoURL: val }),
  setEmail: (val) => set({ email: val }),
  setLoading: (val) => set({ loading: val }),
  reset: () => set({ displayName: '', phone: '', photoURL: '', email: '', loading: false }),
}));
