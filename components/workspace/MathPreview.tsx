'use dom';

// The Equation sheet's live preview, as an Expo DOM component.
//
// It has to be a WebView: typesetting maths means laying out fractions, radicals
// and stacked limits, which React Native has no primitive for. This is the same
// MathJax pipeline the Writer uses (lib/mathjax-web), so what the student sees
// while typing is exactly what will land on the page — not an approximation of it.
//
// Serializable props only, per the DOM-components contract: it takes the MathML the
// server returned and nothing else.

import * as React from "react";
import { typesetMathML } from "@/lib/mathjax-web";

export default function MathPreview({
  mathml,
  dark,
}: {
  /** MathML from the server. The caller mounts this only when it has some. */
  mathml: string;
  /** The app's theme — the sheet is a native surface and can be either. */
  dark?: boolean;
  dom?: import("expo/dom").DOMProps;
}) {
  const ink = dark ? "#ECECEC" : "#1A1A1A";
  // MathML must be PARSED as markup, not built with React.createElement: React
  // creates elements in the HTML namespace and a `<math>` there renders as inline
  // text. Both strings are ours — the server escapes every text node, MathJax emits
  // its own SVG.
  const html = mathml ? typesetMathML(mathml) ?? mathml : "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 64,
        padding: "8px 12px",
        boxSizing: "border-box",
        color: ink,
        fontFamily: "Georgia, serif",
        // Maths is LTR even inside an Arabic thesis.
        direction: "ltr",
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      <span style={{ fontSize: 20 }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
