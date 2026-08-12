# Future Features — Students and Researchers

**Date:** 2026-08-11
**Repos touched:** `~/modakerati` (app), `~/modakerati-server`, `~/modakerati-dashboard`, `~/mdocxengine`
**Status:** PROPOSAL. Nothing here is implemented. This is a candidate list with grounding, not a commitment.

---

## How to read this

Each entry says what it is, why it belongs in *this* product, **what already exists in the repos**, where
the work lands, and a rough size. The "what exists" line is the important one — several of these are much
cheaper than they look because the hard half is already built and unreachable.

Sizes: **S** = a few days · **M** = one to two weeks · **L** = a month or more, usually across repos.

---

## Verified state, 2026-08-11

Checked before writing, because two of these contradict what the roadmap would otherwise assume:

| Claim | Reality |
|---|---|
| The document has no citation apparatus | **False.** `docx-apparatus.ts` has `add_citation_source`, `insert_citation`, `insert_bibliography`, `add_footnote`, `add_cross_reference` — all real Word fields, RTL-aware. |
| The student can use them | **False.** They are AI-only. The ribbon's References tab draws `ref.citation`, `ref.citationStyle`, `ref.bibliography`, `ref.footnote`, `ref.endnote`, `ref.crossRef` with `status: "soon"` — visible, disabled buttons. |
| There is one reference model | **False.** Two. The Word citation store in the engine, and the `references` table behind `add_reference` (`references.ts`). The tool description admits the split in prose. |
| Export is fake | **Stale.** `export.ts` signs the live `.docx` from storage and notifies. The launch-readiness note predates it. |
| Sources accept PDFs | **False.** `SourcesSheet.tsx` accepts `.docx`, plain text and markdown only. `source-import.ts` reads tables, images and blocks out of a `.docx`. |

---

## Tier 1 — the ones that change the product

### 1. Unify the two reference models and open the References tab

**What.** Collapse the `references` table and the engine's Word citation store into one model, then wire
the six stubbed ribbon buttons to the tools that already exist. Add the parts that are genuinely absent:
import by DOI / ISBN / URL, BibTeX and RIS files, Zotero and Mendeley exports; explicit ISO 690 output
rather than Word's built-in style set; and two integrity checks the jury always runs — a source in the
bibliography that is never cited, and a citation with no entry.

**Why here.** A mémoire is judged on its bibliography. Today the AI can build one perfectly and the student
cannot touch it, which is exactly backwards for the one artefact a supervisor asks to see in draft.
ISO 690 matters more than APA for most Algerian faculties, and the `citationStyle` enum already lists it.

**What exists.** Almost all of the writing side. Missing: the manual path, import, style enforcement,
and the deduplication.

**Where.** Engine: citation part manager (style output). Server: retire or back `references.ts` with the
engine store; new import endpoint. App: `ribbon-config.ts` status flips, a references sheet, `lib/api.ts`.

**Size.** M for the unify-and-wire, M again for import. Do them in that order — import into two competing
stores would double the migration.

**Gotchas.** Deciding which store wins is the whole design; the `references` rows are user data and need a
migration path. Bibliography insertion is a Word field, so page-number and ordering behaviour follows the
same "not final until Word repaginates" rule already documented for the TOC.

---

### 2. PDF sources — read, quote, cite

**What.** Accept PDFs in the sources sheet. Extract text and figures, let the AI summarize a paper, and let
a quote land in the document *already cited and page-numbered* through the apparatus from #1.

**Why here.** Students' literature is PDFs. The current sources pipeline only understands `.docx`, so the
single most common input to a thesis cannot enter the app at all.

**What exists.** The whole source-import architecture — listing, reading, importing images and tables and
blocks — is built and shaped for exactly this. It is a parser gap, not an architecture gap. RAG per-block
retrieval is already in place to index the result.

**Where.** Server: a PDF reader beside `_source.ts`, extending the `list_source_*` / `import_source_*`
family. App: MIME allowlist in `SourcesSheet.tsx`.

**Size.** M. Scanned PDFs need OCR and Arabic OCR is its own project — ship text-layer PDFs first and say
so in the UI.

---

### 3. Supervisor (encadreur) review mode

**What.** Invite a supervisor by link. They read the thesis and leave comments anchored to blocks. The
student gets a comment inbox and resolves them. Add "what changed since you last read this" from the
existing snapshot ring.

**Why here.** In Algerian practice the supervisor round-trip *is* the writing process, and it currently
happens over WhatsApp screenshots and printed paper. This is the only feature on the list that brings a
second person into the product, which makes it the only one with a built-in growth loop.

**What exists.** The snapshot ring for diffs. Block links (`lib/block-links.ts`) already solve the hard
part — anchoring a stored index to text that moves underneath it, which is precisely what a comment needs.

**Where.** All three repos. New tables, RLS for a non-owner reader, a share-link route, a comment UI in the
writer, and probably a supervisor view in the dashboard.

**Size.** L. The auth and isolation model is the real cost — note the standing rule that tools are
user-scoped; a second reader is the first thing that has ever crossed that boundary deliberately.

---

### 4. Similarity check before submission

**What.** A per-paragraph similarity report against the web and the app's own corpus, with a "this needs a
citation" fix that calls straight into #1.

**Why here.** Faculties run a plagiarism scan and students are frightened of it. Being the place that tells
them *before* the faculty does is worth a subscription on its own.

**Scope discipline.** Report and cite. Not a detector-evasion rewriter — that inverts the product's
relationship with the university, and universities are the distribution channel.

**Size.** M, plus a third-party bill. The honest version of this depends on a similarity API.

---

## Tier 2 — the field-study half of a mémoire

### 5. Questionnaire builder
Build the questionnaire in-app, share a public link, collect responses, push results into the document as a
formatted table *and* a chart in one step. Most Algerian mémoires include an *étude de terrain*, and the
chart insertion tools already exist with nothing but hand-typed data to feed them. **Size:** L — public
response collection is new surface area.

### 6. Statistics assistant
Import Excel/CSV/SPSS. Descriptive stats, cross-tabs, chi-square, t-test, correlation — each rendered as a
Word-correct table with the standard reporting sentence beneath it, plus a plain-language reading of what it
means for the hypothesis. **Size:** M. Pairs with #5; neither is half as useful alone.

### 7. Interview transcription and coding
Record or upload an interview, get a timestamped transcript in Arabic / French / Darija, tag themes, insert
coded excerpts as cited quotes. **What exists:** Voice Lab already has the STT route. **Size:** M.

---

## Tier 3 — finishing and defending

### 8. Soutenance pack
One button at the end: a slide deck generated from the document's own outline, a ten-minute speaking script,
and likely jury questions with answers drawn from the actual text. The most emotionally loaded moment in the
whole journey, and nothing serves it today. **Size:** M. `get_thesis_outline` already supplies the spine.

### 9. Jury-simulation critique
An AI pass that reads like an examiner rather than an assistant — is the research question answered, does
the methodology match it, is the sample defensible, do the conclusions overreach. Output a ranked list of
weaknesses, each one a `modk://b/N` link. **Size:** S. This is mostly a prompt and a results screen.

### 10. Trilingual abstract and keywords
Generate ملخص / résumé / abstract with keywords, keep them synchronized as the thesis changes, enforce the
word limit from the norm profile. **Size:** S.

### 11. Deadlines and milestones
Chapter-level deadlines, progress against the norm profile's page budget, push reminders. **What exists:**
push works end-to-end now, and norm profiles carry the budget. **Size:** S, mostly UI.

---

## Tier 4 — for researchers specifically

### 12. Literature discovery
Search Crossref, Semantic Scholar, arXiv, OpenAlex by topic; read abstracts; add to references in one tap.
Turns the app from a writer into a research environment, and feeds #1 directly. **Size:** M.

### 13. Mémoire → journal article
Reflow a chapter into a target journal's structure and citation style, with abstract and cover letter. The
natural upsell to the Master's student who becomes a doctorant. **Size:** M.

### 14. Reading notes as a knowledge base
Per-source notes linked both ways to the blocks they support, so a claim in chapter 3 remembers which paper
backs it. Also the highest-value thing that could be fed to the existing RAG index. **Size:** M.

### 15. Co-authoring for lab teams
Multi-user editing with attribution. Shares most of its infrastructure with #3 and should follow it, not
precede it. **Size:** L.

---

## Smaller wins

| Feature | Note | Size |
|---|---|---|
| Terminology consistency | Per-thesis glossary; flag one concept translated three ways across chapters. Very common failure in Arabic theses. | S |
| Annexes manager | Auto-lettered appendices (Annexe A/B/C) with cross-references from the body. `add_cross_reference` already exists. | S |
| Endnotes + footnote UI | `add_footnote` exists; `ref.footnote` and `ref.endnote` are stubbed. Endnotes are not implemented at all. | S |
| Print-ready export | PDF/A with binding margins and the university cover page. Export itself is real; this is the last mile. | M |
| Offline writing | The durable op queue is already there. Campus Wi-Fi is unreliable — a real retention lever. | M |
| Dictation into blocks | Promote Voice Lab STT into a "speak this paragraph" button in the writer. | S |
| Corpus of accepted theses | Searchable past mémoires per faculty. Templates answer the *format* question; this answers the *content* one students actually ask. | L, mostly non-engineering |

---

## If we only do three

**1, 2, and 3** — unify citations and open the References tab, accept PDFs, and let the supervisor in.

Together they move the product from "a good editor with an AI in it" to "the place the whole mémoire
happens." Two of the three are cheaper than they look: the citation apparatus and the source-import
pipeline are both built, and both are currently unreachable by the person the app is for.
