import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, I18nManager } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTranslation } from '@/localization/i18nProvider';

I18nManager.forceRTL(true);

export default function SubmitOfferPage() {
  const { t } = useTranslation();
  const route = useRoute();
  const { requestId } = route.params || {};
  const [price, setPrice] = useState('');
  const [delivery, setDelivery] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setSubmitted(true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('تقديم عرض')}</Text>
      {submitted ? (
        <Text style={styles.success}>{t('تم إرسال العرض بنجاح!')}</Text>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder={t('عرض السعر')}
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
          />
          <TextInput
            style={styles.input}
            placeholder={t('وقت التسليم')}
            value={delivery}
            onChangeText={setDelivery}
          />
          <TextInput
            style={styles.input}
            placeholder={t('ملاحظة إضافية (اختياري)')}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <TouchableOpacity style={styles.btn} onPress={handleSubmit}>
            <Text style={styles.btnText}>{t('إرسال العرض')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 24, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1D4ED8', marginBottom: 18, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 15, textAlign: 'right' },
  btn: { backgroundColor: '#2563EB', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  success: { color: 'green', textAlign: 'center', fontSize: 16, marginTop: 24 },
});
