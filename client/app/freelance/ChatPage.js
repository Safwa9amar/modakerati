import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, I18nManager } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { mockChats } from '@/services/freelanceMockData';
import { useTranslation } from '@/localization/i18nProvider';

I18nManager.forceRTL(true);

export default function ChatPage() {
  const { t } = useTranslation();
  const route = useRoute();
  const { chatId = '1' } = route.params || {};
  const [messages, setMessages] = useState(mockChats[chatId] || []);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages([...messages, { from: 'freelancer', text: input, time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) }]);
    setInput('');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('الرسائل')}</Text>
      <FlatList
        data={messages}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <View style={[styles.msgRow, { justifyContent: item.from === 'freelancer' ? 'flex-start' : 'flex-end' }] }>
            <View style={[styles.msgBubble, item.from === 'freelancer' ? styles.freelancer : styles.student]}>
              <Text style={styles.msgText}>{item.text}</Text>
              <Text style={styles.msgTime}>{item.time}</Text>
            </View>
          </View>
        )}
        contentContainerStyle={{ padding: 16 }}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t('اكتب رسالة...')}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendText}>{t('إرسال')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1D4ED8', margin: 18, textAlign: 'center' },
  msgRow: { flexDirection: 'row', marginBottom: 8 },
  msgBubble: { maxWidth: '75%', borderRadius: 16, padding: 10, marginHorizontal: 8 },
  freelancer: { backgroundColor: '#E0E7FF', alignSelf: 'flex-start' },
  student: { backgroundColor: '#D1FAE5', alignSelf: 'flex-end' },
  msgText: { fontSize: 15, color: '#222' },
  msgTime: { fontSize: 11, color: '#888', marginTop: 4, textAlign: 'left' },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  input: { flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 10, fontSize: 15, marginRight: 8, textAlign: 'right' },
  sendBtn: { backgroundColor: '#2563EB', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
  sendText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});
