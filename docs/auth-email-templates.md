# Auth email — how password reset works, and what Supabase needs

_2026-08-16. Project `janzgpfnjzihelcwmkkg` (shared by all three repos)._

Password reset is **link-based**. Supabase mails a link, the link re-opens the
app, and the new password is typed **in the app** — never in a browser.

## Why a link and not a six-digit code

A code was built first and abandoned. Supabase refuses to let email templates be
edited at all until custom SMTP is configured — the dashboard says so on
Authentication → Emails: *"Set up custom SMTP to edit templates."* Since
`{{ .Token }}` can only reach a student by editing the template, **a code flow
cannot work on the built-in mailer**. The stock template is already link-based,
so the link flow works today, with no project configuration.

**The link flow needs no SMTP.** The first device test proved the mechanism: the
mail arrived and carried `?code=6ba02cca-…`, a valid PKCE code. It merely landed
on the API host instead of the app, because `redirectTo` was never set.

## The mechanism

```
forgot-password  →  resetPasswordForEmail(email, { redirectTo: kwill:/// })
                 →  Supabase mails …/auth/v1/verify?token=…&redirect_to=kwill:///
   student taps  →  browser → Supabase burns the token → 302 kwill:///?code=<pkce>
        the app  →  lib/auth-deeplink.ts: exchangeCodeForSession(code)
                 →  reset-password (in-app)  →  password-changed  →  the writer
```

Three things make it work, and each is a trap if changed:

1. **`kwill://*` must be in Authentication → URL Configuration → Redirect URLs.**
   It already is — Google sign-in redirects to the same place (`authCallbackUrl()`
   in `lib/auth-link.ts` is shared by both).
2. **A durable pending-flow marker.** Under PKCE the returning URL is a bare
   `?code=` — a recovery callback, a signup confirmation and a *Google* callback
   are indistinguishable. `markPendingAuthLink()` records which is in flight, in
   AsyncStorage rather than memory because the student leaves for a mail app and
   may return an hour later, long after the process died. Without it the handler
   would swallow Google's callback and race it for a single-use code.
3. **`recoveryMode` is raised BEFORE the exchange.** The exchange lands a
   session, which flips `isAuthenticated`, which is what the route guard watches.
   Raise the flag afterwards and the guard throws the student into the app one
   screen before they set a password — with the old one still on the account.

## Known limitation, stated on screen

The link only works **on the phone that asked for it**. PKCE keeps the code
verifier on the requesting device, so opening the mail on a laptop cannot
complete. `check-email.tsx` says this outright (`auth.openOnThisDevice`), and a
failed exchange routes back to forgot-password with `auth.linkExpired` rather
than dying silently. This is the one real cost of links over codes.

## What SMTP is still for

Nothing in the flow — only two things, both real but neither blocking:

- **The sender name.** Mail currently arrives from "Supabase Auth". Only custom
  SMTP can change it to "Kwill".
- **Volume.** The built-in mailer is capped around 2 messages an hour. Fine for
  testing, not for launch.

Prepared for when you do it, in `~/modakerati-server`:
`supabase/templates/recovery.html` + `confirmation.html` (trilingual fr/ar/en,
link-based, branded) and an `[auth.email.smtp]` block in `supabase/config.toml`
pointing at Resend with `env()` references for the key and sender address.

## ⚠️ `supabase config push` is not a patch

The CLI builds **one complete auth-config body** from `config.toml` and sends it.
Every field the file leaves at its default overwrites production. As the file
stands a push would:

- set `site_url` to `http://127.0.0.1:3000`, and
- send `external_google_enabled: false` / `external_apple_enabled: false` —
  there is no `[auth.external.google]` block in the file and Apple's says
  `enabled = false`.

Both providers are configured **in the dashboard only**; their client IDs and
secrets exist nowhere on either machine (verified by grep). A push would disable
Google and Apple sign-in with nothing local to restore them from. Mirror the live
provider settings into `config.toml` first, and fix `site_url`.

## Device checklist

No test runner in the app repo, so this is a device check:

1. **Forgot password?** → real address → **Send reset link**.
2. Mail arrives with a link. Tap it **on the phone**.
3. The app reopens on **Create a new password** — not the writer. If the writer
   opens, `recoveryMode` is not reaching the guard in `app/_layout.tsx`.
4. 8+ characters → confirmation screen → **Continue** lands in the chat.
5. Sign out, sign back in with the new password.
6. Tap the **same link again** — it should land on forgot-password saying the
   link expired, not crash or sign you in.
7. Back out at step 3 and confirm you are **not** silently signed in —
   `abandonRecovery` drops the half-authorised session.
8. **Google sign-in still works** — proves the deep-link handler isn't eating its
   callback.
