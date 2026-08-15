// Reading position as a BLOCK anchor — measure it, put it back.
//
// Two callers: ScrollSyncPlugin (hands the anchor to native so it survives a
// re-entry) and withScrollPinned (hands it straight back after a mutation).
//
// Inside this WebView `window.scrollY` / `window.scrollTo` are unreliable, which
// is why everything below reads getBoundingClientRect and writes through
// scrollIntoView + scrollBy — the one pair proven to move it.

import { $getNearestNodeFromDOMNode, type LexicalEditor } from "lexical";

import { $isDisplayOnlyNode } from "../blockLexical";
import { $anyNodeAtBlockIndex, $blockIndexOfNode } from "./block-index";
import type { ScrollAnchor } from "./types";

export function lxGetRoot(editor: LexicalEditor): HTMLElement | null {
  // .lx-content — its children are the top-level block elements.
  return editor.getRootElement() ?? (typeof document !== "undefined" ? (document.querySelector(".lx-content") as HTMLElement | null) : null);
}

// Binary-search the first top-level block whose bottom is below the viewport top
// (blocks stack top→bottom, so `bottom > 0` is monotonic). getBoundingClientRect is
// viewport-relative, so it reflects the REAL scroll even where window.scrollY is
// unreliable inside a WebView.
export function lxFirstVisible(kids: HTMLCollection): number {
  let lo = 0, hi = kids.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().bottom > 0) { ans = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return ans;
}

// Read the current reading position as a block anchor. Shared by the scroll-sync
// reporter (which hands it to native to keep across a re-entry) and by
// withScrollPinned (which hands it straight back after a mutation).
//
// The index is a BLOCK index — display-only nodes skipped, lists expanded — and not
// the raw DOM child index, because chrome bands and page boundaries are top-level
// root children that the block model excludes; a raw index would be off by their
// count for every block below the first one. `y` is kept only as the last-resort
// fallback for when no block can be resolved.
export function lxMeasureAnchor(editor: LexicalEditor): ScrollAnchor {
  const y = typeof window !== "undefined" ? window.scrollY : 0;
  const kids = lxGetRoot(editor)?.children;
  if (!kids || !kids.length) return { y, index: -1, delta: 0 };
  const i = lxFirstVisible(kids);
  if (i < 0) return { y, index: -1, delta: 0 };
  const el = kids[i] as HTMLElement;
  const r = el.getBoundingClientRect();
  let index = -1;
  // editor.read (NOT getEditorState().read): $getNearestNodeFromDOMNode maps a DOM
  // node → Lexical node via the editor's key↔DOM map, so it needs the active EDITOR
  // bound, not just the active state (getEditorState().read binds only the state →
  // getActiveEditor() throws "no active editor").
  editor.read(() => {
    let node = $getNearestNodeFromDOMNode(el);
    // The first-visible element can be a band; anchor to the block it precedes.
    while (node && $isDisplayOnlyNode(node)) node = node.getNextSibling();
    if (node) index = $blockIndexOfNode(node);
  });
  return { y, index, delta: Math.max(0, Math.round(-r.top)) };
}

// Put a measured anchor back. scrollIntoView + scrollBy is the ONE pair proven to
// move this WebView; window.scrollTo appears only as the fallback for when the
// block can't be resolved, where there is nothing better to try.
export function lxApplyAnchor(editor: LexicalEditor, a: ScrollAnchor): void {
  if (typeof window === "undefined") return;
  let key: string | null = null;
  if (a.index >= 0) {
    editor.getEditorState().read(() => {
      const node = $anyNodeAtBlockIndex(a.index);
      key = node ? node.getKey() : null;
    });
  }
  const el = key ? editor.getElementByKey(key) : null;
  if (!el) { window.scrollTo(0, a.y); return; }
  el.scrollIntoView({ block: "start" });
  if (a.delta > 0) window.scrollBy(0, a.delta);
}
