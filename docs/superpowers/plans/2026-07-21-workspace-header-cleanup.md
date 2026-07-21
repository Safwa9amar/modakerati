# Workspace Header Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fake-stats status strip and the idle bottom Ask-AI bar, and make the workspace header auto-hide on scroll down / reappear on scroll up.

**Architecture:** Three independent deletions/additions in the Expo app only (no server changes). (1) The status strip row and its two components die; `countWords` moves to `lib/word-count.ts` because the milestone toasts still need it. (2) Both `IdleAIBar` fallback branches in `BlockComposer` die and the GlobalDockBar ✦ re-arms the floating bubble instead of opening the deleted bar. (3) The header row wraps in a clipped `Animated.View` whose height/translate is driven by a Reanimated scroll handler passed into `OutlineReorderable` (react-native-reorderable-list composes user `onScroll` with its internal handler via `useComposedEventHandler` — verified in `node_modules/react-native-reorderable-list/src/components/ReorderableListCore.tsx:1113`).

**Tech Stack:** React Native (Expo v56 — read https://docs.expo.dev/versions/v56.0.0/ before deviating), Reanimated 3, react-native-reorderable-list 0.18, zustand, i18n en/fr/ar.

**Spec:** `docs/superpowers/specs/2026-07-21-workspace-header-cleanup-design.md`

**Verification note:** This repo has NO JS test runner (do not add jest). Every task gates on `npx tsc --noEmit` + the final on-device QA list. Commit with exact paths only (`git add <paths>`) — the user runs parallel sessions on this tree; never `git add -A`, never `--amend`.

---

### Task 1: Remove the status strip (DocProgress + SyncStatusChip)

**Files:**
- Create: `lib/word-count.ts`
- Modify: `app/(app)/thesis-workspace.tsx`
- Delete: `components/workspace/DocProgress.tsx`, `components/workspace/SyncStatusChip.tsx`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Confirm the two components have no other consumers**

Run: `grep -rn "DocProgress\|SyncStatusChip" app components lib --include="*.tsx" --include="*.ts" | grep -v "components/workspace/DocProgress.tsx" | grep -v "components/workspace/SyncStatusChip.tsx"`

Expected: ONLY lines from `app/(app)/thesis-workspace.tsx` (the two imports at lines ~42-44 and the strip JSX ~598-601, plus the `countWords` usage). If anything else appears, STOP and report.

- [ ] **Step 2: Create `lib/word-count.ts`**

```ts
import type { DocBlockDTO } from "@/lib/api";

// A "word" = a maximal run of non-whitespace. Whitespace-splitting counts Latin
// and Arabic prose alike (both are space-delimited); only paragraph blocks carry
// running text, so tables/figures/structural blocks are skipped.
export function countWords(blocks: DocBlockDTO[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind !== "paragraph") continue;
    const t = b.text.trim();
    if (!t) continue;
    n += t.split(/\s+/).length;
  }
  return n;
}
```

- [ ] **Step 3: Rewire `thesis-workspace.tsx`**

In `app/(app)/thesis-workspace.tsx`:

3a. Replace the import
```tsx
import { SyncStatusChip } from "@/components/workspace/SyncStatusChip";
```
and
```tsx
import { DocProgress, countWords } from "@/components/workspace/DocProgress";
```
with the single line
```tsx
import { countWords } from "@/lib/word-count";
```
(delete the SyncStatusChip import entirely).

3b. Delete the strip JSX (currently right after the top bar's closing `</View>`):
```tsx
      {/* Status strip: live doc progress (left) + per-thesis sync state (right).
          Thin, themed, live-docs only. Sits above the preview toolbar. */}
      {liveDoc && (
        <View style={[styles.statusStrip, { borderBottomColor: colors.borderDefault }]}>
          <DocProgress blocks={liveDoc.blocks} />
          <SyncStatusChip thesisId={thesisId} />
        </View>
      )}
```
Nothing replaces it — the `PreviewBar` line below it stays.

3c. Delete the now-unused style from the StyleSheet at the bottom (including its comment):
```tsx
  // Thin status strip under the top bar: progress on the leading edge, sync chip
  // on the trailing edge (space-between mirrors correctly under an RTL app UI).
  statusStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
```

- [ ] **Step 4: Delete the component files**

Run: `rm components/workspace/DocProgress.tsx components/workspace/SyncStatusChip.tsx`

- [ ] **Step 5: Remove dead i18n keys (en/fr/ar)**

The milestone key `workspace.milestoneWords` STAYS. Delete exactly these five `workspace.*` keys per file (they sit together near `pdfUnavailable`):

`locales/en.json`:
```json
    "syncSaved": "Saved ✓",
    "syncSyncing": "Syncing…",
    "syncOffline": "Offline · saved locally",
    "syncLocal": "Saved on device",
    "progressSummary": "{{words}} words · {{pages}} pages · {{sections}} sections",
```

`locales/fr.json`:
```json
    "syncSaved": "Enregistré ✓",
    "syncSyncing": "Synchronisation…",
    "syncOffline": "Hors ligne · enregistré localement",
    "syncLocal": "Enregistré sur l'appareil",
    "progressSummary": "{{words}} mots · {{pages}} pages · {{sections}} sections",
```

`locales/ar.json`:
```json
    "syncSaved": "تم الحفظ ✓",
    "syncSyncing": "جارٍ المزامنة…",
    "syncOffline": "غير متصل · محفوظ محليًا",
    "syncLocal": "محفوظ على الجهاز",
    "progressSummary": "{{words}} كلمة · {{pages}} صفحة · {{sections}} قسم",
```

Watch trailing commas: if the deleted block ends a JSON object, fix the preceding line's comma. Validate: `python3 -c "import json;[json.load(open(f'locales/{l}.json')) for l in ('en','fr','ar')];print('ok')"` → `ok`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (exit 0). A leftover `DocProgress`/`SyncStatusChip` reference fails here.

- [ ] **Step 7: Commit**

```bash
git add lib/word-count.ts "app/(app)/thesis-workspace.tsx" components/workspace/DocProgress.tsx components/workspace/SyncStatusChip.tsx locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(workspace): remove fake-stats status strip (words/pages/sections + sync chip)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Remove the idle Ask-AI bar (bubble-only AI)

**Files:**
- Modify: `components/workspace/BlockComposer.tsx`
- Modify: `components/workspace/GlobalDockBar.tsx` (the `askAi` handler, ~line 215)
- Delete: `components/workspace/IdleAIBar.tsx`

Do NOT touch i18n keys here: `workspace.askPlaceholder` and `composer.status.ready` are still used by `components/workspace/WorkspaceComposerSheet.tsx` (the user's uncommitted WIP). Do NOT touch `WorkspaceComposerSheet.tsx` at all.

- [ ] **Step 1: Confirm IdleAIBar's only consumer is BlockComposer**

Run: `grep -rn "IdleAIBar" app components --include="*.tsx" | grep -v "components/workspace/IdleAIBar.tsx"`
Expected: only `components/workspace/BlockComposer.tsx` lines (the import + two JSX usages). Otherwise STOP and report.

- [ ] **Step 2: Delete the two IdleAIBar branches in `BlockComposer.tsx`**

Remove the entire `else if (!pillAlive && count === 0) { … }` branch (the whole-memoir `<IdleAIBar …/>` assignment, ~lines 326-357) and the entire `else if (!pillAlive && askAiOpen) { … }` branch (the block-scoped `<IdleAIBar …/>` assignment, ~lines 358-394), so the chain reads:

```tsx
  let surface: React.ReactNode = null;
  if (pendingConfirm) {
    surface = (
      <Dock colors={colors} insets={insets} keyboardVisible={keyboardVisible}>
        <ComposerConfirm confirm={pendingConfirm} onApprove={handleApprove} onCancel={handleDecline} rtl={rtl} />
      </Dock>
    );
  } else if (pendingAsk) {
    surface = (
      <Dock colors={colors} insets={insets} keyboardVisible={keyboardVisible}>
        <ComposerAsk ask={pendingAsk} onAnswer={handleAnswer} onDismiss={handleDismissAsk} rtl={rtl} onInputFocus={markInputFocused} onInputBlur={markInputBlurred} />
      </Dock>
    );
  } else if (blockKeyboardOpen) {
    surface = <GlobalDockBar thesisId={thesisId} blocks={blocks} />;
  }
```
(keep the existing comment above the `blockKeyboardOpen` branch about the GLOBAL keyboard-docked toolbar; delete the comments describing the removed fallback branches).

- [ ] **Step 3: Remove everything that just became unused in `BlockComposer.tsx`**

Delete each of these (typecheck in Step 6 catches stragglers):

- Imports: `IdleAIBar` (from `./IdleAIBar`), `FileText, SquarePen` (lucide), `useComposerSuggestions` (from `@/hooks/useComposerSuggestions`), `useSuggestionStore`, `useFloatingPillStore`, `Alert` and `Keyboard` ONLY IF unused after the deletions below (the keyboard-hide listener still uses `Keyboard` and `useFloatingPillStore` via `getState` — KEEP both of those; `Alert` becomes unused → remove it), `deriveThinkingMs` (from `@/lib/thinking`).
- Selectors/state: `pillAlive` (line ~70), `generatingPhase`, `thinking`, `thinkingMs` (the two big selectors, lines ~79-106), `askAiOpen` (line ~65), `const [inputText, setInputText] = useState("")`.
- Memos: `paragraphSelection`, `imageSelection` (only `handleSend` used them). KEEP `ordered`, `indices`, `count`, `combinedSelection` (used by `focusOpts`/`handleAnswer`).
- Functions: `handleSend`, and the `blockScopeLabel` computation.
- Effects: the "Deselecting drops the Ask-AI panel back to nothing" effect (`if (count === 0 && askAiOpen) …`, ~lines 191-194) — nothing sets `askAiOpen` after this task (Step 5), so it's dead. KEEP the keyboard-hide listener effect untouched (it reads `ws.askAiOpen`/`fp.visible` via `getState()`, which still compile — the store fields remain).
- `useComposerSuggestions` call (`const { suggestions } = …`, ~lines 224-228).
- Update `hasSurface` (~line 204) to:
```tsx
  const blockKeyboardOpen = keyboardVisible && (inlineEditing || composerInputFocused);
  const hasSurface = !!pendingConfirm || !!pendingAsk || blockKeyboardOpen;
```
- Update the component doc comment (lines ~34-52): delete the two fallback bullets and state the new rule, e.g.:
```tsx
/**
 * The context-aware action zone that replaces the old always-present composer
 * sheet. Its shape follows selection + keyboard state:
 *   • pending confirm / ask → the AI's gate surface (docked).
 *   • a block selected, keyboard UP → the GLOBAL keyboard-docked toolbar
 *     (GlobalDockBar): undo/redo, outline, prev/next block, page break/setup,
 *     thesis-ready + the pinned ✦ Ask AI.
 *   • otherwise → nothing docks here. The floating ✦ bubble (FloatingPill/AIDock)
 *     is the ONLY idle AI surface — there is no bottom fallback bar anymore; if
 *     the bubble was drag-to-X dismissed, the dock's ✦ re-arms it (GlobalDockBar).
 * Positioned absolutely at the container bottom; the parent's KeyboardAvoidingView
 * lifts it above the keyboard, so its own detent/docking math isn't needed.
 */
```

- [ ] **Step 4: Delete `components/workspace/IdleAIBar.tsx`**

Run: `rm components/workspace/IdleAIBar.tsx`

- [ ] **Step 5: GlobalDockBar ✦ re-arms the bubble instead of opening the deleted bar**

In `components/workspace/GlobalDockBar.tsx` replace the `askAi` handler (~line 215):

```tsx
  const askAi = () => {
    if (useFloatingPillStore.getState().visible) {
      useFloatingPillStore.getState().setExpanded(true);
      useFloatingPillStore.getState().setInputOpen(true);
    } else {
      useWorkspaceStore.getState().setAskAiOpen(true);
    }
  };
```
with:
```tsx
  const askAi = () => {
    // The bubble is the ONLY AI surface now (the bottom fallback bar is gone):
    // if it was drag-to-X dismissed, re-arm it and open its inline input.
    const fp = useFloatingPillStore.getState();
    fp.show();
    fp.setExpanded(true);
    fp.setInputOpen(true);
  };
```
Then check whether `useWorkspaceStore` is still imported/used elsewhere in the file (it is — `selectedBlocks`, `navigate`, etc. keep it).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. Unused-import errors point at Step 3 leftovers.

- [ ] **Step 7: Confirm nothing else sets `askAiOpen(true)`**

Run: `grep -rn "setAskAiOpen(true)" app components --include="*.tsx"`
Expected: no output (the WorkspaceComposerSheet WIP is allowed to appear if the user's tree has it — report if so, don't edit).

- [ ] **Step 8: Commit**

```bash
git add components/workspace/BlockComposer.tsx components/workspace/GlobalDockBar.tsx components/workspace/IdleAIBar.tsx
git commit -m "feat(workspace): remove idle Ask-AI bar — the floating bubble is the only AI entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Auto-hiding header

**Files:**
- Modify: `app/(app)/thesis-workspace.tsx`
- Modify: `components/workspace/OutlineReorderable.tsx`

Behavior (spec §3): hide after >30px accumulated downward scroll while offset >64px; show on ≥12px upward scroll or offset <48px; ignore bounce (y<0); always shown in Word/PDF previews; 260ms cubic-bezier(0.4,0,0.2,1); safe-area spacer stays (paper never rides under the status bar).

- [ ] **Step 1: Add the scroll passthrough to `OutlineReorderable`**

In `components/workspace/OutlineReorderable.tsx`:

1a. Extend the RN type import (line 2):
```tsx
import { View, StyleSheet, type FlatList, type ScrollViewProps, type ViewToken } from "react-native";
```

1b. Add to `OutlineReorderableInner`'s props (both the destructure and the inline type):
```tsx
  // Scroll passthrough for the workspace's auto-hiding header. Safe to pass a
  // Reanimated handler: react-native-reorderable-list composes it with its own
  // internal scroll worklet (useComposedEventHandler in ReorderableListCore).
  onScroll?: ScrollViewProps["onScroll"];
```

1c. Forward it on the `<ReorderableList …>` element (next to `showsVerticalScrollIndicator`):
```tsx
      onScroll={onScroll}
      scrollEventThrottle={16}
```

- [ ] **Step 2: Build the header animation in `thesis-workspace.tsx`**

2a. Extend the Reanimated import (line 14):
```tsx
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withTiming,
  interpolate,
  Easing,
} from "react-native-reanimated";
```
Also add `type ScrollViewProps` to the `react-native` import list if the Step 4 cast needs it.

2b. Add module-scope constants next to `WORD_MILESTONES`:
```tsx
// Auto-hiding header motion (spec: docs/superpowers/specs/2026-07-21-workspace-header-cleanup-design.md §3).
const HEADER_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const HEADER_HIDE_MS = 260;
// Scroll thresholds: hide after this much accumulated downward travel…
const HEADER_HIDE_AFTER = 30;
// …but only once the offset is past the top zone; any offset below SHOW_NEAR_TOP pins it shown.
const HEADER_MIN_OFFSET = 64;
const HEADER_SHOW_NEAR_TOP = 48;
// A single upward gesture of at least this much brings it back.
const HEADER_SHOW_UP = 12;
```

2c. Inside the component (near the `composerInset` shared value), add:
```tsx
  // ── Auto-hiding header ──
  // The header row collapses (height + slide + fade, one clipped Animated.View)
  // while the user scrolls DOWN the Writer, and returns on any real upward
  // scroll or near the top. Driven entirely on the UI thread: the Writer list's
  // scroll worklet writes these shared values; JS only forces "shown" on
  // preview switches. The safe-area spacer above it is static, so the paper
  // never slides under the status bar.
  const headerRowH = useSharedValue(0); // natural row height, measured onLayout
  const headerShown = useSharedValue(1); // animated 0..1
  const headerTarget = useSharedValue(1); // last commanded target (dedupe)
  const headerLastY = useSharedValue(0);
  const headerDownAccum = useSharedValue(0);

  const onWriterScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      if (y < 0) return; // iOS rubber-band — never react to bounce
      const dy = y - headerLastY.value;
      headerLastY.value = y;
      let target = headerTarget.value;
      if (y < HEADER_SHOW_NEAR_TOP) {
        target = 1;
        headerDownAccum.value = 0;
      } else if (dy > 0 && y > HEADER_MIN_OFFSET) {
        headerDownAccum.value += dy;
        if (headerDownAccum.value > HEADER_HIDE_AFTER) target = 0;
      } else if (dy < -HEADER_SHOW_UP) {
        headerDownAccum.value = 0;
        target = 1;
      }
      if (target !== headerTarget.value) {
        headerTarget.value = target;
        headerShown.value = withTiming(target, { duration: HEADER_HIDE_MS, easing: HEADER_EASING });
      }
    },
  });

  // Leaving the Writer (Word/PDF preview) → header always visible; their scroll
  // lives inside WebViews (out of scope v1). Also resets when the thesis changes.
  useEffect(() => {
    if (previewMode !== null) {
      headerTarget.value = 1;
      headerDownAccum.value = 0;
      headerShown.value = withTiming(1, { duration: HEADER_HIDE_MS, easing: HEADER_EASING });
    }
    // Shared values are stable refs — deps are the real triggers only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, thesisId]);

  const headerAnimStyle = useAnimatedStyle(() => {
    const h = headerRowH.value;
    if (h === 0) return {}; // not measured yet → natural layout, fully shown
    const p = headerShown.value;
    return {
      height: h * p,
      opacity: interpolate(p, [0, 0.35, 1], [0, 0, 1]),
      transform: [{ translateY: -h * (1 - p) }],
    };
  }, []);
```

- [ ] **Step 3: Restructure the top-bar JSX**

Replace
```tsx
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
        <BackButton />
        …existing children…
      </View>
```
with
```tsx
      {/* Top bar — auto-hides on scroll down in the Writer, returns on scroll up
          or near the top. The static spacer keeps the safe area (dark background
          behind the notch); the row itself clips + slides up behind it. */}
      <View style={{ paddingTop: insets.top }}>
        <Animated.View style={[styles.topBarClip, headerAnimStyle]}>
          <View
            style={styles.topBar}
            onLayout={(e) => {
              headerRowH.value = e.nativeEvent.layout.height;
            }}
          >
            <BackButton />
            …existing children UNCHANGED (title, undo, redo, PreviewButton, HeaderMenuButton)…
          </View>
        </Animated.View>
      </View>
```
The children move verbatim — do not touch the undo/redo/preview/menu elements. `styles.topBar` already carries `paddingVertical: 14`, which now supplies the 14px top padding the inline override used to add. Add the clip style to the StyleSheet:
```tsx
  // Clip container for the auto-hiding header row (height animates; the row
  // slides up out of it). Measured height comes from the INNER row's onLayout,
  // which stays at natural size regardless of the clip.
  topBarClip: { overflow: "hidden" },
```

- [ ] **Step 4: Wire the handler into the Writer layer**

On the `<OutlineReorderable …>` element (~line 695), add:
```tsx
                onScroll={onWriterScroll}
```
If tsc rejects the Reanimated handler against `ScrollViewProps["onScroll"]`, cast at this call site:
```tsx
                onScroll={onWriterScroll as unknown as ScrollViewProps["onScroll"]}
```
(and add `type ScrollViewProps` to the `react-native` import in this file).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/thesis-workspace.tsx" components/workspace/OutlineReorderable.tsx
git commit -m "feat(workspace): auto-hiding header — slides away on scroll down, returns on scroll up

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: On-device QA (user-assisted — no test runner exists)

- [ ] **Step 1: Launch the app** (Expo dev build on device/simulator) and open a thesis with a long document.
- [ ] **Step 2: Walk the QA list from the spec:**
  - No strip: header row sits directly above the paper; no words/pages/sections anywhere; word-count milestone toast still fires after writing past a threshold (test by pasting text if needed).
  - Scroll down in the Writer → header glides away (~260ms, no flicker at the top bounce); scroll up a little → it returns; reach the top → it stays.
  - Word preview / PDF preview → header always visible.
  - Type with the keyboard open mid-document → no header flapping or input jank.
  - RTL Arabic title renders as before.
  - Idle state (no selection, bubble alive) → NO bottom bar; ✦ bubble opens chips/input.
  - Drag-to-X dismiss the bubble → still no bottom bar; select a block, keyboard up → dock bar's ✦ re-arms the bubble with its input open.
  - AI ask/confirm surfaces still dock at the bottom when the AI asks a question / wants confirmation.
- [ ] **Step 3: Report results** — any failed line item goes back to its task; do not mark this plan done with a failing item.

---

## Self-review (done at planning time)

- Spec coverage: §1 strip → Task 1; §2 idle bar (incl. bubble-only entry + GlobalDockBar fallback) → Task 2; §3 auto-hide (thresholds, easing, safe-area, preview-mode pin, worklet) → Task 3; verification → Task 4. i18n: spec's "askPlaceholder/status.ready if unreferenced" resolved at plan time — they ARE referenced (WorkspaceComposerSheet WIP), so they stay.
- No placeholders; all code complete.
- Names consistent: `countWords` import path `@/lib/word-count`; `onWriterScroll` / `onScroll` prop; `headerRowH/headerShown/headerTarget`; `topBarClip`.
