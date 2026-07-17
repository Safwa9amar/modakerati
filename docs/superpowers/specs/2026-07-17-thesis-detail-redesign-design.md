# Thesis Details — Redesign (Book Hero) — Design Spec

**Date:** 2026-07-17
**Screen:** `app/(app)/thesis-detail.tsx`
**Status:** Approved for planning

## 1. Goal

Redesign the Thesis Details screen to feel more premium, be better structured,
and make the section list genuinely useful — while treating the thesis as a
tangible **book** the user is building. Content is predominantly Arabic (RTL),
dark theme first.

Three user-stated goals, in priority order:
1. More premium / polished feel.
2. Better structure & clarity.
3. Make sections more useful.

## 2. Current state (what we're replacing)

`app/(app)/thesis-detail.tsx` today renders, top → bottom:
- Top bar: back + centered "Thesis Details".
- Hero: flat document icon, title, status badge + progress %, thin progress bar.
- Three heavy stat tiles (sections / chapters / words).
- "Open workspace" (primary) and "Continue in Chat" (secondary) buttons, inline.
- Flat sections list: number chip + title + "N chapters" + chevron.

Data already wired (keep as-is):
- `getThesis(id)` → thesis row: `title, status, progress, wordCount`.
- `getThesisOutline(id)` → `{ available, sectionCount, chapterCount, wordCount,
  sections[] }` where each section is `{ index, title, chapters: [{ index, title }] }`.
  `index` is the engine block index used to navigate the workspace to that block.
- RTL is already resolved per-content via `getTextDirection()` from
  `lib/text-direction.ts` (do NOT use `thesis.language`; it defaults to "fr").

No backend changes are required. All three menu actions already exist:
`updateThesis(id, updates)`, `deleteThesis(id)`, and the full Export screen at
`app/(app)/export.tsx` (routed with `{ thesisId }`).

## 3. Locked decisions

| Decision | Choice |
| --- | --- |
| Overall layout | Book hero + slim stat strip + spine-edged expandable sections + fixed bottom bar |
| Book cover color | Always brand indigo (`brandPrimary` → deep violet gradient) |
| Book fidelity | Animated faux-3D (Reanimated) **+ gyroscope parallax** (adds `expo-sensors`). No WebGL/Three.js. |
| Progress display | Green bookmark ribbon whose **drop length = progress** |
| `⋯` header menu | Build now: **Rename**, **Export**, **Delete** |
| Chat action | Icon-only square, in the fixed bottom bar |
| Actions placement | **Fixed** glass bottom bar (list scrolls underneath) |

## 4. Layout

```
┌───────────────────────────────┐
│ ‹        Thesis Details     ⋯ │   header
│                               │
│          [ 3D BOOK ]          │   animated book hero
│      ribbon = progress        │   (tilt + drag + gyro parallax)
│                               │
│    9   |   29   |   3,893     │   slim stat strip (sections/chapters/words)
│  sections chapters  words     │
│                               │
│  Sections (9)                 │
│ ▏1  شكر وتقدير           › ▕   │   spine-edged rows
│ ▏2  قائمة المحتويات      ⌄ ▕   │   expanded → chapters listed inline
│      • مقدمة عامة              │
│      • الإطار النظري           │
│ ▏3  قائمة الأشكال        › ▕   │
│              ⋮ (scrolls)      │
├───────────────────────────────┤
│ [ 📖 Open workspace ]   [ 💬 ] │   FIXED glass action bar
└───────────────────────────────┘
```

## 5. Components

The screen is getting rich; split it into focused components under
`components/thesis/`. The screen file keeps data-loading orchestration only.

### 5.1 `ThesisBookCover`
Props: `{ title: string; progress: number; wordCount: number }`.
Responsibilities:
- Render the brand-indigo cover: gradient, spine shadow, sheen highlight,
  page-edge stack on the trailing side, soft floor glow, "THESIS" label, RTL
  title (via `getTextDirection(title)`), and a small "N% · <resume hint>" line.
- **Ribbon = progress**: a green bookmark anchored at the top of the cover.
  Its drop length interpolates progress: `drop = lerp(progress/100, MIN, MAX)`
  (e.g. `MIN ≈ 52px` visible peek at 0%, `MAX ≈ 176px` near-full at 100%),
  with the forked/notched triangle at the ribbon's bottom edge.
- **Page-edge thickness** subtly hints at `wordCount` (clamped range), purely
  decorative.
- **Motion** (owns all of it, isolated here):
  - Entrance: springy scale/opacity/tilt settle on mount (Reanimated).
  - Drag-to-tilt: a Pan gesture (react-native-gesture-handler) drives
    `rotateX/rotateY` shared values (clamped ~±10°), springs back on release.
  - Gyroscope parallax: `expo-sensors` `DeviceMotion` drives a resting
    `rotateX/rotateY` offset (clamped ~±8°), smoothed via spring.
  - Respect Reduce Motion: if `AccessibilityInfo.isReduceMotionEnabled()`,
    disable gyro + drag + entrance and render a static tilt.
  - Pause/unsubscribe the sensor on screen blur and on unmount (see §8).

### 5.2 `ThesisStatStrip`
Props: `{ sections: number; chapters: number; words: number }`.
Slim 3-column strip with hairline dividers (replaces the 3 heavy tiles). Labels
are UI chrome (localized via i18n), values are numbers.

### 5.3 `SectionRow`
Props: `{ index: number; ordinal: number; title: string; chapters: {index:number;title:string}[]; spineColor: string; onOpenBlock: (blockIndex:number, title:string)=>void }`.
- Row: `row-reverse` when the title is RTL; ordinal chip on the trailing side,
  RTL title, "N chapters" meta, chevron. A **spine edge** (colored trailing
  border) tints the row.
- Owns its own `expanded` state. Collapsed → chevron points inward; expanded →
  chevron rotates and the chapter list renders inline (small leading dot +
  RTL chapter title). Tapping the row header toggles expand **only if it has
  chapters**; a chapterless section navigates straight into the workspace.
- Tapping a chapter calls `onOpenBlock(chapter.index, chapter.title)`.
- **Spine palette** cycles by section ordinal over theme color keys:
  `[brandPrimary, brandAccent, semanticWarning, brandPrimaryLight, semanticError]`
  (resolved through `useThemeColors`, so it adapts light/dark).

### 5.4 `ThesisActionBar`
Props: `{ onOpenWorkspace: ()=>void; onChat: ()=>void }`.
Absolutely-positioned, pinned to the bottom over a `bgPrimary` → transparent
fade with a hairline top border. Full-width primary "Open workspace" + a
compact icon-only chat square. The `ScrollView` gets bottom padding equal to the
bar height so the last section isn't obscured.

### 5.5 `ThesisHeaderMenu`
Props: `{ thesis: Thesis; onRenamed:(title:string)=>void }`.
The `⋯` button opens a lightweight action list (bottom-sheet or anchored popover,
following existing app patterns; see the gorhom BottomSheet mount rule in project
memory if a sheet is used). Actions:
- **Rename** → small modal with a `TextInput` prefilled with the title; on save,
  `updateThesis(id, { title })`, update local state + store, re-derive RTL.
- **Export** → `router.push({ pathname: "/(app)/export", params: { thesisId } })`
  (reuses the existing Export screen — no new export UI).
- **Delete** → `Alert.alert` confirm (matches existing confirm pattern in the
  app); on confirm, `deleteThesis(id)`, remove from `useThesisStore`, `router.back()`.

## 6. RTL

- Book title, section titles, and chapter titles: per-content via
  `getTextDirection(text)` → `textAlign` + `row-reverse` where a row wraps a
  title (the established `FileCard` pattern). Never `useRTL()`/`I18nManager` for
  document content.
- Header label, stat labels, and menu labels are UI chrome — they follow the app
  locale, unchanged.

## 7. Data flow

No new endpoints. On focus (existing `useFocusEffect`): fetch `getThesis` +
`getThesisOutline` in parallel, mirror the normalized thesis into
`useThesisStore`. Derive:
- `progress` (clamped 0–100) → ribbon drop.
- `sectionCount/chapterCount/wordCount` → stat strip (fall back to the thesis row
  `wordCount` when the outline is unavailable).
- `sections[]` → `SectionRow`s; `chapters[]` → inline chapter lists.
Unseeded theses (outline unavailable) keep the empty-state row.

## 8. New dependency & Expo v56 verification

- Add **`expo-sensors`** (gyroscope/device-motion) only. `react-native-reanimated`
  (4.3.1) and `react-native-gesture-handler` are already present (gesture-handler
  ships with expo-router/react-navigation — verify before use).
- **Per repo mandate (AGENTS.md):** before writing any code, read the Expo v56
  docs for `expo-sensors`, `Reanimated` gesture/worklet APIs, and confirm New
  Architecture compatibility.
- Sensor lifecycle: set a modest update interval (~30–60 Hz), and
  `remove()` the subscription on screen blur (`useFocusEffect` cleanup) and
  unmount so it never runs in the background. All rotation math runs on the UI
  thread via Reanimated shared values.

## 9. Performance

- Faux-3D only — no GL surface. The book is a handful of `Animated.View`s with
  `transform`.
- Gyro updates drive shared values directly; no React re-renders per frame.
- Reduce Motion disables the sensor entirely.
- Spine palette + ribbon geometry are pure functions (memoized), no per-frame allocation.

## 10. Testing / verification

- Unit-test pure helpers: `ribbonDrop(progress) → px` (0 and 100 hit MIN/MAX,
  monotonic), `spineColorForIndex(i)` (cycles, stable). `getTextDirection` is
  already covered.
- Drive the real screen via the run/verify flow: book entrance + drag tilt + gyro
  lean, ribbon length reflects progress, section expand/collapse + chapter jump,
  fixed bar stays put while the list scrolls, RTL correctness with the Arabic
  thesis, and the `⋯` rename/export/delete flows.

## 11. Out of scope (YAGNI)

- No per-section progress/word data (the outline doesn't provide it) — sections
  show chapter counts only.
- No Three.js / WebGL / page-flip animation.
- No cover art beyond the indigo gradient + typeset title (no discipline tinting).
- No new export UI — reuse the existing Export screen.

## 12. Tuning knobs (easy to change later)

- Ribbon `MIN`/`MAX` drop and color.
- Drag/gyro tilt clamps.
- Spine palette and whether spines are colorful or monochrome.
- Resume-hint copy on the cover.
