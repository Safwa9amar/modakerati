import { create } from 'zustand';

export const useUpdateProfileStore = create((set) => ({
  displayName: '',
  phoneNumber: '',
  photoURL: '',
  email: '',
  loading: false,
  setDisplayName: (val) => set({ displayName: val }),
  setphoneNumber: (val) => set({ phoneNumber: val }),
  setPhotoURL: (val) => set({ photoURL: val }),
  setEmail: (val) => set({ email: val }),
  setLoading: (val) => set({ loading: val }),
  reset: () => set({ displayName: '', phoneNumber: '', photoURL: '', email: '', loading: false }),
}));
