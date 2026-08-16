// Supabase's auth errors, in the student's language.
//
// GoTrue answers in English and only English — "Token has expired or is
// invalid", "Invalid login credentials". Printing those verbatim, which is what
// every auth screen used to do, puts an English sentence in the middle of an
// Arabic form and tells a student in Djelfa nothing they can act on.
//
// This maps the handful that a student can actually HIT onto written, translated
// sentences. Anything unrecognised that smells of infrastructure degrades to a
// general apology, so a GoTrue release inventing a new message can never leak a
// host or a stack trace onto a login form.
import i18n from "./i18n";
import { errorText, isConnectionError, looksLikeInfrastructure } from "./safe-error";
import { MIN_PASSWORD_LENGTH } from "./auth-rules";

// Ordered, and the order is load-bearing: GoTrue's expiry message is
// "Token has expired or is invalid", which matches the invalid pattern too. The
// student needs to be told to ask for a NEW code, not to retype the old one.
const RULES: Array<[RegExp, string, string]> = [
  [/expired/i, "auth.errorCodeExpired", "That code has expired. Send yourself a new one."],
  [
    /invalid.*(token|otp|code)|(token|otp|code).*invalid/i,
    "auth.errorCodeInvalid",
    "That code isn't right. Check it and try again.",
  ],
  [
    /invalid login credentials/i,
    "auth.errorBadCredentials",
    "That email and password don't match an account.",
  ],
  [
    /email not confirmed/i,
    "auth.errorEmailNotConfirmed",
    "Confirm your email address first — check your inbox for the code.",
  ],
  [
    /already registered|already been registered/i,
    "auth.errorAlreadyRegistered",
    "An account already uses this email. Sign in instead.",
  ],
  [
    /password should be at least|password is too short/i,
    "auth.errorPasswordShort",
    "Passwords need at least {{min}} characters.",
  ],
  [
    /different from the old password/i,
    "auth.errorSamePassword",
    "Choose a password you haven't used before.",
  ],
  // GoTrue's own throttle reads "For security purposes, you can only request
  // this after N seconds" — the resend cooldown on screen normally prevents it,
  // but not across a reinstall or a second device.
  [
    /rate limit|too many requests|for security purposes|only request this after/i,
    "auth.errorRateLimited",
    "Too many attempts. Wait a minute and try again.",
  ],
  [
    /unable to validate email|invalid email|email address.*invalid/i,
    "auth.errorInvalidEmail",
    "That doesn't look like a valid email address.",
  ],
];

/** Turn a Supabase auth error into a sentence written for a student, translated. */
export function authErrorMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Checked before the table, because a lost connection can carry almost any
  // wording and none of it is about the student's credentials.
  if (isConnectionError(raw)) {
    return i18n.t("auth.errorOffline", {
      defaultValue: "I couldn't reach the server. Check your connection and try again.",
    });
  }

  for (const [pattern, key, fallback] of RULES) {
    // `min` is passed to every rule, not just the length one: an unused
    // interpolation value costs nothing, whereas a missing one renders the
    // literal "{{min}}" into a sentence a student reads.
    if (pattern.test(raw)) {
      return i18n.t(key, { defaultValue: fallback, min: MIN_PASSWORD_LENGTH });
    }
  }

  // NOT userFacingError: its fallbacks are the CHAT's, and one of them ends
  // "…then tap Regenerate to try again" — advice for a screen with a Regenerate
  // button, printed on a password form that has none. Auth gets its own.
  if (looksLikeInfrastructure(raw)) {
    return i18n.t("auth.errorGeneric", {
      defaultValue: "Something went wrong. Please try again.",
    });
  }
  return errorText(raw) || i18n.t("auth.errorGeneric", {
    defaultValue: "Something went wrong. Please try again.",
  });
}
