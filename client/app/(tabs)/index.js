import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import { useState, useCallback } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { Plus, FileText, Calendar, Book } from 'lucide-react-native';
import { useThesis } from '@/hooks/useThesis';
import { useTranslation } from '@/localization/i18nProvider';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { Swipeable } from 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function DashboardScreen() {
  const { projects, isLoading, removeDocumentFromProject } = useThesis();
  const { t } = useTranslation();
  const styles = useStyles();
  const theme = useTheme();
  
  const [refreshing, setRefreshing] = useState(false);
  
  useFocusEffect(
    useCallback(() => {
      // This would refresh projects when the screen comes into focus
      setRefreshing(true);
      setTimeout(() => setRefreshing(false), 500);
    }, [])
  );
  
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(theme.isRTL ? 'ar-SA' : undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };
  
  const navigateToProject = (projectId) => {
    router.push(`/project/${projectId}`);
  };
  
  const navigateToNewProject = () => {
    router.push('/project/new');
  };
  
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }
  
  const renderProjectCard = ({ item }) => {
    const renderRightActions = () => (
      <TouchableOpacity
        style={{
          backgroundColor: theme.colors.error[500],
          justifyContent: 'center',
          alignItems: 'center',
          width: 80,
          height: '100%',
          borderTopRightRadius: 16,
          borderBottomRightRadius: 16,
        }}
        onPress={() => removeDocumentFromProject(item.id, null)}
      >
        <Text style={{ color: theme.colors.white, fontWeight: 'bold' }}>{t('delete')}</Text>
      </TouchableOpacity>
    );
    const renderLeftActions = () => (
      <TouchableOpacity
        style={{
          backgroundColor: theme.colors.primary[600],
          justifyContent: 'center',
          alignItems: 'center',
          width: 80,
          height: '100%',
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
        }}
        onPress={() => navigateToProject(item.id)}
      >
        <Text style={{ color: theme.colors.white, fontWeight: 'bold' }}>{t('edit')}</Text>
      </TouchableOpacity>
    );
    return (
      <Swipeable
        renderLeftActions={renderLeftActions}
        renderRightActions={renderRightActions}
      >
        <TouchableOpacity 
          onPress={() => navigateToProject(item.id)}
          activeOpacity={0.7}
        >
          <Card
            title={item.title}
            subtitle={item.subject}
            style={styles.projectCard}
            footer={
              <View style={styles.projectCardFooter}>
                <View style={styles.footerItem}>
                  <Calendar size={16} color={theme.colors.gray[500]} />
                  <Text style={styles.footerText}>{formatDate(item.createdAt)}</Text>
                </View>
                <View style={styles.footerItem}>
                  <FileText size={16} color={theme.colors.gray[500]} />
                  <Text style={styles.footerText}>{item.documents.length} {t('documents')}</Text>
                </View>
              </View>
            }
          >
            <Text style={styles.projectDescription} numberOfLines={2}>
              {item.description || 'No description provided.'}
            </Text>
            {item.supervisor && (
              <View style={styles.supervisorContainer}>
                <Book size={16} color={theme.colors.secondary[600]} style={styles.supervisorIcon} />
                <Text style={styles.supervisorText}>{item.supervisor}</Text>
              </View>
            )}
          </Card>
        </TouchableOpacity>
      </Swipeable>
    );
  };
  
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Image 
            source={require('@/assets/fullLogo.png')}
            style={{ width: 180, height: 50, resizeMode: 'contain' }}
          />
        </View>
        {/* Floating Action Button */}
        <TouchableOpacity
          style={styles.fab}
          onPress={navigateToNewProject}
          activeOpacity={0.8}
        >
          <Plus size={28} color={theme.colors.white} />
        </TouchableOpacity>
        {projects.length === 0 ? (
          <View style={styles.emptyContainer}>
            <FileText size={80} color={theme.colors.gray[300]} />
            <Text style={styles.emptyText}>{t('noTheses')}</Text>
            <Button
              title={t('createThesis')}
              onPress={navigateToNewProject}
              style={styles.createButton}
            />
          </View>
        ) : (
          <FlatList
            data={projects}
            renderItem={renderProjectCard}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.projectsList}
            showsVerticalScrollIndicator={false}
            refreshing={refreshing}
            onRefresh={() => setRefreshing(false)}
          />
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const useStyles = createThemedStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.gray[50],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: theme.typography.fontSizes.lg,
    color: theme.colors.gray[600],
  },
  header: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[16],
  },
  headerTitle: {
    fontSize: theme.typography.fontSizes['2xl'],
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
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
  createButton: {
    minWidth: 200,
  },
  projectsList: {
    padding: theme.spacing[4],
  },
  projectCard: {
    marginBottom: theme.spacing[4],
  },
  projectDescription: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.gray[700],
    marginBottom: theme.spacing[4],
  },
  supervisorContainer: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
  },
  supervisorIcon: {
    marginRight: theme.isRTL ? 0 : theme.spacing[2],
    marginLeft: theme.isRTL ? theme.spacing[2] : 0,
  },
  supervisorText: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.secondary[700],
    fontWeight: theme.typography.fontWeights.medium,
  },
  projectCardFooter: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    justifyContent: 'space-between',
  },
  footerItem: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
  },
  footerText: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.gray[600],
    marginLeft: theme.isRTL ? 0 : theme.spacing[2],
    marginRight: theme.isRTL ? theme.spacing[2] : 0,
  },
  fab: {
    position: 'absolute',
    bottom: theme.spacing[4],
    right: theme.isRTL ? undefined : theme.spacing[6],
    left: theme.isRTL ? theme.spacing[6] : undefined,
    backgroundColor: theme.colors.primary[600],
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: theme.colors.primary[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    zIndex: 100,
  },
}));