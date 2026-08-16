// One dropped request should not read as "wrong password".
//
// iOS returns NSURLErrorNetworkConnectionLost (-1005) — surfaced to JS as
// "fetch failed: The network connection was lost" — for a connection the OS tore
// down under us. On a phone that happens for entirely ordinary reasons: the app
// was resumed a moment ago (returning from a mail app or Safari is the classic
// case), Wi-Fi handed over to another band, the radio woke from idle. The
// request never reached the server and the same call a moment later succeeds.
//
// Without a retry every one of those becomes a red sentence on a login form, and
// the student concludes the app is broken.
import { isConnectionError } from "./safe-error";

/** The Supabase shape: never throws for an API failure, reports it in `error`. */
type SupabaseResult = { error: { message: string } | null };

/**
 * Re-run a Supabase auth call while it keeps failing to REACH the server.
 *
 * ⚠️ Only for calls that are safe to repeat. A refused password, an expired
 * token, a rate limit — all of those come back as an `error` too, and none is
 * retried: the guard is `isConnectionError`, so anything the server actually
 * answered is returned untouched on the first attempt.
 *
 * ⚠️ NOT for the mail-sending calls (`resetPasswordForEmail`, `resend`). A lost
 * connection can also mean the request landed and the REPLY was lost, in which
 * case the mail already went out — and the built-in mailer allows about two an
 * hour, so a retry can spend the student's last slot and come back with "too
 * many attempts". Those keep a button the student taps deliberately.
 */
export async function retryingOnLostConnection<T extends SupabaseResult>(
  call: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let result = await call();
  for (let attempt = 1; attempt < attempts; attempt++) {
    if (!result.error || !isConnectionError(result.error.message)) return result;
    // Short and widening. The radio usually settles within a few hundred
    // milliseconds, and a student watching a spinner will not wait longer.
    await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    result = await call();
  }
  return result;
}
