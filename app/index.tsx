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

  // Hold still until the user is actually allowed into the app. Redirecting first
  // and letting the guard bounce them back would flash the app at a signed-out
  // user for a frame, and puts two writers of the same decision in a race.
  if (isLoading || !hasCompletedOnboarding || !isAuthenticated) return null;

  return <Redirect href={"/(app)/chat" as any} />;
}
