import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { TextInput, Button, Text } from 'react-native-paper';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { useHomeStore } from '@/store/useHomeStore';
import { useNavigation, useRoute } from '@react-navigation/native';

export default function UpdateFileMeta() {
  const navigation = useNavigation();
  
  const {  updateFileMetaData,files } = useHomeStore();
  const  {id}   = useGlobalSearchParams();
  const file = files.find((file) => file.id === id);
  // New required fields
  const [title, setTitle] = useState(file?.title || '');
  const [description, setDescription] = useState(file?.description || '');
  const [subject, setSubject] = useState(file?.subject || '');
  const [supervisor, setSupervisor] = useState(file?.supervisor || '');

  const handleSave = () => {
    updateFileMetaData(id, {
      ...file,
      title,
      description,
      subject,
      supervisor,
    });
    navigation.goBack();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Please provide file details:</Text>
      <TextInput
        label="Title"
        value={title}
        onChangeText={setTitle}
        style={styles.input}
        mode="outlined"
      />
      <TextInput
        label="Description"
        value={description}
        onChangeText={setDescription}
        style={styles.input}
        mode="outlined"
        multiline
      />
      <TextInput
        label="Subject"
        value={subject}
        onChangeText={setSubject}
        style={styles.input}
        mode="outlined"
      />
      <TextInput
        label="Supervisor"
        value={supervisor}
        onChangeText={setSupervisor}
        style={styles.input}
        mode="outlined"
      />
      <Button mode="contained" onPress={handleSave} style={styles.saveBtn}>
        Save
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    margin : 20,
    padding: 24,
    backgroundColor: '#F9FAFB',
    flexGrow: 1,
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
    backgroundColor: '#fff',
  },
  saveBtn: {
    marginTop: 10,
    marginBottom: 24,
  },
});
