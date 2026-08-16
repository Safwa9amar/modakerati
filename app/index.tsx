import { Redirect } from "expo-router";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * The app's entry route. There is no dashboard any more — "/" is the CHAT, opened
 * on the thesis you last worked on. The writer is one row away in the drawer (and
 * one tap away from any answer that touches the document).
 *
 * No params: the chat reads the current thesis from `thesis-store`, which the root
 * layout restores from the persisted `lastThesisId` on launch. With no thesis at
 * all the chat renders the empty writer's starters instead.
 *
 * Auth and onboarding are NOT decided here: `useProtectedRoute` in the root layout
 * owns that, and redirecting a signed-out user twice (once here, once there) is
 * exactly the ping-pong that rule was written to prevent.
 */
export default function Index() {
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  // Primitives, never an object literal — see the Zustand rule in CLAUDE.md.
  const recoveryMode = useAuthStore((s) => s.recoveryMode);
  const linkSignIn = useAuthStore((s) => s.linkSignIn);

  // Hold still until the user is actually allowed into the app. Redirecting first
  // and letting the guard bounce them back would flash the app at a signed-out
  // user for a frame, and puts two writers of the same decision in a race.
  if (isLoading || !hasCompletedOnboarding || !isAuthenticated) return null;

  // ⚠️ A PASSWORD-RESET LINK LANDS ON THIS ROUTE.
  //
  // `authCallbackUrl()` is Linking.createURL("/"), so the URL Supabase redirects
  // to is `kwill:///#access_token=…` — and its PATH IS "/". expo-router's own
  // linking handler therefore navigates HERE, on its own, in addition to the
  // `router.replace` that lib/auth-deeplink.ts issues. Both run; whichever lands
  // second wins.
  //
  // That is the bug this branch fixes: the reset screen appeared for a frame and
  // was then replaced by the chat, because this route saw the session the link
  // had just created and forwarded into the app — with the password unchanged.
  // The route GUARD was never at fault; `recoveryMode` held it correctly. This
  // was a second writer of the same decision that did not know about recovery.
  //
  // Answering with the same destination the deep-link handler wants makes the
  // race unloseable rather than merely unlikely.
  if (recoveryMode) return <Redirect href={"/(auth)/reset-password" as any} />;

  // Still trading the link for a session. The overlay is covering the screen;
  // forwarding now would decide the destination before the flow knows it.
  if (linkSignIn) return null;

  return <Redirect href={"/(app)/chat" as any} />;
}
