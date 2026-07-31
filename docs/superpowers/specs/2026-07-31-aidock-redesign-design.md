# AIDock redesign — scope-aware command bar

**Date:** 2026-07-31
**Status:** design approved, not implemented
**Surface:** Expo app (`~/modakerati`) only. No server or dashboard change.
**Supersedes the dock portion of:** `2026-07-20-ai-bubble-dock-design.md`

## Problem

`components/workspace/AIDock.tsx` (618 lines) is the AI-mode panel inside the
floating ✦ bubble. Device screenshots (2026-07-31, Arabic thesis) show four
distinct failures, all confirmed by the user:

1. **No hierarchy.** View toggles (Search, Section markers, Reorder, Select
   blocks) render as chips visually identical to AI actions (Summarize, Improve
   writing, Fix formatting, Translate). Nothing distinguishes "flip a mode in the
   editor" from "spend a model call".
2. **Too tall.** Seven-plus chips wrap onto three or four lines. The panel covers
   roughly 40% of the screen — including the text the student selected it to work
   on.
3. **Ask is buried.** The free-form ask — the only thing here a student can't do
   with a canned chip — is the last element, below the suggestion shimmer, and
   costs an extra tap to become an input.
4. **Suggested is noisy.** Shimmer bars are replaced by chips of a different
   size, reflowing the whole panel. In the whole-memoir screenshot they never
   arrived at all, leaving a labelled empty section.

There is a fifth problem the user named separately, and it is the most serious:

5. **The dock is blind to the selection.** It shows the same four chips whether
   nothing, one paragraph, or twelve blocks are selected — while
   `AIDock.sendPrompt` already routes five materially different ways underneath
   (in-place proposal, fill, table diff, range rewrite, plain chat). A
   single-paragraph ask returns a diff the student approves; a *gapped*
   multi-block ask edits the document directly with no review step. The two are
   byte-identical on screen. Students learn the difference by being surprised.

## Decisions locked with the user

| # | Decision | How it was taken |
|---|---|---|
| 1 | View toggles leave the AIDock entirely; it becomes purely AI | AskUserQuestion |
| 2 | Select + Reorder → `GlobalDockBar`; Section markers → header ⋮ menu | AskUserQuestion ("split by nature") |
| 3 | Layout A — "command bar": scope header, always-live ask input, one horizontal action row | Visual companion, `layout.html` |
| 4 | A2 — suggestions lead the action row, canned actions follow | Visual companion, `row-order.html` |
| 5 | Nine scope states, each with its own header, chips, and declared outcome | Visual companion, `scope-matrix.html` |

Mockups persist in `.superpowers/brainstorm/35201-1785521633/content/`.

## Design

### Layout

Three stacked rows inside the existing `dockPanel` (the panel chrome, position,
drag and keyboard lift stay owned by `FloatingPill`):

```
┌───────────────────────────────────────────┐
│ ✦ 4 adjacent sections · one passage    ✕  │  ScopeHeader
│ ┌───────────────────────────────────────┐ │
│ │ Ask about these 4 sections…        ↑  │ │  AskBar (always live)
│ └───────────────────────────────────────┘ │
│ [✦ توحيد الأسلوب] [↻ Rewrite as one] [⤡ →│  ActionRow (h-scroll)
└───────────────────────────────────────────┘
```

Target height ≈ 120px versus today's ≈ 260px.

- **ScopeHeader** — states the target *and the outcome*, plus a trailing ✕.
- **AskBar** — rendered always, not on demand. The scope tag that used to live
  inside it moves up into the header; the placeholder carries the scope instead.
- **ActionRow** — a single horizontally scrolling row. Suggestions first, canned
  actions after.

### The scope registry

New pure module `lib/ai-dock-scopes.ts`:

```ts
export type DockScopeKind =
  | "memoir" | "paragraph" | "emptyParagraph" | "heading"
  | "table"  | "image"     | "range"          | "scattered" | "chrome";

export type DockOutcome = "review" | "direct";

export function resolveDockScope(input: {
  indices: number[];
  selectedBlock: DocBlockDTO | null;
  scopeBlocks: { index: number; text: string; level: number }[];
  lexicalActive: boolean;
  chrome: boolean;
}): { kind: DockScopeKind; outcome: DockOutcome; actions: QuickAction[]; headerKey: string };
```

**`resolveDockScope` is pure and called during render**, deliberately not store
state — the same reasoning that made `resolveToolbarKind` pure in
`stores/toolbar-store.ts`. Routing it through the store would paint one frame of
the previous scope's chips on every selection change.

**Both the UI and the send routing read the same resolved value.** `send.ts`
switches on `kind`; it does not re-derive the route from its own chain of
conditionals. This is the load-bearing structural decision in this spec:

- The header's promise ("you'll review this change") and the actual behaviour
  cannot drift, because they are the same value.
- The ⚠️ **inline-suggestion routing invariant** — block-scoped asks must go
  through `useSuggestionStore.getState().request(...)` (the dedicated suggest
  endpoint), never `sendMessageToAI` (plain chat/tool-loop edits the document
  directly with no approve/reject) — stops being a comment that was already
  regressed once (fixed in `a8b14a8`) and becomes a property of the type.

### The nine states

Resolved in this exact order — the first match wins. Order matters: a heading is
a paragraph with a level, and an empty heading must resolve as a heading, not as
an empty paragraph.

| # | Kind | Trigger | Outcome | Header (en) | Chips |
|---|---|---|---|---|---|
| 1 | `chrome` | `chromeSelection != null` | `direct` | This header/footer section | Summarize · Improve · Translate |
| 2 | `memoir` | `indices.length === 0` | `direct` | Whole memoir | Summarize · Improve · Format · Translate |
| 3 | `table` | 1 block, `kind === "table"` | `review` | This table · you'll review the change | Check numbers · Add totals · Format table |
| 4 | `image` | 1 block, `kind === "image"` | `review` | This figure · you'll review the change | Write a caption · Improve caption · Translate |
| 5 | `heading` | 1 paragraph, `level > 0` | `review` | This heading · you'll review the change | Write the section · Reword title · Translate |
| 6 | `emptyParagraph` | 1 paragraph, `level === 0`, `!text.trim()` | `review` | Empty paragraph · AI will write it | Write it · Insert a table · Continue from above |
| 7 | `paragraph` | 1 paragraph, `level === 0`, has text | `review` | This paragraph · you'll review the change | Rewrite · Expand · Shorten · Translate |
| 8 | `range` | 2+ paragraphs, contiguous, Lexical active | `review` | N adjacent sections · rewritten as one passage | Rewrite as one · Shorten · Unify style |
| 9 | `scattered` | any other 2+ selection | `direct` | see below | **Select the gaps** · Summarize · Improve · Format |

A single selected block whose kind is neither paragraph, table, nor image (a
textbox, a chart, an unmapped OOXML block) falls through to `scattered`, which is
correct: no dedicated suggest endpoint exists for it, so the ask goes through the
plain send.

`scattered` is reached three ways and the header must not lie about which:

| Cause | Header (en) | `Select the gaps` shown |
|---|---|---|
| Gapped paragraph selection | N sections, not adjacent | yes |
| Contiguous, but the Lexical editor is not the active surface | N sections | no |
| Mixed kinds (a table among the paragraphs) | N blocks | no |

Table chips (state 3) are today's `tableActions` verbatim. States 4–8 replace the
one-size-fits-all four. Chip prompt strings are authored during implementation,
matching the tone of the existing `quickActions` prompts.

### Outcome vocabulary

Two outcomes, coloured from existing tokens in `constants/colors.ts` — no new
tokens:

| Outcome | Meaning | Token |
|---|---|---|
| `review` | Goes to a dedicated suggest endpoint and returns a proposal the student approves or rejects | `semanticSuccess` |
| `direct` | Goes to `sendMessageToAI`; the tool loop may edit the document immediately, with only the existing confirm gate protecting destructive tools | `semanticWarning` |

There is deliberately **no third "only chats" outcome**. Every `direct` state,
whole-memoir included, runs the agentic tool loop and can therefore change the
document — labelling the whole-memoir scope as harmless conversation would be
the same false reassurance this redesign exists to remove.

The colour tints the header's ✦ glyph and its text, so the distinction reads at a
glance without adding a row.

### "Select the gaps"

`scattered` exists because `AIDock.sendPrompt`'s contiguity check deliberately
refuses a range rewrite on a gapped set: `approveRange` replaces the whole span
`[min..max]`, so a selection of block 5 and block 30 would destroy the 24 blocks
between them that the student never picked. Correct, but currently invisible —
the student silently drops from a reviewable rewrite to a direct edit.

The `Select the gaps` chip calls
`useWorkspaceStore.getState().setSelection(blocks, true)` with every paragraph
block in `[min..max]`, which re-resolves the scope to `range` and restores the
reviewable path. Shown only when every selected block is a paragraph — filling a
gap that contains a table cannot produce a range rewrite.

### Loading behaviour

While suggestions are in flight (and `preferences.aiSuggestions` is on), the
ActionRow renders **two dim placeholder chips in the leading slots** — same
height, same radius, in the row rather than in a separate section. Consequences:

- The chips under the student's thumb do not move when results land.
- If the server returns more than two (screenshot 2 returned five), the extras
  append after the placeholders and push the canned actions rightward. That is a
  horizontal shift inside a scroller, not a reflow, and it cannot cause a
  mis-tap on the leading chips.
- Empty or errored → placeholders vanish, canned actions slide into the lead.
  There is no labelled empty section, because there is no section.

The existing fetch logic in `AIDock` (abort on scope change, `cancelled` guard,
preference gate) moves across unchanged.

### `inputOpen` semantics

`floating-pill-store`'s `inputOpen` changes meaning from *"does the input
exist"* to *"autofocus the input"*. The field name and all three entry points
stay as they are:

- `FloatingPill`'s own ✦
- `GlobalDockBar`'s pinned ✦ (also `show()`s a dismissed bubble)
- `BlockContextBar`'s `onAskAI`

`BlockComposer`'s `keyboardWillHide` `clearSelection` guard, which exempts dock
`inputOpen`, keeps working on the same field.

### Keyboard clearance

`FloatingPill`'s `DOCK_CLEARANCE = 240` is a fixed allowance sized for today's
four-row dock. At ~120px it would strand the dock well above the keyboard.
Replace it with a height measured via `onLayout` on the dock panel — a follow-up
already listed as deferred in the original dock work, which this redesign makes
both necessary and cheap.

### What leaves the dock

| Chip | New home | Notes |
|---|---|---|
| Search | *deleted* | Already exists in `GlobalDockBar` and the ⋮ menu |
| Select blocks | `GlobalDockBar` | Icon chip, active tint |
| Reorder | `GlobalDockBar` | Icon chip, active tint |
| Section markers | Header ⋮ menu | `Row` already renders a trailing check for `active`, as Focus mode does |
| Clear selection / Done selecting | ScopeHeader ✕ | Absorbed |

`GlobalDockBar`'s local `chip()` helper takes no `active` prop today; it gains
one that tints background and icon, matching how the AIDock chips signalled
active state.

The ✕ **clears the selection without leaving select mode** — matching today's
split, where `Clear selection` and `Done selecting` are separate controls.
Exiting the mode is the dock-bar toggle. No trap is possible: `GlobalDockBar` is
persistent for the whole workspace session.

### File layout

Following the precedent set by `components/workspace/bubble-tools/`:

```
lib/ai-dock-scopes.ts              (new) registry + resolveDockScope
components/workspace/ai-dock/
  AIDock.tsx                       (moved) shell — header + ask bar + action row
  ScopeHeader.tsx                  (new)
  AskBar.tsx                       (new)
  ActionRow.tsx                    (new) h-scroller + slot reservation
  send.ts                          (new) routing, switched on DockScopeKind
  index.ts                         (new)
components/workspace/AIDock.tsx    (deleted)
```

`ActionRow` uses `ScrollView` from `react-native-gesture-handler`, not React
Native's — nested inside the reorderable list, RN's loses the horizontal pan to
the list's gesture handler. `BlockContextBar` and `GlobalDockBar` both do this.

### Touched files

- `components/workspace/FloatingPill.tsx` — import path, measured clearance
- `components/workspace/GlobalDockBar.tsx` — two toggle chips, `active` on `chip()`
- `components/workspace/WorkspaceHeaderMenu.tsx` — Section markers row
- `locales/{en,fr,ar}.json` — new `aiDock.*` keys

## Non-goals

- The peek card (`2026-07-26-ai-bubble-peek-preview-design.md`) stays as
  specified and unimplemented. `setAwaitingReply(true)` continues to fire from
  the `direct` outcome only — exactly the states that route through
  `sendMessageToAI` today.
- No change to any server endpoint, prompt, or suggestion-generation logic.
- No change to `BlockContextBar` or the `bubble-tools/` toolbars — the formatting
  bubble is a separate surface and is out of scope.
- The voice chip stays deferred.
- Drag, dismiss, revive, and suppression behaviour in `FloatingPill` are
  untouched apart from the clearance constant.

## Risks

- **Locale files carry duplicate keys.** Edit them surgically. A
  `json.load`/`json.dump` round-trip drops keys and reformats the whole file.
- **The dock lays out by app language** (`useRTL()`), not the thesis's direction.
  A horizontal scroller must respect that: in an RTL app locale the row starts
  at the right and scrolls leftward.
- **Outcome wording must survive translation.** "You'll review the change" is a
  promise; a loose fr/ar rendering that reads as "the change is reviewed" would
  invert the meaning of the most important new element on the surface.
- **`range` depends on `lexicalEditorStore.active`.** In the native (non-Lexical)
  view a contiguous multi-paragraph selection resolves to `scattered`, because
  there is no node to render the range proposal into. Its header must then use
  the neutral "N sections" string and hide `Select the gaps` — there are no gaps
  to fill, and filling them would not change the outcome. Getting this wrong
  produces a header that lies in the one place the whole feature is meant to tell
  the truth.

## Verification

The Expo app has no JS test runner, so:

1. `npx tsc --noEmit` clean.
2. Device pass over all nine states, confirming for each that the header's
   declared outcome matches what actually happens on send.
3. Regression: dock-bar ✦ and BlockContextBar ✦ both focus the ask input; a
   dismissed bubble is revived by the dock-bar ✦.
4. Ask input clears the keyboard on a small screen with the measured clearance.
5. `preferences.aiSuggestions` off → no placeholders, canned actions lead.
6. RTL app locale: header, ask bar and scroller direction.
7. Select mode reachable and exitable from `GlobalDockBar` with the dock closed.
8. Gapped selection → `Select the gaps` → header flips to `range`/review.
