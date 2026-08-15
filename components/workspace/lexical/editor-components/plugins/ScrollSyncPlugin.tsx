// Scroll persistence: keep the reading position across a re-entry.

import * as React from "react";
import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $anyNodeAtBlockIndex } from "../block-index";
import { withScrollPinned } from "../lexical-updates";
import { lxGetRoot, lxMeasureAnchor } from "../scroll-anchor";
import type { ScrollAnchor } from "../types";

// Persist + restore the reading position so the user re-enters the document where
// they left off. The Writer is destroyed on a workspace-leave (back), re-keyed on a
// Preview round-trip, and — inside a native-stack — its WebView can reset to the top
// on re-focus WITHOUT a React remount. So restore is driven by `restore.nonce`
// (native bumps it on every focus / preview-return), not by mount alone. `onScroll`
// reports the live position out (throttled) for native to keep.
//
// Reliability notes (learned the hard way): inside this WebView `window.scrollTo` is
// unreliable, so restore uses `element.scrollIntoView()` (the ONE proven primitive —
// the outline-nav scrollToIndex uses it). And DOM scroll events fire unreliably, so
// detection leans on a 700ms POLL (getBoundingClientRect is accurate) plus capture-
// phase scroll listeners.
export function ScrollSyncPlugin({
  restore,
  onScroll,
  onRestored,
}: {
  restore?: { anchor: ScrollAnchor; nonce: number } | null;
  onScroll?: (anchor: ScrollAnchor) => void;
  onRestored?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Shared gate: while a restore is settling, reporting is suppressed so the fresh
  // (reset-to-top) position isn't saved over the anchor we're about to restore to.
  const armedRef = useRef(true);
  const cancelRestoreRef = useRef<(() => void) | null>(null);

  // ── Reporting (mount-lifetime): capture-phase events + a poll backstop. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Shared with withScrollPinned's pin — one measurement, so the position a
    // mutation restores is read exactly the way the one native keeps is.
    const measure = (): ScrollAnchor => lxMeasureAnchor(editor);
    let lastKey = "";
    const emit = () => {
      if (!armedRef.current) return;
      const a = measure();
      const key = `${a.index}:${a.delta}`;
      if (key === lastKey) return;
      lastKey = key;
      onScroll?.(a);
    };
    let throttle: ReturnType<typeof setTimeout> | null = null;
    const onScrollEvt = () => {
      if (throttle) return;
      throttle = setTimeout(() => { throttle = null; emit(); }, 200);
    };
    const root0 = lxGetRoot(editor);
    // Passive — reporting the reading position never cancels a scroll, and declaring
    // that keeps the scroll on the compositor instead of blocking on this handler.
    const opts = { passive: true, capture: true } as const;
    window.addEventListener("scroll", onScrollEvt, opts);
    root0?.addEventListener("scroll", onScrollEvt, opts);
    const poll = setInterval(emit, 700);
    return () => {
      if (throttle) clearTimeout(throttle);
      clearInterval(poll);
      window.removeEventListener("scroll", onScrollEvt, true);
      root0?.removeEventListener("scroll", onScrollEvt, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Restore (on nonce change): scrollIntoView the anchor block over a short
  // settle window; suppress reporting until it settles so a reset-to-top can't be
  // saved over the target. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!restore || !restore.anchor || restore.anchor.index < 0) return;
    const a = restore.anchor;
    cancelRestoreRef.current?.(); // supersede any in-flight restore
    armedRef.current = false; // suppress reporting while we settle

    let cancelled = false;
    let frames = 0, hStable = 0, lastH = -1, everApplied = false;
    const cleanups: Array<() => void> = [];
    // `notify` tells native the restore reached the target (→ hide the loading
    // overlay). Superseding / unmounting cleans up WITHOUT notifying.
    const finish = (notify?: boolean) => {
      if (cancelled) return;
      cancelled = true;
      armedRef.current = true;
      cleanups.splice(0).forEach((f) => f());
      if (cancelRestoreRef.current === finish) cancelRestoreRef.current = null;
      if (notify) onRestored?.();
    };
    cancelRestoreRef.current = finish;

    // Resolve the anchor's BLOCK index → node → its DOM element via the chrome-aware
    // $anyNodeAtBlockIndex (chrome bands are top-level root DOM children but excluded
    // from the block model, so indexing raw DOM children would be off by the chrome
    // count for every block below the first band). Resolve the KEY once: the tree
    // isn't edited while layout settles, so the target node is stable across the
    // window — only its element geometry changes per frame. A null key (index out of
    // range) leaves `el` null below, preserving the original no-op guard.
    let targetKey: string | null = null;
    editor.getEditorState().read(() => {
      const node = $anyNodeAtBlockIndex(a.index);
      targetKey = node ? node.getKey() : null;
    });

    // Re-apply the anchor every frame while a big doc is still laying out (its
    // scrollHeight keeps growing), and only finish once the page has STOPPED growing
    // for several frames — i.e. layout is actually complete and the last scrollIntoView
    // truly landed. Gating on layout-done (not on "block.top ≈ target") is essential:
    // before layout, every block reports top≈0, so a delta:0 anchor would look
    // "arrived" at the very top and hide the overlay before anything scrolled. Figures
    // pre-reserve height (figureStyle) so images don't keep the height growing.
    let raf = requestAnimationFrame(function step() {
      if (cancelled) return;
      const h = document.documentElement.scrollHeight;
      hStable = h === lastH ? hStable + 1 : 0;
      lastH = h;
      // Resolve the block index → DOM element via the chrome-aware key computed
      // above. Raw root DOM children now include chrome bands, so kids[a.index]
      // would be off by the chrome count for every block below the first band.
      const el = targetKey ? editor.getElementByKey(targetKey) : null;
      if (el) {
        el.scrollIntoView({ block: "start" });
        if (a.delta > 0) window.scrollBy(0, a.delta);
        everApplied = true;
      }
      frames++;
      if (frames < 300 && (!everApplied || hStable < 8)) raf = requestAnimationFrame(step);
      else finish(true);
    });
    cleanups.push(() => cancelAnimationFrame(raf));

    // Stop the moment the user scrolls (don't fight them), and hard-cap the window.
    const userTook = () => finish(true);
    window.addEventListener("touchstart", userTook, { passive: true, capture: true });
    window.addEventListener("wheel", userTook, { passive: true, capture: true });
    cleanups.push(() => {
      window.removeEventListener("touchstart", userTook, true);
      window.removeEventListener("wheel", userTook, true);
    });
    const hardStop = setTimeout(() => finish(true), 5500);
    cleanups.push(() => clearTimeout(hardStop));

    return () => { finish(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.nonce]);

  return null;
}
