import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, User } from 'lucide-react-native';
import { useAuthStore } from '@/store/useAuthStore';
import { useUpdateProfileStore } from '@/store/useUpdateProfileStore';

export default function UpdateProfile() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const styles = useStyles(theme);
  const { user: authUser, updateUserProfile, loading: authLoading } = useAuthStore();
  const {
    displayName,
    setDisplayName,
    phone,
    setPhone,
    photoURL,
    setPhotoURL,
    email,
    setEmail,
    loading,
    setLoading,
    reset
  } = useUpdateProfileStore();

  React.useEffect(() => {
    setDisplayName(authUser?.displayName || '');
    setPhone(authUser?.phoneNumber || '');
    setPhotoURL(authUser?.photoURL || '');
    setEmail(authUser?.email || '');
    return () => reset();
  }, [authUser]);

  React.useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('updateProfile') || 'Update Profile',
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

  const handleUpdate = async () => {
    if (!displayName || !email) {
      Alert.alert(t('error'), t('fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      // Only update fields that are supported by Firebase Auth
      await updateUserProfile({ displayName, photoURL });
      // If email changed, call updateUserEmail
      if (email !== authUser?.email) {
        // You may want to require password re-auth for email change in production
        await updateUserProfile({ email });
      }
      // Phone number is not directly updatable via Firebase Auth client SDK
      Alert.alert(t('success'), t('profileUpdated'));
      navigation.goBack();
    } catch (error) {
      Alert.alert(t('error'), error.message || t('error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.avatarContainer}>
        <User size={56} color={theme.colors.primary[600]} />
      </View>
      <Text style={styles.label}>{t('displayName') || 'Name'}</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={t('displayNamePlaceholder') || 'Enter your name'}
        placeholderTextColor={theme.colors.text.secondary}
      />
      <Text style={styles.label}>{t('email') || 'Email'}</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder={t('emailPlaceholder') || 'Enter your email'}
        placeholderTextColor={theme.colors.text.secondary}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Text style={styles.label}>{t('phone')}</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder={t('phonePlaceholder') || 'Enter your phone number'}
        placeholderTextColor={theme.colors.text.secondary}
        keyboardType="phone-pad"
      />
      <Text style={styles.label}>{t('photoURL') || 'Photo URL'}</Text>
      <TextInput
        style={styles.input}
        value={photoURL}
        onChangeText={setPhotoURL}
        placeholder={t('photoURLPlaceholder') || 'Enter your photo URL'}
        placeholderTextColor={theme.colors.text.secondary}
        autoCapitalize="none"
      />
      <TouchableOpacity
        style={styles.button}
        onPress={handleUpdate}
        disabled={loading || authLoading}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>{(loading || authLoading) ? t('loading') : t('save')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.main,
    },
    contentContainer: {
      padding: theme.spacing[5],
      alignItems: 'center',
    },
    avatarContainer: {
      alignItems: 'center',
      marginBottom: theme.spacing[4],
    },
    label: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.main,
      marginBottom: theme.spacing[1],
      alignSelf: 'flex-start',
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
      backgroundColor: theme.colors.primary[600],
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing[3],
      alignItems: 'center',
      marginTop: theme.spacing[2],
    },
    buttonText: {
      color: theme.colors.white,
      fontWeight: theme.typography.fontWeights.bold,
      fontSize: theme.typography.fontSizes.md,
    },
  });
