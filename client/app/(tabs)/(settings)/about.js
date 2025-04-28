import React from 'react';
import { View, Text, ScrollView, Image, StyleSheet } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';
import { useTheme } from '@/components/ThemeProvider';

export default function AboutSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(theme);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <Image
        source={require('@/assets/logo.png')}
        style={styles.logo}
      />
      <Text style={styles.title}>{t('aboutTitle')}</Text>
      <Text style={styles.intro}>{t('aboutIntro')}</Text>
      <Text style={styles.section}>{t('aboutMission')}</Text>
      <Text style={styles.section}>{t('aboutVision')}</Text>
      <View style={styles.valuesContainer}>
        <Text style={styles.valuesTitle}>{t('aboutValuesTitle')}</Text>
        <Text style={styles.value}>{t('aboutValueSimplicity')}</Text>
        <Text style={styles.value}>{t('aboutValueQuality')}</Text>
        <Text style={styles.value}>{t('aboutValueCreativity')}</Text>
        <Text style={styles.value}>{t('aboutValueEmpowerment')}</Text>
      </View>
      <Text style={styles.join}>{t('aboutJoin')}</Text>
      <View style={styles.devInfoContainer}>
        <Text style={styles.devInfoTitle}>{t('developerInfo') || 'Developer Info'}</Text>
        <Text style={styles.devInfoText}>Hassani Hamza</Text>
        <Text style={styles.devInfoText}>hassanih97@gmail.com</Text>
        <Text style={styles.devInfoText}>+213 674 020 244</Text>
        <Text style={styles.devInfoText}>{t('locationLabel') || 'Location'}: elbayadh, sidi tifour</Text>
      </View>
    </ScrollView>
  );
}

const useStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.main,
  },
  contentContainer: {
    padding: 24,
    paddingTop: 80,
    justifyContent: 'center',
    minHeight: '100%',
  },
  logo: {
    alignSelf: 'center',
    marginBottom: 24,
    width: 80,
    height: 80,
    resizeMode: 'contain',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: theme.colors.primary[700],
    marginBottom: 18,
    textAlign: 'center',
  },
  intro: {
    fontSize: 16,
    color: theme.colors.text.main,
    marginBottom: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  section: {
    fontSize: 16,
    color: theme.colors.text.secondary,
    marginBottom: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  valuesContainer: {
    marginVertical: 18,
  },
  valuesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.primary[600],
    marginBottom: 10,
    textAlign: 'center',
  },
  value: {
    fontSize: 15,
    color: theme.colors.text.main,
    textAlign: 'center',
    marginBottom: 4,
  },
  join: {
    fontSize: 17,
    fontWeight: 'bold',
    color: theme.colors.success[600],
    textAlign: 'center',
    marginTop: 16,
  },
  devInfoContainer: {
    marginTop: 32,
    padding: 16,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  devInfoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.primary[600],
    marginBottom: 8,
  },
  devInfoText: {
    fontSize: 15,
    color: theme.colors.text.main,
    marginBottom: 2,
    textAlign: 'center',
  },
});
