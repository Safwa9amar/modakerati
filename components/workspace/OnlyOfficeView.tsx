import React, { useMemo, useRef, useState } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * Embeds the OnlyOffice Docs editor (HTML5-canvas, OOXML-native) in a WebView for
 * Word-level fidelity on the live .docx. The HTML loads the Document Server's
 * `api.js`, then `new DocsAPI.DocEditor("ph", config)` with the signed config the
 * server returns. View mode for v1: the AI edits the .docx via its block tools and
 * the workspace re-fetches a fresh `config` (new `document.key`) after each turn →
 * the editor reloads the updated bytes. Tap-to-target isn't exposed here yet (the
 * composer still works; the AI targets blocks via find).
 */
export function OnlyOfficeView({
  documentServerUrl,
  config,
  onError,
}: {
  documentServerUrl: string;
  config: any;
  onError?: (message: string) => void;
}) {
  const colors = useThemeColors();
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The doc version key. Rebuilding the HTML (and reloading the WebView) only when
  // it changes — i.e. when the .docx changes after an AI turn — re-inits the editor
  // with fresh bytes without churning on unrelated re-renders.
  const docKey = config?.document?.key;

  const html = useMemo(
    () => buildHtml(documentServerUrl, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentServerUrl, docKey],
  );

  // A new key means new html → spinner until the editor reports ready. The
  // timeout is a safety net: embedded mode doesn't always fire onDocumentReady,
  // so clear the overlay after a few seconds regardless (the pages render anyway).
  React.useEffect(() => {
    setLoading(true);
    setError(null);
    const t = setTimeout(() => setLoading(false), 6000);
    return () => clearTimeout(t);
  }, [documentServerUrl, docKey]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "ready") setLoading(false);
      else if (msg.type === "error") {
        setLoading(false);
        const m = typeof msg.message === "string" ? msg.message : "editor error";
        setError(m);
        onError?.(m);
      }
    } catch {
      // ignore malformed bridge messages
    }
  };

  return (
    <View style={styles.clip}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        // Oversize the WebView past the container's right + bottom edges; the parent
        // clips the overflow, so the editor's bottom toolbar (footer) and right
        // scrollbar fall outside the visible area → pages only. Origin-independent
        // (CSS-into-iframe can't work cross-origin in a WebView).
        style={styles.webview}
        // Surface hard load failures (rare; the Document Server unreachable).
        onError={() => {
          setLoading(false);
          const m = "Could not load the document editor.";
          setError(m);
          onError?.(m);
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

// The WebView shell: loads the Document Server api.js, instantiates the DocEditor
// with the signed config, and posts lifecycle/error messages back to RN.
function buildHtml(documentServerUrl: string, config: any): string {
  const apiSrc = `${documentServerUrl}/web-apps/apps/api/documents/api.js`;
  const configJson = JSON.stringify(config);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=3, user-scalable=yes" />
<script src="${apiSrc}"></script>
<style>
  html, body, #ph { margin: 0; height: 100%; width: 100%; }
  body { background: #e7e7ee; }
</style>
</head>
<body>
<div id="ph"></div>
<script>
  var RN = window.ReactNativeWebView;
  function post(o){ try { RN && RN.postMessage(JSON.stringify(o)); } catch(e){} }
  var CONFIG = ${configJson};
  function start(){
    if (typeof DocsAPI === 'undefined'){
      post({ type:'error', message:'document server unreachable' });
      return;
    }
    try {
      CONFIG.events = CONFIG.events || {};
      CONFIG.events.onDocumentReady = function(){ post({ type:'ready' }); };
      CONFIG.events.onAppReady = function(){ post({ type:'ready' }); };
      CONFIG.events.onError = function(e){ post({ type:'error', message: (e && e.data) || 'editor error' }); };
      new DocsAPI.DocEditor("ph", CONFIG);
    } catch (e) {
      post({ type:'error', message: String(e && e.message || e) });
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else window.addEventListener('DOMContentLoaded', start);
</script>
</body>
</html>`;
}

// How far to push the WebView past the container edges so the editor's bottom
// toolbar (footer) and right scrollbar are clipped out of view. Tunable.
const CLIP_BOTTOM = 56; // ~ embedded footer bar height
const CLIP_RIGHT = 22; // ~ scrollbar width

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Clips the oversized WebView; gray backdrop matches the editor's page margin.
  clip: { flex: 1, overflow: "hidden", backgroundColor: "#e7e7ee" },
  webview: {
    position: "absolute",
    top: 0,
    left: 0,
    right: -CLIP_RIGHT,
    bottom: -CLIP_BOTTOM,
    backgroundColor: "transparent",
  },
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
