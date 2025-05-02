import { createContext, useContext, useState, useEffect } from 'react';
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@/components/ThemeProvider';

// Import translations
import en from './translations/english/index';
import ar from './translations/arabic/index';

const i18n = new I18n({
  en,
  ar,
});

// Default to device locale
i18n.locale = Localization.locale.split('-')[0];
i18n.enableFallback = true;
i18n.defaultLocale = 'en';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(i18n.locale);
  const isRTL = locale === 'ar';

  const { setIsRTL } = useTheme();

  // Load saved locale from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      const savedLocale = await AsyncStorage.getItem('app_locale');
      if (savedLocale) {
        setLocale(savedLocale);
      }
    })();
  }, []);

  useEffect(() => {
    i18n.locale = locale;
    setIsRTL(locale === 'ar');
    AsyncStorage.setItem('app_locale', locale);
  }, [locale, setIsRTL]);

  const t = (key, options) => {
    return i18n.t(key, options);
  };

  const changeLanguage = (lang) => {
    setLocale(lang);
  };

  return (
    <I18nContext.Provider value={{ t, locale, changeLanguage , isRTL }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useTranslation = () => useContext(I18nContext);