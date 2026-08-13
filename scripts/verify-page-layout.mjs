// Verifies lib/page-layout.ts by transpiling the REAL module and importing it,
// so this cannot drift from shipping code. The app has no test runner; this and
// `npx tsc --noEmit` are the automated gate. Run: node scripts/verify-page-layout.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "lib/page-layout.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = path.join(os.tmpdir(), `page-layout-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const M = await import(`file://${tmp}`);
fs.unlinkSync(tmp);

let failures = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok  ${name}`); return; }
  failures++;
  console.log(`FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
};

// ── geometry ────────────────────────────────────────────────────────────────
const a4 = M.geometryFromSection(undefined);
check("A4 fallback text column ≈ 601.7px", Math.round(a4.textColumnPx * 10) / 10, 601.7);
check("A4 fallback content height ≈ 930.5px", Math.round(a4.contentHeightPx * 10) / 10, 930.5);

const bound = M.geometryFromSection({
  widthTwips: 11906, heightTwips: 16838,
  margins: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 720, footer: 720, gutter: 720 },
});
check("a binding gutter narrows the text column", Math.round(bound.textColumnPx * 10) / 10, 553.7);

// ── pagination ──────────────────────────────────────────────────────────────
const limits = (n, v) => Array.from({ length: n }, () => v);
check("fills a page then breaks",
  M.paginate({ heights: [400, 400, 400, 400], pageContentPx: limits(4, 900), forcedStarts: new Set() }).starts,
  [0, 2]);
check("a block taller than a page stands alone",
  M.paginate({ heights: [100, 2000, 100], pageContentPx: limits(3, 900), forcedStarts: new Set() }).starts,
  [0, 1, 2]);
check("a forced start begins a page even mid-fill",
  M.paginate({ heights: [100, 100, 100], pageContentPx: limits(3, 900), forcedStarts: new Set([2]) }).starts,
  [0, 2]);
check("empty document paginates to nothing",
  M.paginate({ heights: [], pageContentPx: [], forcedStarts: new Set() }).starts, []);

// ── pagination v2 — Word's break rules (F2 keep, F3 space-before, F4 carry) ──
const S = (...xs) => new Set(xs);

// F3 — space-before suppression. Word eats a paragraph's space-before at a
// NATURAL page top; it survives only mid-page and after a forced (section) break.
check("F3: space-before eaten at a natural page top",
  M.paginate({ heights: [500, 400, 400], spaceBefore: [0, 300, 100], pageContentPx: limits(3, 900), forcedStarts: S() }).starts,
  [0, 1]);
check("F3: block 0 is a natural top — its space-before is eaten",
  M.paginate({ heights: [400, 400], spaceBefore: [300, 100], pageContentPx: limits(2, 900), forcedStarts: S() }).starts,
  [0]);
check("F3: a FORCED start keeps its space-before",
  M.paginate({ heights: [100, 500, 300], spaceBefore: [0, 200, 100], pageContentPx: limits(3, 900), forcedStarts: S(1) }).starts,
  [0, 1, 2]);

// F2 — keep-with-next. A heading must not end a page; it follows its content
// onto the next one, leaving a REAL gap behind (a pull is never a carry).
check("F2: a keep heading is pulled onto the page it introduces — real gap, not a carry",
  M.paginate({ heights: [700, 100, 600], pageContentPx: limits(3, 900), forcedStarts: S(), keepWithNext: S(1), splittable: [true, true, true] }),
  { starts: [0, 1], physPage: [0, 1], remainder: [200, 200] });
check("F2: a chain of two keeps moves together",
  M.paginate({ heights: [500, 80, 80, 700], pageContentPx: limits(4, 900), forcedStarts: S(), keepWithNext: S(1, 2) }),
  { starts: [0, 1], physPage: [0, 1], remainder: [400, 40] });
check("F2: at most two blocks move",
  M.paginate({ heights: [400, 80, 80, 80, 700], pageContentPx: limits(5, 900), forcedStarts: S(), keepWithNext: S(1, 2, 3) }).starts,
  [0, 2]);
check("F2: a page never gives up its only block",
  M.paginate({ heights: [100, 850], pageContentPx: limits(2, 900), forcedStarts: S(), keepWithNext: S(0) }).starts,
  [0, 1]);
check("F2: no pull across a forced (section) start",
  M.paginate({ heights: [700, 100, 600], pageContentPx: limits(3, 900), forcedStarts: S(2), keepWithNext: S(1), splittable: [true, true, true] }),
  { starts: [0, 2], physPage: [0, 1], remainder: [100, 300] });

// F4 — overflow carry. Word SPLITS a paragraph across the break: the ended page
// is filled by its first lines (remainder 0) and only the spill opens the next.
check("F4: a splittable trigger fills the page it leaves and carries the spill",
  M.paginate({ heights: [500, 300, 400], pageContentPx: limits(3, 900), forcedStarts: S(), splittable: [true, true, true] }),
  { starts: [0, 2], physPage: [0, 1], remainder: [0, 600] });
check("F4: an unsplittable trigger moves whole and leaves the real gap",
  M.paginate({ heights: [500, 300, 400], pageContentPx: limits(3, 900), forcedStarts: S(), splittable: [true, true, false] }),
  { starts: [0, 2], physPage: [0, 1], remainder: [100, 500] });
check("F4: a spill consuming whole middle pages advances the physical counter",
  M.paginate({ heights: [800, 2050, 800], pageContentPx: limits(3, 900), forcedStarts: S(), splittable: [true, true, true] }),
  { starts: [0, 1, 2], physPage: [0, 1, 4], remainder: [0, 0, 850] });
check("F4: an over-tall unsplittable block spans sheets alone; the next band counts them",
  M.paginate({ heights: [100, 2000, 100], pageContentPx: limits(3, 900), forcedStarts: S() }),
  { starts: [0, 1, 2], physPage: [0, 1, 4], remainder: [800, 700, 800] });

// ── numbering: the two divider conventions from the spec ────────────────────
const starts = [0, 10, 20, 30, 40, 50];   // six pages
const counted = [
  { startBlockIndex: 0,  unnumbered: false, pageNumberStart: null, pageNumberFormat: "decimal" },
  { startBlockIndex: 50, unnumbered: true,  pageNumberStart: null, pageNumberFormat: "decimal" },
];
check("divider COUNTED — page after a divider is divider+1",
  M.numberPages([0, 10, 50, 60], [0, 1, 2, 3], [
    ...counted,
    { startBlockIndex: 60, unnumbered: false, pageNumberStart: null, pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["1", "2", null, "4"]);

check("divider NOT COUNTED — the next section restarts and reclaims the number",
  M.numberPages([0, 10, 50, 60], [0, 1, 2, 3], [
    ...counted,
    { startBlockIndex: 60, unnumbered: false, pageNumberStart: 3, pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["1", "2", null, "3"]);

check("an unnumbered page reports no number at all",
  M.numberPages([0], [0], [{ startBlockIndex: 0, unnumbered: true, pageNumberStart: null, pageNumberFormat: "decimal" }])
    .map((p) => [p.number, p.text])[0],
  [null, null]);

check("roman front matter renumbers to decimal at the body",
  M.numberPages(starts, [0, 1, 2, 3, 4, 5], [
    { startBlockIndex: 0,  unnumbered: false, pageNumberStart: null, pageNumberFormat: "lowerRoman" },
    { startBlockIndex: 30, unnumbered: false, pageNumberStart: 1,    pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["i", "ii", "iii", "1", "2", "3"]);

// Physical numbering: pages consumed INSIDE a tall or spilling block carry no
// band, but they still count — the counter advances by the physPage delta.
check("physical numbering: the counter advances by the sheets consumed",
  M.numberPages([0, 10], [0, 3],
    [{ startBlockIndex: 0, unnumbered: false, pageNumberStart: null, pageNumberFormat: "decimal" }],
  ).map((p) => p.text),
  ["1", "4"]);

// ── number formats ──────────────────────────────────────────────────────────
check("lowerRoman 4/9/14/40", [4, 9, 14, 40].map((n) => M.formatPageNumber(n, "lowerRoman")), ["iv", "ix", "xiv", "xl"]);
check("upperRoman 1990", M.formatPageNumber(1990, "upperRoman"), "MCMXC");
check("upperLetter wraps Word-style at 27", [1, 26, 27, 28].map((n) => M.formatPageNumber(n, "upperLetter")), ["A", "Z", "AA", "BB"]);
check("an unknown format degrades to decimal", M.formatPageNumber(7, "chicago"), "7");

// ── line height (Task 6's measuring helper) ─────────────────────────────────
const fmtOf = (rule, value) => ({ sizePt: 14, line: { rule, value }, beforePt: 0, afterPt: 0 });
check("lineHeightPx: auto multiplies the font's own leading",
  Math.round((M.lineHeightPx?.(fmtOf("auto", 1.5), 14.7) ?? NaN) * 100) / 100, 22.05);
check("lineHeightPx: exact is the rule in px, leading ignored",
  M.lineHeightPx?.(fmtOf("exact", 24), 14.7), 32);
check("lineHeightPx: atLeast takes the larger of rule and leading",
  [M.lineHeightPx?.(fmtOf("atLeast", 12), 20), M.lineHeightPx?.(fmtOf("atLeast", 12), 10)], [20, 16]);
check("PX_PER_PT is 96/72", M.PX_PER_PT, 96 / 72);

console.log(failures ? `\n${failures} FAILED` : "\nAll page-layout checks passed");
process.exit(failures ? 1 : 0);
