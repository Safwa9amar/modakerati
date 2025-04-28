import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, I18nManager } from 'react-native';
import { mockOffers, mockRequests } from '@/services/freelanceMockData';
import { useTranslation } from '@/localization/i18nProvider';

I18nManager.forceRTL(true);

const statusColors = {
  'بانتظار': '#F59E0B',
  'مقبول': '#10B981',
  'مرفوض': '#EF4444',
};

export default function MyOffersPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('الكل');
  const offers = filter === 'الكل' ? mockOffers : mockOffers.filter(o => o.status === filter);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('عروضي')}</Text>
      <View style={styles.filterRow}>
        {['الكل', 'بانتظار', 'مقبول', 'مرفوض'].map(st => (
          <TouchableOpacity key={st} style={[styles.filterBtn, filter === st && styles.activeFilter]} onPress={() => setFilter(st)}>
            <Text style={[styles.filterText, filter === st && styles.activeFilterText]}>{t(st)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={offers}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const req = mockRequests.find(r => r.id === item.requestId);
          return (
            <View style={styles.card}>
              <Text style={styles.reqTitle}>{req?.title}</Text>
              <Text style={styles.price}>{t('عرض السعر')}: {item.offerPrice}</Text>
              <View style={styles.statusRow}>
                <Text style={[styles.statusBadge, { backgroundColor: statusColors[item.status] }]}>{t(item.status)}</Text>
                <Text style={styles.delivery}>{t('وقت التسليم')}: {item.deliveryTime}</Text>
              </View>
            </View>
          );
        }}
        contentContainerStyle={{ padding: 16 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1D4ED8', margin: 18, textAlign: 'center' },
  filterRow: { flexDirection: 'row-reverse', justifyContent: 'center', marginBottom: 10 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: '#E5E7EB', marginHorizontal: 4 },
  filterText: { color: '#374151', fontWeight: 'bold' },
  activeFilter: { backgroundColor: '#2563EB' },
  activeFilterText: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, alignItems: 'flex-end' },
  reqTitle: { fontSize: 16, fontWeight: 'bold', color: '#1D4ED8', marginBottom: 6 },
  price: { fontSize: 15, color: '#374151', marginBottom: 8 },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-start' },
  statusBadge: { color: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, fontSize: 13, fontWeight: 'bold', marginLeft: 8 },
  delivery: { color: '#6D28D9', fontWeight: 'bold' },
});
