import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput as RNTextInput,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";

const OTP_LENGTH = 6;

export default function OtpScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [timer, setTimer] = useState(42);
  const refs = useRef<(RNTextInput | null)[]>([]);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const handleChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, "");
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);
    if (digit && index < OTP_LENGTH - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !otp[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handleVerify = () => {
    router.push("/(auth)/reset-password" as any);
  };

  const handleResend = () => {
    setTimer(42);
    setOtp(Array(OTP_LENGTH).fill(""));
    refs.current[0]?.focus();
  };

  const isFilled = otp.every((d) => d.length === 1);

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
            <Mail size={48} color={colors.brandAccent} strokeWidth={1.5} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {t("auth.checkEmail")}
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {t("auth.codeSentTo", { email: "hamza@univ-djelfa.dz" })}
          </Text>
        </View>

        <View style={styles.otpRow}>
          {Array.from({ length: OTP_LENGTH }).map((_, i) => (
            <RNTextInput
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              style={[
                styles.otpBox,
                {
                  backgroundColor: colors.bgInput,
                  color: colors.textPrimary,
                  borderColor: otp[i]
                    ? colors.brandPrimary
                    : colors.borderSubtle,
                },
              ]}
              value={otp[i]}
              onChangeText={(text) => handleChange(text, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              keyboardType="number-pad"
              maxLength={1}
              textAlign="center"
              selectionColor={colors.brandPrimary}
            />
          ))}
        </View>

        <View style={styles.buttonWrap}>
          <Button
            title={t("auth.verifyCode")}
            onPress={handleVerify}
            disabled={!isFilled}
          />
        </View>

        <View style={styles.resendRow}>
          <Text style={[styles.resendText, { color: colors.textSecondary }]}>
            {t("auth.didntReceive")}{" "}
          </Text>
          {timer > 0 ? (
            <Text style={[styles.resendTimer, { color: colors.textSecondary }]}>
              {t("auth.resend")} ({timer}s)
            </Text>
          ) : (
            <Pressable onPress={handleResend}>
              <Text style={[styles.resendLink, { color: colors.brandPrimary }]}>
                {t("auth.resend")}
              </Text>
            </Pressable>
          )}
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
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: 28,
  },
  otpBox: {
    width: 44,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
  },
  buttonWrap: {
    marginBottom: 24,
  },
  resendRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  resendText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  resendTimer: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  resendLink: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
