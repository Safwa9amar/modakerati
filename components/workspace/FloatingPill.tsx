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
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useChatThreadsStore } from "@/stores/chat-threads-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useDockToolsStore } from "@/stores/dock-tools-store";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatHead } from "@/stores/chat-head-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useThemeColors } from "@/hooks/useThemeColors";
import { hSelection } from "@/lib/haptics";
import { bubbleIn, bubbleOut, layoutSpring, SPRING } from "@/lib/motion";
import { estimateTokenCount } from "@/lib/thinking";
import type { DocBlockDTO } from "@/lib/api";
import { Plus, KeyboardOff, Keyboard as KeyboardIcon, SquareCheck, LayoutGrid, type LucideIcon } from "lucide-react-native";
import { BUBBLE_ICONS, type BubbleKind } from "@/lib/bubble-configs";
import { resolveToolbarKind } from "@/stores/toolbar-store";
import { AIDock } from "./ai-dock";
import { BlockContextBar, VERTICAL_PILL_W, VERTICAL_PILL_MAX_H } from "./BlockContextBar";
import { DismissTarget, DISMISS_HIT_RADIUS, DISMISS_SIZE } from "./DismissTarget";
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
// Fallback clearance for the dock, used only for the very first keyboard rise
// before onLayout has reported a real height. The measured height replaces it
// as soon as the panel has been laid out once.
const DOCK_CLEARANCE_FALLBACK = 150;
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
  // Checkbox select mode: the selection is being BUILT by tapping blocks, so the
  // expanded bubble stays the AI dock (act on the set / leave the mode) instead of
  // flipping to the single-block formatting toolbar on the first check.
  const selectMode = useWorkspaceStore((s) => s.selectMode);
  // Composer visibility + preview mode — the floating pill must yield the bottom
  // surface to the whole-memoir composer (count===0), hide when the composer is
  // toggled off (else its Ask-AI opens a null BlockComposer → dead end), and never
  // spawn over a docx/pdf preview. Primitive selectors (no Object.is loop).
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);
  const previewMode = useWorkspaceStore((s) => s.previewMode);
  // #6 keyboard mode: the ⌨ tray target toggles this; its icon + label reflect it.
  const keyboardActive = useWorkspaceStore((s) => s.keyboardActive);
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
  // Keyed by THREAD — chat-store.messages is per-conversation. Reading it by
  // thesis would look up a key that never exists, leaving the peek card
  // permanently blank. currentThreadId is set by whichever Writer surface last
  // resolved a conversation for this thesis; null before that, which the
  // optional chaining below already tolerates.
  const currentThreadId = useChatThreadsStore((s) => s.currentThreadId);
  const threadMessages = useChatStore((s) => (currentThreadId ? s.messages[currentThreadId] : undefined));
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
  // Live Lexical block format — lets a caret inside a list resolve to the "list"
  // glyph/toolset (the DTO can't be trusted for list-ness; see resolveBubbleKind).
  const lexActive = useLexicalEditorStore((s) => s.active);
  const lexBlockType = useLexicalEditorStore((s) => s.format.blockType);
  // Which family the selection belongs to — the collapsed bubble's GLYPH here, and the
  // toolbar module BlockContextBar renders. Both call the same resolver (the toolbar
  // store's), so the icon and the toolset can never disagree; both pass the same live
  // list format, so a caret in a list gets the list glyph and the list tools together.
  const bubbleKind: BubbleKind = resolveToolbarKind({
    block: selectedBlock,
    listType: lexActive ? lexBlockType : null,
    chrome: chromeSelection,
    count,
  });
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
  // …but NOT inside a list: an empty new bullet/number/check item is a normal step
  // in building a list, so keep the list bubble (its tools) rather than the + Insert.
  const isEmptyPara =
    count === 1 && selectedBlock != null && selectedBlock.kind === "paragraph" && !selectedBlock.text.trim() && bubbleKind !== "list";
  const openInsertMenu = () => {
    if (!selectedBlock) return;
    useInsertMenuStore.getState().openAt({ index: selectedBlock.index, y: anchorY ?? startY });
  };

  const maxPillW = Math.min(420, width - 24);

  // ── Column form (Settings → Toolbar layout = Vertical) ──
  // Every BlockContextBar toolset goes vertical — block kinds and chrome bands alike.
  // The AI dock does not (nothing selected, or the inline Ask input): it's a panel of
  // prose and chips, not a tool strip. So the condition here must mirror exactly which
  // branch of the render below actually mounts a BlockContextBar.
  const toolbarOrientation = useSettingsStore((s) => s.toolbarOrientation);
  const columnForm =
    toolbarOrientation === "vertical" && expanded && !inputOpen && !selectMode && (chromeSelection != null || count > 0);

  // Container width depends on form; drives centering, clamp, and the drag hit-test.
  // The column's width is REPORTED by BlockContextBar (onColumnWidth) because it grows
  // when a category flies its options out beside the strip — the host can't measure
  // content it is itself constraining.
  const [columnW, setColumnW] = useState<number>(VERTICAL_PILL_W);
  const curW = expanded ? (columnForm ? columnW : maxPillW) : BUBBLE_SIZE;
  // Height matters only for the column form (the row forms are one chip tall). Start
  // from the worst case so the very first clamp can't drop a tall strip off-screen,
  // then refine to the real height on layout — a 3-chip column shouldn't be pinned to
  // the top half of the screen just because a 12-chip one could be.
  const [columnH, setColumnH] = useState(VERTICAL_PILL_MAX_H);
  const curH = columnForm ? columnH : PILL_H;
  // Real laid-out height of the dock panel, so keyboard clearance tracks the
  // panel instead of a constant that goes stale whenever its rows change.
  const [dockH, setDockH] = useState(0);

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
  // …except while checkbox-selecting, where checking another block is part of
  // composing the SAME ask — closing the input there would discard what was typed.
  //
  // Keyed on the index SET, not the array identity: every editor report rebuilds
  // `selectedBlocks`, and re-selecting the same blocks is not a change of target.
  // Identity alone made a redundant report close a live ask and throw away the
  // prompt being typed into it.
  const selectionKey = useMemo(() => indices.join(","), [indices]);
  useEffect(() => {
    if (selectMode) return;
    if (useFloatingPillStore.getState().inputOpen) {
      useFloatingPillStore.getState().setInputOpen(false);
    }
  }, [selectionKey, selectMode]);

  // ── Drag position ──
  // Messenger chat-head rule: the COLLAPSED bubble always rests against a screen
  // edge, never mid-screen — it would otherwise sit on top of the text being read.
  // Its home is the trailing edge (right in LTR, left in RTL), which is also where
  // the block anchor puts it. The EXPANDED pill is exempt: it is a panel, and it
  // needs its full width wherever it is.
  const defaultX = rtl ? 8 : Math.max(8, width - BUBBLE_SIZE - 8);
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
  const overTarget = useSharedValue(0); // close (X) target grow
  const overKeyboard = useSharedValue(0); // keyboard-dismiss target grow (keyboard up only)
  const overTools = useSharedValue(0);    // document-tools target grow
  const startTX = useSharedValue(0);
  const startTY = useSharedValue(0);

  // When the keyboard is up, float the dismiss X + keep the pill above BOTH the
  // keyboard and the docked formatting bar (~56px) that sits above it.
  const dismissBottom = keyboardHeight > 0 ? keyboardHeight + 56 : insets.bottom;

  // C2 drag tray: a right-edge vertical column revealed while dragging the bubble.
  // The ⌨ target sits LOWER (nearest the thumb), close ABOVE it (farthest, so it can't
  // be fat-fingered). Both share the same center X near the right edge.
  const trayRight = 20;                                    // px from the screen right edge
  const trayCX = width - trayRight - DISMISS_SIZE / 2;     // shared center X
  // Pin the tray to the safe-area bottom (clearing the dock), NOT to dismissBottom —
  // dismissBottom folds in keyboardHeight, which can be stale/non-zero and floated the
  // whole tray up to mid-screen. The block keyboard is usually off in this mode, so the
  // tray belongs at the bottom-right regardless.
  const kbBottom = insets.bottom + 72;                     // keyboard circle bottom offset (lower target)
  // ⋮⋮ tools sits one slot above ⌨, close one slot above that (farthest from the
  // thumb, so the destructive one can't be fat-fingered).
  const toolsBottom = kbBottom + DISMISS_SIZE + 20;
  const closeBottom = toolsBottom + DISMISS_SIZE + 20;
  const kbCY = height - kbBottom - DISMISS_SIZE / 2;       // keyboard center Y
  const toolsCY = height - toolsBottom - DISMISS_SIZE / 2; // tools center Y
  const closeCY = height - closeBottom - DISMISS_SIZE / 2; // close center Y

  const minX = 8;
  // Guard the max bounds so a device narrower/shorter than the pill can't yield a
  // max < min (which would clamp the pill off-screen).
  const maxX = Math.max(minX, width - curW - 8);
  // Keep the pill clear of the header chrome at the top.
  const minY = insets.top + 100;
  const maxY = Math.max(minY, height - dismissBottom - curH - 8);

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
    // The column form isn't a dock — it needs its own (measured) height cleared, not
    // the dock panel's fixed allowance.
    const dockClearance = (dockH || DOCK_CLEARANCE_FALLBACK) + 24;
    const clearance = inputOpen
      ? dockClearance
      : columnForm
        ? curH + 24
        : expanded
          ? dockClearance
          : PILL_H + 24;
    const limit = height - keyboardHeight - clearance;
    if (ty.value > limit) ty.value = withSpring(Math.max(minY, limit), SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardHeight, inputOpen, expanded, columnForm, curH, dockH]);

  // Guards re-anchoring against unrelated re-renders. Declared here (above dismiss)
  // so dismiss can clear it — see the anchor effect below.
  const lastAnchoredIndex = React.useRef<number | null>(null);

  // Re-clamp when the form grows/shrinks (bubble⇄pill) so the wider pill can't hang
  // off-screen from a near-edge anchor. Y matters for the column form only: expanding
  // a bubble anchored near the bottom into a tall strip would otherwise run its lower
  // chips (✦ Ask AI included) off the screen. curH is constant for the row forms, so
  // their behaviour is unchanged.
  const prevColumnW = React.useRef<number | null>(null);
  useEffect(() => {
    // Column form: opening/closing a fly-out panel changes the host's WIDTH, and the
    // host is positioned by its LEFT edge — so in LTR, where the strip is the trailing
    // child, the strip itself would slide clear across the screen. Absorb the delta
    // into x to pin it. RTL puts the strip on the leading edge, which the left anchor
    // already holds still.
    if (columnForm) {
      const prev = prevColumnW.current;
      if (prev != null && prev !== curW && !rtl) tx.value = tx.value + (prev - curW);
      prevColumnW.current = curW;
    } else {
      prevColumnW.current = null;
    }
    const clampedX = Math.min(Math.max(tx.value, minX), maxX);
    // COLLAPSING is the case that strands the bubble mid-screen: the pill's x was
    // clamped for its wide form, and a 52px bubble at that x sits nowhere near an
    // edge. Snap it back to the nearer one (Messenger chat-head rule). The expanded
    // pill keeps the plain clamp.
    const restX = expanded ? clampedX : clampedX + curW / 2 < width / 2 ? minX : maxX;
    if (restX !== tx.value) tx.value = withSpring(restX, SPRING);
    const clampedY = Math.min(Math.max(ty.value, minY), maxY);
    if (clampedY !== ty.value) ty.value = withSpring(clampedY, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curW, curH, columnForm, expanded]);

  const dismiss = () => {
    const ws = useWorkspaceStore.getState();
    const pill = useFloatingPillStore.getState();
    // Reset so re-selecting the SAME block re-anchors beside it (not over the X).
    lastAnchoredIndex.current = null;
    ws.setChromeSelection(null);
    // While checkbox-selecting, the X means "leave this mode" — hiding the bubble
    // instead would strand the student in a read-only document with no way out.
    if (ws.selectMode) {
      ws.toggleSelectMode();
      ws.clearSelection(); // the ✕ discards the pick; "Done selecting" keeps it
      pill.setExpanded(false);
      pill.setInputOpen(false);
      const homeX = defaultX;
      const homeY = Math.min(defaultY, maxY);
      pill.setPos({ x: homeX, y: homeY });
      tx.value = withSpring(homeX, SPRING);
      ty.value = withSpring(homeY, SPRING);
      return;
    }
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
  // Drop on the ⌨ target → TOGGLE the block-editing keyboard mode (issue #6). Turning
  // it ON focuses the editor so the keyboard rises on the current selection; turning it
  // OFF dismisses it. The editor's inputmode (KeyboardModePlugin) then keeps the keyboard
  // closed on block taps until it's turned back on. Bubble/pill inputs are unaffected.
  // Drop on the ⋮⋮ target → open the global document tools sheet, or put it away
  // if it's already up. The bubble is the only always-reachable surface now that
  // the docked tool bar is gone, so it doubles as the sheet's toggle.
  const toggleTools = () => {
    Keyboard.dismiss();
    if (useLexicalEditorStore.getState().active) useLexicalEditorStore.getState().dispatch("blur");
    useDockToolsStore.getState().toggle();
  };

  const toggleKeyboard = () => {
    useWorkspaceStore.getState().toggleKeyboardActive();
    if (useWorkspaceStore.getState().keyboardActive) {
      // Now active → raise the keyboard on the current caret (any non-skip command focuses).
      useLexicalEditorStore.getState().dispatch("focus");
    } else {
      Keyboard.dismiss();
    }
  };

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
    // The COLUMN form inverts that: its chip scroller runs top→bottom, so vertical
    // drags belong to the tool list and only a sideways drag grabs the strip (from
    // there the pan owns both axes, so the bottom-right tray is still reachable).
    const configured = expanded
      ? columnForm
        ? base.activeOffsetX([-12, 12]).failOffsetY([-16, 16])
        : base.activeOffsetY([-12, 12]).failOffsetX([-16, 16])
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
          // Hit test: pill center vs the C2 tray targets (right-edge column). Close is
          // the UPPER target, ⌨ the LOWER (nearest the thumb). Nearest-within-radius wins
          // so the two hit zones never light both at once.
          const cx = tx.value + curW / 2;
          const cy = ty.value + curH / 2;
          const distClose = Math.hypot(cx - trayCX, cy - closeCY);
          const distTools = Math.hypot(cx - trayCX, cy - toolsCY);
          const distKb = Math.hypot(cx - trayCX, cy - kbCY);
          const nearest = Math.min(distClose, distTools, distKb);
          const overC = distClose < DISMISS_HIT_RADIUS && distClose === nearest ? 1 : 0;
          const overT = distTools < DISMISS_HIT_RADIUS && distTools === nearest ? 1 : 0;
          const overK = distKb < DISMISS_HIT_RADIUS && distKb === nearest ? 1 : 0;
          if (overC !== overTarget.value) {
            overTarget.value = withTiming(overC, { duration: 120 });
            if (overC) runOnJS(hSelection)();
          }
          if (overT !== overTools.value) {
            overTools.value = withTiming(overT, { duration: 120 });
            if (overT) runOnJS(hSelection)();
          }
          if (overK !== overKeyboard.value) {
            overKeyboard.value = withTiming(overK, { duration: 120 });
            if (overK) runOnJS(hSelection)();
          }
        })
        .onEnd(() => {
          "worklet";
          if (overTarget.value > 0.5) {
            overTarget.value = 0;
            overKeyboard.value = 0;
            overTools.value = 0;
            runOnJS(dismiss)();
            return;
          }
          const droppedOnKeyboard = overKeyboard.value > 0.5;
          const droppedOnTools = overTools.value > 0.5;
          overTarget.value = 0;
          overKeyboard.value = 0;
          overTools.value = 0;
          if (droppedOnKeyboard) runOnJS(toggleKeyboard)();
          if (droppedOnTools) runOnJS(toggleTools)();
          // Clamp into bounds and persist (snap back — also after a target drop).
          // The COLLAPSED bubble additionally flies to the nearer screen edge, the
          // Messenger chat-head rule: it may be dropped anywhere, but it never rests
          // over the text. The expanded pill stays exactly where it was let go.
          const clampedX = Math.min(Math.max(tx.value, minX), maxX);
          const clampedY = Math.min(Math.max(ty.value, minY), maxY);
          const restX = expanded ? clampedX : clampedX + curW / 2 < width / 2 ? minX : maxX;
          tx.value = withSpring(restX, SPRING);
          ty.value = withSpring(clampedY, SPRING);
          runOnJS(persistPos)({ x: restX, y: clampedY });
        })
        .onFinalize(() => {
          "worklet";
          // Always settle the target chrome, even on a cancelled/interrupted drag
          // that never reaches onEnd — otherwise a target stays visible.
          dragActive.value = withTiming(0, { duration: 140 });
          overTarget.value = 0;
          overKeyboard.value = 0;
          overTools.value = 0;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, insets.top, insets.bottom, curW, curH, columnForm, keyboardHeight]);

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
  // null while checkbox-selecting: the checkboxes never report a tap Y (no caret,
  // no onState), so anchorY is whatever the last caret left behind — re-anchoring
  // on it would fling the bubble to an unrelated spot on each check.
  const soleIndex = selectMode
    ? null
    : chromeSelection
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
    const sideX = rtl ? minX : Math.max(minX, width - curW - 12);
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
          {/* C2 drag tray — right-edge column: ✕ close (upper) + ⌨ keyboard toggle
              (lower), each with a label that flies out on hover. Both revealed while
              dragging the bubble. */}
          <DismissTarget
            visible={dragActive}
            active={overTarget}
            right={trayRight}
            bottom={closeBottom}
            label={t("bubble.close", { defaultValue: "Close" })}
          />
          <DismissTarget
            visible={dragActive}
            active={overTools}
            right={trayRight}
            bottom={toolsBottom}
            Icon={LayoutGrid}
            variant="neutral"
            label={t("dockBar.tools", { defaultValue: "Document tools" })}
          />
          <DismissTarget
            visible={dragActive}
            active={overKeyboard}
            right={trayRight}
            bottom={kbBottom}
            Icon={keyboardActive ? KeyboardOff : KeyboardIcon}
            variant="neutral"
            label={
              keyboardActive
                ? t("bubble.keyboardOff", { defaultValue: "Keyboard off" })
                : t("bubble.keyboardOn", { defaultValue: "Keyboard on" })
            }
          />
          <GestureDetector gesture={pan}>
            <Animated.View
              layout={layoutSpring}
              // Column form only: feed the real strip height back into the clamp math
              // (see columnH) so a short toolset can be dragged as low as a tall one.
              onLayout={columnForm ? (e) => setColumnH(e.nativeEvent.layout.height) : undefined}
              style={[styles.host, hostAnchor, { width: curW }, pillStyle]}
            >
              {expanded ? (
            chromeSelection ? (
              inputOpen ? (
                <View
                  onLayout={(e) => setDockH(e.nativeEvent.layout.height)}
                  style={[styles.dockPanel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}
                >
                  {/* ✦ Ask on a chrome band → section-scoped AI (reuses AIDock scope props). */}
                  <AIDock
                    thesisId={thesisId}
                    scopeIndices={[chromeSelection.index]}
                    selectedBlock={null}
                    scopeText={chromeSelection.text}
                    scopeBlocks={[]}
                    chrome
                    blocks={blocks}
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
                  onColumnWidth={setColumnW}
                  bottomInset={0}
                  blocks={blocks}
                  chrome={chromeSelection}
                />
              )
            ) : count === 0 || inputOpen || selectMode ? (
              <View
                onLayout={(e) => setDockH(e.nativeEvent.layout.height)}
                style={[styles.dockPanel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}
              >
                {/* AIDock lays out by APP language (useRTL inside), not thesis rtl. */}
                <AIDock
                  thesisId={thesisId}
                  scopeIndices={indices}
                  selectedBlock={selectedBlock}
                  scopeText={scopeText}
                  scopeBlocks={paragraphSelection.map((b) => ({ index: b.index, text: b.text, level: b.level }))}
                  blocks={blocks}
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
                onColumnWidth={setColumnW}
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
                iconOverride={
                  !awaitingReply && selectMode ? SquareCheck : !awaitingReply && isEmptyPara ? Plus : undefined
                }
                busy={busy}
                unread={awaitingReply && peekCardExpired}
                label={
                  awaitingReply && peekCardExpired
                    ? t("aiDock.peek.unreadLabel", { defaultValue: "Reply ready — tap to view" })
                    : selectMode
                      ? scopeLabel
                      : !awaitingReply && isEmptyPara
                        ? t("insert.addBlock", { defaultValue: "Add a block" })
                        : count === 0
                          ? t("blockBar.askAi", { defaultValue: "Ask AI" })
                          : t("blockBar.formattingTools", { defaultValue: "Formatting tools" })
                }
                onPress={
                  awaitingReply
                    ? revealReply
                    : isEmptyPara && !selectMode
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
      // Open and close are separate animations, not two directions of one — and on a
      // swap only the ARRIVING side plays (see lib/pill-swap.ts), so the bubble
      // vanishes instantly under the expanding pill instead of shrinking beneath it.
      entering={bubbleIn}
      exiting={bubbleOut}
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
        <Icon size={22} color={colors.brandOnPrimary} strokeWidth={2.2} />
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
