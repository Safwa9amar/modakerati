import { createContext, useContext, useState, useEffect } from 'react';
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { useTheme } from '@/components/ThemeProvider';

// Import translations
import en from './translations/en';
import ar from './translations/ar';

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
  const { setIsRTL } = useTheme();

  useEffect(() => {
    i18n.locale = locale;
    // Set RTL based on locale
    setIsRTL(locale === 'ar');
  }, [locale, setIsRTL]);

  const t = (key, options) => {
    return i18n.t(key, options);
  };

  const changeLanguage = (lang) => {
    setLocale(lang);
  };

  return (
    <I18nContext.Provider value={{ t, locale, changeLanguage }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useTranslation = () => useContext(I18nContext);