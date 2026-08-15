# Plan — split the Lexical editor into `editor-components/`

**Date:** 2026-08-15
**Target:** [components/workspace/lexical/LexicalDomEditor.tsx](../../../components/workspace/lexical/LexicalDomEditor.tsx) — 3 909 lines / 198 KB in one file
**Goal:** one folder of small, single-purpose modules; `LexicalDomEditor.tsx` shrinks to a ~70-line composition shell at its current path.
**Nature:** a pure move. No behaviour change, no new features, no refactor of logic. Every extracted block is byte-identical to what it replaces except for `import`/`export` lines.

---

## 0. The one constraint that governs everything

`LexicalDomEditor.tsx` starts with `'use dom'`. babel-preset-expo's `use-dom-directive-plugin` allows a `'use dom'` module **exactly one export, and it must be the default**. A named non-type export throws at **bundle time** and renders the whole writer screen blank. `npx tsc --noEmit` is blind to it — see [`use-dom-single-export`](../../..) in memory and the header of [scripts/verify-use-dom.mjs](../../../scripts/verify-use-dom.mjs).

Consequences for this split:

- The new files **must not** carry the `'use dom'` directive. They are ordinary web-bundle modules with as many named exports as they like — exactly the arrangement `blockLexical.tsx` already uses today.
- `LexicalDomEditor.tsx` keeps the directive, keeps **one** `export default`, and gains only `import` lines.
- The four public types currently exported from it (`LexicalCommand`, `LexicalState`, `SuggestionInput`, `RangeSuggestionInput`, `SearchInput`) move out to `editor-components/types.ts`. Do **not** replace them with `export type { … } from "./types"` in the DOM file — a type re-export is *probably* erased before the plugin counts exports, but "probably" is not worth a blank screen. Update the call sites instead (§4, step 2 — 4 lines).
- `node scripts/verify-use-dom.mjs` runs after **every** step below. It is the gate, not `tsc`.

Second constraint: **module-level mutable state**. `lxTouching`, `lxPinCancel`, `measureCache`, `singleLineCache` are singletons that several plugins read. Each must land in exactly one module. Two copies = two caches = silent breakage.

---

## 1. What is actually in the file

| Lines | Content | → destination |
|---|---|---|
| 1–13 | header comment + `'use dom'` | stays (rewritten, §3) |
| 14–159 | imports | redistributed |
| 160–168 | `InsertBlockPayload`, `INSERT_BLOCK_COMMAND` | `commands.ts` + `types.ts` |
| 171–253 | `SuggestionInput`, `RangeSuggestionInput`, `LexicalCommand`, `LexicalState` | `types.ts` |
| 255–259 | `DRIVING_MS`, `DRIVING_EVENTS` | `plugins/EditorBridge.tsx` (only user) |
| 261–271 | Lexical `theme` class map | `theme.ts` |
| 272–278 | Liberation Serif `require()`s, `BRAND`, `BRAND_RGB` | `styles/` |
| **280–652** | `CSS` — one 373-line template literal | `styles/` (§2.3) |
| 653–753 | `measureCache`, `measureCacheClear`, `blockMeasureKey`, `singleLineCache`, `singleLinePx`, `measureBlockHeights` | `measure.ts` |
| 754–767 | `seed()` | `seed.ts` |
| **768–1222** | `EditorBridge` — 455 lines | `plugins/editor-bridge/` (§2.4) |
| 1223–1403 | `TbInfo`, `kindIcon`, `FloatingToolbar` — **dead code** | **deleted** (§2.1) |
| 1404–1497 | `lxQuietUpdate`, `lxQuietCommand`, `lxTouching`, `lxPinCancel`, `withScrollPinned` | `lexical-updates.ts` |
| 1498–1579 | `ScrollAnchor`, `lxGetRoot`, `lxFirstVisible`, `lxMeasureAnchor`, `lxApplyAnchor` | `scroll-anchor.ts` |
| 1580–1716 | `ScrollSyncPlugin` | `plugins/ScrollSyncPlugin.tsx` |
| 1717–1795 | `BlockFmtChange`, `listItemsOf`, `$nodeAtBlockIndex`, `$anyNodeAtBlockIndex`, `$rootChildBlockIndex`, `$blockIndexOfNode` | `block-index.ts` |
| 1796–1865 | `applyBlockFormat`, `rebuildOriginal` | `block-format.ts` |
| 1866–1883 | `EquationTapPlugin` | `plugins/EquationTapPlugin.tsx` |
| 1884–2054 | `SuggestionPlugin` | `plugins/SuggestionPlugin.tsx` |
| 2055–2206 | `GHOST_TAG`, `CompletionPlugin` | `plugins/CompletionPlugin.tsx` |
| **2207–2628** | `ReorderPlugin` — 422 lines | `plugins/reorder/` (§2.5) |
| 2629–2669 | `PasteImagePlugin` | `plugins/PasteImagePlugin.tsx` |
| 2670–2792 | `SLASH_RE`, `SlashPlugin` | `plugins/SlashPlugin.tsx` |
| 2793–2883 | `RangeSuggestionPlugin` | `plugins/RangeSuggestionPlugin.tsx` |
| 2884–2929 | `SelectionHighlightPlugin` | `plugins/SelectionHighlightPlugin.tsx` |
| 2930–3105 | `SelectRow`, `$pushSelectListRows`, `$selectRows`, `SelectPlugin` | `plugins/SelectPlugin.tsx` |
| 3106–3183 | `SearchInput`, `charPosInEl`, `SearchHighlightPlugin` | `plugins/SearchHighlightPlugin.tsx` |
| 3184–3203 | `KeyboardModePlugin` | `plugins/KeyboardModePlugin.tsx` |
| 3204–3272 | `DrawerSwipePlugin` | `plugins/DrawerSwipePlugin.tsx` |
| **3273–3661** | `PAGES_TAG`, `PaginationPlugin` — 389 lines | `plugins/pagination/` (§2.6) |
| 3662–3909 | props type (~160 lines of documented props) + default export | `props.ts` + the shell |

---

## 2. Target layout

```
components/workspace/lexical/
├── LexicalDomEditor.tsx          ← 'use dom', ONE default export, ~70 lines
├── LexicalBubble.tsx             ← untouched
├── blockLexical.tsx              ← untouched in phase 1 (see §6)
└── editor-components/
    ├── types.ts                  ~110   public contracts (type-only)
    ├── props.ts                  ~170   LexicalDomEditorProps + its doc comments
    ├── commands.ts               ~15    INSERT_BLOCK_COMMAND
    ├── theme.ts                  ~15    Lexical class map
    ├── seed.ts                   ~15    demo seed state
    ├── measure.ts                ~100   offscreen measurement + its two caches
    ├── lexical-updates.ts        ~95    quiet update/dispatch + scroll pin
    ├── scroll-anchor.ts          ~80    anchor measure/apply
    ├── block-index.ts            ~80    the block-index walkers
    ├── block-format.ts           ~70    applyBlockFormat, rebuildOriginal
    ├── styles/
    │   ├── index.ts              ~30    ordered concatenation → the CSS string
    │   ├── base.ts               ~90    fonts, .lx-root, .lx-content, typography
    │   ├── chrome.ts             ~50    header/footer bands, section breaks
    │   ├── pages.ts              ~50    page view, gutters, page numbers
    │   ├── tables.ts             ~40    table + in-cell edit
    │   ├── suggestion.ts         ~70    suggestion / range / ghost surfaces
    │   ├── reorder.ts            ~30    gutter grips, lift, drop preview
    │   └── motion.ts             ~45    keyframes (was lines 473–652's motion half)
    └── plugins/
        ├── editor-bridge/
        │   ├── EditorBridge.tsx  ~180   effects + wiring
        │   ├── apply-command.ts  ~180   the `switch (command.type)` body
        │   └── read-state.ts     ~100   editor → LexicalState
        ├── reorder/
        │   ├── ReorderPlugin.tsx ~250
        │   ├── constants.ts      ~10    GUTTER_PX, LIFT_HOLD_MS, LIFT_MOVE_PX, EDGE_PX, EDGE_SPEED, SETTLE_MS
        │   └── autoscroll.ts     ~60    edge-band auto-scroll loop
        ├── pagination/
        │   ├── PaginationPlugin.tsx ~200
        │   ├── constants.ts      ~5     PAGES_TAG
        │   └── build-pages.ts    ~180   measure → paginate → numberPages → insert breaks
        ├── ScrollSyncPlugin.tsx       ~140
        ├── SuggestionPlugin.tsx       ~175
        ├── CompletionPlugin.tsx       ~155
        ├── SelectPlugin.tsx           ~180
        ├── SlashPlugin.tsx            ~125
        ├── RangeSuggestionPlugin.tsx  ~95
        ├── SearchHighlightPlugin.tsx  ~80
        ├── DrawerSwipePlugin.tsx      ~70
        ├── SelectionHighlightPlugin.tsx ~50
        ├── PasteImagePlugin.tsx       ~45
        ├── KeyboardModePlugin.tsx     ~25
        └── EquationTapPlugin.tsx      ~20
```

No file over ~250 lines. No barrel `index.ts` for `plugins/` — a barrel re-exporting every plugin defeats Metro's per-module resolution and buys nothing here; the shell imports each plugin directly.

### 2.1 Dead code: `FloatingToolbar`

`FloatingToolbar` (1235–1403), `kindIcon` (1226–1234) and `TbInfo` (1223) are **never rendered**. The only reference to `FloatingToolbar` in the repo is its own declaration; it is file-local, so nothing outside can reach it. That is 181 lines of the 3 909.

Delete it, in its **own commit before the move**, so the move commit stays a provable pure rename. Git history keeps it if the per-block toolbar is revived — the live one is the native [BlockContextBar](../../../components/workspace) shell.

### 2.2 Import layering (no cycles)

Strict one-way flow. Nothing below imports anything above it:

```
types.ts · commands.ts · theme.ts · styles/*        (leaves)
        ↓
measure.ts · scroll-anchor.ts · block-index.ts       (DOM/Lexical helpers)
        ↓
lexical-updates.ts   (→ scroll-anchor)
block-format.ts      (→ block-index)
        ↓
blockLexical.tsx     (nodes, contexts, serialisation — unchanged)
        ↓
plugins/*            (never import each other)
        ↓
LexicalDomEditor.tsx (the shell)
```

The one cross-plugin coupling is `INSERT_BLOCK_COMMAND` — dispatched by `EditorBridge` (line 1003) and handled by `SlashPlugin` (line 2730). It goes to `commands.ts` so neither plugin imports the other. If a second such command appears later, it goes there too.

### 2.3 The CSS split — ordering is load-bearing

`CSS` is one template literal whose rules cascade in source order. `styles/index.ts` must concatenate the chunks in **exactly** the order the rules appear today:

```ts
export const CSS = [BASE, CHROME, PAGES, TABLES, SUGGESTION, REORDER, MOTION].join("\n");
```

Verify with a one-shot equivalence check before deleting the original — normalise whitespace and compare:

```bash
node -e '…' # print old CSS and new CSS, strip \s+, assert identical
```

If that check is fussy, **fall back to a single `styles.ts`** holding the literal verbatim. A 373-line stylesheet in one file is not the problem this plan exists to solve; a silently reordered cascade is a real regression (`.lx-sug-icon.lx-sug-danger` overriding `.lx-sug-icon`, etc.).

The two font `require()` calls stay at the top of `styles/base.ts` — Metro asset requires work the same from any web-bundle module.

### 2.4 `EditorBridge` (455 lines → 3 files)

The bulk is one `switch (command.type)` handling ~25 native commands (bold, align, list, insert, serialize, …). Split by role:

- `apply-command.ts` — `export function applyLexicalCommand(editor, command, deps)`. Pure dispatch; takes the callbacks it needs (`onBlocks`, etc.) as an explicit `deps` object rather than closing over component scope.
- `read-state.ts` — `export function $readLexicalState(): LexicalState`, the selection→state reader that feeds `onState`.
- `EditorBridge.tsx` — the `useEffect`s: command nonce, reseed, `scrollToIndex`, `scrollToChrome`, `chromePreview`, the driving-event listeners (`DRIVING_MS`/`DRIVING_EVENTS` live here), and the `onState` reporting loop.

### 2.5 `ReorderPlugin` (422 lines → 3 files)

- `constants.ts` — the six tuning numbers (2207–2212). They are commented tuning knobs; a named file makes them findable.
- `autoscroll.ts` — the `EDGE_PX`/`EDGE_SPEED` rAF loop; self-contained and testable by eye.
- `ReorderPlugin.tsx` — grip hit-testing, lift arming, drop preview, `singleMoveTo` commit.

### 2.6 `PaginationPlugin` (389 lines → 3 files)

- `constants.ts` — `PAGES_TAG`.
- `build-pages.ts` — collect rows → `measureBlockHeights` → `paginate` → `numberPages` → insert `PageBreakNode`s. This is the half that pairs with [lib/page-layout.ts](../../../lib/page-layout.ts), already verifiable off-device via `scripts/verify-page-layout.mjs`.
- `PaginationPlugin.tsx` — the font-readiness effect (`measureCacheClear`), the reconcile listener, and the `PAGES_TAG` re-entrancy guard.

⚠️ Do not restructure the self-scheduling guard while moving it. Per [`page-view-in-writer`](../specs/2026-08-12-page-view-in-writer-design.md), a pagination pass that re-schedules itself **kills autosave**; the `tags.has(PAGES_TAG)` early-return at line 3647 is what stops it.

---

## 3. What `LexicalDomEditor.tsx` becomes

```tsx
'use dom';

// Lexical rich-text editor rendered as an Expo DOM component. This module is the
// COMPOSITION SHELL only — every plugin, helper and stylesheet lives in
// ./editor-components/. It keeps the 'use dom' directive, so it may have exactly
// ONE export and it must be the default (scripts/verify-use-dom.mjs).

import { LexicalComposer } from "@lexical/react/LexicalComposer";
/* …plugin imports… */
import type { LexicalDomEditorProps } from "./editor-components/props";

export default function LexicalDomEditor(props: LexicalDomEditorProps) {
  /* initialConfig + the provider stack + the plugin list — unchanged JSX */
}
```

~70 lines. The provider nesting (`MediaContext` → `AnchorGeometryContext` → `EditCellContext` → `WorkingLabelsContext` → `TableProposalContext`) and the plugin ordering inside `.lx-root` are copied verbatim — plugin mount order affects command-listener priority, so do not "tidy" it.

---

## 4. Execution order

Each step is one commit, and each ends with **both** gates green. Do not batch — if `verify-use-dom` fails, you want to know which step did it.

1. **Delete `FloatingToolbar` + `kindIcon` + `TbInfo`** (1223–1403). Gates. Commit `refactor(lexical): drop the unrendered FloatingToolbar`.
2. **`types.ts` + `props.ts`.** Move the five public types and the props type out; update the four native call sites — [app/(app)/lexical-lab.tsx:6](<../../../app/(app)/lexical-lab.tsx>), [app/(app)/lexical-writeback.tsx:7](<../../../app/(app)/lexical-writeback.tsx>), [app/(app)/lexical-roundtrip.tsx:7](<../../../app/(app)/lexical-roundtrip.tsx>), [components/workspace/WorkspaceLexicalView.tsx:6](../../../components/workspace/WorkspaceLexicalView.tsx) — to import `LexicalCommand`/`LexicalState` from `editor-components/types`. Gates.
   ⚠️ `props.ts` imports `type PageSetup` from `../../WorkspaceLexicalView` (native) — type-only, erased, same contract as today's line 159. Check this does not become a value import.
3. **Leaves:** `commands.ts`, `theme.ts`, `seed.ts`, `styles/`. Gates + the CSS equivalence check (§2.3).
4. **Helpers:** `measure.ts`, `scroll-anchor.ts`, `lexical-updates.ts`, `block-index.ts`, `block-format.ts`. Gates.
   ⚠️ `measureBlockHeights` was the exact function that shipped the `'use dom'` bundle break. In `measure.ts` it is a normal named export and that is correct — the file has no directive. Confirm `measure.ts` does **not** start with `'use dom'`.
   ⚠️ `lxTouching` / `lxPinCancel` / `measureCache` / `singleLineCache` each appear in exactly one new file. Grep to prove it.
5. **Small plugins** (one commit, they are trivial): `EquationTapPlugin`, `KeyboardModePlugin`, `PasteImagePlugin`, `SelectionHighlightPlugin`, `DrawerSwipePlugin`, `SearchHighlightPlugin`, `RangeSuggestionPlugin`, `SlashPlugin`, `ScrollSyncPlugin`, `SuggestionPlugin`, `CompletionPlugin`, `SelectPlugin`. Gates.
6. **`plugins/editor-bridge/`.** Gates.
7. **`plugins/reorder/`.** Gates.
8. **`plugins/pagination/`.** Gates.
9. **The shell.** Rewrite `LexicalDomEditor.tsx` to §3. Gates + the full device pass (§5).

---

## 5. Verification

Automated, after every step:

```bash
node scripts/verify-use-dom.mjs    # THE gate — bundle-time single-export rule
npx tsc --noEmit                   # the only other automated check this repo has
node scripts/verify-page-layout.mjs # after step 8 (pagination geometry)
```

This repo has **no JS test runner**. `tsc` passing means nothing about the `'use dom'` rule, and neither tool can see a reordered CSS cascade or a mis-mounted plugin. So after step 9, a real-device pass on the writer is mandatory:

- type a paragraph; bold / italic / align / heading / list from the native bubble → formatting applies and **the view does not jump to the top** (that is `withScrollPinned`)
- scroll away, blur, return → scroll restores to the same block (`ScrollSyncPlugin` + `scrollRestore`)
- toggle page view → page breaks land, page numbers render, **autosave still fires** (the `PAGES_TAG` guard)
- an Arabic document → RTL stays right-aligned, gutter grips on the correct side
- `/` at an empty paragraph → the native Insert menu blooms (`SlashPlugin` ⇄ `INSERT_BLOCK_COMMAND` ⇄ `EditorBridge`)
- AI paragraph suggestion → approve and reject both restore the original type (`rebuildOriginal`)
- Select mode → checkboxes appear, tapping marks blocks; Reorder mode → hold a grip, drag, drop commits
- document search → matches tint amber, current match is stronger, tapping scrolls to it
- tap an equation → the native equation sheet opens

A blank white editor after a change is the signature of the `'use dom'` violation, not of a logic bug — run `verify-use-dom` first, always.

---

## 6. Phase 2 (separate task, not this plan)

`blockLexical.tsx` is 2 845 lines and the same argument applies to it. Sketch, for when phase 1 has landed and settled:

- `editor-components/contexts.ts` — `MediaContext`, `EditCellContext`, `TableProposalContext`, `WorkingLabelsContext`, `AnchorGeometryContext`, `TABLE_AI_LABELS_EN`, `WORKING_LABELS_EN`
- `editor-components/nodes/` — `BlockDataNode`, `ChromeNode`, `PageBreakNode`, `SuggestionNode`, `RangeSuggestionNode`, `GhostCompletionNode`, `EquationNode` (one file each, with its `$create`/`$is` pair and its `Serialized…` type)
- `editor-components/views/` — `Figure`, `ShapeTextBox`, `AnchorLayer`, `AnchorContent`, `EditableTable`, `ProposalDiffTable`, `CellBody`, `ChromeBand`, `PageBreakBand`, `SuggestionView`, `GhostView`, `EquationView`, `WorkingNote`, `ThinkingPanel`, `PillBtn`, `TraceBox`, `AIChip`
- `editor-components/serialize.ts` — `$blocksToLexical`, `$lexicalToBlocks`, `$blockEntries`, `countListItems`, `$isDisplayOnlyNode`

`blockLexical.tsx` then survives as a thin re-export barrel, because [stores/workspace-store.ts:2](../../../stores/workspace-store.ts) imports `type ChromeKind` from it (type-only, so the native bundle stays clean) — or that single import moves too and the file goes away.

Keep phase 2 out of phase 1: the two files' import graphs cross at ~50 symbols, and moving both at once makes the "pure rename" claim unverifiable by review.

---

## 6b. What actually landed (2026-08-15)

Executed on `refactor/lexical-editor-components`, nine commits, both gates green after every one. `LexicalDomEditor.tsx` **3 909 → 207 lines**; 45 modules under `editor-components/`; nothing over 355 lines.

Where execution departed from the plan above:

- **`commands.ts` moved up into step 2.** Removing the type block took `INSERT_BLOCK_COMMAND` with it, and leaving a step that does not compile is worse than resequencing.
- **CSS split into 10 chunks, not 7.** The stylesheet's own section boundaries did not line up with the seven names guessed here. Order is preserved exactly; the rebuilt string was verified **byte-identical** to the literal it replaced. One rule is out of place (`.lx-ghost` sits in `chrome.ts`) *because* order was preserved over tidiness — documented in the file.
- **`reorder/autoscroll.ts` was not extractable.** §2.5 called it self-contained; it is not — it closes over the mutable lift `L`, the scroller and `track`. Pulling it out would mean threading that state through parameters, which is not a separation of concerns. `constants.ts` and a real `geometry.ts` (the pure reads) came out instead, and `ReorderPlugin.tsx` stays 355 lines by design.
- **The shell is 207 lines, not ~70.** The 47-prop destructure stayed, so the JSX tree could be copied verbatim — `initialConfig` and the whole tree are byte-identical to the pre-split file.
- **`measureCacheClear` now clears both caches.** `PaginationPlugin` was reaching into `singleLineCache` directly; it was the only caller and always cleared both, so folding it in keeps the private cache private with no behaviour change.
- **`FloatingToolbar`'s stylesheet went too** — 13 `.lx-tb-*` rules that only it used.

**A real defect was caught by the line-by-line diff, not by the gates:** in the pagination split, `if (trailing) next.push(…)` fell one line outside the extracted range. `tsc` was clean and both gates passed. The effect would have been that on any document with a final footer, the "did anything actually move?" comparison could never match — so every 400ms pass would tear down and rewrite the whole run of bands. Verifying each split against `git show HEAD:` earned its keep; do it for phase 2 as well.

**Still outstanding: the device pass in §5.** No automated check in this repo can see a reordered cascade, a mis-mounted plugin, or a WebView scroll regression.

## 7. Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| A named export lands in the `'use dom'` file | Blank writer screen at bundle time; `tsc` clean | `verify-use-dom.mjs` after every step, non-negotiable |
| CSS chunk reordered | Later rules stop overriding earlier ones — subtle visual drift | Fixed-order `join` + whitespace-normalised equivalence check; fall back to one `styles.ts` |
| A singleton cache duplicated across modules | Stale measurements, pin restores stacking | One home per singleton; grep to prove |
| Plugin mount order changed in the shell | Command listeners resolve at different priority | Copy the JSX verbatim; diff the plugin list against `git show HEAD:…` |
| Import cycle (`plugins/a` → `plugins/b`) | Metro resolves to `undefined` at module init — a plugin silently no-ops | Layering in §2.2; plugins never import plugins; shared commands go to `commands.ts` |
| Pagination guard restructured | Self-scheduling pass kills autosave | Move `PAGES_TAG` and its early-return together, untouched |
| Type-only import becomes a value import | `WorkspaceLexicalView` (native) pulled into the web bundle | Keep `import type`; `verify-use-dom` will not catch this — read the diff |
