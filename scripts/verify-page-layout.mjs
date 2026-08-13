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

// ── chrome artwork placement ────────────────────────────────────────────────
// The real thesis (f7cd3175): A4, margins t/b 1418tw, l 1418tw, r 1701tw,
// header 708tw. Its cover frame is an anchored, behind-text picture measured
// from the header PARAGRAPH; the الإهداء frame is measured from the MARGIN.
const THESIS_PAGE = {
  widthTwips: 11906, heightTwips: 16838,
  margins: { top: 1418, bottom: 1418, left: 1418, right: 1701, header: 708, footer: 1349, gutter: 0 },
};
const rtlGeo = M.chromeGeometryFromSection(THESIS_PAGE);
const round = (n) => Math.round(n * 10) / 10;
check("chrome geometry: page art uses the PHYSICAL left margin, unmirrored",
  round(rtlGeo.leftMarginPx), round((1418 * 96) / 1440));
check("chrome geometry: header distance comes from w:header",
  round(rtlGeo.headerDistancePx), round((708 * 96) / 1440));

// Fractions of the sheet — the form that survives to any screen width.
const IN = 914400;
const inPx = (emu) => (emu / IN) * 96;
const cover = M.chromeDrawingFractions(
  { widthEmu: 10706100, heightEmu: 10756900,
    posH: { relativeTo: "column", offsetEmu: -2462530, align: null },
    posV: { relativeTo: "paragraph", offsetEmu: -525780, align: null } },
  rtlGeo,
);
// The cover bitmap is 1.35x the sheet and pushed off its left edge — that is
// what lands the border INSIDE it on the page edges. Stretching it to the paper
// instead would pull that border inward.
check("cover frame is wider than the sheet, as authored",
  round(cover.widthFrac), round(inPx(10706100) / rtlGeo.pageWidthPx));
check("cover frame starts off the sheet's left edge",
  [cover.leftFrac < 0, round(cover.leftFrac)],
  [true, round((rtlGeo.leftMarginPx + inPx(-2462530)) / rtlGeo.pageWidthPx)]);
check("cover frame's far edge runs past the sheet",
  cover.leftFrac + cover.widthFrac > 1, true);

// The الإهداء frame is authored to sit flush on the sheet — the check that the
// origin mapping is right, since a wrong one shows up as a visible inset.
const dedication = M.chromeDrawingFractions(
  { widthEmu: 7550785, heightEmu: 10668000,
    posH: { relativeTo: "margin", offsetEmu: -884555, align: null },
    posV: { relativeTo: "margin", offsetEmu: -884555, align: null } },
  rtlGeo,
);
check("the الإهداء frame covers the sheet edge to edge",
  [Math.abs(dedication.leftFrac) < 0.01, Math.abs(dedication.leftFrac + dedication.widthFrac - 1) < 0.01],
  [true, true]);
check("...and spans essentially the whole sheet height",
  dedication.heightFrac > 0.94 && dedication.heightFrac <= 1.01, true);

// Fractions are resolution-free: the same numbers drive any paper width.
const at390 = { left: cover.leftFrac * 390, width: cover.widthFrac * 390 };
const at780 = { left: cover.leftFrac * 780, width: cover.widthFrac * 780 };
check("doubling the paper doubles the art, preserving Word's proportions",
  [round(at780.left / at390.left), round(at780.width / at390.width)], [2, 2]);

// A page-relative anchor at 0 starts at the sheet's own corner.
const pageRel = M.chromeDrawingFractions(
  { widthEmu: IN, heightEmu: IN,
    posH: { relativeTo: "page", offsetEmu: 0, align: null },
    posV: { relativeTo: "page", offsetEmu: 0, align: null } },
  rtlGeo,
);
check("a page-relative anchor at offset 0 sits on the sheet's left edge",
  round(pageRel.leftFrac), 0);
check("...and one top margin above the text, as a fraction of the sheet",
  round(pageRel.topFrac), round(-rtlGeo.topMarginPx / rtlGeo.pageHeightPx));

// ── duotone ─────────────────────────────────────────────────────────────────
check("no duotone → no stops, so the bytes draw untouched", M.duotoneStops(null), null);
check("a duotone with no colour → no stops",
  M.duotoneStops({ dark: null, light: "FFFFFF", shade: 0.45, satMod: 1.35 }), null);
check("a malformed hex is refused rather than guessed",
  M.duotoneStops({ dark: "nothex", light: null, shade: null, satMod: null }), null);
check("no shade/satMod → the colour passes through untouched",
  M.duotoneStops({ dark: "FFC000", light: "FFFFFF", shade: null, satMod: null }),
  { dark: "FFC000", light: "FFFFFF" });

// The real cover frame: accent4 gold at 45% shade. The shade MUST be applied in
// linear light — doing it in sRGB gives #735600, a mud brown, where Word paints
// a clear amber. This check is the guard on that.
const gold = M.duotoneStops({ dark: "FFC000", light: "FFFFFF", shade: 0.45, satMod: 1.35 });
check("the cover frame's gold is a mid amber, not mud", gold.dark, "B38600");
check("...and it is genuinely golden: red high, green mid, blue absent",
  [parseInt(gold.dark.slice(0, 2), 16) > 150,
   parseInt(gold.dark.slice(2, 4), 16) > 100 && parseInt(gold.dark.slice(2, 4), 16) < 180,
   parseInt(gold.dark.slice(4, 6), 16) < 30],
  [true, true, true]);
check("the highlight stop carries through", gold.light, "FFFFFF");

console.log(failures ? `\n${failures} FAILED` : "\nAll page-layout checks passed");
process.exit(failures ? 1 : 0);
