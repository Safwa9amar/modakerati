import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/localization/i18nProvider';
import Button from '@/components/common/Button';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import { LogIn } from 'lucide-react-native';

export default function Login() {
  const { signInWithGoogle, signInWithFacebook } = useAuth();
  const { t } = useTranslation();
  const styles = useStyles();
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      setIsSigningIn(true);
      await signInWithGoogle();
    } catch (error) {
      console.error('Google sign in error:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleFacebookSignIn = async () => {
    try {
      setIsSigningIn(true);
      await signInWithFacebook();
    } catch (error) {
      console.error('Facebook sign in error:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
         <Text style={styles.title}>{t('welcomeBack')}</Text>
        <Text style={styles.subtitle}>{t('loginSubtitle')}</Text>
        <Image source={require('@/assets/logo.png')} style={styles.logoIcon} />
      </View>

      <View style={styles.contentContainer}>
       

      
        <View style={styles.buttonContainer}>
          <Button
            title={t('loginWithGoogle')}
            onPress={handleGoogleSignIn}
            isLoading={isSigningIn}
            style={styles.button}
          />

          <Button
            title={t('loginWithFacebook')}
            onPress={handleFacebookSignIn}
            isLoading={isSigningIn}
            variant="secondary"
            style={styles.button}
          />
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
    backgroundColor: theme.colors.white,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: theme.spacing[12],
  },
  logoIcon: {
    marginBottom: theme.spacing[2],
  },
  appName: {
    fontSize: theme.typography.fontSizes['2xl'],
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.primary[600],
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[8],
    alignItems: 'center',
  },
  title: {
    fontSize: theme.typography.fontSizes['3xl'],
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.gray[600],
    textAlign: 'center',
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[6],
  },
  image: {
    width: '100%',
    height: 250,
    borderRadius: theme.radius.lg,
    marginBottom: theme.spacing[8],
  },
  buttonContainer: {
    width: '100%',
  },
  button: {
    marginBottom: theme.spacing[4],
  },
  demoLink: {
    marginTop: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  demoText: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.primary[600],
    textDecorationLine: 'underline',
  },
}));
