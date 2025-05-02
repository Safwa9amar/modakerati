import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FileText } from 'lucide-react-native';
import Swipable from '@/components/common/Swipable';
import { Trash2 } from 'lucide-react-native';

export default function FileDisplay({ file, onRemove, onEdit }) {
  if (!file) return null;
  
  return (
    <Swipable
      rightAction={onRemove}
      leftAction={onEdit}
      leftActionContent={
        <FileText size={22} color="#fff" />
      }
      rightActionContent={
        <Trash2 size={22} color="#fff" />
      }
      style={styles.fileRow}
    >
        <View style={styles.fileRow}>
          <FileText size={22} color="#3B82F6" style={styles.icon} />
          <Text style={styles.fileName} numberOfLines={1}>
            {file.name || (file.uri ? file.uri.split('/').pop() : 'Document')}
          </Text>
        </View>
    </Swipable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
    width: '100%',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 8,
  },
  icon: {
    marginRight: 8,
  },
  fileName: {
    fontSize: 15,
    color: '#374151',
    flex: 1,
  },
});
