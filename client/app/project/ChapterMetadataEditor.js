import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { useHomeStore } from '@/store/useHomeStore';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from '@/localization/i18nProvider';
import ThemedTextInput from '@/components/common/ThemedTextInput';
import { useTheme } from '@/components/ThemeProvider';

export default function ChapterMetadataEditor() {
  const navigation = useNavigation();
  const { t, isRTL } = useTranslation();
  const theme = useTheme();
  const { files, updateFileMetaData, thesisDetails, renameFile } =
    useHomeStore();
  const { name, id } = useGlobalSearchParams();

  // Find the current chapter from thesisDetails
  const currentChapter = files.find((chapter) => chapter.id === id);
  // Initialize state with current chapter data or defaults
  const [title, setTitle] = useState(currentChapter?.title || '');
  const [description, setDescription] = useState(
    currentChapter?.description || ''
  );
  const [subject, setSubject] = useState(currentChapter?.subject || '');

  const handleSave = () => {
    // Create updated metadata
    const updatedMetadata = {
      title,
      description,
      subject,
    };
    // Update file metadata
    updateFileMetaData(id, updatedMetadata);
    renameFile(currentChapter, title);

    navigation.goBack();
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        { backgroundColor: theme.colors.background.main },
      ]}
    >
      <Text
        style={[
          styles.header,
          {
            textAlign: isRTL ? 'right' : 'left',
          },
        ]}
      >
        {t('chapter_details')}
      </Text>
      <ThemedTextInput
        label={t('title')}
        value={title}
        onChangeText={setTitle}
        style={styles.input}
        mode="outlined"
      />
      <ThemedTextInput
        label={t('thesisDescription')}
        value={description}
        onChangeText={setDescription}
        style={styles.input}
        mode="outlined"
        multiline
      />
      <ThemedTextInput
        label={t('thesisSubject')}
        value={subject}
        onChangeText={setSubject}
        style={styles.input}
        mode="outlined"
      />

      <Button mode="contained" onPress={handleSave} style={styles.saveBtn}>
        {t('save')}
      </Button>
      <Button mode="outlined" onPress={() => navigation.goBack()}>
        {t('cancel')}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 32,
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 18,
    color: '#2563EB',
    textAlign: 'left',
  },
  input: {
    marginBottom: 14,
  },
  saveBtn: {
    marginTop: 10,
    marginBottom: 24,
  },
});
