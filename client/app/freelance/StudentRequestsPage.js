import React from 'react';
import { FlatList, View, Text, StyleSheet, TouchableOpacity, I18nManager, Animated } from 'react-native';
import { mockRequests } from '@/services/freelanceMockData';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from '@/localization/i18nProvider';

I18nManager.forceRTL(true);

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function StudentRequestsPage() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const renderItem = ({ item, index }) => {
    const fadeAnim = React.useRef(new Animated.Value(0)).current;
    React.useEffect(() => {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }).start();
    }, []);
    return (
      <AnimatedTouchable
        style={[styles.card, { opacity: fadeAnim }]}
        onPress={() => navigation.navigate('RequestDetails', { id: item.id })}
      >
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.desc}>{item.shortDescription}</Text>
        <View style={styles.row}>
          <Text style={styles.category}>{item.category}</Text>
          <TouchableOpacity style={styles.detailsBtn} onPress={() => navigation.navigate('RequestDetails', { id: item.id })}>
            <Text style={styles.detailsText}>{t('عرض التفاصيل')}</Text>
          </TouchableOpacity>
        </View>
      </AnimatedTouchable>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={mockRequests}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1D4ED8',
    marginBottom: 6,
  },
  desc: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  category: {
    backgroundColor: '#E0E7FF',
    color: '#3730A3',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 13,
    fontWeight: 'bold',
  },
  detailsBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  detailsText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
