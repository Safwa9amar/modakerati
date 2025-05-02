import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';

export default function ReviewSettings({ thesisDetails, selectedServices }) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{t('review_summary')}</Text>
      <Text style={styles.label}>{t('thesis_title')}: {thesisDetails.title}</Text>
      <Text style={styles.label}>{t('num_chapters')}: {thesisDetails.chapters?.length || 0}</Text>
      <Text style={styles.label}>{t('selected_services')}:</Text>
      <View style={styles.servicesList}>
        {Object.entries(selectedServices)
          .filter(([_, v]) => v)
          .map(([k]) => (
            <Text key={k} style={styles.serviceItem}>• {t(`service_${k}`)}</Text>
          ))}
      </View>
      {thesisDetails.notes ? (
        <Text style={styles.label}>{t('notes')}: {thesisDetails.notes}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  header: { fontWeight: 'bold', fontSize: 18, marginBottom: 8 },
  label: { fontSize: 15, marginBottom: 4 },
  servicesList: { marginLeft: 12, marginBottom: 4 },
  serviceItem: { fontSize: 14, color: '#3B82F6' },
});