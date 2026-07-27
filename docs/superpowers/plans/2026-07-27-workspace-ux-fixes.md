# Workspace UX Fixes (7 issues) — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Each issue below is **independent** — implement, verify, and commit them one at a time in any order. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Fix seven workspace UX problems reported on device. Two are design decisions (#1 keyboard-gated tools, #6 header + button model) that are really one conversation and are decided together here; the rest are bugs/features/perf that stand alone.

**⚠️ Verification model** (memory `app-verification-no-test-runner`): the Expo app has **no JS test runner** — do NOT write jest tests for app code. Gate every app change with `npx tsc --noEmit` (run from `/Users/hamzasafwan/modakerati`) + the per-issue manual device-QA checklist. The **server** (`~/modakerati-server`) DOES use vitest — issue #7's server change needs a vitest test.

**⚠️ Line numbers** are as-found during planning and drift as files change — treat them as anchors, re-grep the named symbol before editing.

**⚠️ i18n** (memory `locale-json-duplicate-keys`): `locales/{en,fr,ar}.json` have duplicate keys — edit **surgically** by hand, never `JSON.parse`/`dump`. Every new user-facing string needs en/fr/ar.

---

## Issue map & sequencing

| # | Issue | Type | Effort | Touches server? |
|---|-------|------|--------|-----------------|
| 1+6 | Keyboard-gated tools + header/button model | 🎨 Design | L | no |
| 2 | Android: focus/caret scrolls to top (image/table select AND paragraph edit) | 🐛 Bug | M | no |
| 3 | `/`-menu ugly → `+` bubble on blank paragraph | 🎨 Design | M | no |
| 4 | Drawer opens on left→right edge swipe | ✨ Feature | S | no |
| 5 | 2–3s navigation delay | ⚡ Perf | M | no |
| 7 | Page-break: 2 tries + text jumps section | 🐛 Bug | M | **yes** |
| 8 | Disable false Arabic spell-check red underline | 🐛 Bug | S | no |

**Recommended order:** #8 (one-attribute quick win) → #4 → #2 → #5 → #7 → #1+#6 → #3 (plugs into #1+#6's model). Each section is a standalone unit.

---

# Issue 1 + 6 — Persistent chrome: decouple tools from the keyboard, restore the header toggle

## Root cause
Every global document tool (undo/redo, outline, search, insert `+`, page-setup, thesis-ready, pinned ✦) lives **only** in `GlobalDockBar`, which is rendered only when `keyboardVisible && (inlineEditing || composerInputFocused)` — [BlockComposer.tsx:121](components/workspace/BlockComposer.tsx#L121) and the `else if (blockKeyboardOpen)` branch at [BlockComposer.tsx:196](components/workspace/BlockComposer.tsx#L196). **Keyboard down = no bottom toolbar exists at all**, only the floating ✦ bubble. The auto-hide header was also silently lost when the Lexical WebView replaced the native `OutlineReorderable` writer (commit `874b39d`) — its scroll worklet had no feed and was removed; the header at [thesis-workspace.tsx:529](app/(app)/thesis-workspace.tsx#L529) is now "always visible."

## Decision
Three surfaces, split by responsibility (settled with the user via the visual companion, `2026-07-27`):

**1. Persistent bottom dock (doc tools) — the #1 fix.** An always-mounted bottom bar carrying the global document tools (undo/redo, outline, search, insert `+`, page-setup, thesis-ready, pinned ✦), independent of the keyboard. Keyboard down → rests on the bottom safe-area. Keyboard up → rides above the keyboard as today (already inside the parent `KeyboardAvoidingView`, [thesis-workspace.tsx:524](app/(app)/thesis-workspace.tsx#L524)). This is the change that stops the tools disappearing. *(Confirmed with the user `2026-07-27`.)* The existing `KeyboardOff` dock chip ([GlobalDockBar.tsx:133](components/workspace/GlobalDockBar.tsx#L133)) stays as the dismiss-when-up affordance; the bubble tray's `⌨` is the raise-when-down affordance — complementary, not redundant.

**2. Bubble drag-tray (2 controls) — your #6 "set of buttons" idea, layout C2.** Dragging the ✦ bubble (the existing drag-to-dismiss gesture) reveals a **bare, outlined 2-target column on the right edge** — no tray container background, just two outlined circles. Layout **C2**: the hovered target enlarges, turns amber, and flies its label out to the left. Targets, nearest-thumb first: **⌨ keyboard** (raise / dismiss) then **✕ close** (dismiss the bubble, placed farthest up so it can't be fat-fingered). Release the bubble over a target to fire it — ⌨ snaps the bubble back, ✕ dismisses it.

**3. Screen top-bar — auto-hide on scroll, NO button.** The top app bar (back button + title, [thesis-workspace.tsx:529](app/(app)/thesis-workspace.tsx#L529) — **NOT** the docx running header/footer) auto-hides on scroll, re-fed from the Lexical DOM editor's `onScroll` (its native feed was lost in the WebView swap). The `▤ top-bar` toggle was **dropped from the tray** because scroll already handles it. Build the manual toggle but leave it **unrendered in production** — surface it only via a **developer setting in dev builds** (`Settings → Developer`, alongside "Lexical Lab"), as a ready fallback if scroll-driven hide proves janky/slow on device.

*Alternative considered (not chosen): put ⌨/✕ as fixed chips in the dock instead of a drag-tray. Rejected per the user's call — those two controls belong on the bubble's drag gesture, keeping the dock purely for doc tools.*

## Files
- Modify: `components/workspace/BlockComposer.tsx` — un-gate the dock; render `GlobalDockBar` whenever the workspace is open, not only when the keyboard is up. Keep the extra bottom inset only while the keyboard is up ([:131](components/workspace/BlockComposer.tsx#L131)).
- Modify: `components/workspace/GlobalDockBar.tsx` — **doc tools only** (undo/redo, outline, search, insert `+`, page-setup, thesis-ready, pinned ✦), essentially as-is; **no** new keyboard/top-bar cluster (those move to the bubble tray). Add the **dev-only** `▤` top-bar toggle chip (rendered only behind the developer flag).
- Modify: `components/workspace/FloatingPill.tsx` — replace the single drag-to-X ([:213](components/workspace/FloatingPill.tsx#L213)) with the **C2 drag-tray**: a 2-target right-edge column (⌨ nearest the thumb, ✕ farthest up), bare outlined circles, hover → enlarge + amber + label flies left; commit on release.
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` — add an explicit `focus` command that DOES raise the keyboard (the current dispatch skips focus for non-text commands, [:433](components/workspace/lexical/LexicalDomEditor.tsx#L433)); surface an `onScrollDelta` from `onScroll` ([:821](components/workspace/lexical/LexicalDomEditor.tsx#L821)).
- Modify: `components/workspace/WorkspaceLexicalView.tsx` — plumb the `onScrollDelta` callback through ([:131](components/workspace/WorkspaceLexicalView.tsx#L131)).
- Modify: `app/(app)/thesis-workspace.tsx` — `headerShown`/`headerTarget` shared values + `useAnimatedStyle` on the **screen-header/top-bar** View ([:529](app/(app)/thesis-workspace.tsx#L529), back-button + title row).
- Modify: `components/workspace/AIDock.tsx` — ensure only the Ask text field's `autoFocus` ([:452](components/workspace/AIDock.tsx#L452)) raises the keyboard from the bubble; plain chip taps must not (issue #1: keyboard only in the editor / Ask).
- Modify: `stores/workspace-store.ts` (or a small new `stores/workspace-chrome-store.ts`) — a `headerVisible` boolean + toggle for the manual override.
- Modify: the developer-settings screen (`Settings → Developer`, where "Lexical Lab" lives) — a `showTopBarToggle` dev flag.
- `locales/{en,fr,ar}.json` — tray labels (Keyboard / Close) + the dev-setting label (surgical).

## Tasks
- [ ] **1.1 Un-gate the dock (the #1 fix).** In `BlockComposer.tsx`, render `GlobalDockBar` whenever `composerOpen` (workspace active), not only in the `blockKeyboardOpen` branch. Preserve `pendingConfirm`/`pendingAsk` surfaces and the keyboard-inset math ([:131](components/workspace/BlockComposer.tsx#L131)) so the dock rides the keyboard when up and rests on the safe-area when down. `npx tsc --noEmit`.
- [ ] **1.2 Bubble drag-tray (C2).** In `FloatingPill.tsx`, replace the single drag-to-X ([:213](components/workspace/FloatingPill.tsx#L213)) with a 2-target right-edge column revealed during drag: bare outlined circles, **⌨ nearest the thumb, ✕ farthest up**. Track which target the bubble is over → enlarge it, tint amber, fly its label out to the left (C2). Commit the action on release.
- [ ] **1.3 Wire tray actions + tame the keyboard.** `✕` → dismiss the bubble (reuse the existing drag-to-X dismiss). `⌨` → toggle keyboard: if down, dispatch the new explicit `focus` command ([LexicalDomEditor.tsx:433](components/workspace/lexical/LexicalDomEditor.tsx#L433)) that raises the keyboard + focuses the editor; if up, `Keyboard.dismiss()` (pattern at [GlobalDockBar.tsx:133](components/workspace/GlobalDockBar.tsx#L133)), reading state from the keyboard tracker ([BlockComposer.tsx:69](components/workspace/BlockComposer.tsx#L69)). Confirm bubble **chip** taps no longer force the keyboard open — only the Ask text field ([AIDock.tsx:452](components/workspace/AIDock.tsx#L452)) does.
- [ ] **1.4 Top-bar auto-hide.** In `thesis-workspace.tsx`, add `headerShown`/`headerTarget` shared values + `useAnimatedStyle` (translateY + opacity) on the **screen-header/top-bar** View (back button + title, [:529](app/(app)/thesis-workspace.tsx#L529)) — not the docx header/footer. Re-derive the accumulator logic from the removed version (commits `7f6fa9a`, `4091188`: `HEADER_HIDE_AFTER=30`, show on up-scroll or near-top, `withTiming(260)`). Feed it from the new `onScrollDelta` plumbed `WorkspaceLexicalView` → `LexicalDomEditor` `onScroll` ([:821](components/workspace/lexical/LexicalDomEditor.tsx#L821)).
- [ ] **1.5 Top-bar toggle — dev-only, unrendered in prod.** Build a `▤` chip that flips `headerVisible` (manual override wins over scroll until the next scroll gesture), but render it **only** when the `showTopBarToggle` developer flag is on AND `__DEV__`. Off/hidden by default — this is the perf fallback if scroll-hide feels janky. Add the flag to `Settings → Developer`.
- [ ] **1.6 i18n + typecheck.** Add en/fr/ar keys for the tray labels + dev setting (surgical). `npx tsc --noEmit` → 0 errors.
- [ ] **1.7 Device QA.** Keyboard DOWN: undo/redo/outline/search/insert/page-setup/✦ all reachable from the dock. Drag the bubble → the ⌨ + ✕ tray appears (C2, label on hover); drop ⌨ raises the keyboard + focuses the editor; drop ✕ dismisses the bubble. Scroll down → top-bar hides; scroll up → returns. Bubble chip taps do NOT pop the keyboard. Toggle chip absent in a production build, present in a dev build via the setting. Verify Arabic/RTL (column on the correct edge).
- [ ] **1.8 Commit** (`feat(workspace): always-on doc dock + bubble drag-tray (keyboard/close) + top-bar auto-hide`).

---

# Issue 2 — Android: tapping an image/table scrolls to the top

## Root cause
On block select, several commands call `editor.focus()` ([LexicalDomEditor.tsx:433](components/workspace/lexical/LexicalDomEditor.tsx#L433)); re-focusing the contentEditable re-scrolls the selection into view. The iOS mitigation — `withScrollPinned()` ([:766](components/workspace/lexical/LexicalDomEditor.tsx#L766)) saving/restoring `window.scrollY`, plus `blurAfter` — **fails on Android WebView** because `window.scrollTo` is unreliable there (noted at [:814](components/workspace/lexical/LexicalDomEditor.tsx#L814)). So selecting a non-text (image/table) block re-focuses the root and Android scrolls to the top where the pin can't restore.

**User refinement (`2026-07-27`):** it's broader than image/table — tapping *into a paragraph* and starting to type also scrolls the view to the caret **every time** (the native contentEditable "scroll caret into view" on focus / selection change), which is disruptive when the caret was already visible. Same underlying mechanism (focus / selection → scroll-into-view); the fix must also make caret-scroll **conditional**, not just handle the image/table case.

## Decision
Three-pronged, all inside the DOM editor:
1. **Don't re-focus the root when selecting a non-text block.** Image/table selection needs no caret; skip `editor.focus()` for those the way `insert`/`blockFormat` already skip.
2. **Make scroll-restore Android-reliable:** instead of `window.scrollTo`, restore via `document.scrollingElement.scrollTop` inside a **double-`requestAnimationFrame`** (Android WebView needs a layout settle), and/or anchor with `el.scrollIntoView({block:'nearest', inline:'nearest'})` on the tapped block node rather than a viewport pixel.
3. **Caret scroll only when off-screen.** On paragraph focus / typing, don't force a scroll if the caret rect is already inside the visible viewport; when it isn't, nudge with `scrollIntoView({block:'nearest'})` so it never jumps to the top or re-centers a visible caret.

## Files
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` — the focus dispatch ([:433](components/workspace/lexical/LexicalDomEditor.tsx#L433)), `withScrollPinned` ([:766](components/workspace/lexical/LexicalDomEditor.tsx#L766)), the scroll-restore paths ([:893](components/workspace/lexical/LexicalDomEditor.tsx#L893)).

## Tasks
- [ ] **2.1 Reproduce & confirm — both cases.** On Android: (a) tap an image, then a table → confirm scroll-to-top; (b) tap into a mid-document paragraph and type → confirm the unwanted scroll-to-caret. Log `scrollingElement.scrollTop` before/after to confirm the mechanism (verify assumption — see memory `webview-arabic-font` / Android WebView quirks).
- [ ] **2.2 Skip focus on non-text select.** In the `EditorBridge` command effect, extend the focus skip-list so selecting an image/table block does not call `editor.focus()`. Confirm the block still visually selects (selection highlight ≠ caret focus).
- [ ] **2.3 Conditional caret scroll.** Make the on-focus / on-type caret scroll-into-view fire **only** when the caret rect is outside the visible viewport; when needed, use `block:'nearest'`. Verify tapping into an already-visible paragraph and typing does NOT scroll the view.
- [ ] **2.4 Android-safe scroll pin.** In `withScrollPinned`, branch on platform: iOS keeps current behavior; Android saves `document.scrollingElement.scrollTop` and restores it inside `requestAnimationFrame(() => requestAnimationFrame(...))`. If still off, anchor via the tapped node's `scrollIntoView({block:'nearest'})`.
- [ ] **2.5 Regress iOS.** Verify the iOS image/table tap + AI-approve-jump fix ([:1207](components/workspace/lexical/LexicalDomEditor.tsx#L1207), [:1543](components/workspace/lexical/LexicalDomEditor.tsx#L1543)) still holds.
- [ ] **2.6 `npx tsc --noEmit`, device QA both platforms, commit** (`fix(workspace): stop Android focus/caret scroll jump on select + edit`).

---

# Issue 3 — Replace the `/`-menu trigger with a `+` bubble on a blank paragraph

## Root cause
The `/` slash trigger (`SlashPlugin`, [LexicalDomEditor.tsx:1361](components/workspace/lexical/LexicalDomEditor.tsx#L1361)) opening `BottomInsertDrawer` looks bad / is undiscoverable. The Insert menu itself works; only the entry UX is the problem.

## Decision
When the caret is on a **blank paragraph**, show a dedicated **`+` bubble** (a small "Add" affordance) at/near the caret; tapping it opens the existing Insert menu (`insert-menu-store.openAt`). Keep `/` working as a power-user shortcut, but the `+` becomes the primary discoverable path. Emptiness is already derived from `text.trim()` (used at [AIDock.tsx:229](components/workspace/AIDock.tsx#L229), [LexicalDomEditor.tsx:1452](components/workspace/lexical/LexicalDomEditor.tsx#L1452)); the bubble already has per-state variants ([FloatingPill.tsx:515](components/workspace/FloatingPill.tsx#L515)).

*Alternative considered (not chosen): a persistent left-gutter `+` on every empty line (Notion-web style). Rejected for RN — gutter hit-targets fight the keyboard and RTL mirroring; the bubble is already the caret-following affordance.*

## Files
- Modify: `components/workspace/WorkspaceLexicalView.tsx` — expose an `isEmptyParagraph` flag in the state report / selection ([onState ~ :583](components/workspace/WorkspaceLexicalView.tsx#L583)).
- Modify: `components/workspace/FloatingPill.tsx` — a "blank paragraph" bubble state showing `+ Add` that calls `insertMenu.openAt({ index, y })` ([store](stores/insert-menu-store.ts)).
- Modify: `stores/insert-menu-store.ts` — reuse `openAt` ([:38](stores/insert-menu-store.ts#L38)); no change expected beyond confirming anchor Y.
- Optional: down-rank / keep `SlashPlugin` (no removal).

## Tasks
- [ ] **3.1 Report empty-paragraph state.** Add `isEmpty` to the selection/state Lexical reports (derive from the selected block's `text.trim()` — same source as [AIDock.tsx:229](components/workspace/AIDock.tsx#L229)), plumb into `workspace-store`.
- [ ] **3.2 `+` bubble state.** In `FloatingPill.tsx`, when `isEmpty` and nothing else is pending, render a compact `+ Add` chip alongside/instead of the collapsed ✦. Tap → `insertMenu.openAt({ index: currentBlockIndex, y: lastFocusY })`.
- [ ] **3.3 Keep `/` working.** Verify `SlashPlugin` still opens the same menu; ensure the `+` bubble hides while the insert menu is open (suppression flag already exists — `insertMenuOpen` at [FloatingPill.tsx:501](components/workspace/FloatingPill.tsx#L501)).
- [ ] **3.4 i18n (`+ Add` label), `npx tsc --noEmit`, device QA** (blank line shows `+`; tap opens menu; non-empty line hides it; RTL), **commit** (`feat(workspace): + bubble opens insert menu on blank paragraphs`).

---

# Issue 4 — Open the drawer with a left→right edge swipe

## Root cause
The edge-swipe infra already exists: `PushDrawer` ([PushDrawer.tsx:39](components/PushDrawer.tsx#L39)) has an `openPan` gesture ([:100](components/PushDrawer.tsx#L100)) — but on the **right** edge (`styles.edge` `right:0`, [:198](components/PushDrawer.tsx#L198)) with right→left math (`progress = -translationX/DRAWER_W`, [:109](components/PushDrawer.tsx#L109)). You want a left→right swipe from the left edge, from anywhere in the workspace.

## Decision
Make the drawer **direction-aware** with a `side` derived from the app writing direction (default LTR → **left** edge, left→right open, reveal from the left). Add the left-edge `GestureDetector` + mirrored track geometry; keep the existing right-edge path for RTL. The open gate `gateOk` ([:48](components/PushDrawer.tsx#L48)) already covers the workspace + chat routes ("from anywhere").

*Alternative considered (not chosen): add a left-edge trigger but keep the drawer sliding in from the right. Rejected — a left→right swipe revealing a right-side panel feels wrong; mirror the geometry.*

## Files
- Modify: `components/PushDrawer.tsx` — `side` const (from `I18nManager.isRTL` or app direction), edge position `left:0`/`right:0`, sign of `progress` in `openPan.onUpdate`, `trackStyle` translateX, and the parked drawer position ([:100–124](components/PushDrawer.tsx#L100), [:152](components/PushDrawer.tsx#L152), [:182–198](components/PushDrawer.tsx#L182)).

## Tasks
- [ ] **4.1 Parameterize side.** Introduce `const side = I18nManager.isRTL ? 'right' : 'left'` and express edge position, `progress` sign, and track translateX in terms of `side`. Keep the commit threshold ([:112](components/PushDrawer.tsx#L112)) and `openDrawer()` call ([:57](components/PushDrawer.tsx#L57)).
- [ ] **4.2 Mirror the reveal.** Ensure the drawer parks off the leading edge and slides in from that same edge; verify no overlap with the FloatingPill drag zone or back-swipe.
- [ ] **4.3 Device QA.** LTR: left-edge left→right swipe opens; velocity fling works; from workspace AND chat. RTL: right-edge behavior unchanged. Existing open buttons ([GlobalDockBar.tsx:179](components/workspace/GlobalDockBar.tsx#L179), [thesis-workspace.tsx:272](app/(app)/thesis-workspace.tsx#L272)) still work.
- [ ] **4.4 `npx tsc --noEmit`, commit** (`feat(drawer): open on leading-edge swipe (left→right in LTR)`).

---

# Issue 5 — 2–3s navigation delay

## Root cause (ranked)
1. **`thesis-workspace` mounts two heavy WebViews + all doc layers at once** during the `slide_from_right` animation ([app/(app)/_layout.tsx:3](app/(app)/_layout.tsx#L3)): Word layer (`OnlyOfficeView`/`WordDocxView`, [:642](app/(app)/thesis-workspace.tsx#L642)), Lexical DOM WebView ([:695](app/(app)/thesis-workspace.tsx#L695)), PDF layer ([:718](app/(app)/thesis-workspace.tsx#L718)) — all kept mounted ([:613](app/(app)/thesis-workspace.tsx#L613)). Plus synchronous `docRtl` over ≤3000 chars ([:374](app/(app)/thesis-workspace.tsx#L374)), `wordCount` ([:392](app/(app)/thesis-workspace.tsx#L392)), and ~15 store subscriptions.
2. **List screens block first paint on a network spinner:** Home shows a full-screen `ActivityIndicator` until `listTheses()` resolves ([app/(tabs)/index.tsx:199](app/(tabs)/index.tsx#L199)); `thesis.tsx` re-fetches on **every** focus and blanks to a spinner ([app/(tabs)/thesis.tsx:48](app/(tabs)/thesis.tsx#L48), [:143](app/(tabs)/thesis.tsx#L143)). Both `.map()` in a `ScrollView` (no virtualization).
3. No `React.lazy`/`Suspense`; slide animation renders the full heavy destination synchronously.

## Decision
Two moves, biggest-first:
1. **Defer heavy mounts past the transition.** Gate the WebView layers behind `InteractionManager.runAfterInteractions()` (or a `didTransition` state) so the screen shell + Lexical shell paint immediately and the heavy WebViews warm up after the slide. Only the **active** layer mounts eagerly; OnlyOffice/PDF stay lazy. Move `docRtl`/`wordCount`/`tapBlocks` off the sync mount path (memoize / defer).
2. **Stale-while-revalidate the lists.** Render cached theses instantly (the doc store already does SWR — the list screens don't); revalidate in the background without blanking. Switch the long lists to `FlatList`.

## Files
- Modify: `app/(app)/thesis-workspace.tsx` — a `readyForHeavyLayers` state set in `InteractionManager.runAfterInteractions`; gate `OnlyOfficeView`/`WordDocxView`/`PdfView` mounts on it; memoize `docRtl` ([:374](app/(app)/thesis-workspace.tsx#L374))/`wordCount` ([:392](app/(app)/thesis-workspace.tsx#L392)).
- Modify: `app/(tabs)/index.tsx` — cache-first render, spinner only on cold-empty ([:199](app/(tabs)/index.tsx#L199)); `FlatList`.
- Modify: `app/(tabs)/thesis.tsx` — `useFocusEffect` revalidates without blanking ([:48](app/(tabs)/thesis.tsx#L48), [:143](app/(tabs)/thesis.tsx#L143)); `FlatList`.

## Tasks
- [ ] **5.1 Measure first.** Add temporary timing logs (mount → first meaningful paint) on the workspace route and the two tabs to confirm the ranking before changing anything (systematic-debugging: measure, don't guess). Consider `eas observe` TTI if available.
- [ ] **5.2 Defer heavy WebViews.** In `thesis-workspace.tsx`, add `readyForHeavyLayers` (false → true after `InteractionManager.runAfterInteractions`). Mount the Lexical shell immediately; gate OnlyOffice/PDF (and, if it janks, the Word WebView) on the flag. Keep the "all layers stay mounted" behavior once ready ([:613](app/(app)/thesis-workspace.tsx#L613)).
- [ ] **5.3 De-sync compute.** Memoize `docRtl`, `wordCount`, `tapBlocks` on `liveDoc` identity so they don't recompute on unrelated store changes; defer the first `docRtl` pass off the mount frame.
- [ ] **5.4 SWR the lists.** Home + thesis tab render cached data immediately; spinner only when there is genuinely nothing cached; background refresh doesn't unmount the list. Convert to `FlatList`.
- [ ] **5.5 Re-measure & device QA.** Confirm perceived nav < ~1s on a mid Android device. `npx tsc --noEmit`. Commit (`perf(workspace): defer heavy WebView layers past the nav transition + SWR lists`).

---

# Issue 7 — Page-break needs 2 tries + typed text jumps to the next section

## Root cause
**"2 tries":** the `startOnNewPage` optimistic patch is a deliberate no-op ([lib/thesis-ops.ts:323](lib/thesis-ops.ts#L323), [:460](lib/thesis-ops.ts#L460)) and `mutate` intentionally does NOT bump the reload tick ([stores/thesis-doc-store.ts:550](stores/thesis-doc-store.ts#L550)) — so the first tap gives **zero** feedback until the durable queue drains. Also the dock button is inert with no selection (`pageBreakIndices` empty, [GlobalDockBar.tsx:210](components/workspace/GlobalDockBar.tsx#L210)) and, unlike the insert-menu path ([BottomInsertDrawer.tsx:217](components/BottomInsertDrawer.tsx#L217)), the dock path does **not** `flushEdits()` before mutating ([GlobalDockBar.tsx:211](components/workspace/GlobalDockBar.tsx#L211)).

**"Text jumps to next section":** block-index vs paragraph-index gotcha. The app sends block indices; the engine counts paragraphs only. Server maps `paraIndex = blocks.slice(0,i).filter(kind==='paragraph').length` and places the break on `paraIndex-1` (last paragraph of the closing section) — [modakerati-server/src/routes/thesis/blocks.ts:1039](../../../modakerati-server/src/routes/thesis/blocks.ts). When new paragraphs are typed at the start of the new section and then flushed on leave, positions shift around the `sectPr`-bearing paragraph and the re-serialized boundary lands one paragraph off. The client never computes the boundary locally ([lib/thesis-ops.ts:460](lib/thesis-ops.ts#L460)); it only learns it from the server echo ([modakerati-server/src/lib/thesis-doc.ts:540](../../../modakerati-server/src/lib/thesis-doc.ts)). The dock path's missing flush widens the window.

## Decision
1. **Kill "2 tries":** make the dock path `flushEdits()` first (match the insert-menu path), add a sensible fallback index (current caret block when nothing is "selected"), and give **immediate optimistic feedback** by optimistically inserting the section boundary in `applyOpToSections` for `startOnNewPage` so the chrome band renders instantly and `mutate` bumps the tick.
2. **Fix the jump:** always `flushEdits` before the break (both paths) so the break's `paraIndex` is computed against the up-to-date snapshot, then verify the server echo re-seeds `buildChrome` correctly. If the off-by-one persists after flushing, harden the server placement so the `sectPr` stays anchored to the intended paragraph after subsequent inserts (server change + vitest).

## Files
- Modify: `components/workspace/GlobalDockBar.tsx` — `insertPageBreak` ([:211](components/workspace/GlobalDockBar.tsx#L211)): `await lex.flushEdits?.()` before `mutate`; fallback index from caret.
- Modify: `lib/thesis-ops.ts` — `applyOpToSections` `startOnNewPage` case ([:460](lib/thesis-ops.ts#L460)) → optimistic boundary; confirm `applyOpToBlocks` ([:323](lib/thesis-ops.ts#L323)).
- Modify: `stores/thesis-doc-store.ts` — `mutate` ([:550](stores/thesis-doc-store.ts#L550)) bumps the tick when the optimistic sections change.
- Verify/possibly modify (server): `modakerati-server/src/routes/thesis/blocks.ts:1039` and `modakerati-server/src/lib/thesis-doc.ts:540` — break placement + boundary reporting. **Add a vitest** covering "insert break, then insert paragraphs at the new section start, re-serialize → boundary unchanged."
- `components/workspace/WorkspaceLexicalView.tsx` — `buildChrome` ([:57](components/workspace/WorkspaceLexicalView.tsx#L57)) re-seed on echo.

## Tasks
- [ ] **7.1 Reproduce both symptoms** on device; capture the op sequence (dock vs insert-menu path) and whether flush is the differentiator.
- [ ] **7.2 Dock path flush + fallback.** In `GlobalDockBar.insertPageBreak`, `await lex.flushEdits?.()` then `mutate`; when `selectedBlocks`/`editingBlockIndex` are empty, fall back to the current caret block index (synced from [WorkspaceLexicalView.tsx:583](components/workspace/WorkspaceLexicalView.tsx#L583)).
- [ ] **7.3 Optimistic boundary + tick.** Implement the `startOnNewPage` case in `applyOpToSections` to insert a local section boundary; ensure `mutate` bumps the tick so `buildChrome` renders the band immediately (first tap now visibly works).
- [ ] **7.4 Verify the jump post-flush.** With flush in place, test typing at the new section start then leaving. If the boundary is correct, done. If still off-by-one → **7.5**.
- [ ] **7.5 (If needed) Server hardening.** In `blocks.ts`, make break placement robust to subsequent inserts at the section start (re-derive `paraIndex` from the flushed snapshot; confirm `sectPr` stays on the intended paragraph). Add a **vitest** in `~/modakerati-server` reproducing the shift and asserting a stable boundary. Run `pnpm test` (or repo's runner) in the server repo.
- [ ] **7.6 `npx tsc --noEmit` (app), server tests green, device QA, commit(s)** (app: `fix(workspace): page-break inserts on first tap with optimistic band`; server if touched: `fix(thesis): keep section break anchored after inserts at section start`). ⚠️ Server change must be deployed with the app (memory `chat-infinite-scroll` deploy note pattern).

---

# Issue 8 — Stop the false Arabic spell-check red underline

### Root cause
The Lexical `ContentEditable` ([LexicalDomEditor.tsx:2052](components/workspace/lexical/LexicalDomEditor.tsx#L2052)) renders with only `className="lx-content" dir="auto"` — **no `spellCheck`, no `lang`** — so the WebView's native spellchecker runs (`spellcheck=true`) and, having no Arabic dictionary, underlines every Arabic word in red. It's a single element for the whole doc.

### Decision
Turn native spell-check **off** on the editable — one attribute, kills the red line in every language. *(The AI grammar/style checker originally scoped here was dropped per the user; there's no native replacement, so spell-check simply goes off.)*

*Alternative (skipped — the ask is "just disable the red line"): keep native spell-check where it works by stamping a per-paragraph `lang` (Arabic script → `ar`, silenced; Latin → app language, enabled) via a small update-listener plugin, so fr/en keep native checking and only Arabic is quiet. More work; not doing it now.*

### Files
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` — `spellCheck={false}` on `<ContentEditable>` ([:2052](components/workspace/lexical/LexicalDomEditor.tsx#L2052)).

### Tasks
- [ ] **8.1 Disable native spell-check.** Add `spellCheck={false}` to the `ContentEditable` ([LexicalDomEditor.tsx:2052](components/workspace/lexical/LexicalDomEditor.tsx#L2052)). `npx tsc --noEmit`.
- [ ] **8.2 QA + commit.** Device-verify Arabic (and fr/en) paragraphs show no red underline; RTL check. `fix(workspace): disable native spellcheck (kills false Arabic underline)`.

---

## Cross-cutting notes
- **Do #1+#6 before #3** — #3's `+` bubble is a state of the same FloatingPill that #1 gives an explicit close to; sharing the bubble-state model avoids rework.
- **Commit granularly**, one issue per commit (memory `parallel-sessions-git`: user runs concurrent sessions, `git add` exact paths only, never `--amend`).
- **RTL**: every new affordance (dock buttons, `+` bubble, edge swipe) must be checked in Arabic — the app is RTL-heavy and `thesis.language` is unreliable (memory `thesis-language-rtl`).
