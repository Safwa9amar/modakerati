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
  M.paginate({ heights: [400, 400, 400, 400], pageContentPx: limits(4, 900), forcedStarts: new Set() }),
  [0, 2]);
check("a block taller than a page stands alone",
  M.paginate({ heights: [100, 2000, 100], pageContentPx: limits(3, 900), forcedStarts: new Set() }),
  [0, 1, 2]);
check("a forced start begins a page even mid-fill",
  M.paginate({ heights: [100, 100, 100], pageContentPx: limits(3, 900), forcedStarts: new Set([2]) }),
  [0, 2]);
check("empty document paginates to nothing",
  M.paginate({ heights: [], pageContentPx: [], forcedStarts: new Set() }), []);

// ── numbering: the two divider conventions from the spec ────────────────────
const starts = [0, 10, 20, 30, 40, 50];   // six pages
const counted = [
  { startBlockIndex: 0,  unnumbered: false, pageNumberStart: null, pageNumberFormat: "decimal" },
  { startBlockIndex: 50, unnumbered: true,  pageNumberStart: null, pageNumberFormat: "decimal" },
];
check("divider COUNTED — page after a divider is divider+1",
  M.numberPages([0, 10, 50, 60], [
    ...counted,
    { startBlockIndex: 60, unnumbered: false, pageNumberStart: null, pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["1", "2", null, "4"]);

check("divider NOT COUNTED — the next section restarts and reclaims the number",
  M.numberPages([0, 10, 50, 60], [
    ...counted,
    { startBlockIndex: 60, unnumbered: false, pageNumberStart: 3, pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["1", "2", null, "3"]);

check("an unnumbered page reports no number at all",
  M.numberPages([0], [{ startBlockIndex: 0, unnumbered: true, pageNumberStart: null, pageNumberFormat: "decimal" }])
    .map((p) => [p.number, p.text])[0],
  [null, null]);

check("roman front matter renumbers to decimal at the body",
  M.numberPages(starts, [
    { startBlockIndex: 0,  unnumbered: false, pageNumberStart: null, pageNumberFormat: "lowerRoman" },
    { startBlockIndex: 30, unnumbered: false, pageNumberStart: 1,    pageNumberFormat: "decimal" },
  ]).map((p) => p.text),
  ["i", "ii", "iii", "1", "2", "3"]);

// ── number formats ──────────────────────────────────────────────────────────
check("lowerRoman 4/9/14/40", [4, 9, 14, 40].map((n) => M.formatPageNumber(n, "lowerRoman")), ["iv", "ix", "xiv", "xl"]);
check("upperRoman 1990", M.formatPageNumber(1990, "upperRoman"), "MCMXC");
check("upperLetter wraps Word-style at 27", [1, 26, 27, 28].map((n) => M.formatPageNumber(n, "upperLetter")), ["A", "Z", "AA", "BB"]);
check("an unknown format degrades to decimal", M.formatPageNumber(7, "chicago"), "7");

console.log(failures ? `\n${failures} FAILED` : "\nAll page-layout checks passed");
process.exit(failures ? 1 : 0);
