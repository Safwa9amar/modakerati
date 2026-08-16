import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Covers the app while an emailed link is being spent.
 *
 * The gap it fills is real and was reported as "it takes a delay to log in":
 * tapping the link launches the app cold, which boots, restores a session,
 * renders whatever screen that implies — and only THEN does the network round
 * trip that turns the link into a session finish and move it somewhere else.
 * For a second or more the student sits on the login form they just came from,
 * with no sign the tap did anything, and taps again.
 *
 * Full-bleed rather than a spinner in a corner, because the screen underneath is
 * about to be replaced and interacting with it in the meantime does nothing
 * useful — one of the taps it invites is "send another link", which spends one
 * of the two emails an hour the project is allowed.
 */
export function AuthLinkOverlay() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  // A primitive, not an object — a fresh literal here would re-render the whole
  // app on every store write. See the Zustand note in CLAUDE.md.
  const flow = useAuthStore((s) => s.linkSignIn);

  if (!flow) return null;

  return (
    <View
      style={[styles.fill, { backgroundColor: colors.bgPrimary }]}
      // Swallows touches meant for the screen underneath, which is on its way out.
      pointerEvents="auto"
      accessibilityViewIsModal
    >
      <ActivityIndicator size="large" color={colors.brandPrimary} />
      <Text style={[styles.label, { color: colors.textPrimary }]}>
        {flow === "signup" ? t("auth.confirmingEmail") : t("auth.signingInWithLink")}
      </Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {t("auth.linkOneMoment")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    // Above the stack it covers, below nothing else — this is the topmost thing
    // the root layout renders.
    zIndex: 1000,
  },
  label: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    marginTop: 20,
    textAlign: "center",
  },
  hint: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
    textAlign: "center",
  },
});
