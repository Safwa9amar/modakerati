# "This operation is not supported" — while holding the tool

**Date:** 2026-08-12
**Status:** Implemented 2026-08-13 (`~/modakerati-server`, branch `feat/writer-page-view`). Full suite
1112 passing, `tsc --noEmit` clean. Not yet deployed — see *Implementation notes* at the end for the
four places the build deviates from this design, and what is still only logged rather than acted on.
**Repos touched:** `~/modakerati-server` (all of it)

## Problem

A student asked to clean the blank lines out of their mémoire. The transcript, in order:

> **Assistant:** هل تريد حذف جميع العناوين الفارغة من المذكرة مع الإبقاء على الفقرات الفارغة
> المستخدمة للمسافات وتنسيق الصفحات؟
> *(Shall I delete all the empty headings, keeping the empty paragraphs used for spacing and page
> formatting?)*
>
> **Student:** احذف العناوين والفقرات الفارغة معًا
> *(Delete the headings and the empty paragraphs together.)*
>
> **Assistant:** تعذّر حذف جميع العناوين والفقرات الفارغة تلقائيًا لأن هذه العملية غير مدعومة حاليًا.
> تم تمرير هذه الحاجة إلى الفريق. يمكنك تنفيذها يدويًا في Word عبر: الصفحة الرئيسية ← إظهار/إخفاء ¶ …
> *(Deleting all the empty headings and paragraphs automatically failed, because this operation is
> not currently supported. This need has been passed to the team. You can do it manually in Word
> via: Home → Show/Hide ¶ …)*

Four things went wrong in that one reply, and only the first is the one it looks like.

1. **The claim is false.** `delete_block` and `delete_blocks` are both in `LIVE_DOCX_CORE`
   ([mcp-bridge.ts:37](../../../../modakerati-server/src/lib/ai/mcp-bridge.ts#L37)) — loaded on
   *every* turn, no `load_tools` round trip. The prompt catalogue even spells out this exact shape:
   "Scattered blocks go in `indices:[…]` — they do not have to be next to each other"
   ([types.ts:483](../../../../modakerati-server/src/lib/ai/types.ts#L483)). The tool was in its
   hand and the instruction was in its prompt.
2. **It reneged on its own offer.** It proposed the operation, the student accepted, and it then
   refused. The student did not ask for something new — they answered a yes/no question.
3. **It handed the work back.** "Do it in Word via Home → Show/Hide ¶" is the app admitting it is not
   the tool for its own job.
4. **It filed a feature request for a capability we ship.** That row is now in
   `ai_missing_tool_log`, competing for priority with real gaps.

The suggestion chips underneath the refusal — *اعرض قائمة الحذف* (show the deletion list), *حدّد
المواضع* (locate the positions) — were still offering the operation the message had just declared
impossible.

### Why it actually failed

The model was right that it could not do it. It was wrong about why, and the wrong reason is the one
it told the student.

**There is no way to ask the document "which blocks are empty?"** `find_in_thesis`
([docx-read.ts:147](../../../../modakerati-server/src/mcp/tools/docx-read.ts#L147)) matches blocks
whose text *contains* a query; emptiness is not a substring and cannot be expressed. That leaves
`read_thesis_blocks` ([docx-read.ts:63](../../../../modakerati-server/src/mcp/tools/docx-read.ts#L63)),
which returns a **40-block window**. A finished mémoire is roughly 1,200–1,800 blocks, so a full sweep
is 30–45 read calls against `MAX_STEPS = 32`
([tool-loop.ts:392](../../../../modakerati-server/src/lib/ai/tool-loop.ts#L392)). The turn exhausts
its step budget **before it can issue a single delete**.

So the honest sentence was *"I can delete them, but I have no way to find them without reading your
whole thesis a page at a time."* The model compressed that into "not supported" — and there is
nothing in the system that notices the difference.

**And the delete it would have reached for is unguarded for this case.** `delete_blocks` anchors on
`expectFirstSnippet`/`expectLastSnippet`, and runs with no approval prompt precisely because those
anchors are its guard ([destructive-gate.ts:9](../../../../modakerati-server/src/lib/ai/destructive-gate.ts#L9)).
But the anchors are checked as `if (expectFirstSnippet && expectFirstSnippet.trim() && …)`
([docx-blocks.ts:320](../../../../modakerati-server/src/mcp/tools/docx-blocks.ts#L320)) — and the
anchor text of an *empty* block is `""`. Every guard falls through. A list of 60 scattered indices,
gathered over 30 read calls while nothing held the document lock, would be applied with **no safety
check of any kind**. Had the model tried, the failure mode was worse than the refusal.

### Why the false-claim guard let it through

`report_missing_capability` is already checked before it is believed
([mcp-bridge.ts:695](../../../../modakerati-server/src/lib/ai/mcp-bridge.ts#L695)) — the comment
above it even names `delete_blocks` as the case that motivated it. Two checks:

| Check | Condition | Why it missed this turn |
|---|---|---|
| 1 — named a real tool | `suggestedTool` resolves to a registered, visible tool | Only fires if the model *names* the tool. A report that says "bulk cleanup of empty blocks" names nothing. |
| 2 — never looked | `loadCalls === 0` **and** a matched group has unloaded tools | Disabled outright once the model has called `load_tools` even once. |

Check 2 is backwards. A turn that called `load_tools`, matched nothing useful, and gave up is *more*
likely to be wrong than one that never looked — it is the hunting pattern the bridge already detects
and logs as `source: "hunt"`. Today, hunting buys immunity from the check.

There is also a third hole, and it is the one that reached the student. **The guard protects the
backlog, not the student.** It returns advisory text to the model — `"Not filed — X EXISTS…"` — and
nothing forces the model to act on it. A perfectly blocked report still leaves the model free to
write "غير مدعومة" and move on. Every mechanism we have here defends the database.

## Goal

The assistant either does what it offered, or says the true and specific reason it cannot — and the
system verifies that, rather than trusting it. Concretely: "remove the empty headings and paragraphs
from my thesis" completes in one turn, without deleting anything load-bearing.

## Non-goals

- A general document-linting suite. This is one predicate (emptiness) done correctly, with a finder
  shaped so the next predicate is cheap.
- Raising `MAX_STEPS`. The fix is to make the operation cost 2 steps, not to buy the model 40.
- Gating deletes behind the approval sheet. `delete_block`/`delete_blocks` are deliberately ungated
  and anchored instead; this design fixes the anchor rather than switching models.
- Making the model's prose reliable by asking it more firmly in the prompt. The prompt already says
  the right thing. That is the evidence that prompt text is not the lever here.

## Decisions

**D1 — Emptiness is a document question, so the document answers it.** A new `find_blocks` read tool
runs the predicate server-side over all blocks and returns exact indices. The alternative — teaching
the model to page the document — is what already failed, and would still cost 30+ steps.

**D2 — A general finder, not a `remove_empty_blocks` verb.** The house precedent points the other way:
`remove_table_of_contents` exists as an atomic verb because a TOC span "is not a `delete_blocks` range
the model can compute safely"
([docx-apparatus.ts:382](../../../../modakerati-server/src/mcp/tools/docx-apparatus.ts#L382)). That
argument does not transfer — a finder returns *exact* indices, so there is no span to guess. And the
finder pays for itself across asks a bespoke verb cannot serve: blocks carrying equations, image-only
paragraphs, duplicate headings, headings with no body under them. The composition stays one hop:
`find_blocks` returns a ready-to-pass `indices` array.

**D3 — Structural empties are never swept, whatever the student said.** The student's "delete them
together" overrode the assistant's conservative default about *spacing* paragraphs. It was not
permission to delete their section breaks. A blank-looking block that carries a section break, a page
break, an equation, an ornament anchor, or a bookmark is **reported, never deleted** by a bulk sweep.
The student asked to remove blank lines; they did not ask to re-paginate their thesis.

**D4 — The delete gets a predicate anchor, because a snippet anchor cannot exist here.** `delete_blocks`
takes `expectAllEmpty`, re-verified inside the thesis lock. This is not a new safety model — it is the
existing "anchor the target, refuse on mismatch" contract, expressed for targets whose distinguishing
property is that they have no text.

**D5 — A capability report must carry evidence, and the answer is checked too.** The claim gate moves
from "did you look?" to "what did you try?", and a second check reads the student-facing text the same
way `no-index-leak.ts` reads it for indices — because the existing guard demonstrably stops a bad row
without stopping a bad answer.

## Design

### 1. `find_blocks` — the missing read primitive

Live-docx read tool, registered in `src/mcp/tools/docx-read.ts`, added to `LIVE_DOCX_CORE`.

```
find_blocks({ thesisId, predicate, kinds?, fromIndex?, toIndex? })
```

`predicate` (v1): `"empty"` — no visible text after folding.

Returns every match in one call, each classified:

```jsonc
{
  ok: true,
  blockCount: 1482,
  matched: 71,
  deletable: 63,
  // ready to hand straight to delete_blocks
  indices: [12, 13, 47, …],
  blocks: [
    { index: 12, kind: "heading", level: 2, empty: true, deletable: true },
    { index: 47, kind: "paragraph", empty: true, deletable: true },
    { index: 88, kind: "paragraph", empty: true, deletable: false, holds: "section-break" },
    { index: 91, kind: "paragraph", empty: true, deletable: false, holds: "math" }
  ],
  kept: { "section-break": 4, "page-break": 2, "math": 2 },
  note: "…"
}
```

**A block is `empty` when** its kind is `paragraph` or `heading`, and its folded text is blank. Never
`table`, `image`, `chart`, or `other` — those have no text by nature and are not blank lines.

**It is `deletable: false`, with `holds`, when the underlying XML carries any of:**

| `holds` | XML | Why it must survive |
|---|---|---|
| `math` | `<m:oMath>` | Word stores equations outside `<w:t>`. `read_thesis_blocks` already warns that an empty-reading line "is an EQUATION, never a blank line to tidy away" — this makes the warning enforceable instead of advisory. |
| `section-break` | `<w:sectPr>` | Carries the page layout of everything *before* it. Deleting it silently re-paginates the whole preceding section. |
| `page-break` | `<w:br w:type="page"\|"column">` | The student's own deliberate pagination. |
| `drawing` | `<w:drawing>`, `<w:pict>` | Page ornaments need their own carrier paragraph; deleting it removes the ornament. |
| `bookmark` | `<w:bookmarkStart>` | A caption, cross-reference or TOC target. Deleting it breaks the reference that points at it. |
| `field` | `<w:fldChar>`, `<w:instrText>` | A field whose result is currently empty is still a field. |
| `last-block` | final body block | Word requires a trailing paragraph. |

The engine already exposes per-block XML — `read_thesis_blocks` reads
`doc.engine.document.getBlocks()` for exactly this reason
([docx-read.ts:96](../../../../modakerati-server/src/mcp/tools/docx-read.ts#L96)) — so the classifier
is a pure function over that XML and unit-testable without a document.

**Why empty headings matter more than empty paragraphs**, and why the model was right to raise them
first: a heading style on a blank line puts a **blank entry in the table of contents**. That is the
visible damage, and it is worth saying to the student.

### 2. `delete_blocks` gains `expectAllEmpty`

```
delete_blocks({ …, indices, expectAllEmpty?: true })
```

When set, inside the lock and before any mutation:

- every target must still be empty by the §1 definition → otherwise refuse the **whole** call and
  return the offending index and its current text, matching the existing `refused: true` shape;
- every target must be `deletable: true` → otherwise refuse, listing what each holds.

Refusing the whole batch (never a partial sweep) is the existing contract, and it is what makes a
stale index list safe: between the finder and the delete, the only thing that can change is the
document, and any change breaks the predicate.

`expectAllEmpty` is additive — `expectFirstSnippet`/`expectLastSnippet` keep working unchanged for
text-bearing ranges.

### 3. The claim gate: evidence, not intent

In `mcp-bridge.ts`, `report_missing_capability`:

- **Add `attemptedTools: string[]`, required.** The bridge already sees every call this turn; each
  named tool is verified against that record. An empty list, or a list of tools it never actually
  called, is refused: *"You have not tried anything. Call X, then report only if it genuinely fails."*
  This replaces intent-checking with a fact the bridge already holds.
- **Drop `loadCalls === 0` from check 2.** Run it on the matched groups alone. A turn that hunted and
  gave up is the case the check exists for.
- **Add check 3 — the core toolset already does this.** Score the capability text against a keyword
  index over `LIVE_DOCX_CORE` built with the same `termsOf` folding as `GROUP_KEYWORDS`, so it works
  in ar/fr/en. `delete`/`remove`/`empty`/`blank`/`حذف`/`فارغة`/`supprimer`/`vide` → `delete_blocks`,
  `find_blocks`. A hit blocks the report: *"You are already holding `delete_blocks`. Call it."* Note
  that no current group carries `empty`/`فارغة` at all — this turn's capability text matched nothing
  by design.

### 4. The answer is checked, not just the row

The gap this closes: today, a blocked report still lets the model tell the student it is impossible.

Add `src/lib/ai/unsupported-claim.ts`, applied on the same path as `no-index-leak.ts` — the pattern is
deliberate, because that module exists for the identical reason (a rule the model is told and does not
reliably follow, so the output is checked instead of trusted).

It fires when **both** hold for a turn:

1. the answer asserts incapacity — "not supported" / "غير مدعوم" / "غير مدعومة" / "non supporté" /
   "passed to the team" / "تم تمرير" / "do it manually in Word" / "يدويًا في Word", and
2. the turn made **no mutating tool call**, while holding a core tool that matches the request.

On a hit, the turn is re-prompted **once**, with the tool named: *"You told the student this is not
supported while holding `delete_blocks`. Do it, or state the specific obstacle."* One retry, not a
loop — a second failure is logged with the answer text so the pattern is visible in the trace rather
than argued with at runtime.

This is the only part of the design that protects the person in the screenshot. Ship it even if
§1–§3 slip.

### 5. A finished offer is a commitment

Prompt rule in `types.ts` (catalogue is one template literal — **no backticks**, see
[[prompt-catalogue-no-backticks]]):

> If your previous message offered to do something and the student said yes, that is an accepted
> offer. Do it. If you find you cannot, name the specific obstacle — never "not supported", and never
> instructions for doing it by hand in Word.

Offering an operation you have not verified you can perform is the upstream error; the previous turn
had already located the empty headings (it could not have offered otherwise) and that finding was
discarded. With `find_blocks` costing one call, the accepting turn simply re-runs it — the cheap fix
for a stale-index problem is to re-derive, not to carry indices across turns.

### 6. Related defect, found while tracing this

Four live-docx tools are missing from `LIVE_DOCX_TOOLS`
([mcp-tool-sets.ts](../../../../modakerati-server/src/lib/ai/mcp-tool-sets.ts)): `delete_blocks`,
`analyze_structure`, `semantic_search_thesis`, `set_heading`. Since `isToolVisible` uses that set to
*hide* live tools on non-live theses
([tool-visibility.ts:40](../../../../modakerati-server/src/lib/ai/tool-visibility.ts#L40)), these four
are offered on legacy theses, where they answer with `requireLiveThesis`'s "not a live Word document"
reply. Not data loss — four wasted tool slots and a confusing dead end. One-line fix; add
`find_blocks` to the set at the same time.

## App and dashboard

**App (`~/modakerati`): nothing required.** A sweep is server-side, and `thesis-doc-store` reconciles
from the server echo, which is truth. Two things to verify rather than assume:

- a 60-block deletion lands as **one** entry in the history ring, not 60 — undo/redo availability comes
  from the edit echo ([thesis-doc-store.ts:152](../../stores/thesis-doc-store.ts#L152));
- the echo applies as one reconcile, not 60 optimistic ops.

**Dashboard:** the `ai_missing_tool_log` row this turn produced is noise and should be triaged
`wontfix` via `setMissingToolStatus`. Worth a sweep of the backlog for other entries naming tools that
exist — check 1 was added after some of those rows were written.

## Verification

`~/modakerati-server` has vitest; some suites need `--testTimeout=60000` under full-suite load.

- **Classifier unit tests** — a paragraph whose only content is `<w:sectPr>` / `<m:oMath>` /
  `<w:drawing>` / `<w:br w:type="page">` / `<w:bookmarkStart>` is `empty: true, deletable: false` with
  the right `holds`. A paragraph of only whitespace and tashkeel is `deletable: true`.
- **`expectAllEmpty` refusal** — a target that gained text since the find refuses the *whole* batch and
  mutates nothing.
- **Claim gate** — a report with `attemptedTools: []` is refused; check 2 now fires with
  `loadCalls > 0`; check 3 blocks the exact capability text from this turn.
- **Answer check** — the Arabic refusal above, in a turn holding `delete_blocks` and having mutated
  nothing, triggers exactly one re-prompt.
- **End to end, the transcript itself** — "احذف العناوين والفقرات الفارغة معًا" against a real mémoire
  completes in one turn and reports counts kept and removed.

The behavioural claim to prove is not "the tests pass" but that the turn in the screenshot now ends
with the blank lines gone.

## Implementation notes (2026-08-13)

Built as designed except in four places, each a change of mechanism rather than of intent.

**1. `attemptedTools` was not added.** The design asked the model to declare what it tried, verified
against the bridge's record. The declaration turned out to be the weak half: the bridge already knows
what ran, so the check reads its own `called` set and `loadCalls` directly and asks the model for
nothing. One less field the model can get wrong, and it cannot be gamed by naming a tool it never
called.

**2. Every redirect is one-shot, which the design did not call for.** Check 2 reasons from keywords,
not from the document, so it can be wrong — and unlike the `load_tools` redirect there is no step the
model can take to escape it. Re-reporting the same capability (keyed by the backlog's own
`capabilityKey`) now files it, tagged `[gate: re-reported after a redirect]`. Without this, one bad
keyword could bury a real gap permanently. The check order also changed: naming the relevant *group*
beats a generic "go and look", so the group redirect runs before the never-looked catch-all.

**3. The detector reads `run.mutated`, the loop's existing flag,** rather than inferring "did this
turn change anything" from tool names. It is set when a mutating tool ran *and succeeded*, which is
the precise question, and it is already the field the turn trace records.

**4. `holds` is an array.** A blank paragraph very often carries both a section break and a page
break; reporting one reason would have meant choosing which truth to tell.

**Still weaker than the design.** §4 says a second false claim should be "logged with the answer text
so the pattern is visible in the trace". It currently emits a `console.warn` only — there is no
`ai_*` table row and nothing surfaces in the dashboard, so a recurrence is visible in server logs and
nowhere else. The re-prompt itself works in both loops; only the telemetry is missing.

**What the streaming correction looks like to a student.** The wrong sentence has already been sent
by the time it can be detected, so the correction *appends*: the student sees the refusal, then a
blank line, then the assistant doing the work. Retracting streamed text would need a control frame
the app does not have. Worth revisiting if it reads badly in practice — the alternative is holding
the final answer back until the turn ends, which costs perceived latency on every good answer to
tidy up a rare bad one.

**One deliberate budget change.** `find_blocks` takes the always-loaded core set from 19 tools to 20,
and the test that pins that ceiling was changed from `< 20` to `<= 20`. Core is billed on every turn;
the bound is a budget to argue with in review, not a number to nudge.
