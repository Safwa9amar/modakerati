import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  I18nManager,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  cancelAnimation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { Sparkles, Check, Pencil, X, RotateCw } from "lucide-react-native";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { ThinkingTrace } from "@/components/ThinkingTrace";
import { paragraphTextStyle, detectDir } from "@/components/workspace/DocBlock";
import { hSelection, hSuccess } from "@/lib/haptics";
import { diffWords, type DiffSegment } from "@/lib/word-diff";
import type { DocBlockDTO } from "@/lib/api";

// ---------------------------------------------------------------------------
// Fixed on-white palette — this surface sits on the WHITE document paper, so
// theme tokens (light ink in dark mode) would vanish. Same convention as the
// old card and DocBlock's INK.
// ---------------------------------------------------------------------------
const EDGE_GREEN = "#22C07A"; // logical-start bar on the proposed text
const ADD_TINT = "rgba(34,192,122,0.18)"; // settled highlight on added words
const ADD_FLASH = "rgba(34,192,122,0.45)"; // brief entrance flash
const DEL_BG = "#FDECEC";
const DEL_INK = "#B3564A";
const SLIP_BG = "#F6F8FA"; // the original's teaser slip
const SLIP_EDGE = "#D4DAE1";
const MUTED_INK = "#8A94A4";
const CHIP_BG = "rgba(14,122,70,0.08)";
const CHIP_INK = "#0E5C36";
const CHIP_BORDER = "rgba(14,122,70,0.18)";
// Primary action (Approve/Done/Again): a light green TINT with dark-green ink,
// same recipe as the instruction chip. Deliberately NOT a solid dark fill with
// white ink — on this app's New-Arch iOS build a solid bg on a Pressable can
// fail to paint (observed on device, in both the old card and this rebuild),
// which left a white-on-white "missing" button. Dark ink stays legible even if
// the bg is ever dropped again.
const APPROVE_BG = "rgba(14,122,70,0.12)";
const APPROVE_INK = "#0E5C36";
const ICON_INK = "#3C4654";
const REJECT_INK = "#C0392B";
const ERR_BG = "#FDF0EF";
const ERR_BORDER = "rgba(192,57,43,0.25)";
const PAPER = "#FFFFFF";

interface Props {
  thesisId: string;
  // The full block — the suggestion takes over the block's rendering, so it
  // needs the level (typography) and text (thinking/error states).
  block: Extract<DocBlockDTO, { kind: "paragraph" }>;
  rtl: boolean;
}

/**
 * In-place AI suggestion: rendered by OutlineReorderable's Row INSTEAD of
 * DocBlock while this block has a pending suggestion. The proposed rewrite IS
 * the paragraph (doc typography + green edge bar); the original's first line
 * peeks below (tap → full original with word-level diff marks); actions live
 * in a floating pill. Nothing touches the document until Approve.
 */
export function InlineSuggestion({ thesisId, block, rtl }: Props) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  // Stable-ref selector (never a fresh object) — zustand Object.is rule.
  const sug = useSuggestionStore((s) => s.byIndex[block.index]);
  const [peekOpen, setPeekOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Word diff, only when ready and both sides exist. `same`+`add` renders the
  // proposal; `same`+`del` renders the original in the teaser.
  const segs = useMemo<DiffSegment[]>(
    () =>
      sug?.status === "ready" ? diffWords(sug.original, sug.proposed) : [],
    [sug?.status, sug?.original, sug?.proposed],
  );

  // "Absorb" choreography state: while leaving, all pill presses are disabled
  // and the store commit fires at animation end (400ms fallback — exactly once).
  const [leaving, setLeaving] = useState<null | "approve" | "reject">(null);
  const [rootH, setRootH] = useState(0);
  const committedRef = useRef(false);
  // The delayed commit (~280-400ms after tap) must target the block's CURRENT
  // engine index — a concurrent reorder of OTHER blocks renumbers indices, so
  // the tap-time closure value can go stale inside that window.
  const indexRef = useRef(block.index);
  indexRef.current = block.index;
  const pillSink = useSharedValue(0); // approve: sink+shrink+fade
  const pillDrop = useSharedValue(0); // reject: tip+drop+fade
  const flyV = useSharedValue(0); // the ✓ badge's flight progress
  const pillFx = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(pillSink.value, pillDrop.value),
    transform: [
      { translateY: pillSink.value * 12 + pillDrop.value * 20 },
      { scale: 1 - 0.15 * pillSink.value },
      { rotate: `${pillDrop.value * 6}deg` },
    ],
  }));
  const flyFx = useAnimatedStyle(() => ({
    opacity: interpolate(flyV.value, [0, 0.12, 0.8, 1], [0, 1, 1, 0]),
    transform: [
      { translateY: -flyV.value * Math.max(rootH - 88, 40) },
      { scale: interpolate(flyV.value, [0, 0.2, 1], [0.6, 1.15, 0.9]) },
    ],
  }));

  if (!sug) return null;

  // Content direction follows the TEXT (per-block, like DocBlock); chrome rows
  // follow the app language. While editing, the LIVE draft drives the direction
  // so switching script mid-edit re-aligns immediately (the stored proposal is
  // stale until Done).
  const contentDir = detectDir(
    editing && draft ? draft : sug.proposed || sug.original || block.text,
    rtl,
  );
  const appRow = I18nManager.isRTL
    ? ("row-reverse" as const)
    : ("row" as const);
  const baseTextStyle = paragraphTextStyle(block.level);
  // writingDirection unconditionally: DocBlock omits it on Android only for
  // JUSTIFIED text (a Fabric justify quirk) — this component never justifies,
  // so RTL bidi needs the explicit direction on both platforms.
  const contentTextStyle = {
    textAlign: contentDir === "rtl" ? ("right" as const) : ("left" as const),
    writingDirection: contentDir,
  };
  // The green "in review" bar sits at the paragraph's logical start.
  const edgeSide =
    contentDir === "rtl"
      ? { borderRightWidth: 3, borderRightColor: EDGE_GREEN, paddingRight: 8 }
      : { borderLeftWidth: 3, borderLeftColor: EDGE_GREEN, paddingLeft: 8 };

  const layout = reduce
    ? undefined
    : LinearTransition.springify().damping(18).stiffness(180);
  // Entrance is a calm ease-out fade+rise, NOT a spring — the spring's
  // overshoot read as an annoying bounce when the thinking state appeared
  // (user feedback on device).
  const enter = reduce
    ? FadeIn.duration(120)
    : FadeInDown.duration(220).easing(Easing.out(Easing.cubic));

  // ----- header: instruction chip (+ live thinking trace when it exists) -----
  const header = (
    <View style={[styles.headerRow, { flexDirection: appRow }]}>
      <View style={[styles.chip, { flexDirection: appRow }]}>
        <Sparkles size={12} color={CHIP_INK} />
        <Text numberOfLines={1} style={styles.chipText}>
          {sug.instruction}
        </Text>
      </View>
    </View>
  );
  const trace = sug.reasoning.trim() ? (
    <View style={styles.traceSlip}>
      <ThinkingTrace
        text={sug.reasoning}
        streaming={sug.status === "loading"}
        durationMs={sug.reasoningMs}
        defaultOpen={false}
        rtl={I18nManager.isRTL}
        ScrollComponent={ScrollView}
        surfaceColor={PAPER}
      />
    </View>
  ) : null;

  // ------------------------------- loading --------------------------------
  if (sug.status === "loading") {
    return (
      <Animated.View
        layout={layout}
        entering={enter}
        exiting={FadeOut.duration(150)}
      >
        {header}
        {trace}
        <View style={styles.thinkingWrap}>
          <Text style={[baseTextStyle, contentTextStyle, styles.thinkingText]}>
            {block.text || sug.original}
          </Text>
          {!reduce && <SweepBand />}
        </View>
        {/* Thinking capsule in the SHARED pill anchor — the same key="pill-anchor"
            wrapper persists across all four status branches, so React reconciles
            it against the pill (not whatever sibling happens to share its index;
            unkeyed positional matching landed the capsule in the TEASER's slot —
            review finding). The anchor's layout spring morphs the box between
            pill and capsule; the keyed INNER content carries the crossfade.
            Plain eased fades — springs bounced annoyingly (device feedback). */}
        <Animated.View
          key="pill-anchor"
          layout={layout}
          style={[styles.pill, styles.pillFloat, { flexDirection: appRow }]}
        >
          <Animated.View
            key="acts-thinking"
            entering={FadeIn.duration(150).easing(Easing.out(Easing.quad))}
            exiting={FadeOut.duration(120)}
            style={[styles.thinkCapsule, { flexDirection: appRow }]}
          >
            <SpinSparkle color={CHIP_INK} reduce={reduce} />
            <Text style={styles.thinkLabel}>
              {t("suggestion.thinking", { defaultValue: "Thinking…" })}
            </Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );
  }

  // -------------------------------- error ---------------------------------
  if (sug.status === "error") {
    return (
      <Animated.View
        layout={layout}
        entering={enter}
        exiting={FadeOut.duration(150)}
      >
        {header}
        {trace}
        <Text style={[baseTextStyle, contentTextStyle, styles.plainPara]}>
          {block.text || sug.original}
        </Text>
        <View style={[styles.errSlip, { flexDirection: appRow }]}>
          <Text style={styles.errText} numberOfLines={2}>
            {t("suggestion.failed", {
              defaultValue: "Couldn't generate a suggestion.",
            })}
          </Text>
        </View>
        <Animated.View
          key="pill-anchor"
          layout={layout}
          style={[styles.pill, styles.pillFloat, { flexDirection: appRow }]}
        >
          <Animated.View
            key="acts-error"
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(100)}
            style={[styles.pillRow, { flexDirection: appRow }]}
          >
            <PillPrimary
              icon={<RotateCw size={15} color={APPROVE_INK} />}
              label={t("suggestion.again", { defaultValue: "Again" })}
              onPress={() =>
                void useSuggestionStore.getState().again(thesisId, block.index)
              }
              reduce={reduce}
            />
            <PillIcon
              icon={<X size={16} color={REJECT_INK} />}
              label={t("suggestion.reject", { defaultValue: "Reject" })}
              onPress={() => useSuggestionStore.getState().reject(block.index)}
              reduce={reduce}
            />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );
  }

  // ----------------------------- edit-in-place ----------------------------
  if (editing) {
    const done = () => {
      const text = draft.trim();
      if (text) useSuggestionStore.getState().setProposed(block.index, text);
      setEditing(false);
    };
    return (
      <Animated.View
        layout={layout}
        entering={FadeIn.duration(120)}
        exiting={FadeOut.duration(120)}
      >
        {header}
        <View style={[styles.paraWrap, edgeSide]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            style={[baseTextStyle, contentTextStyle, styles.editInput]}
          />
        </View>
        {/* Shared pill anchor (persists across branches by key); the keyed inner
            row crossfades ready's 4 actions ↔ Done/Cancel while the paragraph
            area stays put. */}
        <Animated.View
          key="pill-anchor"
          layout={layout}
          style={[styles.pill, styles.pillFloat, { flexDirection: appRow }]}
        >
          <Animated.View
            key="acts-editing"
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(120)}
            style={[styles.pillRow, { flexDirection: appRow }]}
          >
            <PillPrimary
              icon={<Check size={15} color={APPROVE_INK} />}
              label={t("suggestion.done", { defaultValue: "Done" })}
              onPress={done}
              reduce={reduce}
            />
            <PillIcon
              icon={<X size={16} color={ICON_INK} />}
              label={t("suggestion.cancel", { defaultValue: "Cancel" })}
              onPress={() => setEditing(false)}
              reduce={reduce}
            />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );
  }

  // -------------------------------- ready ---------------------------------
  // The store commit, deduped: fired by the choreography's completion callback
  // AND a 400ms setTimeout fallback (Reanimated can drop a callback if the view
  // unmounts mid-animation) — committedRef guarantees exactly one commit. The
  // success haptic fires here (at commit), not at tap time.
  const commitAction = (kind: "approve" | "reject") => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (kind === "approve") {
      hSuccess();
      useSuggestionStore.getState().approve(thesisId, indexRef.current);
    } else {
      useSuggestionStore.getState().reject(indexRef.current);
    }
  };
  const commitApprove = () => commitAction("approve");
  const commitReject = () => commitAction("reject");
  const onApprove = () => {
    if (leaving) return;
    if (reduce) return commitAction("approve");
    setLeaving("approve");
    pillSink.value = withTiming(1, { duration: 260 });
    flyV.value = withTiming(1, { duration: 280 }, (finished) => {
      if (finished) runOnJS(commitApprove)();
    });
    setTimeout(commitApprove, 400); // dropped-callback fallback; committedRef dedupes
  };
  const onReject = () => {
    if (leaving) return;
    if (reduce) return commitAction("reject");
    setLeaving("reject");
    pillDrop.value = withTiming(1, { duration: 200 }, (finished) => {
      if (finished) runOnJS(commitReject)();
    });
    setTimeout(commitReject, 400);
  };
  const onAgain = () => {
    if (leaving) return;
    // Reset local UI state — without this, a rerun that comes back "ready"
    // would resurrect a stale edit draft / open peek from the previous round.
    setPeekOpen(false);
    setEditing(false);
    void useSuggestionStore.getState().again(thesisId, block.index);
  };
  const onEdit = () => {
    if (leaving) return;
    setDraft(sug.proposed);
    setEditing(true);
  };

  return (
    // NOTE: entering/exiting on this ROOT only fire on a true mount/unmount of
    // the whole component (status-branch switches reconcile as UPDATES of the
    // same root, so they never replay these). State-to-state motion is carried
    // by the CHILD wrappers (the action pill / thinking capsule) below.
    // Overflow stays default (visible) so the flying ✓ can travel over the
    // teaser/paragraph. onLayout feeds the ✓'s flight distance.
    <Animated.View
      layout={layout}
      entering={enter}
      exiting={FadeOut.duration(180)}
      onLayout={(e) => setRootH(e.nativeEvent.layout.height)}
    >
      {header}
      {trace}

      {/* The proposed rewrite IS the paragraph. Added words tint green while
          the compare view is open (brief brighter flash on expand). */}
      <View style={[styles.paraWrap, edgeSide]}>
        <Text style={[baseTextStyle, contentTextStyle]}>
          {segs
            .filter((s) => s.kind !== "del")
            .map((s, k) =>
              s.kind === "add" ? (
                <AddSpan
                  key={k}
                  text={s.text + " "}
                  active={peekOpen}
                  reduce={reduce}
                />
              ) : (
                <Text key={k}>{s.text + " "}</Text>
              ),
            )}
        </Text>
      </View>

      {/* Peek teaser: the original's first line, always visible under a fade
          gradient; tap to unfold the full original with del-words struck. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          peekOpen ? "suggestion.hideOriginal" : "suggestion.showOriginal",
          {
            defaultValue: peekOpen
              ? "Hide original text"
              : "Show original text",
          },
        )}
        onPress={() => setPeekOpen((v) => !v)}
        style={styles.teaser}
      >
        {/* Collapsed = the original's FIRST line via native numberOfLines
            truncation (the ellipsis is the "there's more" affordance). A
            maxHeight clip + layout transition is NOT used here: Reanimated
            animates layout via size/transform, which combined with an
            overflow clip can leave the window showing the BOTTOM of the
            text. The root's layout transition still springs the container
            height when this toggles. */}
        <Text
          numberOfLines={peekOpen ? undefined : 1}
          style={[styles.teaserText, contentTextStyle]}
        >
          {peekOpen
            ? segs
                .filter((s) => s.kind !== "add")
                .map((s, k) =>
                  s.kind === "del" ? (
                    <Text key={k} style={styles.delSpan}>
                      {s.text + " "}
                    </Text>
                  ) : (
                    <Text key={k}>{s.text + " "}</Text>
                  ),
                )
            : sug.original}
        </Text>
      </Pressable>

      {/* Floating action pill in the shared anchor: Approve dominates; the rest
          are icons. The anchor carries the absorb choreography (pillFx) and
          persists by key across branches (its box morphs via the layout
          spring); the keyed inner row carries the crossfade against the
          thinking capsule / Done-Cancel. */}
      <Animated.View
        key="pill-anchor"
        layout={layout}
        style={[
          styles.pill,
          styles.pillFloat,
          { flexDirection: appRow },
          pillFx,
        ]}
      >
        <Animated.View
          key="acts-ready"
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(100)}
          style={[styles.pillRow, { flexDirection: appRow }]}
        >
          <PillPrimary
            icon={<Check size={15} color={APPROVE_INK} />}
            label={t("suggestion.approve", { defaultValue: "Approve" })}
            onPress={onApprove}
            reduce={reduce}
            disabled={!!leaving}
          />
          <PillIcon
            icon={<Pencil size={15} color={ICON_INK} />}
            label={t("suggestion.edit", { defaultValue: "Edit" })}
            onPress={onEdit}
            reduce={reduce}
            disabled={!!leaving}
          />
          <PillIcon
            icon={<RotateCw size={15} color={ICON_INK} />}
            label={t("suggestion.again", { defaultValue: "Again" })}
            onPress={onAgain}
            reduce={reduce}
            disabled={!!leaving}
          />
          <PillIcon
            icon={<X size={16} color={REJECT_INK} />}
            label={t("suggestion.reject", { defaultValue: "Reject" })}
            onPress={onReject}
            reduce={reduce}
            disabled={!!leaving}
          />
        </Animated.View>
      </Animated.View>
      {/* The flying ✓ badge — absolute overlay, springs from the pill up into
          the paragraph; its landing is the DocBlock settle flash. */}
      {leaving === "approve" && !reduce && (
        <Animated.View pointerEvents="none" style={[styles.flyCheck, flyFx]}>
          <Check size={16} color="#FFFFFF" />
        </Animated.View>
      )}
    </Animated.View>
  );
}

// An added word-run in the proposal: soft green tint while the compare view is
// open, with a brief brighter flash as it opens. Reduce-motion → static tint.
function AddSpan({
  text,
  active,
  reduce,
}: {
  text: string;
  active: boolean;
  reduce: boolean;
}) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (!active || reduce) return;
    v.value = withSequence(
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 520 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const st = useAnimatedStyle(() => ({
    top: 0, // no-op layout prop — forces Fabric to commit backgroundColor on nested Text (reanimated#1455)
    backgroundColor: active
      ? interpolateColor(v.value, [0, 1], [ADD_TINT, ADD_FLASH])
      : "transparent",
  }));
  return <Animated.Text style={st}>{text}</Animated.Text>;
}

// The light band sweeping across the dimmed original while the AI drafts —
// "this paragraph is being rewritten". Width-aware via onLayout.
function SweepBand() {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!w) return;
    x.value = 0;
    x.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.linear }),
      -1,
    );
    // Stop the infinite repeat when the band unmounts / width changes — an
    // orphaned UI-thread loop otherwise keeps ticking.
    return () => cancelAnimation(x);
  }, [w, x]);
  const st = useAnimatedStyle(() => ({
    transform: [{ translateX: -140 + x.value * (w + 280) }],
  }));
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
    >
      {w > 0 && (
        <Animated.View style={[styles.band, st]}>
          <LinearGradient
            colors={[
              "rgba(255,255,255,0)",
              "rgba(255,255,255,0.85)",
              "rgba(255,255,255,0)",
            ]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.bandFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

// ✦ spinner for the loading capsule (the rebuilt file dropped the old one).
function SpinSparkle({ color, reduce }: { color: string; reduce: boolean }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    rot.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
    );
    // Stop the infinite repeat on unmount — an orphaned UI-thread loop keeps
    // ticking otherwise (same fix as SweepBand).
    return () => cancelAnimation(rot);
  }, [reduce, rot]);
  const st = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));
  return (
    <Animated.View style={st}>
      <Sparkles size={13} color={color} />
    </Animated.View>
  );
}

// Pill actions: the Pressable is a BARE hit-area and all visual styling lives
// on an inner Animated.View. On this app's New-Arch iOS build, styles passed
// to Pressable via the ({pressed}) => [...] function form intermittently fail
// to apply AT ALL (observed on device: no background, no border, no
// flexDirection — the Approve button rendered as a bare column of white icon +
// label spilling out of the pill). Inner Views always paint; press feedback is
// therefore driven by onPressIn/onPressOut → a shared value (usePressFx), not
// the broken style-function path.

// Press feedback for pill buttons: scale squish + tint deepen driven by
// onPressIn/onPressOut through a shared value on the inner Animated.View —
// NEVER Pressable style-functions (they silently fail to apply on this app's
// New-Arch iOS build; see the pill-motion spec). Reduce-motion: tint only.
function usePressFx(reduce: boolean) {
  const p = useSharedValue(0);
  const onPressIn = () => {
    hSelection();
    p.value = reduce ? 1 : withSpring(1, { damping: 20, stiffness: 400 });
  };
  const onPressOut = () => {
    p.value = reduce ? 0 : withSpring(0, { damping: 18, stiffness: 300 });
  };
  return { p, onPressIn, onPressOut };
}

// Primary pill action (Approve / Done / Again-on-error): tinted, bordered,
// labeled — must always dominate and never vanish.
function PillPrimary({
  icon,
  label,
  onPress,
  reduce,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  reduce: boolean;
  disabled?: boolean;
}) {
  const { p, onPressIn, onPressOut } = usePressFx(reduce);
  const fx = useAnimatedStyle(() => ({
    transform: [{ scale: reduce ? 1 : 1 - 0.07 * p.value }],
    backgroundColor: interpolateColor(
      p.value,
      [0, 1],
      [APPROVE_BG, "rgba(14,122,70,0.28)"],
    ),
  }));
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
    >
      <Animated.View style={[styles.primaryBtn, fx]}>
        {icon}
        <Text numberOfLines={1} style={styles.primaryLabel}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// Icon-only pill action (Edit / Again / Reject / Cancel) — 44pt effective
// target via hitSlop, localized accessibilityLabel.
function PillIcon({
  icon,
  label,
  onPress,
  reduce,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  reduce: boolean;
  disabled?: boolean;
}) {
  const { p, onPressIn, onPressOut } = usePressFx(reduce);
  const fx = useAnimatedStyle(() => ({
    transform: [{ scale: reduce ? 1 : 1 - 0.07 * p.value }],
    backgroundColor: interpolateColor(
      p.value,
      [0, 1],
      ["rgba(60,70,84,0)", "rgba(60,70,84,0.10)"],
    ),
  }));
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={10}
    >
      <Animated.View style={[styles.iconBtn, fx]}>{icon}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    alignItems: "center",
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 6,
  },
  chip: {
    alignItems: "center",
    gap: 4,
    backgroundColor: CHIP_BG,
    borderColor: CHIP_BORDER,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    maxWidth: "92%",
  },
  chipText: {
    color: CHIP_INK,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    flexShrink: 1,
  },
  // ThinkingTrace on a light on-paper slip (replaces the old dark bgCard card).
  traceSlip: {
    marginBottom: 6,
    marginHorizontal: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SLIP_EDGE,
    backgroundColor: PAPER,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  thinkingWrap: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    overflow: "hidden",
    borderRadius: 6,
  },
  thinkingText: { opacity: 0.35 },
  plainPara: { paddingHorizontal: 6, paddingVertical: 3 },
  paraWrap: { marginHorizontal: 6, marginVertical: 2, borderRadius: 2 },
  teaser: {
    marginTop: 8,
    marginHorizontal: 6,
    backgroundColor: SLIP_BG,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 9,
    overflow: "hidden",
  },
  teaserText: {
    color: MUTED_INK,
    fontSize: 12.5,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  delSpan: {
    backgroundColor: DEL_BG,
    color: DEL_INK,
    textDecorationLine: "line-through",
  },
  errSlip: {
    marginTop: 8,
    marginHorizontal: 6,
    backgroundColor: ERR_BG,
    borderColor: ERR_BORDER,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  errText: {
    flex: 1,
    color: REJECT_INK,
    fontSize: 12.5,
    fontFamily: "Inter_500Medium",
  },
  pill: {
    alignItems: "center",
    gap: 2,
    backgroundColor: PAPER,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E8ECEF",
    padding: 4,
  },
  // Floating look: centered, soft shadow (iOS) / elevation (Android).
  pillFloat: {
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
    shadowColor: "#0A1E14",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: APPROVE_BG,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 18,
    // Never let the row crush the primary action (white icon/label on the
    // white pill would read as a missing button).
    flexShrink: 0,
    minWidth: 96,
  },
  primaryLabel: {
    color: APPROVE_INK,
    fontSize: 12.5,
    fontFamily: "Inter_600SemiBold",
  },
  iconBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999 },
  // Inner content row inside the shared pill anchor — carries the per-branch
  // crossfade (the anchor itself persists by key across branches).
  pillRow: { alignItems: "center", gap: 2 },
  editInput: { padding: 0 },
  band: { position: "absolute", top: 0, bottom: 0, width: 140 },
  bandFill: { flex: 1 },
  // The approve ✓ badge that flies from the pill up into the paragraph.
  flyCheck: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "#0E7A46",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    elevation: 10,
  },
  // Again's "thinking" capsule content (rendered inside the pill shell).
  thinkCapsule: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  thinkLabel: { color: CHIP_INK, fontSize: 12, fontFamily: "Inter_500Medium" },
});
