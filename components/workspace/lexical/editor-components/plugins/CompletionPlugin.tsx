// AI inline autocomplete (ghost text).

import { useCallback, useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isHeadingNode } from "@lexical/rich-text";
import {
  $addUpdateTag,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from "lexical";
import {
  $createGhostCompletionNode,
  $isGhostCompletionNode,
  ACCEPT_COMPLETION_COMMAND,
  GhostCompletionNode,
} from "../../blockLexical";
import { $blockIndexOfNode, $nodeAtBlockIndex } from "../block-index";

// AI inline autocomplete. Detects a collapsed caret at the END of a text block,
// debounces ~600ms, and asks native for a completion (onRequestCompletion). Streams
// the returned `completion.text` into a GhostCompletionNode after the caret. Any
// real edit / caret move / blur clears the ghost (onCancelCompletion). Tapping or
// swiping the ghost dispatches ACCEPT_COMPLETION_COMMAND → merge into real text +
// onCommitCompletion. Suppressed while a suggestion / range / table proposal shows.
// Update tag marking our OWN ghost mutations so the detect listener never treats them
// as a real edit (replaces the old fragile `applyingGhost` flag).
const GHOST_TAG = "ai-ghost";
export function CompletionPlugin({
  enabled,
  completion,
  suppressed,
  onRequest,
  onCommit,
  onCancel,
}: {
  enabled?: boolean;
  completion?: { text: string; nonce: number; status: "idle" | "loading" | "done" | "error"; index?: number };
  suppressed: boolean;
  onRequest?: (ctx: { index: number; text: string }) => void;
  onCommit?: (index: number, fullText: string) => void;
  onCancel?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostKeyRef = useRef<string | null>(null); // key of the live ghost node — O(1), no tree scan
  const targetRef = useRef<{ index: number; text: string } | null>(null);

  const removeGhost = useCallback(() => {
    const key = ghostKeyRef.current;
    if (!key) return;
    editor.update(() => {
      $addUpdateTag(GHOST_TAG);
      // The ghost is OUR write, not the student's — appearing and disappearing must
      // never move the page under the line they are writing.
      $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
      const g = $getNodeByKey(key);
      if (g && $isGhostCompletionNode(g)) g.remove();
    }, { tag: "history-merge" });
    ghostKeyRef.current = null;
  }, [editor]);

  // Detect caret-at-end-of-text-block + schedule a request.
  useEffect(() => {
    const off = editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has(GHOST_TAG)) return; // our own ghost writes never self-clear
      // O(1) disabled path: with the feature off and no ghost showing, do zero work
      // on the typing hot path (the plugin is mounted unconditionally).
      if (!enabled && !ghostKeyRef.current) return;
      // Any non-ghost update clears a showing ghost (typing / caret move dismisses).
      if (ghostKeyRef.current) { removeGhost(); onCancel?.(); }
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (!enabled || suppressed || tags.has(SKIP_DOM_SELECTION_TAG)) {
        console.log(`[ac-plugin] gate blocked enabled=${enabled} suppressed=${suppressed} skipTag=${tags.has(SKIP_DOM_SELECTION_TAG)}`);
        return;
      }

      let target: { index: number; text: string } | null = null;
      let reason = "";
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) { reason = "not-collapsed-range"; return; }
        const anchor = sel.anchor.getNode();
        if (!$isTextNode(anchor)) { reason = "anchor-not-text"; return; }
        const top = anchor.getTopLevelElement();
        if (!top || !($isParagraphNode(top) || $isHeadingNode(top))) { reason = "top=" + (top ? top.getType() : "null") + " (need paragraph/heading)"; return; }
        const atNodeEnd = sel.anchor.offset === anchor.getTextContentSize();
        // "Last" ignoring a trailing ghost — so a keystroke that clears a showing
        // ghost still re-triggers a fresh completion on the same pause.
        const next = anchor.getNextSibling();
        const isLast = next == null || $isGhostCompletionNode(next);
        const text = top.getTextContent();
        if (!atNodeEnd || !isLast || text.trim().length < 2) { reason = `atEnd=${atNodeEnd} isLast=${isLast} len=${text.trim().length}`; return; }
        target = { index: $blockIndexOfNode(anchor), text };
      });
      // Cast: TS can't track the assignment made inside the read() callback above.
      const chosen = target as { index: number; text: string } | null;
      targetRef.current = chosen;
      if (!chosen) { console.log(`[ac-plugin] no target: ${reason}`); return; }
      console.log(`[ac-plugin] target index=${chosen.index} len=${chosen.text.length} — scheduling 600ms`);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (targetRef.current) { console.log(`[ac-plugin] debounce fired → onRequest index=${targetRef.current.index}`); onRequest?.(targetRef.current); }
      }, 600);
    });
    return () => { off(); if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [editor, enabled, suppressed, onRequest, onCancel, removeGhost]);

  // Render / stream the ghost from the `completion` prop.
  useEffect(() => {
    const t = targetRef.current;
    if (!enabled || suppressed || !completion || !completion.text || !t) return;
    // Index correlation: ignore a late/stale response for a block the caret already
    // left (Task 10 wiring passes completion.index; until then this is inert).
    if (completion.index != null && completion.index !== t.index) return;
    editor.update(() => {
      $addUpdateTag(GHOST_TAG);
      $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG); // streaming text is ours, not a caret move
      const node = $nodeAtBlockIndex(t.index);
      if (!node) return;
      const existingKey = ghostKeyRef.current;
      const existing = existingKey ? $getNodeByKey(existingKey) : null;
      if (existing && $isGhostCompletionNode(existing)) existing.setText(completion.text);
      else {
        const g = $createGhostCompletionNode(completion.text);
        node.append(g);
        ghostKeyRef.current = g.getKey();
      }
    }, { tag: "history-merge" });
  }, [editor, enabled, suppressed, completion?.nonce, completion?.text]);

  // Accept: merge ghost text into the block, place caret at end, commit to native.
  useEffect(() =>
    editor.registerCommand(
      ACCEPT_COMPLETION_COMMAND,
      () => {
        const t = targetRef.current;
        if (!t) return true;
        editor.update(() => {
          $addUpdateTag(GHOST_TAG);
          const node = $nodeAtBlockIndex(t.index);
          if (!node) return;
          const key = ghostKeyRef.current;
          const g = key ? $getNodeByKey(key) : null;
          if (!g || !$isGhostCompletionNode(g)) return;
          const ghostText = g.__text;
          g.remove();
          ghostKeyRef.current = null;
          // Append to the LAST real text node (v1 completes at end-of-block) so prior
          // inline runs/formatting in the block are preserved — do NOT rebuild the
          // whole block as one node (that would flatten bold/italic runs).
          const texts = node.getChildren().filter($isTextNode);
          const last = texts[texts.length - 1];
          if (last && $isTextNode(last)) { last.setTextContent(last.getTextContent() + ghostText); last.selectEnd(); }
          else { const tn = $createTextNode(ghostText); node.append(tn); tn.selectEnd(); }
          onCommit?.(t.index, node.getTextContent());
        }, { tag: SKIP_DOM_SELECTION_TAG });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),
  [editor, onCommit]);

  return null;
}
