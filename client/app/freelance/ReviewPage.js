import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, I18nManager } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';

I18nManager.forceRTL(true);

export default function ReviewPage() {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setSubmitted(true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('التقييم')}</Text>
      {submitted ? (
        <Text style={styles.success}>{t('تم إرسال التقييم بنجاح!')}</Text>
      ) : (
        <>
          <View style={styles.starsRow}>
            {[1,2,3,4,5].map(star => (
              <TouchableOpacity key={star} onPress={() => setRating(star)}>
                <Text style={[styles.star, rating >= star && styles.starActive]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder={t('تعليق (اختياري)')}
            value={comment}
            onChangeText={setComment}
            multiline
          />
          <TouchableOpacity style={styles.btn} onPress={handleSubmit}>
            <Text style={styles.btnText}>{t('إرسال التقييم')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1D4ED8', marginBottom: 18, textAlign: 'center' },
  starsRow: { flexDirection: 'row-reverse', justifyContent: 'center', marginBottom: 16 },
  star: { fontSize: 32, color: '#ccc', marginHorizontal: 2 },
  starActive: { color: '#F59E0B' },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 15, textAlign: 'right' },
  btn: { backgroundColor: '#2563EB', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  success: { color: 'green', textAlign: 'center', fontSize: 16, marginTop: 24 },
});
