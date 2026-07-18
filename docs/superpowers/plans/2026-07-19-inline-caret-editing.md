# Inline Caret Editing in the Document (docx-preview) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student tap into a paragraph in the live-`.docx` view to get a Word-like caret + keyboard, type directly into the paragraph (block auto-selected in the background), and split/merge paragraphs with Enter/Backspace — all reusing the existing optimistic op pipeline.

**Architecture:** All UI lives in the docx-preview renderer ([`WordDocxView.tsx`](../../../components/workspace/WordDocxView.tsx)), a read-only WebView we make selectively `contentEditable`. First tap selects a block (existing behavior); a second tap on the sole-selected paragraph turns that `<p>` editable, raises the keyboard, and puts a caret at the tap point. Typing commits live (debounced ~900 ms) and on blur by emitting the SAME `editText` op ([`thesis-ops.ts`](../../../lib/thesis-ops.ts)) the block-editor screen already uses. Enter splits via a new `splitParagraph` op backed by a new server route; Backspace-at-start merges via two existing ops. Two guards keep the live caret from being clobbered by the op-echo (`__applyOp`) and the post-flush silent refresh.

**Tech Stack:** Expo/React Native, `react-native-webview`, docx-preview (in-WebView), Zustand ([`thesis-doc-store.ts`](../../../stores/thesis-doc-store.ts)), Hono + `mdocxengine` server, vitest (server tests). The Expo app has **no JS test runner** — app tasks verify with `npx tsc --noEmit` + a manual simulator pass. Server tasks use `npm test` (vitest).

**Phasing:** Tasks 1–3 (Phase 1, core inline editing) are an independently shippable increment — no server change. Tasks 4–6 (Phase 2) add paragraph split/merge. OnlyOffice edit mode is explicitly out of scope (a future spec).

---

## File Structure

- `components/workspace/WordDocxView.tsx` — **most of the work.** New props (`editable`, `onEditCommit`, `onSplit`, `onMerge`), new inbound messages, RN-side refresh deferral, and a large block of new in-WebView JS (gesture → contentEditable, debounce, guards, Enter/Backspace). Keep all new WebView JS inside the existing `buildHtml` template string, grouped in a clearly-commented section.
- `app/(app)/thesis-workspace.tsx` — pass `editable={!isGenerating}` and wire the new callbacks to `useThesisDocStore.getState().mutate(...)`; force-commit an in-progress edit when a turn starts.
- `lib/thesis-ops.ts` — new `splitParagraph` op (type + optimistic patch + section shift + `executeOp`).
- `lib/api.ts` — new `splitThesisParagraph(thesisId, index, { before, after })` client fn.
- `modakerati-server/src/lib/thesis-split.ts` — **new file**: pure-ish `splitParagraphInEngine(engine, index, before, after, fmt?)` helper (testable against the docx fixture).
- `modakerati-server/src/routes/thesis.ts` — new `POST /:id/paragraphs/:index/split` route calling the helper inside `withThesisLock` + `persistThesisDocx`.
- `modakerati-server/src/__tests__/thesis-split.test.ts` — **new file**: vitest for the split helper.

---

## Phase 1 — Core inline editing (no server change)

### Task 1: RN plumbing in WordDocxView (props, edit messages, refresh deferral)

Wire the new prop + message contract and the refresh-deferral state FIRST, so later WebView JS has a landing spot. No editing behavior is reachable yet (the WebView won't post the new messages until Task 2), so this task only adds inert plumbing that must typecheck.

**Files:**
- Modify: `components/workspace/WordDocxView.tsx`

- [ ] **Step 1: Extend the component props**

In the `WordDocxView` props type (the object after `export function WordDocxView({ ... }: {`), add these fields alongside the existing ones:

```tsx
  // When false (an AI turn is generating), a tap never enters inline-edit mode.
  editable?: boolean;
  // A live/blur commit of an inline paragraph edit → the parent maps it to an
  // editText op. Text is the paragraph's current plain text.
  onEditCommit?: (index: number, text: string) => void;
  // Enter pressed mid-paragraph: split `index` into `before` (stays) + `after`
  // (new paragraph inserted right after).
  onSplit?: (index: number, before: string, after: string) => void;
  // Backspace at offset 0: merge paragraph `curIndex` into `prevIndex`, with the
  // already-joined text. The parent emits editText(prevIndex, mergedText) then
  // deleteBlocks([curIndex]).
  onMerge?: (prevIndex: number, curIndex: number, mergedText: string) => void;
```

And in the destructured parameter list add `editable = true, onEditCommit, onSplit, onMerge,`.

- [ ] **Step 2: Add refresh-deferral refs**

Right after the existing `const shellReadyRef = useRef(false);` line, add:

```tsx
  // True while a paragraph in the WebView has an active caret. The post-flush
  // silent refresh would re-render the doc and destroy the caret, so we defer it
  // until the edit ends. `pendingRefreshRef` remembers that a refresh was asked
  // for while editing so we can run it on editEnd.
  const isEditingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
```

- [ ] **Step 3: Gate `maybeRefresh` on the editing flag**

In the `maybeRefresh` useCallback, add this as the FIRST line inside the function body (before `if (!shellReadyRef.current) return;`):

```tsx
    if (isEditingRef.current) { pendingRefreshRef.current = true; return; }
```

- [ ] **Step 4: Push `editable` into the WebView when it changes**

After the existing selection-sync effect (the `useEffect` keyed on `selKey` that injects `__setSelected`), add:

```tsx
  // Keep the WebView's edit gate in sync (an AI turn disables inline editing).
  React.useEffect(() => {
    webRef.current?.injectJavaScript(
      `window.__setEditable && window.__setEditable(${editable ? "true" : "false"}); true;`,
    );
    // A turn starting mid-edit must commit + release the caret before the AI edits land.
    if (!editable) {
      webRef.current?.injectJavaScript(`window.__forceCommitEdit && window.__forceCommitEdit(); true;`);
    }
  }, [editable]);
```

- [ ] **Step 5: Handle the new inbound messages**

In `onMessage`, add these branches to the `if/else if` chain (after the existing `select`/`longpress` branch):

```tsx
      } else if (msg.type === "editStart" && typeof msg.index === "number") {
        isEditingRef.current = true;
      } else if (msg.type === "editEnd") {
        isEditingRef.current = false;
        // Run any refresh that was suppressed while the caret was active.
        if (pendingRefreshRef.current) { pendingRefreshRef.current = false; maybeRefresh(); }
      } else if (msg.type === "editCommit" && typeof msg.index === "number") {
        onEditCommit?.(msg.index, typeof msg.text === "string" ? msg.text : "");
      } else if (msg.type === "split" && typeof msg.index === "number") {
        onSplit?.(
          msg.index,
          typeof msg.before === "string" ? msg.before : "",
          typeof msg.after === "string" ? msg.after : "",
        );
      } else if (
        msg.type === "merge" &&
        typeof msg.prevIndex === "number" &&
        typeof msg.curIndex === "number"
      ) {
        onMerge?.(msg.prevIndex, msg.curIndex, typeof msg.mergedText === "string" ? msg.mergedText : "");
```

- [ ] **Step 6: Seed `editable` into the initial HTML**

Find the `buildHtml` call inside the `html` useMemo: `return buildHtml(u, b, s, rtl);`. Change the signature and call to thread `editable`. Update the `buildHtml` declaration line `function buildHtml(url: string, blocks: DocTapBlock[], selectedIndices: number[], rtl: boolean): string {` to add a trailing param `, editable: boolean` and pass it: `return buildHtml(u, b, s, rtl, editable);`. (The WebView-side use of it lands in Task 2; for now just thread the value and reference it in a harmless way to satisfy the compiler — Step 7.)

- [ ] **Step 7: Reference `editable` in the template so TS/lint is satisfied**

Inside `buildHtml`, near the top where `const selJson = JSON.stringify(selectedIndices);` is, add:

```tsx
  const editableJson = editable ? "true" : "false";
```

and inside the returned template's opening `<script>`, add this line right after `var RN = window.ReactNativeWebView;`:

```js
  var EDITABLE = ${editableJson};
```

- [ ] **Step 8: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: PASS (no errors). The `editable` mismatch at the call site in `thesis-workspace.tsx` is fine because the prop is optional; we set it in Task 3.

- [ ] **Step 9: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/WordDocxView.tsx
git commit -m "feat(workspace): inline-edit RN plumbing in WordDocxView (props, messages, refresh deferral)"
```

---

### Task 2: WebView select→edit gesture + contentEditable

Add the in-WebView JS so a second tap on the sole-selected paragraph makes it editable, raises the keyboard, and drops a caret at the tap point. Commit-on-typing lands in Task 3 — here the paragraph just becomes editable and posts `editStart`/`editEnd`.

**Files:**
- Modify: `components/workspace/WordDocxView.tsx` (inside `buildHtml`'s `<script>`)

- [ ] **Step 1: Track the selected set + tap coordinates in the WebView**

Inside `window.__setSelected` (in the template script), at the very top of the function body add a line to remember the current sole selection:

```js
    window.__SOLE_SEL = (indices && typeof indices !== 'number' && indices.length === 1) ? indices[0] : (typeof indices === 'number' ? indices : null);
```

(Place it as the first statement, before `clearHighlights();`.)

- [ ] **Step 2: Capture tap coordinates for caret placement**

In `wireContainerEvents`, the `touchstart` listener currently sets `startEl`. Add coordinate capture. Replace the `touchstart` handler body's first line:

```js
      startEl = blockEl(ev.target); moved = false; longFired = false;
```

with:

```js
      startEl = blockEl(ev.target); moved = false; longFired = false;
      var _t = ev.touches && ev.touches[0]; lastTapX = _t ? _t.clientX : 0; lastTapY = _t ? _t.clientY : 0;
```

and declare the vars: change the existing `var timer = null, startEl = null, moved = false, longFired = false, lastTouchEnd = 0;` to append `, lastTapX = 0, lastTapY = 0`.

- [ ] **Step 3: Add the edit-mode engine (new functions)**

Immediately BEFORE the `function wireContainerEvents(){` declaration, paste this block:

```js
  // ── Inline caret editing ───────────────────────────────────────────────────
  // Second tap on the already-sole-selected paragraph turns it into a native
  // contentEditable field (caret + keyboard). Commit/guards land in the
  // debounce + applyOp guards below.
  var editingIndex = null;      // block index being edited, or null
  var editBaseline = null;      // normalized text at edit-start (detect real changes)
  var commitTimer = null;

  window.__setEditable = function(v){ EDITABLE = !!v; };

  function placeCaretFromPoint(x, y){
    try {
      if (document.caretRangeFromPoint){
        var r = document.caretRangeFromPoint(x, y);
        if (r){ var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      }
    } catch(e){}
  }

  function enterEdit(el, index){
    if (!EDITABLE || !el || el.tagName !== 'P' || editingIndex != null) return false;
    editingIndex = index;
    editBaseline = norm(el.innerText);
    el.setAttribute('contenteditable', 'true');
    el.classList.add('mk-editing');
    el.focus();
    placeCaretFromPoint(lastTapX, lastTapY);
    el.addEventListener('input', onEditInput);
    el.addEventListener('keydown', onEditKeydown);
    el.addEventListener('blur', onEditBlur);
    post({ type: 'editStart', index: index });
    return true;
  }

  function commitEdit(el){
    if (editingIndex == null || !el) return;
    var text = el.innerText;
    if (norm(text) === editBaseline) return;   // no real change → no op
    editBaseline = norm(text);
    post({ type: 'editCommit', index: editingIndex, text: text });
  }

  function onEditInput(ev){
    if (commitTimer) clearTimeout(commitTimer);
    var el = ev.currentTarget;
    commitTimer = setTimeout(function(){ commitTimer = null; commitEdit(el); }, 900);
  }

  function onEditKeydown(ev){
    // Enter handling (split) is added in Phase 2; for now keep edits single-paragraph.
    if (ev.key === 'Enter'){ ev.preventDefault(); }
  }

  function onEditBlur(ev){
    var el = ev.currentTarget;
    if (commitTimer){ clearTimeout(commitTimer); commitTimer = null; }
    commitEdit(el);
    el.removeAttribute('contenteditable');
    el.classList.remove('mk-editing');
    el.removeEventListener('input', onEditInput);
    el.removeEventListener('keydown', onEditKeydown);
    el.removeEventListener('blur', onEditBlur);
    var idx = editingIndex;
    editingIndex = null; editBaseline = null;
    post({ type: 'editEnd', index: idx });
  }

  window.__forceCommitEdit = function(){
    if (editingIndex == null) return;
    var el = activeBuf.querySelector('.mk-editing');
    if (el) el.blur();          // triggers onEditBlur → commit + editEnd
  };
```

- [ ] **Step 4: Route the second tap into edit mode**

In `wireContainerEvents`, the `report(el, kind)` helper posts `select`/`longpress`. Change the tap path so a tap on the sole-selected paragraph edits instead of re-selecting. Replace the `touchend` handler's final line `report(startEl, 'select');` with:

```js
      if (startEl && startEl.tagName === 'P' && editingIndex == null &&
          window.__SOLE_SEL != null && matchIndex(startEl.innerText || "") === window.__SOLE_SEL){
        if (enterEdit(startEl, window.__SOLE_SEL)) return;
      }
      if (editingIndex != null) return; // taps inside the caret field are native
      report(startEl, 'select');
```

Also, in the `click` fallback listener, guard against hijacking clicks while editing — change its body first line to:

```js
      if (editingIndex != null) return;
      if (Date.now() - lastTouchEnd < 700) return;
```

- [ ] **Step 5: Add the editing style**

In the template `<style>` block, next to the `.mk-sel` rule, add:

```css
  .mk-editing { outline: 2px solid #4c6ef5 !important; outline-offset: 1px; background: #fff !important; caret-color: #1a1a1a; }
```

- [ ] **Step 6: Soften the select highlight (lighter active outline)**

Change the existing `.mk-sel` rule from the heavy fill to a lighter outline:

```css
  .mk-sel { outline: 1.5px solid #9db4f5 !important; outline-offset: 1px; background: rgba(76,110,245,0.05) !important; }
```

- [ ] **Step 7: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Manual verification (simulator)**

Run the app (`npx expo start`, open iOS simulator), open a live-`.docx` thesis in the workspace on the Document view (docx-preview — the default on simulator).
- Tap a paragraph once → it highlights (light outline), no keyboard. Expected.
- Tap the SAME paragraph again → caret appears at the tap point, keyboard rises, paragraph shows the `.mk-editing` outline. Expected.
- Tap a different paragraph → keyboard dismisses / caret leaves (blur). Expected.
- If `caretRangeFromPoint` does not place the caret at the tap point on iOS WKWebView, the caret still lands (focus default) — note it and continue; exact caret positioning is polish, not a blocker.

- [ ] **Step 9: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/WordDocxView.tsx
git commit -m "feat(workspace): second-tap enters inline caret edit mode in WordDocxView"
```

---

### Task 3: Live commit + clobber guards + wire to the store

Make typing actually save (debounced editText op), guard the caret against the op-echo and silent refresh, and wire the parent to the store + AI gating. After this task Phase 1 is fully working.

**Files:**
- Modify: `components/workspace/WordDocxView.tsx`
- Modify: `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1: Guard `__applyOp` from clobbering the edited paragraph**

In `applyOpNow(op)`, the `editText` branch currently does:

```js
      if (op.type === 'editText'){
        var el = elForIndex(op.index, false);
        if (el && el.tagName === 'P') setBlockText(el, op.text);
        pbEditText(op.index, op.text);
      }
```

Replace it with (skip the DOM write for the block the caret is in — it already shows our text — but keep BLOCKS in sync for tap matching):

```js
      if (op.type === 'editText'){
        if (op.index !== editingIndex){
          var el = elForIndex(op.index, false);
          if (el && el.tagName === 'P') setBlockText(el, op.text);
        }
        pbEditText(op.index, op.text);
      }
```

- [ ] **Step 2: Backstop the silent refresh while editing**

At the very top of `window.__refresh = function(url, blocks, sel){`, add:

```js
    if (editingIndex != null){ return; }   // RN also defers; this is the belt-and-braces
```

- [ ] **Step 3: Typecheck the app**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Wire the parent to the store + AI gating**

In `app/(app)/thesis-workspace.tsx`, find the `<WordDocxView ... />` usage (in the docx layer). Add these props after the existing `onLongPress={...}` prop:

```tsx
                  editable={!isGenerating}
                  onEditCommit={(index, text) =>
                    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index, text })
                  }
                  onSplit={(index, before, after) =>
                    void useThesisDocStore
                      .getState()
                      .mutate(thesisId, { type: "splitParagraph", index, before, after })
                  }
                  onMerge={(prevIndex, curIndex, mergedText) => {
                    const store = useThesisDocStore.getState();
                    void store.mutate(thesisId, { type: "editText", index: prevIndex, text: mergedText });
                    void store.mutate(thesisId, { type: "deleteBlocks", indices: [curIndex] });
                  }}
```

Note: `onSplit` references the `splitParagraph` op added in Task 5; TS will error until then. To keep this task green, TEMPORARILY comment out the `onSplit` prop with a `// TODO(Task 5): splitParagraph op` marker and uncomment it in Task 5. `onEditCommit` and `onMerge` use existing ops and compile now.

- [ ] **Step 5: Typecheck the app**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: PASS (with `onSplit` temporarily commented).

- [ ] **Step 6: Manual verification (simulator)**

Open a live-`.docx` thesis, Document view:
- Second-tap a paragraph, type a change. After ~1s of no typing, the edit persists (switch to Outline view and back, or reopen — the change is there). Expected.
- Keep typing then immediately tap another paragraph → the edit commits on blur. Expected.
- Type in a paragraph, then trigger an AI turn from the composer → editing is disabled during the turn (a tap doesn't enter edit mode), the in-progress edit committed first, and the AI's edits appear after. Expected.
- Confirm the caret does NOT jump/reset while typing (the op-echo guard). Expected.

- [ ] **Step 7: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/WordDocxView.tsx app/(app)/thesis-workspace.tsx
git commit -m "feat(workspace): live debounced inline editText commit + caret clobber guards"
```

---

## Phase 2 — Enter splits / Backspace merges

### Task 4: Server split helper + route (with vitest)

Add a testable engine helper and a route, following the existing `PUT /:id/paragraphs/:index` pattern.

**Files:**
- Create: `modakerati-server/src/lib/thesis-split.ts`
- Create: `modakerati-server/src/__tests__/thesis-split.test.ts`
- Modify: `modakerati-server/src/routes/thesis.ts`

- [ ] **Step 1: Write the failing test**

Create `modakerati-server/src/__tests__/thesis-split.test.ts`:

```ts
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { Doc, paragraphText } from "mdocxengine";
import { splitParagraphInEngine } from "../lib/thesis-split";

const SAMPLE = new URL("../../assets/thesis-base.docx", import.meta.url).pathname;

async function makeDoc() {
  const doc = await Doc.open(readFileSync(SAMPLE));
  const before = (await doc.blocks()).length;
  await doc.addParagraph("هذه فقرة عربية طويلة في متن المذكرة سنقوم بتقسيمها.");
  const infos = await doc.blocks();
  return { doc, bodyIdx: infos.length - 1 };
}

describe("splitParagraphInEngine", () => {
  it("splits one paragraph into two, preserving order and inheriting RTL+justify", async () => {
    const { doc, bodyIdx } = await makeDoc();
    const countBefore = (await doc.blocks()).length;

    await splitParagraphInEngine(doc.engine, bodyIdx, "هذه فقرة عربية طويلة", "في متن المذكرة سنقوم بتقسيمها.", {
      direction: "rtl",
      alignment: "justify",
    });

    const blocks = await doc.engine.document.getBlocks();
    expect(blocks.length).toBe(countBefore + 1);
    expect(paragraphText(blocks[bodyIdx].xml).trim()).toBe("هذه فقرة عربية طويلة");
    expect(paragraphText(blocks[bodyIdx + 1].xml).trim()).toBe("في متن المذكرة سنقوم بتقسيمها.");
    // The new (second) half inherited the Arabic RTL + kashida-justify formatting.
    expect(blocks[bodyIdx + 1].xml).toContain("<w:bidi");
    expect(blocks[bodyIdx + 1].xml).toContain("lowKashida");
  });

  it("rejects a non-paragraph / out-of-range index", async () => {
    const { doc } = await makeDoc();
    const n = (await doc.blocks()).length;
    await expect(splitParagraphInEngine(doc.engine, n + 5, "a", "b")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/thesis-split.test.ts`
Expected: FAIL — `splitParagraphInEngine` is not exported / module not found.

- [ ] **Step 3: Implement the helper**

Create `modakerati-server/src/lib/thesis-split.ts`:

```ts
import type { Mdocxengine } from "mdocxengine";
import { makeStyledParagraphNode, paragraphStyleId } from "mdocxengine";
import { applyParagraphDirection, applyParagraphAlignment, type UiAlign } from "./thesis-rtl";

export interface SplitFormat {
  direction?: "rtl" | "ltr" | null;
  alignment?: UiAlign | null;
}

/**
 * Split the paragraph at engine block `index` into two: the target keeps `before`,
 * and a NEW paragraph is inserted immediately after it holding `after`, inheriting
 * the source paragraph's style plus (when provided) its direction/alignment — so a
 * justified RTL Arabic body splits into two justified RTL bodies. Uses only
 * DocumentManager primitives; the caller wraps it in withThesisLock + persist.
 */
export async function splitParagraphInEngine(
  engine: Mdocxengine,
  index: number,
  before: string,
  after: string,
  fmt: SplitFormat = {},
): Promise<void> {
  const blocks = await engine.document.getBlocks();
  const src = blocks[index];
  if (!src || src.kind !== "paragraph" || src.xml.includes("<w:drawing>")) {
    throw new Error(`block ${index} is not an editable paragraph`);
  }
  const styleId = paragraphStyleId(src.xml);

  // 1) First half stays in the target paragraph.
  await engine.document.editParagraphText(index, before);
  // 2) Insert the second half as a fresh styled paragraph right after it.
  await engine.document.insertBlockAt(
    makeStyledParagraphNode(after, styleId ? { styleId } : {}),
    index + 1,
  );
  // 3) Re-apply the source's direction/alignment so the new half matches.
  if (fmt.direction != null || fmt.alignment != null) {
    const b2 = await engine.document.getBlocks();
    let xml = b2[index + 1].xml;
    if (fmt.direction != null) xml = applyParagraphDirection(xml, fmt.direction);
    if (fmt.alignment != null) xml = applyParagraphAlignment(xml, fmt.alignment);
    b2[index + 1] = { ...b2[index + 1], xml };
    await engine.document.saveBlocks(b2);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/thesis-split.test.ts`
Expected: PASS (both cases). If `makeStyledParagraphNode` or `paragraphText` is not exported under that exact name, run `grep -E "export declare (function|const) (makeStyledParagraphNode|paragraphText|paragraphStyleId)" node_modules/mdocxengine/dist/index.d.ts` and use the confirmed names.

- [ ] **Step 5: Add the route**

In `modakerati-server/src/routes/thesis.ts`, add the import near the other `mdocxengine`-related imports at the top:

```ts
import { splitParagraphInEngine } from "../lib/thesis-split";
```

Then add this route immediately AFTER the `PUT /:id/paragraphs/:index` handler (after its closing `});` around line 281):

```ts
// Manual paragraph SPLIT (live-docx). Sets block `index`'s text to `before` and
// inserts a NEW paragraph right after it holding `after`, inheriting the source's
// style + direction/alignment. Same thesis lock + manual-source persist as the
// single-paragraph edit above. Block `index` matches engine.document.getBlocks().
thesisRoutes.post("/:id/paragraphs/:index/split", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const index = Number(c.req.param("index"));
  if (!Number.isInteger(index) || index < 0) {
    return c.json({ error: "Invalid paragraph index" }, 400);
  }
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const before = typeof body?.before === "string" ? body.before : null;
  const after = typeof body?.after === "string" ? body.after : null;
  if (before == null || after == null) {
    return c.json({ error: "before and after are required strings" }, 400);
  }

  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  if (thesis.docMode !== "live-docx" || !thesis.docPath) {
    return c.json({ error: "Thesis is not a live Word document" }, 400);
  }

  try {
    const result = await withThesisLock(id, async () => {
      const engine = await getThesisEngine(id, thesis.docPath!);
      const blocks = await engine.document.getBlocks();
      if (index >= blocks.length) {
        return { error: `index ${index} out of range (0..${blocks.length - 1})` as string };
      }
      const src = blocks[index];
      if (src.kind !== "paragraph" || src.xml.includes("<w:drawing>")) {
        return { error: `block ${index} is not an editable paragraph` as string };
      }
      // Read the source's rendered direction/alignment so the new half inherits them.
      const preDto = await buildDocumentDTOFromEngine(thesis, engine);
      const pre = preDto.available ? preDto.blocks[index] : undefined;
      const direction = pre && pre.kind === "paragraph" ? pre.direction ?? null : null;
      const dtoAlign = pre && pre.kind === "paragraph" ? pre.alignment ?? null : null;
      // DTO alignment uses Word's jc values ("both" = justify); map to UiAlign.
      const alignment: UiAlign | null =
        dtoAlign === "both" ? "justify" : (dtoAlign as UiAlign | null);

      await splitParagraphInEngine(engine, index, before, after, { direction, alignment });

      const history = await persistThesisDocx({
        thesisId: id, userId, buffer: Buffer.from(engine.zip.toBuffer()),
        engine, label: "Split paragraph", source: "manual",
      });
      const document = await buildDocumentDTOFromEngine(thesis, engine);
      return { ok: true as const, document, history };
    });
    if ("error" in result) return c.json({ error: result.error }, 400);
    return c.json(result);
  } catch (e: any) {
    return c.json({ error: e?.message ?? "split failed" }, 500);
  }
});
```

- [ ] **Step 6: Typecheck the server**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit`
Expected: PASS. (`UiAlign` is already imported in `thesis.ts` from `./lib/thesis-rtl`.)

- [ ] **Step 7: Run the full server test suite (no regressions)**

Run: `cd /Users/hamzasafwan/modakerati-server && npm test`
Expected: PASS, including the new `thesis-split.test.ts`.

- [ ] **Step 8: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/thesis-split.ts src/__tests__/thesis-split.test.ts src/routes/thesis.ts
git commit -m "feat(thesis): POST /:id/paragraphs/:index/split — manual paragraph split"
```

---

### Task 5: Client `splitParagraph` op

Add the op to the app's op catalog + API client, then re-enable the `onSplit` prop.

**Files:**
- Modify: `lib/api.ts`
- Modify: `lib/thesis-ops.ts`
- Modify: `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1: Add the API client fn**

In `lib/api.ts`, next to `editThesisParagraph` (around line 871), add:

```ts
export async function splitThesisParagraph(
  thesisId: string,
  index: number,
  body: { before: string; after: string },
): Promise<{ document?: DocumentDTO }> {
  return apiFetch(`/api/thesis/${thesisId}/paragraphs/${index}/split`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

Match the exact call convention of the sibling functions in this file — check how `editThesisParagraph` builds its request (helper name, headers, JSON parsing) and mirror it precisely rather than assuming `apiFetch`.

- [ ] **Step 2: Add the op type**

In `lib/thesis-ops.ts`, add to the `ThesisOp` union (after the `editText` member):

```ts
  | { type: "splitParagraph"; index: number; before: string; after: string }
```

And update the import at the top to include the new client fn:

```ts
import {
  editThesisParagraph,
  splitThesisParagraph,
  editThesisParagraphs,
  moveThesisBlock,
  insertThesisImage,
  deleteThesisBlocks,
  startThesisBlocksOnNewPage,
  type DocBlockDTO,
  type DocumentDTO,
  type DocSectionDTO,
} from "@/lib/api";
```

- [ ] **Step 3: Add the optimistic block patch**

In `applyOpToBlocks`, add a `case` before the `default`/end of switch:

```ts
    case "splitParagraph": {
      const arr: DocBlockDTO[] = [];
      for (const b of blocks) {
        if (b.index === op.index && b.kind === "paragraph") {
          arr.push({ ...b, text: op.before });
          // New paragraph inherits the source's style/level/alignment/direction.
          arr.push({ ...b, text: op.after });
        } else {
          arr.push(b);
        }
      }
      return reindex(arr);
    }
```

- [ ] **Step 4: Add the optimistic section shift**

In `applyOpToSections`, add a `case` mirroring `insertImage` (a +1 insert at `op.index + 1`):

```ts
    case "splitParagraph": {
      const at = op.index + 1;
      return shift((st) => (st > at ? st + 1 : st));
    }
```

- [ ] **Step 5: Add the server execution**

In `executeOp`, add a `case`:

```ts
    case "splitParagraph":
      return splitThesisParagraph(thesisId, op.index, { before: op.before, after: op.after });
```

- [ ] **Step 6: Re-enable the `onSplit` prop**

In `app/(app)/thesis-workspace.tsx`, uncomment the `onSplit={...}` prop added (commented) in Task 3 Step 4.

- [ ] **Step 7: Typecheck the app**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: PASS. (The `switch` in `applyOpToBlocks` now handles every union member; if TS flags exhaustiveness anywhere else that switches on `op.type`, add the `splitParagraph` case there too.)

- [ ] **Step 8: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add lib/api.ts lib/thesis-ops.ts app/(app)/thesis-workspace.tsx
git commit -m "feat(workspace): splitParagraph op (client) wired to the split endpoint"
```

---

### Task 6: WebView Enter-split (+ optional Backspace-merge)

Wire the keyboard: Enter splits at the caret; Backspace at offset 0 merges into the previous paragraph. Split is the priority (the requested feature); merge is the optional, deferrable half.

**Files:**
- Modify: `components/workspace/WordDocxView.tsx` (inside `buildHtml`'s `<script>`)

- [ ] **Step 1: Add caret-offset helpers**

In the edit block added in Task 2 Step 3, add these helpers right after `placeCaretFromPoint`:

```js
  // Split the editing paragraph's text at the caret into { before, after } using
  // the current selection offset within the element's text content.
  function caretSplitText(el){
    var sel = window.getSelection();
    var full = el.innerText;
    if (!sel || sel.rangeCount === 0) return { before: full, after: "" };
    var range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    var beforeLen = range.toString().length;
    return { before: full.slice(0, beforeLen), after: full.slice(beforeLen) };
  }
  function caretAtStart(el){
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    var range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return range.toString().length === 0;
  }
```

- [ ] **Step 2: Handle Enter → split in `onEditKeydown`**

Replace the whole `onEditKeydown` function with:

```js
  function onEditKeydown(ev){
    var el = ev.currentTarget;
    if (ev.key === 'Enter'){
      ev.preventDefault();
      var parts = caretSplitText(el);
      var idx = editingIndex;
      // Commit the pending debounce as part of the split (server sets `before`).
      if (commitTimer){ clearTimeout(commitTimer); commitTimer = null; }
      // Optimistically reflect the split in the DOM: current <p> keeps `before`,
      // a clone after it holds `after`; move the caret to the new paragraph.
      setBlockText(el, parts.before);
      var clone = el.cloneNode(true);
      setBlockText(clone, parts.after);
      clone.classList.remove('mk-editing');
      clone.removeAttribute('contenteditable');
      if (el.parentNode) el.parentNode.insertBefore(clone, el.nextSibling);
      // End editing on the old paragraph; the server echo will re-render precisely.
      editBaseline = norm(el.innerText);
      onEditBlur({ currentTarget: el });          // commits nothing (baseline matches) + editEnd
      post({ type: 'split', index: idx, before: parts.before, after: parts.after });
      return;
    }
    if (ev.key === 'Backspace' && caretAtStart(el)){
      handleBackspaceMerge(ev, el);
    }
  }
```

Note: `onEditBlur` after `setBlockText(el, parts.before)` sees `norm(el.innerText) === editBaseline`, so it will NOT post a redundant `editCommit` — the split op is authoritative for `before`.

- [ ] **Step 3: (Optional) Backspace-at-start merge**

Add this function next to the others in the edit block. **This is the deferrable half** — if it proves fiddly on-device, stub it to `ev` no-op and ship split alone.

```js
  function handleBackspaceMerge(ev, el){
    // Find the previous rendered paragraph (skip non-<p> siblings).
    var prev = el.previousElementSibling;
    while (prev && prev.tagName !== 'P') prev = prev.previousElementSibling;
    if (!prev) return; // first paragraph — nothing to merge into
    var prevIdx = matchIndex(prev.innerText || "");
    var curIdx = editingIndex;
    if (prevIdx == null || curIdx == null || prevIdx !== curIdx - 1) return;
    ev.preventDefault();
    if (commitTimer){ clearTimeout(commitTimer); commitTimer = null; }
    var mergedText = (prev.innerText || "") + (el.innerText || "");
    // Optimistic DOM merge: prev gets the joined text, cur is removed.
    setBlockText(prev, mergedText);
    // Release the current editing paragraph WITHOUT a redundant commit, remove it,
    // and continue editing in `prev`.
    editBaseline = norm(el.innerText);
    onEditBlur({ currentTarget: el });
    if (el.parentNode) el.parentNode.removeChild(el);
    post({ type: 'merge', prevIndex: prevIdx, curIndex: curIdx, mergedText: mergedText });
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: PASS (WebView JS is inside a template string, so this only re-checks the TS around it).

- [ ] **Step 5: Manual verification (needs the server running)**

Start the server (`cd /Users/hamzasafwan/modakerati-server && npm run dev`) and the app. Open a live-`.docx` thesis, Document view:
- Second-tap a paragraph, place the caret mid-sentence, press **Enter** → the paragraph splits into two; after the server echo re-renders, both halves are present with the same style (for an Arabic body, both stay justified RTL). Expected.
- Second-tap the second half, put the caret at the very start, press **Backspace** → it merges back into the previous paragraph. Expected (if merge was implemented).
- Verify the split/merge survive a reopen (the durable op flushed to the server). Expected.

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/WordDocxView.tsx
git commit -m "feat(workspace): Enter splits + Backspace merges paragraphs inline"
```

---

## Self-Review

**Spec coverage** — every spec requirement maps to a task:
- Tap = select, 2nd tap = edit → Task 2 Step 4.
- Real caret + keyboard (contentEditable) → Task 2 Step 3.
- Auto-select behind the scenes → existing `select`/`selectBlock` on first tap (unchanged); the sole-selected block is the edit target (Task 2 Step 1/4).
- Live debounced ~900 ms save + blur commit → Task 2 Step 3 (`onEditInput`/`commitEdit`/`onEditBlur`), emits `editText` → Task 3 Step 4.
- `__applyOp` clobber guard → Task 3 Step 1. Silent-refresh guard (RN defer + WebView backstop) → Task 1 Steps 2–3/5 + Task 3 Step 2.
- AI-turn gating + force-commit → Task 1 Step 4 + Task 3 Step 4 (`editable={!isGenerating}`).
- Enter splits (new op end-to-end) → Tasks 4 (server), 5 (client op), 6 Step 2.
- Backspace merges (composed existing ops) → Task 6 Step 3 + Task 3 Step 4 `onMerge`.
- Style + direction/alignment inheritance on split → Task 4 (helper + route).
- OnlyOffice deferred, block-editor untouched, mixed-run-styling limitation → no task (intentionally out of scope).

**Placeholder scan** — no "TBD/TODO-implement-later"; the two intentional markers are a temporary commented prop (Task 3 Step 4, re-enabled in Task 5 Step 6) and the explicitly-optional merge (Task 6 Step 3), both with concrete code.

**Type/name consistency** — message types (`editStart`/`editEnd`/`editCommit`/`split`/`merge`) match between the WebView `post(...)` calls (Tasks 2/3/6) and the RN `onMessage` handlers (Task 1 Step 5). Prop names (`editable`, `onEditCommit`, `onSplit`, `onMerge`) match between the type (Task 1 Step 1), the parent usage (Task 3 Step 4 / Task 5 Step 6), and the callbacks. Op name `splitParagraph` is identical in the union (Task 5 Step 2), `applyOpToBlocks`/`applyOpToSections`/`executeOp` (Task 5 Steps 3–5), the parent `mutate` call (Task 3 Step 4), and the API fn `splitThesisParagraph` (Task 5 Step 1). Engine helper `splitParagraphInEngine` matches between its definition (Task 4 Step 3), its test (Task 4 Step 1), and the route (Task 4 Step 5).

**Watch-outs flagged for the implementer** (verify on-device, not blockers):
- `caretRangeFromPoint` caret precision on iOS WKWebView (Task 2 Step 8).
- `makeStyledParagraphNode`/`paragraphText` exact export names (Task 4 Step 4 fallback grep).
- `lib/api.ts` request helper convention — mirror `editThesisParagraph`, don't assume `apiFetch` (Task 5 Step 1).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-inline-caret-editing.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
