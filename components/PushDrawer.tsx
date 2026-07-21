import React, { useEffect, useMemo } from "react";
import { View, Pressable, StyleSheet, useWindowDimensions, BackHandler, Keyboard } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { usePathname } from "expo-router";
import { useNavDrawerStore } from "@/stores/nav-drawer-store";
import { useThesisStore } from "@/stores/thesis-store";
import { ThesisOutlinePanel } from "@/components/workspace/ThesisOutlinePanel";

// Drawer covers 72% of the width; the pushed screen keeps a 28% dimmed peek.
const DRAWER_FRACTION = 0.72;
// Width of the right-edge zone that starts an open-swipe when the drawer is closed.
const EDGE_WIDTH = 24;
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Root-level "push" (slide) navigation drawer for the Thesis Structure outline.
 * Opening slides the ENTIRE app (children) left as one piece and reveals the
 * drawer on the right — RTL-native for the Arabic thesis content. Because it wraps
 * the whole navigator tree, the header, document, and chat tab bar all push
 * together (no per-screen wiring, no tab-bar left behind).
 *
 * Open state lives in `nav-drawer-store` (the settled truth); the `progress`
 * shared value is driven live by the edge/peek gestures and springs to the store
 * value on release / on a button/back/heading-tap. The edge gesture is inert
 * unless a thesis is current AND we're on the workspace or chat route.
 */
export function PushDrawer({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const DRAWER_W = Math.round(width * DRAWER_FRACTION);

  const open = useNavDrawerStore((s) => s.open);
  const pathname = usePathname();
  const hasThesis = useThesisStore((s) => !!s.getCurrentThesis());
  // Only the workspace and chat surfaces host the outline → gate the edge-swipe
  // (and back handler) there so it's inert on settings / home / auth / onboarding.
  const gateOk = hasThesis && !!pathname && (pathname.includes("thesis-workspace") || pathname.includes("chat"));

  // 0 = closed, 1 = open. `dragging` is true only while a gesture owns `progress`;
  // `openSV` mirrors the store's boolean on the UI thread so the reconcile reaction
  // and a cancelled gesture can settle WITHOUT a JS round-trip.
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const openSV = useSharedValue(open);

  const setOpen = (v: boolean) => {
    const s = useNavDrawerStore.getState();
    if (v) s.openDrawer();
    else s.closeDrawer();
  };

  // Mirror the store into the shared value + dismiss the keyboard on open.
  useEffect(() => {
    openSV.value = open;
    if (open) Keyboard.dismiss();
  }, [open]);

  // Single source of settling: whenever we're NOT dragging, spring `progress` to
  // the store's open state. This fires for a button / back / heading-tap / peek-tap
  // (openSV changed) AND the instant a gesture releases or is cancelled (dragging
  // → false) — so the drawer can never get stuck half-open.
  useAnimatedReaction(
    () => (dragging.value ? -1 : openSV.value ? 1 : 0),
    (target) => {
      if (target >= 0) progress.value = withSpring(target, SPRING);
    },
  );

  // Android hardware back closes the drawer instead of leaving the screen.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  // Close on route change (defensive — heading-tap already closes before nav).
  useEffect(() => {
    if (useNavDrawerStore.getState().open) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Right-edge swipe to OPEN (closed state only). Dragging left grows progress.
  // Memoized so a re-render never swaps the gesture mid-drag (which would drop it
  // without settling). onEnd commits to openSV FIRST (UI truth), so the reaction
  // settles to the right place even before the JS store catches up.
  const openPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          progress.value = clamp(-e.translationX / DRAWER_W, 0, 1);
        })
        .onEnd((e) => {
          const target = progress.value > 0.4 || e.velocityX < -600;
          openSV.value = target;
          dragging.value = false;
          runOnJS(setOpen)(target);
        })
        .onFinalize(() => {
          // Cancelled without onEnd → release ownership; the reaction snaps
          // progress back to the last committed state (openSV).
          dragging.value = false;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [DRAWER_W],
  );

  // Drag the dimmed peek RIGHT to close.
  const closePan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          progress.value = clamp(1 - e.translationX / DRAWER_W, 0, 1);
        })
        .onEnd((e) => {
          const target = !(progress.value < 0.6 || e.velocityX > 600);
          openSV.value = target;
          dragging.value = false;
          runOnJS(setOpen)(target);
        })
        .onFinalize(() => {
          dragging.value = false;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [DRAWER_W],
  );

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * DRAWER_W }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.5 }));

  return (
    <View style={styles.root}>
      {/* The track holds the app (left) and the drawer (immediately to its right);
          translating it left reveals the drawer — everything moves as one piece.
          All children are absolutely positioned so the track never flips under an
          RTL app UI (a flex row would). */}
      <Animated.View style={[styles.track, { width: width + DRAWER_W }, trackStyle]}>
        {/* The whole app. */}
        <View style={[styles.app, { width }]}>{children}</View>

        {/* Dimmed peek over the app — tap or drag-right to close (only when open). */}
        <GestureDetector gesture={closePan}>
          <Animated.View
            style={[styles.scrim, { width }, scrimStyle]}
            pointerEvents={open ? "auto" : "none"}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          </Animated.View>
        </GestureDetector>

        {/* The drawer panel, parked just off the right edge until the track slides. */}
        <View style={[styles.drawer, { left: width, width: DRAWER_W }]}>
          <ThesisOutlinePanel />
        </View>
      </Animated.View>

      {/* Right-edge open-swipe zone (closed state only, thesis surfaces only). */}
      {gateOk && !open && (
        <GestureDetector gesture={openPan}>
          <View style={[styles.edge, { width: EDGE_WIDTH }]} />
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  track: { flex: 1 },
  app: { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 0 },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: "#000", zIndex: 1 },
  drawer: { position: "absolute", top: 0, bottom: 0, zIndex: 2 },
  edge: { position: "absolute", top: 0, bottom: 0, right: 0, zIndex: 10 },
});
