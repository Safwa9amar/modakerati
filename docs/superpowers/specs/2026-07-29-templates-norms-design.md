# Templates & Norm Profiles — Management and Discovery

**Date:** 2026-07-29
**Repos touched:** `~/modakerati` (app), `~/modakerati-server`, `~/modakerati-dashboard`
**Status:** ALL FOUR PHASES IMPLEMENTED. Plan 1 (server) on `feat/university-layer` in `~/modakerati-server`; Plans 2 (app) and 3 (dashboard) on `master` in `~/modakerati` and `~/modakerati-dashboard`; Plan 4 (column drop) applied and verified. Device QA outstanding.

---

## Problem

A student opening "Choose a template" sees a Blank-thesis card, three filter chips, and
one template. There are 130 institutions in the catalogue and one of them has a `.docx`.
The screen reads as broken, and the filters filter nothing.

The cause is not missing content. It is that nothing connects a student to the catalogue:

- **Universities are a static JSON file** (`modakerati-server/src/data/algerian-universities.json`,
  130 rows), not a table. Every other store keeps `university` as hand-typed free text.
  Nothing can answer "what does USTHB have?"
- **`profiles.university` is collected at signup and then thrown away.** Worse than first
  assessed: `signup.tsx` keeps a `university` free-text field in component state, but
  `handleSignUp` calls `signUpWithEmail(email, password, fullName)` — a three-argument
  function that forwards only `full_name` to Supabase. The value never leaves the device.
  It reaches the database only if the student later edits their profile, and even then it
  is free text that can never match `templates.university` (also free text). Verified
  2026-07-29: both existing profiles have a `university` string and `university_id` NULL.
- **`templates` and `norm_profiles` duplicate six taxonomy columns** (`university`,
  `language`, `discipline`, `bodyPreset`, `citationStyle`, `bindingSide`) with no
  relationship between them and nothing keeping them in sync.
- **A template has no `normProfileId`.** Its formatting is frozen inside the `.docx` and can
  never be re-applied, checked, or fixed.
- **The app presents templates and norm profiles as rivals** ("No template fits? Start with a
  formatting profile") when they are layers: a document versus a set of rules.

## Goal

The student's choice moment feels obvious and personal instead of an empty filtered list —
for a student at *any* of the 130 institutions, not just the one with a template.

Secondary, because the first is unreachable without it: staff can see and close coverage
gaps per institution without retyping university names.

---

## Decisions

| Area | Decision |
|---|---|
| Picker shape | **Match first** — open on one answer; ranked browse behind a link |
| Fallback below an exact match | **Generic skeleton + the student's own institutional identity** |
| Data model | **Three layers** — identity → rules → document |
| Dashboard shape | **University hub** at `/d/universities/[id]`, with a per-university coverage grid |

---

## Architecture

### The three layers

**`universities`** — new table, seeded from `algerian-universities.json`. Columns mirror the
JSON (`nameFr`, `nameAr`, `nameEn`, `city`, `cityAr`, `wilaya`, `wilayaCode`, `type`,
`website`) plus two additions:

- a stable `id` that survives reseeding;
- `logoPath` — the logo copied into our own storage bucket. The JSON's `logo` values point at
  university websites and will rot.

The JSON remains the *seed* source; the table becomes the *runtime* source. This layer owns
identity and nothing else — no formatting.

**`norm_profiles`** — the rules layer. Shape unchanged; gains `universityId` (nullable).
Null means *generic*: a baseline ruleset for a `(level, language, discipline)` cell that any
institution can fall back to. Roughly a dozen of these are seeded — the LMD/ministry
defaults — and they are rung 5 of the ladder.

**`templates`** — the document layer. Gains:

- `universityId` (nullable — null means *generic skeleton*)
- `normProfileId` (**required**)

and **loses** all six duplicated taxonomy columns (`university`, `language`, `discipline`,
`bodyPreset`, `citationStyle`, `bindingSide`), which are now read through the norm profile.
Keeps `type`, `docxPath`, `frontMatter`, `structure`, `styleMap`, `config`
(`config.thumbUrl` stays where it is).

**`header_footer_templates`** gains `universityId`, joining the same graph so HF Studio output
is reachable per institution.

Consequence worth naming: a template-based thesis now has *reachable* rules for the first
time, so formatting check-and-fix can operate on it. Today it cannot.

### The resolver

A single server function is the source of truth for ranking:

```
resolveStartingPoints({ universityId, level, language })
  → ordered list, best first, each entry tagged with the rung that produced it
```

Both surfaces call it. The app uses it for the "For you" card and for Browse-all; the
dashboard uses it to colour the coverage grid. **There is no second ranking implementation
anywhere** — that is the point of extracting it.

The ladder:

Because templates no longer carry taxonomy, a template's `language`, `discipline` and
`bindingSide` are read through `templates.normProfileId → norm_profiles`. Every rung below
matches on the *profile's* values, never on a column of `templates`.

| Rung | Match | Card says |
|---|---|---|
| 1 | Exact template `.docx` — `templates.universityId` matches **and** `type` matches the mapped level **and** the profile's `language` matches | "Your university" |
| 2 | Same `universityId`, but `type` or profile `language` differs. Prefer a language match over a type match: a Master template in the wrong language misleads less than a Doctorat template in the right one. | "Your university — adapted from the *Doctorat* template" |
| 3 | The university's own norm profile (rules, no document). **Excludes any profile that already backs one of this university's templates** — that profile was just offered *with* a document at rung 1/2, so re-listing it here is both a duplicate and a false claim. | "Built to your university's formatting rules" |
| 4 | Peer profile — same `language` **and** at least one of same `type` / same `wilaya`; `type` ranks higher | "Standard Arabic Master layout" |
| 5 | Generic profile for `(language, discipline)` | "Standard Algerian Master layout" |

Two rules that only emerged once the ranking was built and reviewed against real data:

- **Rung 4 needs a real proximity signal, not just a shared language.** Language-only matching
  surfaced Biskra's law-faculty rules to a sports-science student at El Bayadh — different
  wilaya, different institution type — ahead of the national generic that exists precisely to
  be a neutral default. A stranger who speaks the same language is not a peer.
- **Institution `type` outranks `wilaya`.** The kind of institution (centre universitaire /
  université / école) tracks the degree structure and ministry formatting guidance that
  actually govern a thesis's layout. Geography does not: two centres in different wilayas
  resemble each other more than a centre and a université in the same town.

**Rung 5 can legitimately return nothing** if no generic exists for the student's language.
That is deliberate — French rules on an Arabic thesis are worse than no result. The
"always something" guarantee lives in the seed data, pinned by the norm-profile seed test
asserting a generic exists for every language × discipline cell.

### Composing below rung 1

There is no `.docx` to copy below rung 1, so the document is composed from:

1. a **generic skeleton `.docx`** — one per `type` × binding side, roughly six files, authored once;
2. the resolved norm profile, applied as formatting;
3. the university row, filling the cover.

Step 3 is **not new machinery**. `modakerati-server/src/lib/template-fields.ts:27` already
declares `{ key: "institute_name", prefill: "profile.university" }`. It starts resolving to
`universities.nameAr` / `nameFr` instead of a typed string. The single genuinely new piece is
a `{logo}` image token.

### Level ↔ type mapping

`profiles.level` is `["license", "master", "doctorat"]` (three values; `"license"` is
misspelled and pinned by a DB CHECK constraint). `templates.type` is `["memoire_master",
"memoire_licence", "memoire_ingenieur", "these_doctorat"]` (four values). They do not line up
and `memoire_ingenieur` has no corresponding level.

The mapping is an **explicit constant**, never a string match:

```
license  → memoire_licence
master   → memoire_master
doctorat → these_doctorat
```

`memoire_ingenieur` is reachable only by explicit choice in Browse-all. Renaming `"license"`
is a separate migration, deliberately not bundled here.

### Honesty rule

Every resolver result carries its rung, and the badge wording is derived from it. A rung-4 or
rung-5 result **may never claim to be the student's university's official template**. It shows
their crest and name — that is factually their institution — and it states which rules it used.

---

## App surface

**Signup / edit-profile** — the university `TextInput` becomes a searchable picker over the new
table (logo, `nameFr`, `nameAr`, city, wilaya) storing `universityId`. `profiles.university`
text is retained as a fallback for accounts that never re-pick, and as the display value for
an institution outside the 130.

**`app/(app)/template-picker.tsx` (797 lines) splits in two.** It currently holds a filter-chip
component, a filter row, two list modes and the selection logic, which is why it is that size.

- **`app/(app)/start-thesis.tsx`** — the match-first screen. One "For you" card (crest,
  university name, type, language, rung badge, `Start writing`), then a quiet stack: the
  next-best alternative, `Browse all templates ›`, `Blank thesis`. If the profile has no
  `universityId`, this screen asks for it inline once rather than routing to settings.
- **`app/(app)/browse-templates.tsx`** — the ranked list. One search field replacing the three
  filter chips; cards ordered by rung with the reason printed on each.

**Deleted:** the `profilesMode` branch and the "No template fits? Start with a formatting
profile" link. Norm profiles stop being a user-facing choice; they are what rungs 3–5 resolve
through. The norm-profile branch in the wizard store goes with them.

**Unchanged:** `combine-arrange.tsx` keeps its explicit norm-profile selector. Combining
existing documents is a different act, and the student there is deliberately choosing rules.

---

## Dashboard surface

`/d/universities/[id]` becomes the workbench:

- identity + logo upload
- its norm profiles
- its templates
- its header/footer sets
- a **level × language coverage grid**, each cell coloured by the rung it resolves to

Uploading a `.docx` from this page pre-fills university, language and discipline instead of
asking staff to retype them.

The three existing lists (`/d/templates`, `/d/norm-profiles`, `/d/header-footer-templates`)
remain for cross-cutting search, with their free-text university fields replaced by a picker.
`/d/universities` gains a coverage column.

---

## Migration

Additive through step 6; only step 7 is irreversible, and it lands after every reader is gone.

1. Create `universities`; seed from the JSON; copy the 130 logos into storage.
2. Add nullable `universityId` to `templates`, `norm_profiles`, `header_footer_templates`, `profiles`.
3. Backfill by fuzzy-matching existing free-text names against `nameFr` / `nameAr` / `nameEn`.
   **Report unmatched rows rather than guessing.** With one template and a handful of profiles
   this is a hand-checkable list, not an algorithm anyone has to trust.
4. Seed the generic norm profiles; author the generic skeleton `.docx` files.
5. Add `templates.normProfileId`; backfill each template with a profile built from its own six
   columns; then make it required.
6. Ship the resolver and both surfaces.
7. **Separate deploy:** drop the six duplicated columns from `templates`.

DB tables are local-only until pushed — the server's `ensureSchema` plus `drizzle push` both
need running before deploy.

---

## Testing

The server and dashboard have vitest. The app has no JS test runner, so app changes are gated
by `npx tsc --noEmit` plus device QA.

The resolver carries the real risk and is pure — inputs in, ordered rungs out — so it gets
table-driven unit tests, one fixture per rung:

- exact hit
- adjacent-type hit
- the university's own profile
- peer by wilaya
- peer by type
- generic
- no `universityId` at all

Each asserts **both** the chosen row and the reported rung, since the badge wording is derived
from the rung.

One integration test on the compose path: a rung-5 result produces a `.docx` whose cover
contains the university's Arabic name and its logo.

Dashboard: the coverage grid renders the same rungs the resolver reports.

---

## Out of scope

- AI extraction of norm profiles from a university's PDF guide
- The global coverage matrix at `/d/coverage` — one green square today; worth building once
  several institutions have real data
- Renaming `profiles.level` `"license"` → `"licence"`
- Migrating `templates.type` to a level enum
