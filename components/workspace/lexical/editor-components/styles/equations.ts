// Word equations (OMML → MathML → MathJax SVG). MathJax ships its own metrics
// stylesheet; these rules only PLACE the result.

export const CSS_EQUATIONS = `
/* Word equations (OMML → MathML → MathJax SVG). MathJax injects its own
   stylesheet for the <mjx-container> metrics; these rules only PLACE the result.
   Read-only: an equation cannot be expressed as text, so editing it here would
   corrupt the .docx (see EquationNode). A display equation (<m:oMathPara>) sits
   centred on its own line, exactly as Word lays it out. */
.lx-eq { -webkit-user-select: none; user-select: none; }
/* An equation that owns its line is CENTRED — never left where Word's alignment
   (or a run of tab characters) put it, since neither survives the reflow to phone
   width. The block display here is layout only; the node stays inline in the
   Lexical model. Centring on the span itself beats the paragraph's own alignment
   for the equation without disturbing the "(I.1)" beside it. */
.lx-eq-block { display: block; width: 100%; text-align: center; margin: 6px 0; }
/* MathJax centres a display container too, with a 1em margin — keep the centring,
   drop the margin so it doesn't double up with the wrapper's. */
.lx-eq-block mjx-container[display="true"] { margin: 0; }
.lx-eq-ml { display: inline-block; vertical-align: middle; }
/* Only reached if MathJax failed and the raw MathML went to the browser: neither
   platform ships a maths font, so ask for one before falling back to a serif. */
.lx-eq-ml math { font-family: "STIX Two Math", "Latin Modern Math", "Cambria Math", Georgia, serif; font-size: 1.05em; }
.lx-eq-img { vertical-align: middle; max-width: 100%; }
.lx-eq-txt { font-family: Georgia, serif; white-space: nowrap; }
`;
