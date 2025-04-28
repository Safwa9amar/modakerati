import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';
import { useTheme } from '@/components/ThemeProvider';
import { useNavigation } from '@react-navigation/native';
import {ArrowLeft} from "lucide-react-native"
export default function PrivacyPolicy() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(theme);
  const navigation = useNavigation();
  const isRTL = theme.isRTL;

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: t('privacyTitle'),
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
      <Text style={[styles.intro, isRTL && { textAlign: 'right' }]}>{t('privacyIntro')}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('privacyCollectTitle')}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('privacyCollect')}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('privacyUseTitle')}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('privacyUse')}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('privacyShareTitle')}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('privacyShare')}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('privacyProtectTitle')}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('privacyProtect')}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('privacyRightsTitle')}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('privacyRights')}</Text>
      <Text style={[styles.sectionTitle, isRTL && { textAlign: 'right' }]}>{t('privacyChangesTitle')}</Text>
      <Text style={[styles.sectionText, isRTL && { textAlign: 'right' }]}>{t('privacyChanges')}</Text>
      <Text style={[styles.contact, isRTL && { textAlign: 'right' }]}>{t('privacyContact')}</Text>
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
    title: {
      fontSize: theme.typography.fontSizes['2xl'],
      marginBottom: theme.spacing[4],
      fontWeight: theme.typography.fontWeights.bold,
      color: theme.colors.text,
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
