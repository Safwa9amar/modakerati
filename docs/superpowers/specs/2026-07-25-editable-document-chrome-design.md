# Editable document chrome in the Lexical writer

**Date:** 2026-07-25
**Status:** Design approved, ready for planning
**Repos touched:** `~/modakerati` (app), `~/modakerati-server` (server — read-only reuse, no new endpoints)

## Problem

The exported `.docx` has three structural things the writer never shows: a **running title at the top of the page** (docx header), a **page number / line at the bottom** (docx footer), and **points where a new section begins** (section breaks, which carry their own header/footer). Today the Lexical writer is fed a flat `DocBlockDTO[]` and renders only the flowing body. These structural pieces are visible only in the read-only `OutlineChrome` view — you cannot see or change them while writing.

Goal: surface top-of-page, bottom-of-page, and new-section markers **inside the editable writer**, each with its own context bubble, so a student can see and change them in place — **without using the words "header", "footer", or "section break"**, and in all three app languages (ar/fr/en).

## Key decisions (from brainstorming)

1. **Presentation = Inline bands (default).** The full running-title and bottom-of-page text render as tinted bands directly in the scroll, always visible. Collapsed chips and margin zones are kept as optional view modes but are not the default. Rationale: the user wants to "see the real page."
2. **Plain language, never jargon.** UI says what the thing *does*: "Top of every page" / "أعلى كل صفحة" / "Haut de chaque page"; "Bottom of every page"; "New section starts here". Fully trilingual.
3. **v1 scope = AI-first + safe toggles.** Tapping a band selects it; the bubble opens with one plain sentence explaining what it is, then **✦ Ask** as the primary action plus a few safe one-tap toggles. Raw free-text editing and delete-break are deferred to v2.

## Grounding constraint: the writer has no page model

The Lexical writer is a **continuous flow**, not a paginated surface. There is no reliable "page break" position in the editor. Therefore headers/footers are rendered **once at each section boundary** (the block index where a section starts — `DocSectionDTO.startBlockIndex`), which is exactly where the running text is defined and where it changes. The "repeats on every page" concept is conveyed by the bubble's explanatory sentence, not by injecting a band at every simulated page.

## Architecture

### Data (already exists — reused, not rebuilt)

- Server `DocumentDTO.sections: DocSectionDTO[]` (from `sectionHFDTO()` ← mdocxengine `SectionInfo`) already carries, per section: `startBlockIndex`, `header: { text } | null`, `footer: { text, pageNumbers: { format, startAt } | null } | null`.
- The app already receives `sections` in the `DocumentDTO`; it simply is not forwarded into the editor.
- Edits reuse existing server tools: `set_header` / `set_footer` / `set_section_header` / `set_section_footer` and the link-to-previous tool in `doc-section-link.ts`. **No new server endpoints in v1.**

> **Write-path constraint (discovered during recon).** The app has *no direct write path* for headers/footers today: the `ThesisOp` union has no header/footer op, and `lib/api.ts` has no header/footer endpoint. The **only** existing way to change one is the AI chat tool loop (`set_header`/`set_footer`, gated by the confirm flow). Therefore v1's single write mechanism is **✦ Ask** (which reaches those tools with no new code). Any *direct one-tap* toggle (restart numbering, skip first page, number style, delete break) requires a new `ThesisOp` + server op handler and is **v2**.

### App changes

1. **Forward sections into the editor.** `WorkspaceLexicalView` currently passes only `blocks` to `LexicalDomEditor`. Add a `sections` prop (serializable — it already is) alongside `blocks`.
2. **Render chrome bands in the Lexical tree.** In `blockLexical.tsx`, when building the tree (`$blocksToLexical`), inject chrome band nodes at each `startBlockIndex`:
   - a **bottom-of-page** band for the *outgoing* section (before the boundary),
   - a **new-section** divider at the boundary,
   - a **top-of-page** band for the *incoming* section (after the boundary).
   These are decorator nodes in the **`BlockDataNode` opaque-carrier style** (a new `ChromeNode`, or a reuse of `BlockDataNode` with a `chrome` payload), so they round-trip untouched and never serialize back into `DocBlockDTO`. They are **display-only in the tree**; edits go through the tools, not through `$lexicalToBlocks`.
3. **Bubble cases.** Extend `BubbleKind` in `lib/bubble-configs.ts` with `hfTop` / `hfBottom` / `hfSection` (chrome/terracotta color, chip glyphs ⊤/⊥/§). Rather than shoehorn into the 1400-line `BlockContextBar` (which is typed around a `selectedBlock: DocBlockDTO` that chrome does not have), render a dedicated lightweight **`ChromeContextBar`** component from `FloatingPill` when the selection is chrome. Each renders: chip glyph, plain type label, one explanatory sentence, then **✦ Ask** (primary) plus 1–2 **✦-seeded quick chips** (e.g. "Change the title", "Different title here") that open the AI input pre-targeted at this section.
4. **Selection wiring.** Tapping a chrome band selects the chrome node (a `NodeSelection`, exactly like `BlockDataNode` today) and `EditorBridge` reports it out via `LexicalState.blockType = "chrome:top|bottom|section"` + `index = startBlockIndex` + the anchor `y` (reusing the existing pipeline). `WorkspaceLexicalView.onState` routes a `"chrome:*"` blockType into a new `chromeSelection` field on `useWorkspaceStore` instead of `selectBlock`, so `FloatingPill` shows the chrome bubble instead of a text/table bubble.
5. **i18n.** New keys under `workspace.hf.*` in `locales/{en,fr,ar}.json` for every label, explanatory sentence, and tool. Edit surgically — the locale files have duplicate keys; never `json.load`/`dump`.

### View modes (optional, low priority)

The band/chip/zone rendering is a CSS/layout concern over the same nodes. Ship **Inline bands** only for v1; chips and zones can be a later per-user preference. Do not block v1 on them.

## v1 scope boundary

**In v1:** show top/bottom/section as inline bands at section boundaries, in plain trilingual language; select → `ChromeContextBar` bubble with the plain sentence, **✦ Ask**, and 1–2 ✦-seeded quick chips; edits route through the existing AI tool loop.

**Deferred to v2:** direct one-tap toggles that need a new write path (restart numbering, skip first page, number style, delete break); inline free-text editing of the running text; page-number-as-locked-token; first-time coach-mark; collapsed-chips and margin-zones view modes.

## Testing / verification

The app has **no JS test runner**. Gate with `npx tsc --noEmit` in `~/modakerati` and `~/modakerati-server`, plus on-device QA:
- Bands appear at the right section boundaries for a multi-section Arabic thesis (RTL) and a single-section doc (should show one top/bottom pair, or none if the section has no header/footer).
- Tapping each band shows the correct plain-language bubble; language switch re-localizes all of it; RTL layout is correct.
- ✦ Ask edits the right section's header/footer (verify via the exported docx and the `OutlineChrome` view staying consistent).
- The chrome nodes never leak into `$lexicalToBlocks` output (serialize round-trip leaves body blocks unchanged).

## Open questions (non-blocking; resolve during implementation)

1. Exact plain-language phrasing per language — validate "Top of every page / أعلى كل صفحة / Haut de chaque page" reads naturally with a native reader.
2. New `ChromeNode` class vs. reusing `BlockDataNode` with a `chrome` payload — decide during the node work; prefer whichever keeps `$lexicalToBlocks` cleanest.
3. Whether a section with a blank header (`header.text === ""`) shows an empty "add a title" affordance or nothing.
