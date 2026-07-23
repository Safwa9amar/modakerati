# Notion-style Insert Menu — Design

**Date:** 2026-07-23
**Status:** Approved (visual-companion brainstorm, 7 rounds + terminal Q&A)
**Branch:** `spike/lexical-bubble`
**Builds on:** [ai-bubble-dock](2026-07-20-ai-bubble-dock-design.md), [floating-draggable-pill](2026-07-20-floating-draggable-pill-design.md), [pill-motion](2026-07-20-pill-motion-design.md), [ai-table-proposals](2026-07-23-ai-table-proposals-design.md)

## Summary

A Notion-style **Insert** system for the Lexical thesis editor (Expo DOM component driven by native chrome). Typing `/` — or tapping a `+` in the dock — makes the floating **✦ bubble fly to the caret and bloom into an insert menu**. The menu has a **compact** state (recents + ✦ AI suggestions, no search) and a **full-screen searchable** state. Fully trilingual (ar/fr/en) and mirrors RTL↔LTR everywhere. Hard requirement: every language + both directions.

## Locked decisions (user)

- **Two triggers, one menu (Hybrid):** `/` typed in the editor **and** a `+` chip in `GlobalDockBar` open the *same* menu.
- **Native overlay architecture (Approach A):** the menu is a React Native overlay, not an in-DOM Lexical typeahead. `/` is detected inside Lexical and reported out via a callback; the menu is styled/i18n'd once in RN, so RTL/LTR mirroring is free and consistent with the dock/pill.
- **Motion — fly to slash & bloom (fast):** the ✦ travels **directly and quickly** onto the `/` caret, then the card **blooms out of that point** (spring), chips/rows staggering in. It is the same physical ✦ object morphing — not a separate popup. Mirrors for LTR (lands on the left caret, grows from top-left).
- **Compact state = Recents + AI, NO search:**
  - *مُستخدَم مؤخراً* — most/recently-used insert tools (short list, a pinned favorite allowed).
  - *✦ اقتراحات الذكاء* — context-aware AI chips that **insert or edit** via tools (e.g. "generate a table from this paragraph", "add the reliability equation", "turn this into a list").
  - *توليد صورة بالذكاء الاصطناعي* — shown as a **disabled "قريباً / coming-soon"** chip.
  - Grabber ↑ / ⤢ expands to full screen.
- **Full-screen state = search + all:** a big panel titled *إدراج في المستند* with a **search field** and every category as a vertical, divider-separated scrollable list. **Search exists only here.**
- **Filtering:** compact filters live from the `/query` text after the slash; full-screen filters from the search field.
- **Dismissible always:** tap-outside / `✕` / swipe-down / deleting the `/` closes it with no side effect (per the "AI asks must be dismissible" product rule).

## Block palette (categorized)

- **نص Text:** Heading H1–H3, Quote
- **قوائم Lists:** Bulleted list, Numbered list
- **وسائط وجداول Media & tables:** Table, Figure/Image, Divider
- **عناصر أكاديمية Academic:** Equation, Table of contents, Footnote
- **تخطيط Layout:** Page break
- **Excluded:** callout, code block, to-do.
- **Coming soon (disabled):** AI image generation.

## Behavior defaults (approved)

- **Placement — Notion-style:** if the current line is empty, **transform** it into the block (heading/quote/list) or **replace** it (structural blocks like table/figure); if the line has text, **insert after** it. The typed `/query` is always stripped before insertion.
- **Two-step input blocks:** picking **Table** swaps the menu to an **N×M size picker**; **Equation** swaps to a **math/LaTeX input** (LTR even in RTL docs — math is LTR); **Figure** opens the existing image picker; all other blocks insert immediately.
- **Persistence — reuse existing paths:** text blocks (heading/quote/lists) go through the Lexical `serialize → planOps → applyThesisOps` round-trip; structural blocks go through `thesis-doc-store.mutate` native ops. Local-first, consistent with today.

## Architecture & components

- **`stores/insert-menu-store.ts` (new):** Zustand store — `open: boolean`, `mode: 'compact' | 'full'`, `query: string`, `anchor: {x,y} | null`, `recents: BlockKind[]`, `aiSuggestions`, `pendingBlock` (for two-step). Actions: `openAt(anchor)`, `setQuery`, `expand()`, `close()`, `pickBlock(kind)`, `pushRecent(kind)`. Recents persisted (SQLite/AsyncStorage) like other local prefs.
- **`components/workspace/InsertMenu.tsx` (new):** the RN overlay. Compact card (recents + AI chips + coming-soon) and full-screen sheet (search + categorized list). Rendered near `FloatingPill` so the bubble→menu morph is one visual element. Uses `useThemeColors` + trilingual i18n; direction-aware layout (RTL/LTR). Reanimated springs for travel + bloom, following `pill-motion` conventions (respect Reduce Motion). Two-step sub-views: `TableSizePicker`, `EquationInput`.
- **`stores/floating-pill-store.ts`:** add an `insert` expanded mode + `anchor` so the existing ✦ bubble drives the travel/bloom morph instead of a second element.
- **Slash detection (Lexical), `components/workspace/lexical/LexicalDomEditor.tsx`:** a small plugin watches for `/` at block start or after whitespace, tracks the trailing query, and reports out via a new callback prop `onInsertTrigger({ query, caretRect })` (+ dismiss when the `/` is deleted or selection leaves). Mirrors the existing `CompletionPlugin` bridge pattern. Suppressed while a suggestion/range/table proposal is active.
- **`components/workspace/WorkspaceLexicalView.tsx`:** wire `onInsertTrigger` → `insert-menu-store.openAt`; pass an `insert` command back in.
- **Command channel, `stores/lexical-editor-store.ts` + EditorBridge switch (`LexicalDomEditor.tsx:392`):** `dispatch("insert", JSON.stringify({ kind, opts }))` with a new `case "insert"` that performs the transform/insert inside the editor (create node or transform current block), then triggers the serialize round-trip for text blocks.
- **`components/workspace/GlobalDockBar.tsx`:** add the `+` "Insert" chip → `insert-menu-store.openAt(caretOrDockAnchor)` in compact mode.

## Node model & new nodes

- **Reuse** existing heading/quote/list commands for text blocks.
- **New Lexical DecoratorNodes** in `components/workspace/lexical/blockLexical.tsx`: `DividerNode`, `EquationNode` (renders KaTeX/MathML; carries LaTeX + OMML). Register both in the `nodes` array (`LexicalDomEditor.tsx:1341`).
- **Table create** produces a `BlockDataNode` of kind `table` (today tables are edit-only — this is the first *create* path).
- **Block model `lib/api.ts` `DocBlockDTO` (:547):** add `divider` and `equation` kinds (equation carries `latex`/`omml`); `toc`/`footnote` are server-materialized.
- **New ops `lib/thesis-ops.ts` (:65):** `insertTable` (afterIndex, rows, cols), `insertDivider` (afterIndex), `insertEquation` (afterIndex, latex). Plus `planOps`/`lib/lexical-writeback.ts` learns to emit these on serialize where relevant.

## Server / .docx (Phase 3 blocks only)

- **Equation** → OMML in the .docx via mdocxengine (LaTeX→OMML on the server); rendered in editor via KaTeX.
- **Table of contents** → a TOC field / `set_toc` engine op (reuses front-matter numbering machinery).
- **Footnote** → footnote part authoring in mdocxengine.
- Follows the `chat-doc-tools` registration pattern (doc-tools.ts + mcp-bridge LIVE_DOCX_TOOLS + types.ts prompt) for any AI-driven insertion.

## AI suggestion chips (Phase 4)

- Context-aware chips generated from the current block/section via the existing AI suggestion pipeline (`getComposerSuggestions`-style, abort superseded, hide-when-empty). Chips can **insert** (generate+place a block) or **edit** (transform current block) and run through `sendMessageToAI` with block indices, protected by the existing confirm gates + doc history.
- Image generation chip is present but **disabled ("قريباً")** until the backend exists.

## i18n & RTL

- All labels, category names, titles, and the search placeholder added to `en`/`fr`/`ar` locale files.
- Menu, list rows, chips, search, grabber, and the bubble-travel target all mirror by direction. Equation/LaTeX input is LTR even in RTL docs; inserted block *content* direction follows the paragraph (per `fluid-block-editor` live per-paragraph direction).

## Phasing

- **Phase 1 (app-only, "Ready" blocks):** `/` + dock `+` triggers, bubble travel + bloom motion, compact menu (recents), full-screen search, and manual insert of Heading / Quote / Bulleted / Numbered / Figure / Page break (all reuse existing commands/ops). No server work.
- **Phase 2:** Table create (N×M picker) + Divider — new nodes + `insertTable`/`insertDivider` ops.
- **Phase 3 (server/.docx):** Equation, Table of contents, Footnote.
- **Phase 4:** ✦ AI suggestion chips (context-aware insert/edit); image-gen stays coming-soon.

## Verification

No JS test runner in the app — gate with `npx tsc --noEmit` + device QA per phase:
- Trigger from `/` and from dock `+`; bubble travels to the exact caret (RTL right-caret, LTR left-caret) and blooms; fast spring; Reduce Motion path.
- Compact recents populate/persist; `/query` filters live; AI chips render + fire (Phase 4); coming-soon chip is inert.
- Expand → full-screen search filters across all categories; `✕`/swipe/backdrop dismiss with no doc mutation.
- Placement: empty line transforms; text line inserts-after; `/query` stripped.
- Table N×M inserts a real table; Divider renders + persists; Equation LTR input → renders + round-trips to .docx (Phase 3).
- Persistence: text via serialize→planOps, structural via mutate; undo/redo + doc history intact.
- Full ar/fr/en pass, both directions.
