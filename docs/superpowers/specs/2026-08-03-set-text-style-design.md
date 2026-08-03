# `set_text_style` — one style tool for every part of the document

**Date:** 2026-08-03
**Status:** Design approved, not implemented
**Repos:** `~/mdocxengine`, `~/modakerati-server`, `~/modakerati` (app)

---

## 1. The problem

A student asked the assistant, in Arabic, to apply *Simplified Arabic 16* to the
body paragraphs of their thesis. The assistant loaded the advanced-formatting
tools, inspected them, and answered honestly that it **cannot** change the body
font — it can restyle headings, and it can set direction/alignment, and that is
all.

It was right, and the gap is worse than "one missing tool":

| Tool | Scope | Level | Font? | Size? |
|---|---|---|---|---|
| `set_heading_style` | Heading1–6, doc-wide | Word STYLE (`StylesManager`) | ✗ | ✓ |
| `format_paragraphs` | all body paragraphs | direct paragraph XML | ✗ | ✗ |
| `set_paragraph_format` | one paragraph | direct paragraph XML | ✗ | ✗ |
| `apply_formatting` | whole doc | regex over `document.xml` | ✓* | ✓* |

\* *nominally.*

Three separate defects sit behind that table:

**(a) No body-text tool exists.** Headings have a real style-level tool. Body
text — the thing a university norm actually specifies — has nothing.

**(b) `apply_formatting` is unreachable in practice.** It lives in the
advanced-formatting group and *is* visible in live-docx mode, but its entire
description is *"Apply the thesis's norm profile formatting deterministically.
Stage 4 of the pipeline."* That sentence tells a model nothing about fonts, so
no model reaches for it when asked about a font. It also takes zero parameters
(all-or-nothing from the assigned norm profile) and hard-fails when no profile
is assigned.

**(c) `apply_formatting` is broken anyway.** In
`mdocxengine/src/core/PartsManagers/FormattingManager.ts`, `applyFont` and
`applyFontSize` only **rewrite** existing `<w:rFonts>` / `<w:sz>` elements via
regex — they never **insert**. Against the seed thesis (0 `rFonts`, 0 `sz`
across 41 paragraphs) they match nothing, throw nothing, and still push onto
`applied`. A university norm profile reports success while changing nothing.
They also hit *every* `rFonts` in `document.xml` — headings, captions, table
cells, page numbers alike — with no notion of scope.

## 2. The cascade problem

OOXML resolution order (later wins):

```
docDefaults → table style → numbering → paragraph style → character style
            → direct w:pPr → direct w:rPr
```

Direct run formatting beats a style, always. That cuts both ways across the
corpus:

- **Seed theses** carry formatting on *nothing* — empty `docDefaults`, no
  `Normal` style, no `rFonts`/`sz` anywhere. A direct rewrite finds no targets.
- **Imported theses** carry formatting on the **runs** (`rFonts w:cs`, `rtl`,
  `szCs`). A clean style-level patch is correct, valid, and completely
  invisible.

Any tool that does only one of the two looks broken on half the corpus. This is
the central constraint of the design.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Style-level, with a target picker** | Every part of a document *is* a Word style. Setting the style is what makes the change stick for paragraphs added later. |
| D2 | **Ensure-then-patch** | `Normal` and `Caption` do not exist in the seed `styles.xml`. Creating a missing style is the normal path, not an error path. |
| D3 | **Style patch + surgical strip + direct-write fallback** | The only combination that is visible on *both* the seed and imported corpora without discarding formatting the student never named. |
| D4 | **Multi-target in one call; multi-select in the ask** | One save, one undo entry. The student picks parts; the model does not guess. |
| D5 | **Vague → ask, precise → apply** | The student's own rule. Encoded in the tool description, enforced by nothing else. |
| D6 | **Absorb `set_heading_style`; rebuild `apply_formatting` on the same primitive** | A fourth overlapping formatting tool is how the wrong tool gets called. |
| D7 | **Canonical `rPr` / `w:style` child ordering as a shared primitive** | `CT_RPr` and `CT_Style` are `xsd:sequence`. Two live bugs already trace to ignoring that. Makes the later `w:pPr` extension a drop-in instead of a new class of corruption. |
| D8 | **Gate it as destructive** | Consistent with `make_thesis_ready`; a wrong font across a 200-page thesis is precisely what the gate exists for. |
| D9 | **Fix the seed `thesis-base.docx` in scope** | A real `Normal` + populated `docDefaults` makes the tool's job trivial on every new thesis and clears 6 of 7 defects in the styles audit. |

### Explicitly out of scope (deferred, not rejected)

- **Paragraph properties** — `lineSpacing`, `alignment`, `spaceBefore/After`,
  `indent`. Deferred until the run-level path is proven on device. D7 exists so
  this is an additive change.
- **Table structure** — borders, widths, shading, cell margins. `w:tblPr` is an
  ordered sequence that has already made Word refuse a file once
  (see `hf-table-word-corruption`). The `tables` target touches **text only**.
- **Header/footer chrome** — already has a dedicated sheet and its own tools.
- **`format_paragraphs`** — direction/alignment is a different axis; unchanged.

## 4. The tool

```ts
set_text_style({
  targets:  string[],   // required, ≥1
  font?:    string,     // e.g. "Simplified Arabic"
  sizePt?:  number,     // points; written as half-points
  bold?:    boolean,
  italic?:  boolean,
  color?:   string,     // 6-digit hex, with or without '#'
})
```

At least one of `font`/`sizePt`/`bold`/`italic`/`color` is required; otherwise
`{ ok:false, error:"nothing to change" }`.

`targets` accepts:

```
body | headings | heading1..heading6 | title | captions | lists | tables | footnotes
```

`headings` expands to `heading1..heading6`. Unknown target names are rejected
with the valid list, never silently ignored.

## 5. The target registry

A target is a **paragraph predicate + a style binding**, not merely a style id.

| Target | Predicate | Style | Ensure? |
|---|---|---|---|
| `body` | paragraph outside `<w:tbl>`, no heading style, not Caption/List/Title | `Normal` | **yes** (`w:default="1"`) |
| `heading1..6` | paragraph with the matching heading style | `Heading1..6` | no (all present) |
| `title` | paragraph styled `Title` | `Title` | no |
| `captions` | paragraph styled `Caption` | `Caption` | **yes** |
| `lists` | paragraph styled `ListParagraph` / carrying `numPr` | `ListParagraph` | no |
| `tables` | paragraph inside `<w:tbl>` | `Normal` | **yes** (shared with `body`) |
| `footnotes` | paragraph in `word/footnotes.xml` | `FootnoteText` | no |

Seed `thesis-base.docx` currently defines: `Heading1–6`, `Title`, `Strong`,
`Hyperlink`, `ListParagraph`, `FootnoteText`, `FootnoteReference`,
`FootnoteTextChar`. It does **not** define `Normal`, `DefaultParagraphFont`, or
`Caption`.

`body` and `tables` deliberately share `Normal`. The style patch is common; the
**strip** is what makes each target independently visible. Picking `body` alone
leaves table-cell run overrides in place, so table text does not change — which
is the correct and expected behaviour.

## 6. The write

For each selected target, and for each property the student actually named:

**Step 1 — Patch the style.** Ensure the style exists (creating it with a
correct `CT_Style` child order if not), then merge the named properties into its
`w:rPr`, writing children in canonical `CT_RPr` order.

Two Arabic-critical details, applied everywhere a property is written — style,
strip-survivor, or direct fallback alike:

- `font` writes `w:rFonts` with **`w:ascii`, `w:hAnsi` *and* `w:cs`** set to the
  family. Omitting `w:cs` leaves Arabic runs on the old typeface, which is the
  exact bug this tool exists to fix. Existing `w:eastAsia` and `*Theme`
  attributes are preserved, not dropped.
- `sizePt` writes **both `w:sz` and `w:szCs`** (as half-points). `w:szCs` is the
  complex-script size; without it Arabic text keeps its old size.

The same pairing applies to `bold` (`w:b` + `w:bCs`) and `italic`
(`w:i` + `w:iCs`).

**Step 2 — Surgical strip.** Remove **only the property being set** from the
runs of that target's paragraphs:

| Property set | Stripped from runs |
|---|---|
| `font` | `w:rFonts` |
| `sizePt` | `w:sz`, `w:szCs` |
| `bold` | `w:b`, `w:bCs` |
| `italic` | `w:i`, `w:iCs` |
| `color` | `w:color` |

Everything else on the run — including `w:rtl`, `w:cs`, `w:highlight`,
`w:u`, `w:spacing` — is left byte-for-byte intact. The rule, stated once:
**a strip removes exactly the property the student named, in exactly the parts
they picked, and nothing else.**

This is what makes the style patch visible on an imported thesis, and it is the
one place the design knowingly discards original formatting. It is justified
because an explicit "apply this font" *is* a restyle request — distinct from the
`edit-preserves-original-style` product rule, which governs **edits** and
**new blocks**, where nothing was asked for.

**Step 3 — Direct-write fallback.** If a targeted paragraph would not resolve to
one of the target's styles, stripping would drop it to the *wrong* style. For
those paragraphs, write the property directly onto the runs instead.

The check is cheap — no cascade resolution:

| Paragraph | Resolves to | Action |
|---|---|---|
| no `w:pStyle` | `Normal` (the document default) | covered by the style patch **iff** the target's style is `Normal` (`body`, `tables`); otherwise direct write |
| `w:pStyle` in the target's style set | that style | covered by the style patch |
| `w:pStyle` outside the target's style set | some other style | **direct write** |

This guarantees the promise: *what you picked, changed.*

Step 3 is expected to be rare on a well-formed thesis and common on a messy
import. Its count is reported separately so the difference is visible.

## 7. Canonical OOXML ordering

Two shared, pure helpers in the engine:

- `canonicalizeRunProps(rPr)` — sorts children into `CT_RPr` sequence order:
  `rStyle, rFonts, b, bCs, i, iCs, caps, smallCaps, strike, dstrike, outline,
  shadow, emboss, imprint, noProof, snapToGrid, vanish, webHidden, color,
  spacing, w, kern, position, sz, szCs, highlight, u, effect, bdr, shd,
  fitText, vertAlign, rtl, cs, em, lang, eastAsianLayout, specVanish, oMath`
- `canonicalizeStyle(style)` — sorts children into `CT_Style` sequence order:
  `name, aliases, basedOn, next, link, autoRedefine, hidden, uiPriority,
  semiHidden, unhideWhenUsed, qFormat, locked, personal, personalCompose,
  personalReply, rsid, pPr, rPr, tblPr, trPr, tcPr, tblStylePr`

Every style/run writer goes through them. Two known bugs are fixed as a
consequence:

- `StylesManager.rewriteHeadingRunProps` prepends `<w:b/>` at position 0, but
  `CT_RPr` requires `rFonts` before `b` — so `set_heading_style` on an imported
  template (which has `rFonts` on its headings) currently emits invalid order.
- Every style in the seed `styles.xml` puts `w:rPr` before
  `w:basedOn`/`w:next`/`w:qFormat` — invalid sequence.

## 8. Ask flow

`ask_user` gains a `multiSelect` mode. The protocol change is minimal and
generic — every future question benefits, not just this tool.

```ts
// server: src/mcp/tools/interaction.ts
ask_user({ question, options?, allowFreeText?, multiSelect? })

// app: types/chat.ts
interface AskPayload {
  question: string;
  options: string[];
  allowFreeText: boolean;
  multiSelect?: boolean;   // NEW
}
```

`AskBottomSheet` (and `ComposerAsk`) in multi-select mode accumulate taps as
toggles behind a confirm button, then call the **existing**
`onAnswer(answer: string)` with the selections joined — `"Headings, Body text,
Tables"`. Nothing downstream moves: the answer is still sent back as a chat
message. The confirm button is disabled while nothing is selected.

`ai-asks-dismissible` still holds — ✕ / backdrop / swipe / hardware-back all
dismiss without answering, exactly as today.

**When to ask (tool description, D5):**

- *"Make the font Simplified Arabic 16"* → vague → `ask_user` with
  `multiSelect:true` and the target list.
- *"Apply Simplified Arabic 16 to the body text"* → precise → apply directly,
  do not ask.

## 9. Return value

```json
{
  "ok": true,
  "results": [
    { "target": "body",   "styleId": "Normal",   "styleCreated": true,
      "styleTouched": true, "runsStripped": 412, "directWrites": 0,
      "paragraphsAffected": 388 },
    { "target": "tables", "styleId": "Normal",   "styleCreated": false,
      "styleTouched": false, "runsStripped": 96, "directWrites": 12,
      "paragraphsAffected": 54 }
  ]
}
```

`ok:false` when **nothing** matched across all targets, with a reason. The
failure mode being fixed is a tool that claims success over an unchanged
document; the return shape must make that impossible to report.

## 10. Gate, undo, persistence

- Added to `DESTRUCTIVE_DOCX_TOOLS` in
  `modakerati-server/src/lib/ai/destructive-gate.ts`, following the
  `make_thesis_ready` precedent.
- `ActionPreview` text names the targets and the change — *"Body text + Tables
  → Simplified Arabic 16"* — so the confirm sheet reads as a summary of a
  decision already made, not a repeat of the multi-select question.
- Persistence follows the existing `withThesisDoc` load→mutate→save lifecycle:
  per-thesis lock, pre-edit snapshot for undo, engine cache invalidation,
  `updatedAt` bump. Footnote-part edits mean the write touches
  `word/styles.xml`, `word/document.xml` and `word/footnotes.xml` — all inside
  the one lock, one save.
- The DOCX doctor's automatic check+repair on write applies unchanged.

## 11. Seed asset fix (D9)

`modakerati-server/assets/thesis-base.docx` → `word/styles.xml`:

1. Define `Normal` (`w:default="1"`) and `DefaultParagraphFont` — 10 styles say
   `basedOn="Normal"` and 3 say `basedOn="DefaultParagraphFont"`; every
   inheritance chain currently dangles.
2. Populate `w:docDefaults` (currently literally
   `<w:rPrDefault/><w:pPrDefault/>`) with a font/size floor including `w:cs`.
3. Reorder every `w:style`'s children into `CT_Style` sequence order.
4. Give heading styles a `w:pPr` with `outlineLvl` and `keepNext`.
5. Set `w:cs`/`w:bidi`/`w:rtl` so Arabic stops depending on renderer defaults.
6. Reclassify `Strong` as a character style.

This is a committed binary asset and a critical seed — if it breaks, thesis
creation silently produces empty documents. It changes in **one commit of its
own**, verified by creating a thesis and opening the result in Word before
anything else lands on top of it.

## 12. Files touched

**Engine (`~/mdocxengine`)** — rebuild required for the server to see changes.

- `src/core/ooxml/canonicalOrder.ts` — **new**; the two ordering helpers (§7).
- `src/core/PartsManagers/StylesManager.ts` — `ensureStyle`,
  `setStyleRunProps`; `rewriteHeadingRunProps` routed through the canonicalizer.
- `src/core/PartsManagers/TextStyleManager.ts` — **new**; target registry,
  predicates, strip pass, direct-write fallback, per-target report.
- `src/core/PartsManagers/FormattingManager.ts` — `font`/`fontSize` delegate to
  the new path; `spacing`/`margins` unchanged.
- `src/Doc.ts` — `doc.setTextStyle(targets, props)`.
- Specs alongside, mirroring the existing `*.spec.ts` convention.

**Server (`~/modakerati-server`)**

- `src/mcp/tools/docx-styles.ts` — **new**; registers `set_text_style`.
  `set_heading_style` removed from `src/mcp/tools/docx-blocks.ts`.
- `src/mcp/doc-tools.ts` — wire the new group.
- `src/lib/ai/mcp-bridge.ts` — `LIVE_DOCX_TOOLS` add/remove; swap the tool name
  in the advanced-formatting `TOOL_GROUPS` entry (its keywords already cover
  `font`/`police`/`خط`).
- `src/lib/ai/types.ts` — tool description for the system prompt.
- `src/lib/ai/destructive-gate.ts` + `destructive-gate-io.ts` — gate + preview.
- `src/mcp/tools/interaction.ts` — `ask_user` gains `multiSelect`; the chat
  loop's ask frame carries it through.
- `src/mcp/tools/analysis.ts` — `apply_formatting` rebuilt on the new primitive.
- `src/lib/thesis-formatting.ts` — adapter follows.
- `src/mcp/__tests__/tool-registry.test.ts` — registry expectations.
- `assets/thesis-base.docx` — §11, separate commit.

**App (`~/modakerati`)**

- `types/chat.ts` — `AskPayload.multiSelect`.
- `components/AskBottomSheet.tsx`, `components/workspace/ComposerAsk.tsx` —
  multi-select mode.
- `lib/ai-service.ts` — parse `multiSelect` from the ask frame.
- `locales/{en,fr,ar}.json` — confirm-button label. Edit **surgically**; these
  files contain duplicate keys and a `json.load`/`dump` round-trip drops them.

## 13. Verification

- **Engine:** unit specs for the canonicalizers (round-trip ordering against a
  known-good `rPr`/`w:style`), for `ensureStyle` on a `styles.xml` with no
  `Normal`, and for the strip pass preserving `rtl`/`cs`/`highlight`.
- **Server:** vitest over the tool registry and the gate decision.
- **App:** `npx tsc --noEmit` plus running the app — there is no JS test runner.
- **OOXML validity:** run
  `modakerati-server/scripts/ooxml-validate/run.sh` on the output **before**
  concluding anything, and maintain its noise list. When Word refuses a file,
  that script runs first, ahead of any guessing.
- **Device QA (the actual acceptance test):** take the thesis from the original
  screenshot, ask in Arabic for *Simplified Arabic 16*, confirm the multi-select
  sheet appears, pick Body + Tables, approve the gate, and confirm the change is
  visible **in Word** — not only in the app preview.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Strip discards run formatting a student wanted | Strip is limited to the named property, in the picked parts. Snapshot ring covers undo. |
| Seed asset change breaks thesis creation silently | Its own commit; create-a-thesis + open-in-Word before anything stacks on it. |
| Two sheets in a row (pick targets → approve) | Preview text names the targets so it reads as a summary. Revisit after device QA if it grates. |
| Deleting `set_heading_style` breaks a saved prompt or an external MCP client | It is model-facing only; the registry test pins the change. |
| `tables` target hits a table style we did not anticipate | Text-only scope; borders/widths/shading are never written. |

## 15. Related

`edit-preserves-original-style`, `docx-styles-ooxml-cascade`,
`hf-table-word-corruption`, `caption-word-parity-audit`, `docx-doctor`,
`on-demand-tool-loading`, `ai-asks-dismissible`, `doc-history-ai-confirm`,
`thesis-base-docx-asset`, `locale-json-duplicate-keys`,
`app-verification-no-test-runner`.
