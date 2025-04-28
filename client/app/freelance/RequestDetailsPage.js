import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, I18nManager } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { mockRequests } from '@/services/freelanceMockData';
import { useTranslation } from '@/localization/i18nProvider';

I18nManager.forceRTL(true);

export default function RequestDetailsPage() {
  const { t } = useTranslation();
  const route = useRoute();
  const navigation = useNavigation();
  const { id } = route.params || {};
  const req = mockRequests.find(r => r.id === id);
  if (!req) return <View style={styles.center}><Text>{t('الطلب غير موجود')}</Text></View>;
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>{req.title}</Text>
      <Text style={styles.desc}>{req.description}</Text>
      <View style={styles.infoRow}><Text style={styles.label}>{t('الموعد النهائي')}:</Text><Text>{req.deadline}</Text></View>
      <View style={styles.infoRow}><Text style={styles.label}>{t('الميزانية')}:</Text><Text>{req.budget}</Text></View>
      <TouchableOpacity style={styles.offerBtn} onPress={() => navigation.navigate('SubmitOffer', { requestId: req.id })}>
        <Text style={styles.offerText}>{t('تقديم عرض')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1D4ED8', marginBottom: 10, textAlign: 'right' },
  desc: { fontSize: 16, color: '#374151', marginBottom: 18, textAlign: 'right' },
  infoRow: { flexDirection: 'row-reverse', justifyContent: 'flex-start', marginBottom: 8 },
  label: { color: '#6D28D9', fontWeight: 'bold', marginLeft: 8 },
  offerBtn: { backgroundColor: '#2563EB', borderRadius: 8, padding: 12, marginTop: 24, alignItems: 'center' },
  offerText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
