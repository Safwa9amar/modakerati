# Editable Document Chrome (headers / footers / section breaks) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each Word section's running title (top-of-page), page-number line (bottom-of-page), and new-section boundary as always-visible **inline bands** inside the Lexical writer, in plain trilingual language, each selectable to a dedicated context bubble whose primary action is **✦ Ask**.

**Architecture:** A new display-only Lexical decorator node (`ChromeNode`, built in the `BlockDataNode` opaque-carrier style) is interleaved into the editor tree at each section boundary from `DocumentDTO.sections` (already available in the doc store). Selecting a band reports `blockType:"chrome:top|bottom|section"` out of `EditorBridge` on the existing selection pipeline; `WorkspaceLexicalView.onState` routes that into a new `chromeSelection` field on the workspace store, and `FloatingPill` renders a new lightweight `ChromeContextBar`. Writes go through the existing AI tool loop (✦ Ask → `set_header`/`set_footer`) — no new server endpoints, no new ops.

**Tech Stack:** Expo v56, React Native New Arch, Lexical (in an Expo DOM component), Zustand, i18next (en/fr/ar), TypeScript.

---

## ⚠️ Verification model for this repo (read first)

**This app has NO JS test runner** (confirmed: no jest/vitest, and per project convention). Do **not** add one or write `.test.ts` files. The per-task gate is:

1. `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit` → **must be clean** (0 errors).
2. The stated **on-device visual check** (run the app, open a multi-section Arabic thesis in the workspace). Simulator is fine for layout; device recommended for the flying pill.

**Git (parallel-session safe):** the user runs concurrent sessions and has uncommitted WIP (`app/(tabs)/index.tsx`, `app/(tabs)/thesis.tsx`). Every commit step must `git add` the **exact paths only** — never `git add -A`/`.`. Use fresh commits, never `--amend`. Re-check `git status` if anything looks off. End commit messages with the standard trailer.

---

## File Structure

**Create:**
- `components/workspace/ChromeContextBar.tsx` — the native chrome bubble (plain sentence + ✦ Ask + quick chips). One responsibility: render the chrome context toolbar.

**Modify:**
- `components/workspace/lexical/blockLexical.tsx` — add `ChromeData` type, `ChromeNode` class + `ChromeBand` web view + `$createChromeNode`/`$isChromeNode`; interleave bands in `$blocksToLexical`; skip chrome in `$lexicalToBlocks`.
- `components/workspace/lexical/LexicalDomEditor.tsx` — register `ChromeNode`; add `chrome` prop threaded to `$blocksToLexical`; report chrome selection in `EditorBridge`; ignore chrome in the web `FloatingToolbar`.
- `components/workspace/WorkspaceLexicalView.tsx` — build `ChromeData[]` from `doc.sections` + `t()`, pass as `chrome` (seed + reseed); route `chrome:*` blockType in `onState`.
- `lib/bubble-configs.ts` — extend `BubbleKind` + `BUBBLE_ICONS`; add `chromeBubbleKind()`.
- `stores/workspace-store.ts` — add `chromeSelection` state + `setChromeSelection`.
- `components/workspace/FloatingPill.tsx` — render `ChromeContextBar` / chrome-scoped AIDock when `chromeSelection` is set.
- `locales/en.json`, `locales/fr.json`, `locales/ar.json` — new `workspace.hf.*` keys (surgical, never json parse — files have duplicate keys).

---

## Task 1: `ChromeData` type + `ChromeNode` decorator node (display-only)

**Files:**
- Modify: `components/workspace/lexical/blockLexical.tsx` (add near the other custom nodes, e.g. after `BlockDataNode` ~line 808)

- [ ] **Step 1: Add the `ChromeData` type** near the top type declarations (with `ParaRun`/`TableStyleExtra`, ~line 47-61):

```tsx
export type ChromeKind = "top" | "bottom" | "section";

/** One inline chrome band interleaved into the editor tree (display-only). */
export type ChromeData = {
  kind: ChromeKind;
  sectionIndex: number;    // index into DocumentDTO.sections
  startBlockIndex: number; // the section's first block index — AI target + pill anchor row
  text: string;            // running-title text (top) / footer text (bottom); "" allowed
  label: string;           // localized short band label, e.g. "Top of every page" (baked in natively)
  rtl: boolean;
};
```

- [ ] **Step 2: Add the `ChromeBand` web view + `ChromeNode` class** immediately after `$isBlockDataNode` (~line 808). Mirror `BlockDataNode` exactly, but display-only (`getTextContent()` returns `""`). Reuse the already-imported `$createNodeSelection`, `$setSelection`, `SKIP_DOM_SELECTION_TAG`, `React`, `DecoratorNode`:

```tsx
/** The band rendered inside the WebView for a chrome node. */
function ChromeBand({ data, onPick }: { data: ChromeData; onPick: () => void }): React.ReactElement {
  const isSection = data.kind === "section";
  const glyph = data.kind === "top" ? "⊤" : data.kind === "bottom" ? "⊥" : "§";
  if (isSection) {
    return React.createElement(
      "div",
      { className: "lx-chrome lx-chrome-break", onClick: onPick },
      React.createElement("span", { className: "lx-chrome-line" }),
      React.createElement("span", { className: "lx-chrome-lbl" }, `${glyph} ${data.label}`),
      React.createElement("span", { className: "lx-chrome-line" }),
    );
  }
  return React.createElement(
    "div",
    { className: "lx-chrome lx-chrome-band", dir: data.rtl ? "rtl" : "ltr", onClick: onPick },
    React.createElement("span", { className: "lx-chrome-tag" }, `${glyph} ${data.label}`),
    React.createElement("span", { className: "lx-chrome-text" }, data.text || "—"),
  );
}

export class ChromeNode extends DecoratorNode<React.ReactNode> {
  __data: ChromeData;
  static getType(): string { return "doc-chrome"; }
  static clone(node: ChromeNode): ChromeNode { return new ChromeNode(node.__data, node.__key); }
  constructor(data: ChromeData, key?: NodeKey) { super(key); this.__data = data; }
  getData(): ChromeData { return this.getLatest().__data; }
  getTextContent(): string { return ""; } // invisible to $lexicalToBlocks / the block model
  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText = "margin:6px 0;";
    el.contentEditable = "false";
    return el;
  }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  decorate(editor: LexicalEditor): React.ReactNode {
    const key = this.getKey();
    const pick = () =>
      editor.update(
        () => {
          const ns = $createNodeSelection();
          ns.add(key);
          $setSelection(ns);
        },
        { tag: SKIP_DOM_SELECTION_TAG },
      );
    return React.createElement(ChromeBand, { data: this.__data, onPick: pick });
  }
  exportJSON(): Record<string, unknown> {
    return { ...super.exportJSON(), type: "doc-chrome", version: 1, data: this.__data };
  }
  static importJSON(json: { data: ChromeData }): ChromeNode { return new ChromeNode(json.data); }
}

export function $createChromeNode(data: ChromeData): ChromeNode { return new ChromeNode(data); }
export function $isChromeNode(node: LexicalNode | null | undefined): node is ChromeNode {
  return node instanceof ChromeNode;
}
```

- [ ] **Step 3: Add the band CSS.** Chrome bands render in the WebView, so their styles must live in the DOM editor's injected CSS, not RN styles. Open `components/workspace/lexical/LexicalDomEditor.tsx`, find the `.lx-blockpick` CSS rule (~line 227) and add adjacent rules (use the terracotta chrome hue and keep it theme-neutral — the WebView background is the paper color):

```css
.lx-chrome { cursor: pointer; user-select: none; }
.lx-chrome-band { display: flex; gap: 8px; align-items: baseline; padding: 8px 10px; margin: 6px 0;
  border: 1px dashed rgba(154,90,49,.40); border-radius: 8px; background: rgba(154,90,49,.07); }
.lx-chrome-tag { font-size: 10px; font-weight: 800; letter-spacing: .04em; color: #9A5A31; white-space: nowrap; }
.lx-chrome-text { font-size: 13px; color: #6E6456; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lx-chrome-break { display: flex; align-items: center; gap: 8px; margin: 12px 2px; }
.lx-chrome-break .lx-chrome-line { flex: 1; height: 1px; background: rgba(154,90,49,.35); }
.lx-chrome-lbl { font-size: 10px; font-weight: 800; color: #9A5A31; padding: 3px 9px;
  border: 1px solid rgba(154,90,49,.35); border-radius: 20px; white-space: nowrap; }
```

- [ ] **Step 4: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean (the node is not yet referenced anywhere, but the class must compile). If `LexicalEditor` / `NodeKey` / `LexicalNode` types are unimported, add them to the existing `lexical` import in this file.

- [ ] **Step 5: Commit.**

```bash
git add components/workspace/lexical/blockLexical.tsx components/workspace/lexical/LexicalDomEditor.tsx
git commit -m "feat(writer): add display-only ChromeNode for section headers/footers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Register `ChromeNode` + exclude it from block serialization

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx:1690` (nodes array)
- Modify: `components/workspace/lexical/blockLexical.tsx` (`$lexicalToBlocks`, ~line 1374)

- [ ] **Step 1: Register the node.** In `LexicalDomEditor.tsx`, the editor `nodes` array (~line 1690) currently lists `[HeadingNode, QuoteNode, ListNode, ListItemNode, BlockDataNode, SuggestionNode, RangeSuggestionNode, GhostCompletionNode]`. Add `ChromeNode`, and add `ChromeNode` to the existing import from `./blockLexical`:

```tsx
nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, BlockDataNode, SuggestionNode, RangeSuggestionNode, GhostCompletionNode, ChromeNode],
```

- [ ] **Step 2: Skip chrome nodes in `$lexicalToBlocks`.** In `blockLexical.tsx`, at the very top of the `for (const node of $getRoot().getChildren())` loop (~line 1376, alongside the existing `$isSuggestionNode` / `$isRangeSuggestionNode` guards), add:

```tsx
if ($isChromeNode(node)) continue; // display-only chrome — never serializes to a block
```

- [ ] **Step 3: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add components/workspace/lexical/LexicalDomEditor.tsx components/workspace/lexical/blockLexical.tsx
git commit -m "feat(writer): register ChromeNode + exclude it from block round-trip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Interleave bands from `sections` + thread `chrome` into the editor

**Files:**
- Modify: `components/workspace/lexical/blockLexical.tsx` (`$blocksToLexical`, line 1334)
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (props type ~1621, seed call ~1691, reseed handling)
- Modify: `components/workspace/WorkspaceLexicalView.tsx` (build + pass `chrome`)

- [ ] **Step 1: Extend `$blocksToLexical` to interleave chrome bands.** Change the signature to accept `chrome`, and build lookup maps from a block index to the band(s) that start/end there. Replace the function header and add interleaving at the two insertion points (before appending the block at a section start; after finishing the block at a section end). Full replacement of `$blocksToLexical` (line 1334):

```tsx
export function $blocksToLexical(blocks: DocBlockDTO[], chrome?: ChromeData[]): void {
  const root = $getRoot();
  root.clear();

  // Group chrome bands by their anchor block index.
  // "top" + "section" bands render BEFORE the block at their startBlockIndex.
  // "bottom" bands render AFTER the block at (nextStart - 1) / doc end — we pin
  // each bottom band to the block index one before the NEXT section's start,
  // or to the last block for the final section. WorkspaceLexicalView computes
  // that anchor and stores it in ChromeData.startBlockIndex for bottom bands too.
  const before = new Map<number, ChromeData[]>();
  const after = new Map<number, ChromeData[]>();
  for (const c of chrome ?? []) {
    const map = c.kind === "bottom" ? after : before;
    const arr = map.get(c.startBlockIndex) ?? [];
    arr.push(c);
    map.set(c.startBlockIndex, arr);
  }
  const emitBefore = (idx: number) => {
    for (const c of before.get(idx) ?? []) root.append($createChromeNode(c));
  };
  const emitAfter = (idx: number) => {
    for (const c of after.get(idx) ?? []) root.append($createChromeNode(c));
  };

  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const lk = b.kind === "paragraph" ? blockList(b) : null;
    if (b.kind === "paragraph" && lk) {
      // A list run: chrome bands only anchor to the run's FIRST/last block index.
      emitBefore(blocks[i].index);
      const listNode = $createListNode(lk === "number" ? "number" : "bullet");
      let lastIdx = blocks[i].index;
      while (i < blocks.length && blocks[i].kind === "paragraph" && blockList(blocks[i]) === lk) {
        const bb = blocks[i] as ParagraphDTO;
        const li = $createListItemNode();
        appendRuns(li, bb);
        if (bb.direction) li.setDirection(bb.direction);
        listNode.append(li);
        lastIdx = bb.index;
        i++;
      }
      root.append(listNode);
      emitAfter(lastIdx);
      continue;
    }
    emitBefore(b.index);
    if (b.kind === "paragraph") {
      const el: ElementNode =
        b.level >= 1
          ? $createHeadingNode(("h" + Math.min(b.level, 6)) as HeadingTagType)
          : $createParagraphNode();
      appendRuns(el, b);
      const fmt = b.alignment ? alignToFormat[b.alignment] : undefined;
      if (fmt) el.setFormat(fmt);
      if (b.direction) el.setDirection(b.direction);
      root.append(el);
    } else {
      root.append($createBlockDataNode(b));
    }
    emitAfter(b.index);
    i++;
  }
  if (root.getFirstChild() === null) root.append($createParagraphNode());
}
```

Note: bands key off `b.index` (the DTO's own index), not the loop counter `i`, because a list run collapses multiple blocks.

- [ ] **Step 2: Add the `chrome` prop to `LexicalDomEditor`.** In the props type (~line 1621-1685), add:

```tsx
  chrome?: ChromeData[];
```

Add `chrome` to the destructured params (~line 1591-1620), import `ChromeData` + `$createChromeNode` + `$isChromeNode` + `ChromeNode` from `./blockLexical`, and pass it into the initial seed at ~line 1691:

```tsx
editorState: () => $blocksToLexical(initialBlocks ?? [], chrome),
```

- [ ] **Step 3: Thread `chrome` through reseed.** The `reseed` prop type is `{ blocks: DocBlockDTO[]; nonce: number }` — extend it to `{ blocks: DocBlockDTO[]; chrome?: ChromeData[]; nonce: number }`. Find the reseed effect that calls `$blocksToLexical(reseed.blocks)` inside an `editor.update(...)` and pass the chrome through: `$blocksToLexical(reseed.blocks, reseed.chrome)`.

- [ ] **Step 4: Build + pass `chrome` from `WorkspaceLexicalView`.** This component already subscribes to the doc (`const doc = useThesisDocStore((s) => s.byId[thesisId]);` ~line 144), so `doc.sections` is in hand. Add a builder that turns `sections` into `ChromeData[]`, using `useTranslation()`'s `t` (import `useTranslation` from `react-i18next` if not present). Place near `stripMedia`:

```tsx
function buildChrome(
  sections: DocSectionDTO[] | undefined,
  blocks: DocBlockDTO[],
  rtl: boolean,
  t: (k: string, o?: Record<string, unknown>) => string,
): ChromeData[] {
  if (!sections || sections.length === 0 || blocks.length === 0) return [];
  const lastIdx = blocks[blocks.length - 1].index;
  const out: ChromeData[] = [];
  sections.forEach((s, si) => {
    const nextStart = sections[si + 1]?.startBlockIndex ?? lastIdx + 1;
    // new-section divider (not for the very first section)
    if (si > 0) {
      out.push({ kind: "section", sectionIndex: si, startBlockIndex: s.startBlockIndex, text: "",
        label: t("workspace.hf.newSectionHere", { defaultValue: "New section" }), rtl });
    }
    // top-of-page band (only if this section actually has a header)
    if (s.header) {
      out.push({ kind: "top", sectionIndex: si, startBlockIndex: s.startBlockIndex, text: s.header.text,
        label: t("workspace.hf.topOfPage", { defaultValue: "Top of every page" }), rtl });
    }
    // bottom-of-page band anchored to the LAST block of this section
    if (s.footer) {
      const bottomText = s.footer.text || t("workspace.hf.pageNumberValue", { defaultValue: "page number" });
      out.push({ kind: "bottom", sectionIndex: si, startBlockIndex: Math.max(s.startBlockIndex, nextStart - 1),
        text: bottomText, label: t("workspace.hf.bottomOfPage", { defaultValue: "Bottom of every page" }), rtl });
    }
  });
  return out;
}
```

Then compute it and pass it. Add `const { t } = useTranslation();` in the component, compute `const chrome = useMemo(() => buildChrome(doc?.available ? doc.sections : undefined, blocks, rtl, t), [doc, blocks, rtl, t]);` and pass `chrome={chrome}` in the `<LexicalDomEditor …/>` JSX (line 706-738), and include `chrome` in the object passed to `reseed` wherever `reseed={{ blocks: …, nonce: … }}` is built. Import `DocSectionDTO` and `ChromeData` at the top.

- [ ] **Step 5: Verify tsc + on-device.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit` (expected clean). Then run the app, open a **multi-section Arabic thesis** in the workspace (Writer view). Expected: terracotta dashed **top/bottom bands** appear at the right section boundaries with the running title / page-number text, and a `§` divider between sections. A single-section doc shows at most one top + one bottom band (or none if the section has no header/footer). Body text is unchanged.

- [ ] **Step 6: Commit.**

```bash
git add components/workspace/lexical/blockLexical.tsx components/workspace/lexical/LexicalDomEditor.tsx components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(writer): render section header/footer/break as inline bands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Report chrome selection out of `EditorBridge` (+ ignore in web toolbar)

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (`EditorBridge` NodeSelection branch ~515-524; web `FloatingToolbar` ~588-597)

- [ ] **Step 1: Detect a selected `ChromeNode` and report it.** In the `EditorBridge` update listener, locate the `$isNodeSelection(sel)` branch (~line 515) where a single `BlockDataNode` (`bd`) is detected and its `payload` is built with `blockType: bd.getBlock().kind`. Add a sibling detection for a single `ChromeNode` right next to it, building the **same payload shape** so it flows through the identical `y`-stamp (`getElementByKey(key)`) + `onState` path the BlockDataNode selection already uses:

```tsx
const cn = nodes.length === 1 && $isChromeNode(nodes[0]) ? nodes[0] : null;
if (cn) {
  const cd = cn.getData();
  key = cn.getKey();
  payload = {
    bold: false, italic: false, underline: false,
    blockType: "chrome:" + cd.kind,      // "chrome:top" | "chrome:bottom" | "chrome:section"
    isRTL: cd.rtl, alignment: null,
    index: cd.startBlockIndex, text: cd.text,
    blocks: [{ index: cd.startBlockIndex, text: cd.text }],
    y: -1,
  };
}
```

Place this so that if `cn` is set, `bd` handling is skipped (they are mutually exclusive — a selection is one or the other). Do **not** early-return before the shared `y`-stamp/`onState`; mirror exactly how the existing `bd` payload reaches `onState`.

- [ ] **Step 2: Make the in-WebView `FloatingToolbar` ignore chrome nodes.** The native `FloatingPill` owns the chrome bubble; the web fallback toolbar (~line 588-597) must not show its structural move/delete pill on a chrome node. In `FloatingToolbar`'s selection/kind detection, if the selected node `$isChromeNode(node)`, render `null` (return no toolbar). Add the guard wherever it computes whether to show for a `NodeSelection`.

- [ ] **Step 3: Verify tsc + on-device.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit` (clean). Then in the app, **tap a band**: expected the native ✦ pill flies to that band's row (anchored via `y`). The web move/delete toolbar must NOT appear over the band. (The pill will still show its generic content until Task 8 — that's fine for now; verify only the anchor + no web toolbar.)

- [ ] **Step 4: Commit.**

```bash
git add components/workspace/lexical/LexicalDomEditor.tsx
git commit -m "feat(writer): report chrome-band selection from EditorBridge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `chromeSelection` state in the workspace store + `onState` routing

**Files:**
- Modify: `stores/workspace-store.ts`
- Modify: `components/workspace/WorkspaceLexicalView.tsx` (`onState`, ~463-491)

- [ ] **Step 1: Add `chromeSelection` to the store.** Open `stores/workspace-store.ts`. Add the state field and action, mirroring an existing nullable field's pattern. Add to the state type:

```tsx
chromeSelection: { kind: "top" | "bottom" | "section"; index: number; text: string } | null;
setChromeSelection: (c: { kind: "top" | "bottom" | "section"; index: number; text: string } | null) => void;
```

In the store creator, initialize `chromeSelection: null,` and add:

```tsx
setChromeSelection: (c) => set({ chromeSelection: c }),
```

- [ ] **Step 2: Route `chrome:*` in `onState`.** In `WorkspaceLexicalView.tsx`, `onState` (~463) currently mirrors the selection into `useWorkspaceStore` (`selectBlock`/`setSelection`) and sets `anchorY`. At the **top** of `onState`, branch on the chrome marker:

```tsx
if (s.blockType && s.blockType.startsWith("chrome:")) {
  const kind = s.blockType.slice("chrome:".length) as "top" | "bottom" | "section";
  useWorkspaceStore.getState().setChromeSelection({ kind, index: s.index, text: s.text });
  useWorkspaceStore.getState().clearSelection(); // ensure the normal block bubble path is off
  useLexicalEditorStore.getState().setFormat({
    bold: false, italic: false, underline: false, blockType: s.blockType, isRTL: s.isRTL, alignment: s.alignment ?? null,
  });
  if (s.y != null && s.y >= 0) useFloatingPillStore.getState().setAnchorY(editorTopRef.current + s.y);
  return;
}
useWorkspaceStore.getState().setChromeSelection(null); // normal selection clears any prior chrome
```

Use the store's **actual** clear method — if `clearSelection` does not exist, use whatever `onState` already calls to set an empty selection (e.g. `setSelection([])`). Read the store to confirm the exact name before writing. Keep the rest of the existing `onState` body below this branch unchanged.

- [ ] **Step 3: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add stores/workspace-store.ts components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(writer): track chrome-band selection in workspace store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extend `BubbleKind` + icons for chrome

**Files:**
- Modify: `lib/bubble-configs.ts`

- [ ] **Step 1: Extend the union, icons, and add a mapper.** Full replacement of `lib/bubble-configs.ts` (only additions — keep `resolveBubbleKind` as-is; chrome is not a `DocBlockDTO`):

```tsx
import { BarChart3, Heading1, Image as ImageIcon, PanelBottom, PanelTop, SeparatorHorizontal, Shapes, Sparkles, Table, Type, type LucideIcon } from "lucide-react-native";
import type { DocBlockDTO } from "@/lib/api";

/** Which bubble/toolset family a selection belongs to. "ai" = nothing selected. */
export type BubbleKind = "ai" | "text" | "heading" | "image" | "chart" | "table" | "other" | "hfTop" | "hfBottom" | "hfSection";

export function resolveBubbleKind(block: DocBlockDTO | null | undefined): BubbleKind {
  if (!block) return "text";
  switch (block.kind) {
    case "paragraph":
      return block.level >= 1 ? "heading" : "text";
    case "image":
      return block.dataUri || block.hasMedia ? "image" : "chart";
    case "table":
      return "table";
    case "other":
      return "other";
    default:
      return "text";
  }
}

/** Map a chrome-band kind to its bubble family. */
export function chromeBubbleKind(kind: "top" | "bottom" | "section"): BubbleKind {
  return kind === "top" ? "hfTop" : kind === "bottom" ? "hfBottom" : "hfSection";
}

/** Bubble icon per kind — the collapsed circle's glyph. */
export const BUBBLE_ICONS: Record<BubbleKind, LucideIcon> = {
  ai: Sparkles,
  text: Type,
  heading: Heading1,
  image: ImageIcon,
  chart: BarChart3,
  table: Table,
  other: Shapes,
  hfTop: PanelTop,
  hfBottom: PanelBottom,
  hfSection: SeparatorHorizontal,
};
```

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean. (If any `switch (bubbleKind)` elsewhere is now non-exhaustive, tsc will flag it — those are handled in Task 8; if a stray exhaustive switch errors, add a `default`/no-op case for the new kinds.)

- [ ] **Step 3: Commit.**

```bash
git add lib/bubble-configs.ts
git commit -m "feat(writer): add chrome bubble kinds + icons

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `ChromeContextBar` component (the chrome bubble)

**Files:**
- Create: `components/workspace/ChromeContextBar.tsx`

- [ ] **Step 1: Write the component.** A lightweight bubble: chip glyph, plain type label, one explanatory sentence, ✦ Ask (primary), and one quick chip. Uses `useThemeColors` + `t()` (match the theming/i18n conventions used by `BlockContextBar`). Full file:

```tsx
import { PanelBottom, PanelTop, SeparatorHorizontal, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

type ChromeKind = "top" | "bottom" | "section";

interface Props {
  kind: ChromeKind;
  text: string;
  rtl: boolean;
  onAskAI: () => void;       // opens the section-scoped AI input
  onCollapse?: () => void;
}

const ICON = { top: PanelTop, bottom: PanelBottom, section: SeparatorHorizontal };

export function ChromeContextBar({ kind, text, rtl, onAskAI }: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const Icon = ICON[kind];

  const label =
    kind === "top" ? t("workspace.hf.topOfPage", { defaultValue: "Top of every page" })
    : kind === "bottom" ? t("workspace.hf.bottomOfPage", { defaultValue: "Bottom of every page" })
    : t("workspace.hf.newSectionHere", { defaultValue: "New section starts here" });

  const explain =
    kind === "top" ? t("workspace.hf.topExplain", { defaultValue: "This title repeats at the top of every page in this section." })
    : kind === "bottom" ? t("workspace.hf.bottomExplain", { defaultValue: "This repeats at the bottom of every page — usually the page number." })
    : t("workspace.hf.sectionExplain", { defaultValue: "Everything after this point begins a new section on a fresh page." });

  return (
    <View style={[styles.wrap, { backgroundColor: c.bgPrimary, borderColor: c.borderDefault }]}>
      <View style={[styles.head, rtl && styles.headRtl]}>
        <View style={[styles.chip, { backgroundColor: "#9A5A31" }]}>
          <Icon size={13} color="#fff" />
        </View>
        <Text style={[styles.label, { color: c.textPrimary }]} numberOfLines={1}>{label}</Text>
        {text ? <Text style={[styles.sub, { color: c.textSecondary }]} numberOfLines={1}>{text}</Text> : null}
      </View>
      <Text style={[styles.explain, { color: c.textSecondary }]}>{explain}</Text>
      <View style={[styles.tools, rtl && styles.headRtl]}>
        <Pressable
          onPress={onAskAI}
          style={[styles.ask, { backgroundColor: c.brandPrimary }]}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.hf.ask", { defaultValue: "Ask AI to change this" })}
        >
          <Sparkles size={14} color="#fff" />
          <Text style={styles.askTxt}>{t("workspace.hf.ask", { defaultValue: "Ask AI to change this" })}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 16, padding: 10, gap: 8, minWidth: 240 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headRtl: { flexDirection: "row-reverse" },
  chip: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontWeight: "700" },
  sub: { fontSize: 11, flexShrink: 1 },
  explain: { fontSize: 11, lineHeight: 15 },
  tools: { flexDirection: "row", gap: 6 },
  ask: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  askTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
```

Note: confirm the exact `useThemeColors` prop names against `hooks/useThemeColors` (memory lists `bgPrimary`, `textPrimary`, `brandPrimary`, `borderDefault`; verify `textSecondary` exists — if the token is named differently, use the real one). Confirm the `Pressable` renders visibly (New-Arch trap: `Pressable` style-functions can silently no-op — use a static style object, as above).

- [ ] **Step 2: Verify tsc.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add components/workspace/ChromeContextBar.tsx
git commit -m "feat(writer): add ChromeContextBar chrome bubble

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire `FloatingPill` to show the chrome bubble

**Files:**
- Modify: `components/workspace/FloatingPill.tsx`

- [ ] **Step 1: Read chrome selection + derive kind.** Near the other store reads (~line 76-143), add (select the object reference from the store — do NOT build a fresh literal in the selector; memory: zustand-selector-loop):

```tsx
const chromeSelection = useWorkspaceStore((s) => s.chromeSelection);
```

Then override `bubbleKind` when chrome is active (~line 143):

```tsx
const bubbleKind: BubbleKind = chromeSelection
  ? chromeBubbleKind(chromeSelection.kind)
  : count === 0
    ? "ai"
    : resolveBubbleKind(selectedBlock);
```

Import `chromeBubbleKind` from `@/lib/bubble-configs` and `ChromeContextBar` from `./ChromeContextBar`.

- [ ] **Step 2: Compute a chrome scope label** for the AI input (reuses AIDock's existing `scopeLabel`/`scopeText`/`scopeIndices` props — no new AIDock prop). Add near the other scope computations:

```tsx
const chromeScopeLabel = chromeSelection
  ? chromeSelection.kind === "top"
    ? t("workspace.hf.topOfPage", { defaultValue: "Top of every page" })
    : chromeSelection.kind === "bottom"
      ? t("workspace.hf.bottomOfPage", { defaultValue: "Bottom of every page" })
      : t("workspace.hf.newSectionHere", { defaultValue: "New section" })
  : null;
```

- [ ] **Step 3: Branch the expanded render.** In the expanded block (~line 409-440), make chrome win first. Replace the `expanded ? ( … ) : ( <Bubble …/> )` inner content so the order is: chrome-input → chrome-bar → (existing AIDock/BlockContextBar):

```tsx
{expanded ? (
  chromeSelection ? (
    inputOpen ? (
      <View style={[styles.dockPanel]}>
        <AIDock
          thesisId={thesisId}
          scopeLabel={chromeScopeLabel ?? ""}
          scopeIndices={[chromeSelection.index]}
          selectedBlock={null}
          scopeText={chromeSelection.text}
          scopeBlocks={[]}
        />
      </View>
    ) : (
      <ChromeContextBar
        kind={chromeSelection.kind}
        text={chromeSelection.text}
        rtl={rtl}
        onAskAI={() => useFloatingPillStore.getState().setInputOpen(true)}
        onCollapse={() => useFloatingPillStore.getState().setExpanded(false)}
      />
    )
  ) : count === 0 || inputOpen ? (
    /* …existing AIDock branch, unchanged… */
  ) : (
    /* …existing BlockContextBar branch, unchanged… */
  )
) : (
  <Bubble colors={colors} kind={bubbleKind} busy={busy} label={/* …unchanged… */} onPress={/* …unchanged… */} />
)}
```

Keep the existing AIDock/BlockContextBar branches exactly as they are — only prepend the `chromeSelection ? … :` layer. Verify `AIDock`'s prop names against its current signature (memory: `scopeLabel`, `scopeIndices`, `selectedBlock`, `scopeText`, `scopeBlocks`).

- [ ] **Step 4: Verify tsc + on-device.** Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit` (clean). Then in the app: tap the **top-of-page band** → the pill expands to `ChromeContextBar` with the ⊤ chip, "Top of every page", the running title, and the plain sentence + ✦ Ask. Tap ✦ Ask → the AIDock input opens scoped to the section. Type "change the running title to X" → confirm the AI tool loop proposes a `set_section_header` change (existing confirm chip). Repeat for bottom + section bands. Switch app language (ar/fr/en) → all labels/sentences re-localize; RTL layout correct.

- [ ] **Step 5: Commit.**

```bash
git add components/workspace/FloatingPill.tsx
git commit -m "feat(writer): show ChromeContextBar + section-scoped Ask for chrome bands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Trilingual `workspace.hf.*` keys

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Add keys surgically to `en.json`.** These files have **duplicate keys** — never `JSON.parse`/`stringify` them (memory: locale-json-duplicate-keys). Locate the `hf` block (en.json ~line 632-640, anchored by `"headerIs"`/`"footerIs"`) and insert the new members after `"footerIs"`, keeping indentation + commas:

```json
      "topOfPage": "Top of every page",
      "bottomOfPage": "Bottom of every page",
      "newSectionHere": "New section starts here",
      "pageNumberValue": "page number",
      "topExplain": "This title repeats at the top of every page in this section.",
      "bottomExplain": "This repeats at the bottom of every page — usually the page number.",
      "sectionExplain": "Everything after this point begins a new section on a fresh page.",
      "ask": "Ask AI to change this",
```

- [ ] **Step 2: Add the same keys to `fr.json`** (`hf` block ~line 633-639), after `"footerIs"`:

```json
      "topOfPage": "Haut de chaque page",
      "bottomOfPage": "Bas de chaque page",
      "newSectionHere": "Nouvelle section ici",
      "pageNumberValue": "numéro de page",
      "topExplain": "Ce titre se répète en haut de chaque page de cette section.",
      "bottomExplain": "Ceci se répète en bas de chaque page — souvent le numéro de page.",
      "sectionExplain": "Tout ce qui suit commence une nouvelle section sur une nouvelle page.",
      "ask": "Demander à l’IA de modifier",
```

- [ ] **Step 3: Add the same keys to `ar.json`** (`hf` block ~line 633-639), after `"footerIs"`:

```json
      "topOfPage": "أعلى كل صفحة",
      "bottomOfPage": "أسفل كل صفحة",
      "newSectionHere": "يبدأ قسم جديد هنا",
      "pageNumberValue": "رقم الصفحة",
      "topExplain": "يتكرّر هذا العنوان أعلى كل صفحة من هذا القسم.",
      "bottomExplain": "يتكرّر هذا أسفل كل صفحة — غالبًا رقم الصفحة.",
      "sectionExplain": "كل ما يأتي بعد هذه النقطة يبدأ قسمًا جديدًا في صفحة جديدة.",
      "ask": "اطلب من الذكاء الاصطناعي التغيير",
```

- [ ] **Step 4: Verify JSON + tsc.** Confirm each file still parses: `node -e "require('./locales/en.json'); require('./locales/fr.json'); require('./locales/ar.json'); console.log('ok')"` → prints `ok` (duplicate keys parse fine; this only catches syntax slips like a missing comma). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit.**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(writer): plain-language chrome band keys (en/fr/ar)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Full device QA pass

**Files:** none (verification only)

- [ ] **Step 1: Multi-section Arabic thesis.** Bands appear at every section boundary; header/footer text matches the exported docx / the read-only `OutlineChrome`. RTL correct.
- [ ] **Step 2: Single-section + no-chrome docs.** A doc whose section has no header/footer shows no bands (or only the ones that exist). No `§` divider when there's only one section.
- [ ] **Step 3: Selection + anchor.** Tapping each band flies the pill to that row; the correct `ChromeContextBar` shows; the web move/delete toolbar never appears over a band.
- [ ] **Step 4: Editability via ✦.** ✦ Ask → AIDock scoped to the section → an AI request produces the correct `set_section_header`/`set_section_footer` confirm chip; approving it updates the band after the doc reloads.
- [ ] **Step 5: Round-trip safety.** Make a normal body edit, let it sync, reopen: body blocks unchanged; chrome nodes never leaked into the block model (no phantom empty paragraphs where bands were). Undo/redo does not corrupt the tree.
- [ ] **Step 6: Trilingual.** Switch ar/fr/en: every band label, bubble label, and explanatory sentence re-localizes; layout stays correct in RTL and LTR.
- [ ] **Step 7: Commit** any QA-driven fixes with exact paths (fresh commits, no `--amend`).

---

## Self-Review (author checklist — completed)

**Spec coverage:** inline bands (Task 3) · plain trilingual language (Tasks 1,7,9) · per-type bubble (Tasks 6,7,8) · AI-first write path / no new endpoints (Task 8 via existing AIDock→tool loop) · "no page model → render at section boundaries" (Task 3 builder) · v2 deferrals untouched. ✅

**Placeholder scan:** no TBD/TODO; every code step shows real code. Two flagged read-before-write points (exact `clearSelection` name in Task 5; `useThemeColors`/`AIDock` prop-name confirmation in Tasks 7–8) are explicit verification instructions, not placeholders. ✅

**Type consistency:** `ChromeData`/`ChromeKind`, `$createChromeNode`/`$isChromeNode`, `chromeBubbleKind`, `chromeSelection { kind,index,text }`, and `blockType:"chrome:"+kind` are used identically across Tasks 1–8. `BubbleKind` additions (`hfTop`/`hfBottom`/`hfSection`) match `BUBBLE_ICONS` keys and `chromeBubbleKind`'s return. ✅
