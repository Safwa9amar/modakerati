// Page ornaments in the block model.
//
// `add_page_ornament` decorates a front-matter page the student already wrote
// (الإهداء, شكر وتقدير, الملخص) with a full-page artwork FRAME. In the .docx that
// frame is a page-anchored drawing painted BEHIND the text, parked in a carrier
// paragraph of its own — so the server reports it as an `image` block flagged
// `ornament: true`.
//
// It is page decoration, not a figure in the flow. Every reading surface must
// treat it that way:
//   • the writer draws nothing for it (it rendered as a huge empty box above the
//     dedication, pushing the real text down the page),
//   • the Structure drawer and the Library never count it as "Figure N".
// The block is still KEPT in the block list everywhere. Filtering it out of what
// the Lexical editor serializes back would read as "the student deleted this
// block", and the write-back diff would strip the ornament out of the .docx.
//
// No RN or DOM imports — this is shared by the native screens and the 'use dom'
// editor bundle alike.
import type { DocBlockDTO } from "@/lib/api";

export function isOrnamentBlock(block: DocBlockDTO): boolean {
  return block.kind === "image" && !!block.ornament;
}

/** Image blocks that are real figures — ornaments excluded (figure numbering). */
export function isFigureBlock(block: DocBlockDTO): block is Extract<DocBlockDTO, { kind: "image" }> {
  return block.kind === "image" && !block.ornament;
}
