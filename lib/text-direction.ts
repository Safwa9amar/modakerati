// Strong RTL scripts: Hebrew (֐-׿), Arabic + supplement + extended
// (؀-ۿ, ݐ-ݿ, ࢠ-ࣿ), and Arabic/Hebrew presentation
// forms (יִ-﷿, ﹰ-﻿).
const RTL_CHARS = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/g;
// Strong LTR: Latin + accents/extensions (À-ɏ), Greek (Ͱ-Ͽ),
// Cyrillic (Ѐ-ӿ).
const LTR_CHARS = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/g;

export type TextDirection = "rtl" | "ltr";

/**
 * Resolves a paragraph's direction from its content so a message renders in its
 * own language's direction regardless of the app's locale — an Arabic answer is
 * RTL even in the English UI, and an English answer is LTR even in the Arabic UI.
 * Decided by the dominant strong-directional script; a fragment with no strong
 * character at all (": ", "(2)", an emoji) carries no direction of its own and
 * takes `fallback` — pass the surrounding block's direction so punctuation-only
 * runs don't flip to LTR inside an Arabic answer.
 */
export function getTextDirection(text: string, fallback: TextDirection = "ltr"): TextDirection {
  const rtl = (text.match(RTL_CHARS) || []).length;
  const ltr = (text.match(LTR_CHARS) || []).length;
  if (rtl === ltr) return fallback;
  return rtl > ltr ? "rtl" : "ltr";
}

// Single-character classifiers (no /g — these are used with .test).
const STRONG_RTL = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/**
 * Direction of a FRAGMENT, from its first strong character — the same rule as
 * HTML's `dir="auto"`.
 *
 * Counting (getTextDirection) is right for a whole message but wrong for a short
 * line: `التنسيق: Word (.docx)` holds eight Latin letters against seven Arabic
 * ones, so counting flips one bullet of an Arabic answer to LTR while its
 * siblings stay RTL. The character that OPENS the line is what a reader treats
 * as its language. Text with no strong character at all takes `fallback`.
 */
export function firstStrongDirection(text: string, fallback: TextDirection): TextDirection {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) return "rtl";
    if (STRONG_LTR.test(ch)) return "ltr";
  }
  return fallback;
}
// Digits carry no direction of their own but bind to the run they trail — "Times
// New Roman 12" is one unit, and leaving the 12 outside the isolate below would
// park it on the far side of the name.
const DIGIT = /[0-9٠-٩۰-۹]/;
// FSI resolves an isolated run's direction from its own first strong character;
// PDI closes it.
const FSI = "\u2068";
const PDI = "\u2069";

/**
 * Wraps every opposite-direction run of `text` in a Unicode bidi isolate.
 *
 * Without this, the neutral characters at a script boundary (brackets, quotes,
 * dashes, digits) are reordered against the *paragraph* direction, which is what
 * throws a closing ")" to the far side of the line in a heading like
 * `Structure d'un mémoire (بنية المذكرة)`. Isolating the Latin run keeps its own
 * punctuation with it and leaves the Arabic parenthetical intact.
 */
export function isolateBidi(text: string, base: TextDirection): string {
  if (!text) return text;
  const baseRe = base === "rtl" ? STRONG_RTL : STRONG_LTR;
  const oppRe = base === "rtl" ? STRONG_LTR : STRONG_RTL;
  // Single-script text (either way) already lays out correctly — inserting
  // control characters there would only pollute copied text.
  if (!oppRe.test(text) || !baseRe.test(text)) return text;

  let out = "";
  let run = ""; // current opposite-direction run
  let neutral = ""; // characters since the last strong one — side not yet known

  const closeRun = () => {
    if (!run) return;
    // A closing bracket that trails the run belongs INSIDE it when the run opened
    // the pair, or "Word (.docx)" leaves its ")" behind at the base direction and
    // the bracket lands on the far side of the phrase.
    const close = neutral.match(/^[)\]}»›"']+/);
    if (close && /[([{«‹"']/.test(run)) {
      run += close[0];
      neutral = neutral.slice(close[0].length);
    }
    out += FSI + run + PDI;
    run = "";
  };

  for (const ch of text) {
    if (oppRe.test(ch)) {
      if (run) {
        // Neutrals BETWEEN two opposite-direction characters belong to the run.
        run += neutral;
      } else {
        // A number running straight into the phrase is part of it: "3.3 MB" is
        // one reading unit, and bidi would otherwise show it as "MB 3.3".
        const lead = neutral.match(/[0-9٠-٩۰-۹][0-9٠-٩۰-۹.,:%/–-]*[\s ]*$/);
        out += lead ? neutral.slice(0, lead.index) : neutral;
        run = lead ? lead[0] : "";
      }
      neutral = "";
      run += ch;
    } else if (baseRe.test(ch)) {
      closeRun();
      out += neutral + ch;
      neutral = "";
    } else if (run && DIGIT.test(ch)) {
      run += neutral + ch;
      neutral = "";
    } else {
      neutral += ch;
    }
  }
  closeRun();
  return out + neutral;
}
