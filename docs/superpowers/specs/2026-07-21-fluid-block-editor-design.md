# Fluid Block Editor (smoother + faster typing) — Design

**Date:** 2026-07-21
**Status:** Draft, pending user review

## Summary

Make the workspace **Writer** editing surface feel smooth and fast — without
changing the block model or the formatting **bubble/pill** system. Three concerns,
all app-only, no server work:

1. **Seamless Enter** — pressing Enter creates a real paragraph block, but only the
   blocks that actually moved re-render (today every Enter re-renders the whole
   document), and the keyboard never dips during the split hand-off.
2. **Live direction** — each paragraph reads its own script *as you type*, so an
   Arabic line flows right and a Latin line flows left on the first strong
   character, with the caret on the correct side (incl. Android).
3. **Typing stays cheap** — lock in the invariant that a keystroke touches only the
   local input, never the store or the network, and confirm no incidental
   full-list re-render undoes concern #1.

### Locked decisions (from brainstorming)

- **Keep the bubble/pill system exactly as-is.** Alignment and direction *controls*
  stay in `BlockContextBar` / `FloatingPill`. No toolbar redesign, no always-visible
  cluster. This spec does **not** touch `BlockContextBar.tsx`.
- **Stay block-based.** The op queue, docx-engine round-trip, AI block-targeting,
  RAG chunking and inline images/tables all key off block indices; OnlyOffice
  already covers full live-WYSIWYG. No WebView, no single giant `TextInput`.
- **Selection-level inline formatting is out of scope** (bold-just-the-word). It is
  the only server-touching piece and is deliberately excluded; it can get its own
  spec later.

### Non-goals

- No change to the formatting bubble, docked bar, or floating pill.
- No new ops, no server/engine changes, no DB changes.
- No soft line-breaks (Shift+Enter) — Enter = new paragraph, matching the doc model.
- No change to the debounce/coalescing or the composing sync gate.

## Root cause (why Enter feels janky today)

`applyOpToBlocks` → `splitParagraph` (and `move`/`delete`/`insertImage`) run through
`reindex` in [`lib/thesis-ops.ts`](../../../lib/thesis-ops.ts):

```ts
const reindex = (blocks) => blocks.map((b, i) => ({ ...b, index: i }));
```

This spreads **every** block into a fresh object, so every block gets a new
reference on every structural op. `DocBlock` is `React.memo`'d on its `block` prop
([`components/workspace/DocBlock.tsx`](../../../components/workspace/DocBlock.tsx)),
so a full-document re-render fires on each Enter. In a long thesis that is the pause
you feel — and it also delays the incoming block's `autoFocus`, which is what lets
the keyboard dip. Fixing the re-render fixes both symptoms.

## Architecture — changes by file

### §A · Seamless Enter

**A.1 — Stable-identity reindex** (`lib/thesis-ops.ts`)

Preserve a block's reference when its index did not move:

```ts
const reindex = (blocks) => blocks.map((b, i) => (b.index === i ? b : { ...b, index: i }));
```

- Blocks **before** the edit point keep their reference → `React.memo` skips them.
- Blocks **at/after** the edit point legitimately shift index → new object → they
  re-render (required: their `index` — used for selection/AI targeting — changed).
- Typing at the end of a doc (the common case) now re-renders ~2 blocks.
- Safe: the only structural op that also changes text is `splitParagraph`, and its
  `before`/`after` blocks are already re-created with `{ ...b, text }` **before**
  `reindex` runs, so this optimization never returns a stale-text block. `editText`
  does not go through `reindex`. No consumer relies on identity *changing* for
  correctness — only `React.memo` reads it, and it reads it for skipping.
- Benefits `move`, `deleteBlocks` (incl. Backspace-merge) and `insertImage` for free.

**A.2 — Focus continuity across the hand-off**
(`components/workspace/DocBlock.tsx`, `EditableParagraph`)

The split/merge hand-off already:
- sets `handedOffRef` so the outgoing `commit`/`onBlur` won't fight the split,
- moves editing via `setEditingBlock(index±1, offset)`,
- seeds the incoming caret via `pendingCaret` + `selection`,
- focuses the incoming input via `autoFocus` + a `requestAnimationFrame` backstop,
- guards `onBlur` with `if (ws.editingBlockIndex !== block.index) return;` so the
  outgoing blur cannot clear edit mode after editing has moved on.

With A.1 the commit is now light, so `autoFocus` lands on the same commit the
outgoing input unmounts and the keyboard stays up. **Deliverable here is
verification + hardening**, not new machinery: confirm on device that the keyboard
does not dip on Enter or on Backspace-merge, and that the caret lands at offset 0
(split) / end-of-previous (merge). Remove the transient single-newline frame if it
is visible (the `\n` briefly present in `value` before `doSplit` fires).

**Documented fallback (not built now):** if device QA still shows a keyboard dip,
escalate to a *single persistent editor input* reused across blocks (one mounted
`TextInput` repositioned over the active block) so focus never transfers. Recorded
as the escalation path; out of scope unless A.1+A.2 prove insufficient.

### §B · Live direction (`EditableParagraph`)

Today direction is computed once at mount from `block.text` and Android drops
`writingDirection` on the editing input
([`DocBlock.tsx:447`](../../../components/workspace/DocBlock.tsx#L447),
[`:569`](../../../components/workspace/DocBlock.tsx#L569)).

- **Derive from the live value:** `const dir = block.direction ?? detectDir(value, rtl)`
  so the paragraph snaps to the correct side on the first strong character typed.
  An explicit paragraph direction (set from the bubble → `block.direction`, i.e.
  `w:bidi`) still wins as an override.
- **Own the effective alignment from live `dir`:** `EditableParagraph` computes its
  own `textAlign` mirroring the read-path rule (`block.alignment` wins; else
  heading → start-edge from live `dir`; else body → `justify`) instead of trusting
  the parent's mount-time value, so a heading that changes script re-aligns live.
- **Android caret fix:** apply `writingDirection: dir` on the editing input on
  **both** platforms. The read-path Android caveat (pinning `writingDirection`
  disables `justify` on Fabric) does not apply here because the live editing input
  is not justified while composing; setting it fixes the Arabic caret starting side.
  **QA-gated fallback:** if Android still misplaces the caret on an empty RTL
  paragraph, fall back to a leading directional mark / explicit `textAlign` for the
  empty case only.

Note (intentional): the read path still justifies body paragraphs; while *editing*,
`justify` continues to behave (last line is start-aligned), so no jarring
edit↔read alignment switch is introduced by §B.

### §C · Typing stays cheap (verify + lock in)

Confirm and document the existing local-first invariant so §A's win is not silently
undone:

- A keystroke updates only `EditableParagraph`'s local `value` state; the store is
  hit only by the **900 ms debounced** `editText` commit, and the op pump is **held
  while composing** (composing sync gate) — so no thesis API call fires mid-typing.
- The debounced commit patches a **single** block (`editText` case), and with §A.1
  every other block keeps its reference → the list does not reconcile.
- Verify `OutlineReorderable` passes stable block references straight from the store
  (no per-render `.map` that clones blocks) and that its row renderer is memoized so
  the §A.1 reference-stability actually reaches `DocBlock`.

No code change is expected in §C beyond small guards if verification finds a leak
(e.g. a stray inline object prop that breaks memo).

## Edge cases

- **Split at doc start / merge at index 0:** unchanged from today (`onKeyPress`
  Backspace guard `if (block.index === 0) return;` stays).
- **Mixed-script paragraph:** first strong character wins (the existing `detectDir`
  first-strong heuristic); punctuation/digits-only falls back to the thesis default.
- **Direction override present:** `block.direction` set via the bubble is respected
  and not overridden by live detection.
- **Reconcile mid-edit:** the server echo replaces blocks wholesale on drain, but
  that is held during composing and gated by `baselineRef`, so it cannot reset the
  caret; `value` (local state) remains the source of truth while editing.

## Verification

No JS test runner in this app (project convention) → `npx tsc --noEmit` + on-device
QA. Checklist:

- **Fast:** Enter in the middle of a long thesis feels instant; only the affected
  rows update (spot-check with a render counter / Reanimated devtools if needed).
- **Smooth:** no keyboard dip on Enter or Backspace-merge; caret lands correctly.
- **Direction:** typing Arabic flips the line right on the first letter; Latin flips
  left; Android caret starts on the correct side for both.
- **No regressions:** bubble/pill formatting (bold/italic/align/direction/style),
  offline op replay, undo/redo, and docx round-trip still behave.

## Risks & fallbacks

| Risk | Mitigation |
| --- | --- |
| Keyboard still dips after A.1+A.2 | Persistent single-input fallback (documented, not built) |
| Android caret still wrong on empty RTL para | Leading directional mark / explicit `textAlign` for the empty case |
| Live `writingDirection` change causes a caret jump mid-line | Only flips on first strong char (rare after that); QA-gate; keep override path |
| A stray non-memo-safe prop in `OutlineReorderable` undoes A.1 | §C verification catches it; fix the prop |

## Out of scope (recorded for later)

- Selection-level inline formatting (`formatRange` op + `thesis-inline-format.ts`
  run-splitting) — its own future spec.
- Any change to `BlockContextBar` / `FloatingPill` / docked bar.
