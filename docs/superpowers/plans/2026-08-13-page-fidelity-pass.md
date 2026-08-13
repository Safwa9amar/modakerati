# Page Fidelity Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Writer's page breaks land where Word lands them — by measuring at the document's real typography in a metric-compatible font, and by honoring Word's break rules (keep-with-next, space-before suppression, overflow carry, visible remainders).

**Architecture:** The server resolves each paragraph's *effective* format (size / line rule / space before-after) through the OOXML cascade into an optional `fmt` on the paragraph DTO. The app bundles Liberation Serif (metrically identical to Times New Roman), measures each block's clone at that typography, and upgrades the pure `paginate()` with three Word rules. The band renders the page's unused remainder. **Nothing about the page-view architecture changes** — same `PageBreakNode`, same `PAGES_TAG`/`pinned()` guards, same idle debounce.

**Tech Stack:** TypeScript. Server: vitest. App: no test runner — `npx tsc --noEmit` + `node scripts/verify-page-layout.mjs` + `node scripts/verify-use-dom.mjs`.

**Spec:** [2026-08-13-page-fidelity-pass-design.md](../specs/2026-08-13-page-fidelity-pass-design.md)

---

## Read this before Task 1

1. **Line numbers in this plan WILL be stale.** Locate everything with `rg`. Six plan errors were caught during the page-view build by implementers who verified against source instead of trusting the plan — keep doing that and report divergence.
2. **`LexicalDomEditor.tsx` is `'use dom'`: exactly ONE export, the default.** A named non-type export fails the whole editor at BUNDLE time; `tsc` cannot see it. Gate: `node scripts/verify-use-dom.mjs`.
3. **`~/modakerati-server` may be a shared checkout.** Stage only exact paths. Never `git add -A`. A `tsc`/test failure in a file you didn't touch is probably another session mid-write — re-run before investigating.
4. **Units, once and for all:** `w:sz` is **half-points** (22 → 11pt). `w:spacing @before/@after` are **twentieths of a point** (240 → 12pt). `w:spacing @line` is **240ths of a line** when `lineRule="auto"` (360 → 1.5×) and **twentieths of a point** when `exact`/`atLeast`. CSS: 1pt = 96/72 px.
5. **Arabic sizes come from `w:szCs`, not `w:sz`** — the established `w:cs` rule in this codebase. A bidi paragraph measured at the Latin size is wrong.

## File Structure

| File | Repo | Responsibility |
|---|---|---|
| `src/lib/para-format.ts` | server | **new** — pure OOXML format cascade resolver |
| `src/__tests__/para-format.test.ts` | server | its tests |
| `src/lib/thesis-doc.ts` | server | `ParaFmtDTO` on the paragraph DTO; resolver wired into `blockToDTO` via a per-engine cache |
| `lib/api.ts` | app | mirrored optional `fmt` |
| `assets/fonts/LiberationSerif-{Regular,Bold}.ttf` + `LICENSE` | app | **new** — the metric twin of Times New Roman |
| `lib/page-layout.ts` | app | `BlockFmt`, `paginate()` v2 (suppression / keep / carry / remainder), `numberPages()` on physical pages |
| `scripts/verify-page-layout.mjs` | app | new cases for every new rule |
| `components/workspace/lexical/LexicalDomEditor.tsx` | app | `@font-face`, typography-aware measurement, plugin wiring, font-ready re-measure |
| `components/workspace/lexical/blockLexical.tsx` | app | `remainderPx` on `PageBreakData`; the spacer render |
| `components/workspace/WorkspaceLexicalView.tsx` | app | thread `blockFmts` + `keepWithNext` through `pageSetup` |

---

## Task 1: Server — the format cascade resolver (pure)

**Files:**
- Create: `~/modakerati-server/src/lib/para-format.ts`
- Test: `~/modakerati-server/src/__tests__/para-format.test.ts`

Work on branch `feat/page-fidelity` (branch from `master`).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test, expect } from "vitest";
import { buildFormatResolver } from "../lib/para-format";

const STYLES = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Base"><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Child"><w:basedOn w:val="Base"/>
    <w:pPr><w:spacing w:before="240"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Loop"><w:basedOn w:val="Loop"/></w:style>
</w:styles>`;

const P = (pPr: string, runs = "") => `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;

describe("buildFormatResolver", () => {
  const fmt = buildFormatResolver(STYLES);

  test("docDefaults reach a bare paragraph", () => {
    expect(fmt(P(""))).toEqual({
      sizePt: 11,                                  // sz 22 half-points
      line: { rule: "auto", value: 259 / 240 },    // docDefaults line
      beforePt: 0,
      afterPt: 8,                                  // after 160 twips / 20
    });
  });

  test("the basedOn chain resolves, child overriding parent overriding defaults", () => {
    expect(fmt(P('<w:pStyle w:val="Child"/>'))).toEqual({
      sizePt: 12,                                  // Base's sz 24
      line: { rule: "auto", value: 1.5 },          // Base's line 360
      beforePt: 12,                                // Child's before 240
      afterPt: 8,                                  // still docDefaults
    });
  });

  test("direct pPr beats everything", () => {
    const p = P('<w:pStyle w:val="Child"/><w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/>');
    expect(fmt(p)).toMatchObject({ line: { rule: "auto", value: 2 }, beforePt: 0, afterPt: 0 });
  });

  test("the LARGEST run size governs the paragraph (that is what drives Word's line height)", () => {
    const p = P("", '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>a</w:t></w:r><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>b</w:t></w:r>');
    expect(fmt(p).sizePt).toBe(16);
  });

  test("a bidi paragraph sizes from szCs", () => {
    const p = P("<w:bidi/>", '<w:r><w:t>نص</w:t></w:r>');
    expect(fmt(p).sizePt).toBe(12);                // docDefaults szCs 24
  });

  test("lineRule exact carries points, not a multiplier", () => {
    expect(fmt(P('<w:spacing w:line="480" w:lineRule="exact"/>')).line).toEqual({ rule: "exact", value: 24 });
  });

  test("a basedOn cycle terminates instead of recursing forever", () => {
    expect(() => fmt(P('<w:pStyle w:val="Loop"/>'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run src/__tests__/para-format.test.ts` → cannot find module.

- [ ] **Step 3: Implement**

`buildFormatResolver(stylesXml: string): (paragraphXml: string) => ParaFmt`. Parse `styles.xml` ONCE
(regex over `<w:style>` elements is fine and matches this codebase's byte-level idiom — but scope each
style's `rPr`/`pPr` reads to its own element span, and remember `<w:txbxContent>` nests paragraphs, so
when reading a paragraph's own `pPr` take only the FIRST `<w:pPr>…</w:pPr>` before any txbxContent).

```ts
export type ParaFmt = {
  sizePt: number;
  line: { rule: "auto" | "exact" | "atLeast"; value: number }; // auto: multiplier; else points
  beforePt: number;
  afterPt: number;
};
```

Resolution order per field: direct `pPr`/run → style chain (`basedOn`, cycle-guarded via a seen-set,
depth ≤ 10) → `docDefaults` → hard fallbacks (`sizePt 11`, `line auto 1.15`, `before/after 0`). Run
size = **max** `w:sz` across the paragraph's own runs (largest run drives Word's line height); bidi
paragraphs (`<w:bidi/>` present, or `w:rtl` on runs) read `w:szCs` at every level instead.

- [ ] **Step 4: Run the tests** — all 7 pass.
- [ ] **Step 5: Commit** — `feat(document): resolve effective paragraph typography through the OOXML cascade` staging exactly the two files.

---

## Task 2: Server — `fmt` on the paragraph DTO

**Files:**
- Modify: `~/modakerati-server/src/lib/thesis-doc.ts`
- Test: append to `~/modakerati-server/src/__tests__/para-format.test.ts`

- [ ] **Step 1: Failing test** — load `assets/thesis-base.docx` via `Mdocxengine.loadFromFile`
(the static factory — the constructor is private), run `buildDocumentDTOFromEngine`-equivalent or
`blockToDTO` on a paragraph block, assert `dto.fmt` exists with `sizePt > 0` and `line.value > 0`.

- [ ] **Step 2: Wire it.** `blockToDTO(block, index, engine, listMap?)` has **three callers**
(`thesis-doc.ts` bulk map + two single-block echoes in `src/routes/thesis/blocks.ts`), so do NOT
thread a resolver parameter — cache it per engine:

```ts
const fmtResolvers = new WeakMap<object, (p: string) => ParaFmt>();
function resolverFor(engine: Mdocxengine): (p: string) => ParaFmt {
  let r = fmtResolvers.get(engine);
  if (!r) {
    const styles = (engine.zip as unknown as { readAsText(n: string): string }).readAsText("word/styles.xml") ?? "";
    r = buildFormatResolver(styles);
    fmtResolvers.set(engine, r);
  }
  return r;
}
```

In the paragraph branch of `blockToDTO`, attach `fmt: resolverFor(engine)(block.xml)`. Type it on the
paragraph DTO variant as `fmt?: ParaFmt` (optional — older cached DTOs). Use `readAsText`, never
`getFileAsString` (broken live — established engine gotcha).

- [ ] **Step 3: Full suite** — `npx vitest run --testTimeout=60000`. The exact-shape assertion in
`section-hf-dto.test.ts` does NOT cover paragraph DTOs, but `block-dto`-style tests might: if any
exact `toEqual` breaks because paragraphs gained `fmt`, update it in a **separate commit**, exactly as
the page-view Task 3 did.
- [ ] **Step 4: Commit.**

---

## Task 3: App — mirror `fmt`

**Files:** Modify `~/modakerati/lib/api.ts` (work on branch `feat/page-fidelity`).

- [ ] Add to the paragraph variant of `DocBlockDTO`, optional:

```ts
  /** Effective typography resolved server-side through the OOXML cascade —
   *  what the MEASURING host paginates with. Display typography is untouched.
   *  Optional: older cached DTOs predate it. */
  fmt?: {
    sizePt: number;
    line: { rule: "auto" | "exact" | "atLeast"; value: number };
    beforePt: number;
    afterPt: number;
  };
```

- [ ] `npx tsc --noEmit` → clean. Commit.

---

## Task 4: App — bundle Liberation Serif

**Files:** Create `~/modakerati/assets/fonts/LiberationSerif-Regular.ttf`, `-Bold.ttf`, `assets/fonts/LICENSE-Liberation`.

- [ ] **Step 1: Fetch the fonts** (SIL OFL — bundling is explicitly permitted; ship the license):

```bash
cd ~/modakerati && mkdir -p assets/fonts && cd /tmp \
  && curl -sL -o lib.tar.gz https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz \
  && tar xzf lib.tar.gz \
  && cp liberation-fonts-ttf-2.1.5/LiberationSerif-Regular.ttf liberation-fonts-ttf-2.1.5/LiberationSerif-Bold.ttf ~/modakerati/assets/fonts/ \
  && cp liberation-fonts-ttf-2.1.5/LICENSE ~/modakerati/assets/fonts/LICENSE-Liberation
```

If that release URL 404s, take the latest `liberation-fonts-ttf-*.tar.gz` from
https://github.com/liberationfonts/liberation-fonts/releases — the metrics are the point, any 2.x is fine.

- [ ] **Step 2: Import inside the DOM module.** Metro's default `assetExts` includes `ttf` (this
repo's `metro.config.js` is `getDefaultConfig` + nativewind, no exclusions). In
`LexicalDomEditor.tsx`:

```ts
// Metric twin of Times New Roman (SIL OFL). MEASUREMENT ONLY — display keeps the
// reading font. Imported here so the 'use dom' bundler carries it into www.bundle.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LIBERATION_REGULAR = require("../../../assets/fonts/LiberationSerif-Regular.ttf");
const LIBERATION_BOLD = require("../../../assets/fonts/LiberationSerif-Bold.ttf");
```

and append to the `CSS` template literal:

```css
@font-face { font-family: "Liberation Serif"; src: url("${LIBERATION_REGULAR}"); font-weight: 400; }
@font-face { font-family: "Liberation Serif"; src: url("${LIBERATION_BOLD}"); font-weight: 700; }
```

(`require` of an asset in a DOM component resolves to a bundler URL string. **If it resolves to a
number** — the classic RN asset id — wrap with `Image.resolveAssetSource`-equivalent is NOT available
in DOM; instead fall back to passing the URI as a serializable prop from the native side via
`Asset.fromModule(...).uri`. Try the require first; report which worked.)

- [ ] **Step 3: Gates.** `npx tsc --noEmit` (add a `declare module "*.ttf"` to the existing d.ts if
needed — check `nativewind-env.d.ts` siblings), and **critically** `node scripts/verify-use-dom.mjs`
— an asset require must not become a named export.
- [ ] **Step 4: Commit** (fonts + license + wiring). Note in the message that this adds ~800KB to the
bundle — the price of Word-identical line wraps.

---

## Task 5: App — pure rules: `BlockFmt`, `paginate()` v2, physical-page numbering

This is the heart of the pass. All in `lib/page-layout.ts` + `scripts/verify-page-layout.mjs`,
script-first.

**The v2 contract:**

```ts
export type BlockFmt = {
  sizePt: number;
  line: { rule: "auto" | "exact" | "atLeast"; value: number };
  beforePt: number;
  afterPt: number;
};

export type PaginateInput = {
  /** Core height incl. space-after, EXCLUDING space-before (separated for F3). */
  heights: number[];
  /** Space-before per block, px. Suppressed when the block starts a NATURAL page. */
  spaceBefore?: number[];
  pageContentPx: number[];
  forcedStarts: ReadonlySet<number>;
  /** Blocks that must not END a page (headings — keep-with-next). */
  keepWithNext?: ReadonlySet<number>;
  /** Word can split this block across pages (paragraphs true; image/table/textbox false). */
  splittable?: boolean[];
};

export type PaginateResult = {
  /** Block index starting each band-visible page (unchanged meaning). */
  starts: number[];
  /** 0-based PHYSICAL page index of each start — advances by >1 when a tall or
   *  overflowing splittable block consumed pages between two boundaries. */
  physPage: number[];
  /** Unused px on the page ENDING at boundary k (starts[k] opens page k, so entry
   *  k is the remainder of the page BEFORE it; entry for the final page appended
   *  last). 0 wherever a splittable block carried over (Word filled that page). */
  remainder: number[];
};
```

**The rules, in the order the accumulator applies them:**

1. **F3 suppression:** a block starting a page contributes `heights[i]` alone; its `spaceBefore[i]`
   is added only mid-page — or when the start is in `forcedStarts` (Word keeps space after a
   section/hard break; the reference: space-before is eaten at *natural* tops only).
2. **Break decision** unchanged: `used > 0 && used + before + h > limit`.
3. **F2 keep-with-next:** having decided block `i` starts the new page, pull back: while the previous
   page's last block is in `keepWithNext`, and moving it leaves that page non-empty, and ≤2 blocks
   have moved — move it. Recompute the new page's `used` from the moved blocks (first mover is now a
   natural page top → its space-before suppressed).
4. **F4 carry:** when the block that triggered the break is `splittable`, the page it left was
   conceptually FILLED by its first lines: `remainder[endedPage] = 0` and the new page opens with
   `used = h − (limit − usedAtBreak)`; if that still exceeds `limit`, the block consumed whole middle
   pages: advance `phys += floor(used / limit)`, `used %= limit`. When NOT splittable (image, table),
   the old behaviour: real remainder recorded, block moves whole; a lone block taller than the page
   still occupies pages alone (`phys` advances by `ceil(h/limit) − 1`).
5. `numberPages(starts, physPage, sections)`: the counter advances by `physPage[k] − physPage[k−1]`
   instead of `1` — pages consumed inside a tall block are counted even though no band marks them
   (recorded, accepted).

Also add the measurement helper the plugin will use (pure, testable):

```ts
/** CSS line-height px for a fmt, given the measured single-line height of the
 *  font at that size ("normal" leading — pass what the probe measured). */
export function lineHeightPx(fmt: BlockFmt, singleLinePx: number): number {
  if (fmt.line.rule === "exact") return fmt.line.value * PX_PER_PT;
  if (fmt.line.rule === "atLeast") return Math.max(singleLinePx, fmt.line.value * PX_PER_PT);
  return fmt.line.value * singleLinePx; // auto: multiplier × the font's real leading
}
export const PX_PER_PT = 96 / 72;
```

- [ ] **Step 1: extend `scripts/verify-page-layout.mjs` FIRST** with cases that pin every rule:
  - suppression: `spaceBefore` on a natural page-starter not counted; counted on a `forcedStarts` page.
  - keep: `[p, p, H, p]` where H is a heading that would end page 1 → H starts page 2. Chain `[H, H, p]` moves both; a page that would become empty does not move its only block.
  - carry-splittable: `heights [900, 600]`, limit 900, splittable both → boundary before block 1, `remainder[0] === 0`, `physPage === [0, 1]`, and block 1 opens with `used = 600 − 0`… use numbers where the spill is non-zero and assert `physPage` and a following block's placement.
  - carry-unsplittable: same but `splittable[1] = false` → `remainder[0] > 0`.
  - tall block: a 2050px splittable block at limit 900 → next boundary's `physPage` jumps by 3.
  - physical numbering: `numberPages` with `physPage [0, 3]` and decimal section → texts `["1", "4"]`.
  - `lineHeightPx`: auto 1.5 × single 14.7 → 22.05; exact 24pt → 32; atLeast max().
- [ ] **Step 2: watch the new cases fail** (old signature).
- [ ] **Step 3: implement** in `lib/page-layout.ts`. `paginate` keeps its name; the return type
  changes — `rg -n "paginate\(" components/ lib/ scripts/` and update every consumer **in this task**
  so the repo never sits broken: `PaginationPlugin` (destructure `starts`), the verify script.
- [ ] **Step 4:** `node scripts/verify-page-layout.mjs` — every old AND new check `ok`.
- [ ] **Step 5:** `npx tsc --noEmit` clean. Commit.

---

## Task 6: App — measure at document typography

**Files:** Modify `~/modakerati/components/workspace/lexical/LexicalDomEditor.tsx` (`measureBlockHeights`, ~line 605 — verify with `rg`).

- [ ] **Step 1: the single-line probe** (module-private — `'use dom'`!):

```ts
// Height of ONE line at `normal` leading in the measuring font — the base the
// auto multiplier scales (Word's 1.5× means 1.5 × the font's own leading, which
// for Liberation Serif is Times New Roman's). Cached per (sizePt, bold, rtl).
const singleLineCache = new Map<string, number>();
function singleLinePx(host: HTMLElement, sizePt: number, rtl: boolean): number {
  const key = `${sizePt}|${rtl ? "r" : "l"}`;
  const hit = singleLineCache.get(key);
  if (hit !== undefined) return hit;
  const probe = document.createElement("div");
  probe.style.cssText = `font-size:${sizePt * PX_PER_PT}px;line-height:normal;`;
  probe.style.fontFamily = rtl ? "sans-serif" : '"Liberation Serif", Georgia, serif';
  probe.textContent = rtl ? "نص" : "Hg";
  host.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  singleLineCache.set(key, h);
  return h;
}
```

- [ ] **Step 2: apply fmt to the clone.** Extend `measureBlockHeights(sources, columnPx, rtl)` with a
fourth parameter `fmts: (BlockFmt | null)[]` (positionally parallel to `sources`). For a block with
fmt: set on the clone `fontFamily` (Liberation for LTR, keep the tofu-safe sans for RTL — the
established WebView Arabic rule), `fontSize: fmt.sizePt * PX_PER_PT px`,
`lineHeight: lineHeightPx(fmt, singleLinePx(...)) px`, `marginTop/Bottom: 0`; return
`{ h: rectHeight + afterPx, before: beforePx }` — margins now come from the DTO, not `getComputedStyle`.
Blocks without fmt (tables, images, old caches) keep today's path with `before: computed marginTop`.
Cache key gains the fmt: `JSON.stringify(fmt)` component. Import `lineHeightPx`, `PX_PER_PT`,
`type BlockFmt` from `@/lib/page-layout` (type-only + value imports are fine to *import*; do not
re-export anything).
- [ ] **Step 3: font readiness.** Measured before the font loads = poisoned cache. In
`PaginationPlugin`'s effect:

```ts
    if (typeof document !== "undefined" && "fonts" in document) {
      (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => {
        if (cancelled) return;
        measureCacheClear();            // module-private helper beside the cache
        singleLineCache.clear();
        schedule();
      });
    }
```

- [ ] **Step 4:** gates (`tsc`, `verify-use-dom`). Commit.

---

## Task 7: App — thread `blockFmts` and `keepWithNext` through `pageSetup`

**Files:** `WorkspaceLexicalView.tsx`, `LexicalDomEditor.tsx` (prop type), plugin call site.

- [ ] `PageSetup` gains `blockFmts: (BlockFmt | null)[]` (from `blocks.map(b => b.kind === "paragraph" ? b.fmt ?? null : null)`) and `keepWithNext: number[]` (indices where `b.kind === "paragraph" && b.level > 0`). Both serializable. `splittable` is derived DOM-side from the same array (`fmt !== null` ⇒ paragraph ⇒ splittable) — no extra field.
- [ ] `PaginationPlugin.repaginate` passes them: `spaceBefore` from the measure result, `keepWithNext: new Set(setup.keepWithNext)`, `splittable`, and consumes `{ starts, physPage, remainder }`.
- [ ] `npx tsc --noEmit`. Commit.

---

## Task 8: App — the remainder spacer (F5)

**Files:** `blockLexical.tsx` (`PageBreakData`, `PageBreakBand`), `LexicalDomEditor.tsx` (populate it).

- [ ] `PageBreakData` gains `remainderPx: number` — the ending page's unused space **already scaled
to display** (`remainder[k] × editorColumnPx / textColumnPx`), rounded to 4px, capped at 240px so a
near-empty page cannot scroll forever. The plugin computes the scale from
`setup.sections[0].textColumnPx` and the measured `rootEl.clientWidth`.
- [ ] `PageBreakBand`: for `variant === "boundary" | "trailing"`, render
`<div style={{ height: remainderPx }} />` **above** the footer element (inside the paper, before the
sheet-end shadow). Zero renders nothing.
- [ ] The pagination **signature comparison must include `remainderPx`** — it is part of the band's
identity now; a changed remainder with unchanged boundaries must still rewrite.
- [ ] Gates. Commit.

---

## Task 9: Full verification

- [ ] `cd ~/modakerati-server && npx vitest run --testTimeout=60000` — green.
- [ ] `cd ~/modakerati && npx tsc --noEmit && node scripts/verify-page-layout.mjs && node scripts/verify-use-dom.mjs` — all green.
- [ ] **Device QA** (real device, the `m-moire-isp` thesis):
  - [ ] Page count within ~2 pages of Word's 123 (today: several pages off). Compare 3 spot headings' page numbers against Word.
  - [ ] No heading sits as the last block of any page.
  - [ ] A divider/forced page shows bottom whitespace before its footer band; ordinary text pages end near-flush.
  - [ ] Arabic thesis: paginates, no tofu anywhere (the Liberation family must never apply to RTL text).
  - [ ] Typing near a boundary: no stutter, autosave still fires (the `PAGES_TAG` guard untouched).
  - [ ] Toggle off → clean continuous flow; toggle on → bands return with remainders.
- [ ] Merge both repos to trunk; server restart; OTA per the release runbook (commit → build check not needed for JS-only → `runtimeversion:resolve` vs installed fingerprint → `publish-update.sh`).
- [ ] Memory update: fold findings into `page-view-in-writer.md` (append a "fidelity pass" section — measured typography, the 4 rules, the physical-page numbering).

## Risks

| Risk | Mitigation |
|---|---|
| Asset `require` in a `'use dom'` module misbehaves | The prop-URI fallback in Task 4; `verify-use-dom` gates the export rule either way |
| Fonts fail to load on device → wrong metrics silently | `fonts.ready` re-measure; cache cleared on arrival; fallback chain Georgia→serif is still closer than sans |
| `paginate` signature change misses a consumer | It has exactly two (plugin, script) — `rg` in Task 5 step 3 |
| Carry logic makes bands and numbers disagree confusingly | Bands stay at block boundaries by design; the spec records that hidden middle pages get no band |
| +800KB bundle | Regular+Bold only; no italics; noted in the Task 4 commit |
