import React, { useEffect, useMemo, useState } from "react";
import { Dimensions, Keyboard, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { hSelection } from "@/lib/haptics";
import { layoutSpring, SPRING } from "@/lib/motion";
import type { DocBlockDTO } from "@/lib/api";
import { resolveBubbleKind, BUBBLE_ICONS, type BubbleKind } from "@/lib/bubble-configs";
import { AIDock } from "./AIDock";
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
const BUBBLE_SIZE = 52;
// Dock panel height + margin — how far above the keyboard the inline Ask input
// needs to clear so it isn't occluded once it opens.
const DOCK_CLEARANCE = 240;

/**
 * The persistent, draggable, screen-level floating ✦ AI bubble. Mounted ONCE by
 * thesis-workspace and shown on entry — it is ALWAYS ON, not spawned by selection:
 * it lives from workspace entry until dragged onto the bottom-center X (which also
 * clears the selection), and stays dismissed until the workspace is re-entered.
 * Two modes, both reachable from the same bubble:
 *   • count === 0 (nothing selected) → the bubble shows ✦ Sparkles; expanding opens
 *     the AI dock (quick actions, suggested chips, on-demand Ask input).
 *   • count > 0 (block(s) selected) → the bubble shows the block's kind icon;
 *     expanding opens the BlockContextBar formatting toolbar, whose own ✦ Ask AI
 *     swaps it for the same AI dock (block-scoped) via the store's `inputOpen`.
 * Suppressed — but not hidden from the store — while the keyboard is up (the docked
 * bar takes over), while the block Ask-AI input is open, while the AI ask/confirm
 * gate owns the bottom, and while the sole selected paragraph has an active inline
 * suggestion.
 */
export function FloatingPill({ thesisId, blocks, rtl }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get("window");

  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const askAiOpen = useWorkspaceStore((s) => s.askAiOpen);
  // Composer visibility + preview mode — the floating pill must yield the bottom
  // surface to the whole-memoir composer (count===0), hide when the composer is
  // toggled off (else its Ask-AI opens a null BlockComposer → dead end), and never
  // spawn over a docx/pdf preview. Primitive selectors (no Object.is loop).
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);
  const previewMode = useWorkspaceStore((s) => s.previewMode);
  const aiGateActive = useChatStore((s) => s.pendingAsk != null || s.pendingConfirm != null);

  const visible = useFloatingPillStore((s) => s.visible);
  const pos = useFloatingPillStore((s) => s.pos);
  const expanded = useFloatingPillStore((s) => s.expanded);
  const anchorY = useFloatingPillStore((s) => s.anchorY);
  const inputOpen = useFloatingPillStore((s) => s.inputOpen);
  const colors = useThemeColors();
  // Busy spinner: the bubble spins while an AI turn is generating, in either mode.
  const busy = useChatStore((s) => s.isGenerating);

  // Keyboard HEIGHT tracking — positioning ONLY (the bubble is NOT suppressed by
  // the keyboard). Used to float the drag-to-X target + clamp above the keyboard
  // and its docked formatting bar so the bubble stays closable while typing.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const onShow = (e: { endCoordinates?: { height: number } }) =>
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardHeight(0);
    const subs = [
      Keyboard.addListener("keyboardDidShow", onShow),
      Keyboard.addListener("keyboardDidHide", onHide),
      Keyboard.addListener("keyboardWillShow", onShow),
      Keyboard.addListener("keyboardWillHide", onHide),
    ];
    return () => subs.forEach((s) => s.remove());
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
  // Which bubble/toolset family drives the collapsed bubble icon AND (via
  // BlockContextBar's own resolveBubbleKind call) the expanded toolset — one
  // registry, so they can never disagree.
  const bubbleKind: BubbleKind = count === 0 ? "ai" : resolveBubbleKind(selectedBlock);
  const scopeLabel =
    count === 0
      ? t("workspace.wholeMemoir", { defaultValue: "Whole memoir" })
      : count === 1
        ? (selectedBlocks[0]?.text?.replace(/\s+/g, " ").trim().slice(0, 32) ||
          t("workspace.selectedBlock", { defaultValue: "Selected section" }))
        : t("workspace.nSelected", { count, defaultValue: `${count} selected` });

  // Container width depends on form; drives centering, clamp, and the drag hit-test.
  const curW = expanded ? PILL_W : BUBBLE_SIZE;

  // Suggestion suppression: sole selected paragraph currently in review.
  const soleSuggested = useSuggestionStore((s) => {
    if (count !== 1) return false;
    const b = selectedBlock;
    return !!b && b.kind === "paragraph" && s.byIndex[b.index]?.original === b.text;
  });

  // Always-on: the bubble lives from workspace entry until drag-to-X. `visible`
  // is the persist flag (only hide() clears it); a dismissed bubble stays hidden
  // until the user re-enters the workspace (reset() → mount → show()).
  useEffect(() => {
    useFloatingPillStore.getState().show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A dismissed bubble revives when the user selects a block again — dismissal
  // holds only while nothing new is selected (otherwise block formatting would
  // be unreachable with the keyboard down).
  useEffect(() => {
    if (count > 0 && !visible) useFloatingPillStore.getState().show();
  }, [count, visible]);

  // A selection CHANGE closes the inline Ask input. The input is per-target: a
  // stale `inputOpen` from an unsent ask would otherwise make the next block's
  // expanded bubble render the AI dock instead of that block's own tool pill
  // (user feedback: block selection must always get its text/image/table tools).
  useEffect(() => {
    if (useFloatingPillStore.getState().inputOpen) {
      useFloatingPillStore.getState().setInputOpen(false);
    }
  }, [selectedBlocks]);

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

  // When the keyboard is up, float the dismiss X + keep the pill above BOTH the
  // keyboard and the docked formatting bar (~56px) that sits above it.
  const dismissBottom = keyboardHeight > 0 ? keyboardHeight + 56 : insets.bottom;

  const targetCX = width / 2;
  const targetCY = height - dismissBottom - 24 - 32; // matches DismissTarget bottom+radius

  const minX = 8;
  // Guard the max bounds so a device narrower/shorter than the pill can't yield a
  // max < min (which would clamp the pill off-screen).
  const maxX = Math.max(minX, width - curW - 8);
  // Keep the pill clear of the header chrome at the top.
  const minY = insets.top + 100;
  const maxY = Math.max(minY, height - dismissBottom - PILL_H - 8);

  // Keep the bubble/pill visible above a rising keyboard — it anchors at the tap Y,
  // which is often exactly where the keyboard lands. Clearance depends on the form:
  // the expanded dock needs room for its rows; the collapsed bubble just its height.
  // Runs on every keyboardHeight change (not just when the dock's Ask input is
  // open) — the anchor effect below places the bubble at the raw tap Y BEFORE the
  // keyboard has risen (keyboardWillShow/DidShow land ~150-300ms after the tapped
  // block's TextInput autoFocus), so without this the bubble spawns at a Y the
  // keyboard is about to cover and vanishes behind it the instant it rises.
  useEffect(() => {
    if (keyboardHeight <= 0) return;
    const clearance = inputOpen ? DOCK_CLEARANCE : expanded ? DOCK_CLEARANCE : PILL_H + 24;
    const limit = height - keyboardHeight - clearance;
    if (ty.value > limit) ty.value = withSpring(Math.max(minY, limit), SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardHeight, inputOpen, expanded]);

  // Guards re-anchoring against unrelated re-renders. Declared here (above dismiss)
  // so dismiss can clear it — see the anchor effect below.
  const lastAnchoredIndex = React.useRef<number | null>(null);

  // Re-clamp X when the form grows/shrinks (bubble⇄pill) so the wider pill can't
  // hang off-screen from a near-edge anchor.
  useEffect(() => {
    const clamped = Math.min(Math.max(tx.value, minX), maxX);
    if (clamped !== tx.value) tx.value = withSpring(clamped, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curW]);

  const dismiss = () => {
    useFloatingPillStore.getState().hide();
    useWorkspaceStore.getState().clearSelection();
    // Reset so re-selecting the SAME block re-anchors beside it (not over the X).
    lastAnchoredIndex.current = null;
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
          const cx = tx.value + curW / 2;
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
    [width, height, insets.top, insets.bottom, curW, keyboardHeight],
  );

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  // Spawn/re-anchor beside the selected block: when the selected INDEX changes and
  // we have a tap Y, place the pill at a screen-side position at that height. The
  // FIRST anchor (and the first after a dismiss, where the ref was cleared) is a
  // DIRECT set — no diagonal slide from the center-bottom default. Subsequent
  // re-anchors spring across. Drag overrides until the next selection change;
  // scrolling does not re-anchor.
  const soleIndex = selectedBlock ? selectedBlock.index : count === 1 ? indices[0] ?? null : null;
  useEffect(() => {
    if (soleIndex == null) return;
    if (soleIndex === lastAnchoredIndex.current) return;
    const isFirst = lastAnchoredIndex.current == null;
    lastAnchoredIndex.current = soleIndex;
    if (anchorY == null) return;
    const w = expanded ? PILL_W : BUBBLE_SIZE;
    const sideX = rtl ? minX : Math.max(minX, width - w - 12);
    const yy = Math.min(Math.max(anchorY - BUBBLE_SIZE / 2, minY), maxY);
    if (isFirst) { tx.value = sideX; ty.value = yy; }
    else { tx.value = withSpring(sideX, SPRING); ty.value = withSpring(yy, SPRING); }
    useFloatingPillStore.getState().setPos({ x: sideX, y: yy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleIndex, anchorY]);

  // Always-on: no `count === 0` term here — that's now a valid MODE (the AI dock),
  // not a hide condition. askAiOpen is kept: BlockComposer's keyboard-docked
  // BlockContextBar (Task 4, untouched here) can still set it, and the bubble must
  // yield the bottom surface to that legacy bar while it's up.
  const suppressed =
    askAiOpen || aiGateActive || soleSuggested || !composerOpen || previewMode != null;
  if (!visible || suppressed) {
    // Still render the target host? No — nothing to show when suppressed.
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <DismissTarget visible={dragActive} active={overTarget} centerY={targetCY} bottomInset={dismissBottom} />
      <GestureDetector gesture={pan}>
        <Animated.View layout={layoutSpring} style={[styles.host, { width: curW }, pillStyle]}>
          {expanded ? (
            count === 0 || inputOpen ? (
              <View style={[styles.dockPanel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
                {/* AIDock lays out by APP language (useRTL inside), not thesis rtl. */}
                <AIDock thesisId={thesisId} scopeLabel={scopeLabel} scopeIndices={indices} />
              </View>
            ) : (
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
                // Routes to the dock's inline input, block-scoped; the legacy bottom
                // Ask-AI input is retired while the bubble is alive (Task 4).
                onAskAI={() => useFloatingPillStore.getState().setInputOpen(true)}
                onCollapse={() => useFloatingPillStore.getState().setExpanded(false)}
                bottomInset={0}
              />
            )
          ) : (
            <Bubble
              colors={colors}
              kind={bubbleKind}
              busy={busy}
              label={
                count === 0
                  ? t("blockBar.askAi", { defaultValue: "Ask AI" })
                  : t("blockBar.formattingTools", { defaultValue: "Formatting tools" })
              }
              onPress={() => useFloatingPillStore.getState().setExpanded(true)}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Collapsed form: a small circular bubble with an icon matching the current mode
 *  — ✦ Sparkles when nothing is selected (AI mode), else the selected block's kind.
 *  Spins continuously while `busy` (an AI turn is generating). Tapping it expands
 *  to the AI dock (AI mode) or the full BlockContextBar pill (block mode). */
function Bubble({
  colors,
  kind,
  label,
  busy,
  onPress,
}: {
  colors: ReturnType<typeof useThemeColors>;
  kind: BubbleKind;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  const Icon = BUBBLE_ICONS[kind];

  const spin = useSharedValue(0);
  useEffect(() => {
    if (busy) {
      spin.value = 0;
      spin.value = withRepeat(withTiming(360, { duration: 1200, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(spin);
      spin.value = withTiming(0, { duration: 200 });
    }
  }, [busy, spin]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: spin.value + "deg" }] }));

  return (
    <Animated.View
      entering={ZoomIn.springify().damping(30).stiffness(700)}
      exiting={ZoomOut.springify().damping(30).stiffness(700)}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.bubble, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
      >
        <Animated.View style={spinStyle}>
          <Icon size={22} color={colors.bgPrimary} strokeWidth={2.2} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", top: 0, left: 0 },
  // AI-dock wrapper — mirrors BlockContextBar's fullCard surface language (dark
  // panel, hairline border, pill-matching shadow) since AIDock only owns its rows.
  dockPanel: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
});
