// Deterministic table-grid diff for AI table proposals (pure — no RN imports).
//
// The AI returns a FULL proposed grid; this module (1) aligns old↔new rows and
// columns so the Writer can paint cell-level highlights, and (2) converts the
// same alignment into a batch of existing `tableOp`s for POST /:id/ops on
// approval. One diff drives BOTH, so what the user sees is what gets applied.
// Spec: docs/superpowers/specs/2026-07-23-ai-table-proposals-design.md
//
// Alignment is FUZZY: a row (or column) pair "matches" when at least half its
// cells are equal, with at least one equal non-empty cell — an edited cell or an
// added column must not break the row mapping. If nothing matches (total
// rewrite), fall back to positional mapping so ops become in-place edits rather
// than delete-everything + re-add (which the engine's last-row/col guards would
// refuse anyway).
//
// Op emission runs a SIMULATION that mirrors the engine's semantics exactly
// (addTableRow inserts BELOW `at` or appends; insertTableColumn inserts RIGHT
// of `at` or appends — neither can insert at position 0), then a final sweep
// emits an editCell for every cell where the simulation still differs from the
// proposal. The sweep makes the result correct even where structure ops can't
// land exactly (e.g. a new first column lands at 1 — its cells are rewritten).

import type { ThesisOp } from "@/lib/thesis-ops";

export interface TableDiff {
  /** newRow -> oldRow (null = added row). */
  rowMap: (number | null)[];
  /** Old row indices with no mapping (removed). */
  removedRows: number[];
  /** newCol -> oldCol (null = added column). */
  colMap: (number | null)[];
  /** Old column indices with no mapping (removed). */
  removedCols: number[];
  /** Cells (NEW coordinates) whose mapped old cell has different text. */
  editedCells: { r: number; c: number; oldText: string; newText: string }[];
}

const norm = (s: string) => s.trim();

// Fuzzy equality for two cell vectors: ≥ half the positions equal, and at least
// one equal NON-EMPTY cell (all-empty vs all-empty rows shouldn't anchor).
function vecMatches(a: string[], b: string[]): boolean {
  const len = Math.max(a.length, b.length);
  if (len === 0) return false;
  let eq = 0;
  let eqNonEmpty = 0;
  for (let i = 0; i < len; i++) {
    const av = norm(a[i] ?? "");
    const bv = norm(b[i] ?? "");
    if (av === bv) {
      eq++;
      if (av !== "") eqNonEmpty++;
    }
  }
  return eq * 2 >= len && eqNonEmpty > 0;
}

// LCS over two sequences with a custom match predicate. Returns pairs [ai, bi].
function lcsPairs<T>(A: T[], B: T[], match: (a: T, b: T) => boolean): [number, number][] {
  const n = A.length, m = B.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = match(A[i], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (match(A[i], B[j])) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const width = (rows: string[][]) => rows.reduce((m, r) => Math.max(m, r.length), 0);
const colOf = (rows: string[][], c: number, rowIdx?: number[]) =>
  (rowIdx ?? rows.map((_, i) => i)).map((i) => rows[i]?.[c] ?? "");

export function diffGrids(oldRows: string[][], newRows: string[][]): TableDiff {
  // ── Row alignment ──
  let rowPairs = lcsPairs(oldRows, newRows, vecMatches);
  if (rowPairs.length === 0) {
    // Total rewrite: positional fallback → in-place edits, not delete-everything.
    const k = Math.min(oldRows.length, newRows.length);
    rowPairs = Array.from({ length: k }, (_, i) => [i, i] as [number, number]);
  }
  const rowMap: (number | null)[] = newRows.map(() => null);
  for (const [oi, ni] of rowPairs) rowMap[ni] = oi;
  const mappedOldRows = new Set(rowPairs.map(([oi]) => oi));
  const removedRows = oldRows.map((_, i) => i).filter((i) => !mappedOldRows.has(i));

  // ── Column alignment (over mapped row pairs only) ──
  const oldW = width(oldRows);
  const newW = width(newRows);
  const oldRowIdx = rowPairs.map(([oi]) => oi);
  const newRowIdx = rowPairs.map(([, ni]) => ni);
  const oldCols = Array.from({ length: oldW }, (_, c) => colOf(oldRows, c, oldRowIdx));
  const newCols = Array.from({ length: newW }, (_, c) => colOf(newRows, c, newRowIdx));
  let colPairs = lcsPairs(oldCols, newCols, vecMatches);
  if (colPairs.length === 0) {
    const k = Math.min(oldW, newW);
    colPairs = Array.from({ length: k }, (_, i) => [i, i] as [number, number]);
  }
  const colMap: (number | null)[] = Array.from({ length: newW }, () => null);
  for (const [oc, nc] of colPairs) colMap[nc] = oc;
  const mappedOldCols = new Set(colPairs.map(([oc]) => oc));
  const removedCols = Array.from({ length: oldW }, (_, c) => c).filter((c) => !mappedOldCols.has(c));

  // ── Edited cells (mapped row × mapped col, text differs) ──
  const editedCells: TableDiff["editedCells"] = [];
  for (let ni = 0; ni < newRows.length; ni++) {
    const oi = rowMap[ni];
    if (oi == null) continue;
    for (let nc = 0; nc < newW; nc++) {
      const oc = colMap[nc];
      if (oc == null) continue;
      const oldText = norm(oldRows[oi]?.[oc] ?? "");
      const newText = norm(newRows[ni]?.[nc] ?? "");
      if (oldText !== newText) editedCells.push({ r: ni, c: nc, oldText, newText });
    }
  }

  return { rowMap, removedRows, colMap, removedCols, editedCells };
}

// The layout fields a proposal may change, compared against the table DTO's
// current style extras (align/direction/header — see server parseTableStyle).
export interface TableLayoutProposal {
  alignment?: "left" | "center" | "right";
  direction?: "rtl" | "ltr";
  headerRow?: boolean;
  /** 6-hex (no #) background for the header row — shades row 0. */
  headerFill?: string;
  borders?: boolean;
}
export function layoutDelta(
  current: { align?: string | null; direction?: string; header?: boolean },
  proposed: TableLayoutProposal | undefined,
): TableLayoutProposal | null {
  if (!proposed) return null;
  const out: TableLayoutProposal = {};
  if (proposed.alignment && proposed.alignment !== (current.align ?? null)) out.alignment = proposed.alignment;
  if (proposed.direction && proposed.direction !== (current.direction ?? "ltr")) out.direction = proposed.direction;
  if (proposed.headerRow === true && !current.header) out.headerRow = true; // engine can't un-header
  if (proposed.headerFill) out.headerFill = proposed.headerFill.replace("#", ""); // current fill unknown — trust intent
  if (proposed.borders !== undefined) out.borders = proposed.borders; // current borders unknown — trust intent
  return Object.keys(out).length ? out : null;
}

/** Refuse absurd proposals: more ops than this and the batch is rejected. */
export const TABLE_OPS_CAP = 400;

export function diffToOps(
  index: number,
  oldRows: string[][],
  newRows: string[][],
  diff: TableDiff,
  layout?: TableLayoutProposal | null,
  /** Proposed per-cell shading grid aligned with newRows (null = leave as-is). */
  fills?: (string | null)[][] | null,
  /** Proposed per-cell FONT-color grid aligned with newRows (null = leave as-is). */
  textColors?: (string | null)[][] | null,
): ThesisOp[] | null {
  const ops: ThesisOp[] = [];
  // Simulation grid — mirrors what the engine will actually do, op by op.
  const sim: string[][] = oldRows.map((r) => [...r]);
  const simW = () => width(sim);
  const pad = () => { const w = simW(); for (const r of sim) while (r.length < w) r.push(""); };
  pad();

  // 1. Delete removed columns, DESCENDING (old indices stay valid).
  for (const c of [...diff.removedCols].sort((a, b) => b - a)) {
    if (simW() <= 1) break; // engine refuses the last column
    ops.push({ type: "tableOp", index, action: "deleteColumn", col: c });
    for (const r of sim) r.splice(c, 1);
  }
  // 2. Delete removed rows, DESCENDING.
  for (const r of [...diff.removedRows].sort((a, b) => b - a)) {
    if (sim.length <= 1) break; // engine refuses the last row
    ops.push({ type: "tableOp", index, action: "deleteRow", row: r });
    sim.splice(r, 1);
  }
  // 3. Insert added columns, ASCENDING. Engine inserts RIGHT of `at`; target
  //    position c needs at = c-1. c === 0 can't land leftmost — insert at 1 and
  //    let the sweep rewrite both columns' contents.
  for (let c = 0; c < diff.colMap.length; c++) {
    if (diff.colMap[c] != null) continue;
    const at = Math.max(0, c - 1);
    const landing = Math.min(at + 1, simW());
    ops.push({ type: "tableOp", index, action: "addColumn", at });
    for (const r of sim) r.splice(landing, 0, "");
  }
  // 4. Insert added rows, ASCENDING (same below-`at` semantics).
  for (let r = 0; r < diff.rowMap.length; r++) {
    if (diff.rowMap[r] != null) continue;
    const at = Math.max(0, r - 1);
    const landing = Math.min(at + 1, sim.length);
    ops.push({ type: "tableOp", index, action: "addRow", at });
    sim.splice(landing, 0, Array(simW()).fill(""));
  }
  pad();
  // 5. Final sweep: rewrite every cell where the simulation differs from the
  //    proposal. Guarantees content correctness wherever structure ops couldn't
  //    land exactly.
  for (let r = 0; r < Math.min(newRows.length, sim.length); r++) {
    for (let c = 0; c < Math.min(newRows[r]?.length ?? 0, simW()); c++) {
      const want = norm(newRows[r][c] ?? "");
      const have = norm(sim[r]?.[c] ?? "");
      if (want !== have) {
        ops.push({ type: "tableOp", index, action: "editCell", row: r, col: c, text: newRows[r][c] ?? "" });
        sim[r][c] = newRows[r][c] ?? "";
      }
    }
  }
  // 6. Layout, once.
  if (layout) ops.push({ type: "tableOp", index, action: "layout", opts: layout });
  // 7. Per-cell styling, once — both grids are aligned with newRows, i.e.
  //    FINAL coordinates, valid after the structure ops above.
  const hasAny = (g?: (string | null)[][] | null) => !!g && g.some((r) => r?.some((f) => !!f));
  if (hasAny(fills) || hasAny(textColors)) {
    ops.push({
      type: "tableOp",
      index,
      action: "shade",
      fills: hasAny(fills) ? fills! : undefined,
      textColors: hasAny(textColors) ? textColors! : undefined,
    });
  }

  return ops.length > TABLE_OPS_CAP ? null : ops;
}
