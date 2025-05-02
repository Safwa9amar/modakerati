import React from 'react';
import { View, Text, StyleSheet, ProgressBarAndroid, Platform, ProgressViewIOS } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';

export default function ProcessingProgress({ progress, status }) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.status}>{t('processing_status')}: {t(status)}</Text>
      {Platform.OS === 'android' ? (
        null
      ) : (
        null
      )}
      <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 16, alignItems: 'center' },
  status: { fontSize: 16, marginBottom: 8 },
  percent: { fontSize: 14, color: '#3B82F6', marginTop: 4 },
});