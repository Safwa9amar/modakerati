// Catching the auth link when it comes back into the app.
//
// Two doors, and both have to be watched: `getInitialURL` for a cold start (the
// app was killed and the link launched it — the common case, since the student
// leaves for a mail app) and the "url" event for a warm one.
import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { supabase } from "./supabase";
import { isConnectionError } from "./safe-error";
import { retryingOnLostConnection } from "./auth-retry";
import { useAuthStore } from "@/stores/auth-store";
import {
  readCallbackParams,
  readPendingAuthLink,
  clearPendingAuthLink,
} from "./auth-link";

/**
 * Complete a password reset or signup confirmation that arrived as a link.
 *
 * `enabled` gates on the app being mounted: this navigates, and a `replace()`
 * issued before the router exists is dropped on the floor. The root layout
 * renders null until fonts and the session are ready, so the hook is handed the
 * same condition.
 */
export function useAuthDeepLink(enabled: boolean) {
  const router = useRouter();
  // Both doors can deliver the SAME url — a cold start fires getInitialURL, and
  // some Android launches also emit the event. A Supabase code is single-use, so
  // the second exchange would fail and paint an error over a reset that actually
  // succeeded.
  const consumed = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    const consume = async (url: string) => {
      if (!url || consumed.current.has(url)) return;

      const params = readCallbackParams(url);
      const code = params.get("code");
      const failure = params.get("error_description") ?? params.get("error");
      // The implicit shape: tokens delivered directly in the fragment instead of
      // a code to exchange. GoTrue answers this way whenever the request that
      // produced the link carried no PKCE challenge — which is every link made
      // with the admin API, the only way to get one without spending an email
      // from the 2-per-hour allowance.
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!code && !failure && !accessToken) return; // an ordinary deep link — a notification route, say

      // Implicit links say what they are (`type=recovery`), so unlike the PKCE
      // path they need no remembered flag — which is what makes an
      // admin-generated link usable on a device that never asked for one.
      if (accessToken && refreshToken) {
        consumed.current.add(url);
        const isRecovery = params.get("type") === "recovery";
        useAuthStore.getState().setLinkSignIn(isRecovery ? "recovery" : "signup");
        try {
        // Before setSession, for the same reason as the PKCE branch below.
        if (isRecovery) useAuthStore.getState().beginRecovery();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!active) return;
        await clearPendingAuthLink();
        if (sessionError) {
          if (isRecovery) await useAuthStore.getState().abandonRecovery();
          if (isConnectionError(sessionError.message)) consumed.current.delete(url);
          router.replace({
            pathname: "/(auth)/forgot-password",
            params: { linkError: "1" },
          } as any);
          return;
        }
        if (isRecovery) router.replace("/(auth)/reset-password" as any);
        } finally {
          // Every branch above returns; the overlay must come down on all of them.
          useAuthStore.getState().setLinkSignIn(null);
        }
        return;
      }

      // The flag is what makes this ours. Without it a Google sign-in callback
      // would be swallowed here: on Android openAuthSessionAsync is a polyfill
      // over Linking, so ITS `?code=` reaches this listener too, and racing
      // google-auth for the same single-use code would break sign-in.
      const flow = await readPendingAuthLink();
      if (!flow || !active) return;

      consumed.current.add(url);

      // Supabase reports an expired or already-spent link this way rather than
      // by throwing. That IS terminal, so the flag goes.
      if (failure || !code) {
        await clearPendingAuthLink();
        router.replace({
          pathname: "/(auth)/forgot-password",
          params: { linkError: "1" },
        } as any);
        return;
      }

      // Raised BEFORE the exchange, never after. The exchange lands a session,
      // which flips `isAuthenticated`, which is exactly what the route guard
      // watches — a flag set one line later leaves a window in which the guard
      // sees an authenticated student inside (auth) and throws them into the
      // app, skipping the screen that sets the password.
      if (flow === "recovery") useAuthStore.getState().beginRecovery();
      useAuthStore.getState().setLinkSignIn(flow);

      // Retried: the code is not spent unless the exchange SUCCEEDS, so a lost
      // connection costs nothing and a second attempt usually lands.
      const { error } = await retryingOnLostConnection(() =>
        supabase.auth.exchangeCodeForSession(code),
      );
      if (!active) return;

      if (error) {
        if (flow === "recovery") await useAuthStore.getState().abandonRecovery();

        // A DROPPED CONNECTION IS NOT A DEAD LINK, and conflating the two is
        // expensive: the student is told to request another mail, and the
        // built-in mailer only allows about two an hour, so the advice locks
        // them out of the very thing it recommends. The PKCE code is not spent
        // until an exchange SUCCEEDS, so this link is still good — keep the
        // pending flag and forget the url, and simply opening it again works.
        useAuthStore.getState().setLinkSignIn(null);
        if (isConnectionError(error.message)) {
          consumed.current.delete(url);
          router.replace({
            pathname: "/(auth)/check-email",
            params: { flow, linkError: "offline" },
          } as any);
          return;
        }

        // Genuinely terminal: already used, expired, or opened on a device other
        // than the one that asked — PKCE keeps the verifier where the request
        // was made, so a link mailed to a phone cannot be finished on a laptop.
        await clearPendingAuthLink();
        router.replace({
          pathname: "/(auth)/forgot-password",
          params: { linkError: "1" },
        } as any);
        return;
      }

      await clearPendingAuthLink();
      useAuthStore.getState().setLinkSignIn(null);
      if (flow === "recovery") {
        router.replace("/(auth)/reset-password" as any);
      }
      // flow === "signup": the address is confirmed and the session is live, so
      // useProtectedRoute moves the app to the chat on its own. Navigating here
      // would only race it.
    };

    Linking.getInitialURL().then((url) => {
      if (url) consume(url);
    });
    const sub = Linking.addEventListener("url", (event) => consume(event.url));

    return () => {
      active = false;
      sub.remove();
    };
  }, [enabled]);
}
