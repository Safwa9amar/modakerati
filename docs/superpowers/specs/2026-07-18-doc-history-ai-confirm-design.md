# Document History (Undo/Redo) + Hard-Gated AI Confirmations — Design

**Date:** 2026-07-18
**Status:** Approved
**Scope:** `modakerati-server` (history table + snapshot capture + endpoints +
tool-loop confirmation gate), `modakerati` app (undo/redo UI, AI-turn revert
chip, version-history sheet, confirm UI)

## Problem

The thesis lives as ONE .docx object in Supabase Storage, overwritten in place
on every edit (`document-storage.ts:19-21` — "edits overwrite in place, so the
path never changes"). There is no version history anywhere: no history table,
no snapshots, no soft-delete. When the AI misfires — and it does; it has
deleted pages and blocks — the content is gone permanently.

The existing "AI asks before destructive changes" behavior is pure prompt
engineering (`types.ts:142-155`, `:296-307`, `:323-328` + tool-description
warnings). The model *chooses* to call `ask_user`; nothing in code prevents a
destructive tool from executing unconfirmed.

## Decisions (from brainstorm)

1. **Snapshot ring buffer** — whole-.docx snapshots per commit, not inverse
   ops. The engine has no diff/delta API (`zip.toBuffer()` only), and several
   paths are whole-doc rewrites (`/format`, `/apply`, `make_thesis_ready`,
   OnlyOffice saves) that no op-log could invert. Snapshots cover every path.
2. **Hard server gate** for destructive AI tools — the tool loop refuses to
   execute them without a user tap that reaches the server. Prompt rules stay
   but become a courtesy, not the enforcement.
3. **Retention: last 20 states per thesis**, deduped by content hash, pruned
   with their storage objects.
4. **All three undo surfaces**: header undo/redo arrows, an "Undo AI changes"
   chip after mutating AI turns, and a version-history sheet.

## Design — server

### 1. `thesis_doc_history` table (Drizzle, `src/db/schema.ts`)

| column        | type      | notes                                              |
|---------------|-----------|----------------------------------------------------|
| `id`          | uuid pk   |                                                    |
| `thesisId`    | uuid fk   | → `theses.id`, cascade delete                      |
| `seq`         | bigint    | monotonic per thesis (max+1 inside the lock)       |
| `storagePath` | text      | `{userId}/{docId}.history/{seq}.docx`              |
| `docHash`     | text      | reuses the RAG content-hash helper for dedupe      |
| `label`       | text      | human description: "AI: delete_block ×3", "OnlyOffice save", "Restored to #12" |
| `source`      | text      | `ai \| manual \| onlyoffice \| restore \| import`  |
| `turnId`      | text null | chat turn that produced the edit (AI source only)  |
| `sizeBytes`   | int null  |                                                    |
| `createdAt`   | timestamp |                                                    |

Plus `theses.historyCursorSeq` (bigint, null = at tip) for undo/redo position.

### 2. Snapshot capture — one shared persist helper

New `persistThesisDocx(ctx)` in `src/lib/` that performs, in order:

1. **Snapshot**: Supabase Storage server-side `copy(docPath → historyPath)` of
   the CURRENT object — the hot engine mutates in memory, so the object in
   storage at this moment IS the pre-edit state. No bytes flow through Hono.
   Skipped when the newest history row has the same `docHash`. Best-effort: a
   failed copy logs loudly (with thesisId) but never blocks the edit.
2. `uploadDocx` (existing upsert overwrite).
3. `scheduleReconcile` (existing RAG hook).
4. `commitThesisEngine` (existing atomic `updatedAt` bump,
   `thesis-engine-cache.ts:103-128`).
5. **Prune**: delete history rows beyond 20 per thesis + their storage
   objects (async, non-blocking).
6. **Truncate redo tail**: if `historyCursorSeq` is non-null (user had
   undone), delete rows with `seq > cursor`, then reset cursor to null —
   standard editor semantics: a new edit kills redo.

All call sites refactor onto it (this also removes today's duplication —
every REST handler inlines its own persist sequence):

- AI tools: `persistDoc` inside `withThesisDoc` (`doc-tools.ts:85-97`).
- All block-edit REST handlers in `src/routes/thesis.ts` (paragraphs, bulk,
  blocks/delete, blocks/move, image insert/replace/remove-bg,
  start-on-new-page, page-setup).
- The four odd paths that bypass `commitThesisEngine` today: `/apply`
  (`thesis.ts:1150`), `/format` (`thesis.ts:1202`), the OnlyOffice save
  callback (`onlyoffice.ts:71`), and import/re-seed/combine uploads
  (snapshot only when a previous object exists; label `import`).

Everything already runs inside `withThesisLock`, so seq allocation, capture,
and pruning are race-safe across instances. The lock is not reentrant — the
helper is called from within already-locked sections, never re-acquires.

Thesis deletion (`DELETE /:id`) additionally removes the
`{userId}/{docId}.history/` storage prefix.

### 3. Undo/redo/restore endpoints

All inside `withThesisLock`; all echo the full `document` DTO (via engine
reload) so the app reconciles in one round-trip; all `scheduleReconcile`.

- `GET  /api/thesis/:id/history` → `{ entries: [{seq,label,source,createdAt,sizeBytes}], cursorSeq, canUndo, canRedo }`
- `POST /api/thesis/:id/history/undo` — if cursor is null (at tip): snapshot
  the current doc first (source `restore`, label "Before undo") so redo can
  return, then restore the newest row PRIOR to that snapshot and set cursor
  to it. If already undone: restore the next-older row, move cursor back.
- `POST /api/thesis/:id/history/redo` — restore the next-newer row; cursor
  forward; cursor null when back at tip.
- `POST /api/thesis/:id/history/restore {seq}` — jump anywhere (history
  sheet, AI-turn revert). Snapshots current state first if at tip.

Restore mechanics: storage `copy(historyPath → docPath)` →
`invalidateThesisEngine` → `getThesisEngine` (fresh load) →
`commitThesisEngine` → `buildDocumentDTOFromEngine`.

Edit-endpoint echoes gain a small `history: { canUndo, canRedo }` field so
the app's header buttons stay live without polling.

### 4. AI turn checkpoints

No extra copies: every tool commit already snapshots its pre-edit state. The
chat tool loop stamps the current `turnId` on snapshots (threaded through
`withThesisDoc` → `persistThesisDocx`). "The checkpoint for turn T" = the
EARLIEST history row with that `turnId`.

When a turn mutated the doc, the final stream frame includes
`docChanges: { turnId, checkpointSeq, tools: [...], blocksDeleted }` (a new
`[[MODK_DOCCHANGES]]` frame alongside the existing `[[MODK_ASK]]` pattern,
`api.ts:232` app-side). "Undo AI changes" = `restore { seq: checkpointSeq }`.

### 5. Hard confirmation gate

`DESTRUCTIVE_DOCX_TOOLS` set in `src/lib/ai/mcp-bridge.ts` (initial list):
`delete_block`, `replace_text`, `make_thesis_ready`, `set_header`,
`set_footer`, `set_section_header`, `set_section_footer`,
`front_matter_numbering`. The header/footer tools gate only when overwriting
existing content (cheap engine read before gating); the rest gate always.

Flow, implemented in the tool loop (`tool-loop.ts`) where `ask_user` is
already intercepted (`:389-446`):

1. Model calls a gated tool → the loop does NOT execute it. It stores the
   exact args as a **pending action** in a new TTL'd table
   `pending_tool_actions` (`id`, `userId`, `thesisId`, `toolName`, `argsJson`,
   `expiresAt` ~10 min, `createdAt`) — DB-backed so multi-instance-safe.
2. The turn ends with a structured `confirmAction` payload (typed sibling of
   `AskPayload`, new `[[MODK_CONFIRM]]` frame): `{ actionId, toolName,
   preview }` where `preview` is a human-readable localized description built
   server-side from the args + current doc ("Delete 3 blocks: 'إهداء' …").
3. **Confirm**: app calls `POST /api/chat/confirm-action { actionId }`. The
   server executes the STORED args (the model cannot alter them
   post-approval) through the normal tool path — snapshotting as usual — then
   continues the conversation with an injected turn ("user approved; tool
   result: …") through the existing streaming completion so the AI wraps up
   naturally.
4. **Cancel**: `POST /api/chat/cancel-action { actionId }` deletes the
   pending action and continues the conversation with "user declined".

Rejected alternative: letting the model retry with a `confirmed: true` flag
after an `ask_user` round-trip — that still trusts the model to interpret the
user's answer honestly, which is the exact failure being fixed.

The existing `ask_user` prompt rules (link-or-separate etc.) are unchanged —
they handle *semantic* questions; the gate is the structural backstop for
*destructive* ones. Prompt text gets one addition: gated tools are described
as "will pause for user approval", so the model phrases its message
accordingly instead of claiming the edit already happened.

## Design — app

### 6. Applying a restored document

New `applyRestoredDoc(thesisId, document)` on `thesis-doc-store`:
`setDoc(thesisId, document)` (bumps `tick` → WordDocxView's `__refresh`
pipeline reloads; outline re-renders) + bump `drainTick`/`refreshEditorCfg`
so OnlyOffice/PDF re-key (`docVersionKey`). Undo/redo/restore actions are
DISABLED while `pending > 0` (unflushed queue ops would replay against stale
indices — mirrors the existing 4xx-recovery rule, `thesis-doc-store.ts:174`);
the buttons show enabled again on queue drain.

### 7. Three surfaces

- **Header arrows** (`app/(app)/thesis-workspace.tsx` header, beside the view
  switcher): Undo/Redo icon buttons, enabled from the latest
  `history.canUndo/canRedo` echo (plus one `GET /history` on load). Tap →
  endpoint → `applyRestoredDoc`.
- **"Undo AI changes" chip**: chat store keeps `lastDocChanges` parsed from
  the `[[MODK_DOCCHANGES]]` frame; when set, a chip renders in the composer
  area (same surface as `ComposerAsk`) — tap → `restore {checkpointSeq}` →
  `applyRestoredDoc` → chip clears. Cleared also when a newer turn arrives.
- **Version history sheet**: gorhom bottom sheet, conditionally UNMOUNTED
  when closed + single `requestAnimationFrame(present)` (the established
  pattern). Lists entries (localized label, relative time, source icon);
  restore button per entry with a native confirm dialog. Opened from a
  History button in the workspace header overflow.

### 8. Confirm UI

`ComposerAsk` gains a `confirm` variant driven by a `pendingConfirm` field in
the chat store (parallel to `pendingAsk`): destructive-styled Approve/Cancel
chips + the server-built preview text. Approve/Cancel call the
confirm/cancel endpoints (NOT a chat message send); the continuation streams
back through the normal message pipeline. Shown in both the workspace
composer sheet and the standalone chat screen (`AskBottomSheet` variant).

Copy change: the bulk-delete dialog's "This can't be undone"
(`WorkspaceComposerSheet.tsx:335`) becomes "You can undo this from History".

All new strings trilingual (en/fr/ar), RTL-safe.

## Out of scope

- The standalone `documents` entity (`src/routes/documents.ts`) keeps no
  history — theses only.
- Byte-level diffing / delta storage (engine has no delta API; whole-file
  snapshots are the unit). Worst case ≈ 20 × docx size per thesis,
  self-pruning.
- Offline undo (undo requires the server; the app's durable op queue is
  unchanged).

## Testing

- Server: unit/integration tests for ring-buffer capture (dedupe, prune,
  redo-tail truncation), cursor semantics (undo→undo→edit→redo dead),
  restore DTO echo, gate behavior (gated tool never executes without
  confirm; stored args execute verbatim; TTL expiry), OnlyOffice-path
  snapshot.
- App: `npx tsc --noEmit` + manual run-through (no JS test runner):
  undo/redo from header, AI-turn revert, history sheet restore, confirm
  chips round-trip, queue-pending disable state.
