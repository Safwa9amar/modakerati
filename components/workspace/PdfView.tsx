import React, { useMemo, useRef, useState } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useThemeColors } from "@/hooks/useThemeColors";

// Pinned CDN build of PDF.js (UMD, v3 — v4+ is ESM-only and awkward in a raw
// WebView). The worker is loaded from the same version. Cached after first load.
const PDFJS = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js";
const PDFJS_WORKER = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

/**
 * Renders a thesis PDF (the OnlyOffice-converted .docx) inside a WebView using
 * PDF.js. The PDF is fetched from its signed `url`; pages are rendered lazily as
 * they scroll into view (an IntersectionObserver) so a long memoir doesn't blow
 * the WebView's memory. Read-only — no tap-to-target (the PDF is a deliverable
 * preview, the composer still targets blocks via the docx/outline views).
 *
 * Re-renders (and reloads the WebView) whenever `url` changes — i.e. on the
 * initial load and after each AI turn, when a fresh PDF is converted.
 */
function PdfViewInner({ url }: { url: string }) {
  const colors = useThemeColors();
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const html = useMemo(() => buildHtml(url), [url]);

  // A new url means new html → spinner until the first page reports ready.
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
        // fetch of the signed PDF url is cross-origin. Android WebView defaults
        // mixedContentMode to "never", which blocks the cleartext http:// fetch in
        // dev (LAN Supabase) → "Failed to fetch". "always" permits it; a no-op on
        // iOS and in production (https). Cleartext at the app level is already
        // enabled by the dev build (the doc DTO loads over http fine).
        mixedContentMode="always"
        style={styles.fill}
        onError={() => {
          setLoading(false);
          setError("Could not load the PDF viewer.");
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

// Memoized: re-renders only when `url` changes (a fresh conversion). Keeps an
// unrelated workspace re-render from reloading the PDF.js WebView.
export const PdfView = React.memo(PdfViewInner);

// The WebView shell: loads PDF.js, fetches the PDF bytes, lays out one sized
// placeholder per page (page-on-gray look), and renders each page's canvas as it
// scrolls into view. Posts ready/error lifecycle messages back to RN.
function buildHtml(url: string): string {
  const urlJson = JSON.stringify(url);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=3, user-scalable=yes" />
<script src="${PDFJS}"></script>
<style>
  html, body { margin: 0; padding: 0; background: #e7e7ee; -webkit-text-size-adjust: 100%; }
  #container { padding: 12px 0 32px; display: flex; flex-direction: column; align-items: center; }
  .pdf-page { position: relative; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,0.28); margin-bottom: 14px; }
  .pdf-page canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="container"></div>
<script>
  var RN = window.ReactNativeWebView;
  function post(o){ try { RN && RN.postMessage(JSON.stringify(o)); } catch(e){} }

  var pdfjsLib = window['pdfjsLib'] || window['pdfjs-dist/build/pdf'];
  if (!pdfjsLib){ post({ type:'error', message:'viewer script failed to load' }); }
  else {
    pdfjsLib.GlobalWorkerOptions.workerSrc = ${JSON.stringify(PDFJS_WORKER)};

    // Crisp on retina, but cap so big pages don't exhaust the canvas memory budget.
    var DPR = Math.min(window.devicePixelRatio || 1, 2);
    var rendered = {}; // page number -> true once its canvas is painted

    function renderInto(page, holder){
      var num = page.pageNumber;
      if (rendered[num]) return Promise.resolve();
      rendered[num] = true;
      var avail = document.documentElement.clientWidth - 24; // 12px gutters
      var base = page.getViewport({ scale: 1 });
      var scale = avail / base.width;
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width * DPR);
      canvas.height = Math.floor(viewport.height * DPR);
      holder.appendChild(canvas);
      return page.render({
        canvasContext: ctx,
        viewport: viewport,
        transform: DPR !== 1 ? [DPR, 0, 0, DPR, 0, 0] : null,
      }).promise;
    }

    function run(){
      fetch(${urlJson}, { cache: 'no-store' })
        .then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.arrayBuffer(); })
        .then(function(buf){ return pdfjsLib.getDocument({ data: buf }).promise; })
        .then(function(pdf){
          var container = document.getElementById('container');
          var avail = document.documentElement.clientWidth - 24;
          var firstReady = false;

          // Lazily render pages near the viewport; keep memory bounded on long docs.
          var io = new IntersectionObserver(function(entries){
            entries.forEach(function(ent){
              if (!ent.isIntersecting) return;
              var holder = ent.target;
              var num = parseInt(holder.getAttribute('data-page'), 10);
              pdf.getPage(num).then(function(page){ renderInto(page, holder); });
            });
          }, { rootMargin: '600px 0px' });

          var chain = Promise.resolve();
          for (var i = 1; i <= pdf.numPages; i++){
            (function(num){
              chain = chain.then(function(){
                return pdf.getPage(num).then(function(page){
                  // Size the placeholder to the page's fit dimensions up front so
                  // the scrollbar is correct before any canvas is painted.
                  var base = page.getViewport({ scale: 1 });
                  var scale = avail / base.width;
                  var vp = page.getViewport({ scale: scale });
                  var holder = document.createElement('div');
                  holder.className = 'pdf-page';
                  holder.setAttribute('data-page', String(num));
                  holder.style.width = Math.floor(vp.width) + 'px';
                  holder.style.height = Math.floor(vp.height) + 'px';
                  container.appendChild(holder);
                  io.observe(holder);
                  // Hide the spinner only once the first page has actually painted.
                  if (!firstReady){ firstReady = true; renderInto(page, holder).then(function(){ post({ type:'ready' }); }); }
                });
              });
            })(i);
          }
        })
        .catch(function(e){ post({ type:'error', message: String(e && e.message || e) }); });
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') run();
    else window.addEventListener('DOMContentLoaded', run);
  }
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
