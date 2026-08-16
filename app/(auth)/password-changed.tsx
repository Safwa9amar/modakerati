import { useEffect } from "react";
import { View, Text, StyleSheet, BackHandler } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomInset } from "@/hooks/useBottomInset";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/Button";

/**
 * The last step of password recovery, and the only screen in (auth) that ends
 * with the student INSIDE the app.
 *
 * Two things make it a screen rather than a toast. The password change already
 * happened on the previous screen, so a student who never sees a confirmation
 * has no way to know whether it took — and this is the moment `recoveryMode`
 * comes down, which is what lets the route guard finally do its job.
 *
 * There is no back button on purpose: the flow behind it is spent. The emailed
 * code is burnt, the password is already new, and every screen back there would
 * either fail or do nothing.
 */
export default function PasswordChangedScreen() {
  const colors = useThemeColors();
  const bottomInset = useBottomInset(32);
  const router = useRouter();
  const { t } = useTranslation();
  const finishRecovery = useAuthStore((s) => s.finishRecovery);

  const goToApp = () => {
    // Order matters: lower the guard first, THEN navigate. Doing it the other
    // way round leaves one render in which the app group is mounted while
    // recoveryMode is still true — harmless today, but it makes the redirect
    // depend on which effect happens to run first.
    finishRecovery();
    router.replace("/(app)/chat" as any);
  };

  // Android hardware back would otherwise pop to reset-password — a form whose
  // work is done, sitting on a session the guard no longer holds in place.
  // Swallow it; the only way out of this screen is forward.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goToApp();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
    >
      <View style={styles.content}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: colors.semanticSuccess + "1A" },
          ]}
        >
          <CheckCircle2 size={56} color={colors.semanticSuccess} strokeWidth={1.5} />
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("auth.passwordChanged")}
        </Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {t("auth.passwordChangedDesc")}
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: bottomInset }]}>
        <Button title={t("auth.continueToApp")} onPress={goToApp} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
});
