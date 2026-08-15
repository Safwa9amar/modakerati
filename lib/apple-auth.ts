import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "./supabase";

/**
 * "Continue with Apple", as the NATIVE flow:
 *
 *   AppleAuthentication.signInAsync → the system Face ID / password sheet
 *   supabase.auth.signInWithIdToken  → a real session in SecureStore
 *
 * No browser and no redirect, so none of the PKCE machinery in lib/google-auth.ts
 * applies here — Apple hands us a signed identity token directly and Supabase
 * verifies it against the bundle identifier.
 *
 * Dashboard setup this depends on (Authentication → Providers → Apple):
 *   - enable the provider
 *   - put `com.kwill.app` in **Client IDs**
 *   - leave the OAuth half (Services ID, Team ID, Key ID, .p8 secret) EMPTY —
 *     that is only for the web flow, which we deliberately do not use
 *
 * Unlike expo-crypto and expo-web-browser, this module resolves its native
 * module with `requireOptionalNativeModule`, so importing it on Android or on a
 * binary built before it was added does NOT throw — the stub simply reports
 * `isAvailableAsync() === false`. That is what lets the import stay at the top.
 */

export type AppleSignInResult = {
  /** A message worth showing the user, or null when there is nothing wrong. */
  error: string | null;
  /** True when the student dismissed the Apple sheet — not a failure. */
  cancelled: boolean;
};

/**
 * Whether to offer the button at all.
 *
 * Android and web have no native Sign in with Apple, and we chose not to add the
 * web fallback, so the button must not be rendered there — an Apple button that
 * cannot work is worse than no button. Also false on an iOS binary built before
 * `usesAppleSignIn`, which is why this is asked at runtime and not assumed from
 * the platform alone.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<AppleSignInResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { error: "Apple did not return an identity token.", cancelled: false };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
      // No nonce: the native flow does not need one, and supplying one to Apple
      // without passing the matching raw value here is the usual cause of
      // "Nonce mismatch" failures.
    });
    if (error) return { error: error.message, cancelled: false };

    await rememberAppleName(credential.fullName);

    // Nothing to navigate: the new session fires supabase's onAuthStateChange,
    // which auth-store forwards to setSession, which lets useProtectedRoute
    // move the app to the chat.
    return { error: null, cancelled: false };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    // The student tapped Cancel, or dismissed the sheet. Not an error, and it
    // must not paint red text on the form.
    if (code === "ERR_REQUEST_CANCELED") return { error: null, cancelled: true };
    const message = err instanceof Error ? err.message : "Apple sign-in failed.";
    return { error: message, cancelled: false };
  }
}

/**
 * Store the name Apple gives us, because it gives it EXACTLY ONCE.
 *
 * Apple returns `fullName` only on the very first authorization for this app;
 * every later sign-in returns null, and the identity token never carries a name
 * at all. So unless it is captured here it is gone permanently and the student's
 * profile stays nameless — the one way Apple differs sharply from Google, whose
 * token carries the name on every sign-in.
 *
 * It goes into user_metadata rather than straight into the profiles row because
 * that is where every other provider puts it, and the profile then fills itself
 * from there: `handle_new_user` reads it on INSERT, and the server's GET
 * /profile back-fills a row whose name is still blank. Writing it in one place
 * keeps Apple from needing a special case at the other end.
 *
 * A failure here is deliberately not fatal — the student is already signed in,
 * and a missing display name is not worth failing that.
 */
async function rememberAppleName(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
) {
  const given = fullName?.givenName?.trim() ?? "";
  const family = fullName?.familyName?.trim() ?? "";
  const name = [given, family].filter(Boolean).join(" ");

  // Empty on every sign-in after the first, and also when the student chose to
  // withhold their name. Both are normal; there is simply nothing to save.
  if (!name) return;

  const { error } = await supabase.auth.updateUser({
    data: {
      full_name: name,
      ...(given ? { given_name: given } : {}),
      ...(family ? { family_name: family } : {}),
    },
  });
  if (error) {
    console.warn("[apple-auth] could not store the name Apple returns only once:", error.message);
  }
}
