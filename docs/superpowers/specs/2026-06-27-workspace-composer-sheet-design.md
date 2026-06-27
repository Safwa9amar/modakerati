# Workspace Composer Bottom Sheet — Design

**Date:** 2026-06-27
**Branch:** `feat/thesis-hierarchy-p0`
**Status:** Approved design, pending implementation plan

## Goal

Replace the fixed bottom composer in the thesis workspace with a single,
expandable **bottom sheet** that:

- On first appearance shows a compact "peek": the selection chip, a **model
  thinking** box, and the text input.
- Drags up to reveal **all the AI tools** (sources, format, outline, view,
  export, regenerate, thinking toggle) plus **quick-action prompt presets**.
- Surfaces the AI's **live reasoning** while it works (currently streamed but
  never shown).
- Renders the model's **clarifying questions inline** in the sheet, replacing
  the separate `AskBottomSheet` (which currently fails to appear).

## Current State (what exists today)

- `components/workspace/WorkspaceComposer.tsx` — a fixed `View` pinned at the
  bottom of `app/(app)/thesis-workspace.tsx`. Shows a streaming **text** strip
  (truncated `message.content`), the selection chip, and the input. It does NOT
  show reasoning.
- `app/(app)/thesis-workspace.tsx` — the workspace screen. Top bar holds the doc
  tools (view toggle, outline, format, sources, download, maximize). It bridges
  `pendingAsk` → `bottom-sheet-store` `"ask"` → `AskBottomSheet`.
- `components/AskBottomSheet.tsx` — a `BottomSheetModal` that should present when
  the model asks a question. **It is not showing up** (see "Inline Ask").
- Data available from the stream (no server change needed for reasoning):
  - `lib/ai-service.ts` routes `onThinking` → `chat-store.appendToThinking` →
    `message.thinking`, and sets `generatingPhase` to `"thinking" | "writing"`.
  - `lib/api.ts chatSendStream` parses `[[MODK_THINK]]`, `[[MODK_ASK]]`,
    `[[MODK_FILE]]` control markers from the SSE stream.
  - `regenerateLastResponse(thesisId)` already exists in `lib/ai-service.ts`.
- Providers: `GestureHandlerRootView` + `BottomSheetModalProvider` are mounted at
  `app/_layout.tsx`, so both persistent `<BottomSheet>` and `<BottomSheetModal>`
  are supported.

### Constraints / gotchas to respect (from project memory)

- **Zustand selector loop:** select primitives individually; never return a fresh
  object/array literal from a selector (causes "Maximum update depth exceeded").
  Reuse stable `EMPTY_*` constants.
- **gorhom modals** (Sources/Outline/Ask-replacement if any remain) must be
  conditionally **unmounted** when closed and presented via a single
  `requestAnimationFrame(present)`. The new composer sheet is a **persistent**
  `<BottomSheet>` (always mounted/visible), so that rule does not apply to it.
- **RTL:** thesis content is often Arabic; `thesis.language` is unreliable. The
  workspace already computes `docRtl` from block content — reuse it so the chip,
  thinking box, and inline-ask text render with correct direction.
- **RN fetch emoji:** handled server-side already; nothing to do here.

## Architecture (Approach A — persistent sheet)

A single persistent gorhom **`<BottomSheet>`** (not a modal) pinned at the bottom
of the workspace, replacing the fixed `View`. Two snap points:

- **Collapsed** (peek): handle + selection chip + thinking box (1 line) + input row.
- **Expanded** (~55%): adds the quick-actions row + tools grid; thinking box can
  grow and scroll.

Chosen over (B) slim-bar + modal and (C) custom Reanimated because it most
directly matches "peek → drag up for tools," uses the library already in the
project, and is a single component.

### Layout integration

- The sheet renders as an overlay sibling of the document view (outside the
  `KeyboardAvoidingView`; the sheet owns its keyboard handling).
- The document scroll area (`ScrollView` / WebView container) gets
  `paddingBottom` equal to the collapsed sheet height + safe-area inset so the
  last lines aren't hidden behind the peek.
- `index`/snap is controlled via a `ref` (`BottomSheet`) and/or `index` prop.

### Auto-behaviors

| Trigger | Behavior |
| --- | --- |
| Input focused | Snap to a keyboard-aware expanded position (input above keyboard). |
| `pendingAsk` set | Auto-expand; render the question + chips in place of the input. |
| `isGenerating` true | Thinking box shows reasoning + phase label; send → Stop. |
| Turn finishes | Thinking box collapses back to the idle status line. |
| Backdrop / drag down | Returns to collapsed; never fully dismisses (it's the composer). |

## Component Breakdown

Split the composer into focused units (each independently understandable/testable):

- **`WorkspaceComposerSheet`** (`components/workspace/WorkspaceComposerSheet.tsx`)
  — the persistent `<BottomSheet>` shell: snap points, ref, keyboard handling,
  auto-expand wiring, and layout of the sub-sections below. Replaces
  `WorkspaceComposer`.
- **`ComposerThinking`** — the model-thinking box. Props: `phase`, `thinking`,
  `isGenerating`, `rtl`. Pure presentational.
- **`ComposerAsk`** — inline model question. Props: `ask`, `onAnswer`, `rtl`.
  Replaces `AskBottomSheet`.
- **`ComposerInput`** — text input + inline mic + send/stop button.
- **`ComposerQuickActions`** — horizontal preset chips (selection-scoped prompts).
- **`ComposerToolsTray`** — the tools grid; each tool a labeled icon button.

`WorkspaceComposerSheet` owns the input text state and orchestration; the rest are
presentational with callbacks. The workspace passes `thesisId`, `isLiveDoc`,
`docRtl`, the live-doc handles (downloadUrl, view-mode setter), and `handleFormat`.

## States & Behaviors (detail)

### B. Thinking box (`ComposerThinking`)

- **Idle:** muted one-line status — e.g. "Ready — ask me to write or edit this
  section." (localized).
- **Generating, phase `thinking`:** "💭 Thinking…" label + the streaming
  `message.thinking` text (the active streaming message's reasoning), scrollable,
  auto-scrolled to the latest. RTL-aware.
- **Generating, phase `writing`:** label switches to "Writing…"; reasoning stays
  visible (collapsed/scrolled) — per decision "reasoning + status," reasoning is
  primary; we do not need a separate answer preview.
- Reads the streaming message via `streamingId` from `chat-store` (select
  primitives; reuse `EMPTY_MESSAGES`).

### C. Inline Ask (`ComposerAsk`) — removes `AskBottomSheet`

- The composer subscribes to `chat-store.pendingAsk`. When set, it auto-expands
  and renders `ask.question`, the `ask.options` as chips, and an optional
  free-text row when `ask.allowFreeText`.
- On answer: call `useChatStore.getState().setPendingAsk(null)` then
  `sendMessageToAI(thesisId, answer, { selection, docBlockIndex })` — same call
  the workspace makes today.
- **Remove:** `components/AskBottomSheet.tsx` usage in the workspace; the
  `pendingAsk` → `openSheet("ask")` / `closeSheet("ask")` effect; and the
  `"ask"` entry in `bottom-sheet-store` `SheetName`. (Delete the file if nothing
  else references it.)
- **Bug-cause verification (must do before claiming fixed):** confirm `onAsk`
  actually fires — i.e. the server emits `[[MODK_ASK]]…[[/MODK_ASK]]` and
  `pendingAsk` is set. If the server never emits the ask frame, the inline UI
  won't appear either; that is a server-side issue to flag separately. Rendering
  inline removes the modal-present timing as a cause, but does not invent the
  data.

### D. Tools tray (`ComposerToolsTray`)

Tools and their wiring (all but Thinking reuse existing handlers):

| Tool | Action | Source |
| --- | --- | --- |
| Sources | open `SourcesSheet` (`openSheet("thesis-sources")`) | existing |
| Format | `handleFormat()` | existing (workspace) |
| Outline | toggle `ThesisStructureSheet` (`handleOutlineToggle`) | existing |
| View | toggle docx ⟷ outline (`setViewMode`) | existing (lift to callback) |
| Export | open `liveDoc.downloadUrl` | existing |
| Regenerate | `regenerateLastResponse(thesisId)` | existing |
| Thinking | toggle reasoning (Phase 1: local show/hide; Phase 2: server) | new |
| Edit block | navigate to focused editor route (Phase 3) | new |

- **Top bar slims** to: Back · Title · Maximize (open full .docx). The view
  toggle, outline, format, sources, download move into the tray. `setViewMode`
  must be passed into the sheet (or lifted to `workspace-store`) so the tray can
  drive it.
- Tools that require a selection/live-doc (Edit block, View, Export) are disabled
  when not applicable.

### Quick actions (`ComposerQuickActions`)

- Preset chips: **Expand**, **Rephrase**, **Add citation**, **Summarize**,
  **Improve clarity** (localized en/fr/ar).
- Tapping a preset **fills the input** with a templated, selection-scoped prompt
  and focuses it (does **not** auto-send) so the student can tweak before sending.
  Templates are constants in the component; they reference the current selection
  chip context.

### Voice dictation

- An inline **mic** button in `ComposerInput`. Phase 1 scope: wire the button and
  state; the actual speech-to-text integration (library choice) is called out as
  a sub-task in the implementation plan (candidate: `expo-speech-recognition` per
  the Expo v56 doc mandate — verify against the versioned docs before adding).

## Data / Store Changes

- `workspace-store`: optionally hold `viewMode` (`"docx" | "outline"`) and
  `thinkingEnabled` (boolean) so the tray and the workspace share them without
  prop drilling. (Alternative: pass `setViewMode` down as a callback — decide in
  the plan; storing in `workspace-store` is cleaner given multiple consumers.)
- `bottom-sheet-store`: remove `"ask"` from `SheetName`.
- `chat-store`: no schema change; the thinking box reads `pendingAsk`,
  `isGenerating`, `generatingPhase`, `streamingId`, and `messages[thesisId]`.

## Phasing

**Phase 1 — the sheet (this spec's core):**
- `WorkspaceComposerSheet` persistent bottom sheet with collapsed/expanded snaps.
- `ComposerThinking` reasoning + status (no server change).
- `ComposerAsk` inline; remove `AskBottomSheet` + the `"ask"` bridge; verify
  `onAsk` fires.
- `ComposerToolsTray` with existing tools + Regenerate + Quick-actions + Voice
  button (state only).
- Top bar slimmed.

**Phase 2 — real Thinking toggle:**
- Add a `thinking` boolean to `chatSendStream` (and `chatSend`) request bodies in
  `lib/api.ts`; thread it through `sendMessageToAI`.
- Add the field to the **modakerati-server** `/api/chat/stream` (+ `/send`) route
  so it actually gates extended reasoning. Cross-repo change — its own plan.

**Phase 3 — Edit-block sub-page:**
- New route (e.g. `app/(app)/block-editor.tsx`) taking `thesisId` + `blockIndex`.
- Loads the selected block's text, lets the student edit it manually and via AI
  (a mini composer scoped to that block), and saves back to the .docx (reuse the
  block-targeted edit path the AI already uses via `docBlockIndex`).
- Tray "Edit block" navigates here; enabled only when a block is selected.

## Files Touched (Phase 1)

- **New:** `components/workspace/WorkspaceComposerSheet.tsx`,
  `ComposerThinking.tsx`, `ComposerAsk.tsx`, `ComposerInput.tsx`,
  `ComposerQuickActions.tsx`, `ComposerToolsTray.tsx` (co-located under
  `components/workspace/`).
- **Edit:** `app/(app)/thesis-workspace.tsx` (mount the sheet, slim the top bar,
  pass view-mode/format/downloadUrl, remove the Ask bridge, pad the doc area).
- **Edit:** `stores/bottom-sheet-store.ts` (drop `"ask"`); optionally
  `stores/workspace-store.ts` (viewMode/thinkingEnabled).
- **Remove:** `components/AskBottomSheet.tsx` (if unreferenced after migration).
- **Edit:** `components/workspace/WorkspaceComposer.tsx` → superseded; delete once
  the sheet replaces it.
- i18n: add keys for quick-actions, tool labels, thinking statuses (en/fr/ar).

## Testing / Verification

- Collapsed sheet appears on workspace open with chip + status + input; doc
  content not hidden behind it.
- Drag up reveals quick-actions + tools; drag down returns to peek; never fully
  dismisses.
- Focusing the input lifts the sheet above the keyboard (iOS device + Android).
- Sending a prompt streams reasoning into the thinking box ("Thinking…" →
  "Writing…"); Stop aborts and keeps partial output.
- Triggering a model question shows the inline ask with chips; answering sends and
  clears it. (Confirm `onAsk` fires.)
- Each tray tool performs its action (sources/format/outline/view/export/regen).
- RTL Arabic thesis: chip, thinking text, and ask render right-aligned.
- No "Maximum update depth exceeded" (selector discipline held).

## Open Risks

- **Persistent sheet + keyboard:** gorhom keyboard handling for a non-modal
  `<BottomSheet>` is fiddlier than a modal; budget time to tune `keyboardBehavior`
  / snap-on-focus on a real device (simulator is unreliable, per OnlyOffice note).
- **Sheet ↔ modal coexistence:** opening Sources/Outline modals on top of the
  persistent composer sheet must not fight for the backdrop or gestures; verify
  layering.
- **`onAsk` may not fire server-side:** if so, the inline ask is correct but the
  data is missing — flag as a server task, don't claim the bug fixed without
  seeing a question render.
- **Voice STT** library/permissions are a non-trivial sub-task; keep Phase 1 to
  the button + state if integration risks slipping.
