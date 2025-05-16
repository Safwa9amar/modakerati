import { create } from 'zustand';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithCredential,
  updateEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
  setPersistence,
  indexedDBLocalPersistence,
} from 'firebase/auth';

import { initializeApp } from 'firebase/app';
import Constants from 'expo-constants';
import { getFirebaseErrorMessage } from '@/handlers/firebaseErrorHandler';

const firebaseConfig = {
  apiKey:
    Constants.expoConfig?.extra?.firebaseApiKey || process.env.GOOGLE_API_KEY,
  projectId: Constants.expoConfig?.extra?.firebaseProjectId || 'modakerati',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
export const fireBaseAuth = getAuth(app);

// Set persistence to use ReactNativeAsyncStorage
setPersistence(auth, indexedDBLocalPersistence).catch((error) => {
  console.error('Error setting auth persistence:', error);
});

export const useAuthStore = create((set, get) => ({
  user: null,
  loading: false,
  error: null,
  idToken: null,

  init: () => {
    set({ loading: true });
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const idToken = await firebaseUser.getIdToken();
          set({ user: firebaseUser, idToken, loading: false });
        } catch (error) {
          console.error('Error getting ID token:', error);
          set({ user: firebaseUser, loading: false });
        }
      } else {
        set({ user: null, idToken: null, loading: false });
      }
    });
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
      set({ idToken: await auth.currentUser.getIdToken() });
      set({ error: null });
    } catch (error) {
      set({ error: getFirebaseErrorMessage(error) });
    } finally {
      set({ loading: false });
    }
  },

  register: async (email, password) => {
    set({ loading: true, error: null });
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      set({ idToken: await auth.currentUser.getIdToken() });
      set({ error: null });
    } catch (error) {
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    set({ loading: true, error: null });
    try {
      await signOut(auth);
      set({ user: null, error: null, idToken: null });
    } catch (error) {
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },

  updateUserProfile: async (profile) => {
    set({ loading: true, error: null });
    try {
      await updateProfile(auth.currentUser, profile);
      set({ idToken: await auth.currentUser.getIdToken() });
      set({ error: null });
    } catch (error) {
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },

  updateUserEmail: async (password, newEmail) => {
    set({ loading: true, error: null });
    try {
      //updateEmail
      const user = auth.currentUser;
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      // Check if the new email is different from the current email
      if (user.email !== newEmail) {
        // Update the email address
        await updateEmail(user, newEmail);
      } else {
        throw new Error('New email cannot be the same as the current email.');
      }
      // If the email is updated successfully, you can also update the user's profile
      await updateProfile(user, { email: newEmail });
      set({ idToken: await auth.currentUser.getIdToken() });
      set({ error: null });
    } catch (error) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  updateUserPassword: async (oldPassword, newPassword) => {
    set({ loading: true, error: null });
    try {
      //updatePassword
      const user = auth.currentUser;
      const credential = EmailAuthProvider.credential(user.email, oldPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      set({ idToken: await auth.currentUser.getIdToken() });
      set({ error: null });
    } catch (error) {
      console.log('Error updating password:', error);
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  signInWithGoogleCredential: async (idToken) => {
    set({ loading: true, error: null });
    try {
      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      set({ idToken: await auth.currentUser.getIdToken() });
      set({ error: null });
    } catch (error) {
      console.log('Error signing in with Google:', error);
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },

  deleteUser: async () => {
    set({ loading: true, error: null });
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('No user is currently signed in.');
      await deleteUser(user);
      set({ user: null, error: null, idToken: null });
    } catch (error) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
}));
