# Page fidelity pass — make the Writer's pages break like Word's

**Date:** 2026-08-13
**Status:** Design approved (items 1–5 of the research ranking), not implemented
**Repos:** `~/modakerati-server`, `~/modakerati` (app). No engine change.
**Builds on:** [2026-08-12 page view](2026-08-12-page-view-in-writer-design.md) — the soft-page model,
measuring host, `PageBreakNode`, `PAGES_TAG`/`pinned()` guards all stay. This pass changes *what is
measured* and *where breaks land*, not the architecture.

## The finding that drives everything

The page view measures blocks at true column width — but at the **editor's** typography: 15px generic
sans at 1.7 line-height. The real thesis is **11pt** (`docDefaults sz=22` half-points) at **1.5-line
spacing** (`w:line=360 lineRule=auto` on 654 paragraphs), set in Times New Roman. That is ~22px per
line against our ~25.5px, in a different font's wrap widths. Every downstream fidelity complaint —
breaks in odd places, counts drifting from the PDF — inherits from this.

## Research grounding (2026-08-13)

- Word's breaks are rule-driven: [widow/orphan on by default](https://wordribbon.tips.net/T012695_Controlling_Widows_and_Orphans.html)
  (≥2 lines each side), [keep-with-next](https://support.microsoft.com/en-us/office/keep-text-together-in-word-af94e5b8-3a5a-4cb0-9c53-dea56b43d96d)
  baked into built-in heading styles — **a heading never ends a page**.
- [Space-before is eaten at a natural page top](https://wordribbon.tips.net/T008254_Eliminating_Before_Spacing_at_the_Top_of_a_Page.html),
  but **not** [after a hard page/column/section break](https://learn.microsoft.com/en-us/answers/questions/4827789/why-is-the-spacing-before-a-paragraph-on-a-new-pag).
- [`w:spacing`](http://officeopenxml.com/WPspacing.php): `sz` in half-points; `before`/`after` in
  twentieths of a point; `line` in 240ths (auto → multiplier; `exact`/`atLeast` → points).
- [Liberation Serif is metrically compatible with Times New Roman](https://en.wikipedia.org/wiki/Liberation_fonts)
  — identical advance widths, SIL OFL licensed. Measuring in it reproduces Word's line wraps.
- Prior art ([TipTap discussions](https://github.com/ueberdosis/tiptap/discussions/5719),
  [plate](https://github.com/udecode/plate/discussions/4380),
  [the flicker war stories](https://romik-mk.medium.com/tiptap-pagination-problems-solutions-31f1a0b51e08)):
  the failure modes of structural pagination are per-keystroke reflow and non-convergence — both
  already guarded here (idle debounce, `PAGES_TAG`, signature compare). We keep the architecture.

## The five changes

**F1 — Measure at document typography.** The server resolves each paragraph's *effective* format —
size, line spacing, space before/after — through the OOXML cascade (direct `pPr`/`rPr` → paragraph
style `basedOn` chain → `docDefaults`) into an optional `fmt` on the paragraph DTO. The measuring host
applies it to the clone: Liberation Serif (bundled, OFL), `sizePt` → px (×96/72), the real line rule,
margins from `beforePt`/`afterPt` instead of editor CSS margins. RTL: Arabic runs size from **`szCs`**,
not `sz` (the established `w:cs`/`szCs` rule). Arabic metric fidelity is accepted as looser — there is
no metric-compatible free Arabic TNR; the system Arabic font stands in.

**F2 — A heading never ends a page.** Keep-with-next approximation, no DTO change: when pagination
would leave a `level>0` heading as the last block on a page, the heading moves to the next page. Chain
bounded (≤2 consecutive heading blocks move; never empty a page).

**F3 — Space-before suppressed at natural page tops.** In the accumulator: a block that *starts* a
page contributes `height − spaceBeforePx` — except at `forcedStarts` (section breaks), where Word
keeps the space.

**F4 — Overflow carries into the count.** Breaks stay block-granular, but when a block overflows the
remainder of its page, the spill now advances the *physical page counter* (a 2.5-page table consumes
3 pages, not 1). `paginate` returns each boundary's physical page index; `numberPages` numbers from
that. Bands still appear only at block boundaries — pages consumed *inside* a tall block get no band,
accepted and recorded. This is what stops the count drifting from the PDF.

**F5 — Proportional bottom whitespace.** The boundary band renders the ending page's unused remainder
as a spacer above the footer, scaled to display size (`editorColumnPx / textColumnPx`), capped so a
near-empty page doesn't scroll forever. Short pages finally *look* like pages.

## Non-goals (unchanged from the ranking)

- Mid-paragraph line-level breaks (`Range.getClientRects` splitting) — the expensive tail; only if
  F1–F5 prove insufficient.
- Table row splitting, `w:pageBreakBefore` (zero occurrences in the reference thesis), changing the
  **display** typography — the editor keeps its reading font; only measurement changes.

## Verification

Server: vitest on the format resolver (docDefaults fallback, `basedOn` chain, direct override, `szCs`
for RTL, unit conversions). App: `npx tsc --noEmit`, `node scripts/verify-page-layout.mjs` (extended:
suppression, keep-with-next, overflow-carry numbering), `node scripts/verify-use-dom.mjs`. Device:
compare band positions and the final page count against Word on `m-moire-isp` — expected to land
within a page or two over 123 pages, versus "a few pages" today.
