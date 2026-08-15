// A tappable reference from an AI answer to a PLACE in the thesis.
//
// The assistant addresses the document by block index — that is how every doc
// tool works — but the student must never read one (see the server's
// no-index-leak.ts, and the "never print an index" rule in the system prompt).
// Those two facts used to leave the student stranded: the AI would say "there
// are some empty paragraphs before the acknowledgements" and the student had no
// way to get there except scrolling. A LINK settles both — the index rides in
// the href where only the app sees it, and the sentence keeps reading like a
// supervisor wrote it.
//
// Wire format is an ordinary markdown link with a private scheme:
//
//     [الفقرات الفارغة](modk://b/11)      one block
//     [الفقرات الفارغة](modk://b/11-20)   a range (we land on the first)
//
// A markdown link (rather than a [[MODK_…]] frame) because the renderer already
// parses links, so a persisted message reloaded from history — and the
// full-screen viewer, and anything else rendering the same markdown — gets the
// affordance for free. The scheme is deliberately short and keyword-free:
// "modk://b/11" carries none of the words ("block", "index", "الكتلة") the
// server's index scrubber rewrites, so a link can never be mangled in transit.
import type { DocBlockDTO } from "@/lib/api";
import { blockSearchText } from "@/lib/search-match";
import { normalize } from "@/lib/text-normalize";

export interface BlockLink {
  /** Block index the link points at — as it was when the answer was written. */
  index: number;
  /** Last block of a range, when the AI referred to several at once. */
  end?: number;
}

/** Both halves of the app+server contract live here; the server mirrors this
 *  string in the prompt catalogue (src/lib/ai/types.ts). */
export const BLOCK_LINK_PREFIX = "modk://b/";

const HREF_RE = /^modk:\/\/b\/(\d+)(?:[-–](\d+))?\/?$/i;

/** `modk://b/11` / `modk://b/11-20` → the link, or null for any other href. */
export function parseBlockHref(href: string | null | undefined): BlockLink | null {
  if (!href) return null;
  const m = HREF_RE.exec(href.trim());
  if (!m) return null;
  const index = Number(m[1]);
  if (!Number.isFinite(index) || index < 0) return null;
  const end = m[2] != null ? Number(m[2]) : undefined;
  return end != null && Number.isFinite(end) && end > index ? { index, end } : { index };
}

export function makeBlockHref(index: number, end?: number): string {
  return end != null && end > index ? `${BLOCK_LINK_PREFIX}${index}-${end}` : `${BLOCK_LINK_PREFIX}${index}`;
}

// Below this the label is too generic to re-locate anything ("here", "هنا"), so
// the index is taken at face value.
const MIN_LABEL = 4;
// Only the head of a long label is compared: the AI often links a whole clause
// ("the empty paragraphs before the acknowledgements") whose tail is its own
// prose, not the block's text.
const LABEL_HEAD = 40;

/**
 * Turn a link written earlier into the index to jump to NOW.
 *
 * Indices shift: a chat message survives the edits made after it, so the block
 * the AI linked may have moved by the time the student taps. The link's label is
 * almost always the place's own words (a heading, the opening of a paragraph),
 * which makes it a usable anchor — so we trust the index only while the text
 * still agrees with it, and otherwise re-find the label, preferring the
 * candidate nearest the original index (documents shift by a few blocks, not by
 * a hundred). With nothing to match on, the index stands.
 */
export function resolveBlockIndex(
  blocks: DocBlockDTO[] | undefined,
  link: BlockLink,
  label?: string,
): number {
  if (!blocks?.length) return link.index; // not loaded yet — the deep link scrolls once it is
  const max = blocks.length - 1;
  const at = Math.min(Math.max(link.index, 0), max);
  const needle = normalize(label ?? "").slice(0, LABEL_HEAD).trim();
  if (needle.length < MIN_LABEL) return at;

  const textAt = (i: number) => normalize(blockSearchText(blocks[i] ?? ({} as DocBlockDTO)));
  if (link.index >= 0 && link.index <= max && textAt(link.index).includes(needle)) return link.index;

  let best = -1;
  for (let i = 0; i <= max; i++) {
    if (!textAt(i).includes(needle)) continue;
    if (best < 0 || Math.abs(i - at) < Math.abs(best - at)) best = i;
  }
  return best >= 0 ? best : at;
}

// `[label](modk://b/11)` → `label`. For surfaces that show a bare excerpt of a
// message (a thread preview, a share) where the link can't be tapped anyway.
const BLOCK_LINK_MD_RE = /\[([^\]]*)\]\(modk:\/\/b\/\d+(?:[-–]\d+)?\/?\)/gi;

export function stripBlockLinks(text: string): string {
  return text.replace(BLOCK_LINK_MD_RE, "$1");
}

/**
 * Like resolveBlockIndex, but returns null rather than guessing.
 *
 * resolveBlockIndex falls back to the requested index when the text cannot be
 * found, which is right for a deep link — landing near the right place beats
 * doing nothing. It is exactly wrong for a scheduled proposal: the fallback
 * would apply a rewrite to whatever paragraph now happens to sit at that
 * number. A miss here must mark the proposal stale instead.
 */
export function resolveBlockIndexStrict(
  blocks: DocBlockDTO[] | undefined,
  index: number,
  snippet: string,
): number | null {
  if (!blocks?.length) return null;
  const needle = normalize(snippet ?? "").slice(0, LABEL_HEAD).trim();
  if (needle.length < MIN_LABEL) return null;

  const max = blocks.length - 1;
  const textAt = (i: number) => normalize(blockSearchText(blocks[i] ?? ({} as DocBlockDTO)));

  // Index AND text agreeing is the strongest evidence available; a duplicate
  // elsewhere in the document does not weaken it.
  if (index >= 0 && index <= max && textAt(index).includes(needle)) return index;

  const hits: number[] = [];
  for (let i = 0; i <= max; i++) if (textAt(i).includes(needle)) hits.push(i);
  // Only the fallback search can be ambiguous — the hint has already failed, so
  // nothing is left to break a tie.
  return hits.length === 1 ? hits[0] : null;
}
