import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useTranslation } from '@/localization/i18nProvider';
import Button from '@/components/common/Button';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import { router } from 'expo-router';

export default function Register() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(theme);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { register, loading, error } = useAuthStore();

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword) {
      Alert.alert(t('error'), t('fillAllFields'));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t('error'), t('passwordsNoMatch'));
      return;
    }
    await register(email, password);
    if (!useAuthStore.getState().error) {
      router.replace('/(tabs)');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('signUp')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('newEmail')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder={t('newPassword')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TextInput
        style={styles.input}
        placeholder={t('confirmPassword')}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={t('signUp')} onPress={handleRegister} isLoading={loading} style={styles.button} />
      <TouchableOpacity onPress={() => router.replace('/auth/login')} style={styles.linkContainer}>
        <Text style={styles.link}>{t('login')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.main,
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing[6],
    },
    title: {
      fontSize: theme.typography.fontSizes['2xl'],
      fontWeight: theme.typography.fontWeights.bold,
      color: theme.colors.primary[700],
      marginBottom: theme.spacing[6],
    },
    input: {
      width: '100%',
      borderWidth: 1,
      borderColor: theme.colors.primary[200],
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.radius.md,
      padding: theme.spacing[4],
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.main,
      marginBottom: theme.spacing[3],
    },
    button: {
      width: '100%',
      marginTop: theme.spacing[2],
    },
    error: {
      color: theme.colors.error[600],
      marginBottom: theme.spacing[2],
      textAlign: 'center',
    },
    linkContainer: {
      marginTop: theme.spacing[4],
    },
    link: {
      color: theme.colors.primary[600],
      fontWeight: theme.typography.fontWeights.bold,
      textAlign: 'center',
    },
  });
