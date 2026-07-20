# Remaining Workspace Features — Plan & Brainstorming

> **Status:** Everything from the 2026-07-19 workspace redesign spec (Part A composer, Part B Writer+Preview, and the §6 enhancements) is shipped on `master` and running. This plan covers the **remaining** items, each with its brainstorming, approach, tasks, and verification. Verification is `tsc --noEmit` + Metro bundle build (no JS test runner); native-dep features additionally need one `npx expo run:android` rebuild.

**Order (cheapest/most-verifiable → biggest):** F1 Haptics → F2 Voice → F3 Batched sync → F4 Unified AI actions → F5 Phase 2 inline formatting.

---

## F1 — Haptics

**Brainstorming.** Tactile feedback makes the app feel alive and confirms actions without looking. Where it helps: selecting/lifting a block, approving a suggestion, drag lift/drop on reorder, hitting a word milestone, and destructive confirms. Options: (a) `expo-haptics` — the Expo-standard, tiny, cross-platform (iOS Taptic + Android vibrate); (b) RN `Vibration` — crude, no patterns. **Choice: `expo-haptics`** (it's the obvious fit and already the ecosystem norm). It's a native module → needs a dev-client rebuild, but no config plugin.

**Approach.** A single wrapper `lib/haptics.ts` exposing `selection()`, `tapLight()`, `success()`, `warn()` that no-op safely off-support (try/catch). Call it at the interaction points. Keep calls sparse (over-buzzing is worse than none).

**Files.** Create `lib/haptics.ts`. Wire in: `components/workspace/DocBlock.tsx` (`pickBlock`/`longPickBlock` → selection), `components/workspace/OutlineReorderable.tsx` (drag start/drop → tapLight), `components/workspace/InlineSuggestion.tsx` (approve → success), `components/workspace/BlockContextBar.tsx` (delete confirm → warn), `components/workspace/MilestoneToast.tsx` (fire → success). `package.json` (+dep).

**Tasks.**
1. `npx expo install expo-haptics`.
2. Write `lib/haptics.ts` (thin wrapper, all methods wrapped in try/catch, respects a possible future "reduce motion"/settings flag — read from settings store if one exists, else always on).
3. Wire the 5 call sites above (one line each).
4. `tsc --noEmit` + bundle build.
5. **Rebuild note:** the user runs `npx expo run:android` once so the native module is present; until then the calls are safe no-ops in JS.

**Verification.** tsc + bundle; on-device after rebuild: feel a tick on select / approve / milestone.

---

## F2 — Voice-to-write

**Brainstorming.** Dictate content instead of typing — strong for Arabic and accessibility. The mic button already exists (shows "coming soon"). Options: (a) `expo-speech-recognition` — Expo module, **on-device** STT (iOS `SFSpeechRecognizer`, Android `SpeechRecognizer`), config-plugin + rebuild, supports locale (ar/fr/en); (b) `@react-native-voice/voice` — community, similar, less Expo-native; (c) record audio → server Whisper — no native STT but needs upload + a server transcription endpoint + latency + cost. **Choice: `expo-speech-recognition`** — on-device, low-latency, free, locale-aware (matches the app's i18n language), Expo-friendly. Needs a rebuild.

**Interaction.** Tap the mic → start listening (locale = app language); partial transcripts stream into the input as you speak; tap again (or auto-stop on silence) to stop. A pulsing mic indicates listening. Works in both the idle AI bar and the block Ask-AI input (they share `ComposerInput`).

**Files.** `lib/voice.ts` (a `useVoiceDictation` hook wrapping `expo-speech-recognition`: start/stop, partial/final text, listening state, permission request). Wire into `components/workspace/ComposerInput.tsx` (the mic `onMicPress`). `app.json`/`app.config` (config plugin + iOS `NSSpeechRecognitionUsageDescription`/`NSMicrophoneUsageDescription`, Android `RECORD_AUDIO`). i18n: `composer.listening`, permission-denied alert. `package.json`.

**Tasks.**
1. `npx expo install expo-speech-recognition`; add its config plugin + permission strings to `app.json`.
2. `lib/voice.ts` — `useVoiceDictation({ lang })` → `{ listening, start, stop, supported }`, requesting permission on first start, feeding partial results out via callback, locale from `i18n.language` (ar-DZ/fr-FR/en-US).
3. `ComposerInput.tsx` — replace the "coming soon" mic with: tap toggles dictation; while listening, append/replace the transcript into the input; pulse the mic.
4. tsc + bundle.
5. **Rebuild note:** requires `npx expo run:android` (native module + permissions). Until then the mic falls back to the "coming soon" alert.

**Verification.** tsc + bundle; on-device after rebuild: speak → text appears in the input.

---

## F3 — Batched / coalesced sync + clearer offline

**Brainstorming.** Editing is already local-first with a durable op queue that flushes when the user leaves edit mode (per the confirmed behavior), and the **Sync status chip** already ships (Saved/Syncing/Offline). What's missing: (1) rapid consecutive `editText` ops on the SAME block should **coalesce** into one before flush (fewer server round-trips, less churn — the last text wins); (2) a clear, resilient **offline mode** (queue holds and auto-retries with backoff on reconnect — largely present via the durable queue + NetInfo; verify + surface). **Caveat (from the spec):** ops use POSITIONAL indices, so coalescing must never merge across a structural op (split/merge/move/delete) — only fold adjacent same-block `editText`s with no structural op between them.

**Approach.** In the op queue (`lib/thesis-ops.ts` / `stores/thesis-doc-store.ts`), before enqueue/flush, collapse a run of trailing `editText` ops targeting the same `index` (no intervening structural op) into the latest one. Keep the server-authoritative reconcile. Confirm the offline path (NetInfo wake → drain) works and the chip reflects it.

**Files.** `lib/thesis-ops.ts` (coalesce helper), `stores/thesis-doc-store.ts` (apply coalesce in the enqueue/pump), possibly `components/workspace/SyncStatusChip.tsx` (already done — verify states).

**Tasks.**
1. Add a `coalesceOps(queue)` that folds trailing same-index `editText` runs (guarded: stop folding at any non-`editText` or different-index op).
2. Call it when enqueuing an `editText` (replace the pending tail editText for that index) OR just before a flush batch.
3. Verify offline: airplane mode → edits queue + chip "Offline"; back online → drains + "Saved ✓".
4. tsc + bundle.

**Verification.** tsc + bundle; on-device: type quickly → one flush, not many; toggle connectivity → chip + drain behave.

---

## F4 — Unified AI action approve-card

**Brainstorming.** Today only a paragraph **rewrite** gets the inline approve/edit/reject card; other AI operations (set a figure caption, insert a new paragraph, generate a new section) either refuse (fixed) or apply directly through the tool flow. The user wants **every AI action previewed as a labeled action you approve** — "Add caption: …", "Insert paragraph: …", "Rewrite: …" — not raw AI response text. This generalizes the suggestion model from `{proposed text}` to `{action, label, payload}`.

**Design decision.** Extend the block-scoped propose to return a **structured action** the AI chose, plus its content, WITHOUT applying:
- `rewrite` (paragraph) → payload `{ text }` → apply via `editText` (exists).
- `setCaption` (figure) → payload `{ caption }` → apply via a `setCaption` op (new: server sets the figure's caption).
- `insertAfter` (any) → payload `{ text }` → apply via a `splitParagraph`/insert op.
The AI is prompted to return JSON `{ action, label, content }` (constrained; never prose). The inline card shows the **label** ("➕ Add caption") + the **content** with Approve/Edit/Reject. Reuse the existing `InlineSuggestion` card, generalized. Keep it scoped to the selected block; whole-memoir stays on the chat/tool flow.

**Files.** Server `modakerati-server/src/routes/thesis.ts` (the suggest/stream endpoint → return `{ action, label, content }`; add a `setCaption` route + engine call if needed), `src/lib/thesis-doc.ts`. App `stores/suggestion-store.ts` (store `action`/`label`; apply per action on approve), `components/workspace/InlineSuggestion.tsx` (show the action label; apply the right op), `components/workspace/BlockComposer.tsx` (allow figures/tables to use the propose path now that it returns actions), `lib/thesis-ops.ts` (+`setCaption` op), `lib/thesis-suggest.ts`.

**Tasks (bite-sized, cross-repo).**
1. Server: change the propose stream to instruct the model to output a JSON action envelope (rewrite/setCaption/insertAfter) + parse it; add a `setCaption` endpoint (engine set-caption).
2. App: extend `PendingSuggestion` with `action`/`label`; `approve` dispatches the matching op (`editText` / `setCaption` / insert).
3. App: `InlineSuggestion` renders the action label + content; `BlockComposer` routes single-block Ask-AI (any kind) to propose.
4. i18n labels; tsc + bundle (app) + tsc + 401 (server).

**Verification.** tsc + bundle + server routing; on-device (needs AI): figure + "add caption" → an "Add caption: …" card → Approve sets the caption.

---

## F5 — Phase 2: inline run formatting (Bold / Italic / Underline / Color)

**Brainstorming.** The single biggest deferred item. Today `DocBlockDTO.paragraph` carries flat `text` only, so Bold/Italic/color are stubbed. To make them real, the model must carry **runs** — a paragraph is a sequence of `<w:r>` runs each with props (bold/italic/underline/color). Editing rich text in an RN `TextInput` is genuinely hard (RN has no native rich editor), so we scope carefully:
- **Render** runs with their styles (read path) — straightforward, high value (the doc finally looks right in the outline).
- **Apply** formatting to the **whole selected paragraph** (or the current caret selection range) via a `formatRun` op — the achievable editing path. Full inline-caret rich editing (bold a mid-word range while typing) is a stretch; start with paragraph-level + selection-range apply.

**Design decision.** Add an OPTIONAL `runs?: { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string }[]` to the paragraph DTO (back-compat: `text` stays as the concatenation). Server `blockToDTO` emits `runs` from `<w:r>`/`<w:rPr>`. App `DocBlock` renders `runs` (nested `<Text>` with styles) when present, else flat `text`. New op `formatRun` `{ index, range?: [start,end], marks: { bold?, italic?, underline?, color? } }` → server applies to the run(s) in range (splitting runs as needed via the engine). The pill's Bold/Italic/Color un-stub and call `formatRun` on the selection (or whole paragraph if no range).

**Files.** Server `src/lib/thesis-doc.ts` (emit `runs`), the engine (a `formatRunRange` / run-splitting helper in `mdocxengine` if not present — may be a real engine change), a `formatRun` route in `src/routes/thesis.ts`. App `lib/api.ts` is do-not-touch → the `runs` field is read defensively (or added to a new types file); `components/workspace/DocBlock.tsx` (render runs), `EditableParagraph` (preserve runs on edit — tricky; MVP: editing a run-formatted paragraph may flatten to plain text with a warning, or keep runs read-only until a range is formatted), `components/workspace/BlockContextBar.tsx` (un-stub Bold/Italic/Color → `formatRun`), `lib/thesis-ops.ts` (+`formatRun` op).

**Tasks (large — likely its own execution pass).**
1. Engine/server: emit `runs` per paragraph; add a `formatRun` engine op + route (split runs at range boundaries, set rPr marks).
2. App render: `DocBlock` renders `runs` with styles.
3. App op: `formatRun` optimistic patch (toggle marks on the run range) + executeOp → route.
4. Pill: un-stub Bold/Italic/Underline/Color → dispatch `formatRun` on the current selection/paragraph; show active state from the runs.
5. Editing reconciliation: define what happens when a run-formatted paragraph is inline-edited (MVP: on text edit, keep it simple — re-run from server; document the limitation).
6. tsc + bundle (app) + tsc (server).

**Scope note.** **Real tables** (borders/widths/merged cells editing) and **equations/math** are even larger (a table-grid editor and an equation model) and are **explicitly out of scope for F5** — noted for a future plan. F5 delivers inline run formatting only.

**Verification.** tsc + bundle + server tsc; on-device: a bold/colored run in the doc renders styled in the outline; selecting text + Bold applies and persists (visible in Word/PDF preview too).

---

## Execution notes

- **Native rebuild:** F1 + F2 add native modules → after wiring, the user runs `npx expo run:android` once. Everything else hot-reloads.
- **Cross-repo:** F4 + F5 touch `modakerati-server` (hot-reloads via tsx watch) and possibly `mdocxengine` (rebuild the engine for the server to see changes).
- **Do-not-touch app files:** `app/(app)/template-picker.tsx`, `app/(tabs)/chat.tsx`, `lib/ai-service.ts`, `lib/api.ts`, `lib/chat-cache.ts`, `stores/chat-store.ts` (others' WIP) — new API calls go in new files.
- Each feature is committed independently with exact paths; tsc + bundle gate every commit.
