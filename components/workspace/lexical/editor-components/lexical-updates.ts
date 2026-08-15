// Every mutation the APP drives goes through here rather than calling
// editor.update directly — so that nothing moves this WebView except our own
// deliberate triggers.
//
// ⚠️ Owns two module-level singletons — `lxTouching` (is a finger down?) and
// `lxPinCancel` (the pin currently re-applying across frames). This file must
// stay their ONLY home: a second copy means a second answer, and the shaking
// editor that `withScrollPinned` exists to prevent.

import {
  $addUpdateTag,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type LexicalCommand as LxCommand,
  type LexicalEditor,
} from "lexical";

import { lxApplyAnchor, lxMeasureAnchor } from "./scroll-anchor";

// Every mutation the APP drives — a pill tap, the in-editor bubble, a plugin
// rewrite, a preview swap, a completion ghost — goes through here rather than
// calling editor.update directly.
//
// Lexical's reconciler ends each update by scrolling the collapsed caret into view
// (LexicalSelection: `!tags.has(SKIP_SCROLL_INTO_VIEW_TAG) && isCollapsed &&
// rootElement === activeElement`). That is a browser-shaped default this editor
// must not have: nothing should move this WebView except our own deliberate
// triggers — scrollToIndex, scrollToChrome, ScrollSyncPlugin's restore, and
// withScrollPinned's pin. A student who taps Bold, or whose autocomplete ghost
// lands, did not ask the page to move.
//
// The student's own TYPING is deliberately left alone: Lexical's input path keeps
// the line being written above the on-screen keyboard (the visualViewport branch
// in scrollIntoViewIfNeeded). That is the one autoscroll a writing app wants, and
// silencing it would let the caret slide under the keyboard.
//
// `alsoSkipSelection` additionally suppresses the whole DOM-selection reconcile —
// stronger, and needed where the update must not touch focus either (it re-focuses
// the root, which pops the keyboard on iOS).
export function lxQuietUpdate(editor: LexicalEditor, mutator: () => void, alsoSkipSelection = false): void {
  editor.update(mutator, {
    tag: alsoSkipSelection ? [SKIP_SCROLL_INTO_VIEW_TAG, SKIP_DOM_SELECTION_TAG] : SKIP_SCROLL_INTO_VIEW_TAG,
  });
}

// Dispatch a built-in Lexical command without its autoscroll. `dispatchCommand`
// takes no update options, but a command dispatched from INSIDE an active update
// is processed within it — so the tag added here covers the listener's own work.
export function lxQuietCommand<P>(editor: LexicalEditor, command: LxCommand<P>, payload: P): void {
  editor.update(() => {
    $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
    editor.dispatchCommand(command, payload);
  });
}

// Is a finger on the screen right now? Registered once, passively, so asking is
// free on the hot path. A scroll pin must never run against a live drag.
let lxTouching = false;
// Cancels the pin currently re-applying across frames, so a burst of structural
// updates supersedes rather than stacks.
let lxPinCancel: (() => void) | null = null;
if (typeof window !== "undefined") {
  const down = () => { lxTouching = true; };
  const up = () => { lxTouching = false; };
  window.addEventListener("touchstart", down, { passive: true, capture: true });
  window.addEventListener("touchend", up, { passive: true, capture: true });
  window.addEventListener("touchcancel", up, { passive: true, capture: true });
}

// Run a Lexical mutation without letting the WebView jump: capture the page scroll
// before the update and pin it back after the DOM reconciles. A node replace (a
// suggestion appearing) or a full reseed (approve → doc rebuild) otherwise scrolls
// the moved caret / rebuilt content into view — the reported "editor scrolls away
// when I hit Improve, and jumps to the bottom on Approve".
export function withScrollPinned(editor: LexicalEditor, mutator: () => void, _blurAfter = false) {
  // The REAL fix (per Lexical docs): tag the update SKIP_DOM_SELECTION_TAG so the
  // reconciler skips the ENTIRE DOM-selection update — which is what re-focuses the
  // root (popping the keyboard → iOS scroll) AND scrolls the selection into view.
  // SKIP_SCROLL_INTO_VIEW_TAG alone wasn't enough: it stopped the scroll but the
  // re-focus still fired and iOS scrolled the focused editable into view. A light
  // 2-frame scroll restore stays as a backstop for plain reflow.
  //
  // That backstop used to be a raw `window.scrollY` → `window.scrollTo` round-trip,
  // which pinned NOTHING: both halves are unreliable inside this WebView (the same
  // reason ScrollSyncPlugin below was rewritten to stop using them). So whenever the
  // tag alone didn't hold — a full reseed rebuilds every node and there is no
  // selection left to skip — the student was dropped at the top of the document.
  // Anchor to a BLOCK instead, measured off getBoundingClientRect and put back with
  // scrollIntoView + scrollBy. It has to be the block INDEX and not a node key: a
  // reseed replaces every node, so the key captured beforehand resolves to nothing.
  // THE FINGER OUTRANKS THE PIN. Re-applying an anchor while the student is
  // scrolling is not a pin, it is a fight — and it looks like the editor shaking.
  // A touch in progress skips the pin entirely; a touch that ARRIVES mid-pin calls
  // off the remaining frames.
  if (lxTouching) {
    editor.update(mutator, { tag: SKIP_DOM_SELECTION_TAG });
    return;
  }
  const anchor = lxMeasureAnchor(editor);
  lxPinCancel?.(); // supersede an in-flight pin rather than stacking restores
  let cancelled = false;
  let raf1 = 0, raf2 = 0;
  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    if (typeof window !== "undefined") window.removeEventListener("touchstart", stop, true);
    if (lxPinCancel === stop) lxPinCancel = null;
  };
  lxPinCancel = stop;
  if (typeof window !== "undefined") window.addEventListener("touchstart", stop, { passive: true, capture: true });
  const restore = () => { if (!cancelled) lxApplyAnchor(editor, anchor); };
  editor.update(mutator, {
    tag: SKIP_DOM_SELECTION_TAG,
    // Three passes over two frames: the DOM has reconciled by onUpdate, but a reseed
    // of a long document is still growing its layout, and scrollIntoView can only
    // land against the height that exists when it runs.
    onUpdate: () => {
      restore();
      raf1 = requestAnimationFrame(() => {
        restore();
        raf2 = requestAnimationFrame(() => { restore(); stop(); });
      });
    },
  });
}
