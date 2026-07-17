import { useCallback, useEffect } from "react";
import { AccessibilityInfo } from "react-native";
import { DeviceMotion } from "expo-sensors";
import { Gesture } from "react-native-gesture-handler";
import { useFocusEffect } from "expo-router";
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";

const TILT_LIMIT = 8; // deg — gyro resting lean
const DRAG_LIMIT = 10; // deg — finger drag
const BASE_LEAN = -18; // deg — the book's default rotateY
const ENTRANCE = { damping: 14, stiffness: 120 };

function clamp(v: number, lim: number): number {
  return Math.max(-lim, Math.min(lim, v));
}

/**
 * Owns all book motion: a springy entrance, drag-to-tilt, and gyroscope
 * parallax. Returns an animated transform style and the Pan gesture to attach.
 * Honors Reduce Motion (renders a static tilt) and only listens to the gyro
 * while the screen is focused.
 */
export function useCoverParallax() {
  const gyroX = useSharedValue(0);
  const gyroY = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const enter = useSharedValue(0); // 0 → 1 on mount
  const reduceMotion = useSharedValue(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((rm) => {
      if (!mounted) return;
      reduceMotion.value = rm;
      enter.value = rm ? 1 : withSpring(1, ENTRANCE);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let sub: { remove: () => void } | null = null;
      (async () => {
        if (reduceMotion.value) return;
        const ok = await DeviceMotion.isAvailableAsync().catch(() => false);
        if (!ok || !active) return;
        DeviceMotion.setUpdateInterval(50);
        sub = DeviceMotion.addListener((data) => {
          const r = data.rotation;
          if (!r) return;
          // rotation is in radians: beta = front/back, gamma = left/right.
          gyroX.value = withSpring(clamp(-(r.beta ?? 0) * 20, TILT_LIMIT), {
            damping: 20,
            stiffness: 90,
          });
          gyroY.value = withSpring(clamp((r.gamma ?? 0) * 20, TILT_LIMIT), {
            damping: 20,
            stiffness: 90,
          });
        });
      })();
      return () => {
        active = false;
        sub?.remove();
        gyroX.value = withSpring(0);
        gyroY.value = withSpring(0);
      };
    }, [])
  );

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      "worklet";
      if (reduceMotion.value) return;
      dragY.value = Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, e.translationX / 12));
      dragX.value = Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, -e.translationY / 12));
    })
    .onEnd(() => {
      "worklet";
      dragX.value = withSpring(0);
      dragY.value = withSpring(0);
    });

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(enter.value, [0, 1], [0.9, 1], Extrapolation.CLAMP);
    const settle = interpolate(enter.value, [0, 1], [10, 0], Extrapolation.CLAMP);
    return {
      opacity: enter.value,
      transform: [
        { perspective: 1000 },
        { rotateX: `${gyroX.value + dragX.value + settle}deg` },
        { rotateY: `${gyroY.value + dragY.value + BASE_LEAN}deg` },
        { scale },
      ],
    };
  });

  return { animatedStyle, panGesture };
}
