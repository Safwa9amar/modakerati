import { fetch as expoFetch } from "expo/fetch";
import { getAuthHeader } from "@/lib/api";
import type { DocumentDTO, HistoryStateDTO } from "@/lib/api";

// Which unified action a suggestion applies on approval: rewrite a paragraph, or
// set a figure's caption. Mirrors the server's SuggestAction. New action kinds are
// added here + on the server's actionFrame (the [[MODK_ACTION:x]] header) + in the
// suggestion store's approve dispatch.
export type SuggestAction = "rewrite" | "setCaption";

// Ask the server to REWRITE a single paragraph per an instruction and return the
// proposed text WITHOUT applying it. The caller (suggestion-store) surfaces the
// result inline on the block so the student can approve / edit / reject / redo.
//
// Mirrors POST /api/thesis/:id/paragraphs/:index/suggest — Supabase bearer auth
// (getAuthHeader is the shared Authorization-only header helper in lib/api.ts).
export async function proposeBlockEdit(
  thesisId: string,
  index: number,
  instruction: string,
): Promise<{ proposed: string; original: string }> {
  const res = await fetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/paragraphs/${index}/suggest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ instruction }),
    },
  );
  if (!res.ok) throw new Error(`suggest ${res.status}`);
  return res.json();
}

// Ask the server for a FULL proposed table grid (+ optional layout) per an
// instruction, WITHOUT applying it. The caller (table-suggestion-store) diffs
// old vs new (lib/table-diff.ts) and shows the in-place diff; approval applies
// the diff as a tableOp batch. Mirrors POST /api/thesis/:id/table-suggest.
// Spec: docs/superpowers/specs/2026-07-23-ai-table-proposals-design.md
export interface TableSuggestResult {
  rows: string[][];
  layout?: { alignment?: "left" | "center" | "right"; direction?: "rtl" | "ltr"; headerRow?: boolean; borders?: boolean };
  original: { rows: string[][]; layout: { align: "left" | "center" | "right" | null; direction: "rtl" | "ltr"; header: boolean } };
}
export async function suggestTable(
  thesisId: string,
  index: number,
  instruction: string,
  signal?: AbortSignal,
): Promise<TableSuggestResult> {
  const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/table-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
    body: JSON.stringify({ index, instruction }),
    signal,
  });
  if (!res.ok) throw new Error(`table-suggest ${res.status}`);
  return res.json();
}

// Streaming variant — POST /api/thesis/:id/table-suggest/stream. The model's
// reasoning streams between the THINK frames (shown live on the dimmed table,
// like the paragraph inline suggestion); the proposed-table JSON streams as
// plain text after. The caller accumulates onProposed and parses the JSON at
// the end (falling back to the blocking suggestTable — which carries the server
// repair retry — when it doesn't parse). Same pump as proposeRangeRewriteStream.
export async function suggestTableStream(
  thesisId: string,
  index: number,
  instruction: string,
  handlers: { onReasoning: (delta: string) => void; onProposed: (delta: string) => void },
  signal?: AbortSignal,
): Promise<void> {
  const res = await expoFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/table-suggest/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
    body: JSON.stringify({ index, instruction }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`table-suggest stream ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = ""; // trailing partial \uXXXX escape held across a chunk boundary
  let mode: "answer" | "think" = "answer";
  let buf = ""; // unescaped text awaiting routing

  const pump = (chunk: string, isFinal: boolean) => {
    buf += chunk;
    while (true) {
      if (mode === "answer") {
        const ti = buf.indexOf(THINK_OPEN);
        if (ti === -1) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_OPEN]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onProposed(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const before = buf.slice(0, ti);
        if (before) handlers.onProposed(before);
        buf = buf.slice(ti + THINK_OPEN.length);
        mode = "think";
        continue;
      } else {
        const ci = buf.indexOf(THINK_CLOSE);
        if (ci === -1) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_CLOSE]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onReasoning(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const reason = buf.slice(0, ci);
        if (reason) handlers.onReasoning(reason);
        buf = buf.slice(ci + THINK_CLOSE.length);
        mode = "answer";
        continue;
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const cut = safeEscapeBoundary(pending);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      if (ready) pump(unescapeUnicode(ready), false);
    }
    pending += decoder.decode();
    pump(pending ? unescapeUnicode(pending) : "", true);
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Streaming variant — POST /api/thesis/:id/paragraphs/:index/suggest/stream.
// The server streams the model's REASONING between [[MODK_THINK]] … [[/MODK_THINK]]
// markers, then the rewritten paragraph as plain text after. This lets the inline
// card show the AI's thinking live in the collapsible ThinkingTrace widget while
// the rewrite is being drafted. Nothing is applied — approval still goes through
// the normal edit path. Uses `expo/fetch` (real streaming body), same as
// lib/api.ts's chat streaming.
// ---------------------------------------------------------------------------

// The server escapes emoji (astral chars) to \uXXXX because RN's native
// networking corrupts 4-byte UTF-8 mid-stream. Reverse it here (matches
// unescapeUnicode in lib/api.ts).
function unescapeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Index up to which `s` is safe to decode now — everything except a trailing
// partial \uXXXX (or lone backslash) that may complete in the next chunk.
function safeEscapeBoundary(s: string): number {
  const m = s.match(/\\(?:u[0-9a-fA-F]{0,3})?$/);
  return m && m.index !== undefined ? m.index : s.length;
}

// Reasoning region markers (must match the server / lib/ai/tool-loop.ts).
const THINK_OPEN = "[[MODK_THINK]]";
const THINK_CLOSE = "[[/MODK_THINK]]";

// Action header the server prepends as the stream's FIRST bytes, e.g.
// [[MODK_ACTION:setCaption]] — parsed + stripped here (mirrors the THINK framing).
const ACTION_PREFIX = "[[MODK_ACTION:";
const ACTION_RE = /^\[\[MODK_ACTION:(\w+)\]\]/;

export interface SuggestStreamHandlers {
  /** A chunk of reasoning ("thinking") text. */
  onReasoning: (delta: string) => void;
  /** A chunk of the proposed text (the visible answer — rewrite OR caption). */
  onProposed: (delta: string) => void;
  /** The action the server chose (from the [[MODK_ACTION:x]] header), fired once
   *  before any proposed/reasoning text. Absent header (older server) → rewrite. */
  onAction?: (action: SuggestAction) => void;
}

// How many trailing chars of `s` to hold back because they may be the start of a
// marker that completes in the next chunk (so a split marker is never emitted as
// visible text). Mirrors lib/api.ts's postChatStream, trimmed to the two THINK
// markers this endpoint uses.
function heldLen(s: string, markers: string[]): number {
  let max = 0;
  for (const m of markers) {
    for (let k = Math.min(m.length - 1, s.length); k > 0; k--) {
      if (s.endsWith(m.slice(0, k))) {
        if (k > max) max = k;
        break;
      }
    }
  }
  return max;
}

export async function proposeBlockEditStream(
  thesisId: string,
  index: number,
  instruction: string,
  handlers: SuggestStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await expoFetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/paragraphs/${index}/suggest/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ instruction }),
      signal,
    },
  );
  if (!res.ok || !res.body) throw new Error(`suggest stream ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // Holds a trailing partial \uXXXX escape that straddles a chunk boundary until
  // the rest arrives, so an emoji is never decoded half-formed.
  let pending = "";
  let mode: "answer" | "think" = "answer";
  let buf = ""; // unescaped text awaiting routing
  // The [[MODK_ACTION:x]] header is stripped once, before any content routing. Held
  // back until complete so a chunk-split header is never emitted as visible text.
  let actionParsed = false;

  const pump = (chunk: string, isFinal: boolean) => {
    buf += chunk;
    if (!actionParsed) {
      const m = buf.match(ACTION_RE);
      if (m) {
        actionParsed = true;
        handlers.onAction?.(m[1] === "setCaption" ? "setCaption" : "rewrite");
        buf = buf.slice(m[0].length);
      } else if (!isFinal && (ACTION_PREFIX.startsWith(buf) || buf.startsWith(ACTION_PREFIX))) {
        // A partial header still arriving (buf is a prefix of the marker, or has the
        // full prefix but not the closing "]]" yet) → wait for more bytes.
        return;
      } else {
        // No action header (older server) or an incomplete one at stream end →
        // default to rewrite and route buf as normal content.
        actionParsed = true;
      }
    }
    while (true) {
      if (mode === "answer") {
        const ti = buf.indexOf(THINK_OPEN);
        if (ti === -1) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_OPEN]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onProposed(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const before = buf.slice(0, ti);
        if (before) handlers.onProposed(before);
        buf = buf.slice(ti + THINK_OPEN.length);
        mode = "think";
        continue;
      } else {
        const ci = buf.indexOf(THINK_CLOSE);
        if (ci === -1) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_CLOSE]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onReasoning(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const reason = buf.slice(0, ci);
        if (reason) handlers.onReasoning(reason);
        buf = buf.slice(ci + THINK_CLOSE.length);
        mode = "answer";
        continue;
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const cut = safeEscapeBoundary(pending);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      if (ready) pump(unescapeUnicode(ready), false);
    }
    pending += decoder.decode();
    pump(pending ? unescapeUnicode(pending) : "", true);
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Range rewrite — POST /api/thesis/:id/blocks/rewrite-range/stream (READ-ONLY).
// Rewrites a CONTIGUOUS range of paragraph blocks into a DYNAMIC number of new
// paragraphs: the model decides whether the passage becomes one big paragraph or
// several, based on the instruction + content (e.g. "summarize" may collapse to
// one, "expand" may produce several). Same THINK-framed stream as the per-block
// suggest above, minus the action header (always a rewrite). The proposed passage
// streams as plain text with paragraphs separated by BLANK LINES; the caller splits
// on blank lines. Nothing is applied — approval goes through applyThesisRangeReplace.
// ---------------------------------------------------------------------------
export interface RangeRewriteHandlers {
  /** A chunk of reasoning ("thinking") text. */
  onReasoning: (delta: string) => void;
  /** A chunk of the proposed passage text. */
  onProposed: (delta: string) => void;
}

export async function proposeRangeRewriteStream(
  thesisId: string,
  indices: number[],
  instruction: string,
  handlers: RangeRewriteHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await expoFetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/blocks/rewrite-range/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ indices, instruction }),
      signal,
    },
  );
  if (!res.ok || !res.body) throw new Error(`rewrite-range stream ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = ""; // trailing partial \uXXXX escape held across a chunk boundary
  let mode: "answer" | "think" = "answer";
  let buf = ""; // unescaped text awaiting routing

  const pump = (chunk: string, isFinal: boolean) => {
    buf += chunk;
    while (true) {
      if (mode === "answer") {
        const ti = buf.indexOf(THINK_OPEN);
        if (ti === -1) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_OPEN]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onProposed(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const before = buf.slice(0, ti);
        if (before) handlers.onProposed(before);
        buf = buf.slice(ti + THINK_OPEN.length);
        mode = "think";
        continue;
      } else {
        const ci = buf.indexOf(THINK_CLOSE);
        if (ci === -1) {
          const hold = isFinal ? 0 : heldLen(buf, [THINK_CLOSE]);
          const out = buf.slice(0, buf.length - hold);
          if (out) handlers.onReasoning(out);
          buf = buf.slice(buf.length - hold);
          break;
        }
        const reason = buf.slice(0, ci);
        if (reason) handlers.onReasoning(reason);
        buf = buf.slice(ci + THINK_CLOSE.length);
        mode = "answer";
        continue;
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const cut = safeEscapeBoundary(pending);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      if (ready) pump(unescapeUnicode(ready), false);
    }
    pending += decoder.decode();
    pump(pending ? unescapeUnicode(pending) : "", true);
  } finally {
    reader.releaseLock();
  }
}

// Apply an approved range rewrite: replace blocks [start..end] with `paragraphs`
// (dynamic count). The server deletes the old range, writes the new paragraphs
// (inheriting the first block's style/direction/alignment), and echoes the mutated
// document so the doc store reconciles. Mirrors setThesisFigureCaption's plain-fetch
// + Supabase-bearer style.
export async function applyThesisRangeReplace(
  thesisId: string,
  start: number,
  end: number,
  paragraphs: string[],
): Promise<{ ok: true; document?: DocumentDTO; history?: HistoryStateDTO }> {
  const res = await fetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/blocks/replace-range`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ start, end, paragraphs }),
    },
  );
  if (!res.ok) throw new Error(`replace-range ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Set (or create) a figure/image block's caption — POST /api/thesis/:id/blocks/
// :index/caption. Applies the approved `setCaption` action; the server edits the
// caption body paragraph following the image (or inserts one) and echoes the
// mutated document so the doc store reconciles. Lives here (not lib/api.ts)
// alongside the suggestion streaming it belongs to. `index` is the IMAGE block's
// engine index. Mirrors the plain-fetch + Supabase-bearer style of the other
// live-docx edit calls.
// ---------------------------------------------------------------------------
export async function setThesisFigureCaption(
  thesisId: string,
  index: number,
  caption: string,
): Promise<{ ok: true; document?: DocumentDTO; history?: HistoryStateDTO }> {
  const res = await fetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/blocks/${index}/caption`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify({ caption }),
    },
  );
  if (!res.ok) throw new Error(`caption ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Inline autocomplete — POST /api/thesis/:id/complete/stream (READ-ONLY).
// Streams a short continuation of the in-flight block text as PLAIN text (no THINK
// framing — completion is answer-only). Context is the caret text + nearby blocks +
// heading chain + meta, assembled by the completion-store. Same emoji-safe unescape
// + chunk-boundary hold as the other streams. Aborted on every keystroke.
// ---------------------------------------------------------------------------
export interface CompletionContext {
  before: string;
  precedingBlocks: string[];
  headingChain: string[];
  language: string;
  title?: string;
  discipline?: string;
}

export async function proposeCompletionStream(
  thesisId: string,
  ctx: CompletionContext,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await expoFetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/thesis/${thesisId}/complete/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeader()) },
      body: JSON.stringify(ctx),
      signal,
    },
  );
  if (!res.ok || !res.body) throw new Error(`complete stream ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = ""; // trailing partial \uXXXX escape held across a chunk boundary
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const cut = safeEscapeBoundary(pending);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      if (ready) onDelta(unescapeUnicode(ready));
    }
    pending += decoder.decode();
    if (pending) onDelta(unescapeUnicode(pending));
  } finally {
    reader.releaseLock();
  }
}
