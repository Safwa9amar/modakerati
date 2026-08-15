// Fast sideways fling over plain text → open the structure drawer.

import { useEffect } from "react";

// Fast sideways fling anywhere over PLAIN text → open the Thesis-Structure drawer
// (issue #4, option C). Detected IN the WebView because only it knows whether the touch
// started on a table/image/chrome band — those own horizontal scroll and are excluded.
// A slow horizontal drag stays as text-select; the fling must be brisk + clearly
// horizontal + toward the drawer's side. Recognised on touchMOVE, so the drawer starts
// sliding under the finger rather than after it lifts — the bridge hop to the native
// side costs enough on its own. Bridges out via onOpen (thresholds are device-tunable).
export function DrawerSwipePlugin({ onOpen, rtl }: { onOpen?: () => void; rtl?: boolean }) {
  useEffect(() => {
    if (!onOpen || typeof document === "undefined") return;
    let sx = 0, sy = 0, st = 0, armed = false, fired = false;
    const onStart = (e: TouchEvent) => {
      fired = false;
      if (e.touches.length !== 1) { armed = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
      const el = e.target as HTMLElement | null;
      // Exclude tables / images / chrome bands — they own horizontal scroll (option C).
      armed = !el?.closest?.(".lx-blockpick, table, .lx-chrome, img");
    };
    // Open direction follows the APP language: Arabic (RTL) opens with a right→left
    // flick, fr/en (LTR) with a left→right flick — matching the edge-swipe side.
    const towardOpen = (dx: number) => (rtl ? -dx : dx);
    const fire = () => {
      fired = true;
      armed = false;
      window.getSelection?.()?.removeAllRanges?.(); // a fling isn't a selection
      onOpen();
    };
    // Recognise the fling MID-GESTURE. Waiting for touchend meant the drawer only
    // started moving once the finger lifted — the swipe felt like it took ~200-300ms
    // to do anything. As soon as the travel is unambiguous (past threshold, clearly
    // horizontal, still brisk) we open, so the slide begins under the finger.
    const onMove = (e: TouchEvent) => {
      if (!armed || fired) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      // The reader is scrolling the document — this gesture is not ours.
      if (Math.abs(dy) > 20 && Math.abs(dy) >= Math.abs(dx)) { armed = false; return; }
      const dt = Date.now() - st || 1;
      if (towardOpen(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 400) fire();
    };
    // Fallback for a flick so fast it barely emits touchmove events (unchanged
    // thresholds — this is the original recogniser).
    const onEnd = (e: TouchEvent) => {
      if (!armed || fired) return;
      armed = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      const dt = Date.now() - st || 1;
      const v = Math.abs(dx) / dt; // px per ms
      if (towardOpen(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && v > 0.5 && dt < 400) fire();
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [onOpen, rtl]);
  return null;
}
