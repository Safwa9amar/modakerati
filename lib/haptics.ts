import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Thin, crash-proof wrapper around expo-haptics. Every helper is fire-and-forget
// and NEVER throws: haptics are a non-essential nicety, so a missing/unavailable
// native module (e.g. before `expo run:android` rebuilds the dev client with the
// module linked) or a rejected promise must never surface to the caller. Web has
// no haptics engine, so every helper is a no-op there.
//
// The synchronous try/catch guards the case where the native module isn't linked
// yet and the call throws immediately; the `.catch()` swallows async rejections.
const isWeb = Platform.OS === "web";

function safe(run: () => Promise<void>): void {
  if (isWeb) return;
  try {
    void run().catch(() => {});
  } catch {
    // native module absent / unavailable — silently ignore
  }
}

/** Light selection tick — tap-to-select a block. */
export function hSelection(): void {
  safe(() => Haptics.selectionAsync());
}

/** Light impact — a subtle lift/pickup cue. */
export function hLight(): void {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Medium impact — a firmer confirm (long-press, drop). */
export function hMedium(): void {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Success notification — an action landed (approve, milestone). */
export function hSuccess(): void {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Warning notification — a destructive intent (delete confirm). */
export function hWarn(): void {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
