// Document-search hit highlighting.

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $nodeAtBlockIndex } from "../block-index";
import type { SearchInput } from "../types";

// Document-search hit highlighting. Paints amber over every match + a stronger tint
// on the CURRENT match using the CSS Custom Highlight API — NON-destructive (no
// editor-state change → nothing to serialize/undo/reseed). Match spans arrive as
// {blockIndex,start,end} in the block's ORIGINAL text; we resolve each to a DOM
// Range by walking the block element's text nodes. Recomputed after every reconcile.
// If the API is unavailable (older WebView), search still SCROLLS to the match — only
// the tint is skipped.
function charPosInEl(el: Element, offset: number): [Text, number] | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (offset <= acc + len) return [node as Text, offset - acc];
    acc += len;
  }
  return null;
}

export function SearchHighlightPlugin({ search }: { search?: SearchInput }) {
  const [editor] = useLexicalComposerContext();
  const key = search ? `${search.current}|${search.matches.map((m) => `${m.blockIndex}.${m.start}.${m.end}`).join(",")}` : "";
  useEffect(() => {
    const ce = editor.getRootElement(); // .lx-content
    const host = ce?.parentElement; // .lx-root (position: relative) — NOT the editable,
    if (!ce || !host) return; //       so Lexical never reconciles our overlay away.
    let layer = host.querySelector<HTMLDivElement>(".lx-hl-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "lx-hl-layer";
      host.appendChild(layer);
    }
    const clear = () => { if (layer) layer.textContent = ""; };
    if (!search || !search.matches.length) { clear(); return; }
    // Position highlight divs over each match's DOM rects, relative to .lx-root.
    // Absolute-in-.lx-root scrolls WITH the content (document scroll), so no scroll
    // listener is needed — only re-layout after a reconcile / resize.
    const apply = () => {
      if (!layer) return;
      clear();
      const hostRect = host.getBoundingClientRect();
      editor.getEditorState().read(() => {
        search.matches.forEach((m, i) => {
          const node = $nodeAtBlockIndex(m.blockIndex);
          if (!node) return;
          const el = editor.getElementByKey(node.getKey());
          if (!el) return;
          const s = charPosInEl(el, m.start);
          const e = charPosInEl(el, m.end);
          if (!s || !e) return;
          const r = document.createRange();
          try { r.setStart(s[0], s[1]); r.setEnd(e[0], e[1]); } catch { return; }
          for (const rect of Array.from(r.getClientRects())) {
            if (rect.width === 0 || rect.height === 0) continue;
            const d = document.createElement("div");
            d.className = i === search.current ? "lx-hl lx-hl-cur" : "lx-hl";
            d.style.top = `${rect.top - hostRect.top}px`;
            d.style.left = `${rect.left - hostRect.left}px`;
            d.style.width = `${rect.width}px`;
            d.style.height = `${rect.height}px`;
            layer!.appendChild(d);
          }
        });
      });
    };
    apply();
    // NB: the listener must return VOID — Lexical treats an update-listener's return
    // value as a teardown to call later, so returning the rAF id crashed
    // ("unregister is not a function, 'unregister' is 5"). Wrap in a block.
    const off = editor.registerUpdateListener(() => { requestAnimationFrame(apply); });
    const onResize = () => { requestAnimationFrame(apply); };
    window.addEventListener("resize", onResize);
    return () => { off(); window.removeEventListener("resize", onResize); clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, key]);
  return null;
}
