// Shared Lexical→blocks write-back diff. Given the loaded baseline blocks and the
// blocks Lexical serialized back, produce a MINIMAL, ordered op sequence
// (editText / splitParagraph / deleteBlocks / format) that transforms baseline →
// target — using an LCS edit script (no cascade) and simulating indices with the
// store's own applyOpToBlocks so op indices stay correct. The whole list is then
// sent in ONE call to POST /api/thesis/:id/ops (see api.applyThesisOps).
//
// Used by the Lexical Write-back lab screen and the in-workspace Lexical editor.

import { detectDir } from "@/components/workspace/DocBlock";
import { applyOpToBlocks, type ThesisOp } from "@/lib/thesis-ops";
import type { DocBlockDTO } from "@/lib/api";

export type ParaRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };
type ParagraphDTO = Extract<DocBlockDTO, { kind: "paragraph" }>;

export function runsOf(b: ParagraphDTO): ParaRun[] {
  const r = (b as { runs?: ParaRun[] }).runs;
  return r?.length ? r : b.text ? [{ text: b.text }] : [];
}
function normMarks(runs: ParaRun[]): string {
  const cleaned = runs.map((r) => ({ b: !!r.bold, i: !!r.italic, u: !!r.underline, c: (r.color || "").replace(/^#/, "").toUpperCase() }));
  const merged: typeof cleaned = [];
  for (const r of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.u === r.u && last.c === r.c) continue;
    merged.push(r);
  }
  return JSON.stringify(merged.filter((r) => r.b || r.i || r.u || r.c));
}
const uiAlign = (a: ParagraphDTO["alignment"]) => (a === "both" ? "justify" : a === "left" || a === "center" || a === "right" ? a : undefined);

// Content identity used to ALIGN blocks (structure). Text-only for paragraphs so a
// format-only change stays "the same block" and is handled by the format pass.
export function tsig(b: DocBlockDTO): string {
  if (b.kind === "paragraph") return "p|" + b.text;
  if (b.kind === "table") return "t|" + JSON.stringify(b.rows);
  if (b.kind === "image") return "i|" + (b.dataUri ?? "") + "|" + (b.caption ?? "") + "|" + (b.hasMedia ? 1 : 0);
  return "o|" + b.tag;
}
type Fmt = { level?: number; alignment?: "left" | "center" | "right" | "justify"; direction?: "rtl" | "ltr" };
function fmtChanges(o: ParagraphDTO, n: ParagraphDTO): Fmt | null {
  const c: Fmt = {};
  if (o.level !== n.level) c.level = n.level;
  if ((o.alignment ?? null) !== (n.alignment ?? null)) {
    const ui = uiAlign(n.alignment);
    if (ui) c.alignment = ui;
  }
  const oDir = o.direction ?? detectDir(o.text, false);
  const nDir = n.direction ?? detectDir(n.text, false);
  if (oDir !== nDir && (n.direction === "rtl" || n.direction === "ltr")) c.direction = n.direction;
  return Object.keys(c).length ? c : null;
}

type Step = { op: "keep" | "del" | "ins"; ai?: number; bi?: number };

function lcsScript(A: string[], B: string[]): Step[] {
  const n = A.length, m = B.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Step[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ op: "keep", ai: i, bi: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: "del", ai: i }); i++; }
    else { out.push({ op: "ins", bi: j }); j++; }
  }
  while (i < n) out.push({ op: "del", ai: i++ });
  while (j < m) out.push({ op: "ins", bi: j++ });
  return out;
}

export function planOps(base: DocBlockDTO[], target: DocBlockDTO[]): { ops: ThesisOp[]; unsupported: string[]; converged: boolean } {
  const script = lcsScript(base.map(tsig), target.map(tsig));
  let sim: DocBlockDTO[] = base.map((b, k) => ({ ...b, index: k }));
  const ops: ThesisOp[] = [];
  const unsupported: string[] = [];
  const emit = (op: ThesisOp) => { ops.push(op); sim = applyOpToBlocks(sim, op); };
  const asPara = (b: DocBlockDTO | undefined) => (b && b.kind === "paragraph" ? b : null);
  let pos = 0;

  for (let k = 0; k < script.length; k++) {
    const step = script[k];
    const next = script[k + 1];
    if (step.op === "del" && next && next.op === "ins") {
      const oldB = asPara(base[step.ai!]);
      const newB = asPara(target[next.bi!]);
      if (oldB && newB) {
        const cur = asPara(sim[pos]);
        if (cur && cur.text !== newB.text) emit({ type: "editText", index: pos, text: newB.text });
        const now = asPara(sim[pos]);
        if (now) {
          const fc = fmtChanges(now, newB);
          if (fc) emit({ type: "format", indices: [pos], changes: fc });
          if (normMarks(runsOf(now)) !== normMarks(runsOf(newB))) unsupported.push(`inline run formatting @${pos}`);
        }
        pos++; k++;
        continue;
      }
    }
    if (step.op === "keep") {
      const cur = asPara(sim[pos]);
      const newB = asPara(target[step.bi!]);
      if (cur && newB) {
        const fc = fmtChanges(cur, newB);
        if (fc) emit({ type: "format", indices: [pos], changes: fc });
        if (normMarks(runsOf(cur)) !== normMarks(runsOf(newB))) unsupported.push(`inline run formatting @${pos}`);
      }
      pos++;
    } else if (step.op === "del") {
      emit({ type: "deleteBlocks", indices: [pos] });
    } else {
      const newB = target[step.bi!];
      if (newB.kind !== "paragraph") { unsupported.push(`insert ${newB.kind} @${pos}`); continue; }
      if (pos === 0) {
        const first = asPara(sim[0]);
        if (!first) { unsupported.push(`insert @0 needs a paragraph anchor`); continue; }
        emit({ type: "splitParagraph", index: 0, before: newB.text, after: first.text });
      } else {
        const anchor = asPara(sim[pos - 1]);
        if (!anchor) { unsupported.push(`insert @${pos} needs a paragraph anchor`); continue; }
        emit({ type: "splitParagraph", index: pos - 1, before: anchor.text, after: newB.text });
      }
      const now = asPara(sim[pos]);
      if (now) { const fc = fmtChanges(now, newB); if (fc) emit({ type: "format", indices: [pos], changes: fc }); }
      pos++;
    }
  }
  const converged = sim.length === target.length && target.every((t, k) => sim[k] && tsig(sim[k]) === tsig(t));
  return { ops, unsupported, converged };
}

export function tally(ops: ThesisOp[]): string {
  const c: Record<string, number> = {};
  for (const o of ops) c[o.type] = (c[o.type] ?? 0) + 1;
  return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(", ") || "none";
}
