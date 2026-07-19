import {
  editThesisParagraph,
  splitThesisParagraph,
  editThesisParagraphs,
  moveThesisBlock,
  insertThesisImage,
  deleteThesisBlocks,
  startThesisBlocksOnNewPage,
  type DocBlockDTO,
  type DocumentDTO,
  type DocSectionDTO,
} from "@/lib/api";

// Serializable manual-edit operations on a live-.docx thesis.
//
// An op is a plain-JSON descriptor — NOT a closure — so it can be persisted to
// SQLite (lib/thesis-op-queue.ts) and survive an app kill or a dead connection:
// the durable queue replays unsent ops when the thesis is reopened / the network
// returns. Each op type has two derivations here:
//   • applyOpToBlocks — the optimistic local patch (mirrors the server's effect
//     on the block DTOs) so the UI updates instantly and can be rebuilt from the
//     cached doc + queued ops after a restart.
//   • executeOp — the server call. The edit endpoints echo the mutated document,
//     which the doc store uses to reconcile.
//
// Indices are POSITIONAL (they shift on insert/delete/move), so ops for one
// thesis must replay strictly in order, and a permanently-rejected op poisons
// every later queued op for that thesis (the store drops the queue + revalidates).

type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;
type ImageBlock = Extract<DocBlockDTO, { kind: "image" }>;
export type UiAlign = "left" | "center" | "right" | "justify";

export interface FormatChange {
  level?: number;
  alignment?: UiAlign;
  direction?: "rtl" | "ltr";
  clearFormatting?: boolean;
}

export type ThesisOp =
  | { type: "editText"; index: number; text: string }
  | { type: "splitParagraph"; index: number; before: string; after: string }
  | { type: "format"; indices: number[]; changes: FormatChange }
  | { type: "move"; from: number; to: number }
  | {
      type: "insertImage";
      afterIndex: number;
      data: string; // base64 (no data: prefix)
      format: string;
      width?: number;
      height?: number;
    }
  | { type: "deleteBlocks"; indices: number[] }
  | { type: "startOnNewPage"; indices: number[] };

// ── Optimistic patches (DTO-level mirror of the server's effect) ─────────────

// Reindex after a structural change — the DTO `index` is a block's position.
const reindex = (blocks: DocBlockDTO[]): DocBlockDTO[] => blocks.map((b, i) => ({ ...b, index: i }));

function patchFormat(blocks: DocBlockDTO[], indices: number[], ch: FormatChange): DocBlockDTO[] {
  const set = new Set(indices);
  return blocks.map((b) => {
    if (b.kind !== "paragraph" || !set.has(b.index)) return b;
    let nb: ParagraphBlock = { ...b };
    if (ch.clearFormatting) nb = { ...nb, level: 0, styleId: null, alignment: null, direction: null };
    if (ch.level != null) {
      nb.level = Math.max(0, Math.min(6, ch.level)) as ParagraphBlock["level"];
      nb.styleId = ch.level === 0 ? "Normal" : `Heading${ch.level}`;
    }
    if (ch.alignment != null) nb.alignment = ch.alignment === "justify" ? "both" : ch.alignment;
    if (ch.direction != null) nb.direction = ch.direction;
    return nb;
  });
}

function patchMove(blocks: DocBlockDTO[], from: number, to: number): DocBlockDTO[] {
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return blocks;
  const arr = [...blocks];
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  return reindex(arr);
}

function patchInsertImage(
  blocks: DocBlockDTO[],
  op: Extract<ThesisOp, { type: "insertImage" }>,
): DocBlockDTO[] {
  const at = Math.min(Math.max(op.afterIndex + 1, 0), blocks.length);
  const img: ImageBlock = {
    index: at,
    kind: "image",
    dataUri: `data:image/${op.format};base64,${op.data}`,
    hasMedia: true,
    width: op.width,
    height: op.height,
  };
  const arr = [...blocks];
  arr.splice(at, 0, img);
  return reindex(arr);
}

function patchDelete(blocks: DocBlockDTO[], indices: number[]): DocBlockDTO[] {
  const set = new Set(indices);
  return reindex(blocks.filter((b) => !set.has(b.index)));
}

/** Apply an op's optimistic effect to a block list. Pure — returns a new array. */
export function applyOpToBlocks(blocks: DocBlockDTO[], op: ThesisOp): DocBlockDTO[] {
  switch (op.type) {
    case "editText":
      return blocks.map((b) => (b.index === op.index && b.kind === "paragraph" ? { ...b, text: op.text } : b));
    case "splitParagraph": {
      const arr: DocBlockDTO[] = [];
      for (const b of blocks) {
        if (b.index === op.index && b.kind === "paragraph") {
          arr.push({ ...b, text: op.before });
          // New paragraph inherits the source's style/level/alignment/direction.
          arr.push({ ...b, text: op.after });
        } else {
          arr.push(b);
        }
      }
      return reindex(arr);
    }
    case "format":
      return patchFormat(blocks, op.indices, op.changes);
    case "move":
      return patchMove(blocks, op.from, op.to);
    case "insertImage":
      return patchInsertImage(blocks, op);
    case "deleteBlocks":
      return patchDelete(blocks, op.indices);
    case "startOnNewPage":
      // Page breaks don't change the block list — nothing to patch (the PDF/Word
      // views pick the change up from the server reconcile).
      return blocks;
  }
}

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
      return shift((st) => (st > at ? st + 1 : st));
    }
    case "splitParagraph": {
      const at = op.index + 1;
      return shift((st) => (st > at ? st + 1 : st));
    }
    case "deleteBlocks": {
      return shift((st) => st - op.indices.filter((i) => i < st).length);
    }
    case "move": {
      if (op.from === op.to) return sections;
      return shift((st) => {
        let v = st > op.from ? st - 1 : st;
        if (v > op.to) v += 1;
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
  const blocks = applyOpToBlocks(doc.blocks, op);
  // A move patchMove rejected (out-of-range) must not shift sections either.
  const rejectedMove =
    op.type === "move" &&
    (op.from < 0 || op.to < 0 || op.from >= doc.blocks.length || op.to >= doc.blocks.length);
  return {
    ...doc,
    blocks,
    sections: rejectedMove ? doc.sections : applyOpToSections(doc.sections, op),
  };
}

// ── Server execution ─────────────────────────────────────────────────────────

/** Run an op against the server. Returns the endpoint's echoed document (when
 *  the endpoint provides one) for the doc store to reconcile from. */
export async function executeOp(
  thesisId: string,
  op: ThesisOp,
): Promise<{ document?: DocumentDTO; history?: { canUndo: boolean; canRedo: boolean } }> {
  switch (op.type) {
    case "editText":
      return editThesisParagraph(thesisId, op.index, { text: op.text });
    case "splitParagraph":
      return splitThesisParagraph(thesisId, op.index, { before: op.before, after: op.after });
    case "format":
      return editThesisParagraphs(thesisId, op.indices, op.changes);
    case "move":
      return moveThesisBlock(thesisId, op.from, op.to);
    case "insertImage":
      return insertThesisImage(thesisId, {
        data: op.data,
        format: op.format,
        width: op.width,
        height: op.height,
        afterIndex: op.afterIndex,
      });
    case "deleteBlocks":
      return deleteThesisBlocks(thesisId, op.indices);
    case "startOnNewPage":
      return startThesisBlocksOnNewPage(thesisId, op.indices);
  }
}

// ── Failure classification ───────────────────────────────────────────────────

// A RETRYABLE failure means the request likely never reached the server (offline,
// DNS, timeout) → keep the op queued and retry later. Anything else is the server
// REJECTING the op (validation, auth, conflict) → retrying would never succeed.
// RN's fetch throws TypeError("Network request failed") when offline; our api.ts
// throws plain Errors carrying the server's message for HTTP-level failures.
export function isRetryableError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /network|fetch failed|timed? ?out|socket|ECONN|abort/i.test(msg);
}
