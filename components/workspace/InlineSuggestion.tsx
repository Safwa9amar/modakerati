import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  I18nManager,
  Platform,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { Sparkles, Check, Pencil, X, RotateCw } from "lucide-react-native";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { ThinkingTrace } from "@/components/ThinkingTrace";
import { paragraphTextStyle, detectDir } from "@/components/workspace/DocBlock";
import { hSuccess } from "@/lib/haptics";
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
const APPROVE_BG = "#0E7A46";
const APPROVE_INK = "#FFFFFF";
const ICON_INK = "#3C4654";
const REJECT_INK = "#C0392B";
const ERR_BG = "#FDF0EF";
const ERR_BORDER = "rgba(192,57,43,0.25)";
const PAPER = "#FFFFFF";
// Collapsed teaser height ≈ one line of the slip text (12.5px / 19 line-height
// + slip padding).
const TEASER_COLLAPSED = 30;

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
    () => (sug?.status === "ready" ? diffWords(sug.original, sug.proposed) : []),
    [sug?.status, sug?.original, sug?.proposed],
  );

  if (!sug) return null;

  // Content direction follows the TEXT (per-block, like DocBlock); chrome rows
  // follow the app language.
  const contentDir = detectDir(sug.proposed || sug.original || block.text, rtl);
  const appRow = I18nManager.isRTL ? ("row-reverse" as const) : ("row" as const);
  const baseTextStyle = paragraphTextStyle(block.level);
  const contentTextStyle = {
    textAlign: contentDir === "rtl" ? ("right" as const) : ("left" as const),
    ...(Platform.OS === "android" ? null : { writingDirection: contentDir }),
  };
  // The green "in review" bar sits at the paragraph's logical start.
  const edgeSide =
    contentDir === "rtl"
      ? { borderRightWidth: 3, borderRightColor: EDGE_GREEN, paddingRight: 8 }
      : { borderLeftWidth: 3, borderLeftColor: EDGE_GREEN, paddingLeft: 8 };

  const layout = reduce ? undefined : LinearTransition.springify().damping(18).stiffness(180);
  const enter = reduce ? FadeIn.duration(120) : FadeInDown.springify().damping(16);

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
      <Animated.View layout={layout} entering={enter} exiting={FadeOut.duration(150)}>
        {header}
        {trace}
        <View style={styles.thinkingWrap}>
          <Text style={[baseTextStyle, contentTextStyle, styles.thinkingText]}>{block.text || sug.original}</Text>
          {!reduce && <SweepBand />}
        </View>
      </Animated.View>
    );
  }

  // -------------------------------- error ---------------------------------
  if (sug.status === "error") {
    return (
      <Animated.View layout={layout} entering={enter} exiting={FadeOut.duration(150)}>
        {header}
        {trace}
        <Text style={[baseTextStyle, contentTextStyle, styles.plainPara]}>{block.text || sug.original}</Text>
        <View style={[styles.errSlip, { flexDirection: appRow }]}>
          <Text style={styles.errText} numberOfLines={2}>
            {t("suggestion.failed", { defaultValue: "Couldn't generate a suggestion." })}
          </Text>
        </View>
        <View style={[styles.pill, styles.pillFloat, { flexDirection: appRow }]}>
          <PillPrimary
            icon={<RotateCw size={15} color={APPROVE_INK} />}
            label={t("suggestion.again", { defaultValue: "Again" })}
            onPress={() => void useSuggestionStore.getState().again(thesisId, block.index)}
          />
          <PillIcon
            icon={<X size={16} color={REJECT_INK} />}
            label={t("suggestion.reject", { defaultValue: "Reject" })}
            onPress={() => useSuggestionStore.getState().reject(block.index)}
          />
        </View>
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
      <Animated.View layout={layout} entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)}>
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
        <View style={[styles.pill, styles.pillFloat, { flexDirection: appRow }]}>
          <PillPrimary
            icon={<Check size={15} color={APPROVE_INK} />}
            label={t("suggestion.done", { defaultValue: "Done" })}
            onPress={done}
          />
          <PillIcon
            icon={<X size={16} color={ICON_INK} />}
            label={t("suggestion.cancel", { defaultValue: "Cancel" })}
            onPress={() => setEditing(false)}
          />
        </View>
      </Animated.View>
    );
  }

  // -------------------------------- ready ---------------------------------
  const onApprove = () => {
    // Success haptic on approve — carried over from the previous card UI
    // (user-added); fire-and-forget, never throws.
    hSuccess();
    useSuggestionStore.getState().approve(thesisId, block.index);
  };
  const onReject = () => useSuggestionStore.getState().reject(block.index);
  const onAgain = () => {
    // Reset local UI state — without this, a rerun that comes back "ready"
    // would resurrect a stale edit draft / open peek from the previous round.
    setPeekOpen(false);
    setEditing(false);
    void useSuggestionStore.getState().again(thesisId, block.index);
  };
  const onEdit = () => {
    setDraft(sug.proposed);
    setEditing(true);
  };

  return (
    <Animated.View layout={layout} entering={enter} exiting={FadeOut.duration(180)}>
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
                <AddSpan key={k} text={s.text + " "} active={peekOpen} reduce={reduce} />
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
        accessibilityLabel={t(peekOpen ? "suggestion.hideOriginal" : "suggestion.showOriginal", {
          defaultValue: peekOpen ? "Hide original text" : "Show original text",
        })}
        onPress={() => setPeekOpen((v) => !v)}
        style={styles.teaser}
      >
        {/* Animated.View with its own layout transition so the expand/collapse
            height change springs instead of snapping. */}
        <Animated.View layout={layout} style={peekOpen ? undefined : { maxHeight: TEASER_COLLAPSED, overflow: "hidden" }}>
          <Text style={[styles.teaserText, contentTextStyle]}>
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
        </Animated.View>
        {!peekOpen && (
          <LinearGradient
            colors={["rgba(246,248,250,0)", SLIP_BG]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}
      </Pressable>

      {/* Floating action pill: Approve dominates; the rest are icons. */}
      <View style={[styles.pill, styles.pillFloat, { flexDirection: appRow }]}>
        <PillPrimary
          icon={<Check size={15} color={APPROVE_INK} />}
          label={t("suggestion.approve", { defaultValue: "Approve" })}
          onPress={onApprove}
        />
        <PillIcon icon={<Pencil size={15} color={ICON_INK} />} label={t("suggestion.edit", { defaultValue: "Edit" })} onPress={onEdit} />
        <PillIcon icon={<RotateCw size={15} color={ICON_INK} />} label={t("suggestion.again", { defaultValue: "Again" })} onPress={onAgain} />
        <PillIcon icon={<X size={16} color={REJECT_INK} />} label={t("suggestion.reject", { defaultValue: "Reject" })} onPress={onReject} />
      </View>
    </Animated.View>
  );
}

// An added word-run in the proposal: soft green tint while the compare view is
// open, with a brief brighter flash as it opens. Reduce-motion → static tint.
function AddSpan({ text, active, reduce }: { text: string; active: boolean; reduce: boolean }) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (!active || reduce) return;
    v.value = withSequence(withTiming(1, { duration: 180 }), withTiming(0, { duration: 520 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const st = useAnimatedStyle(() => ({
    backgroundColor: active
      ? interpolateColor(v.value, [0, 1], [ADD_TINT, ADD_FLASH])
      : "transparent",
  }));
  return (
    <Animated.Text style={st}>
      {text}
    </Animated.Text>
  );
}

// The light band sweeping across the dimmed original while the AI drafts —
// "this paragraph is being rewritten". Width-aware via onLayout.
function SweepBand() {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (!w) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1);
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
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.85)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.bandFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

// Solid primary pill action (Approve / Done / Again-on-error).
function PillPrimary({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.75 : 1 }]}
    >
      {icon}
      <Text numberOfLines={1} style={styles.primaryLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

// Icon-only pill action (Edit / Again / Reject / Cancel) — 44pt effective
// target via hitSlop, localized accessibilityLabel.
function PillIcon({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: { alignItems: "center", marginTop: 4, marginBottom: 6, paddingHorizontal: 6 },
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
  chipText: { color: CHIP_INK, fontSize: 11, fontFamily: "Inter_500Medium", flexShrink: 1 },
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
  thinkingWrap: { paddingHorizontal: 6, paddingVertical: 3, overflow: "hidden", borderRadius: 6 },
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
  teaserText: { color: MUTED_INK, fontSize: 12.5, lineHeight: 19, fontFamily: "Inter_400Regular" },
  delSpan: { backgroundColor: DEL_BG, color: DEL_INK, textDecorationLine: "line-through" },
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
  errText: { flex: 1, color: REJECT_INK, fontSize: 12.5, fontFamily: "Inter_500Medium" },
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
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  primaryLabel: { color: APPROVE_INK, fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  iconBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999 },
  editInput: { padding: 0 },
  band: { position: "absolute", top: 0, bottom: 0, width: 140 },
  bandFill: { flex: 1 },
});
