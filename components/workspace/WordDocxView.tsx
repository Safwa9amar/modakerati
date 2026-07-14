import React, { useMemo, useRef, useState } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useThemeColors } from "@/hooks/useThemeColors";

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
 * AI composer can target it. Re-rendering happens whenever `url` changes (initial
 * load + after each AI turn) — the whole shell reloads, CDN scripts stay cached.
 */
export function WordDocxView({
  url,
  blocks,
  onSelect,
  onLongPress,
  selectedIndices,
  scrollToIndex,
  rtl = false,
}: {
  url: string;
  blocks: DocTapBlock[];
  // A normal tap selects/toggles one block; a long-press (≥500ms) starts/extends a
  // multi-selection. The parent decides single-vs-toggle from the store's mode.
  onSelect: (index: number, text: string) => void;
  onLongPress: (index: number, text: string) => void;
  // Every currently-selected engine block index (0, 1, or many). Drives multi-highlight.
  selectedIndices: number[];
  // Deep-link target: on first render, scroll this engine block into view (e.g.
  // when opened from the detail screen's outline). Fired ONCE per value so an
  // AI-turn reload doesn't yank the reader back to the originally-linked heading.
  scrollToIndex?: number;
  // Base page direction. docx-preview renders Arabic runs RTL via bidi, but the
  // block-level layout (indents, justification anchor, header tab stops, table
  // column order) stays LTR unless the container is dir="rtl". True for Arabic
  // theses (detected from content, since the thesis language field is unreliable).
  rtl?: boolean;
}) {
  const colors = useThemeColors();
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The block index we've already scrolled to, so a post-edit reload (which fires
  // "ready" again with the same target) doesn't re-scroll.
  const scrolledToRef = useRef<number | null>(null);

  // Rebuilds (and reloads the WebView) only when the doc bytes change — i.e. when
  // the signed url changes. blocks ride along for tap→index matching.
  const html = useMemo(
    () => buildHtml(url, blocks, selectedIndices, rtl),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, rtl],
  );

  // Stable key for the selection set so the highlight effect runs only when the
  // set of indices actually changes (a fresh array ref every render otherwise).
  const selKey = selectedIndices.join(",");

  // Keep the highlight in sync without a full reload when only the selection changes.
  React.useEffect(() => {
    webRef.current?.injectJavaScript(
      `window.__setSelected && window.__setSelected(${JSON.stringify(selectedIndices)}); true;`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // A url change means new html → spinner until the new render reports ready.
  React.useEffect(() => {
    setLoading(true);
    setError(null);
  }, [url]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "ready") {
        setLoading(false);
        // First successful render: honour the deep-link scroll target once (the
        // doc is fully laid out here, so scrollIntoView lands on the heading).
        if (
          typeof scrollToIndex === "number" &&
          Number.isFinite(scrollToIndex) &&
          scrolledToRef.current !== scrollToIndex
        ) {
          scrolledToRef.current = scrollToIndex;
          webRef.current?.injectJavaScript(
            `window.__scrollTo && window.__scrollTo(${scrollToIndex}); true;`,
          );
        }
      } else if (msg.type === "error") {
        setLoading(false);
        setError(typeof msg.message === "string" ? msg.message : "render failed");
      } else if ((msg.type === "select" || msg.type === "longpress") && typeof msg.index === "number") {
        const text = typeof msg.text === "string" ? msg.text : "";
        if (msg.type === "longpress") onLongPress(msg.index, text);
        else onSelect(msg.index, text);
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

// The WebView shell: loads docx-preview, fetches the .docx, renders it, wires
// tap + long-press selection, and posts lifecycle/selection messages back to RN.
function buildHtml(url: string, blocks: DocTapBlock[], selectedIndices: number[], rtl: boolean): string {
  const blocksJson = JSON.stringify(blocks);
  const urlJson = JSON.stringify(url);
  const selJson = JSON.stringify(selectedIndices);
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
  .mk-sel { outline: 2px solid #4c6ef5 !important; outline-offset: 1px; background: rgba(76,110,245,0.08) !important; }
  .mk-tap { cursor: pointer; }
</style>
</head>
<body${rtl ? ' dir="rtl"' : ""}>
<div id="container"></div>
<script>
  var RN = window.ReactNativeWebView;
  function post(o){ try { RN && RN.postMessage(JSON.stringify(o)); } catch(e){} }
  var BLOCKS = ${blocksJson};
  var norm = function(s){ return (s||"").replace(/\\s+/g," ").trim(); };
  // Precompute normalized block texts for tap matching.
  var NB = BLOCKS.map(function(b){ return { index: b.index, n: norm(b.text) }; }).filter(function(b){ return b.n.length > 0; });

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
  // a selected block's text.
  var selectedEls = [];
  function clearHighlights(){
    for (var i=0;i<selectedEls.length;i++){ selectedEls[i].classList.remove('mk-sel'); }
    selectedEls = [];
  }
  window.__setSelected = function(indices){
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
    var els = document.querySelectorAll('#container p, #container table');
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
      var els = document.querySelectorAll('#container p, #container table');
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

  function wireTaps(){
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
      clearTimer();
      if (!startEl) return;
      timer = setTimeout(function(){ longFired = true; report(startEl, 'longpress'); }, 500);
    }, { passive: true });
    container.addEventListener('touchmove', function(){ moved = true; clearTimer(); }, { passive: true });
    container.addEventListener('touchend', function(){
      lastTouchEnd = Date.now();
      clearTimer();
      if (longFired){ longFired = false; return; } // already handled as a long-press
      if (moved) return; // a scroll, not a tap
      report(startEl, 'select');
    }, { passive: true });
    // Fallback for environments that fire click without touch; guard against the
    // synthetic click that trails a real touch so we don't double-handle it.
    container.addEventListener('click', function(ev){
      if (Date.now() - lastTouchEnd < 700) return;
      report(blockEl(ev.target), 'select');
    }, true);
    var ps = container.querySelectorAll('p, table');
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
    var pageW = 0;
    var secs = document.querySelectorAll('#container section.docx');
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

  function render(){
    if (!window.docx){ post({ type:'error', message:'viewer script failed to load' }); return; }
    var container = document.getElementById('container');
    fetch(${urlJson})
      .then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.blob(); })
      .then(function(blob){
        return window.docx.renderAsync(blob, container, null, {
          className: 'docx', inWrapper: true, breakPages: true,
          ignoreLastRenderedPageBreak: false, experimental: true,
          renderHeaders: true, renderFooters: true, useBase64URL: true,
        });
      })
      .then(function(){
        wireTaps(); fitWidth(); window.__setSelected(${selJson}); post({ type:'ready' });
        // Re-fit after late-loading images/fonts reflow the pages (the widest page
        // can grow once base64 images decode), so the page still fits the screen.
        setTimeout(fitWidth, 150); setTimeout(fitWidth, 500);
      })
      .catch(function(e){ post({ type:'error', message: String(e && e.message || e) }); });
  }

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
