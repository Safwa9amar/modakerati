import React, { useEffect, useMemo, useState } from "react";
import { Dimensions, Keyboard, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { hSelection } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import type { DocBlockDTO } from "@/lib/api";
import { BlockContextBar } from "./BlockContextBar";
import { DismissTarget, DISMISS_HIT_RADIUS } from "./DismissTarget";

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;

interface Props {
  thesisId: string;
  blocks: DocBlockDTO[];
  rtl: boolean;
}

const PILL_W = 320; // approximate — used only for the initial center + clamp math
const PILL_H = 56;

/**
 * The persistent, draggable, screen-level floating pill. Mounted ONCE by
 * thesis-workspace. Appears on the first block selection, stays open across block
 * changes (retargeting its tools to the current selection), and closes only when
 * dragged onto the bottom-center X (which also clears the selection). Suppressed —
 * but not hidden from the store — while the keyboard is up (the docked bar takes
 * over), while the block Ask-AI input is open, while the AI ask/confirm gate owns
 * the bottom, and while the sole selected paragraph has an active inline suggestion.
 */
export function FloatingPill({ thesisId, blocks, rtl }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get("window");

  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const askAiOpen = useWorkspaceStore((s) => s.askAiOpen);
  const aiGateActive = useChatStore((s) => s.pendingAsk != null || s.pendingConfirm != null);

  const visible = useFloatingPillStore((s) => s.visible);
  const pos = useFloatingPillStore((s) => s.pos);

  // Local keyboard tracking — hide the floating form while the docked bar is up.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardVisible(false));
    const showA = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideA = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); showA.remove(); hideA.remove(); };
  }, []);

  // ── Selection derivations (mirror BlockToolbarPill) ──
  const ordered = useMemo(
    () => [...selectedBlocks].sort((a, b) => a.index - b.index),
    [selectedBlocks],
  );
  const indices = useMemo(() => ordered.map((b) => b.index), [ordered]);
  const count = selectedBlocks.length;
  const paragraphSelection = useMemo(() => {
    if (!ordered.length) return [] as ParagraphBlock[];
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    return ordered
      .map((s) => byIndex.get(s.index))
      .filter((b): b is ParagraphBlock => !!b && b.kind === "paragraph");
  }, [ordered, blocks]);
  const selectedBlock = useMemo<DocBlockDTO | null>(() => {
    if (count !== 1) return null;
    return blocks.find((b) => b.index === ordered[0]?.index) ?? null;
  }, [count, ordered, blocks]);
  const scopeLabel =
    count === 1
      ? (selectedBlocks[0]?.text?.replace(/\s+/g, " ").trim().slice(0, 32) ||
        t("workspace.selectedBlock", { defaultValue: "Selected section" }))
      : t("workspace.nSelected", { count, defaultValue: `${count} selected` });

  // Suggestion suppression: sole selected paragraph currently in review.
  const soleSuggested = useSuggestionStore((s) => {
    if (count !== 1) return false;
    const b = selectedBlock;
    return !!b && b.kind === "paragraph" && s.byIndex[b.index]?.original === b.text;
  });

  // Spawn on the first non-empty selection; never auto-hide (only drag-to-X does).
  useEffect(() => {
    if (count > 0 && !visible) useFloatingPillStore.getState().show();
  }, [count, visible]);

  // ── Drag position ──
  const defaultX = (width - PILL_W) / 2;
  const defaultY = height - insets.bottom - PILL_H - 120;
  const startX = pos?.x ?? defaultX;
  const startY = pos?.y ?? defaultY;

  const tx = useSharedValue(startX);
  const ty = useSharedValue(startY);
  // Re-seed when the store position changes from outside (e.g. reset → default).
  useEffect(() => {
    tx.value = pos?.x ?? defaultX;
    ty.value = pos?.y ?? defaultY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, width, height, insets.bottom]);

  const dragActive = useSharedValue(0); // DismissTarget fade
  const overTarget = useSharedValue(0); // DismissTarget grow
  const startTX = useSharedValue(0);
  const startTY = useSharedValue(0);

  const targetCX = width / 2;
  const targetCY = height - insets.bottom - 24 - 32; // matches DismissTarget bottom+radius

  const minX = 8;
  const maxX = width - PILL_W - 8;
  const minY = insets.top + 8;
  const maxY = height - insets.bottom - PILL_H - 8;

  const dismiss = () => {
    useFloatingPillStore.getState().hide();
    useWorkspaceStore.getState().clearSelection();
  };

  const pan = Gesture.Pan()
    .minDistance(10) // let quick taps reach the chips
    .onStart(() => {
      startTX.value = tx.value;
      startTY.value = ty.value;
      dragActive.value = withTiming(1, { duration: 140 });
    })
    .onUpdate((e) => {
      tx.value = startTX.value + e.translationX;
      ty.value = startTY.value + e.translationY;
      // Hit test: pill center vs target center.
      const cx = tx.value + PILL_W / 2;
      const cy = ty.value + PILL_H / 2;
      const dist = Math.hypot(cx - targetCX, cy - targetCY);
      const over = dist < DISMISS_HIT_RADIUS ? 1 : 0;
      if (over !== overTarget.value) {
        overTarget.value = withTiming(over, { duration: 120 });
        if (over) runOnJS(hSelection)();
      }
    })
    .onEnd(() => {
      dragActive.value = withTiming(0, { duration: 140 });
      if (overTarget.value > 0.5) {
        overTarget.value = 0;
        runOnJS(dismiss)();
        return;
      }
      overTarget.value = 0;
      // Clamp into bounds and persist.
      const clampedX = Math.min(Math.max(tx.value, minX), maxX);
      const clampedY = Math.min(Math.max(ty.value, minY), maxY);
      tx.value = withSpring(clampedX, SPRING);
      ty.value = withSpring(clampedY, SPRING);
      runOnJS(useFloatingPillStore.getState().setPos)({ x: clampedX, y: clampedY });
    });

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  const suppressed = keyboardVisible || askAiOpen || aiGateActive || soleSuggested;
  if (!visible || suppressed) {
    // Still render the target host? No — nothing to show when suppressed.
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <DismissTarget visible={dragActive} active={overTarget} centerY={targetCY} bottomInset={insets.bottom} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.pill, pillStyle]}>
          <BlockContextBar
            thesisId={thesisId}
            rtl={rtl}
            paragraphSelection={paragraphSelection}
            selectedBlock={selectedBlock}
            selectedIndices={indices}
            count={count}
            blockCount={blocks.length}
            keyboardOpen={false}
            scopeLabel={scopeLabel}
            onAskAI={() => useWorkspaceStore.getState().setAskAiOpen(true)}
            bottomInset={0}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { position: "absolute", top: 0, left: 0, width: PILL_W },
});
