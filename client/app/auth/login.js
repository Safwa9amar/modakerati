import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useTranslation } from '@/localization/i18nProvider';
import Button from '@/components/common/Button';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import AntDesign from '@expo/vector-icons/AntDesign';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

export default function Login() {
  const { t } = useTranslation();
  const styles = useStyles();
  const theme = useTheme();
  const { login, loading, error, signInWithGoogleCredential } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Google Auth setup
  const [, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    clientId: '861687614333-i858dehm0gem69tc5c0598o9eha5lf1c.apps.googleusercontent.com',
    scopes: ['profile', 'email'],
    redirectUri: 'https://auth.expo.io/@astro0666/modakerati', // Replace with your actual redirect URI
    responseType: 'id_token',
  });
  console.log('googleResponse', googleResponse);
  // Handle Google sign-in response
  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const { id_token } = googleResponse.params;
      if (!id_token) {
        console.error('No ID token received from Google');
        return;
      }
      signInWithGoogleCredential(id_token);
    } else if (googleResponse?.type === 'error') {
      console.error('Google sign-in error:', googleResponse.error);
      // Handle specific error cases
      if (googleResponse.error?.message?.includes('access blocked')) {
        alert('Access blocked. Please check your Google Cloud Console configuration.');
      } else {
        alert('Error signing in with Google. Please try again.');
      }
    }
  }, [googleResponse]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const result = await googlePromptAsync();
      if (result.type === 'error') {
        console.error('Google sign-in error:', result.error);
        alert('Error signing in with Google. Please try again.');
      }
    } catch (error) {
      console.error('Error signing in with Google:', error);
      alert('Error signing in with Google. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleFacebookSignIn = async () => {
    setIsSigningIn(true);
    try {
      // TODO: Integrate Facebook sign-in with Firebase Auth and Zustand
      alert('Facebook sign-in is not yet implemented.');
    } catch (error) {
      alert(error.message);
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Image
          source={require('@/assets/fullLogo.png')}
          style={styles.logoIcon}
        />
        <Text style={styles.title}>{t('welcomeBack')}</Text>
        <Text style={styles.subtitle}>{t('loginSubtitle')}</Text>
      </View>
      <View style={styles.contentContainer}>
        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            placeholder={t('email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={theme.colors.gray[400]}
          />
          <TextInput
            style={styles.input}
            placeholder={t('newPassword')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={theme.colors.gray[400]}
          />
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <Button
          title={t('login')}
          onPress={async () => {
            await login(email, password);
            if (!useAuthStore.getState().error) {
              router.replace('/(tabs)');
            }
          }}
          isLoading={loading}
          style={styles.button}
        />
        <TouchableOpacity
          onPress={() => router.replace('/auth/register')}
          style={styles.linkContainer}
        >
          <Text style={styles.link}>{t('signUp')}</Text>
        </TouchableOpacity>
        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>{t('or')}</Text>
          <View style={styles.divider} />
        </View>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            disabled={isSigningIn}
            style={styles.googleBtn}
            onPress={handleGoogleSignIn}
          >
            <AntDesign name="google" size={24} color="red" />
          </TouchableOpacity>

          <TouchableOpacity
            disabled={isSigningIn}
            style={styles.googleBtn}
            onPress={handleFacebookSignIn}
          >
            <FontAwesome5 name="facebook" size={24} color="black" />
          </TouchableOpacity>
          
        </View>
        <TouchableOpacity
          style={styles.demoLink}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.demoText}>Demo Mode (Skip Login)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.main,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.text.main,
    marginBottom: theme.spacing[2],
  },
  subtitle: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[4],
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: theme.spacing[10],
    marginBottom: theme.spacing[2],
  },
  logoIcon: {
    marginBottom: theme.spacing[2],
    shadowColor: theme.colors.primary[100],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  contentContainer: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[4],
    alignItems: 'center',
  },
  inputCard: {
    width: '100%',
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[5],
    marginBottom: theme.spacing[4],
    shadowColor: theme.colors.primary[100],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  input: {
    height: 48,
    borderColor: theme.colors.primary[100],
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[3],
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.main,
    fontSize: theme.typography.fontSizes.md,
  },
  error: {
    color: theme.colors.error[600],
    marginBottom: theme.spacing[2],
    textAlign: 'center',
  },
  button: {
    width: 200,
    marginBottom: theme.spacing[3],
    borderRadius: theme.radius.md,
    shadowColor: theme.colors.primary[100],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    marginBottom: theme.spacing[2],
  },
  socialIcon: {
    width: 22,
    height: 22,
    marginRight: theme.spacing[2],
    resizeMode: 'contain',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: theme.spacing[2],
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.gray[200],
  },
  dividerText: {
    marginHorizontal: theme.spacing[2],
    color: theme.colors.gray[400],
    fontSize: theme.typography.fontSizes.sm,
    fontWeight: theme.typography.fontWeights.medium,
  },
  demoLink: {
    marginTop: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  demoText: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary[400],
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  linkContainer: {
    marginBottom: theme.spacing[2],
  },
  link: {
    color: theme.colors.primary[600],
    textDecorationLine: 'underline',
    textAlign: 'center',
    fontWeight: theme.typography.fontWeights.bold,
  },
  googleBtn: {
    borderWidth: 1,
    borderRadius: theme.radius.full,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 60,
    borderColor: theme.colors.gray[200],
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginBottom: theme.spacing[2],
    gap : theme.spacing[4],
  },
}));
