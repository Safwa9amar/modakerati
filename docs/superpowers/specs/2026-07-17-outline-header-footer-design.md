# Outline Header & Footer Display — Design

**Date:** 2026-07-17
**Status:** Approved
**Scope:** `modakerati` (app) + `modakerati-server` (DTO builder)

## Problem

The workspace Outline mode renders only body blocks. Document headers and
footers — which the engine fully supports (per-section headers/footers, page
numbers, set by the AI chat tools `set_header` / `set_footer` /
`set_section_header` / `set_section_footer`) — never reach the app: the
document DTO has no header/footer data. Users must switch to the Word or PDF
view to confirm a header exists at all.

## Decisions (from brainstorm)

1. **Read-only in v1.** No tap action on header/footer chrome. Editing stays
   with the AI chat tools; ribbon Insert → Header/Footer/Page Number remain
   `status: "soon"`.
2. **Layout: page chrome + section markers** (Option C). Word-style grey
   header/footer zones at the top and bottom of the outline card, plus inline
   dashed divider chips wherever a section break changes the header/footer
   mid-document.
3. **Data flow: extend the document DTO.** No new endpoint; the data rides
   `GET /:id/document` and every edit-echo response, so the SQLite cache and
   optimistic store stay consistent for free.

## Design

### 1. Server — document DTO extension

`buildDocumentDTOFromEngine` (`src/lib/thesis-doc.ts`) adds to the
live-docx `DocumentDTO` variant:

```ts
sections: {
  startBlockIndex: number;   // index of the section's FIRST body block
  header: { text: string } | null;
  footer: {
    text: string;            // "" when the footer is page-numbers-only
    pageNumbers: { format: string; startAt: number | null } | null;
  } | null;
}[];
```

Extraction walks the body's `sectPr` elements in order (paragraph-level
`sectPr` closes a section; the body-level `sectPr` closes the last one),
resolves `headerReference` / `footerReference` rel ids through
`HeaderManager` / `FooterManager`, concatenates plain paragraph text from the
header/footer xml, and detects PAGE fields plus `w:pgNumType`
(format + start).

Known traps handled here:

- **Paragraph index ≠ block index.** `sectPr` position is a paragraph index;
  `startBlockIndex` must be mapped through `getBlocks()` (same gotcha as the
  section-break tools).
- **Graceful degradation.** Malformed or unreadable header/footer xml → that
  slot is `null`; the DTO build never fails because of chrome data.
- **No-text headers.** A header with no extractable paragraph text (e.g.
  image-only) is `null` — the app never renders an empty grey band.
- v1 reads each section's **default** header/footer only; first-page
  (`w:titlePg`) and odd/even variants are ignored.

An engine helper may be added if the managers don't expose enough (rebuild
mdocxengine for the server to see it — implementation plan decides).

### 2. App — data plumbing

- `lib/api.ts` mirrors the new `sections` field on its `DocumentDTO`.
- `stores/thesis-doc-store.ts` carries it automatically: the SQLite
  stale-while-revalidate cache and the edit-echo path both store the whole
  DTO.
- **Optimistic index shifts:** insert / delete / move ops shift block
  indices, so the store's optimistic patch applies the same arithmetic shift
  to every `startBlockIndex` (marker stays glued to the right row until the
  server echo re-syncs). No other section mutation happens client-side.

### 3. Outline UI (`components/workspace/OutlineReorderable.tsx`)

- **Header zone** → `ListHeaderComponent`: section 1's header text on a light
  grey band with a dashed bottom rule and a small HEADER tag chip. Scrolls
  with the content. Hidden when section 1 has no header.
- **Footer zone** → `ListFooterComponent`: section 1's footer text and/or a
  page-number sample derived from the real `pgNumType` (decimal → "1, 2, 3…",
  roman → "i, ii, iii…", localized digits in Arabic UI). Dashed top rule,
  FOOTER tag. Hidden when none.
- **Section markers**: rendered inside `renderItem`, *above* the block whose
  `index` equals a section's `startBlockIndex` (sections 2+ only, and only
  when that section's header/footer differs from the previous section's —
  shallow compare of the DTO fields: header text, footer text, page-number
  format/start).
  Dashed divider + chip summarizing what changed ("new section · header: …",
  "footer: …"). Not draggable — pure decoration inside the row container.
- **The reorderable `data` array stays blocks-only.** Chrome must never enter
  the list data: drag from/to positions map directly to engine block indices.
- **Styling:** hardcoded light tones matching the card's white paper metaphor
  (like the existing `#FFFFFF` card, not theme-driven). Text direction
  follows the existing `rtl` prop; the tag chip sits on the side opposite the
  text. Header/footer text clamps to 2 lines.
- **i18n:** new trilingual keys (en/fr/ar) for HEADER, FOOTER, "new section",
  and numbering-format samples.
- **Empty state:** no header + no footer + single section → the outline looks
  exactly like today.

### 4. Out of scope (v1)

- Tap-to-edit header/footer (chrome is inert).
- First-page / odd-even header variants.
- Rendering images or tables inside header/footer chrome.
- Wiring the ribbon Insert → Header/Footer/Page Number actions.

## Error handling

- Server extraction failures degrade per-slot to `null` (see above).
- App renders nothing for `sections: undefined` (older cached DTOs) — fully
  backward compatible.

## Verification

- **Server:** unit test the section extraction against a fixture docx with
  two sections, distinct headers, and roman + decimal page numbering; plus a
  no-header/no-footer doc (expects `header: null` / `footer: null`).
- **App:** no JS test runner — gate with `npx tsc --noEmit` and a manual run:
  an Arabic thesis with per-section headers (zones + markers, RTL), and a
  fresh thesis with none (unchanged outline).
