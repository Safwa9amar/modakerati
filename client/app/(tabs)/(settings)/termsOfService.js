import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';
import { useTheme } from '@/components/ThemeProvider';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';

export default function TermsOfService() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(theme);
  const navigation = useNavigation();
  const isRTL = theme.isRTL;

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('termsOfService'),
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
  }, [theme]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <Text style={[styles.intro, isRTL && { textAlign: 'right' }]}>{t('termsIntro') || 'These Terms of Service govern your use of the Modakerati app. By using the app, you agree to these terms.'}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('termsUseTitle') || '1. Use of the App'}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('termsUse') || 'You agree to use the app only for lawful purposes and in accordance with these terms.'}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('termsAccountTitle') || '2. Account and Security'}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('termsAccount') || 'You are responsible for maintaining the confidentiality of your account and password.'}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('termsContentTitle') || '3. Content and Intellectual Property'}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('termsContent') || 'All content you upload remains yours. The app and its content are protected by copyright and intellectual property laws.'}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('termsProhibitedTitle') || '4. Prohibited Activities'}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('termsProhibited') || 'You may not use the app to upload or share unlawful, harmful, or infringing content.'}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('termsTerminationTitle') || '5. Termination'}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('termsTermination') || 'We may suspend or terminate your access to the app if you violate these terms.'}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('termsChangesTitle') || '6. Changes to Terms'}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('termsChanges') || 'We may update these terms from time to time. Continued use of the app means you accept the new terms.'}</Text>
      <Text style={[styles.contact, isRTL && { textAlign: 'right' }]}>{t('termsContact') || 'For questions, contact support@modakerati.com'}</Text>
    </ScrollView>
  );
}

const useStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.main,
      paddingBottom: theme.spacing[10],
    },
    contentContainer: {
      padding: theme.spacing[5],
      paddingBottom: theme.spacing[10],
    },
    intro: {
      fontSize: theme.typography.fontSizes.md,
      marginBottom: theme.spacing[3],
      color: theme.colors.text.main,
    },
    sectionTitle: {
      fontSize: theme.typography.fontSizes.lg,
      fontWeight: theme.typography.fontWeights.bold,
      marginBottom: theme.spacing[2],
      color: theme.colors.text.main,
    },
    sectionText: {
      fontSize: theme.typography.fontSizes.md,
      marginBottom: theme.spacing[2],
      color: theme.colors.text.secondary,
    },
    contact: {
      fontSize: theme.typography.fontSizes.md,
      marginTop: theme.spacing[4],
      color: theme.colors.primary[600],
      fontWeight: theme.typography.fontWeights.bold,
      textAlign: 'center',
    },
  });
