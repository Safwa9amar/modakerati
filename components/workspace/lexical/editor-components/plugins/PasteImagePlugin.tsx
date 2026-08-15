// An OS paste carrying an image → native inserts the figure.

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from "lexical";
import { $blockIndexOfNode } from "../block-index";

/**
 * The OS paste — long-press → Paste, or ⌘V — when what's on the clipboard is an
 * IMAGE. Left alone the picture silently vanishes: Lexical's rich-text paste only
 * understands text/html and text/plain, and this editor has no image node to drop
 * one into anyway. So intercept the paste, swallow it, and report WHERE the caret
 * is; native re-reads that same system clipboard through expo-clipboard and runs the
 * durable insertImage op, exactly like the Insert menu's "Paste image" tile. The
 * bytes never cross the DOM bridge — only the block index does.
 *
 * The "is this an image?" test is deliberately generous. WebKit routinely exposes
 * NOTHING to clipboardData for a pasted image (no items, no files, no types), so an
 * empty payload counts as a maybe and native asks the real pasteboard. Anything
 * carrying text is left to Lexical untouched, which keeps ordinary text paste — the
 * common case — on its normal path.
 */
export function PasteImagePlugin({ onPasteImage, suppressed }: { onPasteImage?: (index: number) => void; suppressed: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!onPasteImage || suppressed) return;
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const cd = event && "clipboardData" in event ? (event as ClipboardEvent).clipboardData : null;
        if (!cd) return false;
        const types = Array.from(cd.types ?? []);
        const hasImage =
          types.some((t) => t.startsWith("image/")) ||
          Array.from(cd.files ?? []).some((f) => f.type.startsWith("image/"));
        // WebKit often hands a pasted picture over as text/html wrapping a single
        // <img> (blob: or data: src) rather than as a file — HTML whose text content
        // is empty is that case, not a text paste.
        const html = types.includes("text/html") ? cd.getData("text/html") : "";
        const htmlIsOnlyImage = /<img[\s/>]/i.test(html) && !html.replace(/<[^>]*>/g, "").trim();
        const plain = types.includes("text/plain") ? cd.getData("text/plain") : "";
        const hasText = !!plain.trim() || (!!html && !htmlIsOnlyImage);
        if (!hasImage && !htmlIsOnlyImage && hasText) return false; // real text paste — Lexical's job
        // Command handlers run inside an editor update, so the selection reads directly.
        const sel = $getSelection();
        const index = $isRangeSelection(sel) ? $blockIndexOfNode(sel.anchor.getNode()) : -1;
        if (index < 0) return false; // no caret to anchor the figure to — let it through
        event.preventDefault();
        onPasteImage(index);
        return true;
      },
      COMMAND_PRIORITY_HIGH, // beat @lexical/rich-text, which registers PASTE at EDITOR
    );
  }, [editor, onPasteImage, suppressed]);
  return null;
}
