// The Notion-style Insert menu trigger.

import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $insertList } from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  SKIP_DOM_SELECTION_TAG,
} from "lexical";
import { $blockIndexOfNode } from "../block-index";
import { INSERT_BLOCK_COMMAND } from "../commands";

// Detects a "/command" typed at the caret and reports it to native (onInsertTrigger),
// mirroring CompletionPlugin's detect-and-report bridge. Owns INSERT_BLOCK_COMMAND:
// when native picks a block, this handler deletes the /query then transforms the
// current block (text kinds) or leaves an empty line (clearSlash, for native ops).
// A slash is a command only at block start or right after whitespace, query = the
// run of non-space, non-slash chars up to the caret.
const SLASH_RE = /(?:^|\s)\/([^\s/]*)$/;
export function SlashPlugin({
  onInsertTrigger,
  suppressed,
}: {
  onInsertTrigger?: (t: { active: boolean; index: number; query: string }) => void;
  suppressed: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  // Live slash location for deletion: the text node key + the [start,end) offsets
  // of the "/query" run. `end` is captured HERE at detection time (the caret offset
  // used to build `before`) rather than re-read from the live selection when the
  // command fires — by then (e.g. after the Task 6 search input steals focus) the
  // selection may have moved to a different node, which would otherwise delete the
  // wrong range of text.
  const slashRef = useRef<{ nodeKey: string; start: number; end: number } | null>(null);

  // Detect + report.
  useEffect(() =>
    editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has(SKIP_DOM_SELECTION_TAG)) return;
      // Gate BEFORE the read transaction (mirrors CompletionPlugin) so a suppressed
      // keystroke — e.g. while a suggestion/range/table proposal is showing — does
      // zero read work. A stale tracked slash still clears/reports inactive.
      if (suppressed) {
        if (slashRef.current) {
          slashRef.current = null;
          onInsertTrigger?.({ active: false, index: -1, query: "" });
        }
        return;
      }
      let hit: { index: number; query: string; nodeKey: string; start: number; end: number } | null = null;
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
        const node = sel.anchor.getNode();
        if (!$isTextNode(node)) return;
        const top = node.getTopLevelElement();
        if (!top || !($isParagraphNode(top) || $isHeadingNode(top))) return;
        const offset = sel.anchor.offset;
        const before = node.getTextContent().slice(0, offset);
        const m = before.match(SLASH_RE);
        if (!m) return;
        const start = m.index! + (m[0].startsWith("/") ? 0 : 1); // offset of "/"
        hit = { index: $blockIndexOfNode(node), query: m[1], nodeKey: node.getKey(), start, end: offset };
      });
      const chosen = hit as { index: number; query: string; nodeKey: string; start: number; end: number } | null;
      if (chosen) {
        slashRef.current = { nodeKey: chosen.nodeKey, start: chosen.start, end: chosen.end };
        onInsertTrigger?.({ active: true, index: chosen.index, query: chosen.query });
      } else if (slashRef.current) {
        slashRef.current = null;
        onInsertTrigger?.({ active: false, index: -1, query: "" });
      }
    }),
  [editor, onInsertTrigger, suppressed]);

  // Perform the insert when native picks a block.
  useEffect(() =>
    editor.registerCommand(
      INSERT_BLOCK_COMMAND,
      (payload) => {
        editor.update(() => {
          // 1) delete the /query run from the tracked text node, using the
          // [start,end) captured at DETECTION time (not the live selection, which
          // may have moved to a different node by the time this command fires —
          // e.g. once the search input steals focus). Clamp to the node's current
          // text size in case an intervening edit shrank it.
          const loc = slashRef.current;
          if (loc) {
            const n = $getNodeByKey(loc.nodeKey);
            if (n && $isTextNode(n)) {
              const size = n.getTextContentSize();
              const start = Math.min(loc.start, size);
              const end = Math.min(loc.end, size);
              if (end > start) n.spliceText(start, end - start, "", true);
            }
          }
          slashRef.current = null;
          if (payload.kind === "clearSlash") return; // native op will do the rest

          // 2) placement: transform current block if now empty, else split & apply after
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          const top = sel.anchor.getNode().getTopLevelElement();
          const hasText = !!top && top.getTextContent().trim().length > 0;
          if (hasText && top) {
            const p = $createParagraphNode();
            top.insertAfter(p);
            p.select();
          }
          const s2 = $getSelection();
          if (!$isRangeSelection(s2)) return;
          switch (payload.kind) {
            case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
              $setBlocksType(s2, () => $createHeadingNode(payload.kind as HeadingTagType));
              break;
            case "quote":
              $setBlocksType(s2, () => $createQuoteNode());
              break;
            case "bullet":
              $insertList("bullet");
              break;
            case "number":
              $insertList("number");
              break;
          }
        });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),
  [editor]);

  return null;
}
