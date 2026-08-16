// User-facing error text. Infrastructure never reaches a student.
//
// The chat printed error.message verbatim, so a failed connection read:
//
//   Sorry, I couldn't process your message. fetch failed:
//   java.net.ConnectException: Failed to connect to
//   modakerati.greenpedal.net/91.121.51.179:443
//
// — the host name and its IP address, shown to a student writing a thesis, who
// can do nothing with either. It also arrived in English inside an Arabic UI.
//
// The rule is all-or-nothing: a message that shows ANY sign of infrastructure is
// replaced ENTIRELY by a written one. Scrubbing the offending token out and
// printing the rest is the tempting version and the wrong one — it leaks the
// moment a transport invents a format the pattern does not know, and a partly
// redacted stack trace is not something a student should read either way.
import i18n from "./i18n";

// Transport failures: the request never came back. These are the errors that
// carry hosts, IPs and Java/OkHttp class names, and to a student they all mean
// one thing — the app could not reach the server.
const CONNECTION_RE =
  /network request failed|fetch failed|failed to connect|connect(?:ion)?exception|unknownhost|sockettimeout|econnrefused|econnreset|enotfound|etimedout|timed? ?out|network error|offline/i;

// Infrastructure of any shape, used as a DETECTOR (not a replacer): a URL, an
// IPv4 address, a fully-qualified Java/Android/OkHttp class name, or any bare
// host-looking token with a TLD and optional port.
//
// Deliberately broad. A false positive costs one specific message, replaced by
// a general one; a false negative prints a server address to a student.
const INFRA_RE =
  /(?:\b[a-z]+:\/\/)|(?:\b\d{1,3}(?:\.\d{1,3}){3}\b)|(?:\b(?:java|javax|android|kotlin|okhttp3?)\.[\w.$]+)|(?:\b[a-z0-9-]+\.[a-z]{2,}(?::\d+)?\b)/i;

/**
 * Turn any thrown value into something safe to show a student.
 *
 * A human-readable message the SERVER authored (a validation refusal, say) is
 * passed through — those are written for the student and carry no addresses.
 * Everything else collapses to one of two written sentences.
 */
/** Read a thrown value's message, whatever shape it arrived in. */
export function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : typeof e === "string" ? e : "")?.trim() ?? "";
}

/**
 * True when the request never reached the server.
 *
 * Worth distinguishing from every other failure, because it is the only one
 * where RETRYING THE SAME THING is the right advice — and where a screen must
 * not conclude that whatever it was carrying has gone bad. A password-reset link
 * whose exchange dies on a lost connection is still a perfectly good link.
 */
export function isConnectionError(e: unknown): boolean {
  const raw = errorText(e);
  return raw ? CONNECTION_RE.test(raw) : false;
}

/**
 * True when the message shows ANY sign of infrastructure — a host, an IP, a
 * Java/OkHttp class name — and so must be replaced wholesale rather than shown.
 */
export function looksLikeInfrastructure(e: unknown): boolean {
  const raw = errorText(e);
  return raw ? INFRA_RE.test(raw) : false;
}

export function userFacingError(e: unknown): string {
  const raw = errorText(e);

  const offline = i18n.t("chat.errorOffline", {
    defaultValue: "I couldn't reach the server. Check your connection and try again.",
  });
  const generic = i18n.t("chat.errorGeneric", {
    defaultValue: "Something went wrong. Please try again.",
  });

  if (!raw) return generic;
  // Order matters: a ConnectException trips BOTH patterns, and "check your
  // connection" is the more useful of the two answers.
  if (CONNECTION_RE.test(raw)) return offline;
  if (INFRA_RE.test(raw)) return generic;
  return raw;
}
