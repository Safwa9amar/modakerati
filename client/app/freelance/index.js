import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, I18nManager } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from '@/localization/i18nProvider';
import { Briefcase, List, MessageCircle, Star, Layers } from 'lucide-react-native';


export default function FreelanceIndex() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('freelance_marketplace')}</Text>
      <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('StudentRequests')}>
        <View style={styles.row}>
          <List size={22} color="#2563EB" style={styles.icon} />
          <Text style={styles.itemText}>{t('student_requests')}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('MyOffers')}>
        <View style={styles.row}>
          <Layers size={22} color="#10B981" style={styles.icon} />
          <Text style={styles.itemText}>{t('my_offers')}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('Chat')}>
        <View style={styles.row}>
          <MessageCircle size={22} color="#F59E0B" style={styles.icon} />
          <Text style={styles.itemText}>{t('chat')}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.item} onPress={() => navigation.navigate('Review')}>
        <View style={styles.row}>
          <Star size={22} color="#EF4444" style={styles.icon} />
          <Text style={styles.itemText}>{t('review')}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1D4ED8', marginBottom: 32, textAlign: 'center', letterSpacing: 1 },
  item: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 20, elevation: 3, shadowColor: '#2563EB', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, alignItems: 'flex-end', transition: 'background 0.2s' },
  row: { flexDirection: 'row-reverse', alignItems: 'center' },
  icon: { marginLeft: 12 },
  itemText: { fontSize: 18, color: '#374151', fontWeight: 'bold', letterSpacing: 0.5 },
});
