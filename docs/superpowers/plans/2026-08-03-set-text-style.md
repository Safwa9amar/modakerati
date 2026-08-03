# `set_text_style` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI one tool that applies a font, size, bold, italic or colour to any named part of a thesis — body text, headings, captions, lists, table text, footnotes, title — and have the change actually show up in Word.

**Architecture:** Style-level with a target picker. Each target is a paragraph predicate bound to a Word style, ensured-then-patched in `styles.xml`. Because direct run formatting beats a style in the OOXML cascade, the style patch is followed by a **strip limited to the property the student named**, plus a **direct-write fallback** for paragraphs that would not resolve to the target's style. Two canonical-ordering helpers keep every `w:rPr` and `w:style` write inside its `xsd:sequence`.

**Tech Stack:** TypeScript, vitest, `mdocxengine` (AdmZip + string-surgery OOXML), Hono + MCP SDK on the server.

**Spec:** [`docs/superpowers/specs/2026-08-03-set-text-style-design.md`](../specs/2026-08-03-set-text-style-design.md)

**Scope:** This is plan 1 of 3. Plan 2 is `ask_user` multi-select (server + app). Plan 3 is the seed `thesis-base.docx` fix. This plan delivers the tool working end-to-end; until plan 2 lands the model asks its target question as a normal single-choice `ask_user`, which degrades gracefully.

**Repos:** `~/mdocxengine` (tasks 1–5), `~/modakerati-server` (tasks 6–10).

---

## File Structure

**Engine — `~/mdocxengine`**

| File | Responsibility |
|---|---|
| `src/core/ooxml/canonicalOrder.ts` | **New.** Split an XML fragment into top-level elements; sort them into `CT_RPr` / `CT_Style` sequence order. Pure, no zip, no IO. |
| `src/core/ooxml/canonicalOrder.spec.ts` | **New.** Tests for the above. |
| `src/core/ooxml/runProps.ts` | **New.** The `RunProps` type, the property→tag map, and pure build/merge/strip of `w:rPr` inner XML. Owns the Arabic `cs` pairing rules. |
| `src/core/ooxml/runProps.spec.ts` | **New.** Tests for the above. |
| `src/core/PartsManagers/StylesManager.ts` | **Modify.** Add `ensureStyle` + `setStyleRunProps`; route the existing heading path through the canonicalizer. |
| `src/core/PartsManagers/StylesManager.spec.ts` | **Modify.** Cover the new methods and the ordering fix. |
| `src/core/PartsManagers/TextStyleManager.ts` | **New.** Target registry, predicates, the three-step write, the per-target report. |
| `src/core/PartsManagers/TextStyleManager.spec.ts` | **New.** Tests for the above. |
| `src/Doc.ts` | **Modify.** `doc.setTextStyle(targets, props)`. |
| `src/index.ts` | **Modify.** Export the new public types. |

**Server — `~/modakerati-server`**

| File | Responsibility |
|---|---|
| `src/mcp/tools/docx-styles.ts` | **New.** Registers `set_text_style`. |
| `src/mcp/tools/docx-blocks.ts` | **Modify.** Delete `set_heading_style`. |
| `src/mcp/doc-tools.ts` | **Modify.** Wire the new group in. |
| `src/lib/ai/mcp-bridge.ts` | **Modify.** `LIVE_DOCX_TOOLS` + the advanced-formatting `TOOL_GROUPS` entry. |
| `src/lib/ai/destructive-gate.ts` | **Modify.** Gate it; preview text. |
| `src/lib/ai/types.ts` | **Modify.** System-prompt description. |
| `src/mcp/tools/analysis.ts` | **Modify.** Rebuild `apply_formatting` on the new primitive. |
| `src/mcp/__tests__/tool-registry.test.ts` | **Modify.** Registry expectations. |

---

## Task 1: Canonical OOXML element ordering

`CT_RPr` and `CT_Style` are `xsd:sequence` — child order is a schema constraint, not a preference. Two live bugs already trace to ignoring it. This task builds the shared primitive everything else writes through.

**Files:**
- Create: `~/mdocxengine/src/core/ooxml/canonicalOrder.ts`
- Test: `~/mdocxengine/src/core/ooxml/canonicalOrder.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `~/mdocxengine/src/core/ooxml/canonicalOrder.spec.ts`:

```ts
import { describe, test, expect } from "vitest";
import {
  splitTopLevelElements,
  elementName,
  canonicalizeRunProps,
  canonicalizeStyleChildren,
} from "./canonicalOrder";

describe("splitTopLevelElements", () => {
  test("splits self-closing siblings", () => {
    expect(splitTopLevelElements(`<w:b/><w:sz w:val="24"/>`)).toEqual([
      `<w:b/>`,
      `<w:sz w:val="24"/>`,
    ]);
  });

  test("keeps a paired element with nested children whole", () => {
    const xml = `<w:rPr><w:b/></w:rPr><w:name w:val="X"/>`;
    expect(splitTopLevelElements(xml)).toEqual([`<w:rPr><w:b/></w:rPr>`, `<w:name w:val="X"/>`]);
  });

  test("handles same-name nesting without closing early", () => {
    const xml = `<w:p><w:p/></w:p>`;
    expect(splitTopLevelElements(xml)).toEqual([`<w:p><w:p/></w:p>`]);
  });

  test("ignores whitespace between elements", () => {
    expect(splitTopLevelElements(`\n  <w:b/>\n  <w:i/>\n`)).toEqual([`<w:b/>`, `<w:i/>`]);
  });
});

describe("elementName", () => {
  test("reads the tag name", () => {
    expect(elementName(`<w:szCs w:val="32"/>`)).toBe("w:szCs");
    expect(elementName(`<w:rPr><w:b/></w:rPr>`)).toBe("w:rPr");
  });
});

describe("canonicalizeRunProps", () => {
  test("moves rFonts before b — the rewriteHeadingRunProps bug", () => {
    expect(canonicalizeRunProps(`<w:b/><w:bCs/><w:rFonts w:ascii="Arial"/>`)).toBe(
      `<w:rFonts w:ascii="Arial"/><w:b/><w:bCs/>`,
    );
  });

  test("sorts a full run into CT_RPr order", () => {
    const input = `<w:sz w:val="32"/><w:rtl/><w:color w:val="FF0000"/><w:rFonts w:cs="Simplified Arabic"/><w:b/>`;
    expect(canonicalizeRunProps(input)).toBe(
      `<w:rFonts w:cs="Simplified Arabic"/><w:b/><w:color w:val="FF0000"/><w:sz w:val="32"/><w:rtl/>`,
    );
  });

  test("is stable for unknown elements — they go last, in original order", () => {
    expect(canonicalizeRunProps(`<w:zzz/><w:yyy/><w:b/>`)).toBe(`<w:b/><w:zzz/><w:yyy/>`);
  });

  test("is idempotent", () => {
    const once = canonicalizeRunProps(`<w:sz w:val="32"/><w:rFonts w:ascii="Arial"/>`);
    expect(canonicalizeRunProps(once)).toBe(once);
  });

  test("returns a single element untouched, whitespace and all", () => {
    expect(canonicalizeRunProps(`\n  <w:b/>\n`)).toBe(`\n  <w:b/>\n`);
  });

  test("returns empty input untouched", () => {
    expect(canonicalizeRunProps("")).toBe("");
  });
});

describe("canonicalizeStyleChildren", () => {
  test("moves basedOn/next/qFormat before rPr — the seed styles.xml defect", () => {
    const input = `<w:name w:val="Heading 1"/><w:rPr><w:b/></w:rPr><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`;
    expect(canonicalizeStyleChildren(input)).toBe(
      `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/></w:rPr>`,
    );
  });

  test("puts pPr before rPr", () => {
    expect(canonicalizeStyleChildren(`<w:rPr><w:b/></w:rPr><w:pPr><w:jc w:val="both"/></w:pPr>`)).toBe(
      `<w:pPr><w:jc w:val="both"/></w:pPr><w:rPr><w:b/></w:rPr>`,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/mdocxengine && npx vitest run src/core/ooxml/canonicalOrder.spec.ts
```

Expected: FAIL — `Failed to resolve import "./canonicalOrder"`.

- [ ] **Step 3: Write the implementation**

Create `~/mdocxengine/src/core/ooxml/canonicalOrder.ts`:

```ts
/**
 * `CT_RPr` and `CT_Style` are `xsd:sequence` in the OOXML schema — child order
 * is a hard constraint, and Word rejects a file that violates it. Every writer
 * that touches a `<w:rPr>` or a `<w:style>` runs its output through here rather
 * than trusting the order it happened to build things in.
 */

/** `CT_RPr` child sequence, ECMA-376 Part 1 §17.3.2. */
export const CT_RPR_ORDER: readonly string[] = [
  "w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps",
  "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint",
  "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing",
  "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect",
  "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang",
  "w:eastAsianLayout", "w:specVanish", "w:oMath",
];

/** `CT_Style` child sequence, ECMA-376 Part 1 §17.7.4.17. */
export const CT_STYLE_ORDER: readonly string[] = [
  "w:name", "w:aliases", "w:basedOn", "w:next", "w:link", "w:autoRedefine",
  "w:hidden", "w:uiPriority", "w:semiHidden", "w:unhideWhenUsed", "w:qFormat",
  "w:locked", "w:personal", "w:personalCompose", "w:personalReply", "w:rsid",
  "w:pPr", "w:rPr", "w:tblPr", "w:trPr", "w:tcPr", "w:tblStylePr",
];

/** Matches one start / end / self-closing tag, skipping `>` inside attribute values. */
const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * Split a fragment into its TOP-LEVEL elements, each returned whole (nested
 * children included). Whitespace and text between elements is dropped — these
 * fragments are element-only content models, so there is nothing to preserve.
 */
export function splitTopLevelElements(fragment: string): string[] {
  const out: string[] = [];
  const re = new RegExp(TAG_RE.source, "g");
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const isClose = m[1] === "/";
    const isSelfClosing = m[4] === "/";
    if (depth === 0 && !isClose) start = m.index;
    if (!isClose && !isSelfClosing) depth++;
    else if (isClose) depth--;
    if (depth === 0 && start !== -1) {
      out.push(fragment.slice(start, m.index + m[0].length));
      start = -1;
    }
  }
  return out;
}

/** The tag name of a whole element, e.g. `<w:sz w:val="24"/>` → `w:sz`. */
export function elementName(element: string): string {
  return /^<\s*([A-Za-z_][\w.:-]*)/.exec(element)?.[1] ?? "";
}

/**
 * Sort a fragment's top-level elements into `order`. Elements not in `order`
 * sort last, keeping their relative order — an unrecognised extension is never
 * dropped, only moved to the end where it cannot break the known sequence.
 * The sort is stable, so the transform is idempotent.
 */
export function canonicalizeFragment(fragment: string, order: readonly string[]): string {
  const elements = splitTopLevelElements(fragment);
  // Nothing to reorder — return the input byte-for-byte, whitespace included.
  if (elements.length <= 1) return fragment;
  return elements
    .map((element, i) => {
      const rank = order.indexOf(elementName(element));
      return { element, i, rank: rank === -1 ? order.length : rank };
    })
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.element)
    .join("");
}

/** Sort the INNER XML of a `<w:rPr>` into `CT_RPr` order. */
export const canonicalizeRunProps = (rPrInner: string): string =>
  canonicalizeFragment(rPrInner, CT_RPR_ORDER);

/** Sort the INNER XML of a `<w:style>` into `CT_Style` order. */
export const canonicalizeStyleChildren = (styleInner: string): string =>
  canonicalizeFragment(styleInner, CT_STYLE_ORDER);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/mdocxengine && npx vitest run src/core/ooxml/canonicalOrder.spec.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add src/core/ooxml/canonicalOrder.ts src/core/ooxml/canonicalOrder.spec.ts
git commit -m "$(cat <<'EOF'
feat(ooxml): canonical CT_RPr and CT_Style child ordering

Both are xsd:sequence, so child order is a schema constraint Word enforces.
Two live bugs already trace to ignoring it. Shared primitive for every style
and run-property writer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Run-property build, merge and strip

Owns the Arabic pairing rules. Getting `w:cs` or `w:szCs` wrong here is the exact bug the feature exists to fix, so they live in one place with tests.

**Files:**
- Create: `~/mdocxengine/src/core/ooxml/runProps.ts`
- Test: `~/mdocxengine/src/core/ooxml/runProps.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `~/mdocxengine/src/core/ooxml/runProps.spec.ts`:

```ts
import { describe, test, expect } from "vitest";
import { buildRFonts, propTagsFor, stripRunPropTags, mergeRunProps } from "./runProps";

describe("buildRFonts", () => {
  test("sets ascii, hAnsi AND cs — cs is what Arabic runs actually read", () => {
    expect(buildRFonts("Simplified Arabic")).toBe(
      `<w:rFonts w:ascii="Simplified Arabic" w:hAnsi="Simplified Arabic" w:cs="Simplified Arabic"/>`,
    );
  });

  test("preserves eastAsia and theme attributes from the existing element", () => {
    const existing = `<w:rFonts w:ascii="Calibri" w:eastAsia="SimSun" w:cstheme="minorBidi"/>`;
    expect(buildRFonts("Arial", existing)).toBe(
      `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="SimSun" w:cstheme="minorBidi"/>`,
    );
  });
});

describe("propTagsFor", () => {
  test("names only the tags for the properties actually supplied", () => {
    expect(propTagsFor({ font: "Arial" })).toEqual(["rFonts"]);
    expect(propTagsFor({ sizePt: 16 })).toEqual(["sz", "szCs"]);
    expect(propTagsFor({ bold: false })).toEqual(["b", "bCs"]);
    expect(propTagsFor({ font: "Arial", sizePt: 16 })).toEqual(["rFonts", "sz", "szCs"]);
  });

  test("an absent property contributes nothing", () => {
    expect(propTagsFor({})).toEqual([]);
  });
});

describe("stripRunPropTags", () => {
  test("removes self-closing and paired forms", () => {
    expect(stripRunPropTags(`<w:rFonts w:ascii="X"/><w:b/>`, ["rFonts"])).toBe(`<w:b/>`);
    expect(stripRunPropTags(`<w:color w:val="F00"></w:color><w:b/>`, ["color"])).toBe(`<w:b/>`);
  });

  test("does not touch a tag whose name merely starts the same", () => {
    expect(stripRunPropTags(`<w:sz w:val="24"/><w:szCs w:val="24"/>`, ["sz"])).toBe(
      `<w:szCs w:val="24"/>`,
    );
  });
});

describe("mergeRunProps", () => {
  test("writes sz AND szCs for a size", () => {
    expect(mergeRunProps("", { sizePt: 16 })).toBe(`<w:sz w:val="32"/><w:szCs w:val="32"/>`);
  });

  test("writes b AND bCs for bold, and removes both when false", () => {
    expect(mergeRunProps("", { bold: true })).toBe(`<w:b/><w:bCs/>`);
    expect(mergeRunProps(`<w:b/><w:bCs/>`, { bold: false })).toBe("");
  });

  test("replaces an existing font rather than appending a second rFonts", () => {
    const out = mergeRunProps(`<w:rFonts w:ascii="Calibri" w:cs="Calibri"/>`, {
      font: "Simplified Arabic",
    });
    expect(out).toBe(
      `<w:rFonts w:ascii="Simplified Arabic" w:hAnsi="Simplified Arabic" w:cs="Simplified Arabic"/>`,
    );
  });

  test("leaves properties it was not asked about alone", () => {
    const out = mergeRunProps(`<w:rtl/><w:highlight w:val="yellow"/>`, { sizePt: 14 });
    expect(out).toContain(`<w:rtl/>`);
    expect(out).toContain(`<w:highlight w:val="yellow"/>`);
  });

  test("emits CT_RPr order regardless of input order", () => {
    expect(mergeRunProps(`<w:rtl/>`, { bold: true, font: "Arial", sizePt: 12 })).toBe(
      `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/>` +
        `<w:sz w:val="24"/><w:szCs w:val="24"/><w:rtl/>`,
    );
  });

  test("normalises a colour to uppercase hex without '#'", () => {
    expect(mergeRunProps("", { color: "#00ff00" })).toBe(`<w:color w:val="00FF00"/>`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/mdocxengine && npx vitest run src/core/ooxml/runProps.spec.ts
```

Expected: FAIL — `Failed to resolve import "./runProps"`.

- [ ] **Step 3: Write the implementation**

Create `~/mdocxengine/src/core/ooxml/runProps.ts`:

```ts
import { canonicalizeRunProps } from "./canonicalOrder";

/**
 * The run-level properties `set_text_style` can apply. Every field is optional;
 * only the ones actually supplied are ever written, stripped, or considered.
 * `undefined` means "the student did not name this" — distinct from `false`,
 * which means "remove it".
 */
export interface RunProps {
  /** Font family. Written to `w:ascii`, `w:hAnsi` AND `w:cs`. */
  font?: string;
  /** Size in POINTS. Written as half-points to BOTH `w:sz` and `w:szCs`. */
  sizePt?: number;
  /** true writes `<w:b/><w:bCs/>`; false removes both. */
  bold?: boolean;
  /** true writes `<w:i/><w:iCs/>`; false removes both. */
  italic?: boolean;
  /** Hex colour, with or without a leading '#'. */
  color?: string;
}

/**
 * Which `w:rPr` children each property owns. The complex-script twin is part of
 * the property, not an extra: a size that writes `w:sz` but not `w:szCs` leaves
 * Arabic text at its old size, which is precisely the defect this feature fixes.
 */
export const RUN_PROP_TAGS: Record<keyof RunProps, readonly string[]> = {
  font: ["rFonts"],
  sizePt: ["sz", "szCs"],
  bold: ["b", "bCs"],
  italic: ["i", "iCs"],
  color: ["color"],
};

/** Attributes of an existing `w:rFonts` that survive a font change. */
const PRESERVED_RFONTS_ATTRS = [
  "w:eastAsia", "w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme", "w:hint",
];

/**
 * Build a `<w:rFonts/>` for `font`, carrying over any east-Asian and theme
 * attributes the element being replaced happened to carry. The previous
 * implementation in FormattingManager dropped them.
 */
export function buildRFonts(font: string, existing?: string): string {
  const kept: string[] = [];
  if (existing) {
    for (const attr of PRESERVED_RFONTS_ATTRS) {
      const m = new RegExp(`\\s${attr}="([^"]*)"`).exec(existing);
      if (m) kept.push(`${attr}="${m[1]}"`);
    }
  }
  const tail = kept.length ? ` ${kept.join(" ")}` : "";
  return `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"${tail}/>`;
}

/** The `w:rPr` child tags owned by the properties present on `props`. */
export function propTagsFor(props: RunProps): string[] {
  const tags: string[] = [];
  for (const key of Object.keys(RUN_PROP_TAGS) as (keyof RunProps)[]) {
    if (props[key] !== undefined) tags.push(...RUN_PROP_TAGS[key]);
  }
  return tags;
}

/** Remove every occurrence of `tags` (self-closing or paired) from `w:rPr` inner XML. */
export function stripRunPropTags(rPrInner: string, tags: readonly string[]): string {
  let out = rPrInner;
  for (const tag of tags) {
    // `\b` would let "sz" match "szCs"; require a delimiter after the name.
    out = out.replace(new RegExp(`<w:${tag}(?=[\\s/>])[^>]*/>`, "g"), "");
    out = out.replace(new RegExp(`<w:${tag}(?=[\\s>])[^>]*>[\\s\\S]*?</w:${tag}>`, "g"), "");
  }
  return out;
}

/**
 * Merge `props` into `w:rPr` inner XML: strip the tags each named property owns,
 * append the replacements, then canonicalise into `CT_RPr` order. Properties not
 * named on `props` survive untouched — including `w:rtl`, `w:cs`, `w:highlight`
 * and `w:u`.
 */
export function mergeRunProps(rPrInner: string, props: RunProps): string {
  const existingRFonts = /<w:rFonts(?=[\s/>])[^>]*\/>/.exec(rPrInner)?.[0];
  let body = rPrInner;
  const added: string[] = [];

  if (props.font !== undefined) {
    body = stripRunPropTags(body, RUN_PROP_TAGS.font);
    added.push(buildRFonts(props.font, existingRFonts));
  }
  if (props.sizePt !== undefined) {
    body = stripRunPropTags(body, RUN_PROP_TAGS.sizePt);
    const halfPoints = Math.round(props.sizePt * 2);
    added.push(`<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`);
  }
  if (props.bold !== undefined) {
    body = stripRunPropTags(body, RUN_PROP_TAGS.bold);
    if (props.bold) added.push(`<w:b/><w:bCs/>`);
  }
  if (props.italic !== undefined) {
    body = stripRunPropTags(body, RUN_PROP_TAGS.italic);
    if (props.italic) added.push(`<w:i/><w:iCs/>`);
  }
  if (props.color !== undefined) {
    body = stripRunPropTags(body, RUN_PROP_TAGS.color);
    added.push(`<w:color w:val="${props.color.replace(/^#/, "").toUpperCase()}"/>`);
  }

  return canonicalizeRunProps(`${body}${added.join("")}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/mdocxengine && npx vitest run src/core/ooxml/runProps.spec.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add src/core/ooxml/runProps.ts src/core/ooxml/runProps.spec.ts
git commit -m "$(cat <<'EOF'
feat(ooxml): run-property build, merge and strip with cs pairing

font writes ascii+hAnsi+cs; sizePt writes sz+szCs; bold/italic write their Cs
twins. Omitting the complex-script half is what leaves Arabic text on the old
typeface. Preserves eastAsia/theme attrs the old FormattingManager dropped.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `StylesManager.ensureStyle` and `setStyleRunProps`

`Normal` and `Caption` do not exist in the seed `styles.xml`, so creating a missing style is the normal path. This task also routes the existing heading path through the canonicaliser, fixing the `<w:b/>`-before-`rFonts` bug.

**Files:**
- Modify: `~/mdocxengine/src/core/PartsManagers/StylesManager.ts`
- Test: `~/mdocxengine/src/core/PartsManagers/StylesManager.spec.ts`

- [ ] **Step 1: Write the failing test**

In `~/mdocxengine/src/core/PartsManagers/StylesManager.spec.ts`, first extend the
existing import at the top of the file — it currently reads
`import { StylesManager, applyHeadingStyleToXml } from "./StylesManager";` — to:

```ts
import {
  StylesManager,
  applyHeadingStyleToXml,
  applyStyleRunPropsToXml,
  buildParagraphStyleXml,
} from "./StylesManager";
```

Then append the fixture and the new `describe` blocks at the end of the file:

```ts
const NO_NORMAL_STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault/><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:basedOn w:val="Normal"/></w:style></w:styles>`;

describe("buildParagraphStyleXml", () => {
  test("emits CT_Style child order", () => {
    expect(buildParagraphStyleXml("Normal", "Normal", { isDefault: true })).toBe(
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`,
    );
  });

  test("emits basedOn before qFormat when given", () => {
    expect(buildParagraphStyleXml("Caption", "caption", { basedOn: "Normal" })).toBe(
      `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>`,
    );
  });
});

describe("applyStyleRunPropsToXml", () => {
  test("creates a missing style, then applies the props to it", () => {
    const { xml, created, updated } = applyStyleRunPropsToXml(
      NO_NORMAL_STYLES_XML,
      "Normal",
      { font: "Simplified Arabic", sizePt: 16 },
      { name: "Normal", isDefault: true },
    );
    expect(created).toBe(true);
    expect(updated).toBe(true);
    expect(xml).toContain(`w:styleId="Normal"`);
    expect(xml).toContain(`w:cs="Simplified Arabic"`);
    expect(xml).toContain(`<w:szCs w:val="32"/>`);
  });

  test("patches an existing style in place without duplicating it", () => {
    const { xml, created } = applyStyleRunPropsToXml(
      NO_NORMAL_STYLES_XML,
      "Heading1",
      { sizePt: 18 },
      { name: "heading 1" },
    );
    expect(created).toBe(false);
    expect(xml.match(/w:styleId="Heading1"/g)).toHaveLength(1);
    expect(xml).toContain(`<w:sz w:val="36"/><w:szCs w:val="36"/>`);
    // The pre-existing rFonts survives and still precedes the new sz.
    expect(xml).toMatch(/<w:rFonts[^>]*\/><w:sz w:val="36"\/>/);
  });

  test("reports updated:false when the style is missing and no ensure spec is given", () => {
    const { created, updated } = applyStyleRunPropsToXml(
      NO_NORMAL_STYLES_XML,
      "Caption",
      { sizePt: 12 },
    );
    expect(created).toBe(false);
    expect(updated).toBe(false);
  });
});

describe("applyHeadingStyleToXml ordering fix", () => {
  test("bold no longer lands before rFonts", () => {
    const { xml } = applyHeadingStyleToXml(NO_NORMAL_STYLES_XML, [1], { bold: true });
    expect(xml).toMatch(/<w:rPr><w:rFonts[^>]*\/><w:b\/><w:bCs\/><\/w:rPr>/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/mdocxengine && npx vitest run src/core/PartsManagers/StylesManager.spec.ts
```

Expected: FAIL — `applyStyleRunPropsToXml is not exported`, plus the heading ordering test failing with bold before rFonts.

- [ ] **Step 3: Write the implementation**

In `~/mdocxengine/src/core/PartsManagers/StylesManager.ts`, add the import at the top of the file:

```ts
import { canonicalizeRunProps } from "@/core/ooxml/canonicalOrder";
import { mergeRunProps, type RunProps } from "@/core/ooxml/runProps";
```

Replace the body of `rewriteHeadingRunProps` (currently concatenating `boldTags + body + colorTag + sizeTags`) so its final line canonicalises:

```ts
  return canonicalizeRunProps(`${boldTags}${body}${colorTag}${sizeTags}`);
```

Then add, after `applyHeadingStyleToXml`:

```ts
/** How to create a paragraph style that does not exist yet. */
export interface EnsureStyleSpec {
  /** `w:name` — Word's display name. Maps the style onto a built-in when it matches. */
  name: string;
  /** `w:basedOn` target, omitted when absent. */
  basedOn?: string;
  /** Emit `w:default="1"` — used for `Normal`. */
  isDefault?: boolean;
}

/** Build a minimal, schema-ordered paragraph `<w:style>`. */
export function buildParagraphStyleXml(
  styleId: string,
  name: string,
  opts: { basedOn?: string; isDefault?: boolean } = {},
): string {
  const defaultAttr = opts.isDefault ? ` w:default="1"` : "";
  const basedOn = opts.basedOn ? `<w:basedOn w:val="${opts.basedOn}"/>` : "";
  return (
    `<w:style w:type="paragraph"${defaultAttr} w:styleId="${styleId}">` +
    `<w:name w:val="${name}"/>${basedOn}<w:qFormat/>` +
    `</w:style>`
  );
}

/**
 * Pure transform: apply `props` to the `<w:rPr>` of the `styleId` style inside a
 * `word/styles.xml` string, creating the style first when `ensure` is supplied
 * and it does not exist. Returns the rewritten XML plus whether the style was
 * created and whether it ended up changed.
 *
 * The seed `thesis-base.docx` defines neither `Normal` nor `Caption`, so the
 * create path is the ordinary one, not an error path.
 */
export function applyStyleRunPropsToXml(
  stylesXml: string,
  styleId: string,
  props: RunProps,
  ensure?: EnsureStyleSpec,
): { xml: string; created: boolean; updated: boolean } {
  let xml = stylesXml;
  let created = false;

  const blockRe = new RegExp(`<w:style\\b[^>]*w:styleId="${styleId}"[^>]*>[\\s\\S]*?<\\/w:style>`);
  if (!blockRe.test(xml)) {
    if (!ensure) return { xml, created: false, updated: false };
    const fresh = buildParagraphStyleXml(styleId, ensure.name, {
      basedOn: ensure.basedOn,
      isDefault: ensure.isDefault,
    });
    // Append as the last child of <w:styles>, keeping the root's own closing tag.
    xml = xml.replace(/<\/w:styles>\s*$/, `${fresh}</w:styles>`);
    created = true;
  }

  const match = blockRe.exec(xml);
  if (!match) return { xml, created, updated: false };

  const block = match[0];
  const rPrMatch = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(block);
  const nextInner = mergeRunProps(rPrMatch ? rPrMatch[1] : "", props);

  let rewritten: string;
  if (rPrMatch) {
    rewritten = block.replace(rPrMatch[0], `<w:rPr>${nextInner}</w:rPr>`);
  } else if (nextInner) {
    // No <w:rPr> yet — insert one, then let the canonicaliser place it correctly.
    const inner = /^(<w:style\b[^>]*>)([\s\S]*)(<\/w:style>)$/.exec(block);
    if (!inner) return { xml, created, updated: false };
    const children = canonicalizeStyleChildren(`${inner[2]}<w:rPr>${nextInner}</w:rPr>`);
    rewritten = `${inner[1]}${children}${inner[3]}`;
  } else {
    return { xml, created, updated: false };
  }

  xml = xml.slice(0, match.index) + rewritten + xml.slice(match.index + block.length);
  return { xml, created, updated: true };
}
```

Add `canonicalizeStyleChildren` to the `canonicalOrder` import at the top of the file:

```ts
import { canonicalizeRunProps, canonicalizeStyleChildren } from "@/core/ooxml/canonicalOrder";
```

Finally add the instance method inside `class StylesManager`, after `setHeadingStyle`:

```ts
  /**
   * Ensure `styleId` exists (creating it from `ensure` when missing), then apply
   * `props` to its `<w:rPr>`. A STYLE-level change: it reaches every paragraph
   * using the style, present and future.
   */
  public async setStyleRunProps(
    styleId: string,
    props: RunProps,
    ensure?: EnsureStyleSpec,
  ): Promise<{ created: boolean; updated: boolean }> {
    const xml = this.zip.readAsText(STYLES_PATH) ?? "";
    const { xml: out, created, updated } = applyStyleRunPropsToXml(xml, styleId, props, ensure);
    if (created || updated) this.zip.addFile(STYLES_PATH, Buffer.from(out, "utf-8"));
    return { created, updated };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/mdocxengine && npx vitest run src/core/PartsManagers/StylesManager.spec.ts
```

Expected: PASS — the pre-existing tests plus 6 new ones.

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add src/core/PartsManagers/StylesManager.ts src/core/PartsManagers/StylesManager.spec.ts
git commit -m "$(cat <<'EOF'
feat(styles): ensure-then-patch a paragraph style's run properties

The seed thesis defines neither Normal nor Caption, so creating a missing
style is the ordinary path. Also routes rewriteHeadingRunProps through the
canonicaliser, fixing bold landing before rFonts on imported templates.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `TextStyleManager` — targets, strip, fallback, report

The heart of the feature. A target is a paragraph predicate bound to a style; the write is patch → strip → direct-write fallback.

**Files:**
- Create: `~/mdocxengine/src/core/PartsManagers/TextStyleManager.ts`
- Test: `~/mdocxengine/src/core/PartsManagers/TextStyleManager.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `~/mdocxengine/src/core/PartsManagers/TextStyleManager.spec.ts`:

```ts
import { describe, test, expect } from "vitest";
import {
  TARGET_SPECS,
  expandTargets,
  matchesTarget,
  applyPropsToRuns,
  stripPropsFromRuns,
} from "./TextStyleManager";
import type { BlockInfo } from "@/Doc";

const para = (over: Partial<BlockInfo> = {}): BlockInfo => ({
  index: 0,
  kind: "paragraph",
  text: "نص",
  styleId: null,
  headingLevel: 0,
  ...over,
});

describe("expandTargets", () => {
  test("expands 'headings' to all six levels", () => {
    expect(expandTargets(["headings"])).toEqual([
      "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
    ]);
  });

  test("de-duplicates overlapping requests", () => {
    expect(expandTargets(["headings", "heading1"])).toHaveLength(6);
  });

  test("throws on an unknown target rather than silently ignoring it", () => {
    expect(() => expandTargets(["bodytext"])).toThrow(/unknown target 'bodytext'/i);
  });
});

describe("matchesTarget", () => {
  test("body takes an unstyled paragraph", () => {
    expect(matchesTarget("body", para(), "<w:p/>")).toBe(true);
  });

  test("body rejects headings, captions, lists and titles", () => {
    expect(matchesTarget("body", para({ headingLevel: 2, styleId: "Heading2" }), "<w:p/>")).toBe(false);
    expect(matchesTarget("body", para({ styleId: "Caption" }), "<w:p/>")).toBe(false);
    expect(matchesTarget("body", para({ styleId: "ListParagraph" }), "<w:p/>")).toBe(false);
    expect(matchesTarget("body", para({ styleId: "Title" }), "<w:p/>")).toBe(false);
  });

  test("heading3 takes only level 3", () => {
    expect(matchesTarget("heading3", para({ headingLevel: 3 }), "<w:p/>")).toBe(true);
    expect(matchesTarget("heading3", para({ headingLevel: 2 }), "<w:p/>")).toBe(false);
  });

  test("lists takes a numPr paragraph even without the ListParagraph style", () => {
    expect(matchesTarget("lists", para(), `<w:p><w:pPr><w:numPr/></w:pPr></w:p>`)).toBe(true);
  });

  test("tables takes table blocks and nothing else", () => {
    expect(matchesTarget("tables", para({ kind: "table" }), "<w:tbl/>")).toBe(true);
    expect(matchesTarget("tables", para(), "<w:p/>")).toBe(false);
  });
});

describe("TARGET_SPECS", () => {
  test("body and tables share the Normal style, both ensured", () => {
    expect(TARGET_SPECS.body.styleIds).toEqual(["Normal"]);
    expect(TARGET_SPECS.tables.styleIds).toEqual(["Normal"]);
    expect(TARGET_SPECS.body.ensure?.isDefault).toBe(true);
  });

  test("captions ensures a Caption style based on Normal", () => {
    expect(TARGET_SPECS.captions.ensure).toEqual({ name: "caption", basedOn: "Normal" });
  });
});

describe("stripPropsFromRuns", () => {
  test("removes only the named property, leaving rtl and highlight intact", () => {
    const xml =
      `<w:p><w:r><w:rPr><w:rFonts w:cs="Traditional Arabic"/><w:sz w:val="28"/>` +
      `<w:rtl/><w:highlight w:val="yellow"/></w:rPr><w:t>نص</w:t></w:r></w:p>`;
    const { xml: out, stripped } = stripPropsFromRuns(xml, { font: "X" });
    expect(stripped).toBe(1);
    expect(out).not.toContain("Traditional Arabic");
    expect(out).toContain(`<w:sz w:val="28"/>`);
    expect(out).toContain(`<w:rtl/>`);
    expect(out).toContain(`<w:highlight w:val="yellow"/>`);
  });

  test("removes an emptied rPr entirely", () => {
    const xml = `<w:p><w:r><w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>x</w:t></w:r></w:p>`;
    const { xml: out } = stripPropsFromRuns(xml, { sizePt: 16 });
    expect(out).toBe(`<w:p><w:r><w:t>x</w:t></w:r></w:p>`);
  });

  test("ignores rPr inside pPr — paragraph mark properties are not runs", () => {
    const xml = `<w:p><w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`;
    const { xml: out, stripped } = stripPropsFromRuns(xml, { sizePt: 16 });
    expect(stripped).toBe(0);
    expect(out).toBe(xml);
  });

  test("counts nothing and changes nothing when no run carries the property", () => {
    const xml = `<w:p><w:r><w:t>x</w:t></w:r></w:p>`;
    expect(stripPropsFromRuns(xml, { font: "X" })).toEqual({ xml, stripped: 0 });
  });
});

describe("applyPropsToRuns", () => {
  test("writes the property onto every run, creating rPr where absent", () => {
    const xml = `<w:p><w:r><w:t>x</w:t></w:r><w:r><w:rPr><w:rtl/></w:rPr><w:t>y</w:t></w:r></w:p>`;
    const { xml: out, written } = applyPropsToRuns(xml, { sizePt: 16 });
    expect(written).toBe(2);
    expect(out).toBe(
      `<w:p><w:r><w:rPr><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr><w:t>x</w:t></w:r>` +
        `<w:r><w:rPr><w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr><w:t>y</w:t></w:r></w:p>`,
    );
  });

  test("does not touch runs inside pPr", () => {
    const xml = `<w:p><w:pPr><w:rPr><w:rtl/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`;
    const { written } = applyPropsToRuns(xml, { bold: true });
    expect(written).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/mdocxengine && npx vitest run src/core/PartsManagers/TextStyleManager.spec.ts
```

Expected: FAIL — `Failed to resolve import "./TextStyleManager"`.

- [ ] **Step 3: Write the implementation**

Create `~/mdocxengine/src/core/PartsManagers/TextStyleManager.ts`:

```ts
import type AdmZip from "adm-zip";
import type { BlockInfo } from "@/Doc";
import { DocumentManager } from "@/core/PartsManagers/DocumentManager";
import { StylesManager, type EnsureStyleSpec } from "@/core/PartsManagers/StylesManager";
import { mergeRunProps, propTagsFor, stripRunPropTags, type RunProps } from "@/core/ooxml/runProps";

const FOOTNOTES_PATH = "word/footnotes.xml";

/** A named part of the document a student can restyle. */
export type TextStyleTarget =
  | "body" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6"
  | "title" | "captions" | "lists" | "tables" | "footnotes";

/** What the model may pass; `headings` is sugar for heading1–6. */
export type TextStyleTargetInput = TextStyleTarget | "headings";

/** Styles `body` must NOT claim — each has a target of its own. */
const NON_BODY_STYLES = new Set(["Caption", "ListParagraph", "Title", "Header", "Footer"]);

export interface TargetSpec {
  /** Style ids this target owns. A paragraph resolving to one of them is covered by the style patch. */
  styleIds: string[];
  /** How to create the style when `styles.xml` lacks it. Absent → never created. */
  ensure?: EnsureStyleSpec;
  /** Which part the target lives in. */
  part: "body" | "footnotes";
}

export const TARGET_SPECS: Record<TextStyleTarget, TargetSpec> = {
  body: { styleIds: ["Normal"], ensure: { name: "Normal", isDefault: true }, part: "body" },
  heading1: { styleIds: ["Heading1"], part: "body" },
  heading2: { styleIds: ["Heading2"], part: "body" },
  heading3: { styleIds: ["Heading3"], part: "body" },
  heading4: { styleIds: ["Heading4"], part: "body" },
  heading5: { styleIds: ["Heading5"], part: "body" },
  heading6: { styleIds: ["Heading6"], part: "body" },
  title: { styleIds: ["Title"], part: "body" },
  captions: { styleIds: ["Caption"], ensure: { name: "caption", basedOn: "Normal" }, part: "body" },
  lists: { styleIds: ["ListParagraph"], part: "body" },
  // Cell paragraphs normally carry no pStyle, so they resolve to Normal — the
  // same style `body` owns. The two targets differ by PREDICATE, not by style:
  // picking `body` alone leaves table-cell run overrides in place.
  tables: { styleIds: ["Normal"], ensure: { name: "Normal", isDefault: true }, part: "body" },
  footnotes: { styleIds: ["FootnoteText"], part: "footnotes" },
};

const ALL_TARGETS = Object.keys(TARGET_SPECS) as TextStyleTarget[];
const HEADING_TARGETS: TextStyleTarget[] = [
  "heading1", "heading2", "heading3", "heading4", "heading5", "heading6",
];

/** Expand `headings` and de-duplicate. Throws on an unknown name. */
export function expandTargets(targets: readonly string[]): TextStyleTarget[] {
  const out = new Set<TextStyleTarget>();
  for (const t of targets) {
    if (t === "headings") {
      HEADING_TARGETS.forEach((h) => out.add(h));
      continue;
    }
    if (!ALL_TARGETS.includes(t as TextStyleTarget)) {
      throw new Error(
        `unknown target '${t}'. Valid targets: ${["headings", ...ALL_TARGETS].join(", ")}`,
      );
    }
    out.add(t as TextStyleTarget);
  }
  return [...out];
}

/** Does this block belong to `target`? */
export function matchesTarget(target: TextStyleTarget, block: BlockInfo, xml: string): boolean {
  switch (target) {
    case "body":
      return (
        block.kind === "paragraph" &&
        block.headingLevel === 0 &&
        !NON_BODY_STYLES.has(block.styleId ?? "") &&
        !/<w:numPr\b/.test(xml)
      );
    case "title":
      return block.styleId === "Title";
    case "captions":
      return block.styleId === "Caption";
    case "lists":
      return block.styleId === "ListParagraph" || /<w:numPr\b/.test(xml);
    case "tables":
      return block.kind === "table";
    case "footnotes":
      return false; // handled against the footnotes part, not body blocks
    default:
      return block.headingLevel === Number(target.slice("heading".length));
  }
}

/** Matches a `<w:r>…</w:r>` run. `w:rPr` inside `w:pPr` is not a run and is skipped. */
const RUN_RE = /<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g;

/**
 * Remove the properties named on `props` from every RUN in `xml`. An `rPr` left
 * empty is removed outright rather than left as `<w:rPr></w:rPr>`.
 * Returns the count of runs actually changed.
 */
export function stripPropsFromRuns(xml: string, props: RunProps): { xml: string; stripped: number } {
  const tags = propTagsFor(props);
  if (!tags.length) return { xml, stripped: 0 };
  let stripped = 0;
  const out = xml.replace(RUN_RE, (run) => {
    const rPrMatch = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run);
    if (!rPrMatch) return run;
    const next = stripRunPropTags(rPrMatch[1], tags);
    if (next === rPrMatch[1]) return run;
    stripped++;
    return run.replace(rPrMatch[0], next.trim() ? `<w:rPr>${next}</w:rPr>` : "");
  });
  return { xml: out, stripped };
}

/**
 * Write `props` onto every RUN in `xml`, creating an `<w:rPr>` where absent.
 * The fallback for paragraphs that would not resolve to the target's style —
 * without it, stripping would drop them to the WRONG style.
 * Returns the count of runs written.
 */
export function applyPropsToRuns(xml: string, props: RunProps): { xml: string; written: number } {
  let written = 0;
  const out = xml.replace(RUN_RE, (run) => {
    const rPrMatch = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run);
    const nextInner = mergeRunProps(rPrMatch ? rPrMatch[1] : "", props);
    written++;
    if (rPrMatch) return run.replace(rPrMatch[0], `<w:rPr>${nextInner}</w:rPr>`);
    // No rPr — insert one immediately after the run's own start tag.
    return run.replace(/^(<w:r(?=[\s>])[^>]*>)/, `$1<w:rPr>${nextInner}</w:rPr>`);
  });
  return { xml: out, written };
}

/** What one target's write actually did. */
export interface TargetReport {
  target: TextStyleTarget;
  styleId: string;
  styleCreated: boolean;
  styleTouched: boolean;
  runsStripped: number;
  directWrites: number;
  paragraphsAffected: number;
}

/** Reads the paragraph style id off a raw `<w:p>` — null when absent. */
function pStyleOf(xml: string): string | null {
  return /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(xml)?.[1] ?? null;
}

/**
 * Apply `props` to each of `targets`.
 *
 * Per target, per property: patch the style, strip that property from the
 * target's runs so the style shows through, and direct-write the runs of any
 * paragraph that would not have resolved to the target's style anyway.
 */
export class TextStyleManager {
  private doc: DocumentManager;
  private styles: StylesManager;

  constructor(private zip: AdmZip) {
    this.doc = new DocumentManager(zip);
    this.styles = new StylesManager(zip);
  }

  async apply(
    targets: readonly TextStyleTarget[],
    props: RunProps,
    blockInfos: BlockInfo[],
  ): Promise<TargetReport[]> {
    const reports: TargetReport[] = [];
    const bodyTargets = targets.filter((t) => TARGET_SPECS[t].part === "body");
    const wantsFootnotes = targets.includes("footnotes");

    if (bodyTargets.length) {
      const blocks = await this.doc.getBlocks();
      // One report row per target; one saveBlocks for all of them.
      for (const target of bodyTargets) {
        const spec = TARGET_SPECS[target];
        const { created, updated } = await this.styles.setStyleRunProps(
          spec.styleIds[0],
          props,
          spec.ensure,
        );

        let runsStripped = 0;
        let directWrites = 0;
        let paragraphsAffected = 0;

        for (let i = 0; i < blocks.length; i++) {
          const info = blockInfos[i];
          if (!info || !matchesTarget(target, info, blocks[i].xml)) continue;
          paragraphsAffected++;

          const style = pStyleOf(blocks[i].xml);
          const coveredByStyle =
            style === null ? spec.styleIds.includes("Normal") : spec.styleIds.includes(style);

          if (coveredByStyle) {
            const res = stripPropsFromRuns(blocks[i].xml, props);
            blocks[i] = { ...blocks[i], xml: res.xml };
            runsStripped += res.stripped;
          } else {
            const res = applyPropsToRuns(blocks[i].xml, props);
            blocks[i] = { ...blocks[i], xml: res.xml };
            directWrites += res.written;
          }
        }

        reports.push({
          target,
          styleId: spec.styleIds[0],
          styleCreated: created,
          styleTouched: updated,
          runsStripped,
          directWrites,
          paragraphsAffected,
        });
      }
      await this.doc.saveBlocks(blocks);
    }

    if (wantsFootnotes) {
      const spec = TARGET_SPECS.footnotes;
      const { created, updated } = await this.styles.setStyleRunProps(
        spec.styleIds[0],
        props,
        spec.ensure,
      );
      const xml = this.zip.readAsText(FOOTNOTES_PATH) ?? "";
      const res = stripPropsFromRuns(xml, props);
      if (xml && res.xml !== xml) {
        this.zip.addFile(FOOTNOTES_PATH, Buffer.from(res.xml, "utf-8"));
      }
      reports.push({
        target: "footnotes",
        styleId: spec.styleIds[0],
        styleCreated: created,
        styleTouched: updated,
        runsStripped: res.stripped,
        directWrites: 0,
        paragraphsAffected: xml ? (xml.match(/<w:footnote\b/g)?.length ?? 0) : 0,
      });
    }

    return reports;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/mdocxengine && npx vitest run src/core/PartsManagers/TextStyleManager.spec.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add src/core/PartsManagers/TextStyleManager.ts src/core/PartsManagers/TextStyleManager.spec.ts
git commit -m "$(cat <<'EOF'
feat(styles): TextStyleManager — targets, surgical strip, direct-write fallback

A target is a paragraph predicate bound to a Word style. Patch the style, strip
only the named property from that target's runs so the style shows through, and
direct-write paragraphs that would not have resolved to the target's style.
Reports per target so a no-op can never be reported as success.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `Doc.setTextStyle` and public exports

**Files:**
- Modify: `~/mdocxengine/src/Doc.ts`
- Modify: `~/mdocxengine/src/index.ts`
- Test: `~/mdocxengine/src/Doc.textStyle.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `~/mdocxengine/src/Doc.textStyle.spec.ts`:

```ts
import { describe, test, expect } from "vitest";
import AdmZip from "adm-zip";
import { Doc } from "./Doc";
import { Mdocxengine } from "./index";

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:cs="Traditional Arabic"/><w:rtl/></w:rPr><w:t>متن</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>عنوان</w:t></w:r></w:p></w:body></w:document>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;

// Mdocxengine's constructor is private; loadFromBuffer is the factory. Doc.spec.ts
// opens a real sample .docx, but these assertions need a controlled two-paragraph
// document, so build the zip in memory instead.
async function makeDoc(): Promise<Doc> {
  const zip = new AdmZip();
  zip.addFile("word/document.xml", Buffer.from(DOCUMENT_XML, "utf-8"));
  zip.addFile("word/styles.xml", Buffer.from(STYLES_XML, "utf-8"));
  return Doc.from(await Mdocxengine.loadFromBuffer(zip.toBuffer()));
}

describe("Doc.setTextStyle", () => {
  test("creates Normal, patches it, and strips the body run's competing font", async () => {
    const doc = await makeDoc();
    const reports = await doc.setTextStyle(["body"], { font: "Simplified Arabic" });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      target: "body",
      styleId: "Normal",
      styleCreated: true,
      styleTouched: true,
      runsStripped: 1,
      directWrites: 0,
      paragraphsAffected: 1,
    });

    const styles = doc.engine.zip.readAsText("word/styles.xml") ?? "";
    expect(styles).toContain(`w:styleId="Normal"`);
    expect(styles).toContain(`w:cs="Simplified Arabic"`);

    const body = doc.engine.zip.readAsText("word/document.xml") ?? "";
    expect(body).not.toContain("Traditional Arabic");
    // The property we did NOT name survives.
    expect(body).toContain(`<w:rtl/>`);
  });

  test("headings target patches Heading1 and leaves the body paragraph alone", async () => {
    const doc = await makeDoc();
    const reports = await doc.setTextStyle(["headings"], { sizePt: 18, bold: true });

    const h1 = reports.find((r) => r.target === "heading1");
    expect(h1?.paragraphsAffected).toBe(1);
    expect(reports.find((r) => r.target === "heading4")?.paragraphsAffected).toBe(0);

    const styles = doc.engine.zip.readAsText("word/styles.xml") ?? "";
    expect(styles).toMatch(/w:styleId="Heading1"[\s\S]*<w:sz w:val="36"\/>/);
  });

  test("rejects an unknown target", async () => {
    const doc = await makeDoc();
    await expect(doc.setTextStyle(["footer" as never], { bold: true })).rejects.toThrow(
      /unknown target 'footer'/i,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/mdocxengine && npx vitest run src/Doc.textStyle.spec.ts
```

Expected: FAIL — `doc.setTextStyle is not a function`.

- [ ] **Step 3: Write the implementation**

In `~/mdocxengine/src/Doc.ts`, add to the imports:

```ts
import {
  TextStyleManager,
  expandTargets,
  type TextStyleTargetInput,
  type TargetReport,
} from "@/core/PartsManagers/TextStyleManager";
import type { RunProps } from "@/core/ooxml/runProps";
```

Add the method to `class Doc`, immediately after `setHeadingLevel`:

```ts
  /**
   * Apply run-level formatting to one or more named PARTS of the document —
   * `body`, `headings` (or `heading1`…`heading6`), `title`, `captions`, `lists`,
   * `tables`, `footnotes`.
   *
   * Style-level with a strip: each target's Word style is ensured and patched,
   * then the named property is removed from that target's runs so the style
   * shows through (imported theses carry formatting on the RUNS, which would
   * otherwise win). Paragraphs that would not resolve to the target's style get
   * a direct write instead. Properties that were not named are never touched.
   *
   * Returns one report per target, so a caller can tell a no-op from a change.
   */
  async setTextStyle(
    targets: readonly TextStyleTargetInput[],
    props: RunProps,
  ): Promise<TargetReport[]> {
    const expanded = expandTargets(targets as readonly string[]);
    const infos = await this.blocks();
    return new TextStyleManager(this.engine.zip).apply(expanded, props, infos);
  }
```

In `~/mdocxengine/src/index.ts`, add the public exports alongside the other `PartsManagers` re-exports:

```ts
export {
  TextStyleManager,
  TARGET_SPECS,
  expandTargets,
  type TextStyleTarget,
  type TextStyleTargetInput,
  type TargetReport,
} from "@/core/PartsManagers/TextStyleManager";
export { type RunProps } from "@/core/ooxml/runProps";
export {
  applyStyleRunPropsToXml,
  buildParagraphStyleXml,
  type EnsureStyleSpec,
} from "@/core/PartsManagers/StylesManager";
```

- [ ] **Step 4: Run the tests and build**

```bash
cd ~/mdocxengine && npx vitest run && npm run build
```

Expected: all specs PASS; `npm run build` emits `dist/` with no TypeScript errors. The `file:../mdocxengine` dependency means the server picks the new `dist/` up without a reinstall.

- [ ] **Step 5: Commit**

```bash
cd ~/mdocxengine
git add src/Doc.ts src/index.ts src/Doc.textStyle.spec.ts
git commit -m "$(cat <<'EOF'
feat(doc): Doc.setTextStyle(targets, props)

Public entry point for the target-scoped restyle, plus index exports so the
server can type against TextStyleTarget/RunProps/TargetReport.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The `set_text_style` MCP tool

**Files:**
- Create: `~/modakerati-server/src/mcp/tools/docx-styles.ts`
- Modify: `~/modakerati-server/src/mcp/tools/docx-blocks.ts:76-117` (delete `set_heading_style`)
- Modify: `~/modakerati-server/src/mcp/doc-tools.ts`

- [ ] **Step 1: Create the tool file**

Create `~/modakerati-server/src/mcp/tools/docx-styles.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireLiveThesis, withThesisDoc, asText } from "./_docx";

// ─────────────────────────────────────────────────────────────────────────────
// Document-wide TEXT STYLING, scoped to named parts of the document. Supersedes
// set_heading_style, which only reached Heading1–6 and only size/bold/colour.
//
// The write is style-level with a strip: the target's Word style is ensured and
// patched, then the named property is removed from that target's runs so the
// style shows through. Imported theses carry formatting on the RUNS, and direct
// run formatting beats a style — a style patch alone is invisible on them.
// ─────────────────────────────────────────────────────────────────────────────
export function registerDocxStyleTools(server: McpServer): void {
  server.tool(
    "set_text_style",
    "Live Word document only. Set the FONT / SIZE / BOLD / ITALIC / COLOR for one or more named PARTS of the document — this is the tool for 'make the body text Simplified Arabic 16', 'put the headings in Arial 18 bold', 'make the table text smaller'. " +
      "`targets` names the parts: 'body' (main text paragraphs), 'headings' (all six levels) or 'heading1'…'heading6', 'title', 'captions', 'lists', 'tables' (text inside table cells), 'footnotes'. Pass SEVERAL targets to change them all in one pass. " +
      "This is a Word STYLE change, so it also applies to text added later. " +
      "IMPORTANT — if the student named the parts ('apply Simplified Arabic 16 to the body text'), just do it. If they did NOT ('make the font Simplified Arabic 16'), call ask_user FIRST to find out which parts they mean, offering the part names as options; do not guess. " +
      "Provide at least one of font/sizePt/bold/italic/color. Properties you do not pass are left untouched. Does NOT change alignment or direction (use format_paragraphs), page margins (set_page_layout), or table borders/widths/shading.",
    {
      userId: z.string().describe("The user's UUID (supplied by the system)"),
      thesisId: z.string().describe("The thesis UUID"),
      targets: z
        .array(z.string())
        .min(1)
        .describe(
          "Parts to restyle: body | headings | heading1..heading6 | title | captions | lists | tables | footnotes",
        ),
      font: z.string().optional().describe("Font family, e.g. 'Simplified Arabic'. Applied to Latin AND Arabic (complex-script) text."),
      sizePt: z.number().positive().optional().describe("Font size in points, e.g. 16"),
      bold: z.boolean().optional().describe("true makes it bold; false removes bold"),
      italic: z.boolean().optional().describe("true makes it italic; false removes italic"),
      color: z.string().optional().describe("6-digit hex colour, with or without '#', e.g. '000000'"),
    },
    async ({ userId, thesisId, targets, font, sizePt, bold, italic, color }) => {
      const guard = await requireLiveThesis(thesisId, userId);
      if (guard.ok === false) return guard.reply;

      if (font === undefined && sizePt === undefined && bold === undefined && italic === undefined && color === undefined) {
        return asText({ ok: false, error: "Provide at least one of font, sizePt, bold, italic or color — nothing to change." });
      }
      if (color !== undefined && !/^#?[0-9a-fA-F]{6}$/.test(color)) {
        return asText({ ok: false, error: `color must be a 6-digit hex value (e.g. '000000'), got '${color}'.` });
      }

      return withThesisDoc(guard.thesis, async (doc) => {
        let results;
        try {
          results = await doc.setTextStyle(targets, { font, sizePt, bold, italic, color });
        } catch (e: any) {
          return { ok: false, error: String(e?.message ?? e) };
        }

        // A tool that says "done" over an unchanged document is the exact defect
        // this replaces — so an all-zero result is a failure, not a success.
        const touched = results.some(
          (r) => r.styleCreated || r.styleTouched || r.runsStripped > 0 || r.directWrites > 0,
        );
        if (!touched) {
          return {
            ok: false,
            error: `Nothing changed. None of the requested parts (${targets.join(", ")}) exist in this document, or they already have this formatting.`,
            results,
          };
        }
        return { ok: true, results };
      });
    },
  );
}
```

- [ ] **Step 2: Delete `set_heading_style`**

In `~/modakerati-server/src/mcp/tools/docx-blocks.ts`, delete the whole `server.tool("set_heading_style", …)` registration — the block that currently spans lines 76–117, from the `// ── set_heading_style …` comment through its closing `);`. Then remove any import left unused by that deletion (check `HeadingRunFormatting` and any `styles`-only helper).

- [ ] **Step 3: Wire it into the registry**

In `~/modakerati-server/src/mcp/doc-tools.ts`, add the import and the call:

```ts
import { registerDocxStyleTools } from "./tools/docx-styles";
```

```ts
  registerDocxBlockTools(server);
  registerDocxStyleTools(server);   // document-wide text styling by part (./tools/docx-styles)
  registerDocxTableTools(server);
```

- [ ] **Step 4: Typecheck**

```bash
cd ~/modakerati-server && npx tsc --noEmit
```

Expected: no errors. A `Property 'setTextStyle' does not exist on type 'Doc'` here means task 5's `npm run build` was not run in `~/mdocxengine`.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/mcp/tools/docx-styles.ts src/mcp/tools/docx-blocks.ts src/mcp/doc-tools.ts
git commit -m "$(cat <<'EOF'
feat(ai): set_text_style — restyle any named part of the document

Replaces set_heading_style, which reached only Heading1-6 and only
size/bold/colour. Body text, captions, lists, table text and footnotes had no
font tool at all, which is why the assistant correctly told a student it could
not apply Simplified Arabic 16.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Tool visibility and the load-on-demand group

Live-docx turns only expose a small core; everything else arrives through `load_tools`. A tool missing from `LIVE_DOCX_TOOLS` is invisible in exactly the mode that matters.

**Files:**
- Modify: `~/modakerati-server/src/lib/ai/mcp-bridge.ts:17-78` and `:274-282`
- Modify: `~/modakerati-server/src/lib/ai/types.ts`

- [ ] **Step 1: Update the visibility set**

In `~/modakerati-server/src/lib/ai/mcp-bridge.ts`, inside `LIVE_DOCX_TOOLS`, replace the line `"set_heading_style",` with:

```ts
  "set_text_style",
```

- [ ] **Step 2: Update the advanced-formatting group**

In the same file, in the `TOOL_GROUPS` entry labelled `"advanced formatting"`, replace `"set_heading_style"` with `"set_text_style"` in the `tools` array. The group's keywords already cover `font`/`police`/`خط`, `style`/`نمط`, `format`/`تنسيق` in all three languages — no keyword change is needed. Confirm by reading the array after editing:

```ts
    tools: ["set_heading", "set_text_style", "set_paragraph_format", "format_paragraphs",
      "replace_text", "make_thesis_ready", "apply_formatting", "analyze_structure",
      "analyze_thesis"],
```

- [ ] **Step 3: Describe it in the system prompt**

In `~/modakerati-server/src/lib/ai/types.ts`, find the existing `set_heading_style` line in the tool-description block and replace it with:

```
- set_text_style — set the FONT, SIZE, BOLD, ITALIC or COLOR of named parts of the document (body, headings, title, captions, lists, tables, footnotes). This is the ONLY way to change the body font or size. If the student did not say WHICH parts, ask_user first with the part names as options.
```

- [ ] **Step 4: Run the server test suite**

```bash
cd ~/modakerati-server && npx vitest run
```

Expected: the tool-registry test FAILS with `set_heading_style` still expected — task 10 fixes it. Every other suite passes.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/ai/mcp-bridge.ts src/lib/ai/types.ts
git commit -m "$(cat <<'EOF'
feat(ai): surface set_text_style in live mode and the formatting group

Without LIVE_DOCX_TOOLS the tool is invisible in the only mode that matters,
and without the TOOL_GROUPS entry load_tools can never unlock it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Confirm gate

A whole-document restyle is hard to eyeball and lossy. `make_thesis_ready` — a less lossy whole-doc pass — is already gated.

**Files:**
- Modify: `~/modakerati-server/src/lib/ai/destructive-gate.ts`
- Test: `~/modakerati-server/src/lib/ai/__tests__/destructive-gate.test.ts` (path per the existing suite — confirm with `ls src/lib/ai/__tests__`)

- [ ] **Step 1: Write the failing test**

Add to the existing destructive-gate test file:

```ts
test("set_text_style is gated", () => {
  expect(gateDecision("set_text_style", { hasHeader: false, hasFooter: false })).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd ~/modakerati-server && npx vitest run src/lib/ai/__tests__/destructive-gate.test.ts
```

Expected: FAIL — received `false`.

- [ ] **Step 3: Add it to the set**

In `~/modakerati-server/src/lib/ai/destructive-gate.ts`, add to `DESTRUCTIVE_DOCX_TOOLS`, after `"make_thesis_ready",`:

```ts
  "set_text_style",
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd ~/modakerati-server && npx vitest run src/lib/ai/__tests__/destructive-gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Give it a preview line**

`buildActionPreview` lives in `~/modakerati-server/src/lib/ai/destructive-gate.ts` (the PURE half, not `-io.ts`), and dispatches with `if (toolName === "…") { … return { kind, data, text }; }` blocks rather than a `switch`. Add a matching block alongside the others — it needs no `docCtx`, since every value comes from `args`:

```ts
  if (toolName === "set_text_style") {
    const targets = Array.isArray(args.targets) ? (args.targets as string[]) : [];
    const parts: string[] = [];
    if (typeof args.font === "string") parts.push(args.font);
    if (typeof args.sizePt === "number") parts.push(`${args.sizePt}pt`);
    if (args.bold === true) parts.push("bold");
    if (args.italic === true) parts.push("italic");
    if (typeof args.color === "string") parts.push(`#${args.color.replace(/^#/, "").toUpperCase()}`);
    const change = parts.join(" ");
    return {
      kind: toolName,
      data: { targets, change },
      text: targets.length
        ? `Restyle ${targets.join(" + ")} → ${change}`
        : `Restyle → ${change}`,
    };
  }
```

The app maps `kind` to a localised template, so `data` carries the parts and the change separately; `text` is the English fallback and what the model's bubble shows.

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati-server
git add src/lib/ai/destructive-gate.ts src/lib/ai/destructive-gate-io.ts src/lib/ai/__tests__/destructive-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(ai): gate set_text_style behind student approval

A wrong font across a 200-page thesis is what the gate exists for. Preview
names the targets and the change so the sheet reads as a summary.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Rebuild `apply_formatting` on the new primitive

`FormattingManager.applyFont`/`applyFontSize` only rewrite existing `<w:rFonts>`/`<w:sz>` and never insert, so against the seed thesis a university norm profile reports success while changing nothing. Now that a working path exists, route font and size through it.

**Files:**
- Modify: `~/mdocxengine/src/core/PartsManagers/FormattingManager.ts`
- Modify: `~/mdocxengine/src/core/PartsManagers/FormattingManager.spec.ts`
- Modify: `~/modakerati-server/src/mcp/tools/analysis.ts:99-142`

- [ ] **Step 1: Write the failing test**

Add to `~/mdocxengine/src/core/PartsManagers/FormattingManager.spec.ts`:

```ts
test("applyFont INSERTS on a document with no rFonts — the norm-profile no-op bug", () => {
  const xml = `<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`;
  const { xml: out, result } = FormattingManager.applyToXml(xml, { font: "Simplified Arabic" });
  expect(result.applied).toContain("font");
  expect(out).toContain(`w:cs="Simplified Arabic"`);
});

test("applyFontSize INSERTS sz and szCs where absent", () => {
  const xml = `<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`;
  const { xml: out } = FormattingManager.applyToXml(xml, { fontSizePt: 16 });
  expect(out).toContain(`<w:sz w:val="32"/>`);
  expect(out).toContain(`<w:szCs w:val="32"/>`);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd ~/mdocxengine && npx vitest run src/core/PartsManagers/FormattingManager.spec.ts
```

Expected: FAIL — the output contains no `w:cs` and no `w:sz`, because the regexes matched nothing.

- [ ] **Step 3: Route font and size through `applyPropsToRuns`**

In `~/mdocxengine/src/core/PartsManagers/FormattingManager.ts`, add the import:

```ts
import { applyPropsToRuns } from "@/core/PartsManagers/TextStyleManager";
```

Replace the `applyFont` and `applyFontSize` functions with:

```ts
function applyFont(xml: string, font: string): string {
  return applyPropsToRuns(xml, { font }).xml;
}

function applyFontSize(xml: string, fontSizePt: number): string {
  return applyPropsToRuns(xml, { sizePt: fontSizePt }).xml;
}
```

`applySpacing` and `applyMargins` are unchanged — they operate on `w:spacing` and `w:pgMar`, which the seed does have.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd ~/mdocxengine && npx vitest run src/core/PartsManagers/FormattingManager.spec.ts && npm run build
```

Expected: PASS, including the file's pre-existing tests.

- [ ] **Step 5: Give `apply_formatting` an honest description**

In `~/modakerati-server/src/mcp/tools/analysis.ts`, replace the description string on the `apply_formatting` registration (currently `"Apply the thesis's norm profile formatting deterministically. Stage 4 of the pipeline."`) with:

```ts
    "Apply the thesis's assigned UNIVERSITY NORM PROFILE in one pass — its required font, font size, line spacing and page margins, all at once. Use this only when the student asks to comply with their university's norms and a norm profile is assigned. To change the font or size of specific parts of the document, use set_text_style instead.",
```

- [ ] **Step 6: Commit**

```bash
cd ~/mdocxengine
git add src/core/PartsManagers/FormattingManager.ts src/core/PartsManagers/FormattingManager.spec.ts
git commit -m "$(cat <<'EOF'
fix(formatting): norm profiles no longer report success while changing nothing

applyFont/applyFontSize only rewrote existing rFonts/sz and never inserted, so
against the seed thesis (0 rFonts, 0 sz across 41 paragraphs) they matched
nothing, threw nothing, and still reported applied. Route both through
applyPropsToRuns, which inserts and writes the cs twins.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"

cd ~/modakerati-server
git add src/mcp/tools/analysis.ts
git commit -m "$(cat <<'EOF'
docs(ai): describe apply_formatting in terms a model can act on

"Stage 4 of the pipeline" told the model nothing about fonts, which is why it
never reached for this tool when asked about one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Registry test, OOXML validation, device QA

**Files:**
- Modify: `~/modakerati-server/src/mcp/__tests__/tool-registry.test.ts:23`

- [ ] **Step 1: Fix the registry expectation**

In `~/modakerati-server/src/mcp/__tests__/tool-registry.test.ts`, the sorted tool-name list contains `set_heading_style`. Remove it and insert `set_text_style` in sorted position.

- [ ] **Step 2: Run the full server suite**

```bash
cd ~/modakerati-server && npx vitest run
```

Expected: all suites PASS.

- [ ] **Step 3: Validate the OOXML output**

Restart the server, create or open a test thesis, and run `set_text_style` against it via chat. Then:

```bash
cd ~/modakerati-server && ./scripts/ooxml-validate/run.sh <path-to-the-edited.docx>
```

Expected: no NEW findings beyond the script's maintained noise list. If Word later refuses a file, this script runs FIRST — before any guessing.

- [ ] **Step 4: Device QA — the actual acceptance test**

Take the thesis from the original screenshot. In Arabic, ask for *Simplified Arabic 16*. Verify, in order:

1. The assistant asks which parts (it has no target list from the student) instead of refusing.
2. Answering "body text" leads to the confirm sheet, showing the targets and the change.
3. Approving applies it, and the reply reports what changed rather than claiming a generic success.
4. **Export the .docx and open it in Word.** The body text is Simplified Arabic 16. The Arabic renders in the new font — the `w:cs` half is what proves the fix; an app-preview-only check will not catch its absence.
5. Ask for *headings 18 bold*, approve, reopen in Word: headings changed, body untouched.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/mcp/__tests__/tool-registry.test.ts
git commit -m "$(cat <<'EOF'
test(ai): registry expects set_text_style in place of set_heading_style

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

**Spec coverage.** §4 tool shape → task 6. §5 target registry → task 4 (`TARGET_SPECS`). §6 three-step write → tasks 2–4. §7 canonical ordering → task 1. §8 ask flow → the tool description in task 6 carries the vague-vs-precise rule; the `multiSelect` UI is plan 2. §9 return value → task 6. §10 gate/undo → task 8; persistence is inherited from `withThesisDoc` and needs no new code. §11 seed asset → plan 3. §12 files → the File Structure table. §13 verification → task 10.

**Known deviation from the spec.** §5 gives `lists` the predicate "styled `ListParagraph` **or** carrying `numPr`". Task 4 therefore also excludes `numPr` paragraphs from `body`, so a numbered paragraph belongs to exactly one target. Without that exclusion `body` and `lists` would both claim it and the second target's strip would fight the first.

**Deferred by design, per spec §3.** Paragraph properties (spacing, indent, alignment), table borders/widths/shading, header/footer chrome. `RunProps` and the canonicalisers are shaped so `w:pPr` support is additive.
