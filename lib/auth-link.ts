// The plumbing behind auth emails that come back as a LINK rather than a code.
//
// Supabase mails `…/auth/v1/verify?token=…&redirect_to=<ours>`. Tapping it opens
// the browser, Supabase burns the token, and 302s to our scheme carrying a PKCE
// `code`. The app trades that code for a session. Nothing is ever typed.
//
// Why links and not six-digit codes: a code requires editing the email template,
// and Supabase locks template editing behind custom SMTP. The stock template is
// link-based and works today, on the free built-in mailer.
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type PendingAuthFlow = "recovery" | "signup";

// Deliberately NOT SecureStore: this is a routing hint, not a credential. The
// authorisation is the PKCE pair — a one-shot code in the URL plus a verifier
// that never left this device — and knowing "a reset is in progress" grants
// nobody anything.
const PENDING_KEY = "kwill.pendingAuthLink";

/**
 * Where Supabase sends the browser once it has burnt the emailed token.
 *
 * The ROOT route, matching lib/google-auth.ts and for its reason: on Android the
 * callback URL reaches every Linking listener, expo-router's included, which
 * navigates to whatever path the URL names. A path with no route strands the
 * student on "Unmatched Route". "/" always resolves.
 *
 * Resolves to `kwill:///` in a build and `exp://…` under Expo Go. Both must be
 * in Authentication → URL Configuration → Redirect URLs — and `kwill://*`
 * already is, or Google sign-in would not work either.
 */
export function authCallbackUrl(): string {
  return Linking.createURL("/");
}

/**
 * Remember that a link is in flight, and which kind.
 *
 * Needed because the returning URL cannot identify itself. Under PKCE Supabase
 * redirects with nothing but `?code=…` — no `type=recovery` — so a recovery
 * callback, a signup confirmation and a Google sign-in callback are
 * indistinguishable by their URL alone. This flag is what tells them apart, and
 * it must outlive the process: the student may well tap the link an hour later,
 * long after the app was killed.
 */
export async function markPendingAuthLink(flow: PendingAuthFlow): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, flow);
  } catch {
    // A failed write costs the deep-link route, not the email — the student can
    // still finish by asking for another link once the app is open.
  }
}

export async function readPendingAuthLink(): Promise<PendingAuthFlow | null> {
  try {
    const value = await AsyncStorage.getItem(PENDING_KEY);
    return value === "recovery" || value === "signup" ? value : null;
  } catch {
    return null;
  }
}

export async function clearPendingAuthLink(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // Left set, the worst case is one ignored Google callback: the handler finds
    // no `code` it can spend twice, since Supabase codes are single-use.
  }
}

/**
 * Read a callback's parameters out of BOTH the query string and the fragment.
 *
 * PKCE puts `code` in the query, but Supabase can report a failure in the
 * fragment instead, and a fragment is invisible to `new URL(...).searchParams`.
 * Parsing by hand also sidesteps custom-scheme URLs, which the URL polyfill
 * treats as opaque.
 */
export function readCallbackParams(url: string): URLSearchParams {
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
