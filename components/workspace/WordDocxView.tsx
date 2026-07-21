import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useThemeColors } from "@/hooks/useThemeColors";
import { onThesisDocOp } from "@/stores/thesis-doc-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Pinned CDN builds. docx-preview renders OOXML to Word-like HTML pages (cover,
// borders, tables, images, numbering, headers/footers); jszip is its peer dep.
const JSZIP = "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js";
const DOCX_PREVIEW = "https://unpkg.com/docx-preview@0.3.5/dist/docx-preview.min.js";

export interface DocTapBlock {
  index: number;
  text: string;
}

/**
 * Renders the live .docx with Word-level fidelity inside a WebView (docx-preview).
 * The doc is fetched from its signed `url`; tapping a paragraph/table posts its
 * text back, matched to the nearest engine block `index` (from `blocks`) so the
 * AI composer can target it.
 *
 * The WebView shell loads ONCE. When `url` changes (each confirmed edit bumps the
 * version token), the update is injected as `window.__refresh(url, blocks, sel)`:
 * the page fetches the new bytes, renders them into an OFFSCREEN buffer while the
 * old pages stay visible, then swaps buffers and restores the scroll offset — no
 * reload, no spinner, no lost place. Only an `rtl` flip (rare; content-derived)
 * rebuilds the shell from scratch.
 *
 * On top of that, every optimistic manual edit (thesis-doc-store `mutate`) is
 * ALSO injected immediately as `window.__applyOp(op)`: the page patches the
 * rendered DOM in place (text swap, alignment, delete, move, image insert), so
 * the change is visible the instant it's made — the confirm-time silent refresh
 * then reconciles the exact Word layout (run styling, pagination) underneath.
 */
function WordDocxViewInner({
  url,
  blocks,
  onSelect,
  onLongPress,
  scrollTarget,
  rtl = false,
  thesisId,
  editable = true,
  onEditCommit,
  onSplit,
  onMerge,
  onEditActiveChange,
}: {
  url: string;
  blocks: DocTapBlock[];
  // A normal tap selects/toggles one block; a long-press (≥500ms) starts/extends a
  // multi-selection. The parent decides single-vs-toggle from the store's mode.
  onSelect: (index: number, text: string) => void;
  onLongPress: (index: number, text: string) => void;
  // Scroll request from the outline navigator (and cold deep-links): bring this
  // engine block into view. `nonce` bumps per request so re-tapping the same
  // heading re-scrolls; a request that arrives before the shell is ready is
  // applied once "ready" fires. Applied at most once per nonce, so a shell
  // rebuild (rtl flip) doesn't yank the reader back to the last target.
  scrollTarget?: { index: number; nonce: number } | null;
  // Base page direction. docx-preview renders Arabic runs RTL via bidi, but the
  // block-level layout (indents, justification anchor, header tab stops, table
  // column order) stays LTR unless the container is dir="rtl". True for Arabic
  // theses (detected from content, since the thesis language field is unreliable).
  rtl?: boolean;
  // When set, subscribes to this thesis's optimistic edit ops (thesis-doc-store)
  // and patches the rendered DOM in place for instant feedback.
  thesisId?: string;
  // When false (an AI turn is generating), a tap never enters inline-edit mode.
  editable?: boolean;
  // A live/blur commit of an inline paragraph edit → the parent maps it to an
  // editText op. Text is the paragraph's current plain text.
  onEditCommit?: (index: number, text: string) => void;
  // Enter pressed mid-paragraph: split `index` into `before` (stays) + `after`
  // (new paragraph inserted right after).
  onSplit?: (index: number, before: string, after: string) => void;
  // Backspace at offset 0: merge paragraph `curIndex` into `prevIndex`, with the
  // already-joined text. The parent emits editText(prevIndex, mergedText) then
  // deleteBlocks([curIndex]).
  onMerge?: (prevIndex: number, curIndex: number, mergedText: string) => void;
  // Fired true when a paragraph in the WebView gains an inline caret, false when it
  // blurs — lets the workspace hide the composer while editing.
  onEditActiveChange?: (active: boolean) => void;
}) {
  const colors = useThemeColors();
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The scroll-request nonce we've already applied, so a shell rebuild (which
  // fires "ready" again with the same target) doesn't re-scroll on its own.
  const lastScrollNonceRef = useRef<number | null>(null);
  // Latest scroll request, readable from the stable ready handler / scroll effect.
  const scrollTargetRef = useRef(scrollTarget);
  scrollTargetRef.current = scrollTarget;

  // Selection is read straight from the store here (NOT passed down as a prop) so a
  // tap doesn't re-render the whole workspace screen — only this layer reacts, and
  // it only injects a cheap highlight update into its WebView. Select a primitive
  // (the joined index string) to avoid a fresh-array selector loop; derive the array
  // from it.
  const selKey = useWorkspaceStore((s) => s.selectedBlocks.map((b) => b.index).join(","));
  const selectedIndices = useMemo(() => (selKey ? selKey.split(",").map(Number) : []), [selKey]);

  // Latest props, readable from the stable refresh callback: updates flow into
  // the page via injection, not via rebuilding the WebView source.
  const latestRef = useRef({ url, blocks, selectedIndices, editable });
  latestRef.current = { url, blocks, selectedIndices, editable };

  // The url the page currently shows (or is already fetching) — gates duplicate
  // refresh injections. Injections are only valid once the shell reported ready.
  const shownUrlRef = useRef(url);
  const shellReadyRef = useRef(false);
  // True while a paragraph in the WebView has an active caret. The post-flush
  // silent refresh would re-render the doc and destroy the caret, so we defer it
  // until the edit ends. `pendingRefreshRef` remembers that a refresh was asked
  // for while editing so we can run it on editEnd.
  const isEditingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const refreshRetriesRef = useRef(0);

  // Built once per shell (i.e. per rtl flip — NOT per url change). Embeds the
  // then-current url/blocks/selection for the initial render; builtUrlRef records
  // which url that was so the reset effect below can seed shownUrlRef correctly
  // even if the url moved on between render and effect.
  const builtUrlRef = useRef(url);
  const html = useMemo(() => {
    const { url: u, blocks: b, selectedIndices: s, editable: e } = latestRef.current;
    builtUrlRef.current = u;
    return buildHtml(u, b, s, rtl, e);
  }, [rtl]);

  // A NEW shell (initial mount or rtl flip) loads from scratch: spinner until its
  // first render reports ready, and injections are off until then.
  React.useEffect(() => {
    shellReadyRef.current = false;
    shownUrlRef.current = builtUrlRef.current;
    setLoading(true);
    setError(null);
  }, [html]);

  // Silent in-place refresh: hand the new url (plus the blocks/selection that
  // match those bytes) to the page, which double-buffers the render and swaps.
  const maybeRefresh = useCallback(() => {
    if (isEditingRef.current) { pendingRefreshRef.current = true; return; }
    if (!shellReadyRef.current) return; // the 'ready' handler will call us again
    const { url: u, blocks: b, selectedIndices: s } = latestRef.current;
    if (shownUrlRef.current === u) return;
    shownUrlRef.current = u;
    webRef.current?.injectJavaScript(
      `window.__refresh && window.__refresh(${JSON.stringify(u)}, ${JSON.stringify(b)}, ${JSON.stringify(s)}); true;`,
    );
  }, []);

  React.useEffect(() => {
    maybeRefresh();
  }, [url, maybeRefresh]);

  // Scroll to the requested block. No-op until the shell is ready (the 'ready'
  // handler calls this again) and once per nonce, so a shell rebuild doesn't
  // re-yank the reader. docx-preview has no stable per-block id, so __scrollTo
  // matches by the block's (unique) heading text.
  const maybeScroll = useCallback(() => {
    if (!shellReadyRef.current) return;
    const target = scrollTargetRef.current;
    if (!target || lastScrollNonceRef.current === target.nonce) return;
    lastScrollNonceRef.current = target.nonce;
    webRef.current?.injectJavaScript(
      `window.__scrollTo && window.__scrollTo(${target.index}); true;`,
    );
  }, []);

  // On-demand scroll: fire when a new request arrives while already mounted.
  React.useEffect(() => {
    maybeScroll();
  }, [scrollTarget?.nonce, maybeScroll]);

  // Instant in-place patch: forward each optimistic edit op to the page the
  // moment it's made (the store emits before the network flush). Ops that land
  // before the shell's first render are skipped — that render already fetches
  // fresh state, and the confirm-time refresh reconciles regardless.
  React.useEffect(() => {
    if (!thesisId) return;
    return onThesisDocOp((tid, op) => {
      if (tid !== thesisId || !shellReadyRef.current) return;
      webRef.current?.injectJavaScript(
        `window.__applyOp && window.__applyOp(${JSON.stringify(op)}); true;`,
      );
    });
  }, [thesisId]);

  // Keep the highlight in sync without a refresh when only the selection changes.
  // (`selKey` — the stable primitive that gates this — is derived above.)
  React.useEffect(() => {
    webRef.current?.injectJavaScript(
      `window.__setSelected && window.__setSelected(${JSON.stringify(selectedIndices)}); true;`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // Keep the WebView's edit gate in sync (an AI turn disables inline editing).
  React.useEffect(() => {
    webRef.current?.injectJavaScript(
      `window.__setEditable && window.__setEditable(${editable ? "true" : "false"}); true;`,
    );
    // A turn starting mid-edit must commit + release the caret before the AI edits land.
    if (!editable) {
      webRef.current?.injectJavaScript(`window.__forceCommitEdit && window.__forceCommitEdit(); true;`);
    }
  }, [editable]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "ready") {
        shellReadyRef.current = true;
        setLoading(false);
        // First successful render: apply any pending scroll request now that the
        // doc is fully laid out (so scrollIntoView lands on the heading).
        maybeScroll();
        // The url may have moved on while the shell was still loading.
        maybeRefresh();
      } else if (msg.type === "refreshed") {
        refreshRetriesRef.current = 0;
        // Another edit may have landed mid-refresh — catch up.
        maybeRefresh();
      } else if (msg.type === "refresh-error") {
        // The old render is still on screen (merely stale). Retry a few times
        // (transient network), then wait for the next version bump to try again.
        if (refreshRetriesRef.current < 3) {
          refreshRetriesRef.current++;
          shownUrlRef.current = "";
          setTimeout(maybeRefresh, 3000);
        }
      } else if (msg.type === "error") {
        setLoading(false);
        setError(typeof msg.message === "string" ? msg.message : "render failed");
      } else if ((msg.type === "select" || msg.type === "longpress") && typeof msg.index === "number") {
        const text = typeof msg.text === "string" ? msg.text : "";
        if (msg.type === "longpress") onLongPress(msg.index, text);
        else onSelect(msg.index, text);
      } else if (msg.type === "editStart" && typeof msg.index === "number") {
        isEditingRef.current = true;
        onEditActiveChange?.(true);
      } else if (msg.type === "editEnd") {
        isEditingRef.current = false;
        onEditActiveChange?.(false);
        // Run any refresh suppressed while the caret was active — EXCEPT for a
        // structural editEnd (Enter-split / Backspace-merge): that op's own drain
        // will refresh with correct post-op bytes; refreshing now would fetch stale
        // pre-op bytes and revert the optimistic split/merge.
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          if (!msg.structural) maybeRefresh();
        }
      } else if (msg.type === "editCommit" && typeof msg.index === "number") {
        onEditCommit?.(msg.index, typeof msg.text === "string" ? msg.text : "");
      } else if (msg.type === "split" && typeof msg.index === "number") {
        onSplit?.(
          msg.index,
          typeof msg.before === "string" ? msg.before : "",
          typeof msg.after === "string" ? msg.after : "",
        );
      } else if (
        msg.type === "merge" &&
        typeof msg.prevIndex === "number" &&
        typeof msg.curIndex === "number"
      ) {
        onMerge?.(msg.prevIndex, msg.curIndex, typeof msg.mergedText === "string" ? msg.mergedText : "");
      }
    } catch {
      // ignore malformed bridge messages
    }
  };

  return (
    <View style={styles.fill}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        // The inline HTML runs from an opaque (about:blank) origin, so the in-page
        // fetch of the signed .docx url is cross-origin. Android WebView defaults
        // mixedContentMode to "never", which blocks the cleartext http:// fetch in
        // dev (LAN Supabase) → "Failed to fetch". "always" permits it; a no-op on
        // iOS and in production (https).
        mixedContentMode="always"
        // Let docx-preview own scrolling; bounce off so it feels like a viewer.
        style={styles.fill}
        // Surface hard load failures (rare; CDN/network).
        onError={() => {
          setLoading(false);
          setError("Could not load the document viewer.");
        }}
      />
      {loading ? (
        <View style={[styles.overlay, { backgroundColor: colors.bgSurface }]}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : null}
      {error ? (
        <View style={[styles.overlay, { backgroundColor: colors.bgSurface }]}>
          <Text style={[styles.errText, { color: colors.textSecondary }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Memoized so an unrelated re-render of the workspace screen (e.g. an AI turn
// flipping isGenerating) doesn't reconcile this heavy WebView layer. Selection is
// read from the store internally, so it stays fresh without a prop.
export const WordDocxView = React.memo(WordDocxViewInner);

// The WebView shell: loads docx-preview, fetches the .docx, renders it, wires
// tap + long-press selection, and posts lifecycle/selection messages back to RN.
// Refreshes double-buffer between #bufA/#bufB so the visible pages never blank.
function buildHtml(
  url: string,
  blocks: DocTapBlock[],
  selectedIndices: number[],
  rtl: boolean,
  editable: boolean,
): string {
  const blocksJson = JSON.stringify(blocks);
  const urlJson = JSON.stringify(url);
  const selJson = JSON.stringify(selectedIndices);
  const editableJson = editable ? "true" : "false";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta id="vp" name="viewport" content="width=device-width, initial-scale=1, maximum-scale=3, user-scalable=yes" />
<script src="${JSZIP}"></script>
<script src="${DOCX_PREVIEW}"></script>
<style>
  html, body { margin: 0; padding: 0; background: #e7e7ee; -webkit-text-size-adjust: 100%; }
  /* docx-preview wraps each section/page in .docx-wrapper > section.docx; give it
     the page-on-gray look + shadow, and let it scale to the device width. */
  .docx-wrapper { background: #e7e7ee; padding: 12px 0 32px; display: flex; flex-direction: column; align-items: center; }
  /* RTL theses: set the base direction so block layout (indents, justification
     anchor, header tab stops, table column order) flows right-to-left like Word. */
  .docx-wrapper, #container, section.docx { direction: ${rtl ? "rtl" : "ltr"}; }
  .docx-wrapper > section.docx { box-shadow: 0 1px 6px rgba(0,0,0,0.28); margin-bottom: 14px; background: #fff; }
  /* The doc declares its own page width in pt; scale the wrapper down to fit. */
  #container { transform-origin: top center; }
  /* The offscreen refresh buffer: laid out (docx-preview measures text while
     rendering — display:none would zero those measurements) but never painted,
     and height:0 so it can't extend the scroll area in either direction. */
  .buf-off { visibility: hidden; height: 0; overflow: hidden; }
  .mk-sel { outline: 1.5px solid #9db4f5 !important; outline-offset: 1px; background: rgba(76,110,245,0.05) !important; }
  .mk-editing { outline: 2px solid #4c6ef5 !important; outline-offset: 1px; background: #fff !important; caret-color: #1a1a1a; }
  .mk-tap { cursor: pointer; }
</style>
</head>
<body${rtl ? ' dir="rtl"' : ""}>
<div id="container"><div id="bufA"></div><div id="bufB" class="buf-off"></div></div>
<script>
  var RN = window.ReactNativeWebView;
  var EDITABLE = ${editableJson};
  function post(o){ try { RN && RN.postMessage(JSON.stringify(o)); } catch(e){} }
  var norm = function(s){ return (s||"").replace(/\\s+/g," ").trim(); };

  // Block model for tap matching. Replaced on every refresh so the texts always
  // describe the bytes on screen (never the optimistic in-memory preview).
  var BLOCKS = [], NB = [];
  function setBlocks(blocks){
    BLOCKS = blocks || [];
    NB = BLOCKS.map(function(b){ return { index: b.index, n: norm(b.text) }; }).filter(function(b){ return b.n.length > 0; });
  }
  setBlocks(${blocksJson});

  // Double buffer: the active div holds the visible render; a refresh renders
  // into the other one offscreen, then the two swap roles.
  var bufA = document.getElementById('bufA');
  var bufB = document.getElementById('bufB');
  var activeBuf = bufA;

  function matchIndex(text){
    var n = norm(text);
    if (!n) return null;
    // 1) exact normalized equality
    for (var i=0;i<NB.length;i++){ if (NB[i].n === n) return NB[i].index; }
    // 2) block contains the tapped text (tapped a sub-run) or vice-versa
    for (var j=0;j<NB.length;j++){ if (NB[j].n.indexOf(n) === 0 || n.indexOf(NB[j].n) === 0) return NB[j].index; }
    for (var k=0;k<NB.length;k++){ if (NB[k].n.indexOf(n) >= 0) return NB[k].index; }
    return null;
  }

  // Multi-highlight: track every highlighted element so a new selection set can
  // clear the old ones. Accepts an array of block indices (or, for back-compat, a
  // scalar / null). Highlights every rendered p/table whose normalized text matches
  // a selected block's text. Scoped to the ACTIVE buffer so a mid-refresh call
  // can't spend its budget on invisible offscreen duplicates.
  var selectedEls = [];
  function clearHighlights(){
    for (var i=0;i<selectedEls.length;i++){ selectedEls[i].classList.remove('mk-sel'); }
    selectedEls = [];
  }
  window.__setSelected = function(indices){
    window.__SOLE_SEL = (indices && typeof indices !== 'number' && indices.length === 1) ? indices[0] : (typeof indices === 'number' ? indices : null);
    clearHighlights();
    if (indices == null) return;
    var arr = (typeof indices === 'number') ? [indices] : indices;
    if (!arr || !arr.length) return;
    // Match by text (docx-preview gives no stable per-block id). To avoid lighting
    // up EVERY duplicate paragraph when only some are selected, budget by COUNT:
    // for a text selected N times, highlight only the first N elements (in DOM
    // order) carrying that text — so the highlight count tracks the selection.
    var budget = {};
    for (var i=0;i<BLOCKS.length;i++){
      if (arr.indexOf(BLOCKS[i].index) >= 0){ var w = norm(BLOCKS[i].text); if (w) budget[w] = (budget[w] || 0) + 1; }
    }
    var els = activeBuf.querySelectorAll('p, table');
    for (var j=0;j<els.length;j++){
      var t = norm(els[j].innerText);
      if (budget[t] > 0){ els[j].classList.add('mk-sel'); selectedEls.push(els[j]); budget[t]--; }
    }
  };

  // Deep-link scroll: bring the first element carrying a given block's text into
  // view. docx-preview exposes no stable per-block id, so we match by normalized
  // text (headings are unique, so this lands correctly). Re-asserts across the
  // late fitWidth() reflows so the final resting position is the target.
  window.__scrollTo = function(index){
    var want = null;
    for (var i=0;i<BLOCKS.length;i++){ if (BLOCKS[i].index === index){ want = norm(BLOCKS[i].text); break; } }
    if (!want) return;
    function findEl(){
      var els = activeBuf.querySelectorAll('p, table');
      for (var j=0;j<els.length;j++){ if (norm(els[j].innerText) === want) return els[j]; }
      for (var k=0;k<els.length;k++){ if (norm(els[k].innerText).indexOf(want) >= 0) return els[k]; }
      return null;
    }
    function go(){
      var el = findEl();
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -12); // a little breathing room above the heading
    }
    go(); setTimeout(go, 200); setTimeout(go, 600);
  };

  function blockEl(node){
    // Walk up to the nearest paragraph/table rendered by docx-preview.
    var el = node;
    while (el && el !== document.body){
      var tag = el.tagName;
      if (tag === 'P' || tag === 'TABLE') return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── Instant in-place op patches ────────────────────────────────────────────
  // Mirror of the app's optimistic applyOpToBlocks, applied to the LIVE DOM so
  // an edit is visible immediately. Best-effort: anything that can't be matched
  // (empty-text blocks, exotic layout) simply waits for the silent refresh,
  // which replaces the whole render with server truth anyway.

  // Find the rendered element for a block index. Same text-matching rules as
  // __setSelected, made deterministic for duplicates by RANK: the block's rank
  // among same-text blocks picks the rank-th matching element in DOM order.
  // "strict" (delete/move) forbids the loose containment fallback — for
  // destructive patches a wrong match is worse than a no-op.
  function elForIndex(index, strict){
    var want = null;
    for (var i=0;i<BLOCKS.length;i++){ if (BLOCKS[i].index === index){ want = norm(BLOCKS[i].text); break; } }
    if (!want) return null; // unknown index or empty-text block — unmatchable
    var rank = 0;
    for (var j=0;j<BLOCKS.length;j++){
      if (BLOCKS[j].index === index) break;
      if (norm(BLOCKS[j].text) === want) rank++;
    }
    var els = activeBuf.querySelectorAll('p, table');
    var seen = 0;
    for (var k=0;k<els.length;k++){
      if (norm(els[k].innerText) === want){ if (seen === rank) return els[k]; seen++; }
    }
    if (strict) return null;
    for (var m=0;m<els.length;m++){ if (norm(els[m].innerText).indexOf(want) >= 0) return els[m]; }
    return null;
  }

  // Pour the new text into the paragraph's first non-empty run span so the
  // dominant run styling (heading font, bold) survives; empty the other runs.
  // (Any lost per-run mixed styling is restored by the next silent refresh.)
  function setBlockText(el, text){
    var spans = Array.prototype.slice.call(el.getElementsByTagName('span'));
    var target = null;
    for (var i=0;i<spans.length;i++){ if ((spans[i].textContent || "").trim()){ target = spans[i]; break; } }
    if (!target && spans.length) target = spans[0];
    if (target){
      for (var j=0;j<spans.length;j++){ if (spans[j] !== target) spans[j].textContent = ''; }
      target.textContent = text;
    } else {
      el.textContent = text;
    }
  }

  // BLOCKS-list mirrors of the structural ops (indices are positional, so they
  // shift exactly like the app's applyOpToBlocks). Keeping BLOCKS in step with
  // the patched DOM keeps tap→index matching correct between refreshes.
  function pbEditText(index, text){
    for (var i=0;i<BLOCKS.length;i++){ if (BLOCKS[i].index === index){ BLOCKS[i] = { index: index, text: text }; break; } }
    setBlocks(BLOCKS);
  }
  function pbDelete(indices){
    var out = [];
    for (var i=0;i<BLOCKS.length;i++){
      var idx = BLOCKS[i].index;
      if (indices.indexOf(idx) >= 0) continue;
      var shift = 0;
      for (var j=0;j<indices.length;j++){ if (indices[j] < idx) shift++; }
      out.push({ index: idx - shift, text: BLOCKS[i].text });
    }
    setBlocks(out);
  }
  function pbMove(from, to){
    if (from === to) return;
    var out = BLOCKS.map(function(b){
      var i = b.index, ni;
      if (i === from) ni = to;
      else if (from < to) ni = (i > from && i <= to) ? i - 1 : i;
      else ni = (i >= to && i < from) ? i + 1 : i;
      return { index: ni, text: b.text };
    });
    out.sort(function(a,b){ return a.index - b.index; });
    setBlocks(out);
  }
  function pbInsertAfter(afterIndex){
    var at = Math.min(Math.max(afterIndex + 1, 0), BLOCKS.length);
    var out = BLOCKS.map(function(b){ return { index: b.index >= at ? b.index + 1 : b.index, text: b.text }; });
    out.push({ index: at, text: "" });
    out.sort(function(a,b){ return a.index - b.index; });
    setBlocks(out);
  }
  // BLOCKS-mirror of a paragraph split: block \`index\` keeps \`before\`, a new block
  // holding \`after\` is inserted right after it, later blocks shift +1. Keeps the
  // tap→index model in step (the DOM split is done in the Enter handler).
  function pbSplit(index, before, after){
    var at = index + 1;
    var out = BLOCKS.map(function(b){
      if (b.index === index) return { index: index, text: before };
      return { index: b.index >= at ? b.index + 1 : b.index, text: b.text };
    });
    out.push({ index: at, text: after });
    out.sort(function(a,b){ return a.index - b.index; });
    setBlocks(out);
  }

  function applyOpNow(op){
    try {
      if (op.type === 'editText'){
        if (op.index !== editingIndex){
          var el = elForIndex(op.index, false);
          if (el && el.tagName === 'P') setBlockText(el, op.text);
        }
        pbEditText(op.index, op.text);
      } else if (op.type === 'format'){
        var ch = op.changes || {};
        for (var f=0;f<op.indices.length;f++){
          var fel = elForIndex(op.indices[f], false);
          if (!fel) continue;
          if (ch.alignment != null) fel.style.textAlign = ch.alignment;
          if (ch.direction != null) fel.style.direction = ch.direction;
          // level / clearFormatting swap docx styles (fonts, spacing) — left to
          // the silent refresh; mimicking the style cascade here isn't worth it.
        }
        // text unchanged → BLOCKS unchanged
      } else if (op.type === 'move'){
        var mel = elForIndex(op.from, true);
        var tel = elForIndex(op.to, true);
        if (mel && tel && mel !== tel && tel.parentNode){
          // Splice semantics: moving down lands AFTER the block currently at
          // "to"; moving up lands BEFORE it. Cross-page moves visually stretch
          // a page until the refresh repaginates — acceptable transient.
          if (op.from < op.to) tel.parentNode.insertBefore(mel, tel.nextSibling);
          else tel.parentNode.insertBefore(mel, tel);
        }
        pbMove(op.from, op.to);
      } else if (op.type === 'deleteBlocks'){
        // Resolve EVERY element before removing any: rank-based duplicate
        // matching counts still-present same-text blocks, so removing one first
        // would skew the ranks of the rest.
        var dels = [];
        for (var d=0;d<op.indices.length;d++) dels.push(elForIndex(op.indices[d], true));
        for (var e=0;e<dels.length;e++){ if (dels[e] && dels[e].parentNode) dels[e].parentNode.removeChild(dels[e]); }
        pbDelete(op.indices);
      } else if (op.type === 'insertImage'){
        var anchor = elForIndex(op.afterIndex, false);
        if (anchor && anchor.parentNode){
          var wrap = document.createElement('p');
          wrap.className = 'mk-tap';
          wrap.style.textAlign = 'center';
          var img = document.createElement('img');
          img.src = 'data:image/' + op.format + ';base64,' + op.data;
          img.style.maxWidth = '100%';
          wrap.appendChild(img);
          anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
        }
        pbInsertAfter(op.afterIndex);
      } else if (op.type === 'splitParagraph'){
        // The Enter handler already split the DOM; only sync the BLOCKS model.
        pbSplit(op.index, op.before, op.after);
      }
      // startOnNewPage: pagination-only — nothing to patch; the refresh shows it.
    } catch(err){}
  }

  // Ops applied while a refresh render is in flight went into the OLD buffer;
  // remember them so the swap can re-apply them to the new one. (Safe from
  // double-apply: the in-flight fetch started before these ops existed, so its
  // bytes can never already contain them.)
  var opsDuringRefresh = [];
  window.__applyOp = function(op){
    if (!op || !op.type) return;
    if (refreshing) opsDuringRefresh.push(op);
    applyOpNow(op);
  };

  // Tap/long-press listeners live ONCE on the stable outer container (delegation
  // via blockEl), so they survive buffer swaps; only the .mk-tap cursor class is
  // re-applied per render.
  // ── Inline caret editing ───────────────────────────────────────────────────
  // Second tap on the already-sole-selected paragraph turns it into a native
  // contentEditable field (caret + keyboard). Commit/guards land in the
  // debounce + applyOp guards below.
  var editingIndex = null;      // block index being edited, or null
  var editBaseline = null;      // normalized text at edit-start (detect real changes)
  var commitTimer = null;
  var suppressEditEndRefresh = false; // set by Enter-split / Backspace-merge
  var lastTapX = 0, lastTapY = 0; // last touch point, for caret placement on edit-enter

  window.__setEditable = function(v){ EDITABLE = !!v; };

  function placeCaretFromPoint(x, y){
    try {
      if (document.caretRangeFromPoint){
        var r = document.caretRangeFromPoint(x, y);
        if (r){ var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      }
    } catch(e){}
  }

  function caretAtStart(el){
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    var caret = sel.getRangeAt(0);
    var head = document.createRange();
    head.selectNodeContents(el);
    head.setEnd(caret.startContainer, caret.startOffset);
    var frag = head.cloneContents();
    // True paragraph start = nothing before the caret: no text AND no <br>.
    return (frag.textContent || "").length === 0 && !frag.querySelector('br');
  }

  function enterEdit(el, index){
    if (!EDITABLE || !el || el.tagName !== 'P' || editingIndex != null) return false;
    editingIndex = index;
    editBaseline = norm(el.innerText);
    el.setAttribute('contenteditable', 'true');
    el.classList.add('mk-editing');
    el.focus();
    placeCaretFromPoint(lastTapX, lastTapY);
    el.addEventListener('input', onEditInput);
    el.addEventListener('keydown', onEditKeydown);
    el.addEventListener('blur', onEditBlur);
    post({ type: 'editStart', index: index });
    return true;
  }

  function commitEdit(el){
    if (editingIndex == null || !el) return;
    var text = el.innerText;
    if (norm(text) === editBaseline) return;   // no real change → no op
    editBaseline = norm(text);
    post({ type: 'editCommit', index: editingIndex, text: text });
  }

  function onEditInput(ev){
    if (commitTimer) clearTimeout(commitTimer);
    var el = ev.currentTarget;
    commitTimer = setTimeout(function(){ commitTimer = null; commitEdit(el); }, 900);
  }

  function onEditKeydown(ev){
    var el = ev.currentTarget;
    if (ev.key === 'Enter'){
      ev.preventDefault();
      var idx = editingIndex;
      if (commitTimer){ clearTimeout(commitTimer); commitTimer = null; }
      // DOM-accurate split: move everything after the caret into a new sibling
      // paragraph (a shallow clone of this <p>, so it keeps the same style/attrs).
      var sel = window.getSelection();
      var caret = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
      var clone = el.cloneNode(false);
      if (caret && el.lastChild){
        var tail = document.createRange();
        tail.setStart(caret.endContainer, caret.endOffset);
        tail.setEndAfter(el.lastChild);
        clone.appendChild(tail.extractContents());
      }
      clone.classList.remove('mk-editing');
      clone.removeAttribute('contenteditable');
      if (el.parentNode) el.parentNode.insertBefore(clone, el.nextSibling);
      var before = el.innerText, after = clone.innerText;
      // End editing on the old paragraph (no redundant editCommit — the split op is
      // authoritative for \`before\`), then dispatch the split.
      editBaseline = norm(el.innerText);
      suppressEditEndRefresh = true;
      onEditBlur({ currentTarget: el });
      post({ type: 'split', index: idx, before: before, after: after });
      return;
    }
    if (ev.key === 'Backspace' && caretAtStart(el)){
      handleBackspaceMerge(ev, el);
    }
  }

  // Backspace at offset 0: merge this paragraph into the previous one. Uses the
  // parent's onMerge (editText(prev, merged) + deleteBlocks([cur])) — no new op.
  function handleBackspaceMerge(ev, el){
    var prev = el.previousElementSibling;
    while (prev && prev.tagName !== 'P') prev = prev.previousElementSibling;
    if (!prev) return; // first paragraph — nothing to merge into
    var prevIdx = matchIndex(prev.innerText || "");
    var curIdx = editingIndex;
    if (prevIdx == null || curIdx == null || prevIdx !== curIdx - 1) return;
    ev.preventDefault();
    if (commitTimer){ clearTimeout(commitTimer); commitTimer = null; }
    var mergedText = (prev.innerText || "") + (el.innerText || "");
    setBlockText(prev, mergedText);          // optimistic DOM merge
    editBaseline = norm(el.innerText);
    suppressEditEndRefresh = true;
    onEditBlur({ currentTarget: el });        // end edit (no redundant editCommit)
    if (el.parentNode) el.parentNode.removeChild(el);
    post({ type: 'merge', prevIndex: prevIdx, curIndex: curIdx, mergedText: mergedText });
  }

  function onEditBlur(ev){
    var el = ev.currentTarget;
    if (commitTimer){ clearTimeout(commitTimer); commitTimer = null; }
    commitEdit(el);
    el.removeAttribute('contenteditable');
    el.classList.remove('mk-editing');
    el.removeEventListener('input', onEditInput);
    el.removeEventListener('keydown', onEditKeydown);
    el.removeEventListener('blur', onEditBlur);
    var idx = editingIndex;
    editingIndex = null; editBaseline = null;
    post({ type: 'editEnd', index: idx, structural: suppressEditEndRefresh });
    suppressEditEndRefresh = false;
    if (editPendingRefresh){ var _epr = editPendingRefresh; editPendingRefresh = null; window.__refresh(_epr[0], _epr[1], _epr[2]); }
  }

  window.__forceCommitEdit = function(){
    if (editingIndex == null) return;
    var el = activeBuf.querySelector('.mk-editing');
    if (el) el.blur();          // triggers onEditBlur → commit + editEnd
  };

  function wireContainerEvents(){
    var container = document.getElementById('container');
    // Touch-timing long-press: WebView delivers no native onLongPress, so we time
    // touchstart→touchend ourselves. ≥500ms with no scroll = long-press (extend the
    // multi-selection); a quick tap = select. RN applies the single-vs-toggle rule.
    var timer = null, startEl = null, moved = false, longFired = false, lastTouchEnd = 0;
    function clearTimer(){ if (timer){ clearTimeout(timer); timer = null; } }
    function report(el, kind){
      if (!el) return;
      var text = el.innerText || "";
      var idx = matchIndex(text);
      if (idx == null) return;
      post({ type: kind, index: idx, text: norm(text).slice(0, 600) });
    }
    container.addEventListener('touchstart', function(ev){
      startEl = blockEl(ev.target); moved = false; longFired = false;
      var _t = ev.touches && ev.touches[0]; lastTapX = _t ? _t.clientX : 0; lastTapY = _t ? _t.clientY : 0;
      clearTimer();
      if (!startEl) return;
      if (editingIndex != null) return; // caret active — don't arm long-press/multi-select
      timer = setTimeout(function(){ longFired = true; report(startEl, 'longpress'); }, 500);
    }, { passive: true });
    container.addEventListener('touchmove', function(){ moved = true; clearTimer(); }, { passive: true });
    container.addEventListener('touchend', function(){
      lastTouchEnd = Date.now();
      clearTimer();
      if (longFired){ longFired = false; return; } // already handled as a long-press
      if (moved) return; // a scroll, not a tap
      if (startEl && startEl.tagName === 'P' && editingIndex == null &&
          window.__SOLE_SEL != null && matchIndex(startEl.innerText || "") === window.__SOLE_SEL){
        if (enterEdit(startEl, window.__SOLE_SEL)) return;
      }
      if (editingIndex != null) return; // taps inside the caret field are native
      report(startEl, 'select');
    }, { passive: true });
    // Fallback for environments that fire click without touch; guard against the
    // synthetic click that trails a real touch so we don't double-handle it.
    container.addEventListener('click', function(ev){
      if (editingIndex != null) return;
      if (Date.now() - lastTouchEnd < 700) return;
      report(blockEl(ev.target), 'select');
    }, true);
  }

  function markTappable(buf){
    var ps = buf.querySelectorAll('p, table');
    for (var i=0;i<ps.length;i++) ps[i].classList.add('mk-tap');
  }

  function fitWidth(){
    // Fixed-width Word pages (A4 ≈ 794px) overflow a phone screen. Fit by setting
    // the LAYOUT viewport to the page width + a uniform gutter, so the browser
    // scales the whole page down to the device width — crisp text, no horizontal
    // scroll, and EVERY document renders identically as a framed page-on-gray
    // (we base this on the page box, not scrollWidth, which varied between docs and
    // made some fill edge-to-edge while others floated). Genuinely wide content
    // (rare oversized tables/images) is reachable via pinch-zoom (user-scalable).
    // Measures the ACTIVE buffer only.
    var pageW = 0;
    var secs = activeBuf.querySelectorAll('section.docx');
    for (var i=0;i<secs.length;i++){ pageW = Math.max(pageW, Math.ceil(secs[i].getBoundingClientRect().width)); }
    if (pageW <= 0) return;
    var GUTTER = 24; // ~12px of gray frame on each side, for every document
    var target = pageW + GUTTER;
    var avail = document.documentElement.clientWidth;
    if (target > avail + 1){
      var vp = document.getElementById('vp');
      if (vp) vp.setAttribute('content', 'width=' + target + ', maximum-scale=3, user-scalable=yes');
    }
  }

  var RENDER_OPTS = {
    className: 'docx', inWrapper: true, breakPages: true,
    ignoreLastRenderedPageBreak: false, experimental: true,
    renderHeaders: true, renderFooters: true, useBase64URL: true,
  };
  function fetchDocx(url){
    return fetch(url).then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.blob(); });
  }

  function render(){
    if (!window.docx){ post({ type:'error', message:'viewer script failed to load' }); return; }
    fetchDocx(${urlJson})
      .then(function(blob){ return window.docx.renderAsync(blob, activeBuf, null, RENDER_OPTS); })
      .then(function(){
        wireContainerEvents(); markTappable(activeBuf); fitWidth();
        window.__setSelected(${selJson}); post({ type:'ready' });
        // Re-fit after late-loading images/fonts reflow the pages (the widest page
        // can grow once base64 images decode), so the page still fits the screen.
        setTimeout(fitWidth, 150); setTimeout(fitWidth, 500);
      })
      .catch(function(e){ post({ type:'error', message: String(e && e.message || e) }); });
  }

  // Silent refresh: fetch the new bytes and render them OFFSCREEN while the old
  // pages stay on screen, then swap buffers and restore the scroll offset — the
  // reader never sees a blank/reloading view. Overlapping calls chain: the newest
  // args run after the in-flight render finishes (older pendings are superseded).
  var refreshing = false, pendingRefresh = null, editPendingRefresh = null;
  window.__refresh = function(url, blocks, sel){
    if (editingIndex != null){ editPendingRefresh = [url, blocks, sel]; return; } // replay after editEnd
    if (refreshing){ pendingRefresh = [url, blocks, sel]; return; }
    refreshing = true;
    var back = activeBuf === bufA ? bufB : bufA;
    fetchDocx(url)
      .then(function(blob){ back.innerHTML = ''; return window.docx.renderAsync(blob, back, null, RENDER_OPTS); })
      .then(function(){
        if (editingIndex != null){ editPendingRefresh = [url, blocks, sel]; return; } // caret appeared mid-refresh — defer the swap
        if (blocks) setBlocks(blocks);
        clearHighlights(); // they point into the buffer we're about to retire
        var y = window.scrollY || 0;
        var front = activeBuf;
        activeBuf = back;
        back.classList.remove('buf-off');
        front.classList.add('buf-off');
        front.innerHTML = ''; // free the old render (and its injected styles)
        // Edits made while this render was in flight only patched the retired
        // buffer — re-apply them to the fresh one (its bytes predate them).
        var replay = opsDuringRefresh; opsDuringRefresh = [];
        for (var r=0;r<replay.length;r++) applyOpNow(replay[r]);
        markTappable(activeBuf);
        fitWidth();
        window.scrollTo(0, y);
        if (sel) window.__setSelected(sel);
        post({ type:'refreshed' });
        setTimeout(fitWidth, 150); setTimeout(fitWidth, 500);
      })
      .catch(function(e){
        // The active buffer already shows these ops (applyOpNow patched it
        // directly); replaying them onto a LATER refresh could double-apply,
        // so the queue dies with the failed render.
        opsDuringRefresh = [];
        post({ type:'refresh-error', message: String(e && e.message || e) });
      })
      .then(function(){
        refreshing = false;
        if (pendingRefresh){ var a = pendingRefresh; pendingRefresh = null; window.__refresh(a[0], a[1], a[2]); }
      });
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') render();
  else window.addEventListener('DOMContentLoaded', render);
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  errText: { fontSize: 14, fontFamily: "Inter_400Regular", paddingHorizontal: 32, textAlign: "center" },
});
