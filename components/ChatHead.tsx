import { useCallback, useEffect } from "react";
import { Alert, BackHandler, Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSegments } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/stores/auth-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { useChatHead } from "@/stores/chat-head-store";
import ModakeratiBubble from "@/modules/modakerati-bubble";
import { ThesisChat } from "@/app/(tabs)/chat";

const LOGO = require("../assets/icon.png");

const SIZE = 58; // bubble diameter
const MARGIN = 12; // horizontal inset the bubble snaps to
const TOP_RESERVE = 64; // keep the bubble clear of the status bar / notch
const BOTTOM_RESERVE = 120; // keep it above the floating tab bar
const SPRING = { damping: 18, stiffness: 180, mass: 0.6 } as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Messenger-style "chat head": a draggable bubble that floats over the whole app
 * and expands into the thesis chat (the same UI as the Chat tab, reused via
 * ThesisChat variant="overlay"). Mounted once at the root layout so its position
 * and the open/closed state survive navigation between screens.
 *
 * It only shows while signed in, outside the auth flow, and with an active
 * thesis to chat about; the collapsed bubble is also hidden on the Chat tab
 * itself, where it would be redundant.
 */
export function ChatHead() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const segments = useSegments();

  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const thesisId = useThesisStore((s) => s.currentThesisId);
  const thesisTitle = useThesisStore((s) =>
    s.currentThesisId ? (s.theses.find((x) => x.id === s.currentThesisId)?.title ?? "") : ""
  );
  const isGenerating = useChatStore((s) => s.isGenerating);

  const expanded = useChatHead((s) => s.expanded);
  const open = useChatHead((s) => s.open);
  const close = useChatHead((s) => s.close);

  // Free-floating position (top-left origin); persists because this component is
  // mounted once at the root and never unmounts across navigation.
  const tx = useSharedValue(width - SIZE - MARGIN);
  const ty = useSharedValue(height * 0.6);
  const start = useSharedValue({ x: 0, y: 0 });

  // While expanded, Android's back button collapses the panel instead of navigating.
  useEffect(() => {
    if (!expanded) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [expanded, close]);

  const inAuth = segments[0] === "(auth)";
  const onChatTab = segments[segments.length - 1] === "chat";
  const mounted = isAuthed && !inAuth && !!thesisId;

  // --- System-wide bubble (Android: float over OTHER apps) --------------------
  // The native module shows a draggable bubble over other apps while the app is
  // backgrounded, then deep-links back to the chat on tap. iOS can't do this, so
  // there it stays a no-op and only the in-app bubble above is used.
  const systemSupported = Platform.OS === "android" && ModakeratiBubble.isSupported();

  // Enable the over-other-apps bubble whenever we're signed in with an active
  // thesis. We do NOT gate on `overlayPerm` here: the native side re-checks the
  // permission itself every time the app backgrounds, so granting it takes effect
  // immediately on the next minimize — no foreground/background refresh needed.
  useEffect(() => {
    if (!systemSupported) return;
    ModakeratiBubble.setEnabled(mounted);
  }, [systemSupported, mounted]);

  // Tapping the over-other-apps bubble brings the app forward and fires this
  // event → open the in-app chat panel so the user lands straight in the chat.
  useEffect(() => {
    if (!systemSupported) return;
    const sub = ModakeratiBubble.addListener("onBubblePress", () => {
      useChatHead.getState().open();
    });
    return () => sub.remove();
  }, [systemSupported]);

  // Long-press the in-app bubble to turn the over-other-apps bubble on (opens the
  // system permission screen the first time).
  const requestSystemBubble = useCallback(() => {
    if (!systemSupported) return;
    if (ModakeratiBubble.hasOverlayPermission()) {
      Alert.alert(
        t("chatHead.enabledTitle", { defaultValue: "Chat bubble is on" }),
        t("chatHead.enabledBody", { defaultValue: "The bubble will float over other apps when you leave Modakerati." }),
      );
      return;
    }
    Alert.alert(
      t("chatHead.permTitle", { defaultValue: "Float over other apps" }),
      t("chatHead.permBody", { defaultValue: "Allow Modakerati to display over other apps so the chat bubble follows you like Messenger." }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        { text: t("common.continue", { defaultValue: "Continue" }), onPress: () => { void ModakeratiBubble.requestOverlayPermission(); } },
      ],
    );
  }, [systemSupported, t]);

  // Drag the bubble; on release snap it to the nearest side and clamp vertically.
  const pan = Gesture.Pan()
    .onStart(() => {
      start.value = { x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      tx.value = start.value.x + e.translationX;
      ty.value = start.value.y + e.translationY;
    })
    .onEnd(() => {
      const snapX = tx.value + SIZE / 2 < width / 2 ? MARGIN : width - SIZE - MARGIN;
      const clampedY = Math.min(Math.max(ty.value, TOP_RESERVE), height - SIZE - BOTTOM_RESERVE);
      tx.value = withSpring(snapX, SPRING);
      ty.value = withSpring(clampedY, SPRING);
    });

  // A clean tap (no drag) opens the chat panel.
  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_e, success) => {
      if (success) runOnJS(open)();
    });

  // Long-press toggles the system-wide (over-other-apps) bubble on Android.
  const longPress = Gesture.LongPress()
    .minDuration(450)
    .onStart(() => {
      runOnJS(requestSystemBubble)();
    });

  const gesture = Gesture.Exclusive(pan, longPress, tap);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Collapsed: the draggable bubble (hidden on the Chat tab and while open). */}
      {!expanded && !onChatTab && (
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.bubble, { backgroundColor: colors.brandPrimary }, bubbleStyle]}>
            <Image source={LOGO} style={styles.bubbleLogo} />
            {isGenerating && (
              <Animated.View
                entering={FadeIn}
                exiting={FadeOut}
                style={[styles.activeDot, { backgroundColor: colors.brandAccent, borderColor: colors.brandPrimary }]}
              />
            )}
          </Animated.View>
        </GestureDetector>
      )}

      {/* Expanded: dim backdrop + near-fullscreen chat panel, zooming open. */}
      {expanded && (
        <View style={StyleSheet.absoluteFill}>
          <AnimatedPressable
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(160)}
            onPress={close}
            style={styles.backdrop}
            accessibilityRole="button"
            accessibilityLabel={t("common.close", { defaultValue: "Close" })}
          />
          <Animated.View
            entering={ZoomIn.duration(220)}
            exiting={ZoomOut.duration(180)}
            style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderDefault }]}
          >
            <ThesisChat thesisId={thesisId} thesisTitle={thesisTitle} variant="overlay" onClose={close} />
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  bubbleLogo: { width: SIZE - 18, height: SIZE - 18, borderRadius: (SIZE - 18) / 2 },
  activeDot: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  panel: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
