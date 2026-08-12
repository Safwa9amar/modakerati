# Page view in the Writer

**Date:** 2026-08-12
**Status:** Design approved, not implemented
**Repos touched:** `~/mdocxengine`, `~/modakerati-server`, `~/modakerati` (app)

## Problem

The thesis workspace stacks three document layers ([thesis-workspace.tsx](../../../app/(app)/thesis-workspace.tsx)):

| Layer | Pages | Editable |
|---|---|---|
| Writer — Lexical in a WebView | none: one continuous column | yes |
| Word — OnlyOffice (real device) / docx-preview (`breakPages:true`) | real | no |
| PDF — OnlyOffice-converted | real | no |

Pages already exist in two layers. Neither is the one the student types in. The Writer is a continuous
flow with `.lx-content { padding: 16px 18px 140px }` and no page geometry at all — no paper edge, no
margins, no running header, no page number.

That absence has already cost us a feature. The editable-document-chrome design
([2026-07-25](2026-07-25-editable-document-chrome-design.md)) records the compromise verbatim:

> The Lexical writer has NO page model (continuous flow) → headers/footers can only render at
> **section boundaries**, never per simulated page.

## Goal

Make the Writer read as a paginated Word document — paper, running header, page number — at a fidelity
of **formatting truth**: breaks and numbers believable enough that a student makes decisions on them
("my chapter starts fresh", "I'm at 47 of 60"). Explicitly *not* precision: the Writer's page 60 is not
promised to be the PDF's page 60.

## Non-goals

- Matching Word's pagination exactly. The PDF layer already provides that, one tap away.
- Driving the table of contents or figure list from Writer page numbers. Those stay Word fields.
- Making OnlyOffice editable.
- True A4-proportioned sheets. At writing-size text on a 390px screen, an A4's worth of words cannot
  fit an A4-shaped box. A sheet is as tall as the content assigned to it.

## Decisions

Each of these closed an option that was live during brainstorming; they are recorded so the reasoning
is not re-litigated.

**D1 — Fidelity is "formatting truth", not precision.** Precision realistically means driving the
Writer off a server-side layout pass, and buys something the PDF layer already gives away.

**D2 — Soft pages, not true-scale pages.** A4 is 794×1123 CSS px against a ~390px viewport: fit-to-width
scales everything to 49%, putting 12pt body text at roughly 8px. Geometrically honest pages are
unreadable. Text stays at writing size; page boundaries are derived from true geometry measured
offscreen.

**D3 — The break is a real gutter.** Paper ends, a grey gap, paper begins again. Rejected: a hairline
marker in one continuous sheet (calmest, least Word-like) and a margin rail of page numbers (never
interrupts, never looks like Word, and costs 44 of 390 px).

**D4 — The page bands *are* the header and footer.** The page view invents no new chrome. The band at
the top of a page is the existing header band; the band at the foot is the existing footer band, with
its PAGE field resolved to a real number. Both stay tappable and open the existing sheet with its ✦ AI
prompt and template picker. No new editing UI is built.

**D5 — With no footer, the paper shows nothing; the gutter shows a faint number.** The paper renders
only what Word will print. The count lives in the grey gutter, which is app chrome and cannot be
mistaken for document content.

## Architecture

```
~/mdocxengine          Doc.sections() gains per-section page geometry (twips)
        │
        ▼
~/modakerati-server    DocSectionDTO gains `page`, via sectionHFDTO()
        │
        ▼
~/modakerati (app)     WorkspaceLexicalView
                         ├── measurePages()      offscreen, cached, incremental
                         └── $blocksToLexical(blocks, chrome, pageBreaks)
                                 └── PageBreakNode  [footer][gutter][header]
```

### 1. Page geometry (engine → server → app)

`SectionInfo` ([Doc.ts:390](../../../../mdocxengine/src/Doc.ts)) carries header/footer/page-number data
but no page size or margins. The engine already knows both — `PageLayoutManager` defines `PAGE_SIZES`
and `MARGIN_PRESETS` in twips — and `applyBodyPageLayout` writes them. Only the read is missing.

Add to `SectionInfo`:

```ts
page: {
  widthTwips: number;
  heightTwips: number;
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
} | null;   // null when the section's sectPr declares neither pgSz nor pgMar
```

Read from the section's own `w:sectPr` (`w:pgSz`, `w:pgMar`), inheriting the body-level `sectPr` when
the section declares none — the same inheritance the header/footer read already implements.

Server: `sectionHFDTO()` in `src/lib/thesis-doc.ts` forwards it onto `DocSectionDTO.page`. Best-effort,
exactly like `sections` itself — a failure yields `null`, never a failed DTO.

App: mirror it as **optional** on `DocSectionDTO` ([lib/api.ts:1224](../../../lib/api.ts)). Older SQLite
caches predate the field, so every consumer tolerates `undefined` and falls back to A4 at 1 inch
(`11906 × 16838` twips, `1440` margins).

### 2. Measurement

Rejected alternatives:

- **Server truth via the PDF pipeline** — convert, read per-page text, match back to blocks. It is the
  same engine that renders the PDF the jury sees, so it is genuinely correct, but it costs seconds per
  conversion, is stale the moment a key is pressed, and silently falls back when OnlyOffice's LAN IP
  drifts. Kept as the v2 calibration source (see below), not the live path.
- **Word-count estimate** — the base template runs ~700–740 words/page. Free, and wrong on any chapter
  with figures. Below the bar D1 sets.

**Chosen: offscreen per-block measurement in the WebView.**

Derive from the section's geometry, at 96 CSS px per inch (1440 twips):

```
textColumnPx  = (widthTwips  - marginLeft - marginRight)  / 1440 * 96
pageContentPx = (heightTwips - marginTop  - marginBottom) / 1440 * 96
```

A4 at 1-inch margins gives `textColumnPx ≈ 601.7`, `pageContentPx ≈ 930.5`.

A measuring host lives offscreen in the same WebView:

```css
#lx-measure {
  position: absolute; left: -10000px; top: 0;
  width: <textColumnPx>px; visibility: hidden;
}
```

`visibility:hidden`, never `display:none` — a `display:none` subtree reports zero heights.

Algorithm:

1. For each block, render its measurable markup into the host and read
   `getBoundingClientRect().height` plus the block class's CSS `margin-bottom` (margins do not
   collapse into the reported rect).
2. Cache the height under a content hash: kind, text, `styleId`, `level`, `alignment`, `direction`, and
   for images the intrinsic `width`/`height`. An edit invalidates exactly one entry.
3. Accumulate in document order. When `used + h > pageContentPx` and `used > 0`, the current block
   starts a new page: record the boundary, reset `used` to 0. Then `used += h`.
4. A block taller than `pageContentPx` occupies a page alone — it never loops.
5. A section whose `startsOnNewPage` is true forces a boundary at its `startBlockIndex` and resets
   `used`, regardless of measurement. This is free accuracy and covers the case students care most
   about (a chapter beginning on a fresh page).

Output: `pageBreaks: number[]` — the block indices that *start* a page — plus each page's resolved
number.

**Known inaccuracy.** Breaks land between blocks, never mid-paragraph, so each page under-fills by up
to one paragraph's height and the error accumulates down the document. A long thesis will read a few
pages longer in the Writer than in the PDF. The measuring host also uses the WebView's fonts, not
Word's metrics (Times New Roman is not present on Android), which adds a systematic few percent. Both
are inside D1 and outside what the TOC needs.

### 3. Page numbering

- The counter starts at 1, unless section 0 sets `pageNumberStart`.
- A page belongs to the section containing its **first block**.
- When a page's owning section changes and that section sets `pageNumberStart`, the counter resets to
  that value. Roman-numbered front matter followed by decimal body — standard in a mémoire — falls out
  of this.
- Formatting follows the owning section's `pageNumberFormat` (`decimal`, `lowerRoman`, `upperRoman`,
  `lowerLetter`, `upperLetter`). Anything else, or `null`, renders decimal.

### 4. Node model

Wrapping runs of blocks in page containers would introduce new element nodes to the Lexical tree. The
chrome work already shipped two correctness bugs of exactly that shape — chrome nodes inflated the
block-index helpers and ScrollSyncPlugin's DOM-index mapping, off by N on every real thesis (fixed in
`c28d406`, `6eae8ee`). A new nesting level would re-open that class of bug across every walker.

Instead: **one decorator node per boundary**, rendering `[footer band][gutter][header band]` as a
single unit, with paper edges as CSS on that node — shadow above the gutter, shadow below it. No
wrappers, no nesting, no new index space.

```ts
// blockLexical.tsx, beside ChromeNode
export type PageBreakData = {
  endingPage: number;                       // 1-based page the footer belongs to
  footer: {                                  // null → nothing on the paper (D5)
    text: string;
    pageText: string | null;                 // resolved + formatted, null when the footer has no PAGE field
    sectionIndex: number;
    startBlockIndex: number;
  } | null;
  header: {                                  // the page STARTING after the gutter; null → no header
    text: string;
    segments: string[];
    border: { bottom: boolean; color: string | null } | null;
    sectionIndex: number;
    startBlockIndex: number;
  } | null;
  gutterLabel: string;                       // always present; labels the page BEGINNING after the
                                             // gutter, i.e. endingPage + 1 — "p. 14" below page 13
  rtl: boolean;
};
```

**Edge nodes.** A boundary node sits *between* pages, so the first page has no header and the last no
footer. `$blocksToLexical` therefore also emits a leading header band before the first block and a
trailing footer band after the last.

**The critical regression control.** Every site that skips chrome must skip page nodes too. Introduce a
single shared predicate and replace each `$isChromeNode` skip with it:

```ts
export function $isDisplayOnlyNode(n: LexicalNode | null | undefined): boolean {
  return $isChromeNode(n) || $isPageBreakNode(n);
}
```

Known call sites, all of which must change together:

- `$lexicalToBlocks` — [blockLexical.tsx:2074](../../../components/workspace/lexical/blockLexical.tsx)
- the drag/reorder walker — [blockLexical.tsx:2139](../../../components/workspace/lexical/blockLexical.tsx)
- `$anyNodeAtBlockIndex` — [LexicalDomEditor.tsx:1372](../../../components/workspace/lexical/LexicalDomEditor.tsx)
- `ScrollSyncPlugin`'s DOM-index mapping — [LexicalDomEditor.tsx:1207](../../../components/workspace/lexical/LexicalDomEditor.tsx) and :1279

Adding a node kind without auditing all four is the most likely way to break this feature silently.

### 5. Rendering and interaction

The top band reuses today's header render — segments spread `space-between`, bottom rule in the
section's colour or the thesis brown `#9A5A31` — unchanged apart from where it appears.

The bottom band renders the footer. Today `ChromeBand` renders `data.text` and nothing else
([blockLexical.tsx:1130-1138](../../../components/workspace/lexical/blockLexical.tsx)), and
`DocSectionDTO.footer.text` is `""` when the footer is page-numbers-only — so a numbers-only footer
currently draws a literal `—`. It becomes the composed footer: text and resolved `pageText`.

The **§ section-break band is unchanged**. The section-start *header* band retires: the header now
renders at the top of every page, so a second copy at the section boundary would be a duplicate.

Both bands keep `onMouseDown → preventDefault` + selection clear (the iOS scroll-to-top and Android
sticky-caret guards already in `ChromeBand`) and route taps through `chromeSelection` on the workspace
store into the existing `hfTop` / `hfBottom` bubble kinds — same sheet, same ✦ panel, same template
picker, same `POST /api/thesis/:id/chrome-op` write path.

The gutter carries `gutterLabel` in a muted app-chrome style. When the ending page has no footer,
tapping the gutter opens the footer sheet, offering to add page numbers to that section.

### 6. Performance

- Measurement is debounced on idle, never per keystroke — the same discipline as `createStreamPump`'s
  90ms batching. 400ms of quiet is the trigger.
- Height cache keyed by content hash: a keystroke re-measures one block, then re-accumulates. The
  accumulation is a single pass over block heights (~2000 entries on a large thesis) and is cheap.
- The first pass runs progressively in idle time, with bands appearing as they resolve. It is never a
  blocking spinner.
- Documents above 4000 blocks start with pages off; the student can turn them on.

### 7. Toggle and failure

A `showPages` boolean on `settings-store`, surfaced in the ✦ dock's tools sheet
([DockToolsSheet.tsx](../../../components/DockToolsSheet.tsx)) beside the existing toggles. Default on.
It is also the escape hatch if a device misbehaves.

Every failure degrades to today's continuous flow, and writing is never blocked:

| Failure | Behaviour |
|---|---|
| `sections` absent (old cache) or `page` null | A4 at 1 inch |
| Measurement throws | No page nodes; plain flow; logged once |
| `sections` empty | No bands, no pages |
| Document over the block cap | Pages start off |

### 8. RTL

The measuring host inherits the document's direction so Arabic line-breaking is measured as it renders.
Direction stays content-driven, never locale-driven. Header segments already handle RTL. Page-number
formats beyond the five listed above fall back to decimal rather than guessing an Arabic-indic form.

### 9. i18n

New keys in `en` / `fr` / `ar`: `workspace.pages.gutterPage` (`"p. {{n}}"`), `workspace.pages.toggle`,
`workspace.pages.addNumbers`. The locale JSONs contain ~155 duplicate keys each and
`json.load`/`json.dump` silently drops them — **edit surgically, never round-trip**.

## Verification

The app has no JS test runner, so the gate is:

```bash
cd ~/modakerati        && npx tsc --noEmit
cd ~/mdocxengine       && npx vitest run      # page-geometry read in Doc.sections()
cd ~/modakerati-server && npx vitest run      # DocSectionDTO.page
```

Engine and server changes need new unit tests: geometry read with an own `sectPr`, with inheritance
from the body `sectPr`, and with neither (→ `null`).

Device QA checklist, since none of the above catches it:

1. Block indices survive — select a block near the end of a long thesis, confirm the AI edits *that*
   block. This is the `$isDisplayOnlyNode` audit's real test.
2. Scroll restore lands on the right block after reopening.
3. Drag-reorder across a page boundary moves the intended block.
4. A section with `startsOnNewPage` begins a page.
5. Roman front matter renumbers to decimal at the body section.
6. A numbers-only footer shows a number, not `—`.
7. Tapping either band opens the correct sheet; a template applies.
8. An Arabic (RTL) thesis paginates and both bands render right-to-left.
9. Typing near a boundary does not visibly stutter.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A walker misses `$isDisplayOnlyNode` → off-by-N block targeting | **High** — silent, corrupts the wrong block | Single shared predicate; all four call sites changed together; QA item 1 |
| Accumulated drift makes the page count visibly wrong | Medium | Accepted under D1; v2 calibration below |
| Measurement jank on a large thesis | Medium | Idle debounce, per-block cache, progressive first pass, block cap |
| Font metrics differ from Word | Low | Accepted under D1 |
| Ships across three repos | Medium | Engine must be rebuilt (`dist/` is gitignored) and the server redeployed before it works on a device |

## Deferred to v2

- **Calibration against the PDF pipeline.** On document open, fetch a true block→page map derived from
  the OnlyOffice conversion and anchor local measurement to it, correcting accumulated drift. This is
  the upgrade path from "formatting truth" to precision.
- **Mid-paragraph breaks.** More faithful, but the break must render inside a paragraph without
  splitting the Lexical model — materially harder than one node per boundary.
- **Proportional bottom whitespace**, showing how much room Word would actually leave on a short page.
- **Pinch-to-zoom true-scale view** (option A from brainstorming) as a third mode.

## Related

- [2026-07-25 editable document chrome](2026-07-25-editable-document-chrome-design.md) — the bands,
  the sheet and the `chrome-op` write path this feature reuses; the spec whose section-boundary
  compromise this retires.
- [2026-07-17 outline header/footer chrome](2026-07-17-outline-header-footer-design.md) — the
  read-only ancestor of the bands.
- [2026-07-21 fluid block editor](2026-07-21-fluid-block-editor-design.md) — stable-identity reindex.
