import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomInset } from "@/hooks/useBottomInset";
import { useAuthStore } from "@/stores/auth-store";
import type { PendingAuthFlow } from "@/lib/auth-link";
import { authErrorMessage } from "@/lib/auth-errors";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";

// GoTrue mails one message per address per minute. A shorter timer would hand
// the student a button that answers "for security purposes, you can only
// request this after 47 seconds".
const RESEND_COOLDOWN = 60;

/**
 * The waiting room, for both emails that come back as a link.
 *
 *   flow=recovery — from Forgot password. The link re-opens the app on the
 *                   new-password screen.
 *   flow=signup   — from Create account, when the project confirms addresses.
 *                   The link confirms and drops the student straight into the app.
 *
 * There is nothing to type here on purpose: the whole point of the link is that
 * the student never transcribes anything. lib/auth-deeplink.ts is what actually
 * moves the app on when they come back.
 */
export default function CheckEmailScreen() {
  const colors = useThemeColors();
  const bottomInset = useBottomInset(32);
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    email?: string;
    flow?: PendingAuthFlow;
    linkError?: string;
  }>();
  const email = (params.email ?? "").trim();
  const flow: PendingAuthFlow = params.flow === "signup" ? "signup" : "recovery";

  const resendAuthEmail = useAuthStore((s) => s.resendAuthEmail);

  const [timer, setTimer] = useState(RESEND_COOLDOWN);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // The link was opened but the connection died mid-exchange. Deliberately NOT
  // "ask for a new link": the code is only spent by a successful exchange, so
  // the one already in their inbox still works — and a new one may not even be
  // available, since the built-in mailer allows about two an hour.
  useEffect(() => {
    if (params.linkError === "offline") setError(t("auth.linkOfflineRetry"));
  }, [params.linkError]);

  const handleResend = async () => {
    setError(null);
    setNotice(null);
    setResending(true);
    const { error: err } = await resendAuthEmail(email, flow);
    setResending(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    setTimer(RESEND_COOLDOWN);
    setNotice(t("auth.linkResent"));
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
            <MailCheck size={48} color={colors.brandAccent} strokeWidth={1.5} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {t("auth.checkEmail")}
          </Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {flow === "signup"
              ? t("auth.confirmLinkSentTo", { email })
              : t("auth.resetLinkSentTo", { email })}
          </Text>

          {/* Said plainly because the constraint is real and invisible: the
              one-shot code in the link can only be spent by the device that
              asked for it (its PKCE verifier never left this phone). Opening
              the mail on a laptop looks like it should work, and doesn't. */}
          <Text style={[styles.sameDevice, { color: colors.textSecondary }]}>
            {t("auth.openOnThisDevice")}
          </Text>
        </View>

        {error && (
          <Text style={[styles.feedback, { color: colors.semanticError }]}>
            {error}
          </Text>
        )}
        {notice && !error && (
          <Text style={[styles.feedback, { color: colors.semanticSuccess }]}>
            {notice}
          </Text>
        )}

        <View style={styles.resendRow}>
          <Text style={[styles.resendText, { color: colors.textSecondary }]}>
            {t("auth.didntReceive")}{" "}
          </Text>
          {timer > 0 ? (
            <Text style={[styles.resendTimer, { color: colors.textSecondary }]}>
              {t("auth.resendIn", { seconds: timer })}
            </Text>
          ) : (
            <Pressable onPress={handleResend} disabled={resending}>
              <Text
                style={[
                  styles.resendLink,
                  { color: colors.brandPrimary, opacity: resending ? 0.5 : 1 },
                ]}
              >
                {t("auth.resend")}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <Button
          title={t("auth.backToSignIn")}
          variant="secondary"
          onPress={() => router.replace("/(auth)/login" as any)}
        />
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
    marginBottom: 28,
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
    paddingHorizontal: 8,
  },
  sameDevice: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
    marginTop: 14,
    paddingHorizontal: 8,
    opacity: 0.85,
  },
  feedback: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 12,
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
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
});
