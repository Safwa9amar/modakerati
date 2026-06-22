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
 * Decided by the dominant strong-directional script (defaults to LTR when tied).
 */
export function getTextDirection(text: string): TextDirection {
  const rtl = (text.match(RTL_CHARS) || []).length;
  const ltr = (text.match(LTR_CHARS) || []).length;
  return rtl > ltr ? "rtl" : "ltr";
}
