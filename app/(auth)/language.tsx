import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";
import { setLanguageWithRTL } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type Language = "en" | "fr" | "ar";

const languages: { code: Language; native: string; subtitle: string }[] = [
  { code: "en", native: "English", subtitle: "English" },
  { code: "fr", native: "Fran\u00e7ais", subtitle: "French" },
  { code: "ar", native: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", subtitle: "Arabic" },
];

export default function LanguageScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const [selected, setSelected] = useState<Language>("en");

  const handleContinue = async () => {
    setLanguage(selected);
    await setLanguageWithRTL(selected);
    completeOnboarding();
    router.replace("/(auth)/login" as any);
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={[styles.logo, { backgroundColor: colors.brandPrimary }]}>
            <GraduationCap size={40} color="#FFFFFF" strokeWidth={1.5} />
          </View>
          <Text style={[styles.appName, { color: colors.textPrimary }]}>
            Modakerati
          </Text>
          <Text style={[styles.appNameAr, { color: colors.brandPrimaryLight }]}>
            {"\u0645\u0630\u0643\u0631\u062A\u064A"}
          </Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            {t("auth.appTagline", { defaultValue: "Your AI-powered thesis companion" })}
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

      <View style={styles.footer}>
        <Button title={t("common.continue")} onPress={handleContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 40 },
  header: { alignItems: "center", marginBottom: 40 },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  appName: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  appNameAr: {
    fontSize: 22,
    fontFamily: "Inter_500Medium",
    marginBottom: 8,
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
