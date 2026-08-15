// Checkbox select mode — build a multi-block selection by TAPPING blocks.

import { useCallback, useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode } from "@lexical/rich-text";
import { $isListItemNode, $isListNode, type ListNode } from "@lexical/list";
import { $getRoot, $isParagraphNode } from "lexical";
import {
  $blockEntries,
  $isBlockDataNode,
  $isDisplayOnlyNode,
  $isRangeSuggestionNode,
  $isSuggestionNode,
  $lexicalToBlocks,
} from "../../blockLexical";

// ── Checkbox select mode ─────────────────────────────────────────────────────
// One tappable row per BLOCK-MODEL block: the node whose element carries the
// checkbox, the block index it maps to, and its text (the native store keeps a
// snippet alongside each selected index). The walk mirrors $lexicalToBlocks /
// $blockEntries exactly — same skips, same list-item recursion — so the indices
// these rows report are the ones the AI tools and ops act on.
type SelectRow = { key: string; index: number; text: string };

function $pushSelectListRows(list: ListNode, out: SelectRow[], start: number): number {
  let idx = start;
  for (const item of list.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const nested = item.getChildren().find($isListNode) as ListNode | undefined;
    // An item that only wraps a nested list is a container, not a block of its own.
    if (nested) { idx = $pushSelectListRows(nested, out, idx); continue; }
    out.push({ key: item.getKey(), index: idx, text: item.getTextContent() });
    idx += 1;
  }
  return idx;
}

function $selectRows(): SelectRow[] {
  const out: SelectRow[] = [];
  let idx = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // display-only band — not a block, not selectable
    if ($isSuggestionNode(child) || $isRangeSuggestionNode(child)) {
      // A proposal under review isn't selectable, but it still stands in for the
      // blocks it replaced — advance past them so later rows keep the right index.
      idx += $isRangeSuggestionNode(child) ? child.__originals.length : 1;
      continue;
    }
    if ($isListNode(child)) { idx = $pushSelectListRows(child, out, idx); continue; }
    if ($isBlockDataNode(child) || $isHeadingNode(child) || $isParagraphNode(child)) {
      out.push({ key: child.getKey(), index: idx, text: child.getTextContent() });
      idx += 1;
      continue;
    }
    // Unknown node: mirrors $lexicalToBlocks' fallback — only counts (and only
    // advances idx) when it actually carries text, so the two never drift apart.
    const text = child.getTextContent();
    if (text) {
      out.push({ key: child.getKey(), index: idx, text });
      idx += 1;
    }
  }
  return out;
}

// Checkbox block selection, gated by select MODE (`active`). While on:
//   • the editor is set read-only, so a tap can't place a caret, open the keyboard,
//     or start an OS text selection (the drag-handle selection this replaces);
//   • every selectable block gets `lx-selrow` → CSS draws a leading checkbox;
//   • a tap ANYWHERE on a block toggles it via `onToggle(index, text)` — the whole
//     row is the hit target, not just the 22px box;
//   • the checked marks are painted from `indices` (the native store's selection),
//     so the store stays the single source of truth in both directions.
// Never mutates the editor state — classes only, like SelectionHighlightPlugin.
export function SelectPlugin({
  active: modeOn,
  suppressed,
  indices,
  onToggle,
}: {
  active?: boolean;
  suppressed?: boolean;  // an AI proposal is showing → hand the editor back
  indices?: number[];
  onToggle?: (index: number, text: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const active = !!modeOn && !suppressed;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const selKey = (indices ?? []).join(",");
  // Refs, so `mark` can be stable: it must not be rebuilt on every check, or the
  // effect that owns read-only + the update listener would tear down and re-arm
  // on each tap (a setEditable flip-flop per checkbox).
  const selRef = useRef<number[]>(indices ?? []);
  selRef.current = indices ?? [];
  const activeRef = useRef(active);
  activeRef.current = active;

  const mark = useCallback(() => {
    const root = editor.getRootElement();
    if (!root || !activeRef.current) return;
    root.classList.add("lx-select-on");
    let rows: SelectRow[] = [];
    editor.getEditorState().read(() => { rows = $selectRows(); });
    const on = new Set(selRef.current);
    const stale = new Set<Element>(root.querySelectorAll(".lx-selrow"));
    // Same majority vote the reorder gutter uses to pick ONE side for the whole
    // column: only blocks that DECLARE a direction get a vote (an empty paragraph
    // just inherits the root's and would drag the column to the wrong side).
    let rtl = 0, sided = 0;
    for (const r of rows) {
      const el = editor.getElementByKey(r.key);
      if (!el) continue;
      stale.delete(el);
      el.classList.add("lx-selrow");
      el.classList.toggle("lx-selon", on.has(r.index));
      const dir = el.getAttribute("dir") || el.style.direction;
      if (dir === "rtl" || dir === "ltr") { sided++; if (dir === "rtl") rtl++; }
    }
    root.classList.toggle(
      "lx-select-rtl",
      sided ? rtl * 2 >= sided : getComputedStyle(root).direction === "rtl",
    );
    stale.forEach((el) => el.classList.remove("lx-selrow", "lx-selon"));
  }, [editor]);

  // Mode on/off: read-only + the row marks, re-applied after every reconcile (a
  // reseed rebuilds every block's DOM, dropping the classes with it).
  useEffect(() => {
    const clear = () => {
      const root = editor.getRootElement();
      root?.querySelectorAll(".lx-selrow").forEach((el) => el.classList.remove("lx-selrow", "lx-selon"));
      root?.classList.remove("lx-select-on", "lx-select-rtl");
    };
    if (!active) {
      clear();
      editor.setEditable(true);
      return;
    }
    editor.setEditable(false);
    mark();
    const off = editor.registerUpdateListener(() => mark());
    return () => {
      off();
      clear();
      editor.setEditable(true);
    };
  }, [editor, active, mark]);

  // Repaint the checked boxes when the store's selection moves (the tap round-trips
  // out to native and back — this is the "back").
  useEffect(() => {
    if (active) mark();
  }, [active, selKey, mark]);

  // Tap → toggle. Capture phase on the root so nothing downstream (the structural
  // blocks' own pick handler, the chrome bands' band-tap, the checklist's box) reacts
  // while the mode owns the surface. NOTE: deliberately no touchstart preventDefault —
  // on WebKit that also cancels the page scroll, and the finger starts on a row
  // basically everywhere. Nothing needs suppressing anyway: the editor is read-only
  // and the rows are user-select:none, so a tap can't place a caret or raise the
  // selection handles in the first place.
  useEffect(() => {
    if (!active) return;
    const root = editor.getRootElement();
    if (!root) return;
    const rowAt = (target: EventTarget | null) => {
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== root && !el.classList.contains("lx-selrow")) el = el.parentElement;
      return el && el !== root && el.classList.contains("lx-selrow") ? el : null;
    };
    const onClick = (e: MouseEvent) => {
      const el = rowAt(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      let hit: SelectRow | null = null;
      editor.getEditorState().read(() => {
        hit = $selectRows().find((r) => editor.getElementByKey(r.key) === el) ?? null;
      });
      // Cast: TS can't track the assignment made inside the read() callback above.
      const row = hit as SelectRow | null;
      if (row) onToggleRef.current?.(row.index, row.text);
    };
    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, [editor, active]);

  return null;
}
