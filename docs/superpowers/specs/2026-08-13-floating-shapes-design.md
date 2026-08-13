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
| positionH `relativeFrom` | `column` ×18, `page` ×7, `margin` ×3 (all `posOffset` but one `align:left`) |
| positionV `relativeFrom` | `paragraph` ×21, `page` ×1 (all `posOffset` but one `align:top`) |
| `behindDoc` | `0` (in front) ×21, `1` (behind) ×9 |
| shape kind | textbox ×13, picture ×10, other ×7 |

Two consequences:

- **`wrapNone` dominates.** Those shapes do not reflow text, so they can be rendered as an absolute
  overlay without disturbing block layout at all. `wrapTight`/`wrapSquare` do reflow in Word; v1
  renders them as overlays too and accepts that text does not flow around them.
- **Vertical is paragraph-relative in 21 of 22.** The editor knows each block's box, so V resolves
  exactly. Only one anchor is page-relative.

## The `<mc:AlternateContent>` trap

The file has **26 `<w:txbxContent>` for 13 shapes** — each is stored twice, as a modern `wps:wsp`
(`mc:Choice`) and a VML `v:textbox` (`mc:Fallback`). A reader that takes both renders every title
twice. **Always read `mc:Choice` and ignore `mc:Fallback`.**

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

## Non-goals for v1

- Text flowing *around* a shape (`wrapSquare`/`wrapTight` render as overlays; text runs under them).
- Editing a shape's text in place. It renders; the AI already edits these through its own tools.
- `y.from: "page"`, one occurrence — falls back to paragraph-relative.
- Rotation, `wp14:sizeRelH`, and the `other` shape kinds (rendered as a placeholder, round-tripped).

## Verification

- Server: vitest over a fixture with one carrier paragraph holding a picture **and** an anchored
  textbox — assert both the `image` kind and a populated `anchors[0].lines`, and assert exactly ONE
  anchor despite `mc:AlternateContent` storing it twice.
- App: `npx tsc --noEmit`, plus `node scripts/verify-use-dom.mjs` (the editor is a `'use dom'`
  module — no named exports).
- Device: the divider page shows its title inside the frame, at the right size, in both LTR and RTL.
