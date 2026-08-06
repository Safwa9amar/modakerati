// Maths typesetting for the WEB bundle only.
//
// ⚠️ Import this ONLY from a 'use dom' component (the Lexical writer, the equation
// preview). It reaches for `document` and pulls ~1.3 MB of glyph data; in the
// native bundle it would neither run nor be wanted.
//
// The WebView's own MathML support is uneven — and neither iOS nor Android ships a
// maths font, so native MathML renders fractions and radicals with whatever the
// system face has. MathJax typesets the MathML the server sends into SVG with the
// TeX glyphs embedded as paths: no font files to load, identical on both platforms.
//
// A conversion costs a few ms, so results are cached by MathML string — a thesis
// repeats the same symbols on dozens of lines, and a re-render must never retypeset.

let mjDoc: { convert: (mml: string, opts: { display: boolean }) => unknown } | null = null;
let mjAdaptor: { outerHTML: (node: unknown) => string } | null = null;
let mjFailed = false;
const mjCache = new Map<string, string>();

function initMathJax(): boolean {
  if (mjDoc) return true;
  if (mjFailed) return false;
  try {
    // Required lazily: pulling the glyph data at module load would delay the
    // editor's first paint even for a thesis with no equations in it.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { mathjax } = require("mathjax-full/js/mathjax.js");
    const { MathML } = require("mathjax-full/js/input/mathml.js");
    const { SVG } = require("mathjax-full/js/output/svg.js");
    const { browserAdaptor } = require("mathjax-full/js/adaptors/browserAdaptor.js");
    const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
    /* eslint-enable @typescript-eslint/no-var-requires */
    mjAdaptor = browserAdaptor();
    RegisterHTMLHandler(mjAdaptor);
    // fontCache "local" keeps each equation's glyph <defs> inside its own <svg>, so
    // a node can be moved, re-rendered or dropped without a shared cache going
    // stale and leaving blank glyphs behind.
    const out = new SVG({ fontCache: "local" });
    mjDoc = mathjax.document("", { InputJax: new MathML(), OutputJax: out });
    // MathJax's own stylesheet (container metrics, line-breaking). Injected once.
    const sheet = out.styleSheet(mjDoc);
    const css = mjAdaptor!.outerHTML(sheet);
    if (css && !document.getElementById("mjx-styles")) {
      const el = document.createElement("div");
      el.innerHTML = css;
      const style = el.firstElementChild;
      if (style) {
        style.id = "mjx-styles";
        document.head.appendChild(style);
      }
    }
    return true;
  } catch {
    // Never let a typesetter failure blank the equation — the caller falls back to
    // handing the raw MathML to the browser.
    mjFailed = true;
    return false;
  }
}

/** MathML → self-contained SVG markup, or null to fall back to raw MathML. */
export function typesetMathML(mathml: string): string | null {
  const hit = mjCache.get(mathml);
  if (hit !== undefined) return hit || null;
  if (!initMathJax()) return null;
  try {
    const node = mjDoc!.convert(mathml, { display: /display="block"/.test(mathml) });
    const html = mjAdaptor!.outerHTML(node);
    mjCache.set(mathml, html);
    return html;
  } catch {
    mjCache.set(mathml, ""); // remember the failure; don't retry every render
    return null;
  }
}
