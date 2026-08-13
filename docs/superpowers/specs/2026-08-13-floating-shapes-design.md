# Floating shapes rendered where Word puts them

**Date:** 2026-08-13
**Status:** Design approved (option B — true positioning), not implemented
**Repos:** `~/modakerati-server`, `~/modakerati` (app)

## Problem

A chapter divider page in a real thesis (`m-moire-isp(31).docx`) is one carrier `<w:p>` holding
**two** drawings:

| In the paragraph | |
|---|---|
| `<pic:pic>` — the ornament frame (`rId22`) | inline drawing |
| `<wp:anchor>` — floating textbox (`wps:wsp` + `<w:txbxContent>`) | `wrapNone`, `behindDoc="0"`, 3.31×1.82in |
| its text | `LA DEMARCHE DE SOINS ET LE　　RAISONNEMENT CLINIQUE` |

`blockToDTO` in `src/lib/thesis-doc.ts` tests for a picture **first and returns**, so
`parseShapeTextBox` is never reached. The frame becomes an `image` block and **the title is dropped
before it ever reaches the DTO** — the editor cannot render it even in principle.

Word shows the title centred in the frame. The editor shows an empty frame.

## Measured scope

Every `<wp:anchor>` in that thesis was surveyed (30 of them). This is what must actually be supported:

| Axis | Values present |
|---|---|
| wrap | `wrapNone` ×24, `wrapTight` ×4, `wrapTopAndBottom` ×1, `wrapSquare` ×1 |
| positionH `relativeFrom` | `column` ×19, `page` ×8, `margin` ×3 |
| positionV `relativeFrom` | `paragraph` ×29, `page` ×1 |
| `behindDoc` | `0` (in front) ×21, `1` (behind) ×9 |
| shape kind | textbox ×13, picture ×10, other ×7 |

Corrected 2026-08-13 against the real file: an earlier draft of this table undercounted, listing only
22 of the 30 anchors. Exactly ONE anchor uses `align` rather than `posOffset`, and it uses it on both
axes — a floating native chart.

Two consequences:

- **`wrapNone` dominates.** Those shapes do not reflow text, so they can be rendered as an absolute
  overlay without disturbing block layout at all. `wrapTight`/`wrapSquare` do reflow in Word; v1
  renders them as overlays too and accepts that text does not flow around them.
- **Vertical is paragraph-relative in 29 of 30.** The editor knows each block's box, so V resolves
  exactly. Exactly one anchor is page-relative.

## The `<mc:AlternateContent>` trap

The file has 19 Choice/Fallback pairs, and 13 of the fallbacks are text boxes — hence 26
`<w:txbxContent>` for 13 shapes.

**But the duplicate is never a second `<wp:anchor>`.** The fallback is a VML `<w:pict>`/`<v:textbox>`,
which contains no anchor element at all. So a reader scoped to `<wp:anchor>` is immune *by
construction*; the doubling only bites a **document-level `<w:txbxContent>` scan** — which is exactly
what the existing `parseShapeTextBox` does. Strip fallbacks up front anyway, belt and braces.

Note also that **11 of the 30 anchors are bare** — never wrapped in `mc:AlternateContent` at all.

## Not a bug: the "ghost" text

The title looks doubled in Word. That is `w14:shadow` + `w14:reflection` on the run — a text effect,
not duplicated content. Do not try to de-duplicate it.

## Design

### Server — one DTO field, no new block kind

Any block may carry floating shapes. Rather than a new kind, add an optional `anchors` array to the
existing block DTOs:

```ts
export type AnchoredShape = {
  /** What the shape is. "other" round-trips but renders as a placeholder. */
  kind: "textbox" | "picture" | "other";
  /** Text content, when it is a textbox. Same shape as the existing textbox block. */
  lines?: TextBoxLine[];
  box?: TextBoxShape;
  /** Picture bytes, same inline/on-demand split as an image block. */
  dataUri?: string;
  hasMedia?: boolean;
  /** Placement, in EMU (914400 per inch) — the app scales them. */
  x: { from: "column" | "page" | "margin"; offsetEmu?: number; align?: "left" | "center" | "right" };
  y: { from: "paragraph" | "page" | "margin" | "line"; offsetEmu?: number; align?: "top" | "center" | "bottom" };
  widthEmu: number;
  heightEmu: number;
  /** true = painted BEHIND the text (Word's "Send Behind Text"). */
  behindDoc: boolean;
  /** Word's z-order among floating shapes. */
  z: number;
  wrap: "none" | "square" | "tight" | "through" | "topAndBottom";
};
```

`blockToDTO` stops returning early: it collects anchors from the paragraph **first**, then classifies
the block as it does today, and attaches `anchors` to whatever block it produced. The picture branch
keeps winning for the block's own kind — the fix is that the shape is no longer discarded.

### App — an overlay layer, scaled from true geometry

Each block renders as it does today. On top, an absolutely-positioned layer draws each anchor:

```
scale        = editorColumnPx / geometryFromSection(section.page).textColumnPx
leftPx       = originFor(x.from) + emuToPx(x.offsetEmu) * scale
topPx        = originFor(y.from) + emuToPx(y.offsetEmu) * scale
width/height = emuToPx(widthEmu|heightEmu) * scale
zIndex       = behindDoc ? 0 : 2      (block text sits at 1)
```

Origins:

- `x.from: "column"` → the content box's inline start (0 in the block's own coordinate space)
- `x.from: "margin"` → same as column for a single-column body
- `x.from: "page"` → content-box start **minus** the left margin, scaled — available from
  `DocSectionDTO.page.margins.left`
- `y.from: "paragraph"` → the carrier block's top
- `y.from: "page"` → deferred; falls back to paragraph-relative (one occurrence in a 123-page thesis)

The scale factor is exactly the page view's: `textColumnPx` from `lib/page-layout.ts`. That work is
what makes this tractable — without a true column width there is nothing to scale against.

RTL: `x` is an **inline-start** offset, not a left offset, so an Arabic document mirrors correctly.
Use logical `inset-inline-start`, never `left`.

## Found while building the server half

- **One of the 30 anchors lives in a table cell**, not a paragraph. The `table` DTO has no `anchors`,
  so 29 of 30 reach the app and that shape stays invisible.
- **`other` is not uniformly unknown decoration.** The 7 are 6 × `wordprocessingGroup` and **1 native
  chart**. Painting a placeholder over `other` would cover a chart that already renders as `svg`.
- **Double representation is emitted deliberately.** A floating textbox whose carrier holds no
  picture already becomes `kind:"textbox"` and renders inline as a card — and now *also* carries
  `anchors[0]` describing the same shape. Same for a lone floating picture (`kind:"image"`). Geometry
  is not silently dropped; **the app must pick one representation or it renders twice.** The divider
  case is clean: inline picture → `kind:"image"`, textbox → anchor, no overlap.
- **Pre-existing sizing bug (not introduced here).** `engine.media.extractInlineImage` takes the
  paragraph's FIRST `<wp:extent>`, which on a divider page belongs to the floating text box. So the
  frame's block reports **318×175px instead of its true 538×345px — every divider frame renders at
  ~59% size.**
- **Picture anchors do not re-send bytes the block already carries.** All 9 floating pictures resolve
  to the block's own image; sending them again cost 430KB, 26× the entire geometry payload, for zero
  new information. `hasMedia` still marks that bytes exist.
- ⚠️ `hasMedia` on an anchor has no addressable endpoint — `/document/media/:index` serves the block's
  first resolvable image. Honest for every case here; a second picture anchor on one paragraph would
  fetch the wrong bytes.

## v1 scope decisions (made during the app build)

- **Paragraph carriers do not render their anchors yet.** Only blocks that go through
  `BlockDataNode` (image / textbox / table / other) get the overlay. A `paragraph` block is a real
  editable Lexical node whose children the reconciler and the write-back round-trip own — injecting
  an overlay risks `$paraFromElement` and a blank editor. Covering it needs a zero-height
  display-only sibling node (the `PageBreakNode` pattern: registration + every `$isDisplayOnlyNode`
  walker + the pagination row walk). The divider case — the actual bug — is an `image` block and is
  fully covered. A paragraph carrying prose plus a floating picture still shows nothing.
- **The shape's CONTENTS scale with the shape.** Type size, insets, border weight and radius all
  multiply by the same factor — a 20pt title in a box scaled to 56% must not overflow a box Word had
  it fitting inside. `placeAnchor` returns `scale` for exactly this.
- **`y.from: "page"` pins to the carrier's top** rather than applying a page-origin offset against a
  paragraph origin, which would drop the shape hundreds of px over unrelated text. One occurrence.
- **`x.from: "margin"` is treated as `"column"`** — sanctioned for a single-column body; an
  approximation, not an identity.
- **An ornament block's anchors render nothing** — its `decorate` deliberately returns null before
  any anchor logic (there is no box to position against). A second silent drop beside the
  table-cell anchor above.
- ⚠️ Until the `extractInlineImage` first-`<wp:extent>` bug is fixed, the frame renders at the
  block's buggy 318px while the title scales by true geometry — close on a phone column, but they
  only line up exactly once the engine reads the picture's own extent.

## Non-goals for v1

- Text flowing *around* a shape (`wrapSquare`/`wrapTight` render as overlays; text runs under them).
- Editing a shape's text in place. It renders; the AI already edits these through its own tools.
- Rotation, `wp14:sizeRelH`, and the `other` shape kinds (rendered as a placeholder, round-tripped).

## Verification

- Server: vitest over a fixture with one carrier paragraph holding a picture **and** an anchored
  textbox — assert both the `image` kind and a populated `anchors[0].lines`, and assert exactly ONE
  anchor despite `mc:AlternateContent` storing it twice.
- App: `npx tsc --noEmit`, plus `node scripts/verify-use-dom.mjs` (the editor is a `'use dom'`
  module — no named exports).
- Device: the divider page shows its title inside the frame, at the right size, in both LTR and RTL.
