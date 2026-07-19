# Outline-Mode Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the same Word-like inline paragraph editing to the native **outline** view (`OutlineReorderable`/`DocBlock`) that already ships in the docx-preview view — tap→select, tap-again→edit, live save, Enter-splits, Backspace-at-start-merges.

**Architecture:** App-only. Reuses the existing ops (`editText`, `splitParagraph`, `deleteBlocks`) and the server split route — no server changes. `DocBlock` renders a paragraph as a read-only `<Text>` today; we render a multiline `<TextInput>` instead when that block is the one being edited. Edit state (which block, and a pending caret position for cross-block hand-off) lives in `workspace-store`. The RN clobber-guard is simpler than the WebView's: while a block is edited its `TextInput` uses **local** state, so store/prop re-syncs never reset the caret.

**Shared rationale:** see the docx-preview design spec `docs/superpowers/specs/2026-07-19-inline-caret-editing-design.md` (gesture model, save timing, op reuse, AI-turn gating). This plan only covers the outline-specific implementation.

**Tech Stack:** Expo/React Native, `react-native-reorderable-list`, Zustand, existing `thesis-doc-store` ops. No JS test runner — gate with `npx tsc --noEmit` + a device pass.

**Reuse note:** ops flow exactly as in the docx view — `useThesisDocStore.getState().mutate(thesisId, op)` applies optimistically, enqueues durably, flushes in order. `applyOpToBlocks` already handles `editText`/`splitParagraph`/`deleteBlocks` (incl. `rejectedSplit`). Nothing in `thesis-ops.ts`/`lib/api.ts`/server changes.

---

## File Structure
- `stores/workspace-store.ts` — add `editingBlockIndex: number | null` and `pendingCaret: { index: number; pos: number } | null` + setters.
- `components/workspace/DocBlock.tsx` — the paragraph branch becomes editable; a small local-state editable sub-component owns the `TextInput`, live-commit debounce, Enter-split, Backspace-merge.
- (`OutlineReorderable.tsx` — likely unchanged; the drag handle already isolates reorder from body taps. Only touch it if the list needs `keyboardShouldPersistTaps` for taps-while-keyboard-open — verify during Task 2.)

---

### Task 1: Edit state in workspace-store

**Files:** Modify `stores/workspace-store.ts`

- [ ] **Step 1: Add state fields + setters**

In `WorkspaceState`, after `multiSelect: boolean;`, add:
```ts
  // The engine block index whose paragraph is being edited inline in the OUTLINE
  // view (null = none). Distinct from selection: a block is first selected, then a
  // second tap promotes it to editing.
  editingBlockIndex: number | null;
  // After a split/merge moves editing to a different block, the caret position the
  // newly-editing block should open at (start of the new paragraph / the join
  // point). Consumed once by that block's TextInput, then cleared.
  pendingCaret: { index: number; pos: number } | null;
```
In the actions section of the interface, add:
```ts
  setEditingBlock: (index: number | null, caretPos?: number) => void;
  clearPendingCaret: () => void;
```
In `INITIAL`, add:
```ts
  editingBlockIndex: null as number | null,
  pendingCaret: null as { index: number; pos: number } | null,
```
In the store body, add:
```ts
  setEditingBlock: (index, caretPos) =>
    set({
      editingBlockIndex: index,
      pendingCaret: index != null && caretPos != null ? { index, pos: caretPos } : null,
    }),

  clearPendingCaret: () => set({ pendingCaret: null }),
```
Also: in `clearSelection` and `reset`, editing must not outlive selection — `clearSelection` should also clear editing. Change `clearSelection` to:
```ts
  clearSelection: () => set({ selectedBlocks: [], multiSelect: false, editingBlockIndex: null, pendingCaret: null }),
```
(`reset` already resets to `INITIAL`, which now includes the new fields.)

- [ ] **Step 2: Typecheck** — `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit` → 0 errors (ignore any unrelated parallel-session errors).

- [ ] **Step 3: Commit** (fresh, one file):
```
git add stores/workspace-store.ts
git commit -m "feat(workspace): outline inline-edit state (editingBlockIndex + pendingCaret)"
```

---

### Task 2: Editable paragraph in DocBlock (text editing + live commit)

**Files:** Modify `components/workspace/DocBlock.tsx`

Context: today the paragraph branch renders `<Pressable onPress={pickBlock} onLongPress={longPickBlock}><Text …>{block.text}</Text></Pressable>`. We keep that for the non-editing case and swap to a `TextInput` when this block is being edited. `pickBlock`/`longPickBlock` and the `dir`/`textAlign`/`androidJustify` logic already exist in the file.

- [ ] **Step 1: Add an editable paragraph sub-component**

Add this component in `DocBlock.tsx` (near the other sub-components like `FigureImage`):
```tsx
// The paragraph body when it's being edited inline (outline view): a multiline
// TextInput seeded ONCE from the block text, committing live (debounced) + on blur
// via the editText op. Enter splits, Backspace-at-start merges. Local state owns
// the value so store/prop re-syncs can't reset the caret mid-edit.
function EditableParagraph({
  block,
  rtl,
  thesisId,
  textStyle,
  textAlign,
}: {
  block: Extract<DocBlockDTO, { kind: "paragraph" }>;
  rtl: boolean;
  thesisId: string;
  textStyle: object;
  textAlign: "left" | "right" | "center" | "justify";
}) {
  const colors = useThemeColors();
  const isGenerating = useChatStore((s) => s.isGenerating);
  const pendingCaret = useWorkspaceStore((s) => s.pendingCaret);
  const dir = block.direction ?? detectDir(block.text, rtl);

  const [value, setValue] = useState(block.text);
  const baselineRef = useRef(block.text); // last committed text (suppress no-op ops)
  const selRef = useRef({ start: block.text.length, end: block.text.length });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Open the caret where a preceding split/merge asked us to (start of the new
  // paragraph / the join point); consume the hint once.
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(
    pendingCaret?.index === block.index ? { start: pendingCaret.pos, end: pendingCaret.pos } : undefined,
  );
  useEffect(() => {
    if (pendingCaret?.index === block.index) {
      setSelection({ start: pendingCaret.pos, end: pendingCaret.pos });
      useWorkspaceStore.getState().clearPendingCaret();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (text: string) => {
    if (text === baselineRef.current) return;
    baselineRef.current = text;
    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index: block.index, text });
  };
  const scheduleCommit = (text: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      commit(text);
    }, 900);
  };

  const onChangeText = (next: string) => {
    // Enter → split at the newline (blocks are single-paragraph, so any \n is an
    // intentional Enter). Split at the FIRST newline; the rest rides in `after`.
    const nl = next.indexOf("\n");
    if (nl >= 0) {
      const before = next.slice(0, nl);
      const after = next.slice(nl + 1);
      doSplit(before, after);
      return;
    }
    setValue(next);
    scheduleCommit(next);
  };

  const doSplit = (before: string, after: string) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    // The split op is authoritative for `before` — set the baseline so the
    // impending blur doesn't also emit an editText for it.
    baselineRef.current = before;
    setValue(before);
    void useThesisDocStore.getState().mutate(thesisId, {
      type: "splitParagraph",
      index: block.index,
      before,
      after,
    });
    // Continue editing in the new paragraph (index+1), caret at its start.
    useWorkspaceStore.getState().setEditingBlock(block.index + 1, 0);
  };

  const onKeyPress = (e: { nativeEvent: { key: string } }) => {
    // Backspace at the very start merges into the previous paragraph. (iOS fires
    // this reliably for the soft keyboard; Android soft-keyboard backspace may not
    // fire onKeyPress — that's a known RN limitation, acceptable for v1.)
    if (e.nativeEvent.key !== "Backspace") return;
    if (selRef.current.start !== 0 || selRef.current.end !== 0) return;
    if (block.index === 0) return; // nothing before the first block
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const store = useThesisDocStore.getState();
    const doc = store.byId[thesisId];
    const prev = doc?.available ? doc.blocks.find((b) => b.index === block.index - 1) : undefined;
    if (!prev || prev.kind !== "paragraph") return; // only merge para→para
    const prevText = prev.text;
    const merged = prevText + value;
    baselineRef.current = value; // suppress this block's blur editText (it's deleted)
    void store.mutate(thesisId, { type: "editText", index: block.index - 1, text: merged });
    void store.mutate(thesisId, { type: "deleteBlocks", indices: [block.index] });
    // Continue editing in the previous paragraph, caret at the join point.
    useWorkspaceStore.getState().setEditingBlock(block.index - 1, prevText.length);
  };

  const onBlur = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    commit(value);
    // Only drop out of edit mode if THIS block is still the editing one (a
    // split/merge may have already moved editing to a sibling).
    const ws = useWorkspaceStore.getState();
    if (ws.editingBlockIndex === block.index) ws.setEditingBlock(null);
  };

  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      onKeyPress={onKeyPress}
      onSelectionChange={(e) => { selRef.current = e.nativeEvent.selection; }}
      onBlur={onBlur}
      selection={selection}
      autoFocus
      multiline
      editable={!isGenerating}
      scrollEnabled={false}
      textAlignVertical="top"
      style={[
        textStyle,
        {
          textAlign,
          padding: 0,
          ...(Platform.OS === "android" ? null : { writingDirection: dir }),
        },
      ]}
    />
  );
}
```

- [ ] **Step 2: Render the editable sub-component from the paragraph branch**

In the main `DocBlock` component's paragraph branch, subscribe to whether this block is being edited (a stable boolean selector) and branch the render. Just before the `return (<Pressable …>` of the paragraph branch, add:
```tsx
  const isEditing = useWorkspaceStore((s) => s.editingBlockIndex === block.index);
```
Then wrap the paragraph render so that when `isEditing` is true, the `EditableParagraph` is shown instead of the `<Text>` — keeping the SAME `Pressable` container styling (selected highlight) around it. Replace the paragraph branch's `<Text …>{empty ? "·" : block.text}</Text>` with:
```tsx
        {isEditing ? (
          <EditableParagraph
            block={block}
            rtl={rtl}
            thesisId={thesisId}
            textStyle={isHeading
              ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(block.level, 4) as 1 | 2 | 3 | 4] }
              : styles.body}
            textAlign={textAlign}
          />
        ) : (
          <Text
            {...(androidJustify ? { textBreakStrategy: "simple" as const } : null)}
            style={[
              isHeading
                ? { ...styles.heading, fontSize: HEADING_SIZE[Math.min(block.level, 4) as 1 | 2 | 3 | 4] }
                : styles.body,
              { textAlign, ...(androidJustify ? null : { writingDirection: dir }) },
              empty && styles.emptyPara,
            ]}
          >
            {empty ? "·" : block.text}
          </Text>
        )}
```
Keep the surrounding `<Pressable onPress={…} onLongPress={…}>` exactly as it is.

- [ ] **Step 3: Second-tap enters edit mode**

Change the paragraph `Pressable`'s `onPress` so a tap on the already-sole-selected paragraph promotes to editing; otherwise it selects as today. Replace `onPress={() => pickBlock(block.index, block.text)}` with:
```tsx
        onPress={() => enterOrSelect(block.index, block.text)}
```
and add this helper near `pickBlock`:
```tsx
// Tap: if this block is already the sole selection, promote to inline editing;
// otherwise select it (single or multi per the store mode).
function enterOrSelect(index: number, text: string): void {
  const ws = useWorkspaceStore.getState();
  const sole = ws.selectedBlocks.length === 1 && ws.selectedBlocks[0].index === index;
  if (sole && !ws.multiSelect && ws.editingBlockIndex == null) {
    ws.setEditingBlock(index);
  } else {
    if (ws.multiSelect) ws.toggleBlock(index, text);
    else ws.selectBlock(index, text);
  }
}
```

- [ ] **Step 4: Imports**

Ensure `DocBlock.tsx` imports what the new code uses: from `react` add `useEffect, useRef` (it already imports `useState`); from `react-native` add `TextInput` (it already imports `Platform`, `View`, `Text`, `Pressable`, `Image`, `StyleSheet`); add `import { useChatStore } from "@/stores/chat-store";` and `import { useThesisDocStore } from "@/stores/thesis-doc-store";`. `useWorkspaceStore` is already imported.

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` → no error references `DocBlock.tsx` (ignore parallel-session errors).

- [ ] **Step 6: keyboardShouldPersistTaps check**

In `OutlineReorderable.tsx`, if a tap that moves the caret/blur between rows while the keyboard is up gets swallowed, add `keyboardShouldPersistTaps="handled"` to the `ReorderableList`. If the prop isn't supported by `react-native-reorderable-list`, note it and skip (blur-on-outside-tap still works). This is a runtime-verify item, not a blocker for tsc.

- [ ] **Step 7: Commit** (fresh, up to two files):
```
git add components/workspace/DocBlock.tsx stores/workspace-store.ts
git commit -m "feat(workspace): inline paragraph editing in the outline view (text + split + merge)"
```

---

### Task 3: Device verification pass (manual — record results)

No automated runner. On a device/simulator, open a live thesis, switch to the **Outline** view, and verify:
- [ ] Tap a paragraph → selects (highlight, no keyboard). Tap again → caret + keyboard, edit text; pause → saves; switch away/back → change persisted.
- [ ] Enter mid-paragraph → splits into two; editing continues in the new paragraph at its start.
- [ ] Backspace at the very start → merges into the previous paragraph; editing continues there at the join (iOS). Note Android backspace-merge behavior.
- [ ] Drag handle still reorders; long-press body still multi-selects; editing disabled during an AI turn.
- [ ] RTL Arabic paragraph edits with the correct caret direction/alignment.

Record pass/fail per item; file follow-ups for any failures.

---

## Self-Review (delta from the docx spec)
- **Coverage:** text edit (Task 2 Steps 1–3), Enter-split (`onChangeText` \n → `doSplit` → `splitParagraph` op + caret hand-off), Backspace-merge (`onKeyPress` at offset 0 → `editText`+`deleteBlocks` + caret hand-off), AI gating (`editable={!isGenerating}`), RTL (`dir`/`textAlign`), prop-resync guard (local `value` state). All map to tasks.
- **Caret hand-off:** split sets `setEditingBlock(index+1, 0)`; merge sets `setEditingBlock(index-1, prevText.length)`; the target block consumes `pendingCaret` once via the mount effect. Baselines (`baselineRef`) are pre-set on split/merge so the impending blur emits no redundant `editText`.
- **Known v1 caveats (documented, not defects):** Android soft-keyboard Backspace may not fire `onKeyPress` (merge-on-backspace iOS-reliable); a pasted multi-line string splits only at the first newline; mixed per-run styling reflows to the dominant run on `editText` (same as everywhere).
- **Ambiguity check:** `enterOrSelect` only promotes to editing when the block is the SOLE selection and not in multi-select — so multi-select bulk ops are unaffected.
