import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomInset } from "@/hooks/useBottomInset";
import { useAuthStore } from "@/stores/auth-store";
import { authErrorMessage } from "@/lib/auth-errors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";

// Deliberately loose. The server is the authority on whether an address exists;
// this only stops the obviously-unsendable (no @, no dot) from costing a
// round trip and a rate-limit slot.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const colors = useThemeColors();
  const bottomInset = useBottomInset(32);
  const router = useRouter();
  const { t } = useTranslation();
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where a dead link lands. lib/auth-deeplink.ts sends the student back here
  // rather than to a dedicated failure screen, because the only useful thing to
  // do about an expired or already-spent link is ask for another one — and this
  // is the screen that does that.
  const { linkError } = useLocalSearchParams<{ linkError?: string }>();
  useEffect(() => {
    if (linkError) setError(t("auth.linkExpired"));
  }, [linkError]);

  const handleSendLink = async () => {
    setError(null);
    setLoading(true);
    const { error: err } = await requestPasswordReset(email);
    setLoading(false);
    // A wrong address is NOT reported. Supabase answers the same way whether or
    // not the account exists, on purpose — "no account with that email" would
    // turn this screen into a way to test which of a list of addresses have
    // signed up. So anything other than a transport failure moves forward, and
    // an unregistered student simply waits for mail that never comes.
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    router.push({
      pathname: "/(auth)/check-email",
      params: { email: email.trim(), flow: "recovery" },
    } as any);
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <View style={styles.topRow}>
            <BackButton />
          </View>

          <View style={styles.center}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.brandPrimary + "1A" },
              ]}
            >
              <Lock size={48} color={colors.brandPrimary} strokeWidth={1.5} />
            </View>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t("auth.forgotPasswordTitle")}
            </Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {t("auth.forgotPasswordDescLink")}
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
              autoComplete="email"
              textContentType="emailAddress"
              editable={!loading}
              onSubmitEditing={() => {
                if (EMAIL_RE.test(email.trim()) && !loading) handleSendLink();
              }}
              returnKeyType="send"
            />

            {error && (
              <Text style={[styles.errorText, { color: colors.semanticError }]}>
                {error}
              </Text>
            )}

            <Button
              title={t("auth.sendResetLink")}
              onPress={handleSendLink}
              loading={loading}
              disabled={!EMAIL_RE.test(email.trim()) || loading}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <Pressable onPress={() => router.replace("/(auth)/login" as any)}>
          <Text style={[styles.backLink, { color: colors.brandPrimary }]}>
            {t("auth.backToSignIn")}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  topRow: {
    flexDirection: "row",
    marginBottom: 32,
  },
  center: {
    alignItems: "center",
    marginBottom: 32,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginBottom: 10,
    textAlign: "center",
  },
  description: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  form: {
    gap: 20,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  footer: {
    alignItems: "center",
    paddingBottom: 32,
  },
  backLink: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
