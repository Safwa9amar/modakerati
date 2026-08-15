// Offscreen block measurement for the page view: what height would Word give this
// block at TRUE page geometry?
//
// Owns BOTH measurement caches. They are module-level singletons, so this file
// must stay the ONLY home for them — a second copy elsewhere means a second
// cache, and stale heights that no invalidation can reach.
//
// The pure geometry that consumes these heights (paginate / numberPages) lives
// in @/lib/page-layout and is verifiable off-device: scripts/verify-page-layout.mjs.

import { PX_PER_PT, lineHeightPx, type BlockFmt } from "@/lib/page-layout";

/**
 * Measure each block's rendered height at TRUE page geometry.
 *
 * Renders one block at a time into an offscreen host whose width is the real
 * text column (≈601.7px for A4 at 1"), so the heights returned are the heights
 * Word would produce — not the heights of the readable-size visible editor.
 *
 * Heights are cached under a content hash, so a keystroke re-measures exactly
 * one block. Never call this per keystroke regardless: the caller debounces.
 *
 * ⚠️ This function is why editor-components/ exists. It once lived in the
 * 'use dom' module as `export function measureBlockHeights`, where
 * babel-preset-expo's use-dom-directive plugin rejects any non-type named
 * export — a BUNDLE-time failure that took the whole editor screen down, and
 * that `tsc` reports as clean. Here, in a module with no directive, exporting it
 * is correct. Never add 'use dom' to this file. Gate: scripts/verify-use-dom.mjs.
 */
const measureCache = new Map<string, { h: number; before: number }>();

// Lives beside the caches it clears, called from PaginationPlugin's font-readiness
// effect — a measurement taken before Liberation Serif loads is poisoned (it
// measured the fallback serif's metrics, not Word's).
//
// Clears BOTH: a single-line probe taken in the fallback font is exactly as
// poisoned as a block measurement, and the two are only ever cleared together.
export function measureCacheClear(): void {
  measureCache.clear();
  singleLineCache.clear();
}

function blockMeasureKey(el: HTMLElement, columnPx: number): string {
  return `${Math.round(columnPx)}|${el.className}|${el.innerHTML}`;
}

// Height of ONE line at `normal` leading in the measuring font — the base the
// `auto` multiplier scales (Word's 1.5x means 1.5x the font's own leading,
// which for Liberation Serif is Times New Roman's). Cached per (sizePt, rtl).
// Measured inside the SAME offscreen host used for block measurement (not
// document.body) so it shares the same width/dir context.
const singleLineCache = new Map<string, number>();
function singleLinePx(host: HTMLElement, sizePt: number, rtl: boolean): number {
  const key = `${sizePt}|${rtl ? "r" : "l"}`;
  const hit = singleLineCache.get(key);
  if (hit !== undefined) return hit;
  const probe = document.createElement("div");
  probe.style.cssText = `font-size:${sizePt * PX_PER_PT}px;line-height:normal;`;
  // Same tofu-safe rule as the rest of the app: Arabic NEVER gets a
  // concrete-first font stack (per-char glyph paths break on RNSVG/WebView
  // for some concrete serif fallback chains) — a generic sans is the only
  // stack verified safe on-device for Arabic text.
  probe.style.fontFamily = rtl ? "sans-serif" : '"Liberation Serif", Georgia, serif';
  probe.textContent = rtl ? "نص" : "Hg";
  host.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  singleLineCache.set(key, h);
  return h;
}

export function measureBlockHeights(
  sources: HTMLElement[],
  columnPx: number,
  rtl: boolean,
  fmts?: (BlockFmt | null)[],
): { h: number; before: number }[] {
  let host = document.querySelector<HTMLDivElement>(".lx-measure");
  if (!host) {
    host = document.createElement("div");
    host.className = "lx-measure";
    document.body.appendChild(host);
  }
  host.style.width = `${columnPx}px`;
  // Arabic line-breaking differs from Latin, so the host must measure in the
  // DOCUMENT's direction — which is content-driven here, never locale-driven.
  host.dir = rtl ? "rtl" : "ltr";

  return sources.map((src, i) => {
    const fmt = fmts?.[i] ?? null;
    const key = `${rtl ? "r" : "l"}|${fmt ? JSON.stringify(fmt) : "-"}|${blockMeasureKey(src, columnPx)}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) return hit;

    const clone = src.cloneNode(true) as HTMLElement;
    host.innerHTML = "";
    host.appendChild(clone);

    let result: { h: number; before: number };
    if (fmt) {
      // Measure at the DOCUMENT's typography, not the editor's reading style:
      // Liberation Serif (Times New Roman's metric twin) for LTR, the same
      // tofu-safe generic sans for RTL — never a concrete-first stack on
      // Arabic. Margins are zeroed because before/after now come from the
      // DTO, not getComputedStyle.
      clone.style.fontFamily = rtl ? "sans-serif" : '"Liberation Serif", Georgia, serif';
      clone.style.fontSize = `${fmt.sizePt * PX_PER_PT}px`;
      clone.style.lineHeight = `${lineHeightPx(fmt, singleLinePx(host, fmt.sizePt, rtl))}px`;
      clone.style.marginTop = "0";
      clone.style.marginBottom = "0";
      const h = clone.getBoundingClientRect().height + fmt.afterPt * PX_PER_PT;
      result = { h, before: fmt.beforePt * PX_PER_PT };
    } else {
      // No fmt (tables, images, old caches): today's path — heights come
      // from the clone's own computed margins, not the DTO. `h` still
      // excludes the space-before component (marginTop), same contract as
      // the fmt branch above and as `paginate()` requires of `heights[]` —
      // it now travels separately as `before` so a natural-page-top break
      // can still shed it (F3) without double-counting it mid-page.
      const cs = window.getComputedStyle(clone);
      const marginTop = parseFloat(cs.marginTop || "0");
      const h = clone.getBoundingClientRect().height + parseFloat(cs.marginBottom || "0");
      result = { h, before: marginTop };
    }
    host.innerHTML = "";

    // Bound the cache so a long editing session cannot grow it without limit.
    if (measureCache.size > 4000) measureCache.clear();
    measureCache.set(key, result);
    return result;
  });
}
