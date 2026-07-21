// Fold case + Arabic orthographic variants so search matches regardless of
// tashkeel, tatweel, or alef/ya/ta-marbuta spelling. Extracted from
// ThesisOutlinePanel so document search shares one folding.

// Characters the fold removes entirely: Arabic tashkeel (U+064B–U+0652,
// U+0670 superscript alef) and tatweel (U+0640).
const REMOVED = /[ً-ْٰـ]/;

function foldChar(ch: string): string {
  if (REMOVED.test(ch)) return "";
  if (/[أإآٱ]/.test(ch)) return "ا";
  if (/[ىئ]/.test(ch)) return "ي";
  if (ch === "ؤ") return "و";
  if (ch === "ة") return "ه";
  return ch.toLowerCase();
}

/** Plain fold (query side / outline heading filter): fold + trim. */
export function normalize(s: string): string {
  return normalizeWithMap(s).norm.trim();
}

/**
 * Fold `s` while recording, for every folded character, the index of the
 * ORIGINAL character it came from — so a match found in `norm` maps back to a
 * span in the original string (for highlighting and replace). `map[i]` is the
 * original index of `norm[i]`. NOT trimmed (offsets must hold).
 */
export function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const folded = foldChar(s[i]);
    for (const ch of folded) {
      // toLowerCase can emit >1 char (e.g. İ) — each maps to the same original.
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}
