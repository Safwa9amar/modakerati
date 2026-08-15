import * as Linking from "expo-linking";
import { supabase } from "./supabase";

/**
 * "Continue with Google", as a browser OAuth round trip:
 *
 *   supabase.auth.signInWithOAuth  → an accounts.google.com URL
 *   WebBrowser.openAuthSessionAsync → the student picks an account
 *   Google → https://<project>.supabase.co/auth/v1/callback → back to our scheme
 *   exchangeCodeForSession          → a real session in SecureStore
 *
 * Google never redirects to `kwill://` itself — custom schemes are not
 * allowed as Google redirect URIs. It only ever calls Supabase back, and
 * Supabase is what bounces to the app, which is why the app needs no client
 * secret and no Google Cloud entry of its own.
 *
 * Dashboard setup this depends on (Authentication → Providers → Google, and
 * → URL Configuration → Redirect URLs):
 *   - the Web OAuth client's ID + secret on the Google provider
 *   - `kwill://*` in the redirect allow-list (plus `exp://` for Expo Go)
 */

type WebBrowserModule = typeof import("expo-web-browser");

let webBrowser: WebBrowserModule | null | undefined;

/**
 * expo-web-browser resolves its native module at IMPORT time, so on a binary
 * built before it was added the import itself throws "Cannot find native module
 * 'ExpoWebBrowser'". auth-store imports this file and app/_layout.tsx imports
 * auth-store, so a top-level import would take the WHOLE APP down at boot.
 * Loading it on the tap instead means a stale build costs the student Google
 * sign-in and nothing else — and says so, rather than dying at the splash.
 */
function loadWebBrowser(): WebBrowserModule | null {
  if (webBrowser === undefined) {
    try {
      webBrowser = require("expo-web-browser") as WebBrowserModule;
      // Web only — closes the popup the redirect landed in. Returns a harmless
      // `{ type: 'failed' }` on native instead of throwing.
      webBrowser.maybeCompleteAuthSession();
    } catch {
      webBrowser = null;
    }
  }
  return webBrowser;
}

export type GoogleSignInResult = {
  /** A message worth showing the user, or null when there is nothing wrong. */
  error: string | null;
  /** True when the student closed the browser themselves — not a failure. */
  cancelled: boolean;
};

/**
 * Where Supabase sends the browser once Google is done.
 *
 * Deliberately the ROOT route, not a dedicated `/auth/callback` screen. On
 * Android `openAuthSessionAsync` is a polyfill over a `Linking` listener, so the
 * callback URL is delivered to every listener — expo-router's included, which
 * navigates to whatever path it names. A path with no route would strand the
 * user on "Unmatched Route": `useProtectedRoute` only redirects people who are
 * inside (auth) or (app), and has no branch for a signed-in user sitting
 * outside both. "/" always resolves, and app/index.tsx forwards to the chat as
 * soon as the session lands.
 */
function callbackUrl() {
  return Linking.createURL("/");
}

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const WebBrowser = loadWebBrowser();
  if (!WebBrowser) {
    return {
      error: "Google sign-in needs a newer build of the app. Please update.",
      cancelled: false,
    };
  }

  const redirectTo = callbackUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // We open the browser ourselves; left on, supabase-js would try to
      // navigate a `window` that does not exist on native.
      skipBrowserRedirect: true,
      // Always offer the account picker. Without it Google silently reuses
      // whichever account the system browser is already signed into, and a
      // student on a shared or family device has no way to correct it.
      queryParams: { prompt: "select_account" },
    },
  });

  if (error) return { error: error.message, cancelled: false };
  if (!data?.url) {
    return { error: "Google sign-in is not configured for this project.", cancelled: false };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  // 'cancel' — the student dismissed the sheet. 'dismiss' — it was closed for
  // them. Neither is an error, and neither should paint red text on the form.
  if (result.type !== "success") return { error: null, cancelled: true };

  const params = readCallbackParams(result.url);

  // A refused consent screen comes back as ?error=access_denied rather than as
  // a thrown error, so this has to be read before looking for the code.
  const denied = params.get("error_description") ?? params.get("error");
  if (denied) {
    return { error: denied, cancelled: params.get("error") === "access_denied" };
  }

  const code = params.get("code");
  if (!code) {
    return { error: "Google did not return a sign-in code.", cancelled: false };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return { error: exchangeError.message, cancelled: false };

  // Nothing to navigate: persisting the session fires supabase's
  // onAuthStateChange, which auth-store forwards to setSession, which flips
  // isAuthenticated and lets useProtectedRoute move the app to the chat.
  return { error: null, cancelled: false };
}

/**
 * Read the callback's parameters out of BOTH the query string and the fragment.
 *
 * PKCE puts `code` in the query, but Supabase can report a failure in the
 * fragment instead, and a fragment is invisible to `new URL(...).searchParams`.
 * Parsing by hand also sidesteps custom-scheme URLs, which the URL polyfill
 * treats as opaque.
 */
function readCallbackParams(url: string): URLSearchParams {
  const merged = new URLSearchParams();
  const [beforeHash = "", afterHash = ""] = url.split("#");
  const queryIndex = beforeHash.indexOf("?");
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex + 1);

  for (const part of [query, afterHash]) {
    if (!part) continue;
    // The query wins on a collision — it is the half PKCE actually writes.
    new URLSearchParams(part).forEach((value, key) => {
      if (!merged.has(key)) merged.set(key, value);
    });
  }
  return merged;
}
