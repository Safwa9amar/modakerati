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
  selectedIndex,
  rtl = false,
}: {
  url: string;
  blocks: DocTapBlock[];
  onSelect: (index: number, text: string) => void;
  selectedIndex: number | null;
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

  // Rebuilds (and reloads the WebView) only when the doc bytes change — i.e. when
  // the signed url changes. blocks ride along for tap→index matching.
  const html = useMemo(
    () => buildHtml(url, blocks, selectedIndex, rtl),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, rtl],
  );

  // Keep the highlight in sync without a full reload when only the selection changes.
  React.useEffect(() => {
    webRef.current?.injectJavaScript(
      `window.__setSelected && window.__setSelected(${selectedIndex == null ? "null" : selectedIndex}); true;`,
    );
  }, [selectedIndex]);

  // A url change means new html → spinner until the new render reports ready.
  React.useEffect(() => {
    setLoading(true);
    setError(null);
  }, [url]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "ready") setLoading(false);
      else if (msg.type === "error") {
        setLoading(false);
        setError(typeof msg.message === "string" ? msg.message : "render failed");
      } else if (msg.type === "select" && typeof msg.index === "number") {
        onSelect(msg.index, typeof msg.text === "string" ? msg.text : "");
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
// tap-to-select, and posts lifecycle/selection messages back to RN.
function buildHtml(url: string, blocks: DocTapBlock[], selectedIndex: number | null, rtl: boolean): string {
  const blocksJson = JSON.stringify(blocks);
  const urlJson = JSON.stringify(url);
  const selJson = selectedIndex == null ? "null" : String(selectedIndex);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=3, user-scalable=yes" />
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

  var selectedEl = null;
  window.__setSelected = function(idx){
    if (selectedEl){ selectedEl.classList.remove('mk-sel'); selectedEl = null; }
    if (idx == null) return;
    // best effort: highlight the block whose text matches BLOCKS[idx]
    var target = null; var want = null;
    for (var i=0;i<BLOCKS.length;i++){ if (BLOCKS[i].index === idx){ want = norm(BLOCKS[i].text); break; } }
    if (want){
      var els = document.querySelectorAll('#container p, #container table');
      for (var j=0;j<els.length;j++){ if (norm(els[j].innerText) === want){ target = els[j]; break; } }
    }
    if (target){ target.classList.add('mk-sel'); selectedEl = target; }
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
    container.addEventListener('click', function(ev){
      var el = blockEl(ev.target);
      if (!el) return;
      var text = el.innerText || "";
      var idx = matchIndex(text);
      if (idx == null) return;
      if (selectedEl) selectedEl.classList.remove('mk-sel');
      el.classList.add('mk-sel'); selectedEl = el;
      post({ type:'select', index: idx, text: norm(text).slice(0, 600) });
    }, true);
    var ps = container.querySelectorAll('p, table');
    for (var i=0;i<ps.length;i++) ps[i].classList.add('mk-tap');
  }

  function fitWidth(){
    // Scale the rendered page down so its pt-width fits the device width.
    var sec = document.querySelector('#container section.docx');
    if (!sec) return;
    var pageW = sec.getBoundingClientRect().width;
    var avail = document.documentElement.clientWidth;
    if (pageW > 0 && pageW > avail){
      var scale = avail / pageW;
      var c = document.getElementById('container');
      c.style.transform = 'scale(' + scale + ')';
      // Compensate height so the page doesn't leave a huge gap after scaling.
      c.style.height = (c.scrollHeight * scale) + 'px';
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
      .then(function(){ wireTaps(); fitWidth(); window.__setSelected(${selJson}); post({ type:'ready' }); })
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
