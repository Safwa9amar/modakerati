import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useThesis } from '@/hooks/useThesis';
import { useTranslation } from '@/localization/i18nProvider';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import { ChevronLeft, Save } from 'lucide-react-native';

export default function NewProjectScreen() {
  const { createProject } = useThesis();
  const { t } = useTranslation();
  const styles = useStyles();
  const theme = useTheme();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  
  const validateForm = () => {
    const newErrors = {};
    
    if (!title.trim()) {
      newErrors.title = 'Title is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleCreateProject = async () => {
    if (!validateForm()) return;
    
    try {
      setIsLoading(true);
      
      await createProject({
        title,
        description,
        subject,
        supervisor,
      });
      
      router.replace('/(tabs)');
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button
          leftIcon={<ChevronLeft size={24} color={theme.colors.gray[700]} />}
          variant="ghost"
          onPress={() => router.back()}
        />
        <Text style={styles.headerTitle}>{t('newThesis')}</Text>
        <View style={{ width: 40 }} />
      </View>
      
      <ScrollView 
        style={styles.formContainer}
        contentContainerStyle={styles.formContent}
        showsVerticalScrollIndicator={false}
      >
        <Input
          label={t('thesisTitle')}
          value={title}
          onChangeText={setTitle}
          placeholder="Enter thesis title"
          error={errors.title}
        />
        
        <Input
          label={t('thesisSubject')}
          value={subject}
          onChangeText={setSubject}
          placeholder="Enter subject"
        />
        
        <Input
          label={t('thesisSupervisor')}
          value={supervisor}
          onChangeText={setSupervisor}
          placeholder="Enter supervisor name"
        />
        
        <Input
          label={t('thesisDescription')}
          value={description}
          onChangeText={setDescription}
          placeholder="Enter description"
          multiline
          numberOfLines={4}
        />
        
        <Button
          title={t('create')}
          leftIcon={<Save size={20} color={theme.colors.white} />}
          onPress={handleCreateProject}
          isLoading={isLoading}
          style={styles.createButton}
        />
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing[12],
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.white,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[200],
  },
  headerTitle: {
    fontSize: theme.typography.fontSizes.xl,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  formContainer: {
    flex: 1,
  },
  formContent: {
    padding: theme.spacing[4],
  },
  createButton: {
    marginTop: theme.spacing[6],
    marginBottom: theme.spacing[8],
  },
}));