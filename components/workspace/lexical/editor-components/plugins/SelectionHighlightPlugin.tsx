// The persistent multi-block selection highlight.

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $anyNodeAtBlockIndex } from "../block-index";

// Paints a persistent highlight on the top-level blocks the native side reports as
// selected (a MULTI-block selection), so they stay visibly marked after the OS text
// selection is gone — the visual counterpart to the store's `selectedBlocks`. Toggles
// a CSS class on the block elements (no editor-state mutation → nothing to serialize
// or undo); re-applies after every reconcile in case Lexical rebuilds a block's DOM.
export function SelectionHighlightPlugin({ indices }: { indices?: number[] }) {
  const [editor] = useLexicalComposerContext();
  const key = (indices ?? []).join(",");
  useEffect(() => {
    const wanted = indices ?? [];
    const clear = () => {
      const root = editor.getRootElement();
      root?.querySelectorAll(".lx-selected").forEach((el) => el.classList.remove("lx-selected"));
    };
    // Nothing highlighted (the common single-block / no-selection case) → just clear
    // and register NO update listener, so plain typing does no per-keystroke DOM work.
    if (!wanted.length) {
      clear();
      return;
    }
    const apply = () => {
      // Resolve the target block KEYS from their BLOCK-MODEL indices — which is
      // what these are: $selectRows produces them (display-only bands skipped,
      // lists expanded one index per item) and the native store passes them back
      // unchanged. Indexing root children RAW instead shifts the tint onto the
      // wrong paragraphs as soon as any band sits above the selection.
      let keys: string[] = [];
      editor.getEditorState().read(() => {
        keys = wanted.map((i) => $anyNodeAtBlockIndex(i)?.getKey()).filter((k): k is string => !!k);
      });
      clear();
      keys.forEach((k) => editor.getElementByKey(k)?.classList.add("lx-selected"));
    };
    apply();
    // Re-apply after reconciles in case Lexical rebuilds a highlighted block's DOM.
    const off = editor.registerUpdateListener(() => apply());
    return () => {
      off();
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, key]);
  return null;
}
