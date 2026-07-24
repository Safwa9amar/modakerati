# Template Placeholders → Wizard-Filled Covers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user creates a thesis from a template, auto-detect the template's `{placeholder}` fields, collect them in a dedicated wizard step, and substitute them into the copied `.docx` cover — robustly (single/double brace, RTL, run-split-safe, registry-gated).

**Architecture:** A single server-side **canonical field registry** (`template-fields.ts`) is the source of truth. Templates are **scanned at publish** and their field list is stored on `templates.config.placeholderFields` (jsonb, no migration). The app renders a dynamic form from that list, sends the values as `frontMatter` on create, and the server fills the copied `.docx` with a **pure, cross-run-safe, literal (non-regex) block rewrite** — because the engine's built-in `findAndReplaceAll` is regex-based and only rewrites within a single `w:t` run, so a Word-split `{title}` would never match.

**Tech Stack:** Server — Hono, Drizzle, `mdocxengine`, Vitest. App — Expo/React Native, Zustand, react-i18next.

**Reference spec:** `docs/superpowers/specs/2026-07-24-template-placeholders-design.md`

**Planning refinement (note):** the registry adds a `faculty` field beyond the spec's §1 table, so the generic starter template's existing `{{faculty}}` token also fills — otherwise the proof template would ship a literal `{{faculty}}`.

---

## File Structure

**Server (`~/modakerati-server`)**
- `src/lib/template-fields.ts` — **new**. Registry + pure helpers: `TEMPLATE_FIELDS`, `canonicalKeyForToken`, `scanPlaceholderFields`, `resolveFieldValues`, `buildTokenValueMap`, `fillParagraphXml` (+ `escapeXml`/`unescapeXml`).
- `src/lib/docx.ts` — **modify**. Replace `templatePlaceholders` + the `findAndReplaceAll` loop in `buildDocFromTemplate` with the registry-driven block rewrite.
- `src/routes/template.ts` — **modify**. Scan uploaded `.docx` on publish; write `config.placeholderFields`.
- `src/lib/template-scan.ts` — **new**. `scanTemplateBufferFields(buffer)` shared by the route, scripts, and backfill.
- `scripts/publish-starter-template.ts`, `scripts/publish-elbayadh-template.ts` — **modify**. Persist scanned `placeholderFields`.
- `scripts/backfill-template-fields.ts` — **new**. Re-scan existing active templates.
- `src/__tests__/template-fields.test.ts` — **new**. Pure-helper + integration tests.

**App (`~/modakerati`)**
- `lib/api.ts` — **modify**. `createThesis()` accepts + forwards `frontMatter`.
- `types/thesis.ts` — **modify**. Add `placeholderFields?` to `Template.config`; export `TemplateField` type.
- `stores/thesis-wizard-store.ts` — **modify**. Add `"fields"` step + `fieldValues`.
- `app/(app)/thesis-fields.tsx` — **new**. Dynamic form screen.
- `app/(app)/template-preview.tsx` — **modify**. Route to `thesis-fields` (or skip to `thesis-plan`).
- `app/(app)/thesis-plan.tsx` — **modify**. Build + send `frontMatter` from `fieldValues`.
- `locales/{en,fr,ar}.json` — **modify** (surgical). `wizard.fields.*` + step labels.

**Conventions**
- Server tests: `npm test` runs `vitest run`. Run one file with `npx vitest run src/__tests__/template-fields.test.ts`.
- App has **no JS test runner**: gate every app task with `npx tsc --noEmit` (run from `~/modakerati`) + device QA at the end.
- Git (parallel sessions): `git add` **exact paths only**, never `--amend`, re-check `git status` if interrupted. Server commits run from `~/modakerati-server`; app commits from `~/modakerati`.

---

## Task 1: Registry + scan/resolve/token-map helpers (server)

**Files:**
- Create: `~/modakerati-server/src/lib/template-fields.ts`
- Test: `~/modakerati-server/src/__tests__/template-fields.test.ts`

- [ ] **Step 1: Write the failing tests (registry, scan, resolve, token-map)**

Create `src/__tests__/template-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TEMPLATE_FIELDS,
  canonicalKeyForToken,
  scanPlaceholderFields,
  resolveFieldValues,
  buildTokenValueMap,
} from "../lib/template-fields";

describe("canonicalKeyForToken", () => {
  it("maps a canonical key to itself", () => {
    expect(canonicalKeyForToken("student_name")).toBe("student_name");
  });
  it("maps an alias to its canonical key", () => {
    expect(canonicalKeyForToken("author")).toBe("student_name");
    expect(canonicalKeyForToken("university")).toBe("institute_name");
    expect(canonicalKeyForToken("year")).toBe("academic_year");
  });
  it("returns null for an unknown token (e.g. the body marker)", () => {
    expect(canonicalKeyForToken("body")).toBeNull();
    expect(canonicalKeyForToken("nope")).toBeNull();
  });
});

describe("scanPlaceholderFields", () => {
  it("finds single- and double-brace tokens, resolves aliases, dedupes, preserves registry order", () => {
    const text = "معهد: {institute_name}\n{{author}} — {supervisor_name}\n{title} {title}";
    const keys = scanPlaceholderFields(text).map((f) => f.key);
    // registry order: title, ..., student_name, supervisor_name, institute_name, ...
    expect(keys).toEqual(["title", "student_name", "supervisor_name", "institute_name"]);
  });
  it("ignores the {{body}} marker and unknown tokens", () => {
    expect(scanPlaceholderFields("{{body}} {unknown} plain").map((f) => f.key)).toEqual([]);
  });
});

describe("resolveFieldValues", () => {
  it("uses canonical frontMatter keys, then aliases, then profile, then title from input", () => {
    const v = resolveFieldValues({
      title: "Mon mémoire",
      frontMatter: { student_name: "Ali", supervisor: "Dr X" }, // supervisor is an alias key
      profile: { fullName: "Ignored", university: "UBBA", department: "Info" },
    });
    expect(v.title).toBe("Mon mémoire");
    expect(v.student_name).toBe("Ali");        // canonical wins over profile.fullName
    expect(v.supervisor_name).toBe("Dr X");    // alias key in frontMatter
    expect(v.institute_name).toBe("UBBA");     // profile fallback
    expect(v.class_name).toBe("Info");         // profile.department fallback
    expect(v.branch_name).toBe("");            // nothing provided
  });
  it("joins a legacy authors array", () => {
    const v = resolveFieldValues({ frontMatter: { authors: ["A", "B"] } });
    expect(v.student_name).toBe("A • B");
  });
});

describe("buildTokenValueMap", () => {
  it("emits single+double brace needles for each key AND its aliases", () => {
    const map = buildTokenValueMap({ student_name: "Ali" } as any);
    expect(map["{student_name}"]).toBe("Ali");
    expect(map["{{student_name}}"]).toBe("Ali");
    expect(map["{author}"]).toBe("Ali");   // alias
    expect(map["{{author}}"]).toBe("Ali");
    expect(map["{body}"]).toBeUndefined(); // not a field → never mapped
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts`
Expected: FAIL — `Cannot find module '../lib/template-fields'`.

- [ ] **Step 3: Implement the registry + helpers (excluding fillParagraphXml, added in Task 2)**

Create `src/lib/template-fields.ts`:

```ts
// Canonical registry of template placeholder fields + pure token helpers.
// SINGLE SOURCE OF TRUTH: drives (a) which {tokens} are recognized when a
// template is scanned, (b) the wizard form's field types/required/prefill, and
// (c) substitution into the copied .docx. Adding a field = one row here (+ three
// i18n label strings in the app). Pure module — no docx/DB imports.

export type TemplateFieldType = "text" | "multiline" | "year";
export type PrefillSource =
  | "profile.fullName"
  | "profile.university"
  | "profile.department"
  | "currentYear";

export interface TemplateField {
  key: string;               // canonical key, e.g. "student_name"
  type: TemplateFieldType;
  required: boolean;
  prefill?: PrefillSource;
  aliases?: string[];        // legacy/alternate tokens that resolve to this field
}

export const TEMPLATE_FIELDS: TemplateField[] = [
  { key: "title", type: "text", required: true },
  { key: "subtitle", type: "text", required: false },
  { key: "student_name", type: "text", required: true, prefill: "profile.fullName", aliases: ["author", "authors"] },
  { key: "supervisor_name", type: "text", required: false, aliases: ["supervisor"] },
  { key: "institute_name", type: "text", required: false, prefill: "profile.university", aliases: ["university"] },
  { key: "faculty", type: "text", required: false },
  { key: "class_name", type: "text", required: false, prefill: "profile.department", aliases: ["department"] },
  { key: "branch_name", type: "text", required: false, aliases: ["branch"] },
  { key: "specialty_name", type: "text", required: false, aliases: ["specialty"] },
  { key: "academic_year", type: "year", required: false, prefill: "currentYear", aliases: ["year", "academicYear"] },
];

const TOKEN_TO_CANONICAL: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const f of TEMPLATE_FIELDS) {
    m[f.key] = f.key;
    for (const a of f.aliases ?? []) m[a] = f.key;
  }
  return m;
})();

/** Canonical key for a bare token name (no braces), or null if unknown. */
export function canonicalKeyForToken(token: string): string | null {
  return TOKEN_TO_CANONICAL[token] ?? null;
}

/** All registry fields referenced by {key} / {{key}} tokens in `text`, deduped, in registry order. */
export function scanPlaceholderFields(text: string): TemplateField[] {
  const found = new Set<string>();
  const re = /\{\{?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const canonical = canonicalKeyForToken(m[1]);
    if (canonical) found.add(canonical);
  }
  return TEMPLATE_FIELDS.filter((f) => found.has(f.key));
}

/** Resolve every canonical field to a string value from thesis title + frontMatter (+ profile fallback). */
export function resolveFieldValues(input: {
  title?: string;
  frontMatter?: Record<string, any> | null;
  profile?: { fullName?: string | null; university?: string | null; department?: string | null } | null;
}): Record<string, string> {
  const fm = input.frontMatter ?? {};
  const p = input.profile ?? {};
  const authorsArr = Array.isArray(fm.authors) ? fm.authors.filter(Boolean) : null;
  const authorsLine = authorsArr ? authorsArr.join(" • ") : undefined;
  const first = (...vals: Array<unknown>): string => {
    for (const v of vals) if (typeof v === "string" && v.length) return v;
    return "";
  };
  return {
    title: first(input.title, fm.title),
    subtitle: first(fm.subtitle),
    student_name: first(fm.student_name, fm.author, authorsLine, p.fullName),
    supervisor_name: first(fm.supervisor_name, fm.supervisor),
    institute_name: first(fm.institute_name, fm.university, p.university),
    faculty: first(fm.faculty),
    class_name: first(fm.class_name, fm.department, p.department),
    branch_name: first(fm.branch_name, fm.branch),
    specialty_name: first(fm.specialty_name, fm.specialty),
    academic_year: first(fm.academic_year, fm.academicYear, fm.year),
  };
}

/** Map every doc token (both braces, canonical + aliases) → its resolved value. Unknown tokens are never mapped. */
export function buildTokenValueMap(values: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of TEMPLATE_FIELDS) {
    const v = values[f.key] ?? "";
    for (const name of [f.key, ...(f.aliases ?? [])]) {
      map[`{${name}}`] = v;
      map[`{{${name}}}`] = v;
    }
  }
  return map;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts`
Expected: PASS (all `canonicalKeyForToken`, `scanPlaceholderFields`, `resolveFieldValues`, `buildTokenValueMap` cases).

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/template-fields.ts src/__tests__/template-fields.test.ts
git commit -m "feat(templates): canonical placeholder-field registry + token helpers"
```

---

## Task 2: Cross-run-safe paragraph fill (`fillParagraphXml`) (server)

This is the make-or-break piece: the engine's `findAndReplaceAll` uses `new RegExp(search)` and only rewrites text inside a single `w:t` node, so a Word-split `{title}` won't match. `fillParagraphXml` does a **literal** replace over the paragraph's combined run text, then redistributes the result into the first `w:t` (rest emptied), preserving `w:pPr`, the first run's `w:rPr`, and any `w:proofErr` markers.

**Files:**
- Modify: `~/modakerati-server/src/lib/template-fields.ts`
- Test: `~/modakerati-server/src/__tests__/template-fields.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/__tests__/template-fields.test.ts`:

```ts
import { fillParagraphXml } from "../lib/template-fields";

describe("fillParagraphXml", () => {
  const map = buildTokenValueMap({
    title: "Mon mémoire",
    institute_name: "Université de Béchar",
    student_name: "Ali & Co",
  } as any);

  it("fills a single-run token", () => {
    const xml = `<w:p><w:pPr/><w:r><w:rPr><w:b/></w:rPr><w:t>{title}</w:t></w:r></w:p>`;
    const out = fillParagraphXml(xml, map);
    expect(out).toContain("Mon mémoire");
    expect(out).not.toContain("{title}");
  });

  it("fills a token split across runs (proofErr) into the first run, emptying the rest, keeping markers", () => {
    const xml =
      `<w:p><w:pPr/>` +
      `<w:r><w:t xml:space="preserve">معهد: {</w:t></w:r>` +
      `<w:proofErr w:type="spellStart"/>` +
      `<w:r><w:t>institute_name</w:t></w:r>` +
      `<w:proofErr w:type="spellEnd"/>` +
      `<w:r><w:t>}</w:t></w:r></w:p>`;
    const out = fillParagraphXml(xml, map);
    expect(out).toContain("معهد: Université de Béchar");
    expect(out).not.toContain("{institute_name}");
    expect(out).toContain(`<w:proofErr w:type="spellStart"/>`); // markers preserved
    expect(out.match(/<w:t[^>]*><\/w:t>/g)?.length).toBe(2);    // the other two runs emptied
  });

  it("XML-escapes the inserted value and does not double-escape existing entities", () => {
    const xml = `<w:p><w:r><w:t>A &amp; {student_name}</w:t></w:r></w:p>`;
    const out = fillParagraphXml(xml, map);
    expect(out).toContain("A &amp; Ali &amp; Co"); // existing &amp; kept, value's & escaped once
  });

  it("returns the input byte-identical when no known token is present", () => {
    const xml = `<w:p><w:r><w:t>{unknown} plain</w:t></w:r></w:p>`;
    expect(fillParagraphXml(xml, map)).toBe(xml);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts -t fillParagraphXml`
Expected: FAIL — `fillParagraphXml is not a function`.

- [ ] **Step 3: Implement `fillParagraphXml` (+ escape helpers)**

Append to `src/lib/template-fields.ts`:

```ts
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const WT_RE = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;

/**
 * Fill known tokens in ONE paragraph's XML, cross-run-safe. Tokens may be split
 * across runs / interrupted by w:proofErr markers. Literal (non-regex) matching.
 * On a match, the whole run text is rebuilt into the FIRST <w:t> (with
 * xml:space="preserve") and every other <w:t> emptied; pPr/rPr/markers survive.
 * Returns the input unchanged (===) when nothing matched, so callers can keep
 * untouched blocks byte-identical.
 */
export function fillParagraphXml(xml: string, tokenMap: Record<string, string>): string {
  const needles = Object.keys(tokenMap);
  if (!needles.length) return xml;

  const texts: string[] = [];
  let m: RegExpExecArray | null;
  WT_RE.lastIndex = 0;
  while ((m = WT_RE.exec(xml))) texts.push(unescapeXml(m[2]));
  if (!texts.length) return xml;

  const combined = texts.join("");
  let replaced = combined;
  for (const needle of needles) {
    if (replaced.includes(needle)) replaced = replaced.split(needle).join(tokenMap[needle]);
  }
  if (replaced === combined) return xml; // no known token present → byte-identical

  let i = 0;
  WT_RE.lastIndex = 0;
  return xml.replace(WT_RE, (_full, attrs: string) => {
    if (i++ === 0) {
      const withSpace = /xml:space=/.test(attrs) ? attrs : `${attrs} xml:space="preserve"`;
      return `<w:t${withSpace}>${escapeXml(replaced)}</w:t>`;
    }
    return `<w:t${attrs}></w:t>`;
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts`
Expected: PASS (all suites, including the cross-run + escape cases).

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/template-fields.ts src/__tests__/template-fields.test.ts
git commit -m "feat(templates): cross-run-safe, literal paragraph token fill"
```

---

## Task 3: Wire the registry fill into `buildDocFromTemplate` (server)

Replace the regex `findAndReplaceAll` loop with the registry-driven, block-level rewrite. Untouched paragraphs stay byte-identical; the `{{body}}` outline marker step is unchanged.

**Files:**
- Modify: `~/modakerati-server/src/lib/docx.ts:155-204`
- Test: `~/modakerati-server/src/__tests__/template-fields.test.ts`

- [ ] **Step 1: Add the failing integration test (uses the real starter template)**

Append to `src/__tests__/template-fields.test.ts`:

```ts
import { Mdocxengine, paragraphText } from "mdocxengine";
import { buildStarterTemplateBuffer } from "../lib/starter-template";
import { buildDocFromTemplate } from "../lib/docx";

async function docText(buffer: Buffer): Promise<string> {
  const e = await Mdocxengine.loadFromBuffer(buffer);
  const blocks = await e.document.getBlocks();
  return blocks.map((b: any) => (b.kind === "paragraph" ? paragraphText(b.xml) : "")).join("\n");
}

describe("buildDocFromTemplate — registry fill (starter template)", () => {
  it("fills canonical + alias tokens, drops the body marker, leaves no raw tokens", async () => {
    const template = await buildStarterTemplateBuffer(); // has {{title}},{{author}},{{university}},{{body}}…
    const meta = {
      thesis: {
        title: "Mon mémoire",
        language: "fr",
        frontMatter: { student_name: "Ali Ben", institute_name: "Univ. Béchar", specialty_name: "IA" },
      },
      template: { bindingSide: "left" },
      profile: null,
    };
    const { buffer } = await buildDocFromTemplate(template as any, meta as any, [
      { title: "Partie 1", kind: "section", chapters: [{ title: "Chapitre 1" }] },
    ]);
    const text = await docText(buffer);

    expect(text).toContain("Mon mémoire");   // {{title}}
    expect(text).toContain("Ali Ben");        // {{author}} via student_name alias
    expect(text).toContain("Univ. Béchar");   // {{university}} via institute_name alias
    expect(text).toContain("Partie 1");       // {{body}} → generated outline
    expect(text).not.toMatch(/\{\{?[a-z_]+\}?\}/i); // no raw tokens survive
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts -t "registry fill"`
Expected: FAIL — the current `templatePlaceholders` only knows `{{title}}`/`{{author}}`/`{{university}}` (so those pass) but leaves `{{faculty}}`/`{{specialty}}`/`{{supervisor}}`/`{{year}}` as raw tokens, so the "no raw tokens survive" assertion fails.

- [ ] **Step 3: Replace `templatePlaceholders` + the fill loop in `docx.ts`**

In `src/lib/docx.ts`, add to the existing `mdocxengine`/local imports near the top of the file:

```ts
import { resolveFieldValues, buildTokenValueMap, fillParagraphXml } from "./template-fields";
```

Delete the whole `templatePlaceholders` function (currently `src/lib/docx.ts:155-176`).

Then replace the current fill block in `buildDocFromTemplate` (currently `src/lib/docx.ts:194-204`):

```ts
  // 1. Personalise: fill ONLY the {{tokens}} the template actually contains.
  //    Running findAndReplaceAll for an ABSENT token is not a no-op on complex
  //    layouts — it can disturb cover textboxes/anchored shapes (e.g. the El
  //    Bayadh page de garde). A template with no tokens (verbatim cover) is left
  //    byte-identical.
  const initial = await engine.document.getBlocks();
  const docText = initial.map((b) => (b.kind === "paragraph" ? paragraphText(b.xml) : "")).join("\n");
  for (const [token, value] of Object.entries(templatePlaceholders(meta))) {
    const needle = `{{${token}}}`;
    if (docText.includes(needle)) await engine.document.findAndReplaceAll(needle, value);
  }
```

with:

```ts
  // 1. Personalise: registry-gated, cross-run-safe token fill over body
  //    paragraphs. Only paragraphs whose XML actually changes are re-saved, so
  //    untouched blocks (cover textboxes, anchored shapes, tables) stay
  //    byte-identical — a template with no known tokens is left as-is.
  const values = resolveFieldValues({
    title: meta.thesis.title,
    frontMatter: (meta.thesis as any).frontMatter,
    profile: meta.profile as any,
  });
  const tokenMap = buildTokenValueMap(values);
  const initial = await engine.document.getBlocks();
  let changed = false;
  const filled = initial.map((b) => {
    if (b.kind !== "paragraph") return b;
    const nextXml = fillParagraphXml(b.xml, tokenMap);
    if (nextXml === b.xml) return b;
    changed = true;
    return { ...b, xml: nextXml };
  });
  if (changed) await engine.document.saveBlocks(filled as any);
```

Leave the `{{body}}` marker step (currently `src/lib/docx.ts:206-222`) and everything below it unchanged.

- [ ] **Step 4: Run the integration test AND the full suite**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts`
Expected: PASS — every token filled, `{{body}}` replaced by the outline, no raw tokens survive.

Then confirm nothing else regressed:
Run: `cd ~/modakerati-server && npm test`
Expected: PASS (whole suite). If a pre-existing test needs a live DB and was already skipped/failing before this change, note it but do not fix it here.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/docx.ts src/__tests__/template-fields.test.ts
git commit -m "feat(templates): registry-driven cover fill in buildDocFromTemplate"
```

---

## Task 4: Scan a template's fields on publish (server)

Extract the scan into a shared helper, then wire it into the admin upload route and the two publish scripts so `templates.config.placeholderFields` is populated.

**Files:**
- Create: `~/modakerati-server/src/lib/template-scan.ts`
- Modify: `~/modakerati-server/src/routes/template.ts:40-58`
- Modify: `~/modakerati-server/scripts/publish-starter-template.ts`, `~/modakerati-server/scripts/publish-elbayadh-template.ts`
- Test: `~/modakerati-server/src/__tests__/template-fields.test.ts`

- [ ] **Step 1: Add the failing test for the shared scanner**

Append to `src/__tests__/template-fields.test.ts`:

```ts
import { scanTemplateBufferFields } from "../lib/template-scan";

describe("scanTemplateBufferFields (starter template)", () => {
  it("returns the descriptor list the starter template declares", async () => {
    const buf = await buildStarterTemplateBuffer();
    const fields = await scanTemplateBufferFields(buf);
    const keys = fields.map((f) => f.key);
    // starter has {{university}},{{faculty}},{{department}},{{title}},{{specialty}},
    // {{author}},{{supervisor}},{{year}} (and {{body}}, which is NOT a field).
    expect(keys).toEqual(
      expect.arrayContaining([
        "title", "student_name", "institute_name", "faculty",
        "class_name", "specialty_name", "supervisor_name", "academic_year",
      ]),
    );
    expect(keys).not.toContain("body");
    // descriptors carry type/required/prefill for the app form
    expect(fields.find((f) => f.key === "title")).toMatchObject({ type: "text", required: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts -t scanTemplateBufferFields`
Expected: FAIL — `Cannot find module '../lib/template-scan'`.

- [ ] **Step 3: Implement the shared scanner**

Create `src/lib/template-scan.ts`:

```ts
import { Mdocxengine, paragraphText } from "mdocxengine";
import { scanPlaceholderFields, type TemplateField } from "./template-fields";

/** Descriptor stored on templates.config.placeholderFields and read by the app form. */
export type PlaceholderFieldDescriptor = Pick<
  TemplateField,
  "key" | "type" | "required" | "prefill"
>;

/** Scan a template .docx buffer and return its declared placeholder fields (body text only). */
export async function scanTemplateBufferFields(
  buffer: Buffer,
): Promise<PlaceholderFieldDescriptor[]> {
  const engine = await Mdocxengine.loadFromBuffer(buffer);
  const blocks = await engine.document.getBlocks();
  const text = blocks
    .map((b: any) => (b.kind === "paragraph" ? paragraphText(b.xml) : ""))
    .join("\n");
  return scanPlaceholderFields(text).map((f) => ({
    key: f.key,
    type: f.type,
    required: f.required,
    ...(f.prefill ? { prefill: f.prefill } : {}),
  }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/template-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the scan into the admin upload route**

In `src/routes/template.ts`, add the import near the top:

```ts
import { scanTemplateBufferFields } from "../lib/template-scan";
```

Replace the current config + insert (currently `src/routes/template.ts:41-58`):

```ts
  const language = String(body["language"] ?? "fr");
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `${randomUUID()}.docx`;
  await uploadTemplateDocx(key, buffer);

  const [row] = await db
    .insert(templates)
    .values({
      name,
      university: String(body["university"] ?? "").trim() || name,
      type: String(body["type"] ?? "memoire_master"),
      language,
      description: String(body["description"] ?? "") || null,
      bindingSide: String(body["bindingSide"] ?? (language === "ar" ? "right" : "left")),
      config: { paperSize: "A4" },
      docxPath: key,
      isActive: true,
    })
    .returning();
  return c.json(row, 201);
```

with:

```ts
  const language = String(body["language"] ?? "fr");
  const buffer = Buffer.from(await file.arrayBuffer());
  const key = `${randomUUID()}.docx`;
  await uploadTemplateDocx(key, buffer);

  // Auto-detect the placeholder fields the template declares so the create
  // wizard can collect exactly them. Best-effort: a scan failure still yields a
  // usable (form-less) template.
  let placeholderFields: Awaited<ReturnType<typeof scanTemplateBufferFields>> = [];
  try {
    placeholderFields = await scanTemplateBufferFields(buffer);
  } catch (e) {
    console.warn("template field scan failed:", (e as any)?.message ?? e);
  }

  const [row] = await db
    .insert(templates)
    .values({
      name,
      university: String(body["university"] ?? "").trim() || name,
      type: String(body["type"] ?? "memoire_master"),
      language,
      description: String(body["description"] ?? "") || null,
      bindingSide: String(body["bindingSide"] ?? (language === "ar" ? "right" : "left")),
      config: { paperSize: "A4", placeholderFields },
      docxPath: key,
      isActive: true,
    })
    .returning();
  return c.json(row, 201);
```

- [ ] **Step 6: Wire the scan into the publish scripts**

In `scripts/publish-starter-template.ts` and `scripts/publish-elbayadh-template.ts`, locate where the script builds the `config` object for the upserted `templates` row (the `config: { ... }` passed to `.values(...)`/`.set(...)`). Add the import at the top of each:

```ts
import { scanTemplateBufferFields } from "../src/lib/template-scan";
```

Immediately before the insert/upsert, compute the fields from the same buffer the script uploads (the variable holding the `.docx` bytes — `buffer`/`buf`/`bytes` depending on the script; use whichever the script already has), then include it in `config`:

```ts
  const placeholderFields = await scanTemplateBufferFields(buffer);
  // …then add `placeholderFields` into the existing `config: { … }` object, e.g.
  //   config: { paperSize: "A4", /* …existing keys… */, placeholderFields },
```

If a script updates an existing row via `.set({ ... })`, add `config: { ...existingConfig, placeholderFields }` there too so re-publishing refreshes the field list.

- [ ] **Step 7: Verify the scripts typecheck (do not run — they hit storage/DB)**

Run: `cd ~/modakerati-server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd ~/modakerati-server
git add src/lib/template-scan.ts src/routes/template.ts scripts/publish-starter-template.ts scripts/publish-elbayadh-template.ts src/__tests__/template-fields.test.ts
git commit -m "feat(templates): scan + persist placeholderFields on publish"
```

---

## Task 5: Backfill existing templates (server)

**Files:**
- Create: `~/modakerati-server/scripts/backfill-template-fields.ts`

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-template-fields.ts`:

```ts
// Re-scan every active template that has a stored .docx and populate
// config.placeholderFields so already-published templates gain a wizard form.
//   npx tsx scripts/backfill-template-fields.ts
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, templates } from "../src/db";
import { downloadTemplateDocx } from "../src/lib/template-storage";
import { scanTemplateBufferFields } from "../src/lib/template-scan";

async function main() {
  const rows = await db.select().from(templates).where(eq(templates.isActive, true));
  let updated = 0;
  for (const row of rows) {
    if (!row.docxPath) continue;
    try {
      const buffer = await downloadTemplateDocx(row.docxPath);
      const placeholderFields = await scanTemplateBufferFields(buffer);
      const config = { ...(row.config as any), placeholderFields };
      await db.update(templates).set({ config }).where(eq(templates.id, row.id));
      updated++;
      console.log(`✓ ${row.name}: [${placeholderFields.map((f) => f.key).join(", ")}]`);
    } catch (e) {
      console.warn(`✗ ${row.name}:`, (e as any)?.message ?? e);
    }
  }
  console.log(`Done. Updated ${updated}/${rows.length} templates.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati-server && npx tsc --noEmit`
Expected: no errors. (Do not run the script here — it needs DB/storage creds; the user runs it during deploy.)

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati-server
git add scripts/backfill-template-fields.ts
git commit -m "feat(templates): backfill script for placeholderFields"
```

---

## Task 6: App — `createThesis` sends `frontMatter` + `Template.config` type (app)

**Files:**
- Modify: `~/modakerati/lib/api.ts:406-416`
- Modify: `~/modakerati/types/thesis.ts:40-55`

- [ ] **Step 1: Add `frontMatter` to `createThesis`**

In `lib/api.ts`, replace the `createThesis` signature (`lib/api.ts:406-416`):

```ts
export async function createThesis(input: {
  title: string;
  templateId?: string;
  normProfileId?: string;
  language?: string;
  // The generated outline that SEEDS the working .docx. It is not persisted as
  // section/chapter rows — the .docx is the source of truth.
  sections?: Array<{ title: string; kind?: "introduction" | "section" | "conclusion"; chapters?: Array<{ title: string; content?: string }> }>;
}) {
  return apiPost<Thesis>("/api/thesis", input);
}
```

with:

```ts
export async function createThesis(input: {
  title: string;
  templateId?: string;
  normProfileId?: string;
  language?: string;
  // Canonical placeholder values collected in the wizard's fields step; the
  // server substitutes them into the copied template cover.
  frontMatter?: Record<string, string>;
  // The generated outline that SEEDS the working .docx. It is not persisted as
  // section/chapter rows — the .docx is the source of truth.
  sections?: Array<{ title: string; kind?: "introduction" | "section" | "conclusion"; chapters?: Array<{ title: string; content?: string }> }>;
}) {
  return apiPost<Thesis>("/api/thesis", input);
}
```

- [ ] **Step 2: Add `TemplateField` + `placeholderFields` to the type**

In `types/thesis.ts`, add this type just above `export interface Template {` (`types/thesis.ts:40`):

```ts
export interface TemplateField {
  key: string;
  type: "text" | "multiline" | "year";
  required: boolean;
  prefill?: "profile.fullName" | "profile.university" | "profile.department" | "currentYear";
}
```

Then add `placeholderFields` to `Template.config` (inside the `config: { … }` block, `types/thesis.ts:50-55`), after the `thumbUrl?` line:

```ts
    pdfUrl?: string; // optional public URL to the template's PDF version
    thumbUrl?: string; // optional public URL to the template's preview image / thumbnail
    placeholderFields?: TemplateField[]; // auto-detected fields the create wizard collects
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add lib/api.ts types/thesis.ts
git commit -m "feat(wizard): createThesis frontMatter + Template.placeholderFields type"
```

---

## Task 7: App — wizard store gains a `fields` step + `fieldValues` (app)

**Files:**
- Modify: `~/modakerati/stores/thesis-wizard-store.ts`

- [ ] **Step 1: Add the step + state**

Replace the whole body of `stores/thesis-wizard-store.ts` with:

```ts
import { create } from "zustand";

export interface WizardPlanSection {
  title: string;
  kind: "introduction" | "section" | "conclusion";
  chapters: { title: string; hint?: string; content?: string }[];
}

export type WizardStep = "template" | "title" | "fields" | "plan" | "confirm";

interface WizardState {
  step: WizardStep;
  title: string;
  language: string;
  templateId: string | null;
  normProfileId: string | null;
  supervisor: string;
  academicYear: string;
  fieldValues: Record<string, string>;
  plan: WizardPlanSection[] | null;
  set: (patch: Partial<Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "fieldValues" | "plan">>) => void;
  reset: () => void;
}

const INITIAL: Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "fieldValues" | "plan"> = {
  step: "template",
  title: "",
  language: "fr",
  templateId: null,
  normProfileId: null,
  supervisor: "",
  academicYear: "",
  fieldValues: {},
  plan: null,
};

export const useThesisWizard = create<WizardState>((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  reset: () => set(INITIAL),
}));
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add stores/thesis-wizard-store.ts
git commit -m "feat(wizard): add fields step + fieldValues to wizard store"
```

---

## Task 8: App — i18n keys for the fields step (app)

Surgical edits only — these locale files contain duplicate keys, so **never** reserialize (no `json.load`/`dump`). Insert the new block immediately after the `"wizard": {` line in each file.

**Files:**
- Modify: `~/modakerati/locales/en.json:448`
- Modify: `~/modakerati/locales/fr.json:448`
- Modify: `~/modakerati/locales/ar.json:448`

- [ ] **Step 1: English — insert after `"wizard": {` (line 448)**

Insert this block right after the `"wizard": {` line in `locales/en.json`:

```json
    "fieldsStepTitle": "Your details",
    "fieldsStepSubtitle": "Fill in the details that appear on your cover page.",
    "fieldsRequired": "This field is required.",
    "fields": {
      "title": "Thesis title",
      "subtitle": "Subtitle",
      "student_name": "Student name",
      "supervisor_name": "Supervisor",
      "institute_name": "Institute",
      "faculty": "Faculty",
      "class_name": "Department",
      "branch_name": "Branch",
      "specialty_name": "Specialty",
      "academic_year": "Academic year"
    },
```

- [ ] **Step 2: French — insert after `"wizard": {` (line 448)**

Insert this block right after the `"wizard": {` line in `locales/fr.json`:

```json
    "fieldsStepTitle": "Vos informations",
    "fieldsStepSubtitle": "Renseignez les informations qui figurent sur votre page de garde.",
    "fieldsRequired": "Ce champ est obligatoire.",
    "fields": {
      "title": "Titre du mémoire",
      "subtitle": "Sous-titre",
      "student_name": "Nom de l'étudiant",
      "supervisor_name": "Encadrant",
      "institute_name": "Institut",
      "faculty": "Faculté",
      "class_name": "Département",
      "branch_name": "Filière",
      "specialty_name": "Spécialité",
      "academic_year": "Année universitaire"
    },
```

- [ ] **Step 3: Arabic — insert after `"wizard": {` (line 448)**

Insert this block right after the `"wizard": {` line in `locales/ar.json`:

```json
    "fieldsStepTitle": "معلوماتك",
    "fieldsStepSubtitle": "أدخل المعلومات التي تظهر في صفحة الغلاف.",
    "fieldsRequired": "هذا الحقل مطلوب.",
    "fields": {
      "title": "عنوان المذكرة",
      "subtitle": "العنوان الفرعي",
      "student_name": "اسم الطالب",
      "supervisor_name": "المشرف",
      "institute_name": "المعهد",
      "faculty": "الكلية",
      "class_name": "القسم",
      "branch_name": "الفرع",
      "specialty_name": "التخصص",
      "academic_year": "السنة الجامعية"
    },
```

- [ ] **Step 4: Verify the JSON is still valid (parses) in all three files**

Run: `cd ~/modakerati && node -e "['en','fr','ar'].forEach(l=>{JSON.parse(require('fs').readFileSync('locales/'+l+'.json','utf8'));console.log(l,'ok')})"`
Expected: `en ok` / `fr ok` / `ar ok` (no parse error from a misplaced comma).

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(wizard): i18n for the template fields step (en/fr/ar)"
```

---

## Task 9: App — the dynamic fields screen (app)

**Files:**
- Create: `~/modakerati/app/(app)/thesis-fields.tsx`

- [ ] **Step 1: Create the screen**

Create `app/(app)/thesis-fields.tsx`:

```tsx
import { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { useProfileStore } from "@/stores/profile-store";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import type { TemplateField } from "@/types/thesis";

function currentAcademicYear(): string {
  const y = new Date().getFullYear();
  return `${y}/${y + 1}`;
}

function prefillFor(
  field: TemplateField,
  ctx: { wizardTitle: string; profile: { fullName?: string; university?: string | null; department?: string | null } | null },
): string {
  if (field.key === "title") return ctx.wizardTitle ?? "";
  switch (field.prefill) {
    case "profile.fullName": return ctx.profile?.fullName ?? "";
    case "profile.university": return ctx.profile?.university ?? "";
    case "profile.department": return ctx.profile?.department ?? "";
    case "currentYear": return currentAcademicYear();
    default: return "";
  }
}

export default function ThesisFieldsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { templateId, title } = useThesisWizard();
  const templates = useThesisStore((s) => s.templates);
  const profile = useProfileStore((s) => s.profile);

  const fields = useMemo<TemplateField[]>(() => {
    const tpl = templates.find((x) => x.id === templateId);
    return tpl?.config.placeholderFields ?? [];
  }, [templates, templateId]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = prefillFor(f, { wizardTitle: title, profile });
    return seed;
  });
  const [showErrors, setShowErrors] = useState(false);

  const missingRequired = fields.some((f) => f.required && !(values[f.key] ?? "").trim());

  const handleContinue = () => {
    if (missingRequired) { setShowErrors(true); return; }
    const patch: any = { fieldValues: values, step: "plan" };
    if (values.title != null) patch.title = values.title; // keep the edited title
    useThesisWizard.getState().set(patch);
    router.push("/(app)/thesis-plan");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("wizard.fieldsStepTitle")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("wizard.fieldsStepSubtitle")}</Text>

        {fields.map((f) => {
          const invalid = showErrors && f.required && !(values[f.key] ?? "").trim();
          return (
            <View key={f.key} style={styles.field}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t(`wizard.fields.${f.key}`, { defaultValue: f.key })}
                {f.required ? " *" : ""}
              </Text>
              <TextInput
                value={values[f.key] ?? ""}
                onChangeText={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                multiline={f.type === "multiline"}
                placeholder={f.type === "year" ? currentAcademicYear() : ""}
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    backgroundColor: colors.bgSecondary,
                    borderColor: invalid ? "#E5484D" : colors.borderDefault,
                    height: f.type === "multiline" ? 96 : 48,
                  },
                ]}
              />
              {invalid && <Text style={styles.errText}>{t("wizard.fieldsRequired")}</Text>}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button title={t("wizard.continue")} onPress={handleContinue} variant="accent" disabled={missingRequired && showErrors} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  content: { padding: 20, gap: 18, paddingBottom: 100 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 4 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: "Inter_400Regular", textAlignVertical: "top",
  },
  errText: { fontSize: 12, color: "#E5484D", fontFamily: "Inter_400Regular" },
  bottomBar: { padding: 20, paddingBottom: 30 },
});
```

- [ ] **Step 2: Typecheck (confirms theme-color prop names + imports)**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors. If `colors.bgSecondary` or `colors.borderDefault` is not a valid `useThemeColors` key, open `~/modakerati/hooks/useThemeColors.ts`, pick the nearest existing token (e.g. `bgPrimary`, `borderSubtle`), and adjust — do not invent keys.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add "app/(app)/thesis-fields.tsx"
git commit -m "feat(wizard): dynamic template fields form screen"
```

---

## Task 10: App — route from the preview into the fields step (app)

**Files:**
- Modify: `~/modakerati/app/(app)/template-preview.tsx:45-69`

- [ ] **Step 1: Route to `thesis-fields` when the template declares fields, else straight to `thesis-plan`**

In `app/(app)/template-preview.tsx`, replace `handleUseTemplate` (`template-preview.tsx:48-69`):

```tsx
  const handleUseTemplate = async () => {
    if (generating) return;
    const wizard = useThesisWizard.getState();
    wizard.set({ templateId: template.id, language: template.language });
    setGenerating(true);
    try {
      const { sections } = await generateThesisPlan({
        title: useThesisWizard.getState().title || template.name,
        language: template.language,
        bodyPreset: template.bodyPreset,
        templateId: template.id,
      });
      useThesisWizard.getState().set({ plan: sections });
      router.push("/(app)/thesis-plan");
    } catch (e) {
      console.error("Failed to generate plan:", e instanceof Error ? e.message : e);
      // The plan screen regenerates / falls back when no plan is present.
      router.push("/(app)/thesis-plan");
    } finally {
      setGenerating(false);
    }
  };
```

with:

```tsx
  const handleUseTemplate = async () => {
    if (generating) return;
    const wizard = useThesisWizard.getState();
    wizard.set({ templateId: template.id, language: template.language });
    // If the template declares placeholder fields, collect them next; otherwise
    // go straight to the plan. The AI plan generates in the background either way.
    const hasFields = (template.config.placeholderFields?.length ?? 0) > 0;
    const nextRoute = hasFields ? "/(app)/thesis-fields" : "/(app)/thesis-plan";
    setGenerating(true);
    try {
      const { sections } = await generateThesisPlan({
        title: useThesisWizard.getState().title || template.name,
        language: template.language,
        bodyPreset: template.bodyPreset,
        templateId: template.id,
      });
      useThesisWizard.getState().set({ plan: sections });
      router.push(nextRoute);
    } catch (e) {
      console.error("Failed to generate plan:", e instanceof Error ? e.message : e);
      // The plan screen regenerates / falls back when no plan is present.
      router.push(nextRoute);
    } finally {
      setGenerating(false);
    }
  };
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add "app/(app)/template-preview.tsx"
git commit -m "feat(wizard): route preview → fields step when template has placeholders"
```

---

## Task 11: App — send `frontMatter` on create (app)

**Files:**
- Modify: `~/modakerati/app/(app)/thesis-plan.tsx:168-180`

- [ ] **Step 1: Include collected `fieldValues` as `frontMatter`**

In `app/(app)/thesis-plan.tsx`, inside `handleCreate`, replace the `createThesis({ … })` call (`thesis-plan.tsx:169-180`):

```tsx
      const wiz = useThesisWizard.getState();
      const created = await createThesis({
        title,
        templateId: templateId ?? undefined,
        language,
        normProfileId: wiz.normProfileId || undefined,
        sections: localPlan.map((s) => ({
          title: s.title || "Partie",
          kind: s.kind,
          chapters: s.chapters.map((c) => ({ title: c.title || "Chapitre", content: c.content })),
        })),
      });
```

with:

```tsx
      const wiz = useThesisWizard.getState();
      const frontMatter = Object.keys(wiz.fieldValues).length ? wiz.fieldValues : undefined;
      const created = await createThesis({
        title,
        templateId: templateId ?? undefined,
        language,
        normProfileId: wiz.normProfileId || undefined,
        frontMatter,
        sections: localPlan.map((s) => ({
          title: s.title || "Partie",
          kind: s.kind,
          chapters: s.chapters.map((c) => ({ title: c.title || "Chapitre", content: c.content })),
        })),
      });
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add "app/(app)/thesis-plan.tsx"
git commit -m "feat(wizard): send collected fieldValues as frontMatter on create"
```

---

## Task 12: Full verification

- [ ] **Step 1: Server test suite green**

Run: `cd ~/modakerati-server && npm test`
Expected: PASS. New `template-fields.test.ts` passes; no regressions (pre-existing DB-gated tests may be skipped as before — note, don't fix here).

- [ ] **Step 2: Server + app typecheck**

Run: `cd ~/modakerati-server && npx tsc --noEmit`
Then: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors in either.

- [ ] **Step 3: Backfill the local DB templates (once, before device QA)**

Run: `cd ~/modakerati-server && npx tsx scripts/backfill-template-fields.ts`
Expected: `✓ <template name>: [title, student_name, …]` lines, then `Done. Updated N/M`.
(If the starter/generic template isn't published locally, run `npx tsx scripts/publish-starter-template.ts` first.)

- [ ] **Step 4: Device QA — the create flow**

With the app running (Expo) and the server up:
1. Start "New thesis" → name it → pick the **generic/starter** template → "Use template".
2. Confirm the new **"Your details"** step appears with prefilled Student name (from profile) and Title.
3. Fill Institute / Specialty, leave an optional field blank, tap Continue.
4. Review the plan → Create.
5. Open the workspace and verify the cover shows the entered values, **no raw `{{token}}` / `{token}` text**, and the blank optional field renders empty (not a literal token).
6. Repeat in **Arabic** (switch language) to confirm RTL labels + values fill correctly.
7. Pick a template with **no** placeholders (or a norm profile) → confirm the fields step is **skipped**.

- [ ] **Step 5: Final status check**

Run: `cd ~/modakerati && git status && cd ~/modakerati-server && git status`
Expected: clean trees (all task commits landed), or only unrelated concurrent-session files remain.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 registry → Task 1; §2 token format + run-split → Tasks 1–2; §3 scan-at-publish → Task 4 (+backfill Task 5); §4 dedicated form step + skip-when-empty → Tasks 7,9,10; §5 data flow → Tasks 6,11; §6 substitution behavior (blank→"", unknown preserved, headers/footers **noted body-only**) → Tasks 2–3; §7 edge cases → Tasks 3,4,10; §8 testing+i18n → Tasks 1–4,8,12.
- **Deviation logged:** added `faculty` to the registry so the proof (starter) template fully fills — flagged at the top and in the handoff.
- **Header/footer scope:** the fill is body-only (`getBlocks` reads `word/document.xml`). Documented as a follow-up; the generic proof template's identity lines live in the body, so the proof is unaffected.
- **Type consistency:** `TemplateField`/`type`/`required`/`prefill` identical across server `template-fields.ts` and app `types/thesis.ts`; `fillParagraphXml`, `buildTokenValueMap`, `resolveFieldValues`, `scanTemplateBufferFields`, `placeholderFields`, `fieldValues` used consistently everywhere.
```
