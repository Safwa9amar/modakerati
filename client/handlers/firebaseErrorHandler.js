// Firebase error handler utility for user-friendly messages

import { useTranslation } from '@/localization/i18nProvider';

const firebaseErrorMap = {
  'auth/email-already-in-use': 'This email is already in use.',
  'auth/invalid-email': 'The email address is invalid.',
  'auth/user-disabled': 'This user account has been disabled.',
  'auth/user-not-found': 'No user found with this email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/popup-closed-by-user': 'Sign-in popup was closed.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled.',
  'auth/invalid-credential': 'The provided credential is invalid.',
  // Add more Firebase error codes as needed
};

export function getFirebaseErrorMessage(error,t) {
  if (!error) return '';
  const code = error.code || error.message;
  if (firebaseErrorMap[code]) {
    return t ? t(firebaseErrorMap[code]) : firebaseErrorMap[code];
  }
  // Fallback to error message
  return error.message || 'An unknown error occurred.';
}
