import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";
import { authErrorMessage } from "@/lib/auth-errors";
import { MIN_PASSWORD_LENGTH as MIN_LENGTH } from "@/lib/auth-rules";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";

function getPasswordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= MIN_LENGTH) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

export default function ResetPasswordScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const abandonRecovery = useAuthStore((s) => s.abandonRecovery);
  const hasSession = useAuthStore((s) => s.isAuthenticated);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The verified code IS the authorisation — `updateUser` writes to whoever the
  // session belongs to, and with no session there is nobody to write to. Landing
  // here without one means the flow was entered sideways (a stale deep link, a
  // reload); send them back to the start rather than let them type a password
  // into a form that will fail.
  useEffect(() => {
    if (!hasSession && !loading) {
      router.replace("/(auth)/forgot-password" as any);
    }
  }, [hasSession, loading]);

  const strength = getPasswordStrength(newPassword);
  const strengthLabel = [
    t("auth.strengthWeak"),
    t("auth.strengthWeak"),
    t("auth.strengthFair"),
    t("auth.strengthGood"),
    t("auth.strengthStrong"),
  ][strength];
  const strengthColor =
    strength <= 1
      ? colors.semanticError
      : strength === 2
      ? colors.semanticWarning
      : colors.brandAccent;

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    newPassword.length >= MIN_LENGTH && newPassword === confirmPassword && !loading;

  const handleReset = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    const { error: err } = await updatePassword(newPassword);
    setLoading(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    // `recoveryMode` is deliberately NOT cleared here. It is the only thing
    // keeping the route guard from replacing this stack with the app the instant
    // it re-runs, and the confirmation screen would never be seen. The last step
    // lowers it, on a tap.
    router.replace("/(auth)/password-changed" as any);
  };

  const handleCancel = async () => {
    // Not just a navigation: by now there is a live session on an account whose
    // password never changed. Dropping it is the difference between "I gave up"
    // and "I am silently signed in".
    await abandonRecovery();
    router.replace("/(auth)/login" as any);
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
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            <BackButton />
          </View>

          <View style={styles.center}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.brandAccent + "1A" },
              ]}
            >
              <ShieldCheck size={48} color={colors.brandAccent} strokeWidth={1.5} />
            </View>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {t("auth.createNewPassword")}
            </Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {t("auth.newPasswordDesc", { min: MIN_LENGTH })}
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              label={t("auth.newPassword")}
              placeholder={t("auth.newPassword")}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!loading}
            />
            <TextInput
              label={t("auth.confirmPassword")}
              placeholder={t("auth.confirmPassword")}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!loading}
              onSubmitEditing={handleReset}
              returnKeyType="done"
            />

            {newPassword.length > 0 && (
              <View style={styles.strengthWrap}>
                <View style={styles.strengthBar}>
                  {[0, 1, 2, 3].map((i) => (
                    <View
                      key={i}
                      style={[
                        styles.strengthSegment,
                        {
                          backgroundColor:
                            i < strength ? strengthColor : colors.bgSurface,
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: strengthColor }]}>
                  {strengthLabel}
                </Text>
              </View>
            )}

            {/* Said as it happens, not on submit — a rule you only learn by
                failing is a rule the form kept to itself. */}
            {tooShort && (
              <Text style={[styles.hint, { color: colors.semanticWarning }]}>
                {t("auth.errorPasswordShort", { min: MIN_LENGTH })}
              </Text>
            )}
            {mismatch && (
              <Text style={[styles.hint, { color: colors.semanticWarning }]}>
                {t("auth.passwordsDontMatch")}
              </Text>
            )}
            {error && (
              <Text style={[styles.hint, { color: colors.semanticError }]}>
                {error}
              </Text>
            )}

            <Button
              title={t("auth.resetPassword")}
              onPress={handleReset}
              loading={loading}
              disabled={!canSubmit}
            />

            <Pressable onPress={handleCancel} disabled={loading} style={styles.cancelRow}>
              <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
                {t("auth.backToSignIn")}
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
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
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
    gap: 16,
  },
  strengthWrap: {
    gap: 6,
  },
  strengthBar: {
    flexDirection: "row",
    gap: 6,
  },
  strengthSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  hint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  cancelRow: {
    alignItems: "center",
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
