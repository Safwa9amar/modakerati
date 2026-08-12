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

**D6 — Deliberately unnumbered pages show no number anywhere, not even in the gutter.** A chapter
divider page and an ornamented front-matter page (dedication, acknowledgements, abstract) carry no
number by design. D5's gutter number would print one on exactly those pages. They are marked
*unnumbered* and the gutter names them instead. See §3.

**D7 — The Writer reports the document's numbering convention; it never picks one.** Universities
split on whether a divider page is counted. Both conventions are expressible in Word and the Writer
renders whichever the .docx encodes, rather than guessing. See §3.

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
  margins: { top: number; bottom: number; left: number; right: number;
             header: number; footer: number; gutter: number };
} | null;   // null when the section's sectPr declares neither pgSz nor pgMar
```

Read from the section's own `w:sectPr` (`w:pgSz`, `w:pgMar`), falling back to the body-level `sectPr`
when the section declares neither.

That fallback is **not** what Word does, and the distinction matters enough to record. In ECMA-376 each
`sectPr` is self-contained; an omitted `w:pgSz` resolves to the *application* default, which this
engine's own `parseSectPr` encodes as US Letter. The fallback exists because `addSectionBreak` writes a
bare `<w:sectPr><w:type w:val="nextPage"/></w:sectPr>` with no geometry — our own gap — and treating the
body geometry as that section's geometry is what makes an A4 thesis paginate as A4 rather than as
Letter. Arguably `addSectionBreak` should write full geometry instead; until it does, this fallback is
what stands between the student and a silently wrong page size.

Server: `sectionHFDTO()` in `src/lib/thesis-doc.ts` forwards it onto `DocSectionDTO.page`. Best-effort,
exactly like `sections` itself — a failure yields `null`, never a failed DTO.

`sectionHFDTO()` must also start carrying the two flags that mark an unnumbered page (§3):

```ts
dividerPage?: boolean;                                        // built by add_divider_pages
pageOrnament?: "dedication" | "thanks" | "abstract";          // decorated by add_page_ornament
```

Neither needs new detection work. Both are already computed in
`src/mcp/doc-section-map.ts` — `dividerPage` from the invisible `modk_divider_*` bookmark on the
section's first block, `pageOrnament` alongside it — and surfaced to the AI through `get_sections`.
They have simply never reached `DocSectionDTO`. Lift the detection into a shared helper rather than
duplicating the bookmark scan, so the AI's view and the Writer's view cannot drift apart.

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
textColumnPx  = (widthTwips  - marginLeft - marginRight - gutter) / 1440 * 96
pageContentPx = (heightTwips - marginTop  - marginBottom)         / 1440 * 96
```

A4 at 1-inch margins with no gutter gives `textColumnPx ≈ 601.7`, `pageContentPx ≈ 930.5`.

The **gutter** is Word's binding allowance — width taken from the text column on the
bound edge. A mémoire is a bound document, so a thesis that sets one and has it ignored
gets a column several percent too wide on *every* page, biasing the count in one
direction rather than adding noise. It is cheap to carry, so it is carried.

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

#### Unnumbered pages

A page is **unnumbered** when its owning section is a chapter divider (`dividerPage`) or an ornamented
front-matter page (`pageOrnament`). `add_divider_pages` builds these with no header and no footer
deliberately, and a dedication or acknowledgements page is unnumbered in a mémoire by convention.

An unnumbered page shows no number on the paper — which D5 already gives, since it has no footer — and
**no number in the gutter either**. The gutter names the page instead: *"divider page"* /
*"صفحة فاصلة"* / *"page de garde"*. Without this, D5 stamps a number onto the one page whose whole
point is not having one.

#### The two counting conventions

Universities differ on whether a divider page occupies a number. Both are expressible in Word, and the
Writer renders whichever the document encodes — it never picks (D7):

| | Page before | Divider | Page after | How the .docx says it |
|---|---|---|---|---|
| **Counted** | 5 | *(blank, but is 6)* | 7 | Nothing special. The divider is a physical page; Word counts it and its empty footer prints nothing. |
| **Not counted** | 5 | *(blank, no number)* | 6 | The section *after* the divider sets `pageNumberStart = 6`, restarting the count so the divider's number is consumed. |

**Counted is what ships today** — `add_divider_pages` builds a divider with no footer and no numbering
restart, so Word counts it. Rendering follows from the rules above with no special case: the page-break
accumulator advances the counter for every physical page, and *not counted* falls out of the existing
`pageNumberStart` reset. No new counting logic is required — only the `unnumbered` flag that suppresses
display.

A consequence worth stating: if a student's university uses *not counted* but their .docx does not
restart numbering, the Writer will show *counted*. That is correct — it is what Word will print — and
it makes a genuine formatting error visible instead of hiding it.

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
                                             // gutter, i.e. endingPage + 1 — "p. 14" below page 13.
                                             // When that page is unnumbered (§3) this is its NAME —
                                             // "divider page" — never a number.
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

**The real call sites, verified against source 2026-08-13.** This spec originally listed four.
Two of them were *comments* rather than calls, and it missed four genuine index-arithmetic
sites — the dangerous half. The corrected list:

| Site | What its index feeds |
|---|---|
| `$lexicalToBlocks` — `blockLexical.tsx` | serialization back to the block model |
| `$blockEntries` — `blockLexical.tsx` | drag/reorder from→to |
| `$nodeAtBlockIndex` — `LexicalDomEditor.tsx` | `applyBlockFormat`'s target for the native pill |
| `$anyNodeAtBlockIndex` — `LexicalDomEditor.tsx` | scroll-to-block, suggestions |
| `$rootChildBlockIndex` — `LexicalDomEditor.tsx` | `onState.index` for table/image selections |
| `$blockIndexOfNode` — `LexicalDomEditor.tsx` | **`onState.index` for every text selection — the index the AI dock sends to the server** |
| `$selectRows` — `LexicalDomEditor.tsx` | checkbox multi-select → bulk ops |
| `ScrollSyncPlugin.measure` — `LexicalDomEditor.tsx` | scroll restore |

Identity checks that must **stay** `$isChromeNode`: `findBand` / `findKey`, the three
chrome-preview swap/restore sites, and `onState`'s `cn` arm.

Do not trust this table either. Derive the list with
`rg -n '\$isChromeNode' components/ lib/ stores/ hooks/ app/` and judge each site by what it
asks — "skip this, it is not a block" widens; "is this specifically a chrome band" does not.

What the omission would have cost, concretely: with root children `[P0, PageBreak, P1, P2]`,
`$blockIndexOfNode` reports block 1 as **2** — the AI edits the wrong paragraph — and
`$nodeAtBlockIndex(1)` returns **null**, so a formatting tap silently does nothing. Three other
walkers were safe only by accident, because `PageBreakNode.getTextContent()` returns `""` and
their fallback counts only text-bearing nodes. Luck, not design.

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
6b. A chapter divider page shows no number on the paper **and none in the gutter** — the gutter names
    it. Same for an ornamented dedication / acknowledgements / abstract page.
6c. Both counting conventions render correctly: with no numbering restart the page after a divider is
    *divider + 1*; with `pageNumberStart` set on the following section it is *divider*.
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

## Pre-existing defects found during the walker audit

Neither was introduced by this feature and neither is fixed by it. Both index root children raw
with no display-only awareness, so **both are already wrong today** whenever a chrome band sits
above the target; page nodes only widen the blast radius.

1. **`RangeSuggestionPlugin` — destructive.** `LexicalDomEditor.tsx` ~2464-2469 calls
   `root.getChildren()[i]?.remove()` and `[r.start]?.replace(...)` with `r.start`/`r.end`
   arriving from native as *block-model* indices. With a band above the range it removes and
   replaces the **wrong nodes**. The correct mapping is `$anyNodeAtBlockIndex`, but the code
   assumes one root child per block index and a list violates that assumption differently than a
   band does — so this needs its own task and device QA, not a drive-by fix.
2. **`SelectionHighlightPlugin` — visual only.** ~2504-2505 indexes `kids[i]` with the store's
   `selectedBlocks`. Its comment calls those "root-child indices (canonical)"; `$selectRows`,
   which produces them, is block-model. Highlights the wrong block.

One more belongs to this feature rather than predating it: the chrome-preview swap (~625-708)
calls `setData` on `ChromeNode` only, so a header/footer **template preview will not repaint the
page bands**. That qualifies D4's "no new editing UI is built" claim — the picker works, but its
live preview is incomplete until the swap also targets page nodes.

## Deferred to v2

- **Calibration against the PDF pipeline.** On document open, fetch a true block→page map derived from
  the OnlyOffice conversion and anchor local measurement to it, correcting accumulated drift. This is
  the upgrade path from "formatting truth" to precision.
- **"Don't count this page" from the divider band.** A one-tap toggle in the divider's sheet that
  writes `pageNumberStart` on the *following* section, switching a document between the two counting
  conventions in §3. Genuinely useful — a student will not discover that restart alone — but it is a
  new `chrome-op` variant and therefore a write path, where v1 is rendering. Out of v1 deliberately,
  not by oversight.

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
