// Insert one PageBreakNode per measured page boundary.
//
// The pass is four steps, one per neighbouring file: ./collect-rows gathers the
// block-bearing DOM rows, ./build-bands measures and paginates them into band
// data, this file compares that against what is already in the tree, and
// ./pinned-update writes the difference without moving the reader.
//
// Runs on idle, never per keystroke: measurement touches layout, and the
// student's typing must not wait on a re-flow of the whole document.

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListNode } from "@lexical/list";
import { $getRoot, type LexicalNode } from "lexical";

import {
  $createPageBreakNode,
  $isDisplayOnlyNode,
  $isPageBreakNode,
  countListItems,
} from "../../../blockLexical";
import type { PageSetup } from "../../../../WorkspaceLexicalView";
import { measureCacheClear } from "../../measure";
import { buildBands } from "./build-bands";
import { collectRows } from "./collect-rows";
import { PAGES_TAG } from "./constants";
import { dropAllBands, pinnedBandUpdate } from "./pinned-update";

export function PaginationPlugin({ setup }: { setup?: PageSetup | null }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (!setup || setup.sections.length === 0) { dropAllBands(editor); return; }

    // Font readiness: a measurement taken before Liberation Serif finishes
    // loading measured the fallback serif's metrics instead — poisoned, and
    // cached under the same keys real measurements will later hit. Clear the
    // caches (measureCacheClear takes the single-line probe with it — a probe
    // taken in the fallback is exactly as poisoned) and re-run once the real
    // font is in.
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
      //     $anyNodeAtBlockIndex relies on.
      const { rows, childStart, current, desynced } = collectRows(editor);
      if (desynced || rows.length === 0) return;

      // 2/3 ─ Measure, paginate, and build the band data.
      const bands = buildBands(editor, setup, rows, childStart, () => cancelled);
      if (!bands) return;
      const { boundaries, leading, trailing, next, starts } = bands;

      // 4 ─ Apply, but only if anything actually moved. Re-creating identical
      //     nodes would remount every band (a visible flicker) and dirty the
      //     editor for nothing.
      if (next.length === current.length && next.every((s, i) => s === current[i])) return;

      pinnedBandUpdate(editor, () => {
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
        // snap in ./build-bands, so each lands exactly on one of these nodes.
        let blockIndex = 0;
        for (const node of blockNodes) {
          const data = boundaries.get(blockIndex);
          if (data) node.insertBefore($createPageBreakNode(data));
          blockIndex += $isListNode(node) ? countListItems(node) : 1;
        }
        if (leading) blockNodes[0].insertBefore($createPageBreakNode(leading));
        if (trailing) blockNodes[blockNodes.length - 1].insertAfter($createPageBreakNode(trailing));
      });
      void starts; // kept on Bands for the spacer work; unused in the apply
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
      // ⚠️ Our own insert/remove of boundary nodes fires this too. Re-scheduling
      // on it would never converge — and a pass that re-schedules itself holds
      // the native serialize timer permanently reset, so AUTOSAVE NEVER FIRES.
      // See ./constants.
      if (tags.has(PAGES_TAG)) return;
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      schedule();
    });

    return () => { cancelled = true; if (timer) clearTimeout(timer); unregister(); };
  }, [editor, setup]);

  return null;
}
