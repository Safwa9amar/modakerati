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
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";

export default function SignupScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [university, setUniversity] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignUp = async () => {
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setError(null);
    setLoading(true);
    const { error: err } = await signUpWithEmail(email, password, fullName);
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      router.replace("/(auth)/login" as any);
    }
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
          <View style={styles.topRow}>
            <BackButton />
          </View>

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t("auth.createAccount")}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t("auth.signInSubtitle")}
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              label={t("auth.fullName")}
              placeholder={t("auth.fullName")}
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
            />
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
              label={t("auth.university")}
              placeholder={t("auth.university")}
              value={university}
              onChangeText={setUniversity}
            />
            <TextInput
              label={t("auth.password")}
              placeholder={t("auth.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <TextInput
              label={t("auth.confirmPassword")}
              placeholder={t("auth.confirmPassword")}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />

            {error && (
              <Text style={[styles.errorText, { color: colors.semanticError }]}>
                {error}
              </Text>
            )}

            <Button
              title={t("auth.createAccount")}
              onPress={handleSignUp}
              loading={loading}
              disabled={!fullName || !email || !password || !confirmPassword}
            />

            <Text style={[styles.terms, { color: colors.textSecondary }]}>
              {t("auth.termsAgree")}
            </Text>
          </View>

          <View style={styles.switchRow}>
            <Text style={[styles.switchText, { color: colors.textSecondary }]}>
              {t("auth.hasAccount")}{" "}
            </Text>
            <Pressable onPress={() => router.push("/(auth)/login" as any)}>
              <Text style={[styles.switchLink, { color: colors.brandPrimary }]}>
                {t("auth.signIn")}
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
    paddingTop: 12,
    paddingBottom: 32,
  },
  topRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  header: { marginBottom: 24 },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  form: { gap: 16 },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  terms: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
    marginTop: 4,
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
