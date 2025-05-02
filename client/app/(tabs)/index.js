import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Upload,
  Settings,
  CheckCircle,
  Loader,
  Download,
  Users,
} from 'lucide-react-native';
import { useTranslation } from '@/localization/i18nProvider';
import TimelineItem from '@/components/common/TimelineItem';
import { useTheme } from '@/components/ThemeProvider';
import UploadThesis from '@/components/home/uploadThesis';
import SelectServices from '@/components/home/SelectServices';
import DownloadPreview from '@/components/home/DownloadPreview';
import ProcessingProgress from '@/components/home/PoccessProgress';
import { useHomeStore } from '@/store/useHomeStore';

export default function DashboardScreen() {
  const navigation = useNavigation();
  const theme = useTheme();
  const { t, locale } = useTranslation();
  const isRTL = locale === 'ar';

  const { loadFromStorage  } = useHomeStore();

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadFromStorage();
    });

    return unsubscribe;
  }, [navigation]);

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { backgroundColor: theme.colors.background.main },
        ]}
      >
        <View style={[styles.timeline, isRTL && { alignItems: 'flex-end' }]}>
          <UploadThesis />
          <SelectServices services={{}} />
          <DownloadPreview />
          <ProcessingProgress />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginBottom: 32,
    textAlign: 'center',
    letterSpacing: 1,
  },
  timeline: {
    width: '100%',
  },
});
