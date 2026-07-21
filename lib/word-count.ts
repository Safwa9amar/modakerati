import type { DocBlockDTO } from "@/lib/api";

// A "word" = a maximal run of non-whitespace. Whitespace-splitting counts Latin
// and Arabic prose alike (both are space-delimited); only paragraph blocks carry
// running text, so tables/figures/structural blocks are skipped.
export function countWords(blocks: DocBlockDTO[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind !== "paragraph") continue;
    const t = b.text.trim();
    if (!t) continue;
    n += t.split(/\s+/).length;
  }
  return n;
}
