import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, KeyRound } from 'lucide-react-native';
import { useAuthStore } from '@/store/useAuthStore';
import { useChangePasswordStore } from '@/store/useChangePasswordStore';

export default function ChangePassword() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const styles = useStyles(theme);
  const isRTL = theme.isRTL;
  const {
    oldPassword,
    newPassword,
    confirmPassword,
    error,
    setOldPassword,
    setNewPassword,
    setConfirmPassword,
    setError,
    reset,
  } = useChangePasswordStore();
  const {loading, updateUserPassword } = useAuthStore();

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setError(t('fillAllFields'));
      Alert.alert(t('error'), t('fillAllFields'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('passwordsNoMatch'));
      Alert.alert(t('error'), t('passwordsNoMatch'));
      return;
    }
    setError(null);
    try {
      await updateUserPassword(oldPassword, newPassword);
      reset();
      Alert.alert(t('success'), t('passwordChanged'));
      navigation.goBack();
    } catch (error) {
      setError(error.message || t('error'));
      Alert.alert(t('error'), error.message || t('error'));
    }
  };

  React.useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('changePassword'),
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
      <Text style={[styles.label, isRTL && { textAlign: 'right' }]}>{t('oldPassword')}</Text>
      <TextInput
        style={[styles.input, isRTL && { textAlign: 'right' }]}
        value={oldPassword}
        onChangeText={setOldPassword}
        placeholder={t('oldPasswordPlaceholder')}
        placeholderTextColor={theme.colors.text.secondary}
        secureTextEntry
      />
      <Text style={[styles.label, isRTL && { textAlign: 'right' }]}>{t('newPassword')}</Text>
      <TextInput
        style={[styles.input, isRTL && { textAlign: 'right' }]}
        value={newPassword}
        onChangeText={setNewPassword}
        placeholder={t('newPasswordPlaceholder')}
        placeholderTextColor={theme.colors.text.secondary}
        secureTextEntry
      />
      <Text style={[styles.label, isRTL && { textAlign: 'right' }]}>{t('confirmPassword')}</Text>
      <TextInput
        style={[styles.input, isRTL && { textAlign: 'right' }]}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder={t('confirmPasswordPlaceholder')}
        placeholderTextColor={theme.colors.text.secondary}
        secureTextEntry
      />
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleChangePassword}
        disabled={loading}
        activeOpacity={0.8}
      >
        <KeyRound size={20} color={theme.colors.white} style={{ marginEnd: 8 }} />
        <Text style={styles.buttonText}>{t('changePassword')}</Text>
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
