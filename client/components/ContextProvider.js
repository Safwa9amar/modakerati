import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { ThemeProvider } from '@/components/ThemeProvider';
import { I18nProvider } from '@/localization/i18nProvider';
import { useThesisStoreInit } from '../store/useThesisStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useEffect } from 'react';
import { PaperProvider } from 'react-native-paper';
export default function ContextProvider({ children }) {
  useFrameworkReady();
  useThesisStoreInit();
  const { init } = useAuthStore();

  useEffect(() => {
    init();
  }, []);

  return (
    <PaperProvider>
      <ThemeProvider>
        <I18nProvider>
          {children}
        </I18nProvider>
      </ThemeProvider>
    </PaperProvider>
  );
}
