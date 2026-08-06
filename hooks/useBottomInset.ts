import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * How far a bottom-docked bar must lift itself to clear the keyboard.
 *
 * ANDROID ONLY, and it is not optional: the app draws edge-to-edge, and once it
 * does, `windowSoftInputMode` is inert — the window is NEVER resized for the
 * IME. Nothing moves on its own, so a bar pinned to the bottom sits BEHIND the
 * keyboard unless it lifts by the measured height. Same math as BlockComposer's
 * dock and FloatingPill, which learned this the same way.
 *
 * iOS returns 0: there the screen's KeyboardAvoidingView (behavior="padding")
 * already shrinks the container, and adding a lift on top would double-count —
 * which is the bug behavior="height" used to cause on Android.
 */
export function useKeyboardLift(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    // Re-read on EVERY show: the height changes when the IME swaps layout
    // (language switch, emoji panel, suggestion strip) and the bar must re-lift.
    const showSub = Keyboard.addListener("keyboardDidShow", (e) =>
      setHeight(e?.endCoordinates?.height ?? 0),
    );
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}

/**
 * How much room a bottom-docked bar must leave beneath itself.
 *
 * Android runs EDGE-TO-EDGE (`edgeToEdgeEnabled=true`): the app owns the pixels
 * behind the system navigation, so anything docked to the bottom has to pad
 * ITSELF clear of it. How much is a DEVICE answer, never a design one — a
 * three-button navigation bar is ~48dp tall, a gesture pill ~16dp, a phone with
 * neither reports 0 — and that is exactly what the safe-area inset returns. iOS
 * reports the home indicator the same way. So: read it, never hardcode it.
 *
 * While the keyboard is up it covers the navigation bar, and nothing can
 * collide with a bar that isn't on screen. Holding the inset open then just
 * parks the docked bar a navigation bar's height above the keys, so the inset
 * collapses to `min` — which is also the floor on devices that report nothing.
 *
 * This is CLEARANCE, not keyboard avoidance. A bar that has to stay visible
 * while typing adds `useKeyboardLift()` on top.
 */
export function useBottomInset(min = 0): number {
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    // iOS gets the `will` events so the bar moves WITH the keyboard animation;
    // Android only fires the `did` pair.
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return keyboardVisible ? min : Math.max(insets.bottom, min);
}
