import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FileText } from 'lucide-react-native';
import Swipable from '@/components/common/Swipable';
import { Trash2 } from 'lucide-react-native';
import { useTheme } from '../ThemeProvider';
import { Image } from 'react-native';

const removeExtension = (filename) => {
  return filename.replace(/\.[^/.]+$/, "");
};

export default function FileDisplay({ file, onRemove, onEdit }) {
  if (!file) return null;
  const theme = useTheme()
  const displayName = file.newName || file.name || 'Document';
  const nameWithoutExtension = removeExtension(displayName);
  
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
          {file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? (
            <Image source={require('@/assets/icons/docx.png')} style={styles.icon} />
          ) : (
            <FileText size={22} color="#3B82F6" style={styles.icon} />  
          )}
          <Text style={[styles.fileName, {color : theme.colors.gray[600]}]} numberOfLines={1}>
            {nameWithoutExtension}
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
    borderRadius: 8,
    padding: 8,
  },
  icon: {
    marginRight: 8,
    width: 20,
    height: 20,
  },
  fileName: {
    fontSize: 15,
    flex: 1,
  },
});
