# Fluid Block Editor (smoother + faster typing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Writer editing surface feel smooth and fast — kill the full-document re-render on Enter, keep the keyboard from dipping on the split hand-off, and make paragraph direction live as you type — without touching the formatting bubble/pill or the server.

**Architecture:** Three small, independent app-only changes: (1) preserve block object identity in the optimistic `reindex` so `React.memo(DocBlock)` skips unchanged rows; (2) derive direction + alignment in `EditableParagraph` from the *live* input value (and apply `writingDirection` on Android to fix the Arabic caret side); (3) verify the memo win reaches the list and that typing stays local. No new ops, no server/engine/DB changes, no `BlockContextBar` changes.

**Tech Stack:** React Native (New Architecture / Fabric), Expo v56, Zustand, `react-native-reorderable-list`. Spec: [`docs/superpowers/specs/2026-07-21-fluid-block-editor-design.md`](../specs/2026-07-21-fluid-block-editor-design.md).

---

## IMPORTANT — this app has NO JS test runner

Per project convention, the Expo app has no jest/vitest. **Do not** write or run automated unit tests. The verification gate for every code task is:

1. `npx tsc --noEmit` from the repo root (`/Users/hamzasafwan/modakerati`) — expect **no new errors** (the tree may already have pre-existing errors from unrelated WIP; compare against a baseline, don't introduce new ones).
2. The device-QA checklist in Task 4 (run the app: `npx expo start`).

## Git hygiene (repo runs parallel Claude sessions)

- `git add` **exact paths only** — never `git add -A`/`.`. The working tree has unrelated WIP (`thesis-workspace.tsx`, `BlockContextBar.tsx`, `FloatingPill.tsx`, `OutlineReorderable.tsx`) that must NOT be staged.
- Fresh commits only — **never** `git commit --amend`.
- Re-check `git status` if anything looks interrupted.
- End every commit message with the trailer shown in each commit step.

## File Structure

- **Modify** [`lib/thesis-ops.ts`](../../../lib/thesis-ops.ts) — one line, the `reindex` helper. Responsible for the optimistic block-list patches; this is the identity-stability fix (Task 1).
- **Modify** [`components/workspace/DocBlock.tsx`](../../../components/workspace/DocBlock.tsx) — `EditableParagraph` (live direction/align + Android `writingDirection`) and its call site in `DocBlockInner` (drop the now-internal `textAlign` prop). Responsible for one editable paragraph (Task 2).
- **Verify only** [`components/workspace/OutlineReorderable.tsx`](../../../components/workspace/OutlineReorderable.tsx) — already memoized correctly; Task 3 confirms the Task 1 win reaches it. Expected: **no code change**.

---

### Task 1: Stable-identity reindex (§A.1 — the core "fast" fix)

**Files:**
- Modify: `lib/thesis-ops.ts:136` (the `reindex` arrow)

**Why:** `reindex` currently spreads every block into a new object on every structural op, so every block gets a new reference and `React.memo(DocBlock)` misses → the whole document re-renders on each Enter. Preserving the reference when a block's index didn't move lets memo skip the unchanged prefix.

- [ ] **Step 1: Read the current helper**

Confirm `lib/thesis-ops.ts:136` reads exactly:

```ts
const reindex = (blocks: DocBlockDTO[]): DocBlockDTO[] => blocks.map((b, i) => ({ ...b, index: i }));
```

- [ ] **Step 2: Replace it with the identity-preserving version**

```ts
// Reindex after a structural change — the DTO `index` is a block's position.
// Preserve a block's REFERENCE when its index didn't move, so React.memo(DocBlock)
// skips the unchanged prefix instead of reconciling the whole document on every
// split/move/delete. splitParagraph re-creates its before/after blocks (with new
// text) BEFORE calling reindex, so an unchanged index never returns stale text.
const reindex = (blocks: DocBlockDTO[]): DocBlockDTO[] =>
  blocks.map((b, i) => (b.index === i ? b : { ...b, index: i }));
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors introduced by this change.

- [ ] **Step 4: Commit**

```bash
git add lib/thesis-ops.ts
git commit -m "$(cat <<'EOF'
perf(workspace): preserve block identity in optimistic reindex

Keep a block's object reference when its index didn't move so
React.memo(DocBlock) skips unchanged rows — stops the full-document
re-render on every Enter/split/move/delete. Fixes janky Enter at the root.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Live direction + alignment in the editing input (§B)

**Files:**
- Modify: `components/workspace/DocBlock.tsx` — `EditableParagraph` (signature `433-445`, `dir` at `447`, style at `567-571`) and the `isEditing` call site in `DocBlockInner` (`334-350`).

**Why:** Today `EditableParagraph` computes direction once at mount from `block.text` and drops `writingDirection` on Android. Deriving from the live `value` makes the paragraph snap to the correct side on the first strong character typed; applying `writingDirection` on both platforms fixes the Arabic caret starting side. The read-path `<Text>` is untouched (its delicate Android-justify logic stays exactly as-is).

- [ ] **Step 1: Remove the `textAlign` prop from the call site**

In `DocBlockInner`'s `isEditing` branch (`components/workspace/DocBlock.tsx:334-350`), delete the `textAlign={textAlign}` line so it reads:

```tsx
  if (isEditing) {
    return (
      <View style={styles.paraWrap}>
        <EditableParagraph
          block={block}
          rtl={rtl}
          thesisId={thesisId}
          textStyle={
            isHeading
              ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(block.level, 4) as 1 | 2 | 3 | 4] }
              : styles.body
          }
        />
      </View>
    );
  }
```

(The `textAlign` computed above in `DocBlockInner` at lines `302-316` is still used by the read-path `<Text>` below — leave it there.)

- [ ] **Step 2: Update the `EditableParagraph` signature**

Change the params (`components/workspace/DocBlock.tsx:433-445`) — remove `textAlign`:

```tsx
function EditableParagraph({
  block,
  rtl,
  thesisId,
  textStyle,
}: {
  block: Extract<DocBlockDTO, { kind: "paragraph" }>;
  rtl: boolean;
  thesisId: string;
  textStyle: TextStyle;
}) {
```

- [ ] **Step 3: Derive `dir` + `textAlign` from the live value**

Delete the old mount-time line at `447`:

```tsx
  const dir = block.direction ?? detectDir(block.text, rtl);
```

Then, immediately AFTER the `value` state is declared (`const [value, setValue] = useState(block.text);`, line `449`), insert:

```tsx
  // Direction + alignment are derived from the LIVE value (not the mount-time
  // block.text) so the paragraph flips to the correct side on the first strong
  // character typed. An explicit paragraph direction (bubble → w:bidi) overrides.
  const dir = block.direction ?? detectDir(value, rtl);
  const isHeading = block.level >= 1;
  // Mirror the read-path w:jc rule, but with the live dir: explicit alignment wins;
  // else headings align to the start edge, body justifies (justify's last line is
  // start-aligned, so there's no jarring edit↔read switch).
  const textAlign: "left" | "right" | "center" | "justify" =
    block.alignment === "center"
      ? "center"
      : block.alignment === "left"
        ? "left"
        : block.alignment === "right"
          ? "right"
          : block.alignment === "both"
            ? "justify"
            : isHeading
              ? dir === "rtl"
                ? "right"
                : "left"
              : "justify";
```

- [ ] **Step 4: Apply `writingDirection` on both platforms**

Change the `TextInput` style (`components/workspace/DocBlock.tsx:567-571`) from:

```tsx
      style={[
        textStyle,
        { textAlign, padding: 0, ...(Platform.OS === "android" ? null : { writingDirection: dir }) },
      ]}
```

to:

```tsx
      style={[
        textStyle,
        // writingDirection on BOTH platforms: the live editing input is never
        // justified while composing, so the read-path Android-justify conflict
        // doesn't apply here — setting it fixes the Arabic caret starting side.
        { textAlign, padding: 0, writingDirection: dir },
      ]}
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors. (If `Platform` becomes unused, it isn't — it's still used by the read path's `androidJustify` at lines `326`/`395`. Leave the import.)

- [ ] **Step 6: Commit**

```bash
git add components/workspace/DocBlock.tsx
git commit -m "$(cat <<'EOF'
feat(workspace): live per-paragraph direction while editing

Derive direction + alignment in EditableParagraph from the live input
value so a paragraph flips RTL/LTR on the first strong char typed, and
apply writingDirection on Android to fix the Arabic caret side. Read path
untouched; bubble controls unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Verify the memo win reaches the list + typing stays local (§C)

**Files:**
- Verify: `components/workspace/OutlineReorderable.tsx` (expected: no change)
- Temporary instrumentation: `components/workspace/DocBlock.tsx` (added then removed within this task)

**Why:** Task 1 only helps if `OutlineReorderable` forwards stable block references to `DocBlock` and the row stays memoized. Reading the file confirms it already does (`Row` is `memo`'d; `renderItem` is a stable `useCallback`; `data` items are the store's block refs). This task proves it at runtime and confirms a keystroke doesn't reconcile the list.

- [ ] **Step 1: Add a temporary render counter**

At the very top of `DocBlockInner` (`components/workspace/DocBlock.tsx`, first line inside the function body, before `const colors = useThemeColors();`), add:

```tsx
  if (__DEV__) console.log("[DocBlock render]", block.index, block.kind);
```

- [ ] **Step 2: Observe end-of-doc Enter**

Run the app (`npx expo start`), open a long thesis in Writer view, tap the LAST paragraph, type a word, and press Enter.
Expected: only a small number of `[DocBlock render]` lines fire (the split paragraph + the new empty block, plus any rows still on screen after it) — **not** one line per block in the document. Before Task 1 this logged every block.

- [ ] **Step 3: Observe mid-doc typing**

Tap a paragraph in the middle and type several characters (do not press Enter).
Expected: **no** `[DocBlock render]` lines fire while typing between the debounced commits (typing lives in `EditableParagraph`'s local `value` state; the store is untouched until the 900 ms `editText` commit, which is itself held by the composing sync gate). A single line may fire ~900 ms after you stop, for that one block only.

- [ ] **Step 4: Remove the instrumentation**

Delete the `if (__DEV__) console.log(...)` line added in Step 1. Confirm no other debug logging was left behind.

- [ ] **Step 5: Type-check**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit (only if any code changed)**

`OutlineReorderable` should need no change. If verification surfaced a real memo leak (e.g. an inline object prop breaking `Row`'s memo) and you fixed it, commit that fix:

```bash
git add components/workspace/OutlineReorderable.tsx
git commit -m "$(cat <<'EOF'
perf(workspace): keep block refs stable through the outline list

<describe the specific leak fixed>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

If nothing changed, skip the commit (the instrumentation was added and removed within this task, so there's nothing to stage).

---

### Task 4: Device-QA acceptance pass (all sections)

**Files:** none (manual verification against a real device / simulator).

Run the app and walk the full checklist. This replaces the automated-test gate the app doesn't have.

- [ ] **Step 1: Fast** — In a long thesis, press Enter at the end of a paragraph. It feels instant (no visible pause / no frame drop). Repeat mid-document.

- [ ] **Step 2: Smooth Enter** — Pressing Enter does not make the keyboard dip/flicker; the caret lands at the start of the new paragraph, focused, ready to type.

- [ ] **Step 3: Smooth merge** — Backspace at the very start of a paragraph merges it into the previous one without a keyboard dip; the caret lands at the join point.

- [ ] **Step 4: Live direction** — In a fresh empty paragraph, type an Arabic word → the line snaps to the right on the first letter. In another, type a Latin word → it stays left. The caret sits on the correct side of the text in both.

- [ ] **Step 5: Android caret** — On an Android device, repeat Step 4: the caret starts on the right for an empty/Arabic paragraph and text flows RTL correctly. (If it still misplaces the caret on an *empty* RTL paragraph, apply the spec's fallback: a leading directional mark / explicit `textAlign` for the empty case only — note it and raise it before shipping.)

- [ ] **Step 6: Direction override intact** — Set a paragraph's direction from the bubble (RTL/LTR toggle); it holds and is not overridden by live detection as you keep typing.

- [ ] **Step 7: No regressions** — Bubble/pill formatting (bold/italic/underline, align, direction, style/heading), figure/image and table selection, offline edit replay, undo/redo, and the docx/PDF preview round-trip all still behave as before.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §A.1 stable reindex → Task 1. ✅
- §A.2 focus continuity → delivered by Task 1 (light commit lets `autoFocus` land) + verified in Task 4 Steps 2–3; documented persistent-input fallback stays out of scope unless QA fails. ✅
- §B live direction + Android caret → Task 2; QA in Task 4 Steps 4–5. ✅
- §C typing-stays-cheap verification → Task 3. ✅
- Non-goals (no bubble change, no ops, no server) → respected; only `thesis-ops.ts` `reindex` and `DocBlock.tsx` `EditableParagraph` are modified. ✅

**Placeholder scan:** none — every code step shows the exact before/after; the only `<describe…>` is inside a *conditional* commit that only runs if a real leak is found (Task 3 Step 6).

**Type consistency:** `EditableParagraph` loses the `textAlign` prop in both its signature (Task 2 Step 2) and its sole call site (Task 2 Step 1); `dir`/`textAlign`/`isHeading` are all defined before use inside the component (Task 2 Step 3). `reindex` keeps its `(blocks: DocBlockDTO[]) => DocBlockDTO[]` signature (Task 1).
