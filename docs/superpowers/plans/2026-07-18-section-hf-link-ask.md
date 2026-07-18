# Section Header/Footer Link-or-Separate Ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chat AI asks "link with previous section, or its own header/footer?" before creating per-section chrome, and two new doc-tools (`link_section_to_previous`, `unlink_section_from_previous`) implement Word's real Link-to-Previous toggle in both directions.

**Architecture:** A new focused module `src/mcp/doc-section-link.ts` holds the testable core (section resolution + link/unlink against the engine's existing `linkToPrevious` / raw-XML `addHeader`/`addFooter`); `doc-tools.ts` registers two thin tool wrappers; `mcp-bridge.ts` allowlists them; `types.ts` gains the ask-first prompt rule and the `set_section_*` descriptions are reinforced. No engine or app changes.

**Tech Stack:** modakerati-server (Hono, vitest, zod MCP tools), mdocxengine consumed via `file:` symlink (already rebuilt — do NOT rebuild).

**Spec:** `~/modakerati/docs/superpowers/specs/2026-07-18-section-hf-link-ask-design.md`

**Repo:** ALL work in `/Users/hamzasafwan/modakerati-server`, branch `feat/thesis-hierarchy-p0` (stay on it). The tree has unrelated uncommitted changes — commit ONLY the files each task names.

**Verified engine facts (do not re-derive):**
- `HeaderManager.linkToPrevious(headerPath, linked)` / `FooterManager.linkToPrevious(footerPath, linked)` exist; `linked=true` removes the part + content-type + rel + every sectPr reference (byte-safe). `linked=false` is a no-op (caller adds a part instead).
- `engine.header.addHeader(text, "default", xml?, { registerInSectPr: false })` → `{ headerPath, relId }`; the `xml` param is used VERBATIM as the part content (proven by an existing engine test). `addFooter` is the mirror.
- `engine.sections.setSectionHeader(sectionIndex, relId, "default")` / `setSectionFooter(...)` write the reference into that section's sectPr.
- `engine.sections.getSections()` → `SectionEntry[]` `{ index, isFinal, paragraphIndex?, headerRefs, footerRefs, ... }` where `paragraphIndex` is the sectPr-carrying PARAGRAPH (the section's LAST paragraph; intermediates only). Paragraph indices count `w:p` only; blocks of `kind === "paragraph"` from `getBlocks()` map 1:1.
- `engine.rels.getTarget(relId): Promise<string | null>` (path may lack the `word/` prefix); read parts with `engine.zip.readAsText(path)`.
- `sectionIndexForParagraph` is NOT exported from the engine — the new module implements its own (trivial).
- `withThesisDoc(thesis, fn)` in doc-tools.ts persists when `fn`'s result isn't `{ok:false}`, and invalidates the cached engine on `ok:false`/throw.
- `sectionHFDTO(doc.engine)` from `../lib/thesis-doc` is the perfect test oracle (effective/inherited parts, blank→null folding).
- `assets/thesis-base.docx` is single-section with no header/footer parts.

---

### Task 1: `doc-section-link.ts` core logic (TDD)

**Files:**
- Create: `src/mcp/doc-section-link.ts`
- Test: `src/__tests__/section-link.test.ts` (create)

- [ ] **Step 1: Write the failing tests.** Create `src/__tests__/section-link.test.ts`:

```ts
import "dotenv/config"; // load .env before thesis-doc pulls in the supabase client
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { Doc } from "mdocxengine";
import { linkSectionToPrevious, unlinkSectionFromPrevious } from "../mcp/doc-section-link";
import { sectionHFDTO } from "../lib/thesis-doc";

const SAMPLE = new URL("../../assets/thesis-base.docx", import.meta.url).pathname;

// Seed doc + a "Partie II" heading split into its own (second) section.
async function twoSectionDoc() {
  const doc = await Doc.open(readFileSync(SAMPLE));
  await doc.addHeading("Partie II", 1);
  await doc.addParagraph("corps");
  const blocks = await doc.blocks();
  const idx = blocks.findIndex((b) => b.text === "Partie II");
  await doc.startOnNewPage(idx);
  return { doc, idx };
}

describe("linkSectionToPrevious", () => {
  it("removes the section's own header so it inherits again", async () => {
    const { doc, idx } = await twoSectionDoc();
    await doc.setSectionHeader(idx, "Partie II — Méthodes");
    const res = await linkSectionToPrevious(doc, idx, "header");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changed).toEqual(["header"]);
    const dto = await sectionHFDTO(doc.engine);
    expect(dto[1].header).toBeNull(); // section 0 has none → nothing inherited
  });

  it("is idempotent and refuses on the first section", async () => {
    const { doc, idx } = await twoSectionDoc();
    const again = await linkSectionToPrevious(doc, idx, "both");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.changed).toEqual([]);
    const first = await linkSectionToPrevious(doc, 0, "both");
    expect(first.ok).toBe(false);
  });
});

describe("unlinkSectionFromPrevious", () => {
  it("clones the inherited header into an own, independently editable part", async () => {
    const { doc, idx } = await twoSectionDoc();
    await doc.setSectionHeader(0, "En-tête commun"); // section 0's own header → inherited by section 1
    let dto = await sectionHFDTO(doc.engine);
    expect(dto[1].header).toEqual({ text: "En-tête commun" }); // inherited
    const res = await unlinkSectionFromPrevious(doc, idx, "header");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changed).toEqual(["header"]);
    dto = await sectionHFDTO(doc.engine);
    expect(dto[1].header).toEqual({ text: "En-tête commun" }); // same content, now own
    // Editing section 1's header must no longer touch section 0's.
    await doc.setSectionHeader(idx, "Partie II seulement");
    dto = await sectionHFDTO(doc.engine);
    expect(dto[0].header).toEqual({ text: "En-tête commun" });
    expect(dto[1].header).toEqual({ text: "Partie II seulement" });
  });

  it("creates a blank own part when nothing is inherited, and is idempotent", async () => {
    const { doc, idx } = await twoSectionDoc();
    const res = await unlinkSectionFromPrevious(doc, idx, "header");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changed).toEqual(["header"]);
    const dto = await sectionHFDTO(doc.engine);
    expect(dto[1].header).toBeNull(); // blank own part folds to null in the DTO
    const again = await unlinkSectionFromPrevious(doc, idx, "header");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.changed).toEqual([]);
    // Unlike link, unlink is VALID on the first section (it just gets its own part).
    const s0 = await unlinkSectionFromPrevious(doc, 0, "footer");
    expect(s0.ok).toBe(true);
    if (s0.ok) expect(s0.changed).toEqual(["footer"]);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/section-link.test.ts`
Expected: FAIL — cannot resolve `../mcp/doc-section-link`.

- [ ] **Step 3: Implement.** Create `src/mcp/doc-section-link.ts`:

```ts
import type { Doc } from "mdocxengine";

// Word's "Link to Previous" toggle for one section's header/footer, extracted
// from the tool shell so the non-obvious section/ref logic is unit-testable
// against a fixture .docx (no MCP/DB). LINK removes the section's own default
// part so ECMA inheritance shows the previous section's; UNLINK clones the
// currently-inherited part into a new own part (same content, independently
// editable — exactly what Word does when you toggle Link to Previous off).

export type HFKind = "header" | "footer";

export type SectionLinkResult =
  | { ok: true; sectionIndex: number; totalSections: number; changed: HFKind[]; note?: string }
  | { ok: false; error: string };

type SectionEntryLike = Awaited<ReturnType<Doc["engine"]["sections"]["getSections"]>>[number];

// Which section (getSections() order) contains the block at blockIndex.
// Sections break on PARAGRAPHS: count paragraph-kind blocks before the block,
// then take the first intermediate section whose closing paragraph is at/after
// that paragraph; otherwise the final section.
async function resolveSection(
  doc: Doc,
  blockIndex: number,
): Promise<{ entries: SectionEntryLike[]; sectionIndex: number } | { error: string }> {
  const blocks = await doc.engine.document.getBlocks();
  if (blockIndex < 0 || blockIndex >= blocks.length) {
    return { error: `index ${blockIndex} out of range (0..${blocks.length - 1}). Re-locate with get_thesis_outline.` };
  }
  const paraIndex = blocks.slice(0, blockIndex).filter((b) => b.kind === "paragraph").length;
  const entries = await doc.engine.sections.getSections();
  let sectionIndex = entries.length - 1;
  for (const e of entries) {
    if (!e.isFinal && e.paragraphIndex !== undefined && paraIndex <= e.paragraphIndex) {
      sectionIndex = e.index;
      break;
    }
  }
  return { entries, sectionIndex };
}

const defaultRef = (e: SectionEntryLike, kind: HFKind) =>
  (kind === "header" ? e.headerRefs : e.footerRefs).find((r) => r.type === "default");

async function partPath(doc: Doc, relId: string): Promise<string | null> {
  const target = await doc.engine.rels.getTarget(relId);
  if (!target) return null;
  return target.startsWith("word/") ? target : `word/${target.replace(/^\/+/, "")}`;
}

/** Link to Previous ON: remove the section's own default part(s) so it inherits. */
export async function linkSectionToPrevious(
  doc: Doc,
  blockIndex: number,
  which: HFKind | "both",
): Promise<SectionLinkResult> {
  const r = await resolveSection(doc, blockIndex);
  if ("error" in r) return { ok: false, error: r.error };
  const { entries, sectionIndex } = r;
  if (sectionIndex === 0) {
    return { ok: false, error: "The first section has no previous section to link to." };
  }
  const kinds: HFKind[] = which === "both" ? ["header", "footer"] : [which];
  // Validate every kind BEFORE mutating so a refusal never half-applies.
  const actions: { kind: HFKind; path: string }[] = [];
  for (const kind of kinds) {
    const ref = defaultRef(entries[sectionIndex], kind);
    if (!ref?.relId) continue; // no own part — already linked
    const shared = entries.some((e) => e.index !== sectionIndex && defaultRef(e, kind)?.relId === ref.relId);
    if (shared) {
      return { ok: false, error: `This ${kind} is shared by multiple sections — unlinking just one section isn't supported yet.` };
    }
    const path = await partPath(doc, ref.relId);
    if (!path) continue; // dangling reference — nothing to remove
    actions.push({ kind, path });
  }
  if (actions.length === 0) {
    return { ok: true, sectionIndex, totalSections: entries.length, changed: [], note: "Already linked with the previous section — nothing to change." };
  }
  for (const a of actions) {
    if (a.kind === "header") await doc.engine.header.linkToPrevious(a.path, true);
    else await doc.engine.footer.linkToPrevious(a.path, true);
  }
  return { ok: true, sectionIndex, totalSections: entries.length, changed: actions.map((a) => a.kind) };
}

/** Link to Previous OFF: give the section its OWN part, cloning the inherited content. */
export async function unlinkSectionFromPrevious(
  doc: Doc,
  blockIndex: number,
  which: HFKind | "both",
): Promise<SectionLinkResult> {
  const r = await resolveSection(doc, blockIndex);
  if ("error" in r) return { ok: false, error: r.error };
  const { entries, sectionIndex } = r;
  const kinds: HFKind[] = which === "both" ? ["header", "footer"] : [which];
  const changed: HFKind[] = [];
  for (const kind of kinds) {
    if (defaultRef(entries[sectionIndex], kind)?.relId) continue; // already its own
    // The effective inherited part = nearest earlier section with an own default ref.
    let inheritedXml: string | undefined;
    for (let k = sectionIndex - 1; k >= 0; k--) {
      const ref = defaultRef(entries[k], kind);
      if (ref?.relId) {
        const path = await partPath(doc, ref.relId);
        const xml = path ? doc.engine.zip.readAsText(path) : null;
        if (xml) inheritedXml = xml;
        break;
      }
    }
    // Clone (or blank when nothing is inherited) as this section's own part.
    if (kind === "header") {
      const { relId } = await doc.engine.header.addHeader("", "default", inheritedXml, { registerInSectPr: false });
      await doc.engine.sections.setSectionHeader(sectionIndex, relId, "default");
    } else {
      const { relId } = await doc.engine.footer.addFooter("", "default", inheritedXml, { registerInSectPr: false });
      await doc.engine.sections.setSectionFooter(sectionIndex, relId, "default");
    }
    changed.push(kind);
  }
  return changed.length === 0
    ? { ok: true, sectionIndex, totalSections: entries.length, changed, note: "This section already has its own — nothing to change." }
    : { ok: true, sectionIndex, totalSections: entries.length, changed };
}
```

NOTE for the implementer: if `SectionEntryLike`'s inferred shape fights tsc (the engine exports `SectionEntry` directly), simplify to `import type { Doc, SectionEntry } from "mdocxengine"` and use `SectionEntry` — whichever typechecks cleanly; behavior identical.

- [ ] **Step 4: Run tests.**

Run: `npx vitest run src/__tests__/section-link.test.ts`
Expected: 4/4 PASS. Also `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit.**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/mcp/doc-section-link.ts src/__tests__/section-link.test.ts
git commit -m "feat(doc-tools): link/unlink section header-footer core (Word Link to Previous)"
```

---

### Task 2: register the two tools + allowlist

**Files:**
- Modify: `src/mcp/doc-tools.ts` (import + two registrations after `set_section_footer`, ~line 1200)
- Modify: `src/lib/ai/mcp-bridge.ts` (~line 45)

- [ ] **Step 1: Add the import** in `doc-tools.ts`, next to the other `./` imports (e.g. after the `doc-tools-util` import):

```ts
import { linkSectionToPrevious, unlinkSectionFromPrevious } from "./doc-section-link";
```

- [ ] **Step 2: Register both tools** in `doc-tools.ts`, immediately AFTER the `set_section_footer` registration's closing `);`:

```ts
  // ── link_section_to_previous (mutate, page layout) ─────────────────────────
  server.tool(
    "link_section_to_previous",
    "Live Word document only. LINK a section's header/footer WITH THE PREVIOUS section (Word's 'Link to Previous' ON): removes that section's own distinct header/footer so it INHERITS the previous section's. Use when the student chooses 'same header as the previous part' or asks to link sections. The section is the one CONTAINING the heading at `index` (find it with get_thesis_outline). `which` selects header, footer, or both (default both). The first section has no previous section — this tool refuses there. To give a section its OWN header/footer instead, use set_section_header/set_section_footer (new content) or unlink_section_from_previous (keep the current content, make it independent).",
    {
      userId: z.string().describe("The user's UUID (supplied by the system)"),
      thesisId: z.string().describe("The thesis UUID"),
      index: z.number().describe("Block index (from get_thesis_outline) of a heading INSIDE the target section"),
      which: z.enum(["header", "footer", "both"]).optional().describe("What to link (default both)"),
    },
    async ({ userId, thesisId, index, which }) => {
      const guard = await requireLiveThesis(thesisId, userId);
      if (guard.ok === false) return guard.reply;
      return withThesisDoc(guard.thesis, async (doc) => {
        const res = await linkSectionToPrevious(doc, index, which ?? "both");
        if (res.ok === false) return res;
        return { ...res, note: res.note ?? "Linked — this section now shows the previous section's header/footer." };
      });
    },
  );

  // ── unlink_section_from_previous (mutate, page layout) ─────────────────────
  server.tool(
    "unlink_section_from_previous",
    "Live Word document only. UNLINK a section's header/footer FROM the previous section (Word's 'Link to Previous' OFF): gives that section its OWN copy of the header/footer it currently shows — same content, now independently editable. Use when the student wants a section's header/footer to become independent WITHOUT dictating new text yet (then edit it with set_section_header/set_section_footer). The section is the one CONTAINING the heading at `index` (find it with get_thesis_outline). `which`: header, footer, or both (default both). If nothing is inherited, the section gets a blank own part, exactly like Word.",
    {
      userId: z.string().describe("The user's UUID (supplied by the system)"),
      thesisId: z.string().describe("The thesis UUID"),
      index: z.number().describe("Block index (from get_thesis_outline) of a heading INSIDE the target section"),
      which: z.enum(["header", "footer", "both"]).optional().describe("What to unlink (default both)"),
    },
    async ({ userId, thesisId, index, which }) => {
      const guard = await requireLiveThesis(thesisId, userId);
      if (guard.ok === false) return guard.reply;
      return withThesisDoc(guard.thesis, async (doc) => {
        const res = await unlinkSectionFromPrevious(doc, index, which ?? "both");
        if (res.ok === false) return res;
        return { ...res, note: res.note ?? "Unlinked — this section now owns an independent copy of its header/footer." };
      });
    },
  );
```

- [ ] **Step 3: Allowlist** in `src/lib/ai/mcp-bridge.ts` — find the `LIVE_DOCX_TOOLS` entries `"set_section_header",` / `"set_section_footer",` (~lines 44-45) and add right after them:

```ts
  "link_section_to_previous",
  "unlink_section_from_previous",
```

- [ ] **Step 4: Verify.**

Run: `npx tsc --noEmit` → clean. `npx vitest run` → full suite passes (87 + 4 new = 91, DB-bound tests may skip as usual).

- [ ] **Step 5: Commit.**

```bash
git add src/mcp/doc-tools.ts src/lib/ai/mcp-bridge.ts
git commit -m "feat(doc-tools): register link/unlink_section tools + allowlist"
```

---

### Task 3: prompt rule + description reinforcement

**Files:**
- Modify: `src/lib/ai/types.ts` (page-layout tools block, ~line 287)
- Modify: `src/mcp/doc-tools.ts` (two description strings)

- [ ] **Step 1: Prompt rule.** In `types.ts`, the page-layout block's `set_section_header` bullet ends with the line:

```
     must split sections or set per-section headers manually in Word.
```

Immediately AFTER that line, insert:

```
   - link_section_to_previous(index, which) / unlink_section_from_previous(index,
     which) — Word's "Link to Previous" toggle for the section CONTAINING the
     heading at index. LINK removes that section's own header/footer so it shows
     the previous section's again. UNLINK gives the section its OWN copy of what
     it currently shows (same content, now independently editable) — use it when
     the student wants a section's header to become independent without giving
     new text yet. which: "header" | "footer" | "both" (default both).
   ASK FIRST — LINKED OR SEPARATE: before you give a section its own header or
   footer (set_section_header / set_section_footer, including the
   start_on_new_page → set flow), if the student has NOT already chosen in this
   conversation, call ask_user with the two choices in plain thesis language,
   e.g. "Link it with the previous part (same header)" vs "Give this part its
   own header". If they choose LINKED: create nothing — and if the section
   already has its own, call link_section_to_previous. If they choose OWN but
   gave no text, call unlink_section_from_previous first (keeps what is shown
   today, now editable), then ask what it should say or edit it. Skip the ask
   when their request already decides it ("give each Partie its OWN header…",
   "same header as the previous chapter" — act immediately, do not re-ask).
```

(Match the surrounding indentation — the block is inside a template literal; keep the 3-space bullet style used by its neighbours.)

- [ ] **Step 2: Description reinforcement.** In `doc-tools.ts`:

Edit the `set_section_header` description — replace its leading text:

```
"Live Word document only. Give ONE section its OWN running HEADER,
```

with:

```
"Live Word document only. ASK FIRST unless the student already chose in this conversation: link with the previous section, or its own header? (ask_user; for the 'linked' choice use link_section_to_previous.) Give ONE section its OWN running HEADER,
```

Edit the `set_section_footer` description — replace its leading text:

```
"Live Word document only. Give ONE section its OWN FOOTER,
```

with:

```
"Live Word document only. ASK FIRST unless the student already chose in this conversation: link with the previous section, or its own footer? (ask_user; for the 'linked' choice use link_section_to_previous.) Give ONE section its OWN FOOTER,
```

- [ ] **Step 3: Verify.**

Run: `npx tsc --noEmit` → clean. `npx vitest run src/__tests__/section-link.test.ts` → 4/4 (unchanged).

- [ ] **Step 4: Commit.**

```bash
git add src/lib/ai/types.ts src/mcp/doc-tools.ts
git commit -m "feat(chat-prompt): ask-first rule for section headers/footers (linked vs separate)"
```

---

### Task 4: verification

- [ ] **Step 1: Full server suite.**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run`
Expected: all pass (prior 87 + 4 new).

- [ ] **Step 2: Manual chat pass (user or dev session; server `npm run dev` + app).**

1. "Add a header for chapter 2" (chapter not yet its own section) → AI asks linked-vs-own via ask_user chips; choosing "own" → start_on_new_page + set_section_header; choosing "linked" → no distinct part created.
2. On a section that HAS its own header: "make this section's header the same as the previous one" → link_section_to_previous → outline chrome loses that section's marker after the turn.
3. "Make chapter 3's header independent" (currently inherited) → unlink_section_from_previous → same visible header, and a follow-up "change chapter 3's header to X" changes only chapter 3.
4. "Give each Partie its OWN header with its title" → NO ask (explicit) — acts immediately.

## Out of scope (per spec)

Ask before document-wide set_header/set_footer; first-page/odd-even linking; app-side UI changes.
