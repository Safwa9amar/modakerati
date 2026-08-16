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
/** Set the first time we line the layout direction up with the device locale. */
const RTL_BOOTSTRAP_KEY = "kwill-rtl-bootstrapped";

export const SUPPORTED_LANGUAGES = ["ar", "en", "fr"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Algeria's academic lingua franca — where the device tells us nothing usable. */
export const DEFAULT_LANGUAGE: AppLanguage = "fr";

export const RTL_LANGUAGES = ["ar"];

export function isRTL(lang: string): boolean {
  return RTL_LANGUAGES.includes(lang);
}

function isSupported(code: string | null | undefined): code is AppLanguage {
  return !!code && (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * The language the phone is set to, if we speak it.
 *
 * `getLocales()` is the device's PREFERENCE LIST, most-wanted first, so we walk
 * it rather than only reading [0]: a student whose phone is set to Kabyle or
 * Spanish with French second should land in French, not in the fallback by
 * coincidence. Only when nothing in that list is one of ours do we fall back.
 *
 * Synchronous by design — the settings store's initial state and i18next's `lng`
 * both need an answer before any await, so a fresh install never paints a frame
 * in the wrong language. Wrapped in try/catch because it is a native call and a
 * throw here would take the whole bundle down at import time.
 */
export function getDeviceLanguage(): AppLanguage {
  try {
    for (const locale of Localization.getLocales()) {
      if (isSupported(locale.languageCode)) return locale.languageCode;
    }
  } catch {
    // Native module not ready (web, tests) — fall through.
  }
  return DEFAULT_LANGUAGE;
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
export async function restartApp(delayMs = 500): Promise<boolean> {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  try {
    await reloadAppAsync("Language changed — applying new text direction");
    return true;
  } catch {
    if (__DEV__) DevSettings.reload();
    return false;
  }
}

/** The language the student picked, or — on a fresh install — the device's. */
export async function getStoredLanguage(): Promise<AppLanguage> {
  const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
  if (isSupported(stored)) return stored;
  return getDeviceLanguage();
}

/**
 * First launch only: make the layout direction agree with the language we just
 * inherited from the device, and report whether that needs a reboot.
 *
 * RN usually derives `I18nManager.isRTL` from the device locale on its own, so
 * on an Arabic phone this is a no-op. It is not always so — an install carrying
 * a `forceRTL` value from an earlier run, or an OEM that reports the preferred
 * language differently, leaves Arabic text laid out left-to-right. Forcing the
 * value settles it either way.
 *
 * The bootstrap flag is written BEFORE the direction changes, so a `forceRTL`
 * that fails to stick can never turn this into a reboot loop; and once the
 * student has been through the language screen their choice owns direction,
 * not the device.
 */
export async function applyDeviceRTLOnFirstLaunch(lang: string): Promise<boolean> {
  if (await AsyncStorage.getItem(RTL_BOOTSTRAP_KEY)) return false;
  await AsyncStorage.setItem(RTL_BOOTSTRAP_KEY, "1");

  const shouldBeRTL = isRTL(lang);
  if (shouldBeRTL === I18nManager.isRTL) return false;

  I18nManager.allowRTL(shouldBeRTL);
  I18nManager.forceRTL(shouldBeRTL);
  return true;
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    ar: { translation: ar },
  },
  // The device's language, resolved synchronously, so the first frame is already
  // right. `getStoredLanguage()` replaces it a tick later on any install where
  // the student has actually chosen one.
  lng: getDeviceLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
  compatibilityJSON: "v4",
});

export default i18n;
