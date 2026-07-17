# Thesis Details Redesign (Book Hero) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `app/(app)/thesis-detail.tsx` as a premium "book" screen — an animated faux-3D indigo book cover (Reanimated + gyroscope parallax, ribbon = progress), a slim stat strip, spine-edged expandable section rows, a fixed glass action bar, and a `⋯` rename/export/delete menu.

**Architecture:** Extract pure layout math into `lib/thesis-book.ts`. Build five focused presentational components under `components/thesis/` plus one motion hook. The screen keeps its existing data-loading logic and just composes the new pieces. No backend changes; all three menu actions reuse existing API functions and the existing Export screen.

**Tech Stack:** Expo SDK 56, React Native 0.85, expo-router, `react-native-reanimated` 4.3.1 + `react-native-worklets`, `react-native-gesture-handler` 2.31.1, `expo-linear-gradient` (new), `expo-sensors` (new), `expo-blur` (installed), i18n via `react-i18next` (locales in `locales/{en,fr,ar}.json`), theming via `useThemeColors`, per-content RTL via `lib/text-direction.ts`.

---

## Testing & Verification Approach (read first)

**This app has no JS test runner** (only `typescript` in devDeps; no jest/vitest, no `test` script). Standing up jest-expo for a visual/animation feature is disproportionate and out of scope. The verification gate for every task is therefore:

1. **`npx tsc --noEmit`** must pass (the app's de-facto correctness gate).
2. The final task **drives the real app** and checks a behavioral checklist — animation, gyro, expand, fixed bar, RTL, and the menu flows can only be validated live.

Pure helpers are isolated in `lib/thesis-book.ts` so they *could* be unit-tested later; for now they're verified live (ribbon length visibly tracks progress; spine colors visibly cycle).

**Expo v56 mandate (AGENTS.md):** before writing code that touches a new module, consult `https://docs.expo.dev/versions/v56.0.0/` for `expo-sensors` (DeviceMotion), `expo-linear-gradient`, and the Reanimated/gesture-handler APIs, and confirm New Architecture compatibility.

---

## File Structure

**Create:**
- `lib/thesis-book.ts` — pure helpers: `ribbonDrop`, `spineColorForIndex`, `pageEdgeThickness`, constants.
- `components/thesis/useCoverParallax.ts` — motion hook (entrance + drag + gyro + reduce-motion + focus lifecycle).
- `components/thesis/ThesisBookCover.tsx` — the animated book.
- `components/thesis/ThesisStatStrip.tsx` — slim 3-stat strip.
- `components/thesis/SectionRow.tsx` — spine-edged expandable section row.
- `components/thesis/ThesisActionBar.tsx` — fixed glass bottom bar.
- `components/thesis/ThesisHeaderMenu.tsx` — `⋯` menu + rename modal + delete confirm.

**Modify:**
- `package.json` — add `expo-sensors`, `expo-linear-gradient` (via `npx expo install`).
- `locales/en.json`, `locales/fr.json`, `locales/ar.json` — new `thesis.*` keys.
- `app/(app)/thesis-detail.tsx` — compose the new components; keep data logic; generalize `openSectionAt` → `openBlock`.

---

## Task 0: Install dependencies & confirm docs

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read the Expo v56 docs**

Open `https://docs.expo.dev/versions/v56.0.0/` and skim: `expo-sensors` (DeviceMotion: `addListener`, `setUpdateInterval`, `isAvailableAsync`, the `rotation` payload units) and `expo-linear-gradient` (`LinearGradient` props). Confirm both list SDK 56 support and work on the New Architecture.

- [ ] **Step 2: Install both modules**

Run: `npx expo install expo-sensors expo-linear-gradient`
Expected: `package.json` gains `expo-sensors` and `expo-linear-gradient` pinned to SDK-56-compatible versions (`~56.x`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly (no errors).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(thesis-detail): add expo-sensors + expo-linear-gradient"
```

---

## Task 1: Pure layout helpers

**Files:**
- Create: `lib/thesis-book.ts`

- [ ] **Step 1: Write the helpers**

Create `lib/thesis-book.ts`:

```ts
import type { ThemeColors } from "@/constants/colors";

// Ribbon bookmark drop length, in px, at 0% and 100% completion.
export const RIBBON_MIN_DROP = 52;
export const RIBBON_MAX_DROP = 176;

/** Ribbon drop length in px, linearly mapped from completion percent (0..100). */
export function ribbonDrop(progress: number): number {
  const p = Math.max(0, Math.min(100, progress)) / 100;
  return RIBBON_MIN_DROP + (RIBBON_MAX_DROP - RIBBON_MIN_DROP) * p;
}

/**
 * Section spine accent color, cycled by list position and resolved from the
 * active theme so it adapts to light/dark.
 */
export function spineColorForIndex(index: number, colors: ThemeColors): string {
  const palette = [
    colors.brandPrimary,
    colors.brandAccent,
    colors.semanticWarning,
    colors.brandPrimaryLight,
    colors.semanticError,
  ];
  const i = ((index % palette.length) + palette.length) % palette.length;
  return palette[i];
}

/** Decorative page-edge thickness (px); grows ~1px/400 words, clamped 6..14. */
export function pageEdgeThickness(wordCount: number): number {
  const t = 6 + Math.floor(Math.max(0, wordCount) / 400);
  return Math.max(6, Math.min(14, t));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add lib/thesis-book.ts
git commit -m "feat(thesis-detail): pure book layout helpers"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `locales/en.json` (inside the existing `"thesis": { ... }` object, ~line 220)
- Modify: `locales/fr.json` (same object)
- Modify: `locales/ar.json` (same object)

- [ ] **Step 1: Add keys to `locales/en.json`**

Inside the `"thesis"` object, add:

```json
    "rename": "Rename",
    "renameTitle": "Rename thesis",
    "renameSave": "Save",
    "renameCancel": "Cancel",
    "export": "Export",
    "delete": "Delete",
    "deleteConfirmTitle": "Delete thesis?",
    "deleteConfirmMessage": "This permanently removes the thesis and its document. This can’t be undone.",
    "menuTitle": "Thesis options",
    "resumeJustBegun": "you’ve just begun",
    "resumeKeepGoing": "keep going",
    "genericError": "Something went wrong. Please try again."
```

- [ ] **Step 2: Add the same keys to `locales/fr.json`**

```json
    "rename": "Renommer",
    "renameTitle": "Renommer la thèse",
    "renameSave": "Enregistrer",
    "renameCancel": "Annuler",
    "export": "Exporter",
    "delete": "Supprimer",
    "deleteConfirmTitle": "Supprimer la thèse ?",
    "deleteConfirmMessage": "Cela supprime définitivement la thèse et son document. Action irréversible.",
    "menuTitle": "Options de la thèse",
    "resumeJustBegun": "vous venez de commencer",
    "resumeKeepGoing": "continuez",
    "genericError": "Une erreur est survenue. Veuillez réessayer."
```

- [ ] **Step 3: Add the same keys to `locales/ar.json`**

```json
    "rename": "إعادة تسمية",
    "renameTitle": "إعادة تسمية المذكرة",
    "renameSave": "حفظ",
    "renameCancel": "إلغاء",
    "export": "تصدير",
    "delete": "حذف",
    "deleteConfirmTitle": "حذف المذكرة؟",
    "deleteConfirmMessage": "سيؤدي هذا إلى حذف المذكرة ومستندها نهائيًا. لا يمكن التراجع عن ذلك.",
    "menuTitle": "خيارات المذكرة",
    "resumeJustBegun": "لقد بدأت للتو",
    "resumeKeepGoing": "واصل التقدم",
    "genericError": "حدث خطأ ما. يرجى المحاولة مرة أخرى."
```

- [ ] **Step 4: Typecheck (JSON well-formed + imports resolve)**

Run: `npx tsc --noEmit`
Expected: exits cleanly. (If a trailing-comma error appears, fix the JSON — ensure the key *before* your block ends with a comma and your block matches the file's existing comma style.)

- [ ] **Step 5: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(thesis-detail): menu, rename, delete, resume keys"
```

---

## Task 3: Cover parallax hook

**Files:**
- Create: `components/thesis/useCoverParallax.ts`

- [ ] **Step 1: Write the hook**

Create `components/thesis/useCoverParallax.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly. (If `DeviceMotion.addListener`'s payload type differs in the installed version, adjust the `data.rotation` access to match the v56 types you read in Task 0 — keep the clamp/spring logic identical.)

- [ ] **Step 3: Commit**

```bash
git add components/thesis/useCoverParallax.ts
git commit -m "feat(thesis-detail): cover parallax hook (entrance/drag/gyro)"
```

---

## Task 4: Book cover component

**Files:**
- Create: `components/thesis/ThesisBookCover.tsx`

- [ ] **Step 1: Write the component**

Create `components/thesis/ThesisBookCover.tsx`:

```tsx
import { View, Text, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { getTextDirection } from "@/lib/text-direction";
import { ribbonDrop, pageEdgeThickness } from "@/lib/thesis-book";
import { useCoverParallax } from "./useCoverParallax";

const RIBBON_COLOR = "#2FCF9E";

/**
 * The animated faux-3D thesis "book". Brand-indigo cover with a bookmark
 * ribbon whose drop length encodes progress. Tilts on drag and phone motion
 * (see useCoverParallax). Title renders in its own script direction.
 */
export function ThesisBookCover({
  title,
  progress,
  wordCount,
  resumeHint,
}: {
  title: string;
  progress: number;
  wordCount: number;
  resumeHint: string;
}) {
  const { animatedStyle, panGesture } = useCoverParallax();
  const isRtl = getTextDirection(title) === "rtl";
  const drop = ribbonDrop(progress);
  const edge = pageEdgeThickness(wordCount);

  return (
    <View style={styles.stage}>
      <View style={styles.floorGlow} />
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.book, animatedStyle]}>
          <View style={[styles.pageEdges, { width: edge }]} />

          <LinearGradient
            colors={["#6675FF", "#3B2F8F"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cover}
          >
            <View style={styles.sheen} />
            <View style={styles.spineShadow} />

            <Text style={styles.kicker}>THESIS</Text>
            <Text
              style={[
                styles.title,
                { textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" },
              ]}
              numberOfLines={4}
            >
              {title}
            </Text>
            <Text style={[styles.hint, { textAlign: isRtl ? "right" : "left" }]} numberOfLines={1}>
              📗 {Math.round(progress)}% · {resumeHint}
            </Text>
          </LinearGradient>

          {/* ribbon (on top of the cover, not clipped) */}
          <View style={[styles.ribbon, { height: drop }]} />
          <View style={[styles.ribbonNotch, { top: drop - 4 }]} />
        </Animated.View>
      </View>
    </View>
  );
}

const COVER_W = 150;
const COVER_H = 208;

const styles = StyleSheet.create({
  stage: { height: 236, alignItems: "center", justifyContent: "center" },
  floorGlow: {
    position: "absolute",
    bottom: 14,
    width: 150,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#5C6BFF",
    opacity: 0.28,
  },
  book: { width: COVER_W, height: COVER_H },
  pageEdges: {
    position: "absolute",
    right: -8,
    top: 6,
    height: COVER_H - 12,
    backgroundColor: "#E9E9F2",
    borderRadius: 1,
  },
  cover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: 5,
    borderTopRightRadius: 11,
    borderBottomRightRadius: 11,
    padding: 16,
    justifyContent: "space-between",
    overflow: "hidden",
    shadowColor: "#5C6BFF",
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  sheen: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  spineShadow: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 10,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  ribbon: {
    position: "absolute",
    top: -4,
    left: 28,
    width: 22,
    backgroundColor: RIBBON_COLOR,
  },
  ribbonNotch: {
    position: "absolute",
    left: 28,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: RIBBON_COLOR,
  },
  kicker: {
    fontSize: 10,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.72)",
    fontFamily: "Inter_600SemiBold",
    alignSelf: "flex-end",
  },
  title: { fontSize: 15, lineHeight: 21, color: "#FFFFFF", fontFamily: "Inter_700Bold" },
  hint: { fontSize: 10, color: "rgba(255,255,255,0.9)", fontFamily: "Inter_500Medium" },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add components/thesis/ThesisBookCover.tsx
git commit -m "feat(thesis-detail): animated book cover"
```

---

## Task 5: Stat strip component

**Files:**
- Create: `components/thesis/ThesisStatStrip.tsx`

- [ ] **Step 1: Write the component**

Create `components/thesis/ThesisStatStrip.tsx`:

```tsx
import { Fragment } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Slim 3-column stat strip (sections · chapters · words). */
export function ThesisStatStrip({
  sections,
  chapters,
  words,
}: {
  sections: number;
  chapters: number;
  words: number;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();

  const items = [
    { value: String(sections), label: t("home.sections") },
    { value: String(chapters), label: t("home.chapters") },
    { value: words.toLocaleString(), label: t("home.words") },
  ];

  return (
    <View style={styles.strip}>
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: colors.borderDefault }]} />}
          <View style={styles.cell}>
            <Text style={[styles.value, { color: colors.textPrimary }]}>{it.value}</Text>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{it.label}</Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  cell: { flex: 1, alignItems: "center", gap: 2 },
  divider: { width: 1, height: 26 },
  value: { fontSize: 17, fontFamily: "Inter_700Bold" },
  label: { fontSize: 10, fontFamily: "Inter_500Medium" },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add components/thesis/ThesisStatStrip.tsx
git commit -m "feat(thesis-detail): slim stat strip"
```

---

## Task 6: Section row component

**Files:**
- Create: `components/thesis/SectionRow.tsx`

- [ ] **Step 1: Write the component**

Create `components/thesis/SectionRow.tsx`:

```tsx
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronLeft, ChevronDown } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection } from "@/lib/text-direction";

export type SectionChapter = { index: number; title: string };

/**
 * One section as a spine-edged card. Tapping a section that has chapters
 * expands it in place to list them; a chapterless section opens the workspace
 * directly. Titles align by their own script.
 */
export function SectionRow({
  ordinal,
  sectionIndex,
  title,
  chapters,
  spineColor,
  onOpenBlock,
}: {
  ordinal: number;
  sectionIndex: number;
  title: string;
  chapters: SectionChapter[];
  spineColor: string;
  onOpenBlock: (blockIndex: number, title: string) => void;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isRtl = getTextDirection(title) === "rtl";
  const hasChapters = chapters.length > 0;

  const onPressHeader = () => {
    if (hasChapters) setExpanded((e) => !e);
    else onOpenBlock(sectionIndex, title);
  };

  const CollapsedChevron = isRtl ? ChevronLeft : ChevronRight;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bgCard,
          borderRightColor: spineColor,
          borderRightWidth: 4,
        },
        expanded && { borderColor: colors.borderDefault, borderWidth: 1, borderRightWidth: 4 },
      ]}
    >
      <Pressable onPress={onPressHeader} style={[styles.header, isRtl && styles.rowReverse]}>
        <View
          style={[
            styles.num,
            { backgroundColor: expanded ? spineColor + "28" : colors.bgSurface },
          ]}
        >
          <Text style={[styles.numText, { color: expanded ? spineColor : colors.textSecondary }]}>
            {ordinal}
          </Text>
        </View>

        <View style={styles.info}>
          <Text
            style={[styles.title, { color: colors.textPrimary, textAlign: isRtl ? "right" : "left" }]}
            numberOfLines={2}
          >
            {title}
          </Text>
          <Text
            style={[styles.meta, { color: colors.textSecondary, textAlign: isRtl ? "right" : "left" }]}
          >
            {chapters.length} {t("home.chapters")}
          </Text>
        </View>

        {hasChapters && expanded ? (
          <ChevronDown size={18} color={spineColor} strokeWidth={2} />
        ) : (
          <CollapsedChevron size={18} color={colors.textPlaceholder} strokeWidth={2} />
        )}
      </Pressable>

      {expanded && (
        <View style={[styles.chapters, { borderTopColor: colors.borderDefault }]}>
          {chapters.map((ch) => {
            const cRtl = getTextDirection(ch.title) === "rtl";
            return (
              <Pressable
                key={ch.index}
                onPress={() => onOpenBlock(ch.index, ch.title)}
                style={[styles.chapterRow, cRtl && styles.rowReverse]}
              >
                <View style={[styles.dot, { backgroundColor: spineColor }]} />
                <Text
                  style={[
                    styles.chapterText,
                    { color: colors.textSecondary, textAlign: cRtl ? "right" : "left" },
                  ]}
                  numberOfLines={1}
                >
                  {ch.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 13, padding: 12, marginBottom: 9 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  rowReverse: { flexDirection: "row-reverse" },
  num: { minWidth: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  info: { flex: 1, gap: 3 },
  title: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  chapters: { marginTop: 11, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  chapterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  chapterText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add components/thesis/SectionRow.tsx
git commit -m "feat(thesis-detail): spine-edged expandable section row"
```

---

## Task 7: Fixed action bar component

**Files:**
- Create: `components/thesis/ThesisActionBar.tsx`

- [ ] **Step 1: Write the component**

Create `components/thesis/ThesisActionBar.tsx`:

```tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { FileText, MessageSquare } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * Fixed bottom action bar: full-width "Open workspace" + an icon-only chat
 * button, over a fade so the section list scrolls out from under it. Render
 * this as a sibling AFTER the ScrollView; it is absolutely positioned.
 */
export function ThesisActionBar({
  onOpenWorkspace,
  onChat,
}: {
  onOpenWorkspace: () => void;
  onChat: () => void;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <LinearGradient
        colors={["transparent", colors.bgPrimary]}
        style={styles.fade}
        pointerEvents="none"
      />
      <View style={[styles.bar, { paddingBottom: (insets.bottom || 16) }]}>
        <Pressable
          onPress={onOpenWorkspace}
          style={[styles.primary, { backgroundColor: colors.brandPrimary }]}
        >
          <FileText size={18} color="#FFFFFF" strokeWidth={2} />
          <Text style={styles.primaryText}>{t("workspace.open", { defaultValue: "Open workspace" })}</Text>
        </Pressable>
        <Pressable
          onPress={onChat}
          style={[styles.iconBtn, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
        >
          <MessageSquare size={20} color={colors.brandPrimary} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, top: -28, height: 28 },
  bar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  primary: {
    flex: 1,
    height: 50,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { color: "#FFFFFF", fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  iconBtn: {
    width: 54,
    height: 50,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

Note: the `wrap` needs a solid backdrop under the buttons so scrolled text doesn't show through the button gap. The `bar` sits on the opaque `colors.bgPrimary` via the parent screen's background; the `fade` softens the top edge. (If any bleed-through is visible on device, give `bar` `backgroundColor: colors.bgPrimary`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly.

- [ ] **Step 3: Commit**

```bash
git add components/thesis/ThesisActionBar.tsx
git commit -m "feat(thesis-detail): fixed bottom action bar"
```

---

## Task 8: Header menu (rename / export / delete)

**Files:**
- Create: `components/thesis/ThesisHeaderMenu.tsx`

- [ ] **Step 1: Write the component**

Create `components/thesis/ThesisHeaderMenu.tsx`:

```tsx
import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { MoreVertical, Pencil, Download, Trash2 } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection } from "@/lib/text-direction";
import { updateThesis, deleteThesis as apiDeleteThesis } from "@/lib/api";
import { useThesisStore } from "@/stores/thesis-store";
import type { Thesis } from "@/types/thesis";

/**
 * The ⋯ header menu. Opens a bottom action sheet with Rename (inline modal),
 * Export (routes to the existing Export screen), and Delete (confirm → API →
 * store cleanup → back). Reuses existing API + store; no new endpoints.
 */
export function ThesisHeaderMenu({
  thesis,
  onRenamed,
}: {
  thesis: Thesis;
  onRenamed: (title: string) => void;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(thesis.title);
  const [busy, setBusy] = useState(false);

  const openRename = () => {
    setMenuOpen(false);
    setName(thesis.title);
    setRenameOpen(true);
  };

  const saveRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === thesis.title) {
      setRenameOpen(false);
      return;
    }
    setBusy(true);
    try {
      await updateThesis(thesis.id, { title: trimmed });
      onRenamed(trimmed);
      setRenameOpen(false);
    } catch {
      Alert.alert(t("thesis.rename"), t("thesis.genericError"));
    }
    setBusy(false);
  };

  const doExport = () => {
    setMenuOpen(false);
    router.push({ pathname: "/(app)/export", params: { thesisId: thesis.id } });
  };

  const doDelete = () => {
    setMenuOpen(false);
    Alert.alert(t("thesis.deleteConfirmTitle"), t("thesis.deleteConfirmMessage"), [
      { text: t("thesis.renameCancel"), style: "cancel" },
      {
        text: t("thesis.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await apiDeleteThesis(thesis.id);
            useThesisStore.getState().deleteThesis(thesis.id);
            router.back();
          } catch {
            Alert.alert(t("thesis.delete"), t("thesis.genericError"));
          }
        },
      },
    ]);
  };

  const nameRtl = getTextDirection(name || thesis.title) === "rtl";

  return (
    <>
      <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.kebab}>
        <MoreVertical size={22} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>

      {/* action sheet */}
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.bgModal }]} onPress={() => {}}>
            <Text style={[styles.sheetTitle, { color: colors.textSecondary }]}>{t("thesis.menuTitle")}</Text>

            <Pressable onPress={openRename} style={styles.item}>
              <Pencil size={19} color={colors.textPrimary} strokeWidth={2} />
              <Text style={[styles.itemText, { color: colors.textPrimary }]}>{t("thesis.rename")}</Text>
            </Pressable>
            <Pressable onPress={doExport} style={styles.item}>
              <Download size={19} color={colors.textPrimary} strokeWidth={2} />
              <Text style={[styles.itemText, { color: colors.textPrimary }]}>{t("thesis.export")}</Text>
            </Pressable>
            <Pressable onPress={doDelete} style={styles.item}>
              <Trash2 size={19} color={colors.semanticError} strokeWidth={2} />
              <Text style={[styles.itemText, { color: colors.semanticError }]}>{t("thesis.delete")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* rename modal */}
      <Modal transparent visible={renameOpen} animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <View style={styles.centerBackdrop}>
          <View style={[styles.dialog, { backgroundColor: colors.bgModal }]}>
            <Text style={[styles.dialogTitle, { color: colors.textPrimary }]}>{t("thesis.renameTitle")}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              autoFocus
              style={[
                styles.input,
                {
                  backgroundColor: colors.bgInput,
                  color: colors.textPrimary,
                  borderColor: colors.borderDefault,
                  textAlign: nameRtl ? "right" : "left",
                  writingDirection: nameRtl ? "rtl" : "ltr",
                },
              ]}
              placeholderTextColor={colors.textPlaceholder}
            />
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setRenameOpen(false)} style={styles.dialogBtn}>
                <Text style={[styles.dialogBtnText, { color: colors.textSecondary }]}>
                  {t("thesis.renameCancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={saveRename}
                disabled={busy}
                style={[styles.dialogBtn, { backgroundColor: colors.brandPrimary }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={[styles.dialogBtnText, { color: "#FFFFFF" }]}>{t("thesis.renameSave")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  kebab: { width: 40, alignItems: "flex-end" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { padding: 16, paddingBottom: 32, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 4 },
  sheetTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginLeft: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
  itemText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  centerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  dialog: { width: "100%", borderRadius: 18, padding: 20, gap: 16 },
  dialogTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_500Medium" },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  dialogBtn: { minWidth: 84, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  dialogBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly. (If `deleteThesis` is not exported from `@/lib/api`, confirm the name — it is defined at `lib/api.ts:362`.)

- [ ] **Step 3: Commit**

```bash
git add components/thesis/ThesisHeaderMenu.tsx
git commit -m "feat(thesis-detail): header menu (rename/export/delete)"
```

---

## Task 9: Compose the screen

**Files:**
- Modify: `app/(app)/thesis-detail.tsx` (full render + styles rewrite; keep data logic)

- [ ] **Step 1: Replace the file**

Overwrite `app/(app)/thesis-detail.tsx` with:

```tsx
import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getThesis, getThesisOutline, type OutlineDTO } from "@/lib/api";
import { spineColorForIndex } from "@/lib/thesis-book";
import { BackButton } from "@/components/BackButton";
import { ThesisBookCover } from "@/components/thesis/ThesisBookCover";
import { ThesisStatStrip } from "@/components/thesis/ThesisStatStrip";
import { SectionRow } from "@/components/thesis/SectionRow";
import { ThesisActionBar } from "@/components/thesis/ThesisActionBar";
import { ThesisHeaderMenu } from "@/components/thesis/ThesisHeaderMenu";
import type { Thesis, ThesisStatus } from "@/types/thesis";

// getThesis() returns the thesis row (no structure — that lives in the .docx).
function normalize(raw: any): Thesis {
  return {
    id: raw.id,
    title: raw.title,
    templateId: raw.templateId ?? undefined,
    language: raw.language ?? "fr",
    status: (raw.status ?? "active") as ThesisStatus,
    progress: raw.progress ?? 0,
    wordCount: raw.wordCount ?? 0,
    pageCount: raw.pageCount ?? 0,
    frontMatter: raw.frontMatter ?? undefined,
    resume: raw.resume ?? undefined,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

export default function ThesisDetailScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [outline, setOutline] = useState<OutlineDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (!thesisId) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        try {
          const [data, outlineData] = await Promise.all([
            getThesis(thesisId),
            getThesisOutline(thesisId).catch(() => null),
          ]);
          if (!active) return;
          const normalized = normalize(data);
          setThesis(normalized);
          setOutline(outlineData);
          useThesisStore.setState((state) => ({
            theses: [normalized, ...state.theses.filter((th) => th.id !== normalized.id)],
          }));
        } catch {
          if (active) setNotFound(true);
        }
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [thesisId])
  );

  const openChat = () => {
    if (!thesis) return;
    useThesisStore.getState().setCurrentThesis(thesis.id);
    router.push("/(tabs)/chat" as any);
  };

  const openWorkspace = () => {
    if (!thesis) return;
    useThesisStore.getState().setCurrentThesis(thesis.id);
    router.push({ pathname: "/(app)/thesis-workspace", params: { thesisId: thesis.id } });
  };

  // Navigate the live-docx workspace to a specific engine block (section heading
  // or chapter). `blockIndex` comes from the outline.
  const openBlock = (blockIndex: number, title: string) => {
    if (!thesis) return;
    useThesisStore.getState().setCurrentThesis(thesis.id);
    useWorkspaceStore.getState().selectBlock(blockIndex, title ?? "");
    router.push({
      pathname: "/(app)/thesis-workspace",
      params: { thesisId: thesis.id, blockIndex: String(blockIndex) },
    });
  };

  const onRenamed = (title: string) => {
    setThesis((prev) => (prev ? { ...prev, title } : prev));
    useThesisStore.getState().upsertThesis({ ...(thesis as Thesis), title });
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]}>{t("thesis.thesisDetails")}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !thesis) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]}>{t("thesis.thesisDetails")}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>{t("thesis.noThesesFound")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const liveOutline = outline?.available ? outline : null;
  const outlineSections = liveOutline
    ? liveOutline.sections.map((s) => ({ index: s.index, title: s.title, chapters: s.chapters }))
    : [];

  const sectionCount = liveOutline ? liveOutline.sectionCount : 0;
  const chapterCount = liveOutline ? liveOutline.chapterCount : 0;
  const wordCount = liveOutline ? liveOutline.wordCount : thesis.wordCount || 0;
  const progress = Math.max(0, Math.min(100, Math.round(thesis.progress || 0)));
  const resumeHint = progress > 0 ? t("thesis.resumeKeepGoing") : t("thesis.resumeJustBegun");

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.topBar}>
          <BackButton />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {t("thesis.thesisDetails")}
          </Text>
          <ThesisHeaderMenu thesis={thesis} onRenamed={onRenamed} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThesisBookCover
            title={thesis.title}
            progress={progress}
            wordCount={wordCount}
            resumeHint={resumeHint}
          />

          <ThesisStatStrip sections={sectionCount} chapters={chapterCount} words={wordCount} />

          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            {t("home.sections")} ({sectionCount})
          </Text>

          {sectionCount === 0 ? (
            <View style={[styles.emptyChapters, { backgroundColor: colors.bgSurface }]}>
              <Text style={[styles.emptyChaptersText, { color: colors.textSecondary }]}>
                {t("thesis.noChapters")}
              </Text>
            </View>
          ) : (
            outlineSections.map((sec, i) => (
              <SectionRow
                key={`${sec.index}-${i}`}
                ordinal={i + 1}
                sectionIndex={sec.index}
                title={sec.title}
                chapters={sec.chapters}
                spineColor={spineColorForIndex(i, colors)}
                onOpenBlock={openBlock}
              />
            ))
          )}
        </ScrollView>

        <ThesisActionBar onOpenWorkspace={openWorkspace} onChat={openChat} />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  topTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { padding: 20, gap: 18, paddingBottom: 120 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyChapters: { borderRadius: 12, padding: 24, alignItems: "center" },
  emptyChaptersText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits cleanly. (If `selectBlock` has a different signature in `stores/workspace-store.ts`, match it — it was `selectBlock(blockIndex, title)` at the time of writing.)

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/thesis-detail.tsx"
git commit -m "feat(thesis-detail): compose book-hero screen"
```

---

## Task 10: Live verification on device/simulator

**Files:** none (verification + any fix-up commits)

- [ ] **Step 1: Launch the app**

Use the `run` skill (or `npm run ios` / `npm run android`). Open a thesis (ideally the Arabic one, e.g. "مذكرة بوصبيع قويدر") from the home list → Thesis Details.

- [ ] **Step 2: Walk the checklist**

Confirm each:
- Book cover renders with the indigo gradient, "THESIS" kicker, RTL title, page edges, floor glow.
- **Ribbon length** reflects progress (short at 0%). If you have a thesis with >0% progress, its ribbon is visibly longer.
- **Entrance**: the book springs in on screen open.
- **Drag**: dragging on the book tilts it a few degrees and it springs back on release.
- **Gyro**: tilting the physical device leans the cover slightly (simulator: may be flat — verify on a real device; this is expected).
- **Reduce Motion** ON (device accessibility settings): cover is static, no gyro/drag/entrance, and nothing crashes.
- Stat strip shows sections/chapters/words with dividers.
- Section rows show a colored spine edge; colors cycle down the list.
- Tapping a section **with chapters** expands it and lists chapters; the chevron flips; tapping a chapter opens the workspace at that block. A **chapterless** section opens the workspace directly.
- RTL: Arabic titles right-align; rows flip (number on the trailing/right side, chevron on the left).
- **Fixed bar** stays pinned while the list scrolls; last section isn't hidden behind it; "Open workspace" and the chat icon both navigate.
- **⋯ menu**: Rename opens the modal, saves, and the header title + book title update immediately. Export routes to the Export screen. Delete confirms, then returns to the previous screen and the thesis is gone from the list.

- [ ] **Step 3: Fix anything that failed, then re-verify and commit**

For each miss, make the minimal fix, re-run `npx tsc --noEmit`, re-check that item, then:

```bash
git add -A
git commit -m "fix(thesis-detail): <what you fixed>"
```

- [ ] **Step 4: Clean up the superseded earlier edit (if still present)**

The pre-redesign RTL tweak to the old `thesis-detail.tsx` render is fully replaced by Task 9. Confirm the working tree is clean (`git status`) and that no stray `rowReverse`/`titleIsRtl` remnants from the old render remain in the file.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Ribbon book hero + progress ribbon → Tasks 1, 3, 4. ✓
- Animated faux-3D + gyro parallax + reduce-motion → Task 3. ✓
- Always brand-indigo cover → Task 4 (fixed gradient). ✓
- Slim stat strip → Task 5. ✓
- Spine-edged expandable sections + chapter jump → Tasks 1 (`spineColorForIndex`), 6, 9 (`openBlock`). ✓
- Fixed glass action bar, icon-only chat → Task 7. ✓
- `⋯` menu: rename/export/delete → Task 8; wired in Task 9. ✓
- RTL from content → Tasks 4, 6, 8 (all use `getTextDirection`). ✓
- No backend changes; reuse existing Export screen → Task 8. ✓
- New dep note: spec said "expo-sensors only"; this plan also adds **expo-linear-gradient** (Task 0) — a light first-party Expo module needed for the cover gradient + fade, consistent with the "no WebGL/Three.js" intent. Documented deviation.
- Expo v56 doc verification → Task 0. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**Type consistency:** `openBlock(blockIndex:number, title:string)` used identically in Task 6 (`onOpenBlock`) and Task 9. `SectionChapter {index,title}` matches `OutlineSectionDTO.chapters` (`{index,title}`). `spineColorForIndex(index, colors)` signature consistent across Tasks 1/9. `ThesisBookCover` props (`title,progress,wordCount,resumeHint`) match the Task 9 call site. `deleteThesis` imported as `apiDeleteThesis` to avoid colliding with the store action of the same name. ✓
