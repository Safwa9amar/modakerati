import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";

export default function ForgotPasswordScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");

  const handleSendCode = () => {
    router.push("/(auth)/otp" as any);
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
              { backgroundColor: colors.brandPrimary + "1A" },
            ]}
          >
            <Lock size={48} color={colors.brandPrimary} strokeWidth={1.5} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {t("auth.forgotPassword")}
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {t("auth.newPasswordDesc")}
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
          <Button
            title={t("auth.sendResetCode")}
            onPress={handleSendCode}
            disabled={!email}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable onPress={() => router.push("/(auth)/login" as any)}>
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
    gap: 20,
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
