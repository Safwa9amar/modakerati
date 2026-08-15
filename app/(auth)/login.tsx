import { useState, useEffect } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";
import { useAuthStore } from "@/stores/auth-store";
import { isAppleSignInAvailable } from "@/lib/apple-auth";
import { userFacingError } from "@/lib/safe-error";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";

const WORDMARK = require("../../assets/wordmark.png");

export default function LoginScreen() {
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);
  const router = useRouter();
  const { t } = useTranslation();
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asked at runtime, not inferred from Platform: Sign in with Apple is also
  // unavailable on an iOS build made before the entitlement was added, and an
  // Apple button that cannot work is worse than no Apple button. Starts hidden
  // so it never flashes in on Android.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    isAppleSignInAvailable().then((ok) => {
      if (active) setAppleAvailable(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  const busy = loading || googleLoading || appleLoading;

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithEmail(email, password);
    setLoading(false);
    if (err) setError(userFacingError(err));
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    const { error: err, cancelled } = await signInWithGoogle();
    setGoogleLoading(false);
    // Backing out of the Google sheet is a normal thing to do — say nothing.
    // On success there is nothing to do either: the new session moves the app
    // to the chat through useProtectedRoute, and this screen unmounts.
    if (!cancelled && err) setError(userFacingError(err));
  };

  const handleApple = async () => {
    setError(null);
    setAppleLoading(true);
    const { error: err, cancelled } = await signInWithApple();
    setAppleLoading(false);
    // Dismissing the Apple sheet is normal — say nothing.
    if (!cancelled && err) setError(userFacingError(err));
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
            {/* The wordmark is emissive art — its "will" is white with a glow, so
                it only reads on the dark ground. The light theme keeps the type. */}
            {theme === "dark" ? (
              <Image
                source={WORDMARK}
                style={styles.wordmark}
                resizeMode="contain"
                accessibilityLabel={t("auth.appName")}
              />
            ) : (
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {t("auth.appName")}
              </Text>
            )}
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
              disabled={!email || !password || busy}
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
              onPress={handleGoogle}
              disabled={busy}
              style={[
                styles.socialButton,
                { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle, borderWidth: 1 },
                busy && styles.socialButtonDisabled,
              ]}
            >
              {googleLoading ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text style={[styles.socialText, { color: colors.textPrimary }]}>
                  {t("auth.continueGoogle")}
                </Text>
              )}
            </Pressable>
            {/* iOS only — see isAppleSignInAvailable. Android students still
                have Google and email. */}
            {appleAvailable && (
              <Pressable
                onPress={handleApple}
                disabled={busy}
                style={[
                  styles.socialButton,
                  { backgroundColor: "#000000" },
                  busy && styles.socialButtonDisabled,
                ]}
              >
                {appleLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.socialText, { color: "#FFFFFF" }]}>
                    {t("auth.continueApple")}
                  </Text>
                )}
              </Pressable>
            )}
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
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  // The art carries its own glow padding, so it sits on negative margins to keep
  // the optical spacing the type had.
  wordmark: {
    width: 232,
    height: 146, // the art's own 1.585 aspect, so `contain` letterboxes nothing
    alignSelf: "flex-start",
    marginTop: -20,
    marginBottom: -16,
    marginStart: -18,
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
  socialButtonDisabled: { opacity: 0.5 },
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
