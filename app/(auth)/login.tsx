import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";

export default function LoginScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithEmail(email, password);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t("auth.welcomeTo")}
            </Text>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t("auth.appName")}
            </Text>
            <Text style={[styles.tagline, { color: colors.textSecondary }]}>
              {t("auth.signInSubtitle")}
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              label={t("auth.email")}
              placeholder={t("auth.email")}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              label={t("auth.password")}
              placeholder={t("auth.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Pressable
              onPress={() => router.push("/(auth)/forgot-password" as any)}
              style={styles.forgotRow}
            >
              <Text style={[styles.forgotText, { color: colors.brandPrimary }]}>
                {t("auth.forgotPassword")}
              </Text>
            </Pressable>

            {error && (
              <Text style={[styles.errorText, { color: colors.semanticError }]}>
                {error}
              </Text>
            )}

            <Button
              title={t("auth.signIn")}
              onPress={handleSignIn}
              loading={loading}
              disabled={!email || !password}
            />
          </View>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
            <Text style={[styles.dividerText, { color: colors.textSecondary }]}>
              {t("auth.or")}
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.borderSubtle }]} />
          </View>

          <View style={styles.socialButtons}>
            <Pressable
              style={[styles.socialButton, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle, borderWidth: 1 }]}
            >
              <Text style={[styles.socialText, { color: colors.textPrimary }]}>
                {t("auth.continueGoogle")}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.socialButton, { backgroundColor: "#000000" }]}
            >
              <Text style={[styles.socialText, { color: "#FFFFFF" }]}>
                {t("auth.continueApple")}
              </Text>
            </Pressable>
          </View>

          <View style={styles.switchRow}>
            <Text style={[styles.switchText, { color: colors.textSecondary }]}>
              {t("auth.noAccount")}{" "}
            </Text>
            <Pressable onPress={() => router.push("/(auth)/signup" as any)}>
              <Text style={[styles.switchLink, { color: colors.brandPrimary }]}>
                {t("auth.signUp")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 32,
  },
  header: { marginBottom: 32 },
  subtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  title: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  form: { gap: 16 },
  forgotRow: { alignSelf: "flex-end" },
  forgotText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  socialButtons: { gap: 12 },
  socialButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  socialText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 24,
  },
  switchText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  switchLink: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
