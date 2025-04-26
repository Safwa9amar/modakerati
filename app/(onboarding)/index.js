import { View, Text, Image, StyleSheet, useWindowDimensions } from 'react-native';
import { useRef, useState } from 'react';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Button from '@/components/common/Button';
import { createThemedStyles, useTheme } from '@/components/ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';

const onboardingData = [
  {
    title: 'onboardingTitle1',
    description: 'onboardingDesc1',
    image: 'https://images.pexels.com/photos/4458554/pexels-photo-4458554.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
  {
    title: 'onboardingTitle2',
    description: 'onboardingDesc2',
    image: 'https://images.pexels.com/photos/4240505/pexels-photo-4240505.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
  {
    title: 'onboardingTitle3',
    description: 'onboardingDesc3',
    image: 'https://images.pexels.com/photos/4050315/pexels-photo-4050315.jpeg?auto=compress&cs=tinysrgb&w=800',
  },
];

export default function Onboarding() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const styles = useStyles();
  
  const [currentPage, setCurrentPage] = useState(0);
  const scrollViewRef = useRef(null);
  
  const handleNext = () => {
    if (currentPage < onboardingData.length - 1) {
      setCurrentPage(currentPage + 1);
      scrollViewRef.current?.scrollTo({ x: width * (currentPage + 1), animated: true });
    } else {
      completeOnboarding();
    }
  };
  
  const handleBack = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
      scrollViewRef.current?.scrollTo({ x: width * (currentPage - 1), animated: true });
    }
  };
  
  const handleSkip = () => {
    completeOnboarding();
  };
  
  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem('hasSeenOnboarding', 'true');
      router.replace('/auth/login');
    } catch (error) {
      console.error('Error saving onboarding status:', error);
    }
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.skipContainer}>
        <Button 
          title={t('skip')}
          variant="ghost"
          size="sm"
          onPress={handleSkip}
        />
      </View>
      
      <View style={styles.slideContainer}>
        {onboardingData.map((item, index) => (
          <View 
            key={index} 
            style={[
              styles.slide, 
              { width, display: currentPage === index ? 'flex' : 'none' }
            ]}
          >
            <Image 
              source={{ uri: item.image }} 
              style={styles.image}
              resizeMode="cover"
            />
            <Text style={styles.title}>{t(item.title)}</Text>
            <Text style={styles.description}>{t(item.description)}</Text>
          </View>
        ))}
      </View>
      
      <View style={styles.pagination}>
        {onboardingData.map((_, index) => (
          <View
            key={index}
            style={[
              styles.paginationDot,
              index === currentPage && styles.paginationDotActive,
            ]}
          />
        ))}
      </View>
      
      <View style={styles.buttonContainer}>
        {currentPage > 0 && (
          <Button 
            leftIcon={<ChevronLeft size={20} />}
            title={t('back')}
            variant="outline"
            onPress={handleBack}
            style={styles.button}
          />
        )}
        
        <Button 
          title={currentPage === onboardingData.length - 1 ? t('getStarted') : t('next')}
          rightIcon={currentPage < onboardingData.length - 1 ? <ChevronRight size={20} /> : null}
          onPress={handleNext}
          style={[styles.button, { flex: 1 }]}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.white,
  },
  skipContainer: {
    position: 'absolute',
    top: 40,
    right: theme.isRTL ? null : 20,
    left: theme.isRTL ? 20 : null,
    zIndex: 10,
  },
  slideContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  image: {
    width: '80%',
    height: '45%',
    borderRadius: theme.radius.xl,
    marginBottom: theme.spacing[8],
  },
  title: {
    fontSize: theme.typography.fontSizes['2xl'],
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
    textAlign: 'center',
    marginBottom: theme.spacing[4],
  },
  description: {
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.gray[600],
    textAlign: 'center',
    lineHeight: theme.typography.lineHeights.base * theme.typography.fontSizes.md,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: theme.spacing[8],
  },
  paginationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.gray[300],
    marginHorizontal: theme.spacing[1],
  },
  paginationDotActive: {
    backgroundColor: theme.colors.primary[600],
    width: 20,
  },
  buttonContainer: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[10],
    alignItems: 'center',
  },
  button: {
    marginHorizontal: theme.spacing[2],
  },
}));