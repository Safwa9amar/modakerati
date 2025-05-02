import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from '@/localization/i18nProvider';
import { Download } from 'lucide-react-native';

export default function DownloadPreview({ onDownload, onPreview }) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.btn} onPress={onDownload}>
        <Download size={20} color="#fff" />
        <Text style={styles.btnText}>{t('download_result')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.previewBtn]} onPress={onPreview}>
        <Text style={styles.btnText}>{t('preview_result')}</Text>
      </TouchableOpacity>
      <Text style={styles.success}>{t('congrats_ready')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 16, alignItems: 'center' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  previewBtn: {
    backgroundColor: '#60A5FA',
  },
  btnText: {
    color: '#fff',
    fontWeight: 'bold',
    marginLeft: 8,
    fontSize: 16,
  },
  success: {
    color: '#10B981',
    fontWeight: 'bold',
    marginTop: 12,
    fontSize: 16,
  },
});