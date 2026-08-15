// Bridge between the native props and the Lexical editor instance: apply an
// incoming command, and report the active formats out on every update.
//
// The two halves that carry the real work live beside it — ./apply-command
// (native → Lexical) and ./read-state (Lexical → native) — leaving this file as
// the effects: the reconcile, the two scroll-into-view requests, the header/footer
// preview, and the is-the-student-driving-this bookkeeping.

import { useCallback, useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getRoot,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_LOW,
} from "lexical";

import type { DocBlockDTO } from "@/lib/api";
import { $blocksToLexical, $isChromeNode, type ChromeData, type ChromeKind } from "../../../blockLexical";
import { $anyNodeAtBlockIndex } from "../../block-index";
import { lxQuietUpdate, withScrollPinned } from "../../lexical-updates";
import type { LexicalCommand, LexicalState } from "../../types";
import { applyLexicalCommand } from "./apply-command";
import { $readSelectionState, EMPTY_LEXICAL_STATE } from "./read-state";

// A touch/keystroke on the editor counts as the student driving it for this long,
// covering the window where the gesture is over but the focus bookkeeping (or a
// mid-gesture ActionMode) hasn't settled yet.
const DRIVING_MS = 700;
// The events that mean a finger or a key is on the editor itself. Captured, so a
// plugin that stops propagation can't hide the interaction from us.
const DRIVING_EVENTS = ["pointerdown", "touchstart", "mousedown", "keydown", "beforeinput"] as const;

export function EditorBridge({
  command,
  onState,
  onBlocks,
  reseed,
  scrollToIndex,
  scrollToChrome,
  chromePreview,
}: {
  command?: LexicalCommand | null;
  onState: (s: LexicalState) => void;
  onBlocks?: (blocks: DocBlockDTO[]) => void;
  reseed?: { blocks: DocBlockDTO[]; chrome?: ChromeData[]; nonce: number };
  scrollToIndex?: { index: number; nonce: number };
  scrollToChrome?: { kind: ChromeKind; index: number; nonce: number; offset?: number };
  chromePreview?: { kind: ChromeKind; index: number; segments: string[]; text: string; nonce: number } | null;
}) {
  const [editor] = useLexicalComposerContext();

  // In-place reconcile from the block model when an external edit (native pill /
  // AI dock / undo-redo) changed the doc — rebuilds the content on the SAME editor
  // instance (no WebView remount, no flicker) instead of re-keying the component.
  useEffect(() => {
    if (!reseed) return;
    // Clear the selection after rebuilding AND blur the editor (blurAfter): the
    // rebuild otherwise leaves the caret at the document END and the WebView
    // re-focuses + scrolls it into view (the reported "Approve jumps to the
    // bottom"). No focus, no caret → nothing to scroll to.
    withScrollPinned(editor, () => { $blocksToLexical(reseed.blocks, reseed.chrome); $setSelection(null); }, true);
    // An authoritative external apply (AI turn, server restore, table op) replaced
    // the content — undoing PAST it would silently revert that apply and sync the
    // reversion. Drop the in-editor stack; the server history ring covers those
    // steps. (In-place pill edits skip the reseed, so typing history survives them.)
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseed?.nonce]);

  // Outline-drawer navigation: scroll the block at `index` into view.
  useEffect(() => {
    if (!scrollToIndex || scrollToIndex.index < 0) return;
    let key: string | null = null;
    editor.getEditorState().read(() => {
      // Resolve ANY block kind — a table/figure is a structural node, not a
      // heading/paragraph, so $nodeAtBlockIndex would return null and never scroll.
      const n = $anyNodeAtBlockIndex(scrollToIndex.index);
      key = n ? n.getKey() : null;
    });
    if (key) editor.getElementByKey(key)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToIndex?.nonce]);

  // Reveal a running header / footer band — its editor opens as a bottom sheet that
  // covers the lower two-thirds of the screen, so the band has to come up into the
  // strip that's still visible or the student is editing something they can't see.
  // A band is identified by (kind, startBlockIndex), the same pair onState reports.
  useEffect(() => {
    if (!scrollToChrome) return;
    const findBand = () => {
      let key: string | null = null;
      editor.getEditorState().read(() => {
        for (const child of $getRoot().getChildren()) {
          if (!$isChromeNode(child)) continue;
          const d = child.getData();
          if (d.kind === scrollToChrome.kind && d.startBlockIndex === scrollToChrome.index) {
            key = child.getKey();
            break;
          }
        }
      });
      if (!key) return false;
      const el = editor.getElementByKey(key);
      if (!el) return false;
      // scrollIntoView + scrollBy, NOT scrollTo — the same pair ScrollSyncPlugin's
      // restore uses, because `window.scrollTo` is unreliable inside this WebView.
      // "start" alone parks the band hard against the top edge, half under the status
      // bar (the sheet's app-recede transform shifts everything up), so back it off by
      // the offset native computed from the strip left visible above the sheet.
      el.scrollIntoView({ block: "start" });
      if (scrollToChrome.offset) window.scrollBy(0, -scrollToChrome.offset);
      return true;
    };
    if (findBand()) return;
    // A band CREATED from the sheet ("add header") isn't in the tree until the echoed
    // document reseeds the editor — retry once that has had a chance to land.
    const timer = setTimeout(findBand, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToChrome?.nonce]);

  // LIVE PREVIEW of a header/footer template or AI proposal, rendered on the REAL band
  // so the student sees the result in the document before committing. Purely visual:
  // the band's data is swapped in place and the original is kept here to be written
  // back on clear. Chrome bands are display-only (skipped by $lexicalToBlocks), so a
  // preview can never reach a save — but it MUST be restored, or the band would keep
  // showing a template the student walked away from.
  const previewOriginal = useRef<{ key: string; data: ChromeData } | null>(null);
  useEffect(() => {
    const findKey = (kind: ChromeKind, index: number) => {
      let key: string | null = null;
      editor.getEditorState().read(() => {
        for (const child of $getRoot().getChildren()) {
          if (!$isChromeNode(child)) continue;
          const d = child.getData();
          if (d.kind === kind && d.startBlockIndex === index) { key = child.getKey(); break; }
        }
      });
      return key;
    };
    const restore = () => {
      const saved = previewOriginal.current;
      previewOriginal.current = null;
      if (!saved) return;
      lxQuietUpdate(editor, () => {
        const n = $getNodeByKey(saved.key);
        if (n && $isChromeNode(n)) n.setData(saved.data);
      });
    };
    if (!chromePreview) {
      restore();
      return;
    }
    const key = findKey(chromePreview.kind, chromePreview.index);
    if (!key) return;
    // Moved to a different band → put the previous one back before taking this one over.
    if (previewOriginal.current && previewOriginal.current.key !== key) restore();
    // Browsing header templates repaints a band the student is watching; the sheet
    // already scrolled it into view, so this must not move the page again.
    lxQuietUpdate(editor, () => {
      const n = $getNodeByKey(key);
      if (!n || !$isChromeNode(n)) return;
      const cur = n.getData();
      if (!previewOriginal.current) previewOriginal.current = { key, data: cur };
      const base = previewOriginal.current.data;
      n.setData({ ...base, text: chromePreview.text, segments: chromePreview.segments });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chromePreview?.nonce, chromePreview == null]);

  // Never leave a preview behind if the editor goes away mid-browse.
  useEffect(() => {
    return () => {
      const saved = previewOriginal.current;
      previewOriginal.current = null;
      if (!saved) return;
      lxQuietUpdate(editor, () => {
        const n = $getNodeByKey(saved.key);
        if (n && $isChromeNode(n)) n.setData(saved.data);
      });
    };
  }, [editor]);

  // Apply the latest command. Keyed on nonce so a repeated tap re-fires.
  useEffect(() => {
    if (!command) return;
    applyLexicalCommand(editor, command, onBlocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.nonce]);

  // HistoryPlugin availability, merged into every state report below. The plugin
  // fires CAN_UNDO/CAN_REDO on empty↔non-empty stack transitions; we also push a
  // minimal report right away so the native buttons update even when the
  // transition isn't followed by a selection change (e.g. the very last undo).
  const canUndoRef = useRef(false);
  const canRedoRef = useRef(false);
  useEffect(() => {
    const report = () =>
      onState({ ...EMPTY_LEXICAL_STATE, canUndo: canUndoRef.current, canRedo: canRedoRef.current });
    return mergeRegister(
      editor.registerCommand(CAN_UNDO_COMMAND, (v) => { canUndoRef.current = v; report(); return false; }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(CAN_REDO_COMMAND, (v) => { canRedoRef.current = v; report(); return false; }, COMMAND_PRIORITY_LOW),
    );
  }, [editor, onState]);

  // ── Is the STUDENT driving this report? ──
  // The OS drops the WebView's text selection the moment the WebView stops being
  // the focused view — which is exactly what tapping ✦ Ask AI does (the dock's
  // input takes focus, the keyboard comes up). Lexical then rebuilds its selection
  // from the leftover caret on its very next update, so the editor reports ONE
  // block: a "selection change" the student never made. Native can't tell that
  // report from a real tap on its own, so we label it here. Two independent
  // signals, because neither alone is trustworthy on both platforms: the editor
  // holds focus AND the page owns the window's focus, or a finger/key was on the
  // editor a moment ago.
  const drivenAt = useRef(0);
  // Event-tracked focus, cross-checked below against activeElement/hasFocus: each
  // signal is unreliable on its own (the page can keep `activeElement` after the
  // native view hands focus away; `hasFocus()` can lag a WebView focus change), so
  // "focused" means every signal agrees. Only a lost focus can veto anything, and
  // only a shrink, so an over-cautious false here costs nothing.
  const pageFocused = useRef(true);
  useEffect(() => {
    const stamp = () => { drivenAt.current = Date.now(); pageFocused.current = true; };
    const gained = () => { pageFocused.current = true; };
    const lost = () => { pageFocused.current = false; };
    let bound: HTMLElement | null = null;
    const bind = (el: HTMLElement | null) => {
      if (bound) {
        for (const e of DRIVING_EVENTS) bound.removeEventListener(e, stamp, true);
        bound.removeEventListener("focus", gained, true);
        bound.removeEventListener("blur", lost, true);
      }
      bound = el;
      if (bound) {
        for (const e of DRIVING_EVENTS) bound.addEventListener(e, stamp, true);
        bound.addEventListener("focus", gained, true);
        bound.addEventListener("blur", lost, true);
      }
    };
    const off = editor.registerRootListener((root) => bind(root));
    // The window pair, not the root's — the root may not be attached yet on the
    // first pass, and losing the WebView's focus is a window-level event anyway.
    const win = typeof window !== "undefined" ? window : null;
    win?.addEventListener("focus", gained);
    win?.addEventListener("blur", lost);
    return () => {
      off();
      bind(null);
      win?.removeEventListener("focus", gained);
      win?.removeEventListener("blur", lost);
    };
  }, [editor]);
  const isUserDriven = useCallback(() => {
    const root = editor.getRootElement();
    const doc = root?.ownerDocument;
    if (!root || !doc) return true; // nothing to interrogate — never veto on a guess
    const focused =
      pageFocused.current &&
      (doc.activeElement === root || root.contains(doc.activeElement)) &&
      (typeof doc.hasFocus !== "function" || doc.hasFocus());
    return focused || Date.now() - drivenAt.current < DRIVING_MS;
  }, [editor]);

  // Report the focused block (formats, index, text, screen-Y) to the native side
  // so the reused native pill / AI dock can attach to the Lexical selection.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let key: string | null = null;
      let payload: LexicalState = { ...EMPTY_LEXICAL_STATE };
      editorState.read(() => { ({ key, payload } = $readSelectionState()); });
      if (key) {
        const el = editor.getElementByKey(key);
        if (el) payload = { ...payload, y: el.getBoundingClientRect().top };
      }
      onState({ ...payload, canUndo: canUndoRef.current, canRedo: canRedoRef.current, userDriven: isUserDriven() });
    });
  }, [editor, onState, isUserDriven]);

  return null;
}
