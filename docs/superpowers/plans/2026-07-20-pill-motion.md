# Suggestion Pill Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the "absorb into the text" motion language for the suggestion pill per `docs/superpowers/specs/2026-07-20-pill-motion-design.md`.

**Architecture:** All changes in `components/workspace/InlineSuggestion.tsx`. Press feedback via `onPressIn/onPressOut` → shared values on inner `Animated.View`s (NEVER Pressable style-functions — device constraint). Approve/Reject use a local `leaving` state that plays a choreography then commits the store call (with a one-shot 400ms fallback); Again commits instantly and morphs into a thinking capsule that anchors the loading state; ready↔editing crossfades only the pill row. Reduce-motion = instant commits, tint-only press feedback.

**Tech Stack:** Reanimated 4.3 (withSpring/withTiming/interpolate/interpolateColor/ZoomIn/ZoomOut), existing `lib/haptics.ts` (`hSelection`, `hSuccess`).

**Conventions:** no test runner (gate: `npx tsc --noEmit` + device QA); exact-path fresh commits; parallel user session — touch ONLY this file.

---

### Stage 1: Press feedback on every pill button

- [ ] In `components/workspace/InlineSuggestion.tsx`:

Add imports: `useRef` (react), `withSpring, interpolate, ZoomIn, ZoomOut` (react-native-reanimated), `hSelection` (add to the existing `@/lib/haptics` import).

Add above `PillPrimary`:

```tsx
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
```

Replace `PillPrimary` and `PillIcon` with (new `disabled` + `reduce` props; visuals stay on inner Animated.Views):

```tsx
// Primary pill action (Approve / Done / Again-on-error): tinted, bordered,
// labeled — must always dominate and never vanish.
function PillPrimary({
  icon, label, onPress, reduce, disabled,
}: { icon: React.ReactNode; label: string; onPress: () => void; reduce: boolean; disabled?: boolean }) {
  const { p, onPressIn, onPressOut } = usePressFx(reduce);
  const fx = useAnimatedStyle(() => ({
    transform: [{ scale: reduce ? 1 : 1 - 0.07 * p.value }],
    backgroundColor: interpolateColor(p.value, [0, 1], [APPROVE_BG, "rgba(14,122,70,0.28)"]),
  }));
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
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

// Icon-only pill action — 44pt effective target via hitSlop.
function PillIcon({
  icon, label, onPress, reduce, disabled,
}: { icon: React.ReactNode; label: string; onPress: () => void; reduce: boolean; disabled?: boolean }) {
  const { p, onPressIn, onPressOut } = usePressFx(reduce);
  const fx = useAnimatedStyle(() => ({
    transform: [{ scale: reduce ? 1 : 1 - 0.07 * p.value }],
    backgroundColor: interpolateColor(p.value, [0, 1], ["rgba(60,70,84,0)", "rgba(60,70,84,0.10)"]),
  }));
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
    >
      <Animated.View style={[styles.iconBtn, fx]}>{icon}</Animated.View>
    </Pressable>
  );
}
```

Then update EVERY existing `<PillPrimary …/>` / `<PillIcon …/>` call site (error, editing, ready branches) to pass `reduce={reduce}` (the component-level `useReducedMotion()` value). `disabled` is only passed in the ready branch (Stage 2).

### Stage 2: Approve/Reject choreography (leaving state + flying ✓)

- [ ] Add to the component's TOP hook block (BEFORE `if (!sug) return null` — hooks must be unconditional):

```tsx
  // "Absorb" choreography state: while leaving, all pill presses are disabled
  // and the store commit fires at animation end (400ms fallback — exactly once).
  const [leaving, setLeaving] = useState<null | "approve" | "reject">(null);
  const [rootH, setRootH] = useState(0);
  const committedRef = useRef(false);
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
```

- [ ] Replace the ready-branch handlers:

```tsx
  const commitAction = (kind: "approve" | "reject") => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (kind === "approve") {
      hSuccess();
      useSuggestionStore.getState().approve(thesisId, block.index);
    } else {
      useSuggestionStore.getState().reject(block.index);
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
    setPeekOpen(false);
    setEditing(false);
    void useSuggestionStore.getState().again(thesisId, block.index);
  };
  const onEdit = () => {
    if (leaving) return;
    setDraft(sug.proposed);
    setEditing(true);
  };
```

(`runOnJS` is already imported? It is NOT in this file yet — add it to the reanimated import. `hSuccess` import already exists.)

- [ ] Ready-branch render changes:
  - Root `Animated.View` gains `onLayout={(e) => setRootH(e.nativeEvent.layout.height)}`.
  - Wrap the pill in an Animated wrapper carrying the choreography + Edit-crossfade (Stage 3 uses the same wrapper):

```tsx
      <Animated.View
        entering={FadeIn.duration(120)}
        exiting={reduce ? FadeOut.duration(100) : ZoomOut.duration(160)}
        style={[styles.pill, styles.pillFloat, { flexDirection: appRow }, pillFx]}
      >
        <PillPrimary … reduce={reduce} disabled={!!leaving} />
        <PillIcon … reduce={reduce} disabled={!!leaving} /> (×3)
      </Animated.View>
      {/* The flying ✓ badge — absolute overlay, springs from the pill up into
          the paragraph; its landing is the DocBlock settle flash. */}
      {leaving === "approve" && !reduce && (
        <Animated.View pointerEvents="none" style={[styles.flyCheck, flyFx]}>
          <Check size={16} color="#FFFFFF" />
        </Animated.View>
      )}
```

  - New styles:

```ts
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
```

  (The ready root needs `overflow` left default (visible) so the ✓ can travel over the teaser/paragraph.)

### Stage 3: Again's thinking capsule + Edit crossfade

- [ ] Add a spinning-sparkle helper (reduce → static):

```tsx
// ✦ spinner for the loading capsule (the rebuilt file dropped the old one).
function SpinSparkle({ color, reduce }: { color: string; reduce: boolean }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    rot.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1);
  }, [reduce, rot]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View style={st}>
      <Sparkles size={13} color={color} />
    </Animated.View>
  );
}
```

- [ ] Loading branch: after the `thinkingWrap` View, add the anchored capsule (pill position):

```tsx
        <Animated.View
          entering={reduce ? FadeIn.duration(100) : ZoomIn.springify().damping(14)}
          exiting={FadeOut.duration(120)}
          style={[styles.pill, styles.pillFloat, { flexDirection: appRow }]}
        >
          <View style={[styles.thinkCapsule, { flexDirection: appRow }]}>
            <SpinSparkle color={CHIP_INK} reduce={reduce} />
            <Text style={styles.thinkLabel}>{t("suggestion.thinking", { defaultValue: "Thinking…" })}</Text>
          </View>
        </Animated.View>
```

```ts
  thinkCapsule: { alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 14 },
  thinkLabel: { color: CHIP_INK, fontSize: 12, fontFamily: "Inter_500Medium" },
```

- [ ] Editing branch: wrap its pill row in the same crossfade wrapper (`entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)}` on an Animated.View replacing the plain View). Error branch pill: leave as a plain View (press feedback only — out of scope for choreography).

### Stage 4: Verify + commit

- [ ] `npx tsc --noEmit` — clean (no NEW errors).
- [ ] `git add components/workspace/InlineSuggestion.tsx && git commit -m "feat(workspace): pill motion — absorb choreography, thinking capsule, press feedback"`
- [ ] Device QA (user): approve ✓ flight lands into the settle flash; reject tips away; Again capsule persists through streaming and pops back; edit crossfades actions only; rapid double-tap approve commits once; reduce-motion instant; error pill still functional.

## Self-review notes

- Hooks: all new hooks (`leaving`, `rootH`, `committedRef`, 3 shared values, 2 animated styles) sit in the unconditional top block; `usePressFx`/`SpinSparkle` hooks are per-component. ✓
- `setTimeout` fallback after unmount: closure holds `committedRef` (object survives) and uses `getState()` — safe, deduped. ✓
- `pillFx` at rest = opacity 1 / identity transform — no visual change until leaving. ✓
- Type consistency: `reduce`/`disabled` threaded through every PillPrimary/PillIcon call site (error ×2, editing ×2, ready ×4). ✓
