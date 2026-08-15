// Writing page bands without moving the reader.

import { $addUpdateTag, $getRoot, SKIP_DOM_SELECTION_TAG, type LexicalEditor } from "lexical";

import { $isPageBreakNode } from "../../../blockLexical";
import { PAGES_TAG } from "./constants";

/**
 * Run a band mutation without moving the reader.
 *
 * TWO separate things move the page, and both have to be held:
 *
 * 1. FOCUS. Without SKIP_DOM_SELECTION_TAG the reconciler runs its DOM-selection
 *    update, which re-focuses the root — and a focused caret-less contentEditable
 *    makes iOS WKWebView scroll to the document top. That is the same trap
 *    withScrollPinned documents, and it is why an edit appeared to jump to the top
 *    once the sync settled: reseed → 400ms → this plugin rewrote the bands.
 * 2. LAYOUT. Inserting or removing a band ABOVE the viewport shifts everything
 *    below it. Restoring the old scrollY would hold the pixel and lose the words,
 *    so instead we anchor on a real block element: remember where the top-most
 *    visible block sat, then put it back exactly there. Block nodes are never
 *    touched by this mutation — only page nodes are — so the element survives and
 *    the anchor stays valid.
 */
export function pinnedBandUpdate(editor: LexicalEditor, mutator: () => void): void {
  let anchor: { el: HTMLElement; top: number } | null = null;
  const rootEl = editor.getRootElement();
  if (rootEl) {
    for (const child of Array.from(rootEl.children) as HTMLElement[]) {
      const r = child.getBoundingClientRect();
      if (r.bottom > 0) { anchor = { el: child, top: r.top }; break; }
    }
  }
  const restore = () => {
    if (!anchor || typeof window === "undefined") return;
    const delta = anchor.el.getBoundingClientRect().top - anchor.top;
    if (delta) window.scrollBy(0, delta);
  };
  editor.update(
    () => { $addUpdateTag(PAGES_TAG); $addUpdateTag(SKIP_DOM_SELECTION_TAG); mutator(); },
    { tag: "history-merge", onUpdate: () => { restore(); requestAnimationFrame(restore); } },
  );
}

// Strip every band. Used when there is nothing to paginate — turning the page
// view off must take the paper away, not freeze the last layout on screen.
export function dropAllBands(editor: LexicalEditor): void {
  let any = false;
  editor.getEditorState().read(() => {
    any = $getRoot().getChildren().some((n) => $isPageBreakNode(n));
  });
  if (!any) return;
  pinnedBandUpdate(editor, () => {
    $getRoot().getChildren().forEach((n) => { if ($isPageBreakNode(n)) n.remove(); });
  });
}
