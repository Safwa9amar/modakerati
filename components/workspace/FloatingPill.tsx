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
  // INTENTIONAL: the pill persists even when the selection is cleared (count === 0)
  // — the product wants it to stay "like a manager" until dragged onto the X. The
  // format tools inside already disable themselves when nothing is selected.
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
  // Re-seed ONLY on a reset-to-default (pos → null). Re-seeding to the value we
  // JUST wrote on a drag drop would overwrite (and cut short) the spring-back.
  useEffect(() => {
    if (pos == null) {
      tx.value = (width - PILL_W) / 2;
      ty.value = height - insets.bottom - PILL_H - 120;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, width, height, insets.bottom]);

  const dragActive = useSharedValue(0); // DismissTarget fade
  const overTarget = useSharedValue(0); // DismissTarget grow
  const startTX = useSharedValue(0);
  const startTY = useSharedValue(0);

  const targetCX = width / 2;
  const targetCY = height - insets.bottom - 24 - 32; // matches DismissTarget bottom+radius

  const minX = 8;
  // Guard the max bounds so a device narrower/shorter than the pill can't yield a
  // max < min (which would clamp the pill off-screen).
  const maxX = Math.max(minX, width - PILL_W - 8);
  // Keep the pill clear of the header chrome at the top.
  const minY = insets.top + 100;
  const maxY = Math.max(minY, height - insets.bottom - PILL_H - 8);

  const dismiss = () => {
    useFloatingPillStore.getState().hide();
    useWorkspaceStore.getState().clearSelection();
  };
  // JS-thread wrapper: reanimated must persist via runOnJS(persistPos) — NOT
  // runOnJS(useFloatingPillStore.getState().setPos), which would evaluate
  // getState() on the UI thread and crash on release.
  const persistPos = (p: { x: number; y: number }) =>
    useFloatingPillStore.getState().setPos(p);

  // Memoized so a re-render never swaps the gesture mid-drag (which would drop the
  // drag and strand the X target on screen). Rebuilds only when the bounds inputs
  // change — the render-scope consts above (targetCX/CY, min/max X/Y) are closed
  // over, and they recompute on exactly these deps. Vertical-biased arbitration:
  // horizontal drags yield to the inner chip ScrollView (failOffsetX); only a
  // vertical drag activates the pill move (activeOffsetY) — and the X sits at
  // bottom-center, so you drag DOWN to it. A zero-offset tap never activates.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-12, 12])
        .failOffsetX([-16, 16])
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
          runOnJS(persistPos)({ x: clampedX, y: clampedY });
        })
        .onFinalize(() => {
          // Always settle the target chrome, even on a cancelled/interrupted drag
          // that never reaches onEnd — otherwise the X target stays visible.
          dragActive.value = withTiming(0, { duration: 140 });
          overTarget.value = 0;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, insets.top, insets.bottom],
  );

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
