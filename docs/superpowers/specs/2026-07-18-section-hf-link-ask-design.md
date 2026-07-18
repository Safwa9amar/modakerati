# Section Header/Footer: Link-or-Separate Ask — Design

**Date:** 2026-07-18
**Status:** Approved
**Scope:** `modakerati-server` (chat AI prompt + doc-tools), possibly `mdocxengine` (footer linkToPrevious analog)

## Problem

When the chat AI gives a section a header or footer (`set_section_header` /
`set_section_footer`, usually after `start_on_new_page`), it silently creates a
distinct part. Word's actual model offers a choice the student never sees:
**link with the previous section** (inherit its header/footer) or **create a
separate one**. Worse, "link with previous" is currently unreachable — an empty
`set_section_header` produces an explicitly BLANK part, which is not
inheritance.

## Decisions (from brainstorm)

1. **Ask unless already chosen.** The AI asks before creating a per-section
   header/footer, EXCEPT when the student's request already answers the
   question ("give each Partie its OWN header X", "same header as before").
   Matches the app's existing confirm-unless-authorised prompt convention.
   Document-wide `set_header`/`set_footer` are out of scope (no ask).
2. **Prompt rule + link tool.** Enforcement is prompt-level (like the app's
   other confirm rules), plus a new doc-tool so the "linked" choice performs
   real Word link-to-previous semantics instead of a blank part.

## Design

### 1. New doc-tool `link_section_to_previous`

In `src/mcp/doc-tools.ts` (registered in the standard three places: tool
definition, `LIVE_DOCX_TOOLS` allowlist in `mcp-bridge.ts`, description in the
`types.ts` live-docx system prompt):

- Params: `userId`, `thesisId`, `index` (heading BLOCK index inside the target
  section — same convention as `set_section_header`), `which: "header" |
  "footer" | "both"` (default `"both"`).
- Behavior: resolve the section containing `index`; for each requested kind,
  remove the section's distinct default part and its sectPr reference so the
  section inherits the previous section's part — via the engine's
  `linkToPrevious` capability (`HeaderManager.linkToPrevious` exists; the plan
  verifies the FooterManager analog and mirrors it if missing, then rebuilds
  the engine).
- Edge cases: section 0 → `ok:false` with "the first section has no previous
  section to link to". Section with no distinct part of the requested kind →
  `ok:true` with an "already linked" note (idempotent). A part SHARED by
  multiple sections (imported docs) → `ok:false` with a clear "shared header —
  unlinking one section isn't supported yet" error, validated BEFORE any
  mutation. Same live-thesis guard + `withThesisDoc` serialization as the
  sibling tools.

### 1b. New doc-tool `unlink_section_from_previous` (user addition)

The symmetric operation, registered in the same three places:

- Params: `userId`, `thesisId`, `index` (heading block index), `which:
  "header" | "footer" | "both"` (default `"both"`).
- Behavior (Word's "Link to Previous" toggle-OFF semantics): resolve the
  section; for each requested kind, if the section already has its own default
  part → `ok:true` "already unlinked" (idempotent). Otherwise COPY the
  effective inherited part's XML (nearest previous section's default part)
  into a NEW distinct part registered on this section — content and formatting
  preserved, now independently editable. When nothing is inherited anywhere in
  the chain, create a blank own part (exactly what Word does).
- Uses the engine's `addHeader/addFooter(text, "default", xml, {
  registerInSectPr:false })` raw-xml parameter for the clone +
  `sections.setSectionHeader/Footer(sectionIndex, relId)` for the reference.
- Section 0 is VALID here (unlike link): it just gets its own (possibly
  blank) part.

### 2. Prompt rule (types.ts, live-docx system prompt)

In the page-layout tools section: before `set_section_header` /
`set_section_footer` (including the `start_on_new_page` → set flow), if the
student has not already chosen in their request, call `ask_user` FIRST with
plain-language options — e.g. "Link with previous section (same header)" /
"Its own header for this part". On "linked": do not create a part; if a
distinct part already exists, call `link_section_to_previous`. On "own":
proceed as today — and when the student chose "own" but gave no content,
`unlink_section_from_previous` first (preserves the current look as an
independent copy), then edit or ask what it should say. The rule also covers
direct student requests: "unlink"/"make this section's header independent" →
unlink tool; "same as previous"/"link them" → link tool. Wording follows the
existing ask_user conventions: thesis language, no block numbers, no jargon.
Skip the ask entirely when the request already specifies the choice.

### 3. Tool-description reinforcement (doc-tools.ts)

`set_section_header` and `set_section_footer` descriptions gain a leading
sentence stating the ask-first rule and pointing to
`link_section_to_previous` for the linked choice — the rule survives even if
the model skims the system prompt.

### 4. No app/outline changes

Linking removes the reference, so `Doc.sections()` ECMA inheritance — and
therefore `DocumentDTO.sections` and the outline chrome — reflect it
automatically on the post-turn document refetch. No DTO, store, or UI change.

## Error handling

- `link_section_to_previous` failures return the tool-level `{ok:false,
  error}` shape like sibling tools; nothing throws into the tool loop.
- Engine `linkToPrevious` on a malformed part degrades to a no-op error reply,
  never a corrupted document (verified by test).

## Verification

- Engine (only if the footer analog is added): vitest mirroring the header
  linkToPrevious test.
- Server: fixture tests on a two-section doc — (a) link: create a distinct
  section-1 header, run the link logic, assert `sectionHFDTO` shows section 1
  inheriting section 0's again (or null when section 0 has none); (b) unlink:
  section 1 inheriting section 0's header → unlink → section 1 has its OWN
  part with the SAME text, and editing it no longer affects section 0;
  (c) idempotence + section-0 edge for both tools.
- Prompt/descriptions: read-verified; no runner exercises prompts.
- Manual chat pass: "add a header for chapter 2" → AI asks; answering
  "linked" leaves no distinct part; answering "own" creates one; an explicit
  "give chapter 2 its own header X" skips the ask.

## Out of scope

- Asking before document-wide `set_header`/`set_footer` (even though they
  clear per-section parts — their descriptions already say so).
- First-page / odd-even variant linking.
- Any app-side UI beyond the existing ask_user chip rendering.
