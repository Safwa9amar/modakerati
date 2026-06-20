import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";

function getPasswordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

export default function ResetPasswordScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const strength = getPasswordStrength(newPassword);

  const strengthLabel =
    strength <= 1 ? "Weak" : strength === 2 ? "Fair" : strength === 3 ? "Good" : "Strong";
  const strengthColor =
    strength <= 1
      ? colors.semanticError
      : strength === 2
      ? colors.semanticWarning
      : colors.brandAccent;

  const handleReset = () => {
    router.replace("/(auth)/login" as any);
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
    >
      <View style={styles.content}>
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
            {t("auth.newPasswordDesc")}
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            label={t("auth.newPassword")}
            placeholder={t("auth.newPassword")}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
          />
          <TextInput
            label={t("auth.confirmPassword")}
            placeholder={t("auth.confirmPassword")}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
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
              <Text
                style={[styles.strengthLabel, { color: strengthColor }]}
              >
                {strengthLabel} password
              </Text>
            </View>
          )}

          <Button
            title={t("auth.resetPassword")}
            onPress={handleReset}
            disabled={
              !newPassword || !confirmPassword || newPassword !== confirmPassword
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
});
