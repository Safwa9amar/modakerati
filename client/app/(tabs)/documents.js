import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useThesis } from '@/hooks/useThesis';
import { useTranslation } from '@/localization/i18nProvider';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import Button from '@/components/common/Button';
import DocumentCard from '@/components/common/DocumentCard';
import { FileUp, FileText, Merge } from 'lucide-react-native';
import { pickDocument, saveDocumentToProject, mergeDocuments } from '@/services/documentService';

export default function DocumentsScreen() {
  const { projects } = useThesis();
  const { t } = useTranslation();
  const styles = useStyles();
  const theme = useTheme();
  
  const [activeProjectId, setActiveProjectId] = useState(
    projects.length > 0 ? projects[0].id : null
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  useFocusEffect(
    useCallback(() => {
      if (projects.length > 0 && !activeProjectId) {
        setActiveProjectId(projects[0].id);
      }
      setRefreshing(true);
      setTimeout(() => setRefreshing(false), 500);
    }, [projects, activeProjectId])
  );
  
  const activeProject = projects.find(p => p.id === activeProjectId);
  const documents = activeProject?.documents || [];
  
  const handlePickDocument = async () => {
    if (!activeProjectId) return;
    
    try {
      setIsUploading(true);
      const document = await pickDocument();
      
      if (document) {
        const savedDocument = await saveDocumentToProject(activeProjectId, document);
        // Now add this document to the project in state
        await addDocumentToProject(savedDocument);
      }
    } catch (error) {
      console.error('Error uploading document:', error);
    } finally {
      setIsUploading(false);
    }
  };
  
  const handleMergeDocuments = async () => {
    if (!activeProjectId || documents.length < 2) return;
    
    try {
      setIsMerging(true);
      await mergeDocuments(activeProjectId, documents, {
        generateToc: true,
        addPageNumbers: true,
      });
      
      // In a real app, we would update the project with the merged document info
    } catch (error) {
      console.error('Error merging documents:', error);
    } finally {
      setIsMerging(false);
    }
  };
  
  const addDocumentToProject = async (document) => {
    // In a real app, this would be handled by the useThesis context
    console.log('Adding document to project:', document);
  };
  
  const handleRemoveDocument = (documentId) => {
    // In a real app, this would be handled by the useThesis context
    console.log('Removing document:', documentId);
  };
  
  const renderProjectSelector = () => (
    <View style={styles.projectSelector}>
      {projects.map(project => (
        <Button
          key={project.id}
          title={project.title}
          variant={project.id === activeProjectId ? 'primary' : 'outline'}
          size="sm"
          onPress={() => setActiveProjectId(project.id)}
          style={styles.projectButton}
        />
      ))}
    </View>
  );
  
  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <FileText size={80} color={theme.colors.gray[300]} />
      <Text style={styles.emptyText}>{t('noDocuments')}</Text>
      <Button
        title={t('uploadDocument')}
        leftIcon={<FileUp size={20} color={theme.colors.white} />}
        onPress={handlePickDocument}
        style={styles.uploadButton}
        isLoading={isUploading}
      />
    </View>
  );
  
  const renderDocumentActions = () => (
    <View style={styles.documentActions}>
      <Button
        title={t('uploadDocument')}
        leftIcon={<FileUp size={20} color={theme.colors.white} />}
        onPress={handlePickDocument}
        isLoading={isUploading}
        style={{ flex: 1, marginRight: theme.spacing[2] }}
      />
      <Button
        title={t('mergeDocuments')}
        leftIcon={<Merge size={20} color={theme.colors.white} />}
        onPress={handleMergeDocuments}
        isLoading={isMerging}
        variant="secondary"
        style={{ flex: 1 }}
        disabled={documents.length < 2}
      />
    </View>
  );
  
  if (projects.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('documents')}</Text>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('noTheses')}</Text>
        </View>
      </View>
    );
  }
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('documents')}</Text>
      </View>
      
      {renderProjectSelector()}
      
      {documents.length > 0 ? (
        <>
          {renderDocumentActions()}
          <FlatList
            data={documents}
            renderItem={({ item }) => (
              <DocumentCard
                document={item}
                onRemove={handleRemoveDocument}
              />
            )}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.documentsList}
            showsVerticalScrollIndicator={false}
            refreshing={refreshing}
            onRefresh={() => setRefreshing(false)}
          />
        </>
      ) : (
        renderEmptyState()
      )}
    </View>
  );
}

const useStyles = createThemedStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.gray[50],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[12],
    paddingBottom: theme.spacing[4],
  },
  headerTitle: {
    fontSize: theme.typography.fontSizes['2xl'],
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  projectSelector: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    flexWrap: 'wrap',
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  projectButton: {
    marginRight: theme.isRTL ? 0 : theme.spacing[2],
    marginLeft: theme.isRTL ? theme.spacing[2] : 0,
    marginBottom: theme.spacing[2],
  },
  documentActions: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  documentsList: {
    padding: theme.spacing[4],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  emptyText: {
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.gray[600],
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
    textAlign: 'center',
  },
  uploadButton: {
    minWidth: 200,
  },
}));