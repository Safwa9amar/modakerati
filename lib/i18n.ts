import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager } from "react-native";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import ar from "@/locales/ar.json";

const LANGUAGE_KEY = "modakerati-language";

export const RTL_LANGUAGES = ["ar"];

export function isRTL(lang: string): boolean {
  return RTL_LANGUAGES.includes(lang);
}

export async function setLanguageWithRTL(lang: string) {
  const shouldBeRTL = isRTL(lang);
  const currentRTL = I18nManager.isRTL;

  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  await i18n.changeLanguage(lang);

  if (shouldBeRTL !== currentRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
    return true; // signals restart needed
  }
  return false;
}

export async function getStoredLanguage(): Promise<string> {
  const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
  if (stored) return stored;
  const locale = Localization.getLocales()[0]?.languageCode ?? "fr";
  if (["ar", "en", "fr"].includes(locale)) return locale;
  return "fr";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: "fr",
  fallbackLng: "fr",
  interpolation: { escapeValue: false },
  compatibilityJSON: "v4",
});

export default i18n;
