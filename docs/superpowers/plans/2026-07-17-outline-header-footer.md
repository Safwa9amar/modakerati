# Outline Header & Footer Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the document's headers/footers as read-only Word-style page chrome in the workspace Outline view (top/bottom zones + dashed markers where a section break changes them).

**Architecture:** A new engine read API (`Doc.sections()`) resolves per-section header/footer text with ECMA-376 inheritance; the server maps it into a `sections` array on the existing document DTO (rides `GET /document` + every edit echo); the app mirrors the type, shifts section boundaries in its optimistic op patches, and renders chrome via `ListHeaderComponent`/`ListFooterComponent` + per-row markers — the reorderable `data` array stays blocks-only.

**Tech Stack:** mdocxengine (TS, vitest, `npm run build`), modakerati-server (Hono, vitest), modakerati app (Expo RN, zustand, react-i18next; NO JS test runner — gate with `npx tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-07-17-outline-header-footer-design.md`

**Repos & order (build dependency):**
1. `~/mdocxengine` — Tasks 1–3 (server consumes `dist/` via a `file:../mdocxengine` link; rebuild required)
2. `~/modakerati-server` — Task 4
3. `~/modakerati` — Tasks 5–8

**Verified facts (do not re-derive):**
- `engine.sections.getSections()` returns `SectionEntry[]` with `headerRefs`/`footerRefs` (`{relId, type}`) and `paragraphIndex` (the **paragraph** carrying the sectPr = the section's LAST paragraph; intermediate sections only — the final/body section has none). Paragraph index counts `w:p` elements only; `getBlocks()` blocks of `kind === "paragraph"` map 1:1 to them.
- `engine.rels.getTarget(relId): Promise<string | null>`; part paths may lack the `word/` prefix. Read parts with `engine.zip.readAsText(path)` (NOT `getFileAsString` — broken on live instances).
- `FooterManager.formatPageNumbers({format, startAt, ...})` writes `w:pgNumType` into the **body** sectPr (the final section).
- `assets/thesis-base.docx` (server) is single-section with NO header/footer parts — deterministic test baseline.
- `react-native-reorderable-list` extends `FlatListProps` and does NOT omit `ListHeaderComponent`/`ListFooterComponent`.
- ECMA-376 header/footer inheritance: a section without its own reference uses the PREVIOUS section's part; a first section without one has none.

---

### Task 1: Engine — parse `w:pgNumType` into `SectionEntry`

**Files:**
- Modify: `~/mdocxengine/src/core/PartsManagers/SectionManager.ts`
- Test: `~/mdocxengine/src/Doc.layout.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe("Doc layout / section verbs", ...)` in `src/Doc.layout.spec.ts`:

```ts
  test("getSections parses w:pgNumType (format + start)", async () => {
    const doc = await Doc.open(INPUT);
    await doc.setFooter({ pageNumbers: true });
    await doc.engine.footer.formatPageNumbers({ format: "lowerRoman", startAt: 1 });
    const secs = await doc.engine.sections.getSections();
    const final = secs[secs.length - 1];
    expect(final.pageNumberType).toEqual({ format: "lowerRoman", start: 1 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/mdocxengine && npx vitest run src/Doc.layout.spec.ts`
Expected: FAIL — `pageNumberType` is `undefined` (property doesn't exist yet).

- [ ] **Step 3: Implement**

In `src/core/PartsManagers/SectionManager.ts`:

Add to the `SectionEntry` interface (after `footerRefs`):

```ts
  /** Parsed w:pgNumType, when the section sets one (page-number format/restart). */
  pageNumberType?: { format: string; start?: number };
```

In `parseSectPr`, before the `return` statement, add:

```ts
    const pgNumType = sectPr?.["w:pgNumType"];
    const pageNumberType = pgNumType
      ? {
          format: (pgNumType.$?.["w:fmt"] as string) ?? "decimal",
          ...(pgNumType.$?.["w:start"] !== undefined
            ? { start: parseInt(pgNumType.$["w:start"], 10) }
            : {}),
        }
      : undefined;
```

and include it in the returned object:

```ts
    return { type, pageSize, margins, headerRefs, footerRefs, pageNumberType };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/mdocxengine && npx vitest run src/Doc.layout.spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add src/core/PartsManagers/SectionManager.ts src/Doc.layout.spec.ts
git commit -m "feat(sections): parse w:pgNumType into SectionEntry"
```

---

### Task 2: Engine — `Doc.sections()` read API with inheritance

**Files:**
- Modify: `~/mdocxengine/src/Doc.ts`
- Modify: `~/mdocxengine/src/index.ts`
- Test: `~/mdocxengine/src/Doc.layout.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `describe("Doc layout / section verbs", ...)` in `src/Doc.layout.spec.ts`:

```ts
  test("sections() maps start block indices and resolves header inheritance", async () => {
    const doc = await Doc.open(INPUT);
    await doc.addHeading("Part One", 1);
    await doc.addParagraph("p1");
    await doc.addHeading("Part Two", 1);
    await doc.addParagraph("p2");
    await doc.addHeading("Part Three", 1);
    await doc.addParagraph("p3");
    const blocks = await doc.blocks();
    const two = blocks.findIndex((b) => b.text === "Part Two");
    const three = blocks.findIndex((b) => b.text === "Part Three");
    // addSectionBreak mutates an existing paragraph in place — indices stay valid.
    await doc.startOnNewPage(two);
    await doc.startOnNewPage(three);
    await doc.setSectionHeader(two, "Part Two — Methods");
    await doc.setSectionFooter(two, { text: "Conf", pageNumbers: true });

    const secs = await doc.sections();
    expect(secs.length).toBe(3);
    expect(secs[0].startBlockIndex).toBe(0);
    expect(secs[1].startBlockIndex).toBe(two);
    expect(secs[2].startBlockIndex).toBe(three);
    // Section 0 has no part of its own and nothing before it → none.
    expect(secs[0].headerText).toBeNull();
    expect(secs[0].footerText).toBeNull();
    expect(secs[0].footerHasPageNumbers).toBe(false);
    // Section 1 owns both parts.
    expect(secs[1].headerText).toBe("Part Two — Methods");
    expect(secs[1].footerText).toBe("Conf");
    expect(secs[1].footerHasPageNumbers).toBe(true);
    // Section 2 has no refs → inherits section 1's parts (ECMA-376).
    expect(secs[2].headerText).toBe("Part Two — Methods");
    expect(secs[2].footerHasPageNumbers).toBe(true);
  });

  test("sections() on an untouched document reports one bare section", async () => {
    const doc = await Doc.open(INPUT);
    const secs = await doc.sections();
    expect(secs.length).toBe(1);
    expect(secs[0].startBlockIndex).toBe(0);
    expect(secs[0].headerText).toBeNull();
    expect(secs[0].footerText).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/mdocxengine && npx vitest run src/Doc.layout.spec.ts`
Expected: FAIL — `doc.sections is not a function`.

- [ ] **Step 3: Implement**

In `src/Doc.ts`:

(a) Extend the SectionManager type import (line 31) to include `SectionHeaderFooterRef`:

```ts
import type { SectionEntry, SectionHeaderFooterRef } from "./core/PartsManagers/SectionManager";
```

(b) Add the interface after `SectionEditResult` (~line 198):

```ts
export interface SectionInfo {
  /** Section position in document order (0-based; same order as getSections()). */
  index: number;
  /** Block index (document.getBlocks() order) of the section's first block. */
  startBlockIndex: number;
  /**
   * Effective running header text — the section's own default part, else the
   * previous section's (ECMA-376 inheritance). null = no header anywhere in
   * the chain; "" = an explicitly blank header part.
   */
  headerText: string | null;
  /** Effective footer text (same inheritance rules). */
  footerText: string | null;
  /** True when the effective footer part contains a PAGE field. */
  footerHasPageNumbers: boolean;
  /** This section's own w:pgNumType format (e.g. "decimal", "lowerRoman"), if set. */
  pageNumberFormat: string | null;
  /** This section's own w:pgNumType start value, if set. */
  pageNumberStart: number | null;
}
```

(c) Add the methods to the `Doc` class, right after `resolveSection` (~line 661):

```ts
  /**
   * Per-section header/footer info, read-only companion to setSectionHeader /
   * setSectionFooter. Inheritance is resolved the way Word renders it
   * (ECMA-376): a section without its own reference uses the previous
   * section's part; a first section without one has none.
   */
  async sections(): Promise<SectionInfo[]> {
    const [blocks, entries] = await Promise.all([
      this.engine.document.getBlocks(),
      this.engine.sections.getSections(),
    ]);
    // Section boundaries live on paragraphs; map paragraph index → block index.
    const paraToBlock: number[] = [];
    blocks.forEach((b, i) => {
      if (b.kind === "paragraph") paraToBlock.push(i);
    });

    const out: SectionInfo[] = [];
    let header: { text: string; hasPage: boolean } | null = null;
    let footer: { text: string; hasPage: boolean } | null = null;

    for (let k = 0; k < entries.length; k++) {
      const prev = entries[k - 1];
      const prevBreakBlock =
        prev?.paragraphIndex !== undefined ? paraToBlock[prev.paragraphIndex] : undefined;
      const startBlockIndex =
        k === 0 ? 0 : Math.min((prevBreakBlock ?? -1) + 1, blocks.length);

      const own = entries[k];
      const ownHeader = await this.readHeaderFooterPart(own.headerRefs);
      const ownFooter = await this.readHeaderFooterPart(own.footerRefs);
      if (ownHeader) header = ownHeader;
      if (ownFooter) footer = ownFooter;

      out.push({
        index: k,
        startBlockIndex,
        headerText: header ? header.text : null,
        footerText: footer ? footer.text : null,
        footerHasPageNumbers: !!footer?.hasPage,
        pageNumberFormat: own.pageNumberType?.format ?? null,
        pageNumberStart: own.pageNumberType?.start ?? null,
      });
    }
    return out;
  }

  /**
   * Plain text + PAGE-field flag of the header/footer part behind `refs`
   * (prefers the "default" ref). null when no part resolves — including on any
   * read/parse failure, so chrome extraction can never throw.
   */
  private async readHeaderFooterPart(
    refs: SectionHeaderFooterRef[],
  ): Promise<{ text: string; hasPage: boolean } | null> {
    const ref = refs.find((r) => r.type === "default") ?? refs[0];
    if (!ref?.relId) return null;
    try {
      const target = await this.engine.rels.getTarget(ref.relId);
      if (!target) return null;
      const path = target.startsWith("word/") ? target : `word/${target.replace(/^\/+/, "")}`;
      const xml = this.engine.zip.readAsText(path);
      if (!xml) return null;
      const decode = (s: string) =>
        s
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&");
      const text = Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g))
        .map((m) => decode(m[1] ?? ""))
        .join("")
        .trim();
      return { text, hasPage: /<w:instrText[^>]*>[^<]*\bPAGE\b/.test(xml) };
    } catch {
      return null;
    }
  }
```

(d) In `src/index.ts`, add `SectionInfo` to the type re-export block from `./Doc` (the one listing `DocMap, ..., SectionEditResult`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/mdocxengine && npx vitest run src/Doc.layout.spec.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add src/Doc.ts src/index.ts src/Doc.layout.spec.ts
git commit -m "feat(doc): sections() read API — per-section header/footer with ECMA inheritance"
```

---

### Task 3: Engine — build + verify the server sees it

- [ ] **Step 1: Build the engine**

Run: `cd ~/mdocxengine && npm run build`
Expected: exits 0 (tsc + vite build --ssr).

- [ ] **Step 2: Verify the server picks up the new API**

Run: `ls -la ~/modakerati-server/node_modules | grep mdocxengine`
- If it's a **symlink** → nothing to do.
- If it's a **real directory** (copy): run `cd ~/modakerati-server && npm install mdocxengine` to refresh.

Then confirm: `grep -c "sections(): Promise<SectionInfo\[\]>" ~/modakerati-server/node_modules/mdocxengine/dist/index.d.ts`
Expected: `1`.

---

### Task 4: Server — `sections` on the document DTO

**Files:**
- Modify: `~/modakerati-server/src/lib/thesis-doc.ts`
- Test: `~/modakerati-server/src/__tests__/section-hf-dto.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/section-hf-dto.test.ts`:

```ts
import "dotenv/config"; // load .env before thesis-doc pulls in the supabase client
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { Doc } from "mdocxengine";
import { sectionHFDTO } from "../lib/thesis-doc";

const SAMPLE = new URL("../../assets/thesis-base.docx", import.meta.url).pathname;

describe("sectionHFDTO", () => {
  it("returns one bare section for the untouched seed doc", async () => {
    const doc = await Doc.open(readFileSync(SAMPLE));
    const dto = await sectionHFDTO(doc.engine);
    expect(dto).toEqual([{ startBlockIndex: 0, header: null, footer: null }]);
  });

  it("maps per-section headers/footers with page numbers", async () => {
    const doc = await Doc.open(readFileSync(SAMPLE));
    await doc.addHeading("Partie II", 1);
    await doc.addParagraph("corps");
    const blocks = await doc.blocks();
    const idx = blocks.findIndex((b) => b.text === "Partie II");
    await doc.startOnNewPage(idx);
    await doc.setSectionHeader(idx, "Partie II — Méthodes");
    await doc.setSectionFooter(idx, { pageNumbers: true });
    // formatPageNumbers writes w:pgNumType into the BODY sectPr = the final
    // section (index 1 here) → its format must flow through to the DTO.
    await doc.engine.footer.formatPageNumbers({ format: "lowerRoman", startAt: 3 });

    const dto = await sectionHFDTO(doc.engine);
    expect(dto.length).toBe(2);
    expect(dto[0].startBlockIndex).toBe(0);
    expect(dto[0].header).toBeNull();
    expect(dto[1].startBlockIndex).toBe(idx);
    expect(dto[1].header).toEqual({ text: "Partie II — Méthodes" });
    expect(dto[1].footer).toEqual({
      text: "",
      pageNumbers: { format: "lowerRoman", startAt: 3 },
    });
  });

  it("a removed header stays null (never an empty grey band)", async () => {
    const doc = await Doc.open(readFileSync(SAMPLE));
    await doc.setHeader("temp");
    await doc.setHeader(""); // empty removes the header part entirely
    const dto = await sectionHFDTO(doc.engine);
    expect(dto[0].header).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/section-hf-dto.test.ts`
Expected: FAIL — `sectionHFDTO` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/thesis-doc.ts`:

(a) Add `Doc` to the existing `mdocxengine` import (the one importing `Mdocxengine, Table, paragraphText, ...`).

(b) Add the DTO type next to `DocBlockDTO` (after the `DocBlockDTO` union):

```ts
// One Word section's page chrome for the outline view. `startBlockIndex` is the
// section's first body block (same index space as DocBlockDTO.index). `header`
// and `footer` are the EFFECTIVE parts (ECMA inheritance resolved); a part with
// no visible text and no page numbers is null so the app never renders an empty
// grey band.
export type DocSectionDTO = {
  startBlockIndex: number;
  header: { text: string } | null;
  footer: {
    text: string; // "" when the footer is page-numbers-only
    pageNumbers: { format: string; startAt: number | null } | null;
  } | null;
};
```

(c) Add `sections: DocSectionDTO[];` to the live-docx variant of `DocumentDTO` (after `blocks: DocBlockDTO[];`).

(d) Add the extraction function right before `buildDocumentDTOFromEngine`:

```ts
// Per-section header/footer chrome for the outline. Best-effort: any failure
// degrades to [] — page chrome is never worth failing the document DTO.
export async function sectionHFDTO(engine: Mdocxengine): Promise<DocSectionDTO[]> {
  try {
    const infos = await Doc.from(engine).sections();
    return infos.map((s) => {
      const headerText = (s.headerText ?? "").trim();
      const footerText = (s.footerText ?? "").trim();
      return {
        startBlockIndex: s.startBlockIndex,
        header: headerText ? { text: headerText } : null,
        footer:
          footerText || s.footerHasPageNumbers
            ? {
                text: footerText,
                pageNumbers: s.footerHasPageNumbers
                  ? { format: s.pageNumberFormat ?? "decimal", startAt: s.pageNumberStart }
                  : null,
              }
            : null,
      };
    });
  } catch (e: any) {
    console.error("section header/footer extraction failed:", e?.message ?? e);
    return [];
  }
}
```

(e) In `buildDocumentDTOFromEngine`, compute and return it — change the end of the function to:

```ts
  const downloadUrl = await signDownload(thesis.docPath!, `${slug(thesis.title)}.docx`);
  const sections = await sectionHFDTO(engine);
  return {
    id: thesis.id,
    title: thesis.title,
    docMode: "live-docx",
    available: true,
    blocks: dto,
    sections,
    downloadUrl,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/section-hf-dto.test.ts`
Expected: PASS (3 tests). Also run the neighbouring suite to catch DTO-shape fallout: `npx vitest run src/__tests__/block-dto.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/thesis-doc.ts src/__tests__/section-hf-dto.test.ts
git commit -m "feat(document-dto): per-section header/footer chrome (sections array)"
```

---

### Task 5: App — DTO mirror + optimistic section shifts

**Files:**
- Modify: `~/modakerati/lib/api.ts`
- Modify: `~/modakerati/lib/thesis-ops.ts`
- Modify: `~/modakerati/stores/thesis-doc-store.ts`

- [ ] **Step 1: Mirror the DTO in `lib/api.ts`**

Add above `DocumentDTO` (~line 490):

```ts
// One Word section's page chrome (mirror of the server's DocSectionDTO).
export type DocSectionDTO = {
  startBlockIndex: number;
  header: { text: string } | null;
  footer: {
    text: string; // "" when the footer is page-numbers-only
    pageNumbers: { format: string; startAt: number | null } | null;
  } | null;
};
```

And add to the live-docx variant of `DocumentDTO` (after `blocks: DocBlockDTO[];`):

```ts
      // Optional: older SQLite-cached DTOs predate this field.
      sections?: DocSectionDTO[];
```

- [ ] **Step 2: Add section shifting + `applyOpToDoc` in `lib/thesis-ops.ts`**

Extend the api import with `DocSectionDTO`:

```ts
  type DocBlockDTO,
  type DocSectionDTO,
  type DocumentDTO,
```

Append after `applyOpToBlocks`:

```ts
/**
 * Optimistic shift of section boundaries (startBlockIndex) for ops that change
 * block positions. Approximation — exact Word semantics (the section break
 * travels with its paragraph) are reconciled by the server echo at queue drain.
 */
export function applyOpToSections(
  sections: DocSectionDTO[] | undefined,
  op: ThesisOp,
): DocSectionDTO[] | undefined {
  if (!sections?.length) return sections;
  const shift = (fn: (start: number) => number) =>
    sections.map((s) => ({ ...s, startBlockIndex: Math.max(0, fn(s.startBlockIndex)) }));
  switch (op.type) {
    case "insertImage": {
      const at = Math.max(op.afterIndex + 1, 0);
      return shift((st) => (st >= at ? st + 1 : st));
    }
    case "deleteBlocks": {
      return shift((st) => st - op.indices.filter((i) => i < st).length);
    }
    case "move": {
      if (op.from === op.to) return sections;
      return shift((st) => {
        let v = st > op.from ? st - 1 : st;
        if (v >= op.to) v += 1;
        return v;
      });
    }
    // editText/format: no positions change. startOnNewPage DOES create a
    // section server-side, but its chrome is unknown locally — the echo brings it.
    default:
      return sections;
  }
}

type LiveDocumentDTO = Extract<DocumentDTO, { available: true }>;

/** Apply an op's optimistic effect to the whole doc DTO (blocks + sections). */
export function applyOpToDoc(doc: LiveDocumentDTO, op: ThesisOp): LiveDocumentDTO {
  return {
    ...doc,
    blocks: applyOpToBlocks(doc.blocks, op),
    sections: applyOpToSections(doc.sections, op),
  };
}
```

- [ ] **Step 3: Use `applyOpToDoc` in the store**

In `stores/thesis-doc-store.ts`:

(a) Change the thesis-ops import to include it:

```ts
import { applyOpToDoc, executeOp, isRetryableError, type ThesisOp } from "@/lib/thesis-ops";
```

(the `applyOpToBlocks` import is no longer needed here).

(b) In `ensureRestored`, replace the blocks-replay block:

```ts
        const cur = get().byId[thesisId];
        if (cur?.available) {
          let doc = cur;
          for (const d of fresh) doc = applyOpToDoc(doc, d.op);
          set((s) => ({ byId: { ...s.byId, [thesisId]: doc } }));
        }
```

(c) In `mutate`, replace the optimistic patch:

```ts
      const cur = get().byId[thesisId];
      if (cur?.available) {
        set((s) => ({
          byId: { ...s.byId, [thesisId]: applyOpToDoc(cur, op) },
        }));
      }
```

- [ ] **Step 4: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati
git add lib/api.ts lib/thesis-ops.ts stores/thesis-doc-store.ts
git commit -m "feat(doc-store): mirror section chrome DTO + optimistic boundary shifts"
```

---

### Task 6: App — trilingual i18n keys

**Files:**
- Modify: `~/modakerati/locales/en.json`, `~/modakerati/locales/fr.json`, `~/modakerati/locales/ar.json`

- [ ] **Step 1: Add the `hf` block to each locale**

In each file, inside the existing `"workspace": {` object, add as its first entry (right after the opening brace):

`en.json`:

```json
    "hf": {
      "header": "Header",
      "footer": "Footer",
      "newSection": "New section",
      "headerIs": "Header: {{text}}",
      "footerIs": "Footer: {{text}}",
      "num": { "decimal": "1, 2, 3…", "lowerRoman": "i, ii, iii…", "upperRoman": "I, II, III…", "other": "#" }
    },
```

`fr.json`:

```json
    "hf": {
      "header": "En-tête",
      "footer": "Pied de page",
      "newSection": "Nouvelle section",
      "headerIs": "En-tête : {{text}}",
      "footerIs": "Pied : {{text}}",
      "num": { "decimal": "1, 2, 3…", "lowerRoman": "i, ii, iii…", "upperRoman": "I, II, III…", "other": "#" }
    },
```

`ar.json`:

```json
    "hf": {
      "header": "رأس الصفحة",
      "footer": "تذييل الصفحة",
      "newSection": "قسم جديد",
      "headerIs": "الرأس: {{text}}",
      "footerIs": "التذييل: {{text}}",
      "num": { "decimal": "١، ٢، ٣…", "lowerRoman": "i، ii، iii…", "upperRoman": "I، II، III…", "other": "#" }
    },
```

- [ ] **Step 2: Validate the JSON**

Run: `cd ~/modakerati && node -e "for (const l of ['en','fr','ar']) { const j = JSON.parse(require('fs').readFileSync('locales/'+l+'.json','utf8')); if (!j.workspace.hf?.header) throw new Error(l); } console.log('locales OK')"`
Expected: `locales OK`.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(i18n): workspace header/footer chrome strings (en/fr/ar)"
```

---

### Task 7: App — `OutlineChrome` component

**Files:**
- Create: `~/modakerati/components/workspace/OutlineChrome.tsx`

- [ ] **Step 1: Create the component file**

```tsx
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { type DocSectionDTO } from "@/lib/api";

// Word-style READ-ONLY page chrome for the Outline view: a grey header zone at
// the top of the white card, a footer zone at the bottom, and dashed section
// markers where a section break changes the running header/footer. Tones are
// hardcoded light greys to match the outline card's white paper (not themed).

const C = {
  zoneBg: "#F5F6FA",
  zoneText: "#5A5F7A",
  rule: "#C3C8DC",
  tagText: "#8B8FA8",
  tagBorder: "#D5D8E6",
  chipBg: "#EEF0FA",
  chipText: "#4A4F6E",
};

// iOS only dashes borders when all four sides are set — a clipped full-border
// strip is the reliable way to draw a single dashed rule.
function DashedRule() {
  return (
    <View style={styles.ruleClip}>
      <View style={styles.ruleStrip} />
    </View>
  );
}

function numberingSample(t: TFunction, format: string): string {
  const key =
    format === "decimal" || format === "lowerRoman" || format === "upperRoman"
      ? `workspace.hf.num.${format}`
      : "workspace.hf.num.other";
  return t(key);
}

// One line summarizing a footer: "text · 1, 2, 3…" (either part optional).
function footerSummary(t: TFunction, footer: NonNullable<DocSectionDTO["footer"]>): string {
  const parts: string[] = [];
  if (footer.text) parts.push(footer.text);
  if (footer.pageNumbers) parts.push(numberingSample(t, footer.pageNumbers.format));
  return parts.join(" · ");
}

// startBlockIndex → marker chip label, for every section (2nd onward) whose
// header/footer differs from the previous one. Only non-empty NEW values make a
// line — a change to nothing is silent (v1).
export function computeSectionMarkers(
  t: TFunction,
  sections: DocSectionDTO[] | undefined,
): Map<number, string> {
  const map = new Map<number, string>();
  if (!sections || sections.length < 2) return map;
  for (let k = 1; k < sections.length; k++) {
    const prev = sections[k - 1];
    const cur = sections[k];
    const parts: string[] = [];
    const curHeader = cur.header?.text ?? "";
    if (curHeader && curHeader !== (prev.header?.text ?? "")) {
      parts.push(t("workspace.hf.headerIs", { text: curHeader }));
    }
    const prevFooter = prev.footer ? footerSummary(t, prev.footer) : "";
    const curFooter = cur.footer ? footerSummary(t, cur.footer) : "";
    if (curFooter && curFooter !== prevFooter) {
      parts.push(t("workspace.hf.footerIs", { text: curFooter }));
    }
    if (parts.length) {
      map.set(cur.startBlockIndex, `${t("workspace.hf.newSection")} · ${parts.join(" · ")}`);
    }
  }
  return map;
}

// Grey band + dashed rule + small tag chip. Shows the FIRST section's header —
// the document's base running header. Renders nothing when there is none.
export function OutlineHeaderZone({ section, rtl }: { section?: DocSectionDTO; rtl: boolean }) {
  const { t } = useTranslation();
  if (!section?.header) return null;
  return (
    <View>
      <View style={styles.zone}>
        <Text style={[styles.tag, rtl ? styles.tagLeft : styles.tagRight]}>
          {t("workspace.hf.header")}
        </Text>
        <Text
          numberOfLines={2}
          style={[
            styles.zoneText,
            { textAlign: rtl ? "right" : "left", writingDirection: rtl ? "rtl" : "ltr" },
          ]}
        >
          {section.header.text}
        </Text>
      </View>
      <DashedRule />
    </View>
  );
}

// Footer band at the end of the list: footer text and/or a page-number sample
// built from the real numbering format. Renders nothing when there is none.
export function OutlineFooterZone({ section, rtl }: { section?: DocSectionDTO; rtl: boolean }) {
  const { t } = useTranslation();
  if (!section?.footer) return null;
  return (
    <View>
      <DashedRule />
      <View style={styles.zone}>
        <Text style={[styles.tag, rtl ? styles.tagLeft : styles.tagRight]}>
          {t("workspace.hf.footer")}
        </Text>
        <Text numberOfLines={2} style={[styles.zoneText, styles.footerText]}>
          {footerSummary(t, section.footer)}
        </Text>
      </View>
    </View>
  );
}

// Dashed divider + chip above the first block of a section whose chrome changed.
export function OutlineSectionMarker({ label, rtl }: { label: string; rtl: boolean }) {
  return (
    <View style={[styles.marker, { flexDirection: rtl ? "row-reverse" : "row" }]}>
      <View style={styles.markerLine} />
      <Text style={styles.chip} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.markerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { backgroundColor: C.zoneBg, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 12 },
  zoneText: { fontSize: 12, color: C.zoneText, lineHeight: 17 },
  footerText: { textAlign: "center" },
  tag: {
    position: "absolute",
    top: 4,
    fontSize: 8,
    color: C.tagText,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.tagBorder,
    borderRadius: 3,
    paddingHorizontal: 3,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  tagRight: { right: 6 },
  tagLeft: { left: 6 },
  ruleClip: { height: 1.5, overflow: "hidden" },
  ruleStrip: { height: 3, borderWidth: 1.5, borderColor: C.rule, borderStyle: "dashed" },
  marker: { alignItems: "center", gap: 6, marginVertical: 8 },
  markerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: C.rule },
  chip: {
    fontSize: 10,
    color: C.chipText,
    backgroundColor: C.chipBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.tagBorder,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: "80%",
    overflow: "hidden",
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add components/workspace/OutlineChrome.tsx
git commit -m "feat(outline): header/footer zones + section marker components"
```

---

### Task 8: App — wire chrome into the outline + workspace

**Files:**
- Modify: `~/modakerati/components/workspace/OutlineReorderable.tsx`
- Modify: `~/modakerati/app/(app)/thesis-workspace.tsx` (~line 475)

- [ ] **Step 1: Extend `OutlineReorderable`**

Full updated file (replaces the current content — same structure, chrome added; the reorderable `data` array stays blocks-only so drag from/to keep mapping to engine indices):

```tsx
import { useEffect, useMemo, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import ReorderableList, {
  useReorderableDrag,
  reorderItems,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { GripVertical } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { DocBlock } from "./DocBlock";
import {
  OutlineHeaderZone,
  OutlineFooterZone,
  OutlineSectionMarker,
  computeSectionMarkers,
} from "./OutlineChrome";
import { type DocBlockDTO, type DocSectionDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useThemeColors } from "@/hooks/useThemeColors";

// One outline row: a drag handle (long-press to lift) + the block. The handle
// owns the drag so DocBlock keeps its tap-to-select / long-press-multi-select.
// `markerLabel` renders a section marker ABOVE the row — chrome, not data, so
// it never enters the reorderable list's index space.
function Row({
  block,
  rtl,
  thesisId,
  version,
  markerLabel,
}: {
  block: DocBlockDTO;
  rtl: boolean;
  thesisId: string;
  version?: number;
  markerLabel?: string;
}) {
  const colors = useThemeColors();
  const drag = useReorderableDrag();
  return (
    <View>
      {markerLabel != null && <OutlineSectionMarker label={markerLabel} rtl={rtl} />}
      <View style={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <Pressable onLongPress={drag} delayLongPress={180} hitSlop={6} style={styles.handle}>
          <GripVertical size={18} color={colors.textPlaceholder} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} />
        </View>
      </View>
    </View>
  );
}

// The Outline view as a drag-to-reorder list. `blocks` is the server order (a
// block's `index` equals its position), so a drop's from/to map directly to
// engine indices. Optimistic reorder for a smooth drop; the doc store's op queue
// persists + flushes the move and re-syncs `blocks` (which renumbers indices).
// `sections` (optional — older caches lack it) adds READ-ONLY page chrome:
// header/footer zones as list header/footer, markers above section starts.
export function OutlineReorderable({
  thesisId,
  blocks,
  sections,
  rtl,
  paddingBottom,
  version,
}: {
  thesisId: string;
  blocks: DocBlockDTO[];
  sections?: DocSectionDTO[];
  rtl: boolean;
  paddingBottom: number;
  // Doc version → busts on-demand figure image caches after an edit.
  version?: number;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState(blocks);
  useEffect(() => setData(blocks), [blocks]);

  const markers = useMemo(() => computeSectionMarkers(t, sections), [t, sections]);

  const onReorder = ({ from, to }: ReorderableListReorderEvent) => {
    if (from === to) return;
    setData((cur) => reorderItems(cur, from, to));
    // Durable op: instant here (the local reorder above), persisted + flushed in
    // the background by the doc store, which also updates its own block model —
    // the `blocks` prop then re-syncs `data` via the effect above.
    void useThesisDocStore.getState().mutate(thesisId, { type: "move", from, to });
  };

  return (
    <ReorderableList
      data={data}
      onReorder={onReorder}
      keyExtractor={(b) => String(b.index)}
      renderItem={({ item }) => (
        <Row
          block={item}
          rtl={rtl}
          thesisId={thesisId}
          version={version}
          markerLabel={markers.get(item.index)}
        />
      )}
      ListHeaderComponent={
        sections?.[0]?.header ? (
          <View style={styles.bleedTop}>
            <OutlineHeaderZone section={sections[0]} rtl={rtl} />
          </View>
        ) : null
      }
      ListFooterComponent={
        sections?.[0]?.footer ? (
          <View style={styles.bleedBottom}>
            <OutlineFooterZone section={sections[0]} rtl={rtl} />
          </View>
        ) : null
      }
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingBottom }]}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#FFFFFF", marginHorizontal: 16, marginTop: 8, borderRadius: 6 },
  content: { padding: 12 },
  row: { alignItems: "flex-start", gap: 2 },
  handle: { paddingTop: 12, paddingHorizontal: 2 },
  // Zones bleed to the card edges through the content's 12px padding.
  bleedTop: { marginHorizontal: -12, marginTop: -12, marginBottom: 10 },
  bleedBottom: { marginHorizontal: -12, marginBottom: -12, marginTop: 10 },
});
```

- [ ] **Step 2: Pass `sections` from the workspace**

In `app/(app)/thesis-workspace.tsx` (~line 475), extend the existing element:

```tsx
              <OutlineReorderable
                thesisId={thesisId}
                blocks={liveDoc.blocks}
                sections={liveDoc.sections}
                rtl={docRtl}
                paddingBottom={16}
                version={docTick}
              />
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add components/workspace/OutlineReorderable.tsx "app/(app)/thesis-workspace.tsx"
git commit -m "feat(outline): render header/footer page chrome + section markers"
```

---

### Task 9: End-to-end verification (checkpoint — needs the running app)

- [ ] **Step 1: Full test suites**

```bash
cd ~/mdocxengine && npx vitest run src/Doc.layout.spec.ts
cd ~/modakerati-server && npx vitest run
cd ~/modakerati && npx tsc --noEmit
```

Expected: all PASS / exit 0. (Server suite may skip DB-bound tests if `DATABASE_URL` is unreachable — the two doc DTO suites must pass.)

- [ ] **Step 2: Manual run (user or device session)**

Start the server (`cd ~/modakerati-server && npm run dev`) and the app (`cd ~/modakerati && npx expo start`), then verify in the workspace Outline view:

1. **Thesis with chrome:** in chat, ask the AI to `set_header` (e.g. the thesis title) and `set_footer` with page numbers → outline shows the grey header zone at top (correct RTL alignment for an Arabic thesis), footer band at the very end with the numbering sample; both scroll with content.
2. **Per-section:** `start_on_new_page` on a Partie heading + `set_section_header` → a dashed marker chip appears above that heading's row naming the new header.
3. **No chrome:** a fresh thesis with no header/footer → outline is pixel-identical to before (no zones, no markers).
4. **Optimistic shift:** with a marker visible, drag a block from above it to below it → the marker stays glued to its section-start row (and settles after the save confirms).

---

## Out of scope (per spec)

Tap-to-edit, first-page/odd-even variants, images/tables inside chrome, ribbon Insert → Header/Footer wiring.
