import { useMemo, useState } from "react";
import { Linking, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { useThemeColors } from "@/hooks/useThemeColors";
import { getTextDirection } from "@/lib/text-direction";

// Measures the rendered document and posts its height back so the WebView can
// size itself to its content (the parent ScrollView owns the scrolling).
const HEIGHT_SCRIPT = `
  function post() {
    var h = document.body.scrollHeight;
    window.ReactNativeWebView.postMessage(String(h));
  }
  post();
  window.addEventListener('load', post);
  setTimeout(post, 300);
  setTimeout(post, 1000);
  true;
`;

/**
 * Renders arbitrary article HTML inside a themed, auto-sizing WebView — the same
 * approach Blink uses for its news bodies. No HTML-parsing library is involved;
 * the raw HTML is wrapped in a document with injected theme CSS so it matches
 * the app's colors, typography and (per-content) text direction.
 */
export function RenderHtml({ html }: { html: string }) {
  const colors = useThemeColors();
  const [height, setHeight] = useState(120);

  const dir = getTextDirection(html);

  const doc = useMemo(() => {
    return `<!DOCTYPE html>
<html dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    color: ${colors.textPrimary};
    font-family: -apple-system, "Roboto", "Segoe UI", sans-serif;
    font-size: 16px;
    line-height: 1.65;
    -webkit-text-size-adjust: 100%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 800; line-height: 1.3; margin: 1.1em 0 0.4em; color: ${colors.textPrimary}; }
  h1 { font-size: 1.6em; } h2 { font-size: 1.32em; } h3 { font-size: 1.14em; } h4 { font-size: 1em; }
  p { margin: 0 0 0.9em; }
  a { color: ${colors.brandPrimary}; font-weight: 700; text-decoration: none; }
  strong, b { font-weight: 800; }
  em, i { font-style: italic; }
  ul, ol { margin: 0 0 0.9em; padding-${dir === "rtl" ? "right" : "left"}: 1.3em; }
  li { margin: 0.3em 0; }
  blockquote {
    margin: 1em 0; padding: 0.7em 1em;
    border-${dir === "rtl" ? "right" : "left"}: 4px solid ${colors.brandPrimary};
    background: ${colors.bgSurface}; border-radius: 12px;
    font-style: italic;
  }
  code { font-family: ui-monospace, Menlo, monospace; background: ${colors.bgSurface}; padding: 2px 5px; border-radius: 5px; font-size: 0.9em; }
  pre { background: ${colors.bgSurface}; padding: 12px; border-radius: 12px; overflow: auto; }
  pre code { background: transparent; padding: 0; }
  img { max-width: 100%; height: auto; border-radius: 14px; margin: 0.5em 0; }
  hr { border: none; border-top: 1px solid ${colors.borderDefault}; margin: 1.2em 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 0.95em; }
  th, td { border: 1px solid ${colors.borderDefault}; padding: 8px 10px; text-align: ${dir === "rtl" ? "right" : "left"}; }
  th { background: ${colors.bgSurface}; font-weight: 800; }
</style>
</head>
<body>${html}</body>
</html>`;
  }, [html, dir, colors]);

  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: doc }}
      style={[styles.web, { height }]}
      injectedJavaScript={HEIGHT_SCRIPT}
      onMessage={(e) => {
        const next = Number(e.nativeEvent.data);
        if (next && Math.abs(next - height) > 1) setHeight(next);
      }}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      // Keep the document inline; send real links out to the system browser.
      onShouldStartLoadWithRequest={(req) => {
        if (req.url === "about:blank" || req.url.startsWith("data:")) return true;
        Linking.openURL(req.url).catch(() => {});
        return false;
      }}
      androidLayerType="hardware"
      automaticallyAdjustContentInsets={false}
    />
  );
}

const styles = StyleSheet.create({
  web: { backgroundColor: "transparent", width: "100%" },
});
