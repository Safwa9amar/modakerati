import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  BackHandler,
  Keyboard,
  I18nManager,
  AppState,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { usePathname, useSegments } from "expo-router";
import {
  drawerOpenSV,
  drawerProgressSV,
  drawerDraggingSV,
  resettleDrawer,
  useNavDrawerStore,
} from "@/stores/nav-drawer-store";
import { AppDrawer } from "@/components/AppDrawer";

// Drawer covers 72% of the width; the pushed screen keeps a 28% dimmed peek.
const DRAWER_FRACTION = 0.72;
// Width of the leading-edge zone that starts an open-swipe when the drawer is
// closed. Wide enough to be found without looking — this is now the only gesture
// into the app's index, from every screen, so it can't be a hairline.
const EDGE_WIDTH = 32;
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;

// Which side the drawer lives on, derived from the app's writing direction:
// - RTL (Arabic) → right edge, opened by a right→left swipe (RTL-native, unchanged).
// - LTR (fr/en)  → left edge, opened by a left→right swipe, revealing from the left.
// isRTL is fixed per app launch, so a module constant is safe (worklets capture it).
const SIDE: "left" | "right" = I18nManager.isRTL ? "right" : "left";
const IS_LEFT = SIDE === "left";

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Root-level "push" (slide) navigation drawer — the app's ONLY index. Opening
 * slides the ENTIRE app (children) toward the trailing side as one piece and
 * reveals the drawer on the LEADING edge — left for LTR, right for RTL. Because it
 * wraps the whole navigator tree, every screen pushes with it (no per-screen
 * wiring).
 *
 * It hosts `AppDrawer`, which switches between the app index and the thesis
 * outline that used to own this drawer outright.
 *
 * Open state lives in `nav-drawer-store` (the settled truth); the `progress`
 * shared value is driven live by the edge/peek gestures and springs to the store
 * value on release / on a button/back/heading-tap. The edge gesture is live on
 * every authenticated surface and inert only inside the (auth) group.
 */
export function PushDrawer({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const DRAWER_W = Math.round(width * DRAWER_FRACTION);

  const open = useNavDrawerStore((s) => s.open);
  const pathname = usePathname();
  const segments = useSegments();
  // The drawer reaches every page now, so the edge-swipe is live everywhere the
  // user is signed in. Login / onboarding are the one exception: there is no app
  // to index yet, and those screens own their own horizontal gestures.
  const gateOk = segments[0] !== "(auth)";

  // All three live in the store module, not in `useSharedValue`: the store's
  // actions settle `progress` themselves (see `settle` there), so a slide starts
  // on the UI thread the instant it is asked for — and, more importantly, EVERY
  // request settles rather than only the ones that happen to change a value.
  const progress = drawerProgressSV;
  const dragging = drawerDraggingSV;
  const openSV = drawerOpenSV;

  // Whether the drawer is VISIBLE, which is not the same question as whether the
  // store thinks it is open. The scrim's interactivity hangs off this: if you can
  // see the drawer you must be able to dismiss it, even if the two states have
  // drifted apart. Flips only when progress crosses the threshold, so this is a
  // couple of re-renders per open/close, not one per frame.
  const [visuallyOpen, setVisuallyOpen] = useState(false);
  useAnimatedReaction(
    () => progress.value > 0.01,
    (shown, prev) => {
      if (shown !== prev) runOnJS(setVisuallyOpen)(shown);
    },
  );

  const setOpen = (v: boolean) => {
    const s = useNavDrawerStore.getState();
    if (v) s.openDrawer();
    else s.closeDrawer();
  };

  // Dismiss the keyboard on open, and re-settle defensively after a remount /
  // fast refresh (the store actions already did this on the hot path).
  useEffect(() => {
    openSV.value = open;
    if (open) Keyboard.dismiss();
    // Unconditional, for the same reason `settle` in the store is: a live pan
    // overwrites `progress` every frame anyway, so guarding on `dragging` bought
    // nothing and turned a dropped gesture-end into a permanently wedged drawer.
    progress.value = withSpring(open ? 1 : 0, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Settle the instant a gesture releases or is cancelled, without a JS round-trip.
  // The store handles every non-gesture path, so this reaction now only has to
  // cover `dragging` going false — it can no longer be the sole settler.
  useAnimatedReaction(
    () => (dragging.value ? -1 : openSV.value ? 1 : 0),
    (target) => {
      if (target >= 0) progress.value = withSpring(target, SPRING);
    },
  );

  // Android hardware back closes the drawer instead of leaving the screen. Gated on
  // VISIBLE, so back is also a way out of a drawer whose store state has drifted.
  useEffect(() => {
    if (!open && !visuallyOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open, visuallyOpen]);

  // Close on EVERY route change. Deliberately unguarded: the old version asked
  // only when the store believed itself open, which is worthless for the one case
  // that needs it — a drawer whose boolean says closed while the panel is still
  // painted (see `resettleDrawer`). `closeDrawer` is level-triggered, so an
  // already-closed drawer just re-springs to 0 and zustand skips the re-render.
  useEffect(() => {
    useNavDrawerStore.getState().closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Coming back from another activity — the document picker Import and Combine
  // open, the share sheet — re-settle to whatever the store decided while we were
  // away. A close requested in the same tick the picker launched may have been
  // frozen mid-slide with no frames to finish on; this is the frame it finishes.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") resettleDrawer();
    });
    return () => sub.remove();
  }, []);

  // Leading-edge swipe to OPEN (closed state only). LTR: drag right grows progress;
  // RTL: drag left grows it. Memoized so a re-render never swaps the gesture mid-drag
  // (which would drop it without settling). onEnd commits to openSV FIRST (UI truth),
  // so the reaction settles to the right place even before the JS store catches up.
  const openPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        // The finger leaves this 32pt strip almost immediately once the drag is
        // under way — the gesture has to keep tracking it across the whole screen.
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          const p = IS_LEFT ? e.translationX / DRAWER_W : -e.translationX / DRAWER_W;
          progress.value = clamp(p, 0, 1);
        })
        .onEnd((e) => {
          const flung = IS_LEFT ? e.velocityX > 600 : e.velocityX < -600;
          const target = progress.value > 0.4 || flung;
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

  // Drag the dimmed peek toward the leading edge to close (LTR: drag left; RTL: right).
  const closePan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          const p = IS_LEFT ? 1 + e.translationX / DRAWER_W : 1 - e.translationX / DRAWER_W;
          progress.value = clamp(p, 0, 1);
        })
        .onEnd((e) => {
          const flungClose = IS_LEFT ? e.velocityX < -600 : e.velocityX > 600;
          const target = !(progress.value < 0.6 || flungClose);
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

  // LTR: track parks shifted left by DRAWER_W (drawer off-screen left), sliding right
  // to reveal it. RTL: track at 0, sliding left to reveal the drawer off-screen right.
  const trackStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: IS_LEFT ? (progress.value - 1) * DRAWER_W : -progress.value * DRAWER_W },
    ],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.5 }));

  // Absolute layout of the three track children, mirrored by side.
  const appLeft = IS_LEFT ? DRAWER_W : 0; // LTR: app sits to the right of the drawer.
  const drawerLeft = IS_LEFT ? 0 : width; // drawer parked on the leading side.
  const scrimLeft = appLeft; // scrim tracks the app.

  return (
    <View style={styles.root}>
      {/* The track holds the app and the drawer side by side; translating it reveals
          the drawer on the leading edge — everything moves as one piece. All children
          are absolutely positioned so the track never flips under an RTL app UI. */}
      <Animated.View style={[styles.track, { width: width + DRAWER_W }, trackStyle]}>
        {/* The whole app. */}
        <View style={[styles.app, { width, left: appLeft }]}>{children}</View>

        {/* Dimmed peek over the app — tap or drag toward the edge to close (only when open). */}
        <GestureDetector gesture={closePan}>
          <Animated.View
            style={[styles.scrim, { width, left: scrimLeft }, scrimStyle]}
            // `visuallyOpen`, not `open`: a drawer you can see is a drawer you can
            // always dismiss, even mid-slide or after the two states have drifted.
            pointerEvents={open || visuallyOpen ? "auto" : "none"}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          </Animated.View>
        </GestureDetector>

        {/* The drawer panel, parked just off the leading edge until the track slides. */}
        <View style={[styles.drawer, { left: IS_LEFT ? drawerLeft : -DRAWER_W, width: DRAWER_W }]}>
          <AppDrawer />
        </View>
      </Animated.View>

      {/* Leading-edge open-swipe zone. Made INERT while open rather than unmounted:
          this detector is what opens the drawer, so `!open` used to tear it down in
          the middle of its own gesture. Unmounting between onEnd and onFinalize
          loses the onFinalize, `dragging` sticks true forever, and from then on
          nothing — button, scrim, back, route change — can settle the drawer again.
          That is the drawer that opens and will not close. */}
      {gateOk && (
        <GestureDetector gesture={openPan}>
          <View
            style={[styles.edge, { width: EDGE_WIDTH, [SIDE]: 0 }]}
            pointerEvents={open || visuallyOpen ? "none" : "auto"}
          />
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  track: { flex: 1 },
  app: { position: "absolute", top: 0, bottom: 0, zIndex: 0 },
  scrim: { position: "absolute", top: 0, bottom: 0, backgroundColor: "#000", zIndex: 1 },
  drawer: { position: "absolute", top: 0, bottom: 0, zIndex: 2 },
  // `elevation` as well as `zIndex`: on Android touch dispatch follows elevation,
  // so a zIndex-only strip paints above the screen but still loses the touch to
  // whatever the screen put underneath it.
  edge: { position: "absolute", top: 0, bottom: 0, zIndex: 10, elevation: 10 },
});
