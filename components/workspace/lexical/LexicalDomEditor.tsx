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
import { useCallback, useEffect, useRef } from "react";
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
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  ListNode,
  ListItemNode,
  $isListNode,
  $isListItemNode,
  $insertList,
  $removeList,
} from "@lexical/list";
import { $setBlocksType, $patchStyleText } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $getRoot,
  $getNodeByKey,
  $getNearestNodeFromDOMNode,
  $addUpdateTag,
  $getSelection,
  $setSelection,
  $isRangeSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isTextNode,
  $createParagraphNode,
  $createTextNode,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
  CLEAR_HISTORY_COMMAND,
  PASTE_COMMAND,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type ElementFormatType,
  type ElementNode,
  type LexicalNode,
  type TextFormatType,
  type LexicalEditor,
  // Aliased: this file already declares its own local `LexicalCommand` (the
  // native command envelope type below) — the alias avoids shadowing it.
  type LexicalCommand as LxCommand,
} from "lexical";
import {
  $blocksToLexical,
  $lexicalToBlocks,
  BlockDataNode,
  $createBlockDataNode,
  $isBlockDataNode,
  ChromeNode,
  $isChromeNode,
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
  type ChromeData,
  type ChromeKind,
  MediaContext,
  AnchorGeometryContext,
  EditCellContext,
  TableProposalContext,
  TABLE_AI_LABELS_EN,
  WorkingLabelsContext,
  WORKING_LABELS_EN,
  SuggestionNode,
  $createSuggestionNode,
  $isSuggestionNode,
  SUGGEST_APPROVE_COMMAND,
  SUGGEST_REJECT_COMMAND,
  SUGGEST_AGAIN_COMMAND,
  SUGGEST_EDIT_COMMAND,
  type SugData,
  RangeSuggestionNode,
  $createRangeSuggestionNode,
  $isRangeSuggestionNode,
  RANGE_APPROVE_COMMAND,
  RANGE_REJECT_COMMAND,
  RANGE_AGAIN_COMMAND,
  RANGE_EDIT_COMMAND,
  type RangeData,
  type RangeOriginal,
  GhostCompletionNode,
  $createGhostCompletionNode,
  $isGhostCompletionNode,
  ACCEPT_COMPLETION_COMMAND,
  EquationNode,
  EQUATION_EDIT_COMMAND,
  $equationTarget,
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
  lineHeightPx,
  chromeDrawingFractions,
  duotoneStops,
  PX_PER_PT,
  type AnchorSectionGeometry,
  type BlockFmt,
} from "@/lib/page-layout";
import type { DocBlockDTO } from "@/lib/api";
// type-only — WorkspaceLexicalView is the native ('use dom' host) module; importing
// just the type is erased at compile time, same contract as ChromeData above.
import type { PageSetup } from "../WorkspaceLexicalView";
// ── ./editor-components ──────────────────────────────────────────────────────
// This module carries the 'use dom' directive, so babel-preset-expo allows it
// exactly ONE export and it must be the default. Every contract, helper, plugin
// and stylesheet therefore lives beside it in editor-components/ (plain web-bundle
// modules, free to export as they like). Gate: node scripts/verify-use-dom.mjs.
import { INSERT_BLOCK_COMMAND } from "./editor-components/commands";
import { seed } from "./editor-components/seed";
import { CSS } from "./editor-components/styles";
import { theme } from "./editor-components/theme";
import type {
  BlockFmtChange,
  InsertBlockPayload,
  LexicalCommand,
  LexicalState,
  RangeSuggestionInput,
  ScrollAnchor,
  SearchInput,
  SuggestionInput,
} from "./editor-components/types";
import type { LexicalDomEditorProps } from "./editor-components/props";

// A touch/keystroke on the editor counts as the student driving it for this long,
// covering the window where the gesture is over but the focus bookkeeping (or a
// mid-gesture ActionMode) hasn't settled yet.
const DRIVING_MS = 700;
// The events that mean a finger or a key is on the editor itself. Captured, so a
// plugin that stops propagation can't hide the interaction from us.
const DRIVING_EVENTS = ["pointerdown", "touchstart", "mousedown", "keydown", "beforeinput"] as const;

/**
 * Measure each block's rendered height at TRUE page geometry.
 *
 * Renders one block at a time into an offscreen host whose width is the real
 * text column (≈601.7px for A4 at 1"), so the heights returned are the heights
 * Word would produce — not the heights of the readable-size visible editor.
 *
 * Heights are cached under a content hash, so a keystroke re-measures exactly
 * one block. Never call this per keystroke regardless: the caller debounces.
 *
 * NOT exported, and it never can be: babel-preset-expo's use-dom-directive
 * plugin throws "Modules with the 'use dom' directive only support a single
 * default export" for any non-TYPE named export. tsc cannot see that — it is a
 * bundle-time failure that takes the whole editor screen down with it.
 */
const measureCache = new Map<string, { h: number; before: number }>();

// Module-private helper beside the cache, called from PaginationPlugin's
// font-readiness effect — a measurement taken before Liberation Serif loads
// is poisoned (it measured the fallback serif's metrics, not Word's).
function measureCacheClear(): void {
  measureCache.clear();
}

function blockMeasureKey(el: HTMLElement, columnPx: number): string {
  return `${Math.round(columnPx)}|${el.className}|${el.innerHTML}`;
}

// Height of ONE line at `normal` leading in the measuring font — the base the
// `auto` multiplier scales (Word's 1.5x means 1.5x the font's own leading,
// which for Liberation Serif is Times New Roman's). Cached per (sizePt, rtl).
// Measured inside the SAME offscreen host used for block measurement (not
// document.body) so it shares the same width/dir context.
const singleLineCache = new Map<string, number>();
function singleLinePx(host: HTMLElement, sizePt: number, rtl: boolean): number {
  const key = `${sizePt}|${rtl ? "r" : "l"}`;
  const hit = singleLineCache.get(key);
  if (hit !== undefined) return hit;
  const probe = document.createElement("div");
  probe.style.cssText = `font-size:${sizePt * PX_PER_PT}px;line-height:normal;`;
  // Same tofu-safe rule as the rest of the app: Arabic NEVER gets a
  // concrete-first font stack (per-char glyph paths break on RNSVG/WebView
  // for some concrete serif fallback chains) — a generic sans is the only
  // stack verified safe on-device for Arabic text.
  probe.style.fontFamily = rtl ? "sans-serif" : '"Liberation Serif", Georgia, serif';
  probe.textContent = rtl ? "نص" : "Hg";
  host.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  singleLineCache.set(key, h);
  return h;
}

function measureBlockHeights(
  sources: HTMLElement[],
  columnPx: number,
  rtl: boolean,
  fmts?: (BlockFmt | null)[],
): { h: number; before: number }[] {
  let host = document.querySelector<HTMLDivElement>(".lx-measure");
  if (!host) {
    host = document.createElement("div");
    host.className = "lx-measure";
    document.body.appendChild(host);
  }
  host.style.width = `${columnPx}px`;
  // Arabic line-breaking differs from Latin, so the host must measure in the
  // DOCUMENT's direction — which is content-driven here, never locale-driven.
  host.dir = rtl ? "rtl" : "ltr";

  return sources.map((src, i) => {
    const fmt = fmts?.[i] ?? null;
    const key = `${rtl ? "r" : "l"}|${fmt ? JSON.stringify(fmt) : "-"}|${blockMeasureKey(src, columnPx)}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) return hit;

    const clone = src.cloneNode(true) as HTMLElement;
    host.innerHTML = "";
    host.appendChild(clone);

    let result: { h: number; before: number };
    if (fmt) {
      // Measure at the DOCUMENT's typography, not the editor's reading style:
      // Liberation Serif (Times New Roman's metric twin) for LTR, the same
      // tofu-safe generic sans for RTL — never a concrete-first stack on
      // Arabic. Margins are zeroed because before/after now come from the
      // DTO, not getComputedStyle.
      clone.style.fontFamily = rtl ? "sans-serif" : '"Liberation Serif", Georgia, serif';
      clone.style.fontSize = `${fmt.sizePt * PX_PER_PT}px`;
      clone.style.lineHeight = `${lineHeightPx(fmt, singleLinePx(host, fmt.sizePt, rtl))}px`;
      clone.style.marginTop = "0";
      clone.style.marginBottom = "0";
      const h = clone.getBoundingClientRect().height + fmt.afterPt * PX_PER_PT;
      result = { h, before: fmt.beforePt * PX_PER_PT };
    } else {
      // No fmt (tables, images, old caches): today's path — heights come
      // from the clone's own computed margins, not the DTO. `h` still
      // excludes the space-before component (marginTop), same contract as
      // the fmt branch above and as `paginate()` requires of `heights[]` —
      // it now travels separately as `before` so a natural-page-top break
      // can still shed it (F3) without double-counting it mid-page.
      const cs = window.getComputedStyle(clone);
      const marginTop = parseFloat(cs.marginTop || "0");
      const h = clone.getBoundingClientRect().height + parseFloat(cs.marginBottom || "0");
      result = { h, before: marginTop };
    }
    host.innerHTML = "";

    // Bound the cache so a long editing session cannot grow it without limit.
    if (measureCache.size > 4000) measureCache.clear();
    measureCache.set(key, result);
    return result;
  });
}

// Bridge between the native props and the Lexical editor instance: apply an
// incoming command, and report the active formats out on every update.
function EditorBridge({
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
    // Don't focus for the block-scoped pill format or serialize — focusing the
    // content-editable pops the keyboard and scrolls (the pill applies formatting
    // without moving the caret). The lab's selection commands still focus. Undo/
    // redo also skip focus: tapped from the dock with the keyboard closed, they
    // must not pop it (Lexical's history doesn't need a live selection).
    if (command.type !== "blockFormat" && command.type !== "serialize" && command.type !== "list" && command.type !== "undo" && command.type !== "redo" && command.type !== "insert" && command.type !== "blur") editor.focus();
    switch (command.type) {
      case "bold":
      case "italic":
      case "underline":
        lxQuietCommand(editor, FORMAT_TEXT_COMMAND, command.type as TextFormatType);
        break;
      case "align":
        if (command.value) lxQuietCommand(editor, FORMAT_ELEMENT_COMMAND, command.value as ElementFormatType);
        break;
      case "blockFormat":
        // Whole-block formatting from the native pill: apply to every selected
        // block (matches the server's whole-paragraph `format` op). Tagged
        // SKIP_DOM_SELECTION so it never focuses/scrolls the WebView.
        editor.update(() => applyBlockFormat(command.value), { tag: SKIP_DOM_SELECTION_TAG });
        break;
      case "heading":
        lxQuietUpdate(editor, () => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          $setBlocksType(sel, () =>
            command.value === "paragraph" || !command.value ? $createParagraphNode() : $createHeadingNode(command.value as HeadingTagType),
          );
        });
        break;
      case "quote":
        lxQuietUpdate(editor, () => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) $setBlocksType(sel, () => $createQuoteNode());
        });
        break;
      case "list":
        // Indent/outdent nest a list item one level (promote/demote). They're
        // editor COMMANDS (not selection mutations) — dispatch straight through so
        // Lexical's list logic handles the nesting + renumbering, then stop.
        if (command.value === "indent") { lxQuietCommand(editor, INDENT_CONTENT_COMMAND, undefined); break; }
        if (command.value === "outdent") { lxQuietCommand(editor, OUTDENT_CONTENT_COMMAND, undefined); break; }
        // Apply on the preserved selection inside a tagged update (no focus/scroll,
        // like blockFormat). ul→bullet, ol→number, check→checklist, else remove.
        editor.update(
          () => {
            const sel = $getSelection();
            if (!$isRangeSelection(sel)) return;
            if (command.value === "none") $removeList();
            else if (command.value === "check") $insertList("check");
            else $insertList(command.value === "ol" ? "number" : "bullet");
          },
          { tag: SKIP_DOM_SELECTION_TAG },
        );
        break;
      case "undo":
        editor.dispatchCommand(UNDO_COMMAND, undefined);
        break;
      case "redo":
        editor.dispatchCommand(REDO_COMMAND, undefined);
        break;
      case "color":
        lxQuietUpdate(editor, () => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) $patchStyleText(sel, { color: !command.value || command.value === "clear" ? "" : `#${command.value.replace(/^#/, "")}` });
        });
        break;
      case "clearFormatting":
        lxQuietUpdate(editor, () => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          $patchStyleText(sel, { color: "" });
          (["bold", "italic", "underline"] as const).forEach((f) => { if (sel.hasFormat(f)) sel.formatText(f); });
        });
        break;
      case "serialize":
        if (onBlocks) editor.getEditorState().read(() => onBlocks($lexicalToBlocks()));
        break;
      case "insert":
        // value = JSON { kind }. Delegate to SlashPlugin's command (owns the /query
        // deletion + placement). No focus() side-effect needed — the caret is live.
        if (command.value) editor.dispatchCommand(INSERT_BLOCK_COMMAND, JSON.parse(command.value) as InsertBlockPayload);
        break;
      case "blur":
        // Close the OS keyboard. RN's Keyboard.dismiss() can't reach the caret
        // inside the WebView, so the surface that wants the keyboard gone (the
        // Insert drawer) dispatches this instead. `editor.blur()` only drops the
        // DOM range — the editor-state selection survives, so the /slash insert
        // still lands on the right block afterwards.
        editor.blur();
        break;
    }
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
      onState({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, alignment: null, index: -1, text: "", y: -1, canUndo: canUndoRef.current, canRedo: canRedoRef.current });
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
      let payload: LexicalState = { bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, alignment: null, index: -1, text: "", y: -1 };
      editorState.read(() => {
        const sel = $getSelection();
        // A structural block (table/image/other) tapped → NodeSelection on its
        // BlockDataNode. Report it as a single-block selection of THAT block's kind
        // so the native pill shows the image/table/… toolset.
        if ($isNodeSelection(sel)) {
          const nodes = sel.getNodes();
          // A tapped chrome band (section header/footer/section-break) → NodeSelection
          // on its display-only ChromeNode. Report it with a "chrome:"-prefixed
          // blockType so the native side shows the chrome bubble (not a block toolset).
          // Mutually exclusive with the page-band and BlockDataNode paths below (a
          // selection is ONE node): check chrome first, then the page band, else
          // the structural block.
          const cn = nodes.length === 1 && $isChromeNode(nodes[0]) ? nodes[0] : null;
          const pb = nodes.length === 1 && $isPageBreakNode(nodes[0]) ? nodes[0] : null;
          const bd = nodes.length === 1 && $isBlockDataNode(nodes[0]) ? nodes[0] : null;
          if (cn) {
            const cd = cn.getData();
            key = cn.getKey();
            payload = {
              bold: false, italic: false, underline: false,
              blockType: "chrome:" + cd.kind, // "chrome:top" | "chrome:bottom" | "chrome:section"
              isRTL: cd.rtl, alignment: null,
              index: cd.startBlockIndex, text: cd.text,
              blocks: [{ index: cd.startBlockIndex, text: cd.text }],
              y: -1,
            };
          } else if (pb) {
            // A tapped page band. It carries BOTH a header and a footer, so the
            // side the student actually touched decides which we report — then
            // it rides the EXISTING chrome path, so the native sheet, the ✦
            // panel and the template picker all work with no native change.
            const d = pb.getData();
            const side = pb.getPick();
            // A gutter tap on a footerless page falls back to gutterTarget, so
            // the footer sheet still opens and can offer page numbers.
            const part = side === "top" ? d.header : (d.footer ?? d.gutterTarget);
            if (part) {
              key = pb.getKey();
              payload = {
                bold: false, italic: false, underline: false,
                blockType: "chrome:" + side,   // "chrome:top" | "chrome:bottom"
                isRTL: d.rtl, alignment: null,
                index: part.startBlockIndex, text: part.text,
                blocks: [{ index: part.startBlockIndex, text: part.text }],
                y: -1,
              };
            }
          } else if (bd) {
            const idx = $rootChildBlockIndex(bd);
            key = bd.getKey();
            payload = { bold: false, italic: false, underline: false, blockType: bd.getBlock().kind, isRTL: false, alignment: null, index: idx, text: "", blocks: [{ index: idx, text: "" }], y: -1 };
          }
          return;
        }
        if (!$isRangeSelection(sel)) return;
        const anchor = sel.anchor.getNode();
        const top = anchor.getKey() === "root" ? null : anchor.getTopLevelElement();
        if (anchor.getKey() !== "root" && !top) return; // selection detached (e.g. mid-suggestion)
        let blockType = "paragraph";
        if (top) {
          if ($isHeadingNode(top)) blockType = top.getTag();
          else if ($isListNode(top)) { const lt = top.getListType(); blockType = lt === "bullet" ? "bullet" : lt === "check" ? "check" : "number"; }
          else blockType = top.getType(); // "paragraph" | "quote"
        }
        key = top ? top.getKey() : null;
        // Alignment + direction live on the LIST ITEM (applyBlockFormat targets it),
        // NOT the top-level ListNode — so read the element format from the nearest
        // list-item ancestor when the caret is inside a list, else from `top` itself.
        // Otherwise the align sub-pill's active highlight / RTL state would read the
        // list's (always-unset) format and never reflect the item's real alignment.
        let fmtNode: ElementNode | null = top;
        if (top && $isListNode(top)) {
          let li: LexicalNode | null = anchor;
          while (li && !$isListItemNode(li)) li = li.getParent();
          if ($isListItemNode(li)) fmtNode = li;
        }
        // ElementNode.getFormatType() → "" | "left" | "center" | "right" | "justify" | "start" | "end"
        const fmt = fmtNode ? fmtNode.getFormatType() : "";
        // Every top-level block the selection spans, in document order. A caret or an
        // in-paragraph selection yields ONE entry; a cross-paragraph drag lists them
        // all. We walk the selected nodes (not just the anchor, which stays put while
        // the focus extends downward) so extending a selection grows the set — that's
        // what lets the native side build a MULTI-block selection instead of
        // collapsing everything to the anchor block.
        const spanned: { index: number; text: string }[] = [];
        const seen = new Set<number>();
        for (const n of sel.getNodes()) {
          if (n.getKey() === "root") continue;
          // block-model index (lists expanded), so a list ITEM counts as its own
          // block — not the whole list collapsed to one entry.
          const idx = $blockIndexOfNode(n);
          if (idx < 0 || seen.has(idx)) continue;
          seen.add(idx);
          const node = $nodeAtBlockIndex(idx);
          spanned.push({ index: idx, text: node ? node.getTextContent() : "" });
        }
        spanned.sort((a, b) => a.index - b.index);
        payload = {
          bold: sel.hasFormat("bold"),
          italic: sel.hasFormat("italic"),
          underline: sel.hasFormat("underline"),
          blockType,
          isRTL: !!fmtNode && fmtNode.getDirection() === "rtl",
          alignment: fmt === "left" || fmt === "center" || fmt === "right" || fmt === "justify" ? fmt : null,
          index: $blockIndexOfNode(anchor),
          text: (spanned.find((s) => s.index === $blockIndexOfNode(anchor))?.text) ?? (top ? top.getTextContent() : ""),
          blocks: spanned,
          y: -1,
        };
      });
      if (key) {
        const el = editor.getElementByKey(key);
        if (el) payload = { ...payload, y: el.getBoundingClientRect().top };
      }
      onState({ ...payload, canUndo: canUndoRef.current, canRedo: canRedoRef.current, userDriven: isUserDriven() });
    });
  }, [editor, onState, isUserDriven]);

  return null;
}

// Every mutation the APP drives — a pill tap, the in-editor bubble, a plugin
// rewrite, a preview swap, a completion ghost — goes through here rather than
// calling editor.update directly.
//
// Lexical's reconciler ends each update by scrolling the collapsed caret into view
// (LexicalSelection: `!tags.has(SKIP_SCROLL_INTO_VIEW_TAG) && isCollapsed &&
// rootElement === activeElement`). That is a browser-shaped default this editor
// must not have: nothing should move this WebView except our own deliberate
// triggers — scrollToIndex, scrollToChrome, ScrollSyncPlugin's restore, and
// withScrollPinned's pin. A student who taps Bold, or whose autocomplete ghost
// lands, did not ask the page to move.
//
// The student's own TYPING is deliberately left alone: Lexical's input path keeps
// the line being written above the on-screen keyboard (the visualViewport branch
// in scrollIntoViewIfNeeded). That is the one autoscroll a writing app wants, and
// silencing it would let the caret slide under the keyboard.
//
// `alsoSkipSelection` additionally suppresses the whole DOM-selection reconcile —
// stronger, and needed where the update must not touch focus either (it re-focuses
// the root, which pops the keyboard on iOS).
function lxQuietUpdate(editor: LexicalEditor, mutator: () => void, alsoSkipSelection = false): void {
  editor.update(mutator, {
    tag: alsoSkipSelection ? [SKIP_SCROLL_INTO_VIEW_TAG, SKIP_DOM_SELECTION_TAG] : SKIP_SCROLL_INTO_VIEW_TAG,
  });
}

// Dispatch a built-in Lexical command without its autoscroll. `dispatchCommand`
// takes no update options, but a command dispatched from INSIDE an active update
// is processed within it — so the tag added here covers the listener's own work.
function lxQuietCommand<P>(editor: LexicalEditor, command: LxCommand<P>, payload: P): void {
  editor.update(() => {
    $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
    editor.dispatchCommand(command, payload);
  });
}

// Is a finger on the screen right now? Registered once, passively, so asking is
// free on the hot path. A scroll pin must never run against a live drag.
let lxTouching = false;
// Cancels the pin currently re-applying across frames, so a burst of structural
// updates supersedes rather than stacks.
let lxPinCancel: (() => void) | null = null;
if (typeof window !== "undefined") {
  const down = () => { lxTouching = true; };
  const up = () => { lxTouching = false; };
  window.addEventListener("touchstart", down, { passive: true, capture: true });
  window.addEventListener("touchend", up, { passive: true, capture: true });
  window.addEventListener("touchcancel", up, { passive: true, capture: true });
}

// Run a Lexical mutation without letting the WebView jump: capture the page scroll
// before the update and pin it back after the DOM reconciles. A node replace (a
// suggestion appearing) or a full reseed (approve → doc rebuild) otherwise scrolls
// the moved caret / rebuilt content into view — the reported "editor scrolls away
// when I hit Improve, and jumps to the bottom on Approve".
function withScrollPinned(editor: LexicalEditor, mutator: () => void, _blurAfter = false) {
  // The REAL fix (per Lexical docs): tag the update SKIP_DOM_SELECTION_TAG so the
  // reconciler skips the ENTIRE DOM-selection update — which is what re-focuses the
  // root (popping the keyboard → iOS scroll) AND scrolls the selection into view.
  // SKIP_SCROLL_INTO_VIEW_TAG alone wasn't enough: it stopped the scroll but the
  // re-focus still fired and iOS scrolled the focused editable into view. A light
  // 2-frame scroll restore stays as a backstop for plain reflow.
  //
  // That backstop used to be a raw `window.scrollY` → `window.scrollTo` round-trip,
  // which pinned NOTHING: both halves are unreliable inside this WebView (the same
  // reason ScrollSyncPlugin below was rewritten to stop using them). So whenever the
  // tag alone didn't hold — a full reseed rebuilds every node and there is no
  // selection left to skip — the student was dropped at the top of the document.
  // Anchor to a BLOCK instead, measured off getBoundingClientRect and put back with
  // scrollIntoView + scrollBy. It has to be the block INDEX and not a node key: a
  // reseed replaces every node, so the key captured beforehand resolves to nothing.
  // THE FINGER OUTRANKS THE PIN. Re-applying an anchor while the student is
  // scrolling is not a pin, it is a fight — and it looks like the editor shaking.
  // A touch in progress skips the pin entirely; a touch that ARRIVES mid-pin calls
  // off the remaining frames.
  if (lxTouching) {
    editor.update(mutator, { tag: SKIP_DOM_SELECTION_TAG });
    return;
  }
  const anchor = lxMeasureAnchor(editor);
  lxPinCancel?.(); // supersede an in-flight pin rather than stacking restores
  let cancelled = false;
  let raf1 = 0, raf2 = 0;
  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(raf1);
    cancelAnimationFrame(raf2);
    if (typeof window !== "undefined") window.removeEventListener("touchstart", stop, true);
    if (lxPinCancel === stop) lxPinCancel = null;
  };
  lxPinCancel = stop;
  if (typeof window !== "undefined") window.addEventListener("touchstart", stop, { passive: true, capture: true });
  const restore = () => { if (!cancelled) lxApplyAnchor(editor, anchor); };
  editor.update(mutator, {
    tag: SKIP_DOM_SELECTION_TAG,
    // Three passes over two frames: the DOM has reconciled by onUpdate, but a reseed
    // of a long document is still growing its layout, and scrollIntoView can only
    // land against the height that exists when it runs.
    onUpdate: () => {
      restore();
      raf1 = requestAnimationFrame(() => {
        restore();
        raf2 = requestAnimationFrame(() => { restore(); stop(); });
      });
    },
  });
}

function lxGetRoot(editor: LexicalEditor): HTMLElement | null {
  // .lx-content — its children are the top-level block elements.
  return editor.getRootElement() ?? (typeof document !== "undefined" ? (document.querySelector(".lx-content") as HTMLElement | null) : null);
}

// Binary-search the first top-level block whose bottom is below the viewport top
// (blocks stack top→bottom, so `bottom > 0` is monotonic). getBoundingClientRect is
// viewport-relative, so it reflects the REAL scroll even where window.scrollY is
// unreliable inside a WebView.
function lxFirstVisible(kids: HTMLCollection): number {
  let lo = 0, hi = kids.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().bottom > 0) { ans = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  return ans;
}

// Read the current reading position as a block anchor. Shared by the scroll-sync
// reporter (which hands it to native to keep across a re-entry) and by
// withScrollPinned (which hands it straight back after a mutation).
//
// The index is a BLOCK index — display-only nodes skipped, lists expanded — and not
// the raw DOM child index, because chrome bands and page boundaries are top-level
// root children that the block model excludes; a raw index would be off by their
// count for every block below the first one. `y` is kept only as the last-resort
// fallback for when no block can be resolved.
function lxMeasureAnchor(editor: LexicalEditor): ScrollAnchor {
  const y = typeof window !== "undefined" ? window.scrollY : 0;
  const kids = lxGetRoot(editor)?.children;
  if (!kids || !kids.length) return { y, index: -1, delta: 0 };
  const i = lxFirstVisible(kids);
  if (i < 0) return { y, index: -1, delta: 0 };
  const el = kids[i] as HTMLElement;
  const r = el.getBoundingClientRect();
  let index = -1;
  // editor.read (NOT getEditorState().read): $getNearestNodeFromDOMNode maps a DOM
  // node → Lexical node via the editor's key↔DOM map, so it needs the active EDITOR
  // bound, not just the active state (getEditorState().read binds only the state →
  // getActiveEditor() throws "no active editor").
  editor.read(() => {
    let node = $getNearestNodeFromDOMNode(el);
    // The first-visible element can be a band; anchor to the block it precedes.
    while (node && $isDisplayOnlyNode(node)) node = node.getNextSibling();
    if (node) index = $blockIndexOfNode(node);
  });
  return { y, index, delta: Math.max(0, Math.round(-r.top)) };
}

// Put a measured anchor back. scrollIntoView + scrollBy is the ONE pair proven to
// move this WebView; window.scrollTo appears only as the fallback for when the
// block can't be resolved, where there is nothing better to try.
function lxApplyAnchor(editor: LexicalEditor, a: ScrollAnchor): void {
  if (typeof window === "undefined") return;
  let key: string | null = null;
  if (a.index >= 0) {
    editor.getEditorState().read(() => {
      const node = $anyNodeAtBlockIndex(a.index);
      key = node ? node.getKey() : null;
    });
  }
  const el = key ? editor.getElementByKey(key) : null;
  if (!el) { window.scrollTo(0, a.y); return; }
  el.scrollIntoView({ block: "start" });
  if (a.delta > 0) window.scrollBy(0, a.delta);
}

// Persist + restore the reading position so the user re-enters the document where
// they left off. The Writer is destroyed on a workspace-leave (back), re-keyed on a
// Preview round-trip, and — inside a native-stack — its WebView can reset to the top
// on re-focus WITHOUT a React remount. So restore is driven by `restore.nonce`
// (native bumps it on every focus / preview-return), not by mount alone. `onScroll`
// reports the live position out (throttled) for native to keep.
//
// Reliability notes (learned the hard way): inside this WebView `window.scrollTo` is
// unreliable, so restore uses `element.scrollIntoView()` (the ONE proven primitive —
// the outline-nav scrollToIndex uses it). And DOM scroll events fire unreliably, so
// detection leans on a 700ms POLL (getBoundingClientRect is accurate) plus capture-
// phase scroll listeners.
function ScrollSyncPlugin({
  restore,
  onScroll,
  onRestored,
}: {
  restore?: { anchor: ScrollAnchor; nonce: number } | null;
  onScroll?: (anchor: ScrollAnchor) => void;
  onRestored?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Shared gate: while a restore is settling, reporting is suppressed so the fresh
  // (reset-to-top) position isn't saved over the anchor we're about to restore to.
  const armedRef = useRef(true);
  const cancelRestoreRef = useRef<(() => void) | null>(null);

  // ── Reporting (mount-lifetime): capture-phase events + a poll backstop. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Shared with withScrollPinned's pin — one measurement, so the position a
    // mutation restores is read exactly the way the one native keeps is.
    const measure = (): ScrollAnchor => lxMeasureAnchor(editor);
    let lastKey = "";
    const emit = () => {
      if (!armedRef.current) return;
      const a = measure();
      const key = `${a.index}:${a.delta}`;
      if (key === lastKey) return;
      lastKey = key;
      onScroll?.(a);
    };
    let throttle: ReturnType<typeof setTimeout> | null = null;
    const onScrollEvt = () => {
      if (throttle) return;
      throttle = setTimeout(() => { throttle = null; emit(); }, 200);
    };
    const root0 = lxGetRoot(editor);
    // Passive — reporting the reading position never cancels a scroll, and declaring
    // that keeps the scroll on the compositor instead of blocking on this handler.
    const opts = { passive: true, capture: true } as const;
    window.addEventListener("scroll", onScrollEvt, opts);
    root0?.addEventListener("scroll", onScrollEvt, opts);
    const poll = setInterval(emit, 700);
    return () => {
      if (throttle) clearTimeout(throttle);
      clearInterval(poll);
      window.removeEventListener("scroll", onScrollEvt, true);
      root0?.removeEventListener("scroll", onScrollEvt, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Restore (on nonce change): scrollIntoView the anchor block over a short
  // settle window; suppress reporting until it settles so a reset-to-top can't be
  // saved over the target. ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!restore || !restore.anchor || restore.anchor.index < 0) return;
    const a = restore.anchor;
    cancelRestoreRef.current?.(); // supersede any in-flight restore
    armedRef.current = false; // suppress reporting while we settle

    let cancelled = false;
    let frames = 0, hStable = 0, lastH = -1, everApplied = false;
    const cleanups: Array<() => void> = [];
    // `notify` tells native the restore reached the target (→ hide the loading
    // overlay). Superseding / unmounting cleans up WITHOUT notifying.
    const finish = (notify?: boolean) => {
      if (cancelled) return;
      cancelled = true;
      armedRef.current = true;
      cleanups.splice(0).forEach((f) => f());
      if (cancelRestoreRef.current === finish) cancelRestoreRef.current = null;
      if (notify) onRestored?.();
    };
    cancelRestoreRef.current = finish;

    // Resolve the anchor's BLOCK index → node → its DOM element via the chrome-aware
    // $anyNodeAtBlockIndex (chrome bands are top-level root DOM children but excluded
    // from the block model, so indexing raw DOM children would be off by the chrome
    // count for every block below the first band). Resolve the KEY once: the tree
    // isn't edited while layout settles, so the target node is stable across the
    // window — only its element geometry changes per frame. A null key (index out of
    // range) leaves `el` null below, preserving the original no-op guard.
    let targetKey: string | null = null;
    editor.getEditorState().read(() => {
      const node = $anyNodeAtBlockIndex(a.index);
      targetKey = node ? node.getKey() : null;
    });

    // Re-apply the anchor every frame while a big doc is still laying out (its
    // scrollHeight keeps growing), and only finish once the page has STOPPED growing
    // for several frames — i.e. layout is actually complete and the last scrollIntoView
    // truly landed. Gating on layout-done (not on "block.top ≈ target") is essential:
    // before layout, every block reports top≈0, so a delta:0 anchor would look
    // "arrived" at the very top and hide the overlay before anything scrolled. Figures
    // pre-reserve height (figureStyle) so images don't keep the height growing.
    let raf = requestAnimationFrame(function step() {
      if (cancelled) return;
      const h = document.documentElement.scrollHeight;
      hStable = h === lastH ? hStable + 1 : 0;
      lastH = h;
      // Resolve the block index → DOM element via the chrome-aware key computed
      // above. Raw root DOM children now include chrome bands, so kids[a.index]
      // would be off by the chrome count for every block below the first band.
      const el = targetKey ? editor.getElementByKey(targetKey) : null;
      if (el) {
        el.scrollIntoView({ block: "start" });
        if (a.delta > 0) window.scrollBy(0, a.delta);
        everApplied = true;
      }
      frames++;
      if (frames < 300 && (!everApplied || hStable < 8)) raf = requestAnimationFrame(step);
      else finish(true);
    });
    cleanups.push(() => cancelAnimationFrame(raf));

    // Stop the moment the user scrolls (don't fight them), and hard-cap the window.
    const userTook = () => finish(true);
    window.addEventListener("touchstart", userTook, { passive: true, capture: true });
    window.addEventListener("wheel", userTook, { passive: true, capture: true });
    cleanups.push(() => {
      window.removeEventListener("touchstart", userTook, true);
      window.removeEventListener("wheel", userTook, true);
    });
    const hardStop = setTimeout(() => finish(true), 5500);
    cleanups.push(() => clearTimeout(hardStop));

    return () => { finish(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.nonce]);

  return null;
}

// ── Block-model ⇄ Lexical index mapping ──────────────────────────────────────
// A Lexical LIST groups N item-paragraphs into ONE root child, but the block model
// (and $lexicalToBlocks) keeps them SEPARATE — so a node's block-model index ≠ its
// Lexical root position once a list exists. The native tools target block-model
// indices, so map them to the real node (a paragraph/heading, or a list item).
function listItemsOf(list: ListNode): ListItemNode[] {
  return list.getChildren().filter($isListItemNode) as ListItemNode[];
}
function $nodeAtBlockIndex(idx: number): ElementNode | null {
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if ($isListNode(child)) {
      const items = listItemsOf(child);
      if (idx < acc + items.length) return items[idx - acc];
      acc += items.length;
    } else {
      if (idx === acc) return $isHeadingNode(child) || $isParagraphNode(child) ? (child as ElementNode) : null;
      acc += 1;
    }
  }
  return null;
}
// Like $nodeAtBlockIndex, but returns the node at `idx` REGARDLESS of kind —
// including a structural BlockDataNode (table/image/other), which $nodeAtBlockIndex
// deliberately skips (it only yields editable heading/paragraph/list-item nodes).
// Used for scroll-into-view, where we just need the element to scroll to, so
// navigating to a table or figure from the outline drawer works too.
function $anyNodeAtBlockIndex(idx: number): LexicalNode | null {
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if ($isListNode(child)) {
      const items = listItemsOf(child);
      if (idx < acc + items.length) return items[idx - acc];
      acc += items.length;
    } else {
      if (idx === acc) return child;
      acc += 1;
    }
  }
  return null;
}
// Block-model index (lists expanded) of a DIRECT root child — e.g. a structural
// BlockDataNode (table/image/other) that a NodeSelection targets.
function $rootChildBlockIndex(node: LexicalNode): number {
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if (child === node) return acc;
    acc += $isListNode(child) ? listItemsOf(child).length : 1;
  }
  return -1;
}

// Block-model index (lists expanded) of the block CONTAINING a node — its list
// item if it sits inside a list, else its top-level element. -1 if detached.
function $blockIndexOfNode(node: LexicalNode): number {
  const top = node.getKey() === "root" ? null : node.getTopLevelElement();
  if (!top) return -1;
  let item: LexicalNode | null = node;
  while (item && !$isListItemNode(item)) item = item.getParent();
  let acc = 0;
  for (const child of $getRoot().getChildren()) {
    if ($isDisplayOnlyNode(child)) continue; // chrome band / page boundary — not a block
    if (child === top) {
      if ($isListNode(top) && $isListItemNode(item)) acc += listItemsOf(top).indexOf(item);
      return acc;
    }
    acc += $isListNode(child) ? listItemsOf(child).length : 1;
  }
  return -1;
}

function applyBlockFormat(json: string | undefined) {
  let payload: { indices?: number[]; changes?: BlockFmtChange };
  try { payload = JSON.parse(json || "{}"); } catch { return; }
  const indices = payload.indices || [];
  const ch = payload.changes || {};
  for (const idx of indices) {
    const base = $nodeAtBlockIndex(idx);
    // Target paragraphs, headings, AND list items (align/direction/marks all apply
    // to a list item; only the heading swap is paragraph/heading-only).
    if (!base || !($isHeadingNode(base) || $isParagraphNode(base) || $isListItemNode(base))) continue;
    let node: ElementNode = base;
    // level → paragraph⇄heading swap, preserving children + element format/dir
    if (ch.level !== undefined && !$isListItemNode(node)) {
      const wantHead = ch.level >= 1;
      const tag = ("h" + Math.min(ch.level, 6)) as HeadingTagType;
      const isHead = $isHeadingNode(node);
      if (wantHead !== isHead || ($isHeadingNode(node) && node.getTag() !== tag)) {
        const el: ElementNode = wantHead ? $createHeadingNode(tag) : $createParagraphNode();
        el.setFormat(node.getFormatType());
        const d = node.getDirection(); if (d) el.setDirection(d);
        el.append(...node.getChildren());
        node.replace(el);
        node = el;
      }
    }
    if (ch.alignment !== undefined) node.setFormat(ch.alignment as ElementFormatType);
    if (ch.direction !== undefined) node.setDirection(ch.direction);
    // inline marks on every text child (whole-block, matching patchRuns)
    for (const child of node.getChildren()) {
      if (!$isTextNode(child)) continue;
      (["bold", "italic", "underline"] as const).forEach((f) => {
        if (ch[f] !== undefined && child.hasFormat(f) !== ch[f]) child.toggleFormat(f);
      });
      if (ch.color !== undefined) child.setStyle(ch.color == null ? "" : `color: #${String(ch.color).replace(/^#/, "")}`);
      if (ch.clearFormatting) {
        (["bold", "italic", "underline"] as const).forEach((f) => { if (child.hasFormat(f)) child.toggleFormat(f); });
        child.setStyle("");
      }
    }
  }
}

// Rebuild the original block node from a suggestion's captured type/text — used to
// restore it when a proposal is rejected (approve routes through the sync layer,
// which reseeds the whole doc from server truth anyway).
function rebuildOriginal(text: string, origType: string) {
  const el =
    origType === "h1" || origType === "h2" || origType === "h3"
      ? $createHeadingNode(origType as HeadingTagType)
      : origType === "quote"
        ? $createQuoteNode()
        : $createParagraphNode();
  if (text) el.append($createTextNode(text));
  return el;
}

// Renders a pending AI proposal IN PLACE OF its block (matching the native
// InlineSuggestion — proposal as the paragraph, original teaser, ✓ Approve / ✕
// pill), driven by the native suggestion store via the `suggestion` prop. The
// SuggestionNode captures the replaced block's type so reject can restore it, and
// $lexicalToBlocks reports the original text for it (so a flush never drops the
// block). Approve/Reject dispatch commands that call back to `onSuggestAction`.
/**
 * A tapped equation → the native equation editor.
 *
 * The command carries only the node key, because that is all a decorator knows;
 * resolving it to a BLOCK INDEX has to happen here, where the whole tree is
 * readable. The payload crosses to native as a JSON string — DOM component props
 * are serializable only.
 */
function EquationTapPlugin({ onEquationTap }: { onEquationTap?: (payload: string) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        EQUATION_EDIT_COMMAND,
        (nodeKey: string) => {
          const target = editor.getEditorState().read(() => $equationTarget(nodeKey));
          if (target) onEquationTap?.(JSON.stringify(target));
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, onEquationTap],
  );
  return null;
}

function SuggestionPlugin({
  suggestion,
  onSuggestAction,
}: {
  suggestion?: SuggestionInput;
  onSuggestAction?: (action: string, text?: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Which action last cleared the suggestion — decides whether the node settles to
  // the PROPOSED text (approve) or the ORIGINAL (reject). This lets approve apply
  // IN PLACE (one node) instead of triggering a full doc reseed, which is what was
  // scrolling the view to the document end.
  const lastActionRef = useRef<string>("");
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(SUGGEST_APPROVE_COMMAND, () => { lastActionRef.current = "approve"; onSuggestAction?.("approve"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_REJECT_COMMAND, () => { lastActionRef.current = "reject"; onSuggestAction?.("reject"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_AGAIN_COMMAND, () => { onSuggestAction?.("again"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(SUGGEST_EDIT_COMMAND, (text) => { onSuggestAction?.("edit", text); return true; }, COMMAND_PRIORITY_LOW),
      ),
    [editor, onSuggestAction],
  );
  useEffect(() => {
    const mutate = () => {
      const root = $getRoot();
      const existing = root.getChildren().find($isSuggestionNode);
      // Cleared: settle the node in place — approve → the applied proposal, reject →
      // the untouched original. Doing it here (one node) means approve does NOT need
      // the sync-layer reseed (WorkspaceLexicalView skips it), so the view stays put.
      if (!suggestion || suggestion.index < 0) {
        if (existing) {
          const applied = lastActionRef.current === "approve";
          const sug = existing.__sug;
          if (sug.action === "setChart") {
            // A chart card never REPLACED its block — it sits beside the chart, which
            // is still in the tree. So there is nothing to rebuild: drop the card and
            // let the server echo repaint the chart with its new SVG.
            existing.remove();
            $setSelection(null);
            lastActionRef.current = "";
            return;
          }
          if (applied && sug.action === "insertTable" && sug.proposedRows?.length) {
            // Settle a table proposal IN PLACE (instant, no full reseed): insert the
            // real table node BEFORE the node, then leave the original (empty) paragraph
            // as the trailing spacer — matching the insertTable op's effect (table at
            // index, empty paragraph at index+1). The op syncs in the background and the
            // server echo reconciles. `index` is fixed by that reseed.
            existing.insertBefore(
              $createBlockDataNode({
                index: 0,
                kind: "table",
                rows: sug.proposedRows,
                ...(sug.tableHeader ? { header: true } : {}),
                ...(sug.tableRtl ? { direction: "rtl" } : {}),
              } as unknown as DocBlockDTO),
            );
            existing.replace(rebuildOriginal(sug.original, existing.__origType));
          } else if (applied && sug.action === "insertSourceImage" && sug.hasImage) {
            // Same in-place settle for a figure copied from a source: the figure node
            // goes in BEFORE the card and the (empty) paragraph stays after it, which
            // is exactly what the insertImage op does server-side (afterIndex = the
            // block before). Without a preview dataUri the node still renders — the
            // server echo brings the bytes back on reconcile.
            existing.insertBefore(
              $createBlockDataNode({
                index: 0,
                kind: "image",
                hasMedia: true,
                ...(sug.imageDataUri ? { dataUri: sug.imageDataUri } : {}),
                ...(sug.imageWidth ? { width: sug.imageWidth } : {}),
                ...(sug.imageHeight ? { height: sug.imageHeight } : {}),
              } as unknown as DocBlockDTO),
            );
            existing.replace(rebuildOriginal(sug.original, existing.__origType));
          } else {
            existing.replace(rebuildOriginal(applied ? sug.proposed : sug.original, existing.__origType));
          }
          $setSelection(null);
        }
        lastActionRef.current = "";
        return;
      }
      const data: SugData = {
        original: suggestion.original,
        proposed: suggestion.proposed,
        status: suggestion.status,
        instruction: suggestion.instruction,
        label: suggestion.label,
        reasoning: suggestion.reasoning,
        reasoningMs: suggestion.reasoningMs,
        action: suggestion.action,
        proposedRows: suggestion.proposedRows,
        tableHeader: suggestion.tableHeader,
        tableRtl: suggestion.tableRtl,
        hasImage: suggestion.hasImage,
        imageDataUri: suggestion.imageDataUri,
        imageWidth: suggestion.imageWidth,
        imageHeight: suggestion.imageHeight,
        // action "setChart": without these the card has no preview to render and
        // falls through to the plain-text branch, which shows an empty proposal.
        chartSvg: suggestion.chartSvg,
        chartOriginalSvg: suggestion.chartOriginalSvg,
        errorText: suggestion.errorText,
      };
      if (existing) { existing.getWritable().__sug = data; return; } // stream in place
      if (suggestion.action === "setChart") {
        // ⚠️ A chart is a structural BlockDataNode, so two things differ from a
        // paragraph rewrite:
        //   • $nodeAtBlockIndex only yields paragraph/heading/list-item nodes — it
        //     returns null here, which is why the card never appeared at all.
        //   • REPLACING it would be data loss: $lexicalToBlocks serializes a
        //     SuggestionNode as a paragraph of `sug.original` (empty for a chart),
        //     so a flush mid-review would delete the chart from the .docx.
        // So the card goes in AFTER the chart and the chart node stays put — the
        // same shape the native surface uses (figure visible, card beneath it).
        const chartNode = $anyNodeAtBlockIndex(suggestion.index);
        if (chartNode) {
          $setSelection(null);
          chartNode.insertAfter($createSuggestionNode(data, "paragraph"));
        }
        return;
      }
      const target = $nodeAtBlockIndex(suggestion.index);
      if (target) {
        const origType = $isHeadingNode(target)
          ? target.getTag()
          : target.getType() === "quote"
            ? "quote"
            : "paragraph";
        // Detach the caret from the block we're about to replace — a RangeSelection
        // left pointing into a removed node makes Lexical throw during reconcile.
        $setSelection(null);
        target.replace($createSuggestionNode(data, origType));
      }
    };
    // Pin scroll ONLY when the node is created/removed (that's what moves layout);
    // an in-place stream update (existing __sug) must not fight the user's scroll.
    // On the CLEAR path (approve/reject) also blur: tapping the pill button focused
    // it, and removing it drops the caret at the document end → iOS scroll.
    //
    // ⚠️ Ask the TREE whether the node exists (same as RangeSuggestionPlugin's
    // `hasNode`). The old test — "no proposed text yet, so this must be the create"
    // — holds only for the FIRST update: while the model is still thinking,
    // `reasoning` streams and re-runs this effect many times a second with
    // `proposed` still empty, so every one of those purely in-place re-renders took
    // the structural path and re-pinned the scroll. The mutator below already knows
    // better (`if (existing) … return // stream in place`); only this decision was
    // guessing. It went unnoticed while the pin was a silent no-op; once the pin
    // actually moved the view it became the editor shaking up and down under the
    // student's finger for as long as the AI thought.
    let hasNode = false;
    editor.getEditorState().read(() => { hasNode = !!$getRoot().getChildren().find($isSuggestionNode); });
    const isClear = !suggestion || suggestion.index < 0;
    const structural = isClear || !hasNode;
    if (structural) withScrollPinned(editor, mutate, isClear);
    else editor.update(mutate, { tag: SKIP_DOM_SELECTION_TAG }); // stream in place — never touch focus/scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion?.index, suggestion?.proposed, suggestion?.status, suggestion?.reasoning, suggestion?.label, suggestion?.proposedRows, suggestion?.imageDataUri]);
  return null;
}

// AI inline autocomplete. Detects a collapsed caret at the END of a text block,
// debounces ~600ms, and asks native for a completion (onRequestCompletion). Streams
// the returned `completion.text` into a GhostCompletionNode after the caret. Any
// real edit / caret move / blur clears the ghost (onCancelCompletion). Tapping or
// swiping the ghost dispatches ACCEPT_COMPLETION_COMMAND → merge into real text +
// onCommitCompletion. Suppressed while a suggestion / range / table proposal shows.
// Update tag marking our OWN ghost mutations so the detect listener never treats them
// as a real edit (replaces the old fragile `applyingGhost` flag).
const GHOST_TAG = "ai-ghost";
function CompletionPlugin({
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
function PasteImagePlugin({ onPasteImage, suppressed }: { onPasteImage?: (index: number) => void; suppressed: boolean }) {
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

// Detects a "/command" typed at the caret and reports it to native (onInsertTrigger),
// mirroring CompletionPlugin's detect-and-report bridge. Owns INSERT_BLOCK_COMMAND:
// when native picks a block, this handler deletes the /query then transforms the
// current block (text kinds) or leaves an empty line (clearSlash, for native ops).
// A slash is a command only at block start or right after whitespace, query = the
// run of non-space, non-slash chars up to the caret.
const SLASH_RE = /(?:^|\s)\/([^\s/]*)$/;
function SlashPlugin({
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

// Renders a pending RANGE proposal (multi-block dynamic rewrite) IN PLACE OF the
// selected range: it replaces blocks [start..end] with ONE RangeSuggestionNode
// showing the rewritten passage (1..N paragraphs). Approve/Reject/Again/Edit dispatch
// commands that call back to `onRangeAction`. On clear it settles in place — approve
// → the proposed paragraphs (the doc reseed then applies server truth), reject →
// the captured originals (no reseed). Driven by the native suggestion store's `range`.
function RangeSuggestionPlugin({
  rangeSuggestion,
  onRangeAction,
}: {
  rangeSuggestion?: RangeSuggestionInput;
  onRangeAction?: (action: string, text?: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Which action cleared the range — decides the clear behavior: approve reseeds
  // from server truth (nothing to do here); reject restores the originals in place.
  const lastActionRef = useRef<string>("");
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(RANGE_APPROVE_COMMAND, (keptText) => { lastActionRef.current = "approve"; onRangeAction?.("approve", keptText); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(RANGE_REJECT_COMMAND, () => { lastActionRef.current = "reject"; onRangeAction?.("reject"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(RANGE_AGAIN_COMMAND, () => { onRangeAction?.("again"); return true; }, COMMAND_PRIORITY_LOW),
        editor.registerCommand(RANGE_EDIT_COMMAND, (text) => { onRangeAction?.("edit", text); return true; }, COMMAND_PRIORITY_LOW),
      ),
    [editor, onRangeAction],
  );

  const r = rangeSuggestion;
  const active = !!r && r.start >= 0;
  const key = active ? `${r!.start}:${r!.end}:${r!.status}:${r!.proposed.length}:${r!.reasoning.length}` : "";
  useEffect(() => {
    // Does a range node currently exist? Decides create (structural) vs stream.
    // ── Cleared ──────────────────────────────────────────────────────────────
    // Do NOTHING to the editor here — a reseed from authoritative truth settles it:
    // APPROVE → approveRange published the applied doc (the sync layer reseeds the
    // whole editor to it); REJECT → onRangeAction forces a reseed from the current
    // (unchanged) doc, restoring the originals WITH their formatting. Mutating in
    // place here would (a) fire a spurious auto-save that races the reseed — the
    // revert bug — and (b) rebuild the originals as PLAIN text, losing runs/alignment.
    if (!active || !r) { lastActionRef.current = ""; return; }

    // ── Active: create the node, or stream into the existing one ──────────────
    let hasNode = false;
    editor.getEditorState().read(() => { hasNode = !!$getRoot().getChildren().find($isRangeSuggestionNode); });
    const mutate = () => {
      const root = $getRoot();
      const existing = root.getChildren().find($isRangeSuggestionNode) as RangeSuggestionNode | undefined;
      const data: RangeData = { original: r.original, proposed: r.proposed, status: r.status, instruction: r.instruction, reasoning: r.reasoning, reasoningMs: r.reasoningMs };
      if (existing) { existing.getWritable().__data = data; return; } // stream in place
      // Create: replace blocks [start..end] with ONE range node.
      //
      // r.start/r.end are BLOCK-MODEL indices. Root-child positions are NOT the
      // same space, and they diverge in both directions: a display-only node (a
      // chrome band, a page boundary) adds a position the block model doesn't
      // have, while a list collapses many block indices into ONE child. Indexing
      // getChildren() with them therefore removed and REPLACED the wrong nodes —
      // destructively, on any document with a band or a list above the range.
      //
      // Resolve to real nodes through the block-model mapper instead, and collect
      // them all BEFORE mutating: the removals below change the child list, and a
      // walk must not read a list it is editing.
      const originals: RangeOriginal[] = r.originalBlocks;
      if (r.start < 0 || r.end < r.start) return;
      const targets: LexicalNode[] = [];
      for (let i = r.start; i <= r.end; i++) {
        const n = $anyNodeAtBlockIndex(i);
        if (n && !targets.some((t) => t.getKey() === n.getKey())) targets.push(n);
      }
      if (targets.length === 0) return;
      // Every target must be a direct child of the root. A list item is not: it
      // lives inside a ListNode, so replacing it with a block-level decorator
      // would leave a malformed list (and emptying the list would strand it).
      // Refusing to show the proposal is strictly better than mangling the
      // student's document — the range tools already handle a null result.
      const rootKey = root.getKey();
      if (!targets.every((n) => n.getParent()?.getKey() === rootKey)) {
        console.warn("[range] proposal spans non-top-level blocks (a list?) — not rendering it");
        return;
      }
      $setSelection(null);
      for (let i = targets.length - 1; i > 0; i--) targets[i].remove();
      targets[0].replace($createRangeSuggestionNode(data, originals));
    };
    // Create is structural (pin scroll + blur); a pure stream update isn't.
    if (!hasNode) withScrollPinned(editor, mutate, true);
    else editor.update(mutate, { tag: SKIP_DOM_SELECTION_TAG });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

// Paints a persistent highlight on the top-level blocks the native side reports as
// selected (a MULTI-block selection), so they stay visibly marked after the OS text
// selection is gone — the visual counterpart to the store's `selectedBlocks`. Toggles
// a CSS class on the block elements (no editor-state mutation → nothing to serialize
// or undo); re-applies after every reconcile in case Lexical rebuilds a block's DOM.
function SelectionHighlightPlugin({ indices }: { indices?: number[] }) {
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
function SelectPlugin({
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

function SearchHighlightPlugin({ search }: { search?: SearchInput }) {
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

// Block-editing keyboard mode: when inactive, set inputmode="none" on the editor root
// so a tap still focuses + selects a block (the bubble tools show) but the OS keyboard
// stays CLOSED — no focus/blur fight. Active → inputmode="text" so a tap or an explicit
// focus command brings the keyboard up. The RN TextInputs in the bubble/pills are
// separate elements, so this never affects the AI Ask input. (Issue #6.)
function KeyboardModePlugin({ active }: { active: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const apply = () => {
      const root = editor.getRootElement();
      if (root) root.setAttribute("inputmode", active ? "text" : "none");
    };
    apply();
    return editor.registerRootListener(apply);
  }, [editor, active]);
  return null;
}

// Fast sideways fling anywhere over PLAIN text → open the Thesis-Structure drawer
// (issue #4, option C). Detected IN the WebView because only it knows whether the touch
// started on a table/image/chrome band — those own horizontal scroll and are excluded.
// A slow horizontal drag stays as text-select; the fling must be brisk + clearly
// horizontal + toward the drawer's side. Recognised on touchMOVE, so the drawer starts
// sliding under the finger rather than after it lifts — the bridge hop to the native
// side costs enough on its own. Bridges out via onOpen (thresholds are device-tunable).
function DrawerSwipePlugin({ onOpen, rtl }: { onOpen?: () => void; rtl?: boolean }) {
  useEffect(() => {
    if (!onOpen || typeof document === "undefined") return;
    let sx = 0, sy = 0, st = 0, armed = false, fired = false;
    const onStart = (e: TouchEvent) => {
      fired = false;
      if (e.touches.length !== 1) { armed = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
      const el = e.target as HTMLElement | null;
      // Exclude tables / images / chrome bands — they own horizontal scroll (option C).
      armed = !el?.closest?.(".lx-blockpick, table, .lx-chrome, img");
    };
    // Open direction follows the APP language: Arabic (RTL) opens with a right→left
    // flick, fr/en (LTR) with a left→right flick — matching the edge-swipe side.
    const towardOpen = (dx: number) => (rtl ? -dx : dx);
    const fire = () => {
      fired = true;
      armed = false;
      window.getSelection?.()?.removeAllRanges?.(); // a fling isn't a selection
      onOpen();
    };
    // Recognise the fling MID-GESTURE. Waiting for touchend meant the drawer only
    // started moving once the finger lifted — the swipe felt like it took ~200-300ms
    // to do anything. As soon as the travel is unambiguous (past threshold, clearly
    // horizontal, still brisk) we open, so the slide begins under the finger.
    const onMove = (e: TouchEvent) => {
      if (!armed || fired) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      // The reader is scrolling the document — this gesture is not ours.
      if (Math.abs(dy) > 20 && Math.abs(dy) >= Math.abs(dx)) { armed = false; return; }
      const dt = Date.now() - st || 1;
      if (towardOpen(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 400) fire();
    };
    // Fallback for a flick so fast it barely emits touchmove events (unchanged
    // thresholds — this is the original recogniser).
    const onEnd = (e: TouchEvent) => {
      if (!armed || fired) return;
      armed = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      const dt = Date.now() - st || 1;
      const v = Math.abs(dx) / dt; // px per ms
      if (towardOpen(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && v > 0.5 && dt < 400) fire();
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [onOpen, rtl]);
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
        singleLineCache.clear();
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
