import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomInset } from "@/hooks/useBottomInset";
import { useSettingsStore } from "@/stores/settings-store";
import { getDeviceLanguage, restartApp, setLanguageWithRTL } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// The dark cut's "will" is white and vanishes on a light ground; the light cut
// is the same art with those glyphs recoloured to the light ink. See login.
const WORDMARK = require("../../assets/wordmark.png");
const WORDMARK_LIGHT = require("../../assets/wordmark-light.png");

type Language = "en" | "fr" | "ar";

const languages: { code: Language; native: string; subtitle: string }[] = [
  { code: "en", native: "English", subtitle: "English" },
  { code: "fr", native: "Fran\u00e7ais", subtitle: "French" },
  { code: "ar", native: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", subtitle: "Arabic" },
];

export default function LanguageScreen() {
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);
  const bottomInset = useBottomInset(32);
  const router = useRouter();
  const { t } = useTranslation();
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  // Preselected from the phone, not hardcoded — the screen is already being read
  // in that language by this point, so anything else would ask a student on an
  // Arabic device to opt back INTO Arabic, and silently switch them to English
  // if they just tapped Continue.
  const [selected, setSelected] = useState<Language>(() => getDeviceLanguage());
  const [busy, setBusy] = useState(false);

  const handleContinue = async () => {
    if (busy) return;
    setBusy(true);
    setLanguage(selected);
    const needsRestart = await setLanguageWithRTL(selected);
    completeOnboarding();
    // Arabic flips I18nManager, which RN only applies at startup — reboot now so
    // the very next screen (login) is already mirrored. `hasCompletedOnboarding`
    // is persisted, so the restart lands on login, not back here.
    if (needsRestart) {
      await restartApp();
      return;
    }
    setBusy(false);
    router.replace("/(auth)/login" as any);
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          {/* The mark, under either theme — each ground gets the cut of the art
              that reads on it. It carries the name, so no separate title. */}
          <Image
            source={theme === "dark" ? WORDMARK : WORDMARK_LIGHT}
            style={styles.wordmark}
            resizeMode="contain"
            accessibilityLabel={t("auth.appName")}
          />
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            {t("auth.appTagline")}
          </Text>
        </View>

        <Text style={[styles.chooseHeading, { color: colors.textPrimary }]}>
          {t("onboarding.chooseLanguage")}
        </Text>

        <View style={styles.languageList}>
          {languages.map((lang) => {
            const isSelected = selected === lang.code;
            return (
              <Pressable key={lang.code} onPress={() => setSelected(lang.code)}>
                <Card
                  borderColor={isSelected ? colors.brandPrimary : colors.borderSubtle}
                  style={styles.languageCard}
                >
                  <View style={styles.languageRow}>
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor: isSelected
                            ? colors.brandPrimary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {isSelected && (
                        <View
                          style={[
                            styles.radioInner,
                            { backgroundColor: colors.brandPrimary },
                          ]}
                        />
                      )}
                    </View>
                    <View>
                      <Text
                        style={[
                          styles.langNative,
                          { color: colors.textPrimary },
                        ]}
                      >
                        {lang.native}
                      </Text>
                      <Text
                        style={[
                          styles.langSubtitle,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {lang.subtitle}
                      </Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <Button title={t("common.continue")} onPress={handleContinue} loading={busy} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 40 },
  header: { alignItems: "center", marginBottom: 40 },
  // The art carries its own glow padding, so it sits on negative vertical
  // margins to keep the optical spacing the icon-and-title stack had.
  wordmark: {
    width: 260,
    height: 173, // the art's own 1.5 aspect, so `contain` letterboxes nothing
    marginTop: -18,
    marginBottom: -14,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  chooseHeading: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 16,
  },
  languageList: { gap: 12 },
  languageCard: { paddingVertical: 14, paddingHorizontal: 16 },
  languageRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  langNative: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  langSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
});
