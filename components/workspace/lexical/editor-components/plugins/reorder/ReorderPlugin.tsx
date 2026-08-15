// One-finger gutter-handle drag-to-reorder.
//
// The pure geometry it drives (unit rects, gaps, row grouping) lives in
// ./geometry; the tuning numbers in ./constants. What stays here is the gesture
// state machine — arm, lift, preview, drop — because it is one closure over a
// single mutable lift (`L`) and pulling pieces out of it would mean threading
// that state through parameters, not separating concerns.

import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { singleMoveTo } from "@/lib/reorder-range";
import { $blockEntries, $isDisplayOnlyNode, countListItems, type BlockEntry } from "../../../blockLexical";
import { EDGE_PX, EDGE_SPEED, GUTTER_PX, LIFT_HOLD_MS, LIFT_MOVE_PX, SETTLE_MS } from "./constants";
import {
  buildEntries,
  buildRows,
  gapFor,
  gapToBlock,
  stripEls,
  unitAt,
  type Ent,
  type Live,
} from "./geometry";

// Gated by reorder MODE (`active`). When the mode is on, a gutter with a grip (⠿)
// appears beside each draggable block; a one-finger press in that gutter arms a
// lift (tiny hold OR small move). The block then HIDES and the page previews the
// post-drop order live — every block between it and the target gap slides by one
// block-height, opening a real slot the finger drags around — while a pill of its
// text follows the finger. On release the move commits via `onReorder(from, to)`
// and the preview is held until the reseed paints the real order.
//
// Geometry is READ via $blockEntries + getElementByKey and the preview is
// transform-only (no reflow → the rects cached at lift stay valid); the pill and
// slot rule are the plugin's own elements on document.body, so the Lexical
// document is never mutated here. It is fully inert while the mode is off
// (`!active`), while `suppressed` (an AI proposal is open), or when its callbacks
// are undefined.
export function ReorderPlugin({
  onReorder,
  onLift,
  active,
  suppressed,
}: {
  onReorder?: (from: number, to: number) => void;
  onLift?: () => void;
  active?: boolean;      // reorder MODE on (from the AIDock toggle)
  suppressed?: boolean;  // an AI proposal is showing → don't arm
}) {
  const [editor] = useLexicalComposerContext();
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;
  const activeRef = useRef(active);
  activeRef.current = active;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onLiftRef = useRef(onLift);
  onLiftRef.current = onLift;

  // Reorder-mode class on the editor root (→ CSS reveals the gutter) plus the two
  // things CSS alone can't know: WHICH units are draggable (only those get a grip
  // chip — offering a handle on a unit that refuses to lift is the worst kind of
  // affordance) and WHICH SIDE the gutter belongs on for the document as a whole.
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const strip = () => {
      root.classList.remove("lx-reorder-on", "lx-reorder-rtl");
      root.querySelectorAll(".lx-drag-ok, .lx-drag-hot").forEach((el) => el.classList.remove("lx-drag-ok", "lx-drag-hot"));
      root.querySelectorAll(".lx-reorder-shift").forEach((el) => {
        (el as HTMLElement).style.transform = "";
        el.classList.remove("lx-reorder-shift");
      });
      root.querySelectorAll(".lx-reorder-lifted").forEach((el) => el.classList.remove("lx-reorder-lifted"));
    };
    if (!active) { strip(); return; }
    const mark = () => {
      let entries: BlockEntry[] = [];
      editor.getEditorState().read(() => { entries = $blockEntries(); });
      let rtl = 0, sided = 0;
      for (const e of entries) {
        const el = editor.getElementByKey(e.key) as HTMLElement | null;
        if (!el) continue;
        el.classList.toggle("lx-drag-ok", e.count === 1); // Phase 1: single-block units only
        // Only blocks that DECLARE a direction get a vote — an empty paragraph just
        // inherits the root's and would drag the whole gutter to the wrong side.
        const dir = el.getAttribute("dir") || el.style.direction;
        if (dir === "rtl" || dir === "ltr") { sided++; if (dir === "rtl") rtl++; }
      }
      root.classList.add("lx-reorder-on");
      root.classList.toggle(
        "lx-reorder-rtl",
        sided ? rtl * 2 >= sided : getComputedStyle(root).direction === "rtl",
      );
    };
    mark();
    const un = editor.registerUpdateListener(() => mark());
    return () => { un(); strip(); };
  }, [editor, active]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    // ⚠️ REGISTERED ONLY WHILE REORDER MODE IS ON. The drag needs a NON-PASSIVE
    // touchmove (it calls preventDefault to keep the page still under a lift), and a
    // non-passive touchmove on the editor root is the single most expensive listener
    // a mobile WebView can carry: the browser can no longer scroll on the compositor
    // thread, because every move must first go to JS in case it cancels. It has to
    // wait for our handler before it may paint a scroll frame. This used to be armed
    // ALL THE TIME — the handlers only checked `activeRef` once inside, which spares
    // the work but not the cost, since the cost is the listener existing at all. So
    // ordinary reading and scrolling paid a drag's price for a drag that could not
    // happen. Gate on `active` only, NOT on `suppressed`: suppression can flip while
    // a finger is down, and tearing the listeners out mid-gesture strands the lift.
    if (!active) return;
    // The Writer scrolls the DOCUMENT, not an inner box: ScrollSyncPlugin reports
    // window.scrollY, restores via window.scrollTo, and the search overlay comment
    // calls it "document scroll". There is no .lx-scroll element, so resolve the
    // auto-scroll target to document.scrollingElement (the <html>/<body> that owns
    // the document scroll) to match. NOTE: this WebView is known to make
    // window.scrollTo unreliable (see ScrollSyncPlugin) — edge auto-scroll during a
    // drag needs device verification; the drop math itself re-reads live rects.
    const scroller = (document.scrollingElement as HTMLElement | null) ?? root;

    let L: Live | null = null;
    // A drop holds its preview for a beat (see onTouchEnd). Anything that needs
    // honest geometry — the next drag, teardown — must land it FIRST: transforms
    // are baked into getBoundingClientRect, so measuring over a held preview would
    // read every block a slot out of place.
    let landPreview: (() => void) | null = null;

    const cleanup = () => {
      if (!L) return;
      if (L.timer) clearTimeout(L.timer);
      if (L.raf) cancelAnimationFrame(L.raf);
      L.pill?.remove();
      L.line?.remove();
      L.hot?.classList.remove("lx-drag-hot");
      stripEls(L.rows.flat());
      L = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!activeRef.current || suppressedRef.current || e.touches.length !== 1) { cleanup(); return; }
      landPreview?.(); // a drop still holding its preview → settle it before measuring
      const t = e.touches[0];
      const { rects } = buildEntries(editor);
      const overRect = unitAt(t.clientY, rects);
      if (!overRect || overRect.count !== 1) return; // Phase 1: only single-block units draggable (lists/sections are Phase 2)
      // Grip zone = the GUTTER_PX-wide band on the document's gutter side — the same
      // single column the CSS draws the chips in, so the hit area is always under
      // the handle the user can see (per-block direction must NOT be consulted here).
      const right = root.classList.contains("lx-reorder-rtl");
      const inGrip = right
        ? t.clientX > overRect.right - GUTTER_PX && t.clientX <= overRect.right
        : t.clientX >= overRect.left && t.clientX < overRect.left + GUTTER_PX;
      if (!inGrip) return; // touch in the text body → leave typing/selection/scroll alone
      e.preventDefault(); // own the gesture from the gutter (suppress scroll + selection)
      L = { start: { x: t.clientX, y: t.clientY }, timer: null, armed: true, lifted: false,
            from: overRect.from, srcIdx: -1, srcH: 0, entries: rects, rows: [], gaps: [], shift: [], gapIdx: -1,
            pill: null, line: null, hot: overRect.el, raf: null, lastX: t.clientX, lastY: t.clientY };
      overRect.el.classList.add("lx-drag-hot"); // the handle answers the finger immediately
      L.timer = setTimeout(() => lift(), LIFT_HOLD_MS);
    };

    const lift = () => {
      if (!L || !L.armed) return;
      const { rects, gaps } = buildEntries(editor);
      const srcIdx = rects.findIndex((r) => r.from === L!.from);
      if (srcIdx < 0) { cleanup(); return; }
      L.armed = false; L.lifted = true;
      L.entries = rects; L.gaps = gaps; L.srcIdx = srcIdx;
      L.rows = buildRows(root, rects);
      L.srcH = Math.max(24, gaps[srcIdx + 1] - gaps[srcIdx]); // top-to-top = the whole row
      L.shift = rects.map(() => 0);
      L.hot?.classList.remove("lx-drag-hot"); L.hot = null;
      onLiftRef.current?.(); // real native haptic pop
      const srcEl = rects[srcIdx].el;
      // Preview-pill sign: grip + a truncated peek of the block's text. The peek is
      // tagged with the block's own direction — an Arabic snippet in an LTR box
      // comes out scrambled by bidi, and quote marks around it make it worse.
      const raw = (srcEl.textContent || "").replace(/\s+/g, " ").trim();
      const pill = document.createElement("div");
      pill.className = "lx-drag-pill";
      const g = document.createElement("span"); g.className = "lx-drag-pill-grip"; g.textContent = "⠿";
      const s = document.createElement("span"); s.className = "lx-drag-pill-txt";
      s.textContent = raw ? raw.slice(0, 30) + (raw.length > 30 ? "…" : "") : "¶";
      s.setAttribute("dir", rects[srcIdx].rtl ? "rtl" : "ltr");
      pill.appendChild(g); pill.appendChild(s);
      document.body.appendChild(pill);
      // The slot rule spans the text column, inset — not the full bleed of the root.
      const line = document.createElement("div");
      line.className = "lx-drop-slot";
      const rootR = root.getBoundingClientRect();
      line.style.left = (rootR.left + 14) + "px";
      line.style.width = Math.max(40, rootR.width - 28) + "px";
      document.body.appendChild(line);
      L.pill = pill; L.line = line;
      // Hide the source row: its neighbours close over it, so there is no hole to
      // explain — and nothing of it is left behind for them to slide across.
      for (const el of L.rows[srcIdx]) el.classList.add("lx-reorder-lifted");
      movePill(L.lastY, L.lastX);
      track(L.lastY);
    };

    // The moving sign floats just above the finger (the finger would cover it otherwise).
    const movePill = (y: number, x: number) => {
      if (!L?.pill) return;
      const r = L.pill.getBoundingClientRect();
      L.pill.style.left = Math.max(6, Math.min(window.innerWidth - r.width - 6, x - r.width / 2)) + "px";
      L.pill.style.top = (y - r.height - 22) + "px";
    };

    const track = (y: number) => {
      if (!L) return;
      applyPreview(gapFor(y, L.gaps));
      positionLine();
    };

    // The slot preview: every block between the source and the target gap slides by
    // exactly one source-height, so the page shows the post-drop order. The old
    // model nudged only the single block after the gap, which slid it straight on
    // top of the next one — the overlapping text that made this look broken.
    const applyPreview = (gapIdx: number) => {
      if (!L || gapIdx === L.gapIdx) return;
      L.gapIdx = gapIdx;
      for (let i = 0; i < L.entries.length; i++) {
        let d = 0;
        if (i !== L.srcIdx) {
          if (i > L.srcIdx && i < gapIdx) d = -L.srcH;      // closes the hole above
          else if (i >= gapIdx && i < L.srcIdx) d = L.srcH;  // opens the slot below
        }
        if (d === L.shift[i]) continue;
        L.shift[i] = d;
        for (const el of L.rows[i]) {
          el.classList.add("lx-reorder-shift");
          el.style.transform = d ? `translateY(${d}px)` : "";
        }
      }
    };

    // Middle of the slot the preview just opened. Dropping back onto the source's
    // own gap opens nothing, and this lands on the source's old centre — which is
    // exactly the "nothing moves" the drop will commit.
    const slotCenter = () => {
      if (!L) return 0;
      const g = L.gaps[Math.min(Math.max(L.gapIdx, 0), L.gaps.length - 1)];
      return L.gapIdx > L.srcIdx ? g - L.srcH / 2 : g + L.srcH / 2;
    };

    const positionLine = () => {
      if (L?.line) L.line.style.top = Math.round(slotCenter()) + "px";
    };

    const autoScroll = () => {
      if (!L?.lifted) return;
      const vh = window.innerHeight;
      let dv = 0;
      if (L.lastY < EDGE_PX) dv = -EDGE_SPEED * (1 - L.lastY / EDGE_PX);
      else if (L.lastY > vh - EDGE_PX) dv = EDGE_SPEED * (1 - (vh - L.lastY) / EDGE_PX);
      if (dv !== 0) {
        // Shift the cached geometry by what the scroller ACTUALLY moved rather than
        // re-measuring: the preview transforms may be mid-transition, so a fresh
        // getBoundingClientRect would fold them into the cache and drift the slots.
        const before = scroller.scrollTop;
        scroller.scrollTop = before + dv;
        const moved = scroller.scrollTop - before;
        if (moved) {
          for (const en of L.entries) { en.top -= moved; en.bottom -= moved; }
          for (let i = 0; i < L.gaps.length; i++) L.gaps[i] -= moved;
          track(L.lastY);
        }
      }
      L.raf = requestAnimationFrame(autoScroll);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!L) return;
      if (e.touches.length !== 1) { cleanup(); return; }
      const t = e.touches[0];
      L.lastX = t.clientX; L.lastY = t.clientY;
      e.preventDefault(); // armed from the gutter → we own this gesture
      if (L.armed && !L.lifted) {
        if (Math.hypot(t.clientX - L.start.x, t.clientY - L.start.y) > LIFT_MOVE_PX) lift();
        if (!L.lifted) return;
      }
      if (!L.lifted) return;
      movePill(t.clientY, t.clientX);
      track(t.clientY);
      if (L.raf == null) L.raf = requestAnimationFrame(autoScroll);
    };

    const onTouchEnd = () => {
      if (!L || !L.lifted) { cleanup(); return; }
      const gapIdx = L.gapIdx < 0 ? gapFor(L.lastY, L.gaps) : L.gapIdx; // commit what's on screen
      const from = L.from;
      const to = singleMoveTo(from, gapToBlock(gapIdx, L.entries));
      if (L.timer) clearTimeout(L.timer);
      if (L.raf) cancelAnimationFrame(L.raf);
      L.line?.remove();
      L.hot?.classList.remove("lx-drag-hot");
      const pill = L.pill;
      const centre = slotCenter();
      const els = L.rows.flat();
      L = null;
      // The sign sinks into the slot it opened instead of morphing into a block —
      // the real block arrives there a beat later, so the pill only has to point.
      if (pill) {
        const r = pill.getBoundingClientRect();
        pill.classList.add("lx-drag-pill-drop");
        pill.style.top = (centre - r.height / 2) + "px";
        pill.style.transform = "scale(.92)";
        pill.style.opacity = "0";
        setTimeout(() => pill.remove(), 240);
      }
      if (to === from) { stripEls(els); return; }
      onReorderRef.current?.(from, to);
      // HOLD the preview until the real move lands (native → store → reseed). Undoing
      // it here would flash the old order back for the length of that round-trip.
      let un: (() => void) | null = null;
      let cleared = false;
      const settle = () => {
        if (cleared) return;
        cleared = true;
        clearTimeout(tm);
        un?.();
        if (landPreview === settle) landPreview = null;
        stripEls(els);
      };
      const tm = setTimeout(settle, SETTLE_MS);
      // Only a CONTENT update ends the hold early — a selection-only one (the touch
      // itself can produce one) would drop the preview a frame after the release.
      un = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size || dirtyLeaves.size) settle();
      });
      landPreview = settle;
    };

    root.addEventListener("touchstart", onTouchStart, { passive: false });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", cleanup, { passive: true });
    return () => {
      landPreview?.();
      cleanup();
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", cleanup);
    };
  }, [editor, active]);

  return null;
}
