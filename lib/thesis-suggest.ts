import { fetch as expoFetch } from "expo/fetch";
import { getAuthHeader } from "@/lib/api";

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

export interface SuggestStreamHandlers {
  /** A chunk of reasoning ("thinking") text. */
  onReasoning: (delta: string) => void;
  /** A chunk of the proposed rewrite (the visible answer). */
  onProposed: (delta: string) => void;
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
