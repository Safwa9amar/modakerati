import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Mail } from 'lucide-react-native';
import { useChangeEmailStore } from '@/store/useChangeEmailStore';
import { useAuthStore } from '@/store/useAuthStore';

export default function ChangeEmail() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const styles = useStyles(theme);
  const isRTL = theme.isRTL;
  const {
    newEmail,
    password,
    error,
    setNewEmail,
    setPassword,
    setError,
    reset,
  } = useChangeEmailStore();
  const {loading, updateUserEmail } = useAuthStore();

  const handleChangeEmail = async () => {
    if (!newEmail || !password) {
      setError(t('fillAllFields'));
      Alert.alert(t('error'), t('fillAllFields'));
      return;
    }
    setError(null);
    try {
      await updateUserEmail(password, newEmail);
      reset();
      Alert.alert(t('success'), t('emailChanged'));
      navigation.goBack();
    } catch (error) {
      setError(error.message || t('error'));
      Alert.alert(t('error'), error.message || t('error'));
    }
  };

  React.useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('changeEmail'),
      headerTitleStyle: {
        fontSize: theme.typography.fontSizes.xl,
        fontWeight: theme.typography.fontWeights.bold,
        color: theme.colors.text.main,
      },
      headerStyle: {
        backgroundColor: theme.colors.background.main,
      },
      headerTintColor: theme.colors.black,
      headerLeft: () => (
        <View style={{ paddingLeft: 16 }}>
          <ArrowLeft size={28} color={theme.colors.black} onPress={() => navigation.goBack()} />
        </View>
      ),
    });
  }, [theme, navigation, t]);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, isRTL && { textAlign: 'right' }]}>{t('newEmail')}</Text>
      <TextInput
        style={[styles.input, isRTL && { textAlign: 'right' }]}
        value={newEmail}
        onChangeText={setNewEmail}
        placeholder={t('newEmailPlaceholder')}
        placeholderTextColor={theme.colors.text.secondary}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Text style={[styles.label, isRTL && { textAlign: 'right' }]}>{t('password')}</Text>
      <TextInput
        style={[styles.input, isRTL && { textAlign: 'right' }]}
        value={password}
        onChangeText={setPassword}
        placeholder={t('passwordPlaceholder')}
        placeholderTextColor={theme.colors.text.secondary}
        secureTextEntry
      />
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleChangeEmail}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Mail size={20} color={theme.colors.white} style={{ marginEnd: 8 }} />
        <Text style={styles.buttonText}>{t('changeEmail')}</Text>
      </TouchableOpacity>
      {error && (
        <Text style={{ color: theme.colors.error[600], textAlign: 'center', marginTop: theme.spacing[2] }}>{error}</Text>
      )}
    </View>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.main,
      padding: theme.spacing[5],
    },
    label: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.main,
      marginBottom: theme.spacing[1],
      marginTop: theme.spacing[2],
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.primary[200],
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.radius.md,
      padding: theme.spacing[4],
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.main,
      marginBottom: theme.spacing[2],
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary[600],
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing[3],
      marginTop: theme.spacing[4],
    },
    buttonDisabled: {
      backgroundColor: theme.colors.primary[200],
    },
    buttonText: {
      color: theme.colors.white,
      fontWeight: theme.typography.fontWeights.bold,
      fontSize: theme.typography.fontSizes.md,
    },
  });
