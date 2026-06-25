import { Lexer } from "marked";

export interface MdBlock { index: number; raw: string; type: string; excerpt: string; }

/** Top-level blocks of a chapter's markdown, each with its raw source + a short excerpt for the chip. */
export function chapterBlocks(md: string): MdBlock[] {
  const tokens = new Lexer().lex(md || "");
  const blocks: MdBlock[] = [];
  for (const t of tokens as any[]) {
    if (t.type === "space") continue;
    const raw: string = (t.raw ?? "").replace(/\n+$/, "");
    if (!raw.trim()) continue;
    let excerpt: string;
    if (t.type === "table") excerpt = "Tableau";
    else if (t.type === "code" && /^\s*```chart/i.test(t.raw ?? "")) excerpt = "Graphique";
    else excerpt = String(t.text ?? raw).replace(/[#>*`_~\-]/g, "").trim().slice(0, 60);
    blocks.push({ index: blocks.length, raw: t.raw ?? raw, type: t.type, excerpt: excerpt || raw.slice(0, 60) });
  }
  return blocks;
}
