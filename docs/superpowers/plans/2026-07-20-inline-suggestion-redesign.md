# Inline AI Suggestion Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline suggestion card with an in-place suggestion: the proposed rewrite renders as the document paragraph, the original's first line peeks below (tap to unfold a word-level diff), and actions live in a floating pill.

**Architecture:** A new pure `lib/word-diff.ts` computes word-level LCS segments. `InlineSuggestion` is rebuilt to render **instead of** `DocBlock` in `OutlineReorderable`'s `Row` (states: thinking shimmer / ready with peek teaser / edit-in-place / error). `suggestion-store` gains one transient `justApplied` field so the returning `DocBlock` plays a settle flash after approve. Spec: `docs/superpowers/specs/2026-07-20-inline-suggestion-redesign-design.md`.

**Tech Stack:** React Native (Expo v56), Reanimated 4.3 (`useReducedMotion`, springs, `LinearTransition`), expo-linear-gradient (present: `~56.0.4`), zustand, i18next (en/fr/ar).

**Verification convention (this repo):** the Expo app has NO JS test runner — never add jest/vitest. Gate every task with `npx tsc --noEmit` (run from `/Users/hamzasafwan/modakerati`) and finish with on-device QA (Task 7). The pure diff util gets a one-off transpile-and-run sanity check instead of a unit test.

**Git convention (this repo):** the user runs parallel Claude sessions on this tree and commits manually mid-task. Always `git add` EXACT paths (never `-A`/`.`), always fresh commits (never `--amend`), and re-check `git status` before each commit.

---

### Task 1: `lib/word-diff.ts` — word-level diff

**Files:**
- Create: `lib/word-diff.ts`

- [ ] **Step 1: Write the module**

```ts
// Word-level diff between two paragraph versions, for the suggestion
// compare view (removed words struck in the original slip, added words
// tinted in the proposed text). Tokenizes on whitespace — word-safe for
// Arabic (letters join only within a word) — and runs a classic LCS.
//
// Perf cap: past MAX_TOKENS on either side we skip the O(n·m) table and
// return the degenerate two-segment diff; the UI then shows the plain
// original without word marks (still perfectly usable).

export type DiffKind = "same" | "del" | "add";

export interface DiffSegment {
  text: string;
  kind: DiffKind;
}

const MAX_TOKENS = 400;

export function diffWords(oldText: string, newText: string): DiffSegment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    const segs: DiffSegment[] = [];
    if (a.length) segs.push({ text: a.join(" "), kind: "del" });
    if (b.length) segs.push({ text: b.join(" "), kind: "add" });
    return segs;
  }

  // LCS length table, row-major over (n+1)×(m+1). Uint16 is safe: lengths
  // are capped at MAX_TOKENS (< 65535).
  const n = a.length;
  const m = b.length;
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] =
        a[i] === b[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }

  // Walk the table, merging adjacent tokens of the same kind into one
  // segment (joined with single spaces — original whitespace is not
  // preserved; the render layer only needs words in order).
  const segs: DiffSegment[] = [];
  const push = (kind: DiffKind, word: string) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === kind) last.text += " " + word;
    else segs.push({ text: word, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return segs;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0 (no NEW errors — if the tree already has unrelated errors, compare against `git stash`-free baseline by eye).

- [ ] **Step 3: Sanity-run the diff (no test runner in this repo)**

```bash
npx --yes esbuild lib/word-diff.ts --format=cjs --outfile=/private/tmp/claude-502/-Users-hamzasafwan-modakerati/333ac14a-7e99-4801-b08c-a17c7b02a15c/scratchpad/word-diff.cjs
node -e '
const { diffWords } = require("/private/tmp/claude-502/-Users-hamzasafwan-modakerati/333ac14a-7e99-4801-b08c-a17c7b02a15c/scratchpad/word-diff.cjs");
const segs = diffWords("يطيب لي في مستهل هذه المذكرة", "أود في مستهل هذه المذكرة");
console.log(JSON.stringify(segs));
// identical → one same segment
console.log(JSON.stringify(diffWords("a b c", "a b c")));
// empty sides
console.log(JSON.stringify(diffWords("", "x y")));
'
```

Expected output (order matters):
```
[{"text":"يطيب لي","kind":"del"},{"text":"أود","kind":"add"},{"text":"في مستهل هذه المذكرة","kind":"same"}]
[{"text":"a b c","kind":"same"}]
[{"text":"x y","kind":"add"}]
```
(If npx can't fetch esbuild offline, skip this step — device QA in Task 7 covers it.)

- [ ] **Step 4: Commit**

```bash
git add lib/word-diff.ts
git commit -m "feat(workspace): word-level LCS diff util for suggestion compare view"
```

---

### Task 2: i18n keys (en/fr/ar)

**Files:**
- Modify: `locales/en.json:689-696`, `locales/fr.json:689-696`, `locales/ar.json:689-696`

- [ ] **Step 1: Add four keys to each `suggestion` block (keep existing keys)**

`locales/en.json` — the `suggestion` object becomes:
```json
  "suggestion": {
    "approve": "Approve",
    "edit": "Edit",
    "reject": "Reject",
    "again": "Again",
    "thinking": "Thinking…",
    "failed": "Couldn't generate a suggestion.",
    "showOriginal": "Show original text",
    "hideOriginal": "Hide original text",
    "done": "Done",
    "cancel": "Cancel"
  }
```

`locales/fr.json`:
```json
  "suggestion": {
    "approve": "Approuver",
    "edit": "Modifier",
    "reject": "Rejeter",
    "again": "Réessayer",
    "thinking": "Réflexion…",
    "failed": "Impossible de générer une suggestion.",
    "showOriginal": "Afficher le texte original",
    "hideOriginal": "Masquer le texte original",
    "done": "Terminé",
    "cancel": "Annuler"
  }
```

`locales/ar.json`:
```json
  "suggestion": {
    "approve": "اعتماد",
    "edit": "تعديل",
    "reject": "رفض",
    "again": "إعادة",
    "thinking": "جارٍ التفكير…",
    "failed": "تعذّر إنشاء اقتراح.",
    "showOriginal": "عرض النص الأصلي",
    "hideOriginal": "إخفاء النص الأصلي",
    "done": "تم",
    "cancel": "إلغاء"
  }
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e 'for (const l of ["en","fr","ar"]) JSON.parse(require("fs").readFileSync("locales/"+l+".json","utf8")); console.log("ok")'`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(i18n): suggestion show/hide-original, done, cancel keys (en/fr/ar)"
```

---

### Task 3: `suggestion-store` — `justApplied` transient

**Files:**
- Modify: `stores/suggestion-store.ts`

- [ ] **Step 1: Add the field + action**

In `interface SuggestionState`, after `byIndex`:
```ts
  // Block index whose suggestion was JUST approved — the returning DocBlock
  // reads this to play a one-shot green settle flash, then clears it.
  justApplied: number | null;
```
and after `setProposed`:
```ts
  // Clear the settle-flash marker (called by the flash animation when done).
  clearApplied: () => void;
```

In the store creator, change the initial state and `approve`, and add `clearApplied`:
```ts
  byIndex: {},
  justApplied: null,
```
```ts
  approve: (thesisId, index) => {
    const cur = get().byIndex[index];
    if (!cur || cur.status !== "ready") return;
    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index, text: cur.proposed });
    set((s) => ({ byIndex: without(s.byIndex, index), justApplied: index }));
  },
```
```ts
  clearApplied: () => set({ justApplied: null }),
```

Leave `reject`, `again`, `setProposed` untouched. In `clear`, also reset it:
```ts
  clear: () => set({ byIndex: {}, justApplied: null }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — exits 0.

- [ ] **Step 3: Commit**

```bash
git add stores/suggestion-store.ts
git commit -m "feat(workspace): justApplied marker in suggestion store for the approve settle flash"
```

---

### Task 4: `DocBlock` — export paragraph typography + settle flash

**Files:**
- Modify: `components/workspace/DocBlock.tsx`

- [ ] **Step 1: Export the typography helpers**

Near the top (after the `HEADING_SIZE` const), add:

```ts
// Fixed on-white ink for text on the always-white paper — shared with the
// inline suggestion so its proposed text renders as document, not UI.
export const PARAGRAPH_INK = INK;

// The exact Text style DocBlock uses for a paragraph of this heading level
// (level 0 = body). The inline suggestion renders the proposed text with this
// so it reads as the document.
export function paragraphTextStyle(level: number): TextStyle {
  return level >= 1
    ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(level, 4) as 1 | 2 | 3 | 4] }
    : styles.body;
}
```

And change `function detectDir` to `export function detectDir` (keep it where it is).

Note: `styles` is declared with `const styles = StyleSheet.create(...)` at the bottom — function declarations hoist, so `paragraphTextStyle` may reference it. `TextStyle` is already imported in this file.

- [ ] **Step 2: Add the settle flash**

Add imports at the top of the file:
```ts
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSuggestionStore } from "@/stores/suggestion-store";
```

Inside `DocBlock`, next to the existing `isSelected`/`isEditing` selectors (BEFORE the `kind` early returns, so hooks always run):
```ts
  // True right after this block's suggestion was approved — plays a one-shot
  // green settle flash on the (freshly patched) paragraph text below.
  const justApplied = useSuggestionStore((s) => s.justApplied === block.index);
```

Add this component at file bottom (above `styles`):
```tsx
// One-shot green settle flash behind a freshly-approved paragraph: "the new
// text became the document". Clears the store marker when done (or instantly
// under reduce-motion).
function SettleFlash({ active, children }: { active: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (!active) return;
    const clear = () => useSuggestionStore.getState().clearApplied();
    if (reduce) {
      clear();
      return;
    }
    v.value = 1;
    v.value = withDelay(
      150,
      withTiming(0, { duration: 600 }, (finished) => {
        if (finished) runOnJS(clear)();
      }),
    );
    // Cleanup guarantees the marker clears even if the row unmounts mid-flash
    // (virtualized list) and the UI-thread completion callback never fires.
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const st = useAnimatedStyle(() => ({
    borderRadius: 6,
    backgroundColor: interpolateColor(v.value, [0, 1], ["rgba(34,192,122,0)", "rgba(34,192,122,0.22)"]),
  }));
  return <Animated.View style={st}>{children}</Animated.View>;
}
```

In the paragraph branch's non-editing return, wrap the `<Text>` with it:
```tsx
      ) : (
        <SettleFlash active={justApplied}>
          <Text
            {...(androidJustify ? { textBreakStrategy: "simple" as const } : null)}
            style={[
              /* ...unchanged style array... */
            ]}
          >
            {empty ? "·" : block.text}
          </Text>
        </SettleFlash>
      )}
```
(The style array stays byte-identical to what is there today — only the wrapper is new.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — exits 0. Also confirm `useEffect` is imported in DocBlock (it is: `react` import line 1).

- [ ] **Step 4: Commit**

```bash
git add components/workspace/DocBlock.tsx
git commit -m "feat(workspace): export paragraph typography + green settle flash after suggestion approve"
```

---

### Task 5: Rebuild `InlineSuggestion`

**Files:**
- Rewrite: `components/workspace/InlineSuggestion.tsx` (full replacement below)

Design notes the code implements (from the spec):
- Renders **the whole block presentation** (Row swaps `DocBlock` out — Task 6).
- Fixed on-white inks everywhere (theme colors vanish on the white paper).
- Content direction from the text (`detectDir`), chrome direction from the app language.
- Thinking: original text dimmed + sweeping light band; `ThinkingTrace` (light `surfaceColor`) streams reasoning below the instruction chip.
- Ready: proposed text in doc typography + `#22C07A` logical-start edge bar; peek teaser (1 line + gradient) unfolds the full original with `del` words struck red while `add` words in the proposal tint green (brief brighter flash that settles to a soft tint; static soft tint under reduce-motion).
- Edit-in-place: TextInput on the proposal, Done → `setProposed`, Cancel discards — document untouched.
- Error: original text renders normally + red slip + Again/Reject.
- All timing springs; `useReducedMotion` degrades to plain fades / no shimmer.

- [ ] **Step 1: Replace the file contents entirely**

```tsx
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
// Collapsed teaser height ≈ one line of the slip text (12.5px / 1.9 line-height
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
  const onApprove = () => useSuggestionStore.getState().approve(thesisId, block.index);
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0. Known trip-points if it doesn't:
- `Extract<DocBlockDTO, { kind: "paragraph" }>` — confirm `DocBlockDTO` is a discriminated union on `kind` in `lib/api.ts` (it is; `EditableParagraph` in DocBlock uses the same Extract).
- `LinearTransition.springify().damping(...)` chain exists in Reanimated 4.3.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/InlineSuggestion.tsx
git commit -m "feat(workspace): rebuild inline suggestion — in-place proposal, peeking original with word diff, floating pill"
```

---

### Task 6: `OutlineReorderable` — swap DocBlock for the suggestion

**Files:**
- Modify: `components/workspace/OutlineReorderable.tsx:69-80`

- [ ] **Step 1: Render InlineSuggestion INSTEAD of DocBlock**

In `Row`, the existing `hasSuggestion` selector stays. Change the row body from:

```tsx
      <View style={[styles.row, dimmed && styles.dimmed]}>
        <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} onLongPressDrag={drag} />
        <InlineSuggestion thesisId={thesisId} index={block.index} rtl={rtl} />
        {showPill && <BlockToolbarPill thesisId={thesisId} blocks={blocks} rtl={rtl} />}
      </View>
```

to:

```tsx
      <View style={[styles.row, dimmed && styles.dimmed]}>
        {hasSuggestion && block.kind === "paragraph" ? (
          // The suggestion takes over the block's rendering entirely (proposed
          // text in doc typography + peek + pill). Drag/select intentionally
          // unavailable while the block is "in review".
          <InlineSuggestion thesisId={thesisId} block={block} rtl={rtl} />
        ) : (
          <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} onLongPressDrag={drag} />
        )}
        {showPill && <BlockToolbarPill thesisId={thesisId} blocks={blocks} rtl={rtl} />}
      </View>
```

Update the comment above `hasSuggestion` (line 68-70) to match:

```tsx
  // A pending inline AI suggestion on THIS block REPLACES the block's own
  // rendering (in-place proposal + its own controls) and suppresses the pill.
  // Boolean-primitive selector → no zustand Object.is loop.
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — exits 0. (TS narrows `block` to the paragraph member of the union inside the `block.kind === "paragraph"` branch, matching InlineSuggestion's `block` prop type.)

- [ ] **Step 3: Commit**

```bash
git add components/workspace/OutlineReorderable.tsx
git commit -m "feat(workspace): suggestion renders in place of the block (outline row swap)"
```

---

### Task 7: Device QA + fixes

**Files:** none planned (fix-ups go where the bugs are).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit` — exits 0.

- [ ] **Step 2: Run the app and QA (Arabic RTL thesis AND a French/LTR one)**

Start: `npx expo start` (dev build on device per the project's usual flow).

Checklist — every line must pass:
1. Select a paragraph → ✦ Ask AI → send an instruction: paragraph dims with a light sweeping band; instruction chip appears; reasoning streams into the light ThinkingTrace slip (no dark navy card anywhere).
2. On ready: proposed text renders in document typography with the green edge bar on the correct side (right edge for Arabic, left for French); the original's first line peeks below under a fade.
3. Tap the peek: unfolds the full original; removed words struck red; added words in the proposal flash then settle to a soft green tint; tap again → collapses, tints clear.
4. Approve: suggestion chrome fades; the paragraph (now the new text) plays a green settle flash once; undo (header ↶) restores the old text.
5. Edit: proposal becomes an editable input (keyboard clearance OK — screen KAV owns it); change a word → Done → the changed proposal shows; Approve applies the EDITED text. Cancel path: Edit → change → Cancel → proposal unchanged.
6. Reject: everything fades; the original paragraph is back; no doc change (undo stack unchanged).
7. Again: re-streams; a second Again mid-stream doesn't duplicate; Reject mid-stream cancels cleanly.
8. Error path (airplane mode → send): original text + red slip + labeled Again + ✕; Again after reconnect works.
9. Long paragraph (> 400 words): peek opens with the plain dimmed original (no word marks) — no jank.
10. Reduce Motion ON (iOS Settings → Accessibility): no shimmer/springs/flash; all states still reachable and legible.
11. Non-review blocks unaffected: tap-to-edit, multi-select, drag-reorder, toolbar pill all behave as before; the pill never stacks with a suggestion.
12. Both app languages (switch app locale to ar and en/fr): chip/pill/teaser rows mirror correctly; labels localized.

- [ ] **Step 3: Fix what fails, re-run the failing QA line, commit fixes**

```bash
git add <exact files touched>
git commit -m "fix(workspace): <specific issue found in suggestion QA>"
```

- [ ] **Step 4: Final commit check**

Run: `git status` — no unexpected stray files from this work; `git log --oneline -8` shows the task commits.
