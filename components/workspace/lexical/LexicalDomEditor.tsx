'use dom';

// Lexical rich-text editor rendered as an Expo DOM component ('use dom' →
// @expo/dom-webview). This is a SPIKE: an isolated proof that our NATIVE bubble
// can drive a web rich-text editor while keeping RTL + rich formatting for free.
//
// Data flow (per the Expo DOM-components contract — serializable props only):
//   • native → web:  `command` (a serializable {type,value,nonce} object). The
//     nonce forces a re-apply even when the same command repeats.
//   • web → native:  `onState` (a top-level async function prop) reports the
//     active formats so the native bubble can highlight B/I/U/heading/direction.
// Nothing here is wired to the thesis doc/op-queue yet — it's a feasibility test.

import * as React from "react";
import { useEffect, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  ListNode,
  ListItemNode,
  $isListNode,
  $isListItemNode,
  $insertList,
} from "@lexical/list";
import {
  $getRoot,
  $addUpdateTag,
  SKIP_DOM_SELECTION_TAG,
  type LexicalNode,
} from "lexical";
import {
  $blocksToLexical,
  BlockDataNode,
  ChromeNode,
  PageBreakNode,
  $createPageBreakNode,
  $isPageBreakNode,
  type PageBreakData,
  // The ONE predicate that owns "this node exists only to be looked at" —
  // chrome bands AND page boundaries. Every block-INDEX walk skips it; only a
  // genuine "is this specifically a chrome band?" identity test uses
  // $isChromeNode. Getting that backwards puts every index past the node off
  // by N, which is exactly how c28d406 and 6eae8ee both shipped.
  $isDisplayOnlyNode,
  MediaContext,
  AnchorGeometryContext,
  EditCellContext,
  TableProposalContext,
  TABLE_AI_LABELS_EN,
  WorkingLabelsContext,
  WORKING_LABELS_EN,
  SuggestionNode,
  RangeSuggestionNode,
  GhostCompletionNode,
  EquationNode,
  $blockEntries,
  countListItems,
  type BlockEntry,
} from "./blockLexical";
import { singleMoveTo } from "@/lib/reorder-range";
// Pure geometry/pagination/numbering — no React, no RN, no DOM, so it is the one
// piece of this feature verifiable off-device (scripts/verify-page-layout.mjs).
import {
  paginate,
  numberPages,
  sectionForBlock,
  chromeDrawingFractions,
  duotoneStops,
  type AnchorSectionGeometry,
} from "@/lib/page-layout";
// type-only — WorkspaceLexicalView is the native ('use dom' host) module; importing
// just the type is erased at compile time, same contract as ChromeData above.
import type { PageSetup } from "../WorkspaceLexicalView";
// ── ./editor-components ──────────────────────────────────────────────────────
// This module carries the 'use dom' directive, so babel-preset-expo allows it
// exactly ONE export and it must be the default. Every contract, helper, plugin
// and stylesheet therefore lives beside it in editor-components/ (plain web-bundle
// modules, free to export as they like). Gate: node scripts/verify-use-dom.mjs.
import {
  $anyNodeAtBlockIndex,
} from "./editor-components/block-index";
import { withScrollPinned } from "./editor-components/lexical-updates";
import { measureBlockHeights, measureCacheClear } from "./editor-components/measure";
import { CompletionPlugin } from "./editor-components/plugins/CompletionPlugin";
import { DrawerSwipePlugin } from "./editor-components/plugins/DrawerSwipePlugin";
import { EditorBridge } from "./editor-components/plugins/editor-bridge/EditorBridge";
import { EquationTapPlugin } from "./editor-components/plugins/EquationTapPlugin";
import { KeyboardModePlugin } from "./editor-components/plugins/KeyboardModePlugin";
import { PasteImagePlugin } from "./editor-components/plugins/PasteImagePlugin";
import { RangeSuggestionPlugin } from "./editor-components/plugins/RangeSuggestionPlugin";
import { ScrollSyncPlugin } from "./editor-components/plugins/ScrollSyncPlugin";
import { SearchHighlightPlugin } from "./editor-components/plugins/SearchHighlightPlugin";
import { SelectPlugin } from "./editor-components/plugins/SelectPlugin";
import { SelectionHighlightPlugin } from "./editor-components/plugins/SelectionHighlightPlugin";
import { SlashPlugin } from "./editor-components/plugins/SlashPlugin";
import { SuggestionPlugin } from "./editor-components/plugins/SuggestionPlugin";
import { seed } from "./editor-components/seed";
import { CSS } from "./editor-components/styles";
import { theme } from "./editor-components/theme";
import type { LexicalDomEditorProps } from "./editor-components/props";


// One-finger gutter-handle drag-to-reorder, gated by reorder MODE (`active`). When
// the mode is on a gutter with a grip (⠿) appears beside each draggable block; a
// one-finger press in that gutter arms a lift (tiny hold OR small move). The block
// then HIDES and the page previews the post-drop order live — every block between
// it and the target gap slides by one block-height, opening a real slot the finger
// drags around — while a pill of its text follows the finger. On release the move
// commits via `onReorder(from, to)` and the preview is held until the reseed paints
// the real order. Geometry is READ via $blockEntries + getElementByKey and the
// preview is transform-only (no reflow → the rects cached at lift stay valid); the
// pill and slot rule are the plugin's own elements on document.body, so the
// Lexical document is never mutated here. It is fully
// inert while the mode is off (`!active`), while `suppressed` (an AI proposal is
// open), or when its callbacks are undefined.
const GUTTER_PX = 42;     // width of the drag-handle gutter (hit zone) — matches the CSS padding
const LIFT_HOLD_MS = 150; // tiny hold on the handle before the block lifts…
const LIFT_MOVE_PX = 6;   // …or this much finger movement, whichever comes first
const EDGE_PX = 44;       // auto-scroll band at top/bottom
const EDGE_SPEED = 12;    // px per frame at the very edge
const SETTLE_MS = 420;    // how long the drop preview is held while the real move round-trips

function ReorderPlugin({
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

    type Ent = { from: number; count: number; top: number; bottom: number; left: number; right: number; rtl: boolean; key: string; el: HTMLElement };
    type Live = {
      start: { x: number; y: number };
      timer: ReturnType<typeof setTimeout> | null;
      armed: boolean;
      lifted: boolean;
      from: number;
      srcIdx: number;      // index of the dragged unit in `entries`
      srcH: number;        // its full row height incl. the margin below it = the slot size
      entries: Ent[];
      rows: HTMLElement[][]; // per entry: its element + any chrome band trailing it
      gaps: number[];
      shift: number[];     // px currently applied to each row (the slot preview)
      gapIdx: number;      // gap the preview is currently opened at (-1 = none)
      pill: HTMLElement | null;
      line: HTMLElement | null;
      hot: HTMLElement | null;
      raf: number | null;
      lastX: number;
      lastY: number;
    };
    let L: Live | null = null;
    // A drop holds its preview for a beat (see onTouchEnd). Anything that needs
    // honest geometry — the next drag, teardown — must land it FIRST: transforms
    // are baked into getBoundingClientRect, so measuring over a held preview would
    // read every block a slot out of place.
    let landPreview: (() => void) | null = null;

    // Undo the slot preview. Transitions are killed for the reset frame so the
    // blocks don't animate back home — on a drop the reseed is about to paint the
    // real order, and an eased snap-back reads as the move being rejected.
    const stripEls = (els: HTMLElement[]) => {
      const touched = els.filter((el) => el.classList.contains("lx-reorder-shift"));
      for (const el of touched) {
        el.style.transition = "none";
        el.style.transform = "";
        el.classList.remove("lx-reorder-shift");
      }
      for (const el of els) el.classList.remove("lx-reorder-lifted");
      if (touched.length) requestAnimationFrame(() => { for (const el of touched) el.style.transition = ""; });
    };

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

    const buildEntries = () => {
      let entries: BlockEntry[] = [];
      editor.getEditorState().read(() => { entries = $blockEntries(); });
      const rects = entries
        .map((e) => {
          const el = editor.getElementByKey(e.key) as HTMLElement | null;
          const r = el?.getBoundingClientRect();
          if (!el || !r) return null;
          const rtl = getComputedStyle(el).direction === "rtl";
          return { from: e.from, count: e.count, top: r.top, bottom: r.bottom, left: r.left, right: r.right, rtl, key: e.key, el };
        })
        .filter(Boolean) as Ent[];
      const gaps = rects.map((r) => r.top);
      if (rects.length) gaps.push(rects[rects.length - 1].bottom);
      return { rects, gaps };
    };

    // Chrome bands (section breaks, header/footer strips) are NOT block entries, so
    // a preview that moved only entry elements would slide text straight across
    // them. Group each band with the block it trails: rows then tile the page with
    // no gaps, every row height is exactly top-to-top, and the preview shifts whole
    // rows — nothing can overlap. Children above the first block never move (gap 0
    // means "below the page header", which is where they already are).
    const buildRows = (rects: Ent[]) => {
      const rows: HTMLElement[][] = rects.map(() => []);
      const idxOf = new Map<HTMLElement, number>();
      rects.forEach((r, i) => idxOf.set(r.el, i));
      let cur = -1;
      for (const child of Array.from(root.children) as HTMLElement[]) {
        const own = idxOf.get(child);
        if (own !== undefined) cur = own;
        if (cur >= 0) rows[cur].push(child);
      }
      return rows;
    };

    const unitAt = (y: number, rects: Live["entries"]) =>
      rects.find((r) => y >= r.top && y <= r.bottom) ?? null;

    const gapFor = (y: number, gaps: number[]) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < gaps.length; i++) { const d = Math.abs(gaps[i] - y); if (d < bestD) { bestD = d; best = i; } }
      return best; // 0..entries.length  → block gap index
    };

    const gapToBlock = (gapIdx: number, rects: Live["entries"]) =>
      gapIdx >= rects.length ? (rects.length ? rects[rects.length - 1].from + rects[rects.length - 1].count : 0) : rects[gapIdx].from;

    const onTouchStart = (e: TouchEvent) => {
      if (!activeRef.current || suppressedRef.current || e.touches.length !== 1) { cleanup(); return; }
      landPreview?.(); // a drop still holding its preview → settle it before measuring
      const t = e.touches[0];
      const { rects } = buildEntries();
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
      const { rects, gaps } = buildEntries();
      const srcIdx = rects.findIndex((r) => r.from === L!.from);
      if (srcIdx < 0) { cleanup(); return; }
      L.armed = false; L.lifted = true;
      L.entries = rects; L.gaps = gaps; L.srcIdx = srcIdx;
      L.rows = buildRows(rects);
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

// Marks the plugin's OWN writes below. Removing and re-inserting boundary nodes
// is a dirty update like any other, so without a tag to recognise it by, the
// plugin's update listener would re-trigger the plugin — forever, every 400ms,
// for as long as the document stayed open. That is not merely wasted work: the
// native side resets its 1500ms serialize timer on every editor report, so a
// self-feeding loop would hold that timer permanently reset and the student's
// writing would never be saved.
const PAGES_TAG = "page-view";

/**
 * Insert one PageBreakNode per measured page boundary.
 *
 * Runs on idle, never per keystroke: measurement touches layout, and the
 * Writer's rule is that nothing updates per input event (see createStreamPump's
 * 90ms batching for the same discipline applied to streaming).
 */
function PaginationPlugin({ setup }: { setup?: PageSetup | null }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Strip every band. Used when there is nothing to paginate — turning the page
    // view off must take the paper away, not freeze the last layout on screen.
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
    const pinned = (mutator: () => void) => {
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
    };

    const dropAll = () => {
      let any = false;
      editor.getEditorState().read(() => {
        any = $getRoot().getChildren().some((n) => $isPageBreakNode(n));
      });
      if (!any) return;
      pinned(() => {
        $getRoot().getChildren().forEach((n) => { if ($isPageBreakNode(n)) n.remove(); });
      });
    };

    if (!setup || setup.sections.length === 0) { dropAll(); return; }
    const sections = setup.sections;

    // Font readiness: a measurement taken before Liberation Serif finishes
    // loading measured the fallback serif's metrics instead — poisoned, and
    // cached under the same keys real measurements will later hit. Clear
    // BOTH caches (block heights and the single-line probe — a probe taken
    // in the fallback is exactly as poisoned as a block measurement) and
    // re-run once the real font is in.
    if (typeof document !== "undefined" && "fonts" in document) {
      (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {
        if (cancelled) return;
        measureCacheClear();
        schedule();
      });
    }

    const repaginate = () => {
      if (cancelled) return;

      // 1 ─ Collect the block-bearing DOM rows, in order, skipping display-only
      //     nodes. Their positions ARE block indices — the same contract
      //     $anyNodeAtBlockIndex relies on. The bands already in the tree are
      //     recorded in the same walk, each keyed by the block index it sits
      //     before, so an unchanged layout can skip the write entirely.
      const rows: HTMLElement[] = [];
      // Block index at which each root child's rows begin. A band can only be
      // inserted BETWEEN root children, so these are the only positions a page
      // may legally start at (see the snap below).
      const childStart: number[] = [];
      const current: string[] = [];
      let desynced = false;
      editor.getEditorState().read(() => {
        const root = $getRoot();
        // A LIST is one root child but MANY block indices — one per leaf item, in
        // the depth-first order pushListItems flattens them. Measuring the list as
        // a single row would both attribute its whole height to one index and
        // shift every index after it, which is how a section's forced page break
        // stops matching and a page inherits the wrong header's chrome.
        const pushLeafRows = (node: LexicalNode): boolean => {
          if ($isListNode(node)) {
            for (const item of node.getChildren()) {
              if (!$isListItemNode(item)) continue;
              const nested = item.getChildren().find($isListNode);
              if (nested) { if (!pushLeafRows(nested as LexicalNode)) return false; continue; }
              const li = editor.getElementByKey(item.getKey());
              if (!li) return false;
              rows.push(li);
            }
            return true;
          }
          const el = editor.getElementByKey(node.getKey());
          if (!el) return false;
          rows.push(el);
          return true;
        };
        root.getChildren().forEach((node) => {
          if ($isPageBreakNode(node)) { current.push(`${rows.length}|${JSON.stringify(node.getData())}`); return; }
          if ($isDisplayOnlyNode(node)) return;
          const start = rows.length;
          // A block with no element yet would shift every index after it. Rather
          // than measure the wrong paragraph, abandon this pass — the next edit
          // (or the next scheduled run) will find the DOM settled.
          if (!pushLeafRows(node)) { desynced = true; return; }
          if (rows.length > start) childStart.push(start);
        });
      });
      if (desynced || rows.length === 0) return;

      // 2 ─ Measure at true geometry and paginate.
      // One column width for the whole document: a thesis mixing page sizes
      // mid-document is vanishingly rare, and a per-section width would mean
      // re-laying out the measuring host per block. Page HEIGHT is per-section
      // below, which is the one that actually varies (landscape appendices).
      const columnPx = sections[0].textColumnPx;
      // Typography per block index, from the server's resolution of the OOXML
      // cascade. A block without it (table, image, or a cache predating the
      // field) falls back to the editor's own metrics inside measureBlockHeights.
      const blockFmts = setup.blockFmts ?? [];
      const results = measureBlockHeights(rows, columnPx, setup.rtl, blockFmts);
      const heights = results.map((r) => r.h);
      const spaceBefore = results.map((r) => r.before);
      const pageContentPx = rows.map((_, i) => sections[sectionForBlock(sections, i)].contentHeightPx);
      const forcedStarts = new Set(
        sections.filter((s) => s.startsOnNewPage && s.startBlockIndex > 0).map((s) => s.startBlockIndex),
      );
      // `remainder` is deliberately unused until Task 8 renders the spacer.
      const raw = paginate({
        heights,
        spaceBefore,
        pageContentPx,
        forcedStarts,
        // A heading is never left at the bottom of a page — Word's built-in
        // heading styles all carry keep-with-next.
        keepWithNext: new Set(setup.keepWithNext ?? []),
        // Only a paragraph splits across pages in Word; a table, an image or a
        // text box moves whole. Having typography IS being a paragraph.
        splittable: rows.map((_, i) => blockFmts[i] != null),
      });

      // A page may only START where a root child does. Pagination works in block
      // space, where a list is many indices, so a break can land BETWEEN two list
      // items — and a band inserted there would sit inside the <ul>, malforming
      // it (the same structural rule that makes RangeSuggestionPlugin decline a
      // list range). Snap such a boundary back to the list's first block: the
      // list travels whole to the next page, which is also what Word does when
      // its items are kept together.
      const snapToChild = (b: number) => {
        let s = 0;
        for (const c of childStart) { if (c <= b) s = c; else break; }
        return s;
      };
      const starts: number[] = [];
      const physPage: number[] = [];
      // `raw.remainder` is parallel to `raw.starts` — entry k is the unused space
      // at the foot of the page STARTING at starts[k]. It has to be carried
      // through the snap in lockstep or a page inherits another page's whitespace.
      const remainder: number[] = [];
      for (let k = 0; k < raw.starts.length; k++) {
        const s = k === 0 ? 0 : snapToChild(raw.starts[k]);
        // Snapping can collapse a boundary onto the page before it — that page
        // simply absorbs the list rather than splitting it. The merged page now
        // ends where THIS one ended, so it takes this page's remainder; it still
        // begins where the earlier one did, so its physical index is unchanged.
        if (k > 0 && s <= starts[starts.length - 1]) {
          remainder[remainder.length - 1] = raw.remainder[k] ?? 0;
          continue;
        }
        starts.push(s);
        physPage.push(raw.physPage[k]);
        remainder.push(raw.remainder[k] ?? 0);
      }
      // Measurement px → display px. The bands render in the editor's narrower
      // column, so the room left on a page has to shrink by the same ratio the
      // text did. Capped: a nearly-empty page would otherwise scroll for a screen
      // and a half of blank paper, which reads as a bug rather than as Word.
      const renderedColumnPx = editor.getRootElement()?.clientWidth ?? columnPx;
      const displayScale = columnPx > 0 ? renderedColumnPx / columnPx : 1;
      const remainderDisplay = (k: number) =>
        Math.min(240, Math.round(((remainder[k] ?? 0) * displayScale) / 4) * 4);
      // A page whose picture Word centres ON THE PAGE (set_image_layout with
      // vertical:"center") does not lay that picture out in the flow at all, so
      // the flow's own answer — hard against the top, all the leftover room
      // below — is the one thing it certainly is not. Split that room in two and
      // put half of it above: the SAME total blank the page already showed, just
      // distributed the way Word distributes it. The 240px cap above is left
      // exactly as it is; halving a capped remainder still reads as centred, and
      // uncapping it here would bring back the screen and a half of blank paper
      // that cap exists to prevent.
      const pageCentered = new Set(setup.pageCentered ?? []);
      const centredPage = (k: number) => {
        if (pageCentered.size === 0) return false;
        const end = k + 1 < starts.length ? starts[k + 1] : rows.length;
        for (let b = starts[k]; b < end; b++) if (pageCentered.has(b)) return true;
        return false;
      };
      const leadDisplay = (k: number) => (centredPage(k) ? Math.round(remainderDisplay(k) / 2 / 4) * 4 : 0);
      const tailDisplay = (k: number) => remainderDisplay(k) - leadDisplay(k);
      const numbering = numberPages(starts, physPage, sections);
      if (cancelled || numbering.length === 0) return;

      // 3 ─ Build the node data.
      //     An unnumbered page shows NOTHING on the paper — that is the whole
      //     point of a divider — so its footer is dropped even when the section
      //     has one, and the gutter NAMES it rather than numbering it.
      const footerFor = (page: (typeof numbering)[number]) => {
        const sec = sections[page.sectionIndex];
        if (!sec?.footer || page.unnumbered) return null;
        return {
          text: sec.footer.text,
          pageText: sec.footer.hasPageNumbers ? page.text : null,
          sectionIndex: page.sectionIndex,
          startBlockIndex: sec.startBlockIndex,
        };
      };
      const headerFor = (page: (typeof numbering)[number]) => {
        const sec = sections[page.sectionIndex];
        if (!sec?.header) return null;
        return {
          text: sec.header.text,
          segments: sec.header.segments,
          border: sec.header.border,
          sectionIndex: page.sectionIndex,
          startBlockIndex: sec.startBlockIndex,
        };
      };
      // Artwork behind the page BEGINNING after this band, as fractions of the
      // sheet. Deliberately NOT resolved to px here: the band knows its own
      // width and its page's measured height, and those are what Word's ratios
      // have to be re-scaled against.
      const artworkFor = (page: (typeof numbering)[number]) => {
        const sec = sections[page.sectionIndex];
        const drawings = sec?.headerDrawings ?? [];
        if (!drawings.length || !sec?.chromeGeo) return undefined;
        const geo = sec.chromeGeo;
        const pageAspect = geo.pageWidthPx > 0 ? geo.pageHeightPx / geo.pageWidthPx : 1.414;
        return drawings.map((d) => ({
          dataUri: d.dataUri!, // buildPageSetup keeps only drawings that have one
          ...chromeDrawingFractions(d, geo),
          pageAspect,
          duotone: duotoneStops(d.duotone),
          alt: d.descr ?? "",
        }));
      };
      const gutterFor = (page: (typeof numbering)[number]) => {
        if (!page.unnumbered) return setup.gutterNumberTemplate.replace("{{n}}", page.text ?? "");
        return sections[page.sectionIndex]?.unnumberedKind === "divider"
          ? setup.gutterDividerLabel
          : setup.gutterOrnamentLabel;
      };
      // Where a gutter tap goes. Nothing to offer on a page that is unnumbered
      // by design — there is no page number to ask for.
      const gutterTargetFor = (page: (typeof numbering)[number]) => {
        if (page.unnumbered) return null;
        const sec = sections[page.sectionIndex];
        if (!sec) return null;
        return { sectionIndex: page.sectionIndex, startBlockIndex: sec.startBlockIndex, text: sec.footer?.text ?? "" };
      };

      // Boundaries sit immediately BEFORE the first block of each page after
      // the first.
      const boundaries = new Map<number, PageBreakData>();
      for (let p = 1; p < starts.length; p++) {
        boundaries.set(starts[p], {
          variant: "boundary",
          endingPage: numbering[p - 1].number ?? 0,
          footer: footerFor(numbering[p - 1]),
          header: headerFor(numbering[p]),
          gutterLabel: gutterFor(numbering[p]),
          gutterTarget: gutterTargetFor(numbering[p - 1]),
          remainderPx: tailDisplay(p - 1),
          leadPx: leadDisplay(p),
          rtl: setup.rtl,
          artwork: artworkFor(numbering[p]),
        });
      }
      // The edge nodes: a boundary separates two pages, so without these the
      // FIRST page would have no header and the LAST no footer.
      const first = numbering[0];
      const last = numbering[numbering.length - 1];
      const firstHeader = headerFor(first);
      const firstArtwork = artworkFor(first);
      const lastFooter = footerFor(last);
      // The cover page's frame reaches the paper only through this leading band —
      // there is no boundary above page 1 to carry it.
      // …and the leading band is also the only place page ONE's top padding can
      // go, so a first page that centres a picture needs one even with no header.
      const firstLead = leadDisplay(0);
      const leading: PageBreakData | null = firstHeader || firstLead > 0
        ? { variant: "leading", endingPage: 0, footer: null, header: firstHeader,
            gutterLabel: "", gutterTarget: null, remainderPx: 0, leadPx: firstLead, rtl: setup.rtl,
            artwork: firstArtwork }
        : null;
      const trailing: PageBreakData | null = lastFooter
        ? { variant: "trailing", endingPage: last.number ?? 0, footer: lastFooter, header: null,
            gutterLabel: "", gutterTarget: null, remainderPx: tailDisplay(numbering.length - 1), leadPx: 0, rtl: setup.rtl }
        : null;

      // 4 ─ Apply, but only if anything actually moved. Re-creating identical
      //     nodes would remount every band (a visible flicker) and dirty the
      //     editor for nothing.
      const next: string[] = [];
      if (leading) next.push(`0|${JSON.stringify(leading)}`);
      for (let p = 1; p < starts.length; p++) next.push(`${starts[p]}|${JSON.stringify(boundaries.get(starts[p]))}`);
      if (trailing) next.push(`${rows.length}|${JSON.stringify(trailing)}`);
      if (next.length === current.length && next.every((s, i) => s === current[i])) return;

      pinned(() => {
        const root = $getRoot();
        // Drop the previous nodes wholesale, then re-insert. Simpler than
        // diffing, and the node carries no state worth preserving.
        root.getChildren().forEach((n) => { if ($isPageBreakNode(n)) n.remove(); });

        // Two passes rather than one: the insertions below mutate the tree, and
        // a block-index walk must not be reading a list it is changing.
        const blockNodes: LexicalNode[] = [];
        root.getChildren().forEach((n) => { if (!$isDisplayOnlyNode(n)) blockNodes.push(n); });
        if (blockNodes.length === 0) return;
        // Walk in BLOCK space, advancing by a list's item count — the same space
        // `boundaries` is keyed in. Every key is a root-child start thanks to the
        // snap above, so each lands exactly on one of these nodes.
        let blockIndex = 0;
        for (const node of blockNodes) {
          const data = boundaries.get(blockIndex);
          if (data) node.insertBefore($createPageBreakNode(data));
          blockIndex += $isListNode(node) ? countListItems(node) : 1;
        }
        if (leading) blockNodes[0].insertBefore($createPageBreakNode(leading));
        if (trailing) blockNodes[blockNodes.length - 1].insertAfter($createPageBreakNode(trailing));
      });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Pagination is a nicety; writing is not. A throw here must leave the
        // student with a plain continuous flow, never a broken editor.
        try { repaginate(); }
        catch (err) { console.warn("[pages] pagination failed, continuing unpaginated", err); }
      }, 400);
    };

    schedule();
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
      // Our own insert/remove of boundary nodes fires this too. Re-scheduling on
      // it would never converge — see PAGES_TAG above.
      if (tags.has(PAGES_TAG)) return;
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      schedule();
    });

    return () => { cancelled = true; if (timer) clearTimeout(timer); unregister(); };
  }, [editor, setup]);

  return null;
}

// Stable empty default for the anchor-geometry context: a fresh [] per render
// would change the context value every render and re-render every overlay.
// Module-private on purpose — a 'use dom' module may export ONE thing, the
// default (scripts/verify-use-dom.mjs).
const EMPTY_ANCHOR_GEOMETRY: AnchorSectionGeometry[] = [];

export default function LexicalDomEditor({
  command,
  onState,
  onBlocks,
  initialBlocks,
  chrome,
  pageSetup,
  anchorGeometry,
  reseed,
  scrollToIndex,
  scrollToChrome,
  chromePreview,
  suggestion,
  onSuggestAction,
  completionEnabled,
  completion,
  onRequestCompletion,
  onCommitCompletion,
  onCancelCompletion,
  rangeSuggestion,
  onRangeAction,
  selectedIndices,
  media,
  search,
  onEditCell,
  tableProposal,
  tableLoadingIndex,
  tableThinking,
  tableErrorIndex,
  tableLabels,
  workingLabels,
  onTableProposalAction,
  onEquationTap,
  onInsertTrigger,
  onPasteImage,
  scrollRestore,
  onScroll,
  onScrollRestored,
  onReorder,
  onLift,
  reorderActive,
  selectActive,
  selectedForCheck,
  onToggleSelect,
  keyboardActive,
  onSwipeOpenDrawer,
  appRtl,
}: LexicalDomEditorProps) {
  const initialConfig = {
    namespace: "kwill-lexical-lab",
    theme,
    onError: (error: Error) => console.error("[lexical]", error),
    // Every node class that can appear in the tree MUST be listed here: Lexical
    // throws at registration for an unregistered class and the editor then
    // renders NOTHING — a blank white screen, not a partial failure.
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, BlockDataNode, SuggestionNode, RangeSuggestionNode, GhostCompletionNode, EquationNode, ChromeNode, PageBreakNode],
    editorState: () => (initialBlocks && initialBlocks.length ? $blocksToLexical(initialBlocks, chrome) : seed()),
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <style>{CSS}</style>
      <MediaContext.Provider value={media ?? { base: "", token: "", thesisId: "", version: "" }}>
      <AnchorGeometryContext.Provider value={anchorGeometry ?? EMPTY_ANCHOR_GEOMETRY}>
      <EditCellContext.Provider value={onEditCell ?? null}>
      <WorkingLabelsContext.Provider value={{ ...WORKING_LABELS_EN, ...(workingLabels ?? {}) }}>
      <TableProposalContext.Provider
        value={{
          proposal: tableProposal ?? null,
          loadingIndex: tableLoadingIndex ?? null,
          thinking: tableThinking ?? "",
          errorIndex: tableErrorIndex ?? null,
          labels: { ...TABLE_AI_LABELS_EN, ...(tableLabels ?? {}) },
          onAction: (action, note) => onTableProposalAction?.(action, note),
        }}
      >
      <div className="lx-root">
        <RichTextPlugin
          // spellCheck off: the WebView's native spellchecker has no Arabic
          // dictionary, so it red-underlines every Arabic word. We have no native
          // replacement, so it simply goes off across all languages (issue #8).
          contentEditable={<ContentEditable className="lx-content" dir="auto" spellCheck={false} />}
          placeholder={<div className="lx-ph">اكتب هنا… · format from the bar below</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <KeyboardModePlugin active={!!keyboardActive} />
        <DrawerSwipePlugin onOpen={onSwipeOpenDrawer} rtl={!!appRtl} />
        <ListPlugin />
        {/* Checklist support: adds the click-to-toggle checkbox handling for
            list items created with $insertList("check"). */}
        <CheckListPlugin />
        <EditorBridge command={command} onState={onState} onBlocks={onBlocks} reseed={reseed} scrollToIndex={scrollToIndex} scrollToChrome={scrollToChrome} chromePreview={chromePreview} />
        <SuggestionPlugin suggestion={suggestion} onSuggestAction={onSuggestAction} />
        <EquationTapPlugin onEquationTap={onEquationTap} />
        <CompletionPlugin
          enabled={completionEnabled}
          completion={completion}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
          onRequest={onRequestCompletion}
          onCommit={onCommitCompletion}
          onCancel={onCancelCompletion}
        />
        <SlashPlugin onInsertTrigger={onInsertTrigger} suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal} />
        <PasteImagePlugin onPasteImage={onPasteImage} suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal} />
        <ReorderPlugin
          onReorder={onReorder}
          onLift={onLift}
          active={reorderActive}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
        />
        <SelectPlugin
          active={selectActive}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
          indices={selectedForCheck}
          onToggle={onToggleSelect}
        />
        <RangeSuggestionPlugin rangeSuggestion={rangeSuggestion} onRangeAction={onRangeAction} />
        <SelectionHighlightPlugin indices={selectedIndices} />
        <SearchHighlightPlugin search={search} />
        <ScrollSyncPlugin restore={scrollRestore} onScroll={onScroll} onRestored={onScrollRestored} />
        <PaginationPlugin setup={pageSetup} />
      </div>
      </TableProposalContext.Provider>
      </WorkingLabelsContext.Provider>
      </EditCellContext.Provider>
      </AnchorGeometryContext.Provider>
      </MediaContext.Provider>
    </LexicalComposer>
  );
}
