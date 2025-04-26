import { useState, useEffect, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Facebook from 'expo-auth-session/providers/facebook';
import { router } from 'expo-router';

WebBrowser.maybeCompleteAuthSession();

// Replace with your own OAuth credentials
const GOOGLE_CLIENT_ID = 'your-google-client-id.apps.googleusercontent.com';
const FACEBOOK_APP_ID = 'your-facebook-app-id';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Google Auth setup
  const [, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: ['profile', 'email'],
  });

  // Facebook Auth setup
  const [, fbResponse, fbPromptAsync] = Facebook.useAuthRequest({
    clientId: FACEBOOK_APP_ID,
  });

  useEffect(() => {
    // Check for stored user on component mount
    loadUser();
  }, []);

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const { authentication } = googleResponse;
      // In a real app, you'd exchange this token with your backend
      // and get user info from Google API
      const mockGoogleUser = {
        id: 'google-user-id',
        name: 'Google User',
        email: 'google@example.com',
        provider: 'google',
        token: authentication.accessToken,
      };
      handleSignIn(mockGoogleUser);
    }
  }, [googleResponse]);

  useEffect(() => {
    if (fbResponse?.type === 'success') {
      const { authentication } = fbResponse;
      // In a real app, you'd exchange this token with your backend
      // and get user info from Facebook API
      const mockFacebookUser = {
        id: 'facebook-user-id',
        name: 'Facebook User',
        email: 'facebook@example.com',
        provider: 'facebook',
        token: authentication.accessToken,
      };
      handleSignIn(mockFacebookUser);
    }
  }, [fbResponse]);

  const loadUser = async () => {
    try {
      const userJSON = await AsyncStorage.getItem('user');
      if (userJSON) {
        setUser(JSON.parse(userJSON));
      }
    } catch (error) {
      console.error('Failed to load user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async (userData) => {
    try {
      setUser(userData);
      await AsyncStorage.setItem('user', JSON.stringify(userData));
      router.replace('/(tabs)');
    } catch (error) {
      console.error('Error signing in:', error);
    }
  };

  const signOut = async () => {
    try {
      await AsyncStorage.removeItem('user');
      setUser(null);
      router.replace('/auth/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        signInWithGoogle: () => googlePromptAsync(),
        signInWithFacebook: () => fbPromptAsync(),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);