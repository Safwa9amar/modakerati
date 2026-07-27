import React, { useEffect, useMemo, useState } from "react";
import { Dimensions, I18nManager, Keyboard, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
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
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatHead } from "@/stores/chat-head-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { hSelection } from "@/lib/haptics";
import { layoutSpring, SPRING } from "@/lib/motion";
import { estimateTokenCount } from "@/lib/thinking";
import type { DocBlockDTO } from "@/lib/api";
import { Plus, type LucideIcon } from "lucide-react-native";
import { resolveBubbleKind, chromeBubbleKind, BUBBLE_ICONS, type BubbleKind } from "@/lib/bubble-configs";
import { AIDock } from "./AIDock";
import { BlockContextBar } from "./BlockContextBar";
import { DismissTarget, DISMISS_HIT_RADIUS } from "./DismissTarget";
import { PeekCard, type PeekPhase } from "./PeekCard";
import { ChatOverlayPanel } from "@/components/ChatOverlayPanel";

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;

interface Props {
  thesisId: string;
  blocks: DocBlockDTO[];
  rtl: boolean;
}

const PILL_H = 56;
const BUBBLE_SIZE = 52;
// Vertical clearance kept between the bubble's bottom edge and the caret line it
// anchors to, so the bubble floats just ABOVE the text instead of covering it.
const BUBBLE_ABOVE_GAP = 10;
// Extra tap/drag margin around the collapsed bubble — touches this far outside
// the visible circle still grab it (small circles are hard targets).
const BUBBLE_SLOP = 18;
// Dock panel height + margin — how far above the keyboard the inline Ask input
// needs to clear so it isn't occluded once it opens.
const DOCK_CLEARANCE = 240;
// How long the finished-reply peek card stays up before auto-hiding to a dot.
const PEEK_CARD_TIMEOUT_MS = 6000;

/**
 * The persistent, draggable, screen-level floating ✦ AI bubble. Mounted ONCE by
 * thesis-workspace and shown on entry — it is ALWAYS ON, not spawned by selection:
 * it lives from workspace entry until dragged onto the bottom-center X. Dismissal
 * is mode-aware: dragging a BLOCK bubble onto the X only closes the block context
 * (selection clears, the bubble reverts to the default global ✦ AI bubble at its
 * home spot); dragging the global ✦ bubble onto the X hides the overlay until the
 * workspace is re-entered.
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

  // Physical-LEFT anchor for the drag host that survives RN's global RTL
  // left↔right style swap. All the position math below is in physical left→right
  // screen coords (tx = offset from the left edge). When the app language is
  // Arabic (I18nManager.forceRTL), RN swaps a plain `left:0` to the right edge —
  // regardless of the host's own `direction:"ltr"` — which pins the pill to the
  // right half and makes it undraggable leftward. Writing `right:0` in that case
  // lets the SAME swap turn it back into a physical `left:0`. In LTR, `left:0` as
  // usual. Pairs with `direction:"ltr"` on styles.host (un-mirrors translateX).
  const hostAnchor = I18nManager.isRTL ? ({ right: 0 } as const) : ({ left: 0 } as const);

  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  // A selected Word chrome band (top/bottom/section) — when set it takes over the
  // bubble (its own ChromeContextBar) and the normal block selection is empty.
  const chromeSelection = useWorkspaceStore((s) => s.chromeSelection);
  const askAiOpen = useWorkspaceStore((s) => s.askAiOpen);
  // Composer visibility + preview mode — the floating pill must yield the bottom
  // surface to the whole-memoir composer (count===0), hide when the composer is
  // toggled off (else its Ask-AI opens a null BlockComposer → dead end), and never
  // spawn over a docx/pdf preview. Primitive selectors (no Object.is loop).
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);
  const previewMode = useWorkspaceStore((s) => s.previewMode);
  const aiGateActive = useChatStore((s) => s.pendingAsk != null || s.pendingConfirm != null);

  const visible = useFloatingPillStore((s) => s.visible);
  // Hide the ✦ bubble entirely while the Insert menu is open — it must not float
  // over the menu (it shares the same overlay space).
  const insertMenuOpen = useInsertMenuStore((s) => s.open);
  const pos = useFloatingPillStore((s) => s.pos);
  const expanded = useFloatingPillStore((s) => s.expanded);
  const anchorY = useFloatingPillStore((s) => s.anchorY);
  const inputOpen = useFloatingPillStore((s) => s.inputOpen);
  const colors = useThemeColors();
  // Busy spinner: the bubble spins while an AI turn is generating, in either mode.
  const busy = useChatStore((s) => s.isGenerating);
  // Peek-card state: whether a plain chat ask is awaiting the user's read, plus
  // the raw chat-store fields the card's content derives from (no copy kept).
  const awaitingReply = useFloatingPillStore((s) => s.awaitingReply);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const streamingId = useChatStore((s) => s.streamingId);
  const threadMessages = useChatStore((s) => s.messages[thesisId]);
  const thesisTitle = useThesisStore((s) => s.theses.find((th) => th.id === thesisId)?.title ?? "");

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
  // Combined text of the selected blocks (doc order) — grounds a multi-block AI ask.
  // Capped so a big multi-select doesn't push a huge body across the bridge/network
  // (the server truncates further); empty for the whole-memoir scope.
  const scopeText = useMemo(
    () => ordered.map((b) => b.text).filter(Boolean).join("\n\n").slice(0, 6000),
    [ordered],
  );
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
  const bubbleKind: BubbleKind = chromeSelection
    ? chromeBubbleKind(chromeSelection.kind)
    : count === 0
      ? "ai"
      : resolveBubbleKind(selectedBlock);
  const scopeLabel =
    count === 0
      ? t("workspace.wholeMemoir", { defaultValue: "Whole memoir" })
      : count === 1
        ? (selectedBlocks[0]?.text?.replace(/\s+/g, " ").trim().slice(0, 32) ||
          t("workspace.selectedBlock", { defaultValue: "Selected section" }))
        : t("workspace.nSelected", { count, defaultValue: `${count} selected` });

  // Section-scoped AI label for a chrome band — feeds AIDock's existing scope props
  // so "✦ Ask" edits this section's header/footer via the AI tool loop (v1 write path).
  const chromeScopeLabel = chromeSelection
    ? chromeSelection.kind === "top"
      ? t("workspace.hf.topOfPage", { defaultValue: "Top of every page" })
      : chromeSelection.kind === "bottom"
        ? t("workspace.hf.bottomOfPage", { defaultValue: "Bottom of every page" })
        : t("workspace.hf.newSectionHere", { defaultValue: "New section" })
    : "";

  // Suggestion suppression: sole selected paragraph currently in review.
  const soleSuggested = useSuggestionStore((s) => {
    if (count !== 1) return false;
    const b = selectedBlock;
    return !!b && b.kind === "paragraph" && s.byIndex[b.index]?.original === b.text;
  });
  // A range rewrite (multi-block dynamic proposal) owns the bottom while it's under
  // review — hide the bubble/dock so it doesn't overlap the inline card's pill.
  const rangeActive = useSuggestionStore((s) => s.range != null);

  // #3: on a BLANK paragraph the collapsed bubble becomes a "+" that opens the
  // Insert menu (there's nothing to format yet, so the formatting tools aren't the
  // right affordance). It reverts to the normal tool bubble the instant the
  // paragraph gets text. Replaces the discoverability role of the "/" slash trigger.
  const isEmptyPara =
    count === 1 && selectedBlock != null && selectedBlock.kind === "paragraph" && !selectedBlock.text.trim();
  const openInsertMenu = () => {
    if (!selectedBlock) return;
    useInsertMenuStore.getState().openAt({ index: selectedBlock.index, y: anchorY ?? startY });
  };

  const maxPillW = Math.min(420, width - 24);

  // Container width depends on form; drives centering, clamp, and the drag hit-test.
  const curW = expanded ? maxPillW : BUBBLE_SIZE;

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
  const defaultX = (width - maxPillW) / 2;
  const defaultY = height - insets.bottom - PILL_H - 120;
  const startX = pos?.x ?? defaultX;
  const startY = pos?.y ?? defaultY;

  // Peek card content: while generating, the live/streaming message; once the
  // turn ends, the last assistant message — both read straight off the shared
  // chat thread. `!busy` (not `generatingPhase === "idle"`) decides "done" so a
  // brief post-stream gap before the store settles doesn't flash "thinking".
  const peekPhase: PeekPhase = !busy ? "done" : generatingPhase === "writing" ? "writing" : "thinking";
  const peekMessage = !busy
    ? threadMessages?.[threadMessages.length - 1]
    : threadMessages?.find((m) => m.id === streamingId);
  const peekSnippet = peekMessage?.content ?? "";
  // Live token estimate for the collapsed "thinking" chip — an approximation
  // of the streamed reasoning's length (see estimateTokenCount), not the
  // provider's actual billed usage. 0 elsewhere, which PeekCard treats as
  // "no suffix".
  const peekThinkingTokens = peekPhase === "thinking" ? estimateTokenCount(peekMessage?.thinking ?? "") : 0;
  // Anchor the card's tail toward whichever half of the screen the bubble is
  // currently settled in, so it never overhangs an edge. Read from the last
  // PERSISTED position (not the live drag shared value) — a rare cosmetic
  // trade-off: the anchor side won't flip mid-drag, only after the bubble
  // settles, which is fine since a peek is never shown while actively dragging.
  const peekAnchorLeft = startX + BUBBLE_SIZE / 2 < width / 2;

  // The finished-reply card auto-hides after a few seconds so it doesn't sit
  // over the document forever; a small dot then stays on the bubble (mirrors
  // ChatHead's activeDot) so the reply is never fully lost — tapping the
  // bubble still reveals it via `revealReply`. Only the resting "done" state
  // times out; "thinking"/"writing" stay up for as long as the turn runs.
  const [peekCardExpired, setPeekCardExpired] = useState(false);
  // Reset immediately the moment a new ask begins (awaitingReply flips true) —
  // synchronous with the dispatch, NOT dependent on the async generating-phase
  // transition that follows it (which can lag behind a queued-ops flush, per
  // ai-service.ts's flushEdits/flushOps await before setGenerating(true)).
  useEffect(() => {
    if (awaitingReply) setPeekCardExpired(false);
  }, [awaitingReply]);
  // Once the turn actually settles on "done", start the auto-hide countdown.
  useEffect(() => {
    if (!awaitingReply || peekPhase !== "done") return;
    const timer = setTimeout(() => setPeekCardExpired(true), PEEK_CARD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [awaitingReply, peekPhase]);

  // Tapping the peek card — or the bubble itself while a reply is unread —
  // opens the shared chat-overlay panel instead of expanding the AI dock.
  // Marks the reply read.
  const revealReply = () => {
    useChatHead.getState().open();
    useFloatingPillStore.getState().setAwaitingReply(false);
    useFloatingPillStore.getState().setExpanded(false);
  };

  const tx = useSharedValue(startX);
  const ty = useSharedValue(startY);
  // Re-seed ONLY on a reset-to-default (pos → null). Re-seeding to the value we
  // JUST wrote on a drag drop would overwrite (and cut short) the spring-back.
  useEffect(() => {
    if (pos == null) {
      tx.value = (width - maxPillW) / 2;
      ty.value = height - insets.bottom - PILL_H - 120;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, width, height, insets.bottom, maxPillW]);

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
    const ws = useWorkspaceStore.getState();
    const pill = useFloatingPillStore.getState();
    // Reset so re-selecting the SAME block re-anchors beside it (not over the X).
    lastAnchoredIndex.current = null;
    ws.setChromeSelection(null);
    if (ws.selectedBlocks.length === 0) {
      // The global ✦ bubble dragged onto the X → the overlay hides until the
      // workspace is re-entered (or a block is selected again).
      pill.hide();
      return;
    }
    // A BLOCK bubble dragged onto the X closes only the block context: the
    // selection clears and the bubble falls back to the default global ✦ AI
    // bubble, springing to its home spot instead of vanishing.
    ws.clearSelection();
    pill.setExpanded(false);
    pill.setInputOpen(false);
    const homeX = defaultX;
    const homeY = Math.min(defaultY, maxY);
    pill.setPos({ x: homeX, y: homeY });
    tx.value = withSpring(homeX, SPRING);
    ty.value = withSpring(homeY, SPRING);
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
  const pan = useMemo(() => {
    const base = Gesture.Pan()
      // Collapsed bubble gets a generous grab margin (BUBBLE_SLOP) so drags that
      // start just outside the 52px circle still catch it. The expanded pill gets
      // none — slop there would steal taps meant for the document around it.
      .hitSlop(
        expanded
          ? { left: 0, right: 0, top: 0, bottom: 0 }
          : { left: BUBBLE_SLOP, right: BUBBLE_SLOP, top: BUBBLE_SLOP, bottom: BUBBLE_SLOP },
      );
    // Arbitration differs per form: the EXPANDED pill must yield horizontal drags
    // to its inner chip ScrollView (vertical-only activation), but the collapsed
    // BUBBLE has no inner scroll — it drags freely in EVERY direction; minDistance
    // keeps plain taps reaching its Pressable (expand).
    const configured = expanded
      ? base.activeOffsetY([-12, 12]).failOffsetX([-16, 16])
      : base.minDistance(10);
    // Explicit "worklet" directives: splitting the builder chain across variables
    // (base/configured) defeats the Babel plugin's auto-workletization, which only
    // recognizes callbacks chained directly on Gesture.Xxx() — without these the
    // callbacks silently run on the JS thread (RNGH warns).
    return configured
        .onStart(() => {
          "worklet";
          startTX.value = tx.value;
          startTY.value = ty.value;
          dragActive.value = withTiming(1, { duration: 140 });
        })
        .onUpdate((e) => {
          "worklet";
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
          "worklet";
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
          "worklet";
          // Always settle the target chrome, even on a cancelled/interrupted drag
          // that never reaches onEnd — otherwise the X target stays visible.
          dragActive.value = withTiming(0, { duration: 140 });
          overTarget.value = 0;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, insets.top, insets.bottom, curW, keyboardHeight]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  // Spawn/re-anchor beside the selected block: when the selected INDEX changes and
  // we have a tap Y, place the pill at a screen-side position at that height. The
  // FIRST anchor (and the first after a dismiss, where the ref was cleared) is a
  // DIRECT set — no diagonal slide from the center-bottom default. Subsequent
  // re-anchors spring across. Drag overrides until the next selection change;
  // scrolling does not re-anchor.
  // Chrome bands anchor in a NEGATIVE index space (-(index+2)) so switching between a
  // band and the paragraph that shares its startBlockIndex still counts as a change
  // and re-anchors the pill (a top band and its section's first paragraph collide at
  // the same block index otherwise). -1 stays reserved for "none".
  const soleIndex = chromeSelection
    ? -(chromeSelection.index + 2)
    : selectedBlock
      ? selectedBlock.index
      : count === 1
        ? indices[0] ?? null
        : null;
  useEffect(() => {
    if (soleIndex == null) return;
    if (soleIndex === lastAnchoredIndex.current) return;
    const isFirst = lastAnchoredIndex.current == null;
    lastAnchoredIndex.current = soleIndex;
    if (anchorY == null) return;
    const w = expanded ? maxPillW : BUBBLE_SIZE;
    const sideX = rtl ? minX : Math.max(minX, width - w - 12);
    // Sit the bubble ABOVE the caret line, not centered on it. anchorY is the
    // block's TOP, so centering (anchorY - BUBBLE_SIZE/2) parks the bubble's lower
    // half over the first line — it covers the caret and the text being typed
    // (worst in LTR, where the caret and the edge-pinned bubble share a side).
    // Lifting a full bubble-height + gap above the top clears the line entirely;
    // near the very top the minY clamp keeps it on-screen.
    const yy = Math.min(Math.max(anchorY - BUBBLE_SIZE - BUBBLE_ABOVE_GAP, minY), maxY);
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
    askAiOpen || aiGateActive || soleSuggested || rangeActive || !composerOpen || previewMode != null || insertMenuOpen;
  // The pill itself hides when suppressed/not visible, same as before — but the
  // chat-overlay panel (mounted unconditionally below) must NOT unmount just
  // because one of those flags flips while the user is actively using it.
  const pillVisible = visible && !suppressed;

  return (
    <>
      {pillVisible && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <DismissTarget visible={dragActive} active={overTarget} centerY={targetCY} bottomInset={dismissBottom} />
          <GestureDetector gesture={pan}>
            <Animated.View layout={layoutSpring} style={[styles.host, hostAnchor, { width: curW }, pillStyle]}>
              {expanded ? (
            chromeSelection ? (
              inputOpen ? (
                <View style={[styles.dockPanel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
                  {/* ✦ Ask on a chrome band → section-scoped AI (reuses AIDock scope props). */}
                  <AIDock
                    thesisId={thesisId}
                    scopeLabel={chromeScopeLabel}
                    scopeIndices={[chromeSelection.index]}
                    selectedBlock={null}
                    scopeText={chromeSelection.text}
                    scopeBlocks={[]}
                  />
                </View>
              ) : (
                // Chrome band → the SAME BlockContextBar shell/animations as text/
                // heading/table (chrome is just another bubbleKind); ✦ Ask opens the
                // section-scoped AIDock above.
                <BlockContextBar
                  thesisId={thesisId}
                  rtl={rtl}
                  paragraphSelection={[]}
                  selectedBlock={null}
                  selectedIndices={[chromeSelection.index]}
                  count={0}
                  blockCount={blocks.length}
                  keyboardOpen={false}
                  scopeLabel={chromeScopeLabel}
                  onAskAI={() => useFloatingPillStore.getState().setInputOpen(true)}
                  onCollapse={() => useFloatingPillStore.getState().setExpanded(false)}
                  bottomInset={0}
                  blocks={blocks}
                  chrome={chromeSelection}
                />
              )
            ) : count === 0 || inputOpen ? (
              <View style={[styles.dockPanel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
                {/* AIDock lays out by APP language (useRTL inside), not thesis rtl. */}
                <AIDock
                  thesisId={thesisId}
                  scopeLabel={scopeLabel}
                  scopeIndices={indices}
                  selectedBlock={selectedBlock}
                  scopeText={scopeText}
                  scopeBlocks={paragraphSelection.map((b) => ({ index: b.index, text: b.text, level: b.level }))}
                />
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
                blocks={blocks}
              />
            )
          ) : (
            <>
              {awaitingReply && !peekCardExpired && (
                <PeekCard
                  anchorLeft={peekAnchorLeft}
                  phase={peekPhase}
                  snippet={peekSnippet}
                  thinkingTokens={peekThinkingTokens}
                  onPress={revealReply}
                />
              )}
              <Bubble
                colors={colors}
                kind={bubbleKind}
                iconOverride={!awaitingReply && isEmptyPara ? Plus : undefined}
                busy={busy}
                unread={awaitingReply && peekCardExpired}
                label={
                  awaitingReply && peekCardExpired
                    ? t("aiDock.peek.unreadLabel", { defaultValue: "Reply ready — tap to view" })
                    : !awaitingReply && isEmptyPara
                      ? t("insert.addBlock", { defaultValue: "Add a block" })
                      : count === 0
                        ? t("blockBar.askAi", { defaultValue: "Ask AI" })
                        : t("blockBar.formattingTools", { defaultValue: "Formatting tools" })
                }
                onPress={
                  awaitingReply
                    ? revealReply
                    : isEmptyPara
                      ? openInsertMenu
                      : () => useFloatingPillStore.getState().setExpanded(true)
                }
              />
            </>
          )}
            </Animated.View>
          </GestureDetector>
        </View>
      )}
      <ChatOverlayPanel thesisId={thesisId} thesisTitle={thesisTitle} />
    </>
  );
}

/** Collapsed form: a small circular bubble with an icon matching the current mode
 *  — ✦ Sparkles when nothing is selected (AI mode), else the selected block's kind.
 *  Spins continuously while `busy` (an AI turn is generating). Tapping it expands
 *  to the AI dock (AI mode) or the full BlockContextBar pill (block mode). */
function Bubble({
  colors,
  kind,
  iconOverride,
  label,
  busy,
  unread,
  onPress,
}: {
  colors: ReturnType<typeof useThemeColors>;
  kind: BubbleKind;
  // #3: on a blank paragraph the bubble renders a "+" (open Insert menu) instead of
  // the mode's usual icon. Falls back to the registry icon when not provided.
  iconOverride?: LucideIcon;
  label: string;
  busy: boolean;
  unread: boolean;
  onPress: () => void;
}) {
  const Icon = iconOverride ?? BUBBLE_ICONS[kind];

  // Busy indicator: the whole bubble breathes (scales up/down) in a loop
  // instead of spinning the icon in place.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (busy) {
      pulse.value = withRepeat(withTiming(1.12, { duration: 600, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [busy, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View
      entering={ZoomIn.springify().damping(30).stiffness(700)}
      exiting={ZoomOut.springify().damping(30).stiffness(700)}
      style={pulseStyle}
    >
      <Pressable
        onPress={onPress}
        // Generous tap margin matching the pan's grab slop — the 52px circle is a
        // small target; touches just outside it should still expand the bubble.
        hitSlop={BUBBLE_SLOP}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.bubble, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
      >
        <Icon size={22} color={colors.bgPrimary} strokeWidth={2.2} />
        {unread && (
          <Animated.View
            entering={FadeIn}
            exiting={FadeOut}
            style={[styles.unreadDot, { backgroundColor: colors.brandAccent, borderColor: colors.brandPrimary }]}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Two independent RTL breakages had to be countered so the pill drags across the
  // FULL width in every app language (the position math is all physical left→right):
  //  1. direction:"ltr" — on the New Architecture (Fabric) a view laid out RTL
  //     MIRRORS `translateX`; without this the pill's positive translateX drove it
  //     the wrong way (it stuck to the left edge).
  //  2. NO `left`/`right` here — RN's global RTL left↔right style swap flips a
  //     `left:0` anchor to the right edge REGARDLESS of this node's direction, which
  //     pinned the pill to the right half (undraggable leftward). The physical-left
  //     anchor is applied inline via `hostAnchor` instead (right:0 when
  //     I18nManager.isRTL, which the same swap turns back into physical left:0).
  // Content (AIDock/BlockContextBar) still lays out RTL via explicit useRTL()
  // flexDirection/textAlign — no inherited-direction reliance — so this is safe.
  host: { position: "absolute", top: 0, direction: "ltr" },
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
  unreadDot: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
});
