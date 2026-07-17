import type { ThemeColors } from "@/constants/colors";

// Ribbon bookmark drop length, in px, at 0% and 100% completion.
export const RIBBON_MIN_DROP = 52;
export const RIBBON_MAX_DROP = 176;

/** Ribbon drop length in px, linearly mapped from completion percent (0..100). */
export function ribbonDrop(progress: number): number {
  const p = Math.max(0, Math.min(100, progress)) / 100;
  return RIBBON_MIN_DROP + (RIBBON_MAX_DROP - RIBBON_MIN_DROP) * p;
}

/**
 * Section spine accent color, cycled by list position and resolved from the
 * active theme so it adapts to light/dark.
 */
export function spineColorForIndex(index: number, colors: ThemeColors): string {
  const palette = [
    colors.brandPrimary,
    colors.brandAccent,
    colors.semanticWarning,
    colors.brandPrimaryLight,
    colors.semanticError,
  ];
  const i = ((index % palette.length) + palette.length) % palette.length;
  return palette[i];
}

/** Decorative page-edge thickness (px); grows ~1px/400 words, clamped 6..14. */
export function pageEdgeThickness(wordCount: number): number {
  const t = 6 + Math.floor(Math.max(0, wordCount) / 400);
  return Math.max(6, Math.min(14, t));
}
