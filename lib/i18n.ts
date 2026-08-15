import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DevSettings, I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import ar from "@/locales/ar.json";

const LANGUAGE_KEY = "kwill-language";

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

/**
 * Restarts the app so a fresh `I18nManager.forceRTL()` value takes effect (RN
 * only mirrors the layout at startup). `reloadAppAsync` reboots the SAME JS
 * bundle and works in release AND debug builds, so no expo-updates dependency
 * is needed; `DevSettings.reload()` is only a dev-client safety net.
 *
 * The small delay lets the zustand `persist` middleware finish its AsyncStorage
 * write (it is fired off, not awaited, by `setLanguage`) before the JS context
 * is torn down — the i18n key itself is already written synchronously above.
 */
export async function restartApp(delayMs = 500): Promise<void> {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  try {
    await reloadAppAsync("Language changed — applying new text direction");
  } catch {
    if (__DEV__) DevSettings.reload();
  }
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
