import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, LogOut, User, Mail, KeyRound } from 'lucide-react-native';
import { useAuthStore } from '@/store/useAuthStore';

export default function AccountSettings() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const styles = useStyles(theme);
  const isRTL = theme.isRTL;
  const { user: authUser, deleteUser, logout } = useAuthStore();

  // Use real user info if logged in
  const user = authUser
    ? {
        name: authUser.displayName || 'Student',
        email: authUser.email,
        id: authUser.uid,
        role: t('student'),
        joined: authUser.metadata?.creationTime?.split('T')[0] || '',
        language: t(theme.isRTL ? 'arabic' : 'english'),
        phone: authUser.phoneNumber || '',
        verified: authUser.emailVerified,
        notifications: true,
        darkMode: theme.mode === 'dark',
        university: 'University of Algiers',
        department: t('computerScience'),
        graduationYear: '2025',
        lastLogin: authUser.metadata?.lastSignInTime?.split('T')[0] || '',
        subscription: t('freePlan'),
        supportContact: 'support@modakerati.com',
      }
    : {
        name: 'Student Name',
        email: 'student@email.com',
        id: 'U123456',
        role: t('student'),
        joined: '2024-01-15',
        language: t(theme.isRTL ? 'arabic' : 'english'),
        phone: '+213 555 123 456',
        verified: true,
        notifications: true,
        darkMode: theme.mode === 'dark',
        university: 'University of Algiers',
        department: t('computerScience'),
        graduationYear: '2025',
        lastLogin: '2025-04-25 14:32',
        subscription: t('freePlan'),
        supportContact: 'support@modakerati.com',
      };

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('accountSettings'),
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
          <ArrowLeft
            size={28}
            color={theme.colors.black}
            onPress={() => navigation.goBack()}
          />
        </View>
      ),
    });
  }, [theme, navigation, t]);

  // Dummy handlers (replace with real logic)
  const handleLogout = () => {
    logout();
  };
  const handleChangePassword = () => {
    navigation.navigate('changePassword');
  };

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDeleteAccount = () => {
    setDeleteModalVisible(true);
    setDeleteName('');
  };

  const confirmDeleteAccount = async () => {
    if (deleteName.trim() !== user.name) {
      Alert.alert(t('error'), t('nameMismatch') || 'Name does not match.');
      return;
    }
    setDeleteLoading(true);
    try {
      await deleteUser();
      setDeleteModalVisible(false);
      Alert.alert(t('success'), t('accountDeleted') || 'Account deleted.');
      logout();
    } catch (error) {
      Alert.alert(t('error'), error.message || t('error'));
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.profileCard}>
          <User
            size={56}
            color={theme.colors.primary[600]}
            style={styles.avatar}
          />
          <Text style={[styles.name, isRTL && { textAlign: 'right' }]}>
            {user.name || 'Student Name'}
          </Text>
          <Text style={[styles.email, isRTL && { textAlign: 'right' }]}>
            {user.email}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('userId') + ': ' + user.id}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('role') + ': ' + user.role}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('university') + ': ' + user.university}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('department') + ': ' + user.department}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('graduationYear') + ': ' + user.graduationYear}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('joined') + ': ' + user.joined}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('lastLogin') + ': ' + user.lastLogin}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('language') + ': ' + user.language}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('phone') + ': ' + user.phone}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('verified') + ': ' + (user.verified ? t('yes') : t('no'))}
          </Text>
          <Text style={[styles.info, isRTL && { textAlign: 'right' }]}>
            {t('subscription') + ': ' + user.subscription}
          </Text>
        </View>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>
            {t('accountSettings')}
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('updateProfile')}
            style={styles.settingRow(isRTL)}
          >
            <User
              size={18}
              color={theme.colors.primary[600]}
              style={{ marginEnd: 8 }}
            />
            <Text style={styles.settingLabel}>{t('updateProfile')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingRow(isRTL)}
            onPress={() => navigation.navigate('changeEmail')}
          >
            <Mail
              size={18}
              color={theme.colors.primary[600]}
              style={{ marginEnd: 8 }}
            />
            <Text style={styles.settingLabel}>
              {t('changeEmail') || 'Change Email'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingRow(isRTL)}
            onPress={handleChangePassword}
          >
            <KeyRound
              size={18}
              color={theme.colors.primary[600]}
              style={{ marginEnd: 8 }}
            />
            <Text style={styles.settingLabel}>
              {t('changePassword') || 'Change Password'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleLogout}>
            <LogOut
              size={20}
              color={theme.colors.error[600]}
              style={{ marginEnd: 8 }}
            />
            <Text
              style={[styles.actionText, { color: theme.colors.error[600] }]}
            >
              {t('logout')}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>
            {t('accountInfo') || 'Account Information'}
          </Text>
          <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>
            {t('accountInfoDesc') ||
              'Manage your profile, email, password, and language preferences. For any issues, contact support@modakerati.com.'}
          </Text>
        </View>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>
            {t('supportContactTitle') || 'Support & Contact'}
          </Text>
          <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>
            {t('supportContactDesc', { email: user.supportContact }) ||
              `For help, contact us at ${user.supportContact}`}
          </Text>
        </View>
      </ScrollView>
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.background.main,
              borderRadius: theme.radius.lg,
              padding: 24,
              width: '85%',
            }}
          >
            <Text
              style={{
                fontSize: theme.typography.fontSizes.lg,
                fontWeight: theme.typography.fontWeights.bold,
                color: theme.colors.error[600],
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              {t('confirmDeleteAccount') || 'Confirm Account Deletion'}
            </Text>

            <Text
              style={{
                color: theme.colors.text.secondary,
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              {t('deleteAccountPrompt') + `\n(${user.name}) `}
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: theme.colors.primary[200],
                borderRadius: theme.radius.md,
                padding: 12,
                marginBottom: 16,
                color: theme.colors.text.main,
              }}
              placeholder={t('yourName') || 'Your name'}
              placeholderTextColor={theme.colors.text.secondary}
              value={deleteName}
              onChangeText={setDeleteName}
              autoCapitalize="none"
            />
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between' }}
            >
              <TouchableOpacity
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 24,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.gray[200],
                }}
                onPress={() => setDeleteModalVisible(false)}
                disabled={deleteLoading}
              >
                <Text
                  style={{ color: theme.colors.text.main, fontWeight: 'bold' }}
                >
                  {t('cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 24,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.error[600],
                }}
                onPress={confirmDeleteAccount}
                disabled={deleteLoading}
              >
                <Text style={{ color: theme.colors.white, fontWeight: 'bold' }}>
                  {deleteLoading ? t('loading') : t('delete')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
      paddingBottom: theme.spacing[10],
    },
    profileCard: {
      alignItems: 'center',
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.radius.lg,
      padding: theme.spacing[6],
      marginBottom: theme.spacing[4],
      shadowColor: theme.colors.primary[200],
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 2,
    },
    avatar: {
      marginBottom: theme.spacing[2],
    },
    name: {
      fontSize: theme.typography.fontSizes['2xl'],
      fontWeight: theme.typography.fontWeights.bold,
      color: theme.colors.text.main,
      marginBottom: theme.spacing[1],
    },
    email: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing[2],
    },
    info: {
      fontSize: theme.typography.fontSizes.sm,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing[1],
    },
    section: {
      marginTop: theme.spacing[3],
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.radius.md,
      padding: theme.spacing[4],
      marginBottom: theme.spacing[3],
    },
    sectionTitle: {
      fontSize: theme.typography.fontSizes.lg,
      fontWeight: theme.typography.fontWeights.bold,
      color: theme.colors.primary[700],
      marginBottom: theme.spacing[2],
    },
    sectionText: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.secondary,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: theme.spacing[4],
      marginTop: theme.spacing[2],
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.primary[50],
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[5],
      marginHorizontal: theme.spacing[2],
      marginTop: theme.spacing[2],
    },
    actionText: {
      color: theme.colors.primary[700],
      fontWeight: theme.typography.fontWeights.bold,
      fontSize: theme.typography.fontSizes.md,
    },
    // Add more spacing and modern look for settings
    settingRow: (isRTL) => ({
      flexDirection: !isRTL ? "row-reverse" :'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.gray[100],
      marginBottom: theme.spacing[1],
    }),
    settingLabel: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.text.main,
      fontWeight: theme.typography.fontWeights.medium,
    },
    settingValue: {
      fontSize: theme.typography.fontSizes.sm,
      color: theme.colors.primary[600],
      fontWeight: theme.typography.fontWeights.bold,
    },
  });
