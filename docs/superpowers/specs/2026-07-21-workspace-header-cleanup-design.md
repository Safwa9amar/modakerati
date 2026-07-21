# Workspace header cleanup — design

Date: 2026-07-21
Status: approved direction (strip removal + idle-AI-bar removal + auto-hiding header), pending user review of this doc.

## Problem

The workspace header stack is cluttered and partly dishonest:

- The status strip under the header shows **"N words · N pages · N sections"** where pages = `ceil(words / 300)` (an estimate) and sections = count of heading paragraphs (62 for the current test doc). Both read as facts and are wrong.
- The strip + header + (sometimes) preview bar stack three rows of chrome above the paper.
- The bottom **idle Ask-AI bar** ("Ready — ask me to write or edit…", suggestion chips, "Ask the AI to write or edit…" input) permanently parks ~120px of AI chrome at the bottom even though the ✦ floating bubble is now the primary AI surface.

## Decisions

### 1. Remove the status strip entirely

- Delete the `statusStrip` row in `app/(app)/thesis-workspace.tsx` (the `DocProgress` + `SyncStatusChip` pair). No replacement row; the paper starts higher.
- `DocProgress` component, `ProgressRing`, and `computeDocStats` are deleted. **`countWords` survives** (exported for the milestone toasts) — move it to a small util or keep the file trimmed to just it.
- `SyncStatusChip` is deleted if the workspace was its only consumer (verify at implementation).
- Word-count **milestone toasts stay** unchanged.
- Sync visibility after removal: the GlobalDockBar pulsing dot (while actually flushing) and the app's offline banner. The composing gate ("Saved on device") no longer has a passive indicator — accepted.
- Remove now-unused i18n keys (`workspace.progressSummary`, and the `workspace.sync*` keys only if the chip is fully deleted) in en/fr/ar.

### 2. Remove the idle Ask-AI bar (bubble-only AI)

- Delete both `IdleAIBar` fallback branches in `components/workspace/BlockComposer.tsx` (whole-memoir fallback and the `askAiOpen` block-scoped fallback) and the `IdleAIBar` component file.
- `surface` stays null in those states — nothing docks at the bottom while idle.
- Remaining AI entries: the ✦ floating bubble (primary), the pinned ✦ in the GlobalDockBar while the keyboard is up, and the chat tab. If the bubble was drag-to-X dismissed there is intentionally **no** bottom fallback anymore; the bubble re-arms per its existing lifecycle (workspace re-enter / pill reset).
- The `ComposerAsk` surface (AI questions) is unrelated and stays.
- Remove i18n keys that become unused (`workspace.askPlaceholder` if unreferenced, `composer.status.ready`, …) in en/fr/ar.

### 3. Header row: same content, auto-hides on scroll

Content unchanged: back · title · undo · redo · eye(preview) · ⋯ menu.

Behavior (Writer/outline view only, v1):

- **Hide** when the user scrolls DOWN more than ~30px accumulated while the scroll offset is past ~64px.
- **Show** on any upward scroll of ~12px+, and always when the offset is near the top (< ~48px).
- Ignore overscroll/bounce (negative offsets) so iOS rubber-banding doesn't flicker it.
- Always visible in Word/PDF preview modes (their scroll lives inside WebViews — out of scope v1) and while `doc` isn't a live doc.
- Long-press affordances (history sheet on Undo) are unaffected — the header is either fully shown or fully hidden, never half-interactive.

Animation ("smart"):

- Reanimated shared value driven from the writer list's `onScroll` **worklet** (UI thread, no JS-thread jank while typing).
- Header container translates up by its measured height with ~260ms `cubic-bezier(0.4, 0, 0.2, 1)` (or an equivalent stiff spring), paper area expanding with it — one continuous motion, no layout snap.
- Respect the existing top safe-area: when hidden, the dark app background shows behind the notch (paper does not slide under the status bar).

## Out of scope

- Hiding the header inside Word/PDF WebView previews (needs injected scroll messaging; possible follow-up).
- Any change to the GlobalDockBar, floating bubble, or ⋯ menu contents.
- Real page counts (available only via the PDF/Word previews; deliberately not surfaced in the header).

## Verification

No JS test runner in this repo: gate with `npx tsc --noEmit` + on-device QA (scroll down → header glides away; scroll up / reach top → returns; type with keyboard open → no jank; RTL title unaffected; milestones still toast; no idle AI bar in any state; ✦ bubble flow intact).
