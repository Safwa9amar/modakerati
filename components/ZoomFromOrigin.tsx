import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useZoomOriginStore } from "@/stores/zoom-origin-store";

// ─────────────────────────────────────────────────────────────────────────────
// A screen that grows out of the control that opened it, and collapses back into
// it on the way out.
//
// The three destinations under an assistant answer (Writer, Library, Tasks) are
// reached from a chip the student's thumb is already on. A slide from the bottom
// says "a new page arrived from somewhere"; growing out of the tap says "the
// thing you just pressed opened", which is the truth, and it makes closing legible
// before it happens — it goes back to where it came from.
//
// HOW: the native stack transition is switched OFF for these routes (see
// FROM_CHAT in app/(app)/_layout.tsx) and the movement happens here instead, as a
// transform on the screen's own content. Two pieces:
//
//   • a STATIC backdrop in the screen's own colour, full-bleed and opaque from
//     the first frame. Without it the growing content would be a small rectangle
//     over whatever the navigator left behind — on Android usually black, which
//     reads as a flash rather than a transition.
//   • the CONTENT, scaled from the tap point out to full size. The default
//     transform origin is the view's centre, so translating by (tap − centre) and
//     easing that to zero as the scale runs is what anchors the growth to the
//     finger rather than to the middle of the screen.
//
// Opened from anywhere else — a deep link, a thesis card, a redirect — there is
// no tap point to grow from and it fades instead. Never a hard cut: with the
// native animation off, a cut is what "none" would look like.
// ─────────────────────────────────────────────────────────────────────────────

// How small the content starts. A chip is roughly a fifth of the screen's width,
// and starting much under that reads as a zoom out of a dot rather than out of a
// button — the eye loses what it is watching and the growth looks like a pop.
const MIN_SCALE = 0.16;
const OPEN_MS = 280;
// Closing is quicker than opening. The student has already decided to leave, and
// a collapse that takes as long as the arrival reads as the screen resisting.
const CLOSE_MS = 190;
// How far into the collapse the navigation fires.
//
// Waiting for the animation to LAND before popping is what put a flat dark slab
// on screen — the collapsed content over an opaque backdrop — for as long as the
// screen took to tear itself down, which on the Writer is two WebViews and is not
// quick. Popping part way through overlaps the two: the chat is already painting
// while the last frames of the shrink play, which is what a container transform
// looks like anyway.
const HANDOFF = 0.5;

let nextId = 1;

/**
 * The close action for a screen wrapped in `ZoomFromOrigin`: collapse back into
 * the control that opened it, and navigate once the animation is off screen.
 *
 * Returns `active` as well, so a caller can tell whether it owns the exit — the
 * Android hardware back has to take over the pop itself when it does, or the
 * navigator cuts away mid-collapse.
 *
 * With no wrapper mounted, `collapse` runs `done` immediately: a caller never has
 * to know which case it is in.
 */
export function useZoomCollapse() {
  const active = useZoomOriginStore((s) => s.collapsers.length > 0);
  const collapse = useCallback((done: () => void) => {
    // Read at CALL time, not render time: the topmost wrapper is whichever is
    // mounted when the tap lands, which is not necessarily the one that was on
    // top when this hook last ran.
    const stack = useZoomOriginStore.getState().collapsers;
    const top = stack[stack.length - 1];
    if (top) top.run(done);
    else done();
  }, []);
  return { collapse, active };
}

export function ZoomFromOrigin({
  children,
  backdropColor,
  style,
}: {
  children: React.ReactNode;
  /** The screen's own background — what fills the frame around the growing content. */
  backdropColor: string;
  style?: ViewStyle;
}) {
  const { width, height } = useWindowDimensions();

  // Taken ONCE, on the first render, before any effect can run — an effect would
  // let the screen paint a frame at full size first, which is the one frame the
  // whole animation exists to replace. useState's initialiser is the only hook
  // that runs early enough and exactly once.
  const [origin] = useState(() => useZoomOriginStore.getState().take());

  const progress = useSharedValue(0);
  // Opaque for the whole of the arrival, and only ever animated on the way OUT.
  // Fading it IN would mean the first frames of a push showed through to whatever
  // the navigator happened to leave behind — usually nothing, i.e. black.
  const backdrop = useSharedValue(1);
  // Guards the collapse against a double tap on the close control: the second
  // press must not restart an animation whose `done` has already been queued.
  const closing = useRef(false);
  const handoff = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: origin ? OPEN_MS : OPEN_MS * 0.6,
      easing: Easing.out(Easing.cubic),
    });
  }, [origin, progress]);

  // A pending handoff must never outlive the screen: if something else pops it
  // first, the timer would fire `done` — another `router.back()` — on a screen
  // that is already gone, taking the chat's own predecessor with it.
  useEffect(() => {
    return () => {
      if (handoff.current) clearTimeout(handoff.current);
    };
  }, []);

  const collapse = useCallback(
    (done: () => void) => {
      if (closing.current) return;
      closing.current = true;
      progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) });
      // The backdrop goes with it. Left opaque it is the flat slab that used to
      // sit on screen between the collapse and the pop.
      backdrop.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) });
      handoff.current = setTimeout(done, Math.round(CLOSE_MS * HANDOFF));
    },
    [progress, backdrop],
  );

  // Announce this wrapper for as long as it is mounted, so the screen that OWNS
  // it — sitting above it in the tree, and therefore unable to read a context —
  // can still drive the collapse from its close button.
  useEffect(() => {
    const id = nextId++;
    useZoomOriginStore.getState().register({ id, run: collapse });
    return () => useZoomOriginStore.getState().unregister(id);
  }, [collapse]);

  // Captured as plain numbers so the worklet closes over values, not over a
  // React ref it would have to read across the bridge every frame.
  const ox = origin?.x ?? width / 2;
  const oy = origin?.y ?? height / 2;
  const zooms = !!origin;

  const contentStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (!zooms) {
      return { opacity: p, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    }
    // Fully opaque well before the end: the content should be readable while it
    // is still arriving, not resolve out of a haze at the last moment.
    const opacity = interpolate(p, [0, 0.35, 1], [0, 1, 1], Extrapolation.CLAMP);
    const scale = interpolate(p, [0, 1], [MIN_SCALE, 1], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [
        { translateX: (ox - width / 2) * (1 - p) },
        { translateY: (oy - height / 2) * (1 - p) },
        { scale },
      ],
    };
  });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <View style={[styles.host, style]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }, backdropStyle]}
      />
      <Animated.View style={[styles.content, contentStyle]}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  content: { flex: 1 },
});
