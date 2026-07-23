# AI Inline Autocomplete (Ghost Text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As the student types prose in a text block of the Lexical thesis writer, stream a document-aware, RAG-grounded AI continuation as grey ghost text after the caret; tap (or swipe) to accept, keep typing to dismiss; controllable via a Settings toggle.

**Architecture:** Web side (Lexical DOM editor) owns trigger detection + ghost rendering + accept/dismiss. Native side (`completion-store`) owns the Settings gate, context assembly, the abortable streaming fetch, and committing an accepted completion as an ordinary `editText` op. Server exposes `POST /api/thesis/:id/complete/stream`, which RAG-retrieves and streams a fast-model continuation. Ghost text is an inline **DecoratorNode** whose `getTextContent()` is `""`, so it is invisible to `$lexicalToBlocks` and never enters the saved document until accepted.

**Tech Stack:** Expo/React Native + Lexical (`'use dom'` DOM component), Zustand, `expo/fetch` streaming; Hono + Drizzle server, OpenRouter client, existing RAG (`src/lib/rag/*`), vitest (server only — the app has NO JS test runner, so app tasks verify with `npx tsc --noEmit` + on-device QA).

**Spec:** `docs/superpowers/specs/2026-07-23-ai-inline-autocomplete-design.md`

**Two repos:**
- App: `/Users/hamzasafwan/modakerati`
- Server: `/Users/hamzasafwan/modakerati-server`

**Git note:** the user runs concurrent sessions on this tree. `git add` the EXACT paths listed in each Commit step — never `git add -A`/`.`. Never `--amend`. Commit after every task.

---

## File Structure

**Server (`/Users/hamzasafwan/modakerati-server`):**
- Create `src/lib/ai/completion-prompt.ts` — pure prompt/context builder (`CompletionContext` type, `buildCompletionMessages`, `clampContext`). Unit-tested.
- Create `src/lib/ai/__tests__/completion-prompt.test.ts` — vitest tests for the above.
- Create `src/lib/rag/completion-context.ts` — `retrieveCompletionRag(thesisId, queryText, language)` best-effort RAG string (never throws).
- Modify `src/routes/thesis.ts` — add `POST /:id/complete/stream` route + `COMPLETION_SYSTEM_PROMPT`.

**App (`/Users/hamzasafwan/modakerati`):**
- Modify `stores/settings-store.ts` — add persisted `autocompleteEnabled` (default `true`) + migration.
- Modify `app/(app)/settings.tsx` — toggle row.
- Modify locale files — `settings.autocomplete` / `settings.autocompleteDesc` keys (ar/fr/en).
- Modify `lib/thesis-suggest.ts` — add `CompletionContext` + `proposeCompletionStream`.
- Create `stores/completion-store.ts` — context assembly, streaming, accept/cancel.
- Modify `components/workspace/lexical/blockLexical.tsx` — `GhostCompletionNode` (+ helpers) and confirm `$lexicalToBlocks` ignores it.
- Modify `components/workspace/lexical/LexicalDomEditor.tsx` — register the node, add completion props, add `CompletionPlugin`.
- Modify `components/workspace/WorkspaceLexicalView.tsx` — wire store ⇄ editor.

---

## PHASE 1 — Server: completion endpoint

### Task 1: Completion prompt/context builder (pure + tested)

**Files:**
- Create: `/Users/hamzasafwan/modakerati-server/src/lib/ai/completion-prompt.ts`
- Test: `/Users/hamzasafwan/modakerati-server/src/lib/ai/__tests__/completion-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/__tests__/completion-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCompletionMessages, clampContext, type CompletionContext } from "../completion-prompt";

const base: CompletionContext = {
  before: "على ما قدَّمه لي",
  precedingBlocks: ["إهداء", "صدق الله العظيم"],
  headingChain: ["الفصل الأول: منهجية البحث"],
  language: "ar",
  title: "المذكرة",
  discipline: "التدريب الرياضي",
};

describe("clampContext", () => {
  it("keeps the most recent preceding blocks within the char budget", () => {
    const many = Array.from({ length: 50 }, (_, i) => "x".repeat(100) + `#${i}`);
    const kept = clampContext(many, 250);
    // budget fits ~2 blocks of 103 chars; the LAST blocks are the nearest → kept
    expect(kept.length).toBeLessThan(50);
    expect(kept[kept.length - 1]).toContain("#49");
    expect(kept.join("").length).toBeLessThanOrEqual(250);
  });
  it("returns all blocks when under budget", () => {
    expect(clampContext(["a", "b"], 9999)).toEqual(["a", "b"]);
  });
});

describe("buildCompletionMessages", () => {
  it("puts the caret text last and asks to continue it", () => {
    const msgs = buildCompletionMessages(base, "");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    // the text-to-continue is the final line of the user prompt
    expect(msgs[1].content.trimEnd().endsWith(base.before)).toBe(true);
    // heading + language are present as grounding
    expect(msgs[1].content).toContain("الفصل الأول: منهجية البحث");
    expect(msgs[1].content).toContain("ar");
  });
  it("includes the RAG block when provided", () => {
    const msgs = buildCompletionMessages(base, "SOURCE-SNIPPET-XYZ");
    expect(msgs[1].content).toContain("SOURCE-SNIPPET-XYZ");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/lib/ai/__tests__/completion-prompt.test.ts`
Expected: FAIL — `Cannot find module '../completion-prompt'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ai/completion-prompt.ts`:

```ts
// Pure prompt/context builder for inline autocomplete (POST /:id/complete/stream).
// No I/O — unit-tested. The route wires this to the RAG string + the model client.

export interface CompletionContext {
  /** The current block's text up to the caret (caret is at end-of-block in v1). */
  before: string;
  /** A few preceding block texts, document order (nearest = last). */
  precedingBlocks: string[];
  /** Nearest heading chain, outermost first, e.g. ["Chapter 1", "1.2 Method"]. */
  headingChain: string[];
  /** Content-detected language tag, e.g. "ar" | "fr" | "en". */
  language: string;
  title?: string;
  discipline?: string;
}

export const COMPLETION_SYSTEM_PROMPT =
  "You are an inline writing autocomplete inside an academic thesis editor. " +
  "Continue the user's text in the SAME language, script, and academic register. " +
  "Output ONLY the continuation that directly follows the given text — no preamble, " +
  "no quotes, no markdown, and never repeat any of the given text. Write at most one " +
  "sentence (about 25 words). If there is nothing natural to add, output nothing.";

/** Keep the most recent (nearest) blocks whose joined length fits `budget` chars. */
export function clampContext(blocks: string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (used + b.length > budget) break;
    used += b.length;
    kept.unshift(b);
  }
  return kept;
}

/** Build the [system, user] chat messages. `ragBlock` is "" when RAG is empty. */
export function buildCompletionMessages(
  ctx: CompletionContext,
  ragBlock: string,
): { role: "system" | "user"; content: string }[] {
  const preceding = clampContext(ctx.precedingBlocks, 1500);
  const parts: string[] = [];
  parts.push(`Thesis: ${ctx.title ?? "(untitled)"}${ctx.discipline ? ` — ${ctx.discipline}` : ""}`);
  parts.push(`Language: ${ctx.language}`);
  if (ctx.headingChain.length) parts.push(`Section: ${ctx.headingChain.join(" › ")}`);
  if (ragBlock.trim()) parts.push(`Relevant sources & style norms:\n${ragBlock.trim()}`);
  if (preceding.length) parts.push(`Preceding text:\n${preceding.join("\n")}`);
  parts.push(
    "Continue the text below in the same language. Output ONLY the continuation:\n" + ctx.before,
  );
  return [
    { role: "system", content: COMPLETION_SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/lib/ai/__tests__/completion-prompt.test.ts`
Expected: PASS (5 assertions across 4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/ai/completion-prompt.ts src/lib/ai/__tests__/completion-prompt.test.ts
git commit -m "feat(thesis): pure prompt/context builder for inline autocomplete"
```

---

### Task 2: Best-effort RAG retrieval helper

**Files:**
- Create: `/Users/hamzasafwan/modakerati-server/src/lib/rag/completion-context.ts`
- Reference: `src/lib/rag/retrieval.ts` (`searchSourceChunks`, `searchThesisBlocks`, `searchKnowledge`), `src/lib/embedding-service.ts` (`embedText`), `src/lib/rag-context.ts` (`buildRagContextBlock`).

- [ ] **Step 1: Read the existing RAG surface so signatures match exactly**

Run: `cd /Users/hamzasafwan/modakerati-server && sed -n '1,60p' src/lib/rag/retrieval.ts && sed -n '40,80p' src/lib/rag-context.ts`
Expected: confirm `searchSourceChunks(thesisId, embedding, topK)`, `searchThesisBlocks(thesisId, embedding, topK)`, `searchKnowledge(embedding, language, topK)` return `{ content: string }`-bearing rows, and `buildRagContextBlock(input)` returns a string. Adjust the code below if the row field is named differently (e.g. `content` vs `text`).

- [ ] **Step 2: Write the implementation**

Create `src/lib/rag/completion-context.ts`:

```ts
import { embedText } from "../embedding-service";
import { searchSourceChunks, searchThesisBlocks, searchKnowledge } from "./retrieval";

// Best-effort RAG string for inline autocomplete. Kept LEAN (few chunks) to
// protect latency, and NEVER throws — autocomplete must not break on a RAG miss.
// Returns "" when there is nothing useful or on any error.
export async function retrieveCompletionRag(
  thesisId: string,
  queryText: string,
  language: string,
): Promise<string> {
  const q = queryText.trim();
  if (q.length < 12) return ""; // too little to ground a search on
  try {
    const embedding = await embedText(q);
    const [sources, blocks, norms] = await Promise.all([
      searchSourceChunks(thesisId, embedding, 2).catch(() => []),
      searchThesisBlocks(thesisId, embedding, 2).catch(() => []),
      searchKnowledge(embedding, language, 1).catch(() => []),
    ]);
    const lines = [...sources, ...blocks, ...norms]
      .map((h: any) => (typeof h?.content === "string" ? h.content.trim() : ""))
      .filter(Boolean)
      .slice(0, 4)
      .map((c: string) => `- ${c.replace(/\s+/g, " ").slice(0, 320)}`);
    return lines.join("\n");
  } catch {
    return "";
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit`
Expected: no errors. If `searchThesisBlocks`/`searchKnowledge` have a different arg order or row shape, fix the call/field names to match Step 1's findings, then re-run.

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/rag/completion-context.ts
git commit -m "feat(thesis): best-effort RAG context for inline autocomplete"
```

---

### Task 3: `POST /:id/complete/stream` route

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/routes/thesis.ts`
- Reference pattern: the `/:id/paragraphs/:index/suggest/stream` route in the same file (auth, `getProvider("openrouter").getClient()`, `streamText`, `suggestStreamSafe`, `X-Accel-Buffering`).

- [ ] **Step 1: Add imports for the new helpers**

At the top of `src/routes/thesis.ts`, near the other `../lib` imports, add:

```ts
import { buildCompletionMessages, type CompletionContext } from "../lib/ai/completion-prompt";
import { retrieveCompletionRag } from "../lib/rag/completion-context";
```

- [ ] **Step 2: Add the route**

Insert immediately AFTER the `/:id/paragraphs/:index/suggest/stream` route block (after its closing `});`, near line 804):

```ts
// Streaming INLINE AUTOCOMPLETE (live-docx, READ-ONLY, un-persisted). The app sends
// the in-flight editing context (the text before the caret + nearby blocks + heading
// chain + meta) — NOT read from the engine, because the newest keystrokes aren't
// saved yet. We RAG-retrieve a lean grounding block and stream a fast-model, ≤1
// sentence continuation as plain text (content-only; no THINK frame — speed). The
// app renders it as ghost text and, on accept, applies it via the normal editText op.
thesisRoutes.post("/:id/complete/stream", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<Partial<CompletionContext>>().catch(() => ({}) as Partial<CompletionContext>);
  const before = (body.before ?? "").toString();
  if (before.trim().length < 2) return c.json({ error: "before required" }, 400);
  const ctx: CompletionContext = {
    before,
    precedingBlocks: Array.isArray(body.precedingBlocks) ? body.precedingBlocks.filter((x): x is string => typeof x === "string") : [],
    headingChain: Array.isArray(body.headingChain) ? body.headingChain.filter((x): x is string => typeof x === "string") : [],
    language: typeof body.language === "string" ? body.language : "en",
    title: typeof body.title === "string" ? body.title : undefined,
    discipline: typeof body.discipline === "string" ? body.discipline : undefined,
  };

  // Ownership check only (cheap) — no thesis lock, no engine load (the context is
  // client-supplied in-flight text, and RAG only needs the thesis id + embeddings).
  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);

  const client = getProvider("openrouter").getClient?.();
  if (!client) return c.json({ error: "Completion unavailable" }, 502);
  // A FAST model, env-tunable (point it at Haiku or a Workers fast model). NOT the
  // heavy chat/rewrite model — autocomplete must feel near-instant.
  const model = process.env.OPENROUTER_COMPLETION_MODEL || "anthropic/claude-haiku-4.5";

  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache");

  return streamText(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    // RAG the recent context (best-effort — never throws). Query = caret text plus
    // the nearest preceding block, which is what the continuation must fit.
    const query = [ctx.precedingBlocks[ctx.precedingBlocks.length - 1] ?? "", ctx.before].join(" ").trim();
    const ragBlock = await retrieveCompletionRag(id, query, ctx.language);
    const messages = buildCompletionMessages(ctx, ragBlock);
    try {
      const completion = await client.chat.completions.create(
        { model, messages, temperature: 0.4, max_tokens: 120, stream: true },
        { signal: controller.signal },
      );
      for await (const chunk of completion) {
        const delta = chunk?.choices?.[0]?.delta as { content?: string | null } | undefined;
        const content = delta?.content || "";
        if (content) await stream.write(suggestStreamSafe(content)); // emoji-safe like /suggest/stream
      }
    } catch (e: any) {
      console.error("thesis completion stream failed:", id, e?.message ?? e);
      // End the stream empty — the app treats an empty completion as "no ghost".
    }
  });
});
```

- [ ] **Step 3: Typecheck + build**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit && npm run build`
Expected: no errors. (If `getProvider`, `streamText`, `suggestStreamSafe`, `db`, `theses`, `and`, `eq` are not already imported at that point in the file, they are — this route sits beside `/suggest/stream`, which uses all of them.)

- [ ] **Step 4: Smoke-test the stream (manual)**

Start the server (`npm run dev` in another shell). With a valid Supabase bearer for a live-docx thesis you own:

```bash
curl -N -X POST "http://localhost:$PORT/api/thesis/$THESIS_ID/complete/stream" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"before":"تُعدّ هذه الدراسة محاولةً لفهم","precedingBlocks":["إهداء"],"headingChain":["الفصل الأول"],"language":"ar","title":"المذكرة"}'
```
Expected: a short Arabic continuation streams back (no `[[MODK_THINK]]` frames, no repetition of the input). An empty response is acceptable if the model declines — that's the "no ghost" case.

- [ ] **Step 5: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/routes/thesis.ts
git commit -m "feat(thesis): POST /:id/complete/stream — RAG-grounded inline autocomplete"
```

---

## PHASE 2 — App: settings toggle

### Task 4: Persisted `autocompleteEnabled` setting

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/stores/settings-store.ts`

- [ ] **Step 1: Add the field, action, default, and migration**

In `stores/settings-store.ts`, extend `SettingsState`:

```ts
interface SettingsState {
  theme: ThemeName;
  language: Language;
  hasCompletedOnboarding: boolean;
  syncWhileEditing: boolean;
  // When TRUE (default) the Lexical Writer streams AI ghost-text completions as the
  // student types (see stores/completion-store). FALSE fully disables the feature —
  // no completion fetches, no ghost. Read by WorkspaceLexicalView (completionEnabled).
  autocompleteEnabled: boolean;
  setTheme: (theme: ThemeName) => void;
  setLanguage: (language: Language) => void;
  completeOnboarding: () => void;
  setSyncWhileEditing: (v: boolean) => void;
  setAutocompleteEnabled: (v: boolean) => void;
}
```

In the store body, add the default and setter (beside `syncWhileEditing`):

```ts
      autocompleteEnabled: true,
      setAutocompleteEnabled: (v) => set({ autocompleteEnabled: v }),
```

Bump the persist `version` to `2` and extend `migrate` so existing installs get the default:

```ts
      version: 2,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<SettingsState>;
        if (version < 1) return { ...s, syncWhileEditing: true, autocompleteEnabled: true } as SettingsState;
        if (version < 2) return { ...s, autocompleteEnabled: s.autocompleteEnabled ?? true } as SettingsState;
        return s as SettingsState;
      },
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add stores/settings-store.ts
git commit -m "feat(settings): persisted autocompleteEnabled flag (default on)"
```

---

### Task 5: Settings toggle row + i18n

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/app/(app)/settings.tsx`
- Modify: the three locale JSON files that hold `settings.syncWhileEditing`.

- [ ] **Step 1: Find the locale files and add the keys**

Run: `cd /Users/hamzasafwan/modakerati && grep -rln "syncWhileEditing" --include=*.json .`
Expected: three files (en/fr/ar). In EACH, next to the existing `settings.*` keys, add (translated per file):

- en: `"autocomplete": "AI text completion",` and `"autocompleteDesc": "Suggest the next words as you type",`
- fr: `"autocomplete": "Complétion IA du texte",` and `"autocompleteDesc": "Proposer la suite du texte pendant la saisie",`
- ar: `"autocomplete": "الإكمال التلقائي بالذكاء الاصطناعي",` and `"autocompleteDesc": "اقتراح الكلمات التالية أثناء الكتابة",`

(Match the existing nesting — if keys are flat like `"settings.syncWhileEditing"`, use `"settings.autocomplete"`; if nested under a `settings` object, add inside it.)

- [ ] **Step 2: Add the toggle row**

In `app/(app)/settings.tsx`, near the existing `syncWhileEditing` subscription (around line 54), add:

```ts
  const autocompleteEnabled = useSettingsStore((s) => s.autocompleteEnabled);
  const setAutocompleteEnabled = useSettingsStore((s) => s.setAutocompleteEnabled);
```

Then add a row in the same section that holds the `syncWhileEditing` / AI rows (near line 130–153). Use the `Sparkles` icon already imported for `aiSuggestionsSetting`:

```ts
        {
          icon: Sparkles, iconColor: colors.brandAccent, label: t("settings.autocomplete"),
          type: "toggle", toggleValue: autocompleteEnabled,
          onToggle: (v: boolean) => setAutocompleteEnabled(v),
        },
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add "app/(app)/settings.tsx" $(grep -rln "autocompleteDesc" --include=*.json .)
git commit -m "feat(settings): AI text-completion toggle row (ar/fr/en)"
```

---

## PHASE 3 — App: streaming client + store

### Task 6: `proposeCompletionStream` client

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/lib/thesis-suggest.ts`

- [ ] **Step 1: Add the context type and streaming client**

Append to `lib/thesis-suggest.ts` (it already has `expoFetch`, `getAuthHeader`, `unescapeUnicode`, `safeEscapeBoundary`):

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add lib/thesis-suggest.ts
git commit -m "feat(workspace): proposeCompletionStream client for inline autocomplete"
```

---

### Task 7: `completion-store`

**Files:**
- Create: `/Users/hamzasafwan/modakerati/stores/completion-store.ts`
- Reference: `stores/suggestion-store.ts` (streaming + isMine guard), `stores/thesis-doc-store.ts` (`mutate` with `editText`).

- [ ] **Step 1: Write the store**

Create `stores/completion-store.ts`:

```ts
import { create } from "zustand";
import { proposeCompletionStream, type CompletionContext } from "@/lib/thesis-suggest";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { DocBlockDTO } from "@/lib/api";

// One in-flight inline completion at a time. The editor's CompletionPlugin calls
// request({index,text}); we gate on the Settings toggle, assemble document context
// from the thesis doc store, stream the continuation, and expose it as {text,nonce}
// which WorkspaceLexicalView passes to the editor as the `completion` prop. Accept
// commits an editText op (coalesces with typing, syncs + undoes for free). A new
// request or cancel() aborts the previous fetch.

type Status = "idle" | "loading" | "done" | "error";

interface CompletionState {
  index: number;     // block being completed (-1 = none)
  text: string;      // streamed continuation so far
  status: Status;
  nonce: number;     // bumped per request; the editor keys the ghost on it
  controller: AbortController | null;
  request: (thesisId: string, index: number, text: string) => Promise<void>;
  accept: (thesisId: string, index: number, fullText: string) => void;
  cancel: () => void;
}

// Detect the block's language from its content (thesis.language is unreliable —
// imports default to "fr"). Arabic script ⇒ "ar"; otherwise fall back to the app
// language. Mirrors the RTL-from-content convention.
function detectLang(text: string): string {
  if (/[؀-ۿ]/.test(text)) return "ar";
  return useSettingsStore.getState().language;
}

// Plain text of a block for context (paragraph/heading/list/quote → text; others "").
function blockText(b: DocBlockDTO | undefined): string {
  if (!b) return "";
  if (b.kind === "paragraph") return b.text ?? "";
  return (b as any).text ?? "";
}

// The nearest heading chain above `index` (outermost first).
function headingChain(blocks: DocBlockDTO[], index: number): string[] {
  const chain: string[] = [];
  let wantLevel = Infinity;
  for (let i = index - 1; i >= 0 && chain.length < 3; i--) {
    const b = blocks[i] as any;
    const lvl = b?.kind === "heading" ? (b.level ?? 1) : 0;
    if (lvl > 0 && lvl < wantLevel) { chain.unshift(blockText(b)); wantLevel = lvl; }
  }
  return chain;
}

export const useCompletionStore = create<CompletionState>((set, get) => ({
  index: -1,
  text: "",
  status: "idle",
  nonce: 0,
  controller: null,

  request: async (thesisId, index, text) => {
    if (!useSettingsStore.getState().autocompleteEnabled) return;
    get().controller?.abort();
    const controller = new AbortController();
    const nonce = get().nonce + 1;
    set({ index, text: "", status: "loading", nonce, controller });

    const docStore = useThesisDocStore.getState();
    const doc = docStore.byId[thesisId];
    const blocks: DocBlockDTO[] = doc?.available ? doc.blocks : [];
    const preceding = blocks.slice(Math.max(0, index - 8), index).map(blockText).filter(Boolean);
    const ctx: CompletionContext = {
      before: text,
      precedingBlocks: preceding,
      headingChain: headingChain(blocks, index),
      language: detectLang(text),
      title: (doc as any)?.title,
    };

    // Only THIS request may write results (not aborted / superseded).
    const isMine = () => get().nonce === nonce && get().status === "loading";
    let acc = "";
    try {
      await proposeCompletionStream(thesisId, ctx, (delta) => {
        acc += delta;
        if (isMine()) set({ text: acc });
      }, controller.signal);
      if (isMine()) set({ text: acc.trim(), status: acc.trim() ? "done" : "error" });
    } catch {
      if (isMine()) set({ status: "error" });
    }
  },

  accept: (thesisId, index, fullText) => {
    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index, text: fullText });
    get().controller?.abort();
    set({ index: -1, text: "", status: "idle", controller: null });
  },

  cancel: () => {
    get().controller?.abort();
    set({ index: -1, text: "", status: "idle", controller: null });
  },
}));
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors. If `DocBlockDTO`'s paragraph variant field is not `text`, or `heading` uses a different level field, adjust `blockText`/`headingChain` to match `lib/api.ts` (grep `kind: "heading"` there). If `doc.title` lives elsewhere, drop the `title` line.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add stores/completion-store.ts
git commit -m "feat(workspace): completion-store — context assembly, streaming, accept/cancel"
```

---

## PHASE 4 — App: editor (ghost node + plugin + wiring)

### Task 8: `GhostCompletionNode`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/components/workspace/lexical/blockLexical.tsx`
- Reference: `$lexicalToBlocks` (line ~1177) and `SuggestionNode` (line ~910) in the same file.

- [ ] **Step 1: Confirm `$lexicalToBlocks` reads text via `getTextContent()`**

Run: `cd /Users/hamzasafwan/modakerati && sed -n '1177,1230p' components/workspace/lexical/blockLexical.tsx`
Expected: paragraph/heading text is read with `.getTextContent()`. An inline `DecoratorNode` contributes `""` to `getTextContent()`, so the ghost is auto-excluded — no change needed there. If instead it walks child `$isTextNode`s explicitly, add `&& !$isGhostCompletionNode(child)` to that filter.

- [ ] **Step 2: Add the node**

Add near the other node classes in `blockLexical.tsx` (import `DecoratorNode`, `NodeKey`, `LexicalEditor` are already imported for `BlockDataNode`/`SuggestionNode`; add `React` if not present — it is):

```ts
// Inline ghost text for AI autocomplete. A DecoratorNode whose getTextContent() is
// "" → invisible to $lexicalToBlocks / serialization / the block model, so it NEVER
// enters the saved document until accepted. Rendered grey after the caret; a tap (or
// a swipe in the writing direction) dispatches ACCEPT_COMPLETION_COMMAND. Streamed
// text lives in __text and is updated in place.
export const ACCEPT_COMPLETION_COMMAND: LexicalCommand<void> = createCommand("ACCEPT_COMPLETION");

export class GhostCompletionNode extends DecoratorNode<React.ReactNode> {
  __text: string;
  static getType(): string { return "ghost-completion"; }
  static clone(node: GhostCompletionNode): GhostCompletionNode { return new GhostCompletionNode(node.__text, node.__key); }
  constructor(text: string, key?: NodeKey) { super(key); this.__text = text; }
  isInline(): boolean { return true; }
  isKeyboardSelectable(): boolean { return false; }
  getTextContent(): string { return ""; } // invisible to the block model
  setText(text: string): void { this.getWritable().__text = text; }
  createDOM(): HTMLElement { const el = document.createElement("span"); el.style.display = "inline"; return el; }
  updateDOM(): boolean { return false; }
  decorate(editor: LexicalEditor): React.ReactNode {
    return React.createElement(GhostView, { text: this.getLatest().__text, editor });
  }
  exportJSON() { return { ...super.exportJSON(), type: "ghost-completion", version: 1 }; }
}

function GhostView({ text, editor }: { text: string; editor: LexicalEditor }) {
  const startX = React.useRef(0);
  const accept = () => editor.dispatchCommand(ACCEPT_COMPLETION_COMMAND, undefined);
  return React.createElement("span", {
    className: "lx-ghost",
    // Tap accepts. Prevent default so tapping the ghost doesn't move the caret.
    onMouseDown: (e: any) => { e.preventDefault(); },
    onClick: accept,
    onTouchStart: (e: any) => { startX.current = e.touches?.[0]?.clientX ?? 0; },
    onTouchEnd: (e: any) => {
      const endX = e.changedTouches?.[0]?.clientX ?? startX.current;
      // Swipe in the writing direction (RTL: leftward = negative) beyond 24px accepts.
      if (Math.abs(endX - startX.current) > 24) accept();
    },
  }, text);
}

export function $createGhostCompletionNode(text: string): GhostCompletionNode { return new GhostCompletionNode(text); }
export function $isGhostCompletionNode(node: unknown): node is GhostCompletionNode { return node instanceof GhostCompletionNode; }
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors. (`createCommand`, `LexicalCommand`, `DecoratorNode`, `NodeKey`, `LexicalEditor`, `React` are all already imported in this file for the existing nodes/commands — if `createCommand`/`LexicalCommand` aren't, add them to the `lexical` import.)

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/lexical/blockLexical.tsx
git commit -m "feat(workspace/lexical): GhostCompletionNode — inline ghost text, excluded from the block model"
```

---

### Task 9: `CompletionPlugin` + editor props

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/components/workspace/lexical/LexicalDomEditor.tsx`

- [ ] **Step 1: Register the node + import the ghost symbols**

In the `./blockLexical` import block, add `GhostCompletionNode, $createGhostCompletionNode, $isGhostCompletionNode, ACCEPT_COMPLETION_COMMAND`. Add `GhostCompletionNode` to `initialConfig.nodes` (the array at line ~1136). Add the ghost CSS to the `CSS` template string:

```css
.lx-ghost { color: #b3b3bd; cursor: pointer; -webkit-user-select: none; user-select: none; }
```

- [ ] **Step 2: Add the completion props to the component signature**

Add to the destructured props and the props type of `LexicalDomEditor` (near the other optional props, ~line 1085 and ~1128):

```ts
  completionEnabled,
  completion,
  onRequestCompletion,
  onCommitCompletion,
  onCancelCompletion,
```

```ts
  // AI inline autocomplete (ghost text). completionEnabled gates the plugin;
  // `completion` is the streamed continuation for the pending request; the callbacks
  // request / commit (accept) / cancel (dismiss) round-trip to the native store.
  completionEnabled?: boolean;
  completion?: { text: string; nonce: number; status: "idle" | "loading" | "done" | "error" };
  onRequestCompletion?: (ctx: { index: number; text: string }) => void;
  onCommitCompletion?: (index: number, fullText: string) => void;
  onCancelCompletion?: () => void;
```

- [ ] **Step 3: Add the plugin**

Add this component above `LexicalDomEditor` (near `SuggestionPlugin`):

```tsx
// AI inline autocomplete. Detects a collapsed caret at the END of a text block,
// debounces ~600ms, and asks native for a completion (onRequestCompletion). Streams
// the returned `completion.text` into a GhostCompletionNode after the caret. Any
// real edit / caret move / blur clears the ghost (onCancelCompletion). Tapping or
// swiping the ghost dispatches ACCEPT_COMPLETION_COMMAND → merge into real text +
// onCommitCompletion. Suppressed while a suggestion / range / table proposal shows.
function CompletionPlugin({
  enabled,
  completion,
  suppressed,
  onRequest,
  onCommit,
  onCancel,
}: {
  enabled?: boolean;
  completion?: { text: string; nonce: number; status: "idle" | "loading" | "done" | "error" };
  suppressed: boolean;
  onRequest?: (ctx: { index: number; text: string }) => void;
  onCommit?: (index: number, fullText: string) => void;
  onCancel?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingGhost = useRef(false); // our own ghost mutations must not self-clear
  const targetRef = useRef<{ index: number; text: string } | null>(null);

  const removeGhost = useCallback(() => {
    editor.update(() => {
      const g = $getRoot().getChildren().flatMap((n) => ("getChildren" in n ? (n as ElementNode).getChildren() : [])).find($isGhostCompletionNode);
      if (g) { applyingGhost.current = true; g.remove(); }
    }, { tag: "history-merge" });
  }, [editor]);

  // Detect caret-at-end-of-text-block + schedule a request.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, tags }) => {
      if (applyingGhost.current) { applyingGhost.current = false; return; } // ignore our own ghost writes
      // Any non-ghost update clears a showing ghost (typing / caret move dismisses).
      let hasGhost = false;
      editorState.read(() => {
        hasGhost = !!$getRoot().getChildren().some((n) => "getChildren" in n && (n as ElementNode).getChildren().some($isGhostCompletionNode));
      });
      if (hasGhost) { removeGhost(); onCancel?.(); }
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (!enabled || suppressed || tags.has(SKIP_DOM_SELECTION_TAG)) return;

      let target: { index: number; text: string } | null = null;
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
        const anchor = sel.anchor.getNode();
        if (!$isTextNode(anchor)) return;
        const top = anchor.getTopLevelElement();
        if (!top || !($isParagraphNode(top) || $isHeadingNode(top))) return;
        // caret at the very end of the block's text?
        const atNodeEnd = sel.anchor.offset === anchor.getTextContentSize();
        // "Last" ignoring a trailing ghost — so a keystroke that clears a showing
        // ghost still re-triggers a fresh completion on the same pause.
        const next = anchor.getNextSibling();
        const isLast = next == null || $isGhostCompletionNode(next);
        const text = top.getTextContent();
        if (!atNodeEnd || !isLast || text.trim().length < 2) return;
        target = { index: $blockIndexOfNode(anchor), text };
      });
      targetRef.current = target;
      if (!target) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (targetRef.current) onRequest?.(targetRef.current);
      }, 600);
    });
  }, [editor, enabled, suppressed, onRequest, onCancel, removeGhost]);

  // Render / stream the ghost from the `completion` prop.
  useEffect(() => {
    const t = targetRef.current;
    if (!enabled || suppressed || !completion || !completion.text || !t) return;
    editor.update(() => {
      const node = $nodeAtBlockIndex(t.index);
      if (!node) return;
      applyingGhost.current = true;
      const existing = node.getChildren().find($isGhostCompletionNode) as GhostCompletionNode | undefined;
      if (existing) existing.setText(completion.text);
      else node.append($createGhostCompletionNode(completion.text));
    }, { tag: "history-merge" });
  }, [editor, enabled, suppressed, completion?.nonce, completion?.text]);

  // Accept: merge ghost text into the block, place caret at end, commit to native.
  useEffect(() =>
    editor.registerCommand(
      ACCEPT_COMPLETION_COMMAND,
      () => {
        const t = targetRef.current;
        if (!t) return true;
        editor.update(() => {
          const node = $nodeAtBlockIndex(t.index);
          if (!node) return;
          const g = node.getChildren().find($isGhostCompletionNode) as GhostCompletionNode | undefined;
          if (!g) return;
          const ghostText = g.__text;
          applyingGhost.current = true;
          g.remove();
          // Append to the LAST real text node (v1 completes at end-of-block) so prior
          // inline runs/formatting in the block are preserved — do NOT rebuild the
          // whole block as one node (that would flatten bold/italic runs).
          const texts = node.getChildren().filter($isTextNode);
          const last = texts[texts.length - 1];
          if (last && $isTextNode(last)) { last.setTextContent(last.getTextContent() + ghostText); last.selectEnd(); }
          else { const tn = $createTextNode(ghostText); node.append(tn); tn.selectEnd(); }
          onCommit?.(t.index, node.getTextContent());
        }, { tag: SKIP_DOM_SELECTION_TAG });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),
  [editor, onCommit]);

  return null;
}
```

- [ ] **Step 4: Mount the plugin**

In `LexicalDomEditor`'s JSX (beside `<SuggestionPlugin .../>`), add:

```tsx
        <CompletionPlugin
          enabled={completionEnabled}
          completion={completion}
          suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal}
          onRequest={onRequestCompletion}
          onCommit={onCommitCompletion}
          onCancel={onCancelCompletion}
        />
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors. (`useRef`, `useCallback`, `useEffect`, `$getRoot`, `$getSelection`, `$isRangeSelection`, `$isTextNode`, `$isParagraphNode`, `$isHeadingNode`, `$createTextNode`, `SKIP_DOM_SELECTION_TAG`, `COMMAND_PRIORITY_LOW`, `ElementNode`, `$nodeAtBlockIndex`, `$blockIndexOfNode` are all already imported/defined in this file.)

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/lexical/LexicalDomEditor.tsx
git commit -m "feat(workspace/lexical): CompletionPlugin — detect, stream ghost text, accept/dismiss"
```

---

### Task 10: Wire the store into `WorkspaceLexicalView`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/components/workspace/WorkspaceLexicalView.tsx`

- [ ] **Step 1: Subscribe to the store + settings and derive the `completion` prop**

Add imports:

```ts
import { useCompletionStore } from "@/stores/completion-store";
```

Inside the component (near the other store subscriptions, ~line 131), add:

```ts
  const completionEnabled = useSettingsStore((s) => s.autocompleteEnabled);
  const compIndex = useCompletionStore((s) => s.index);
  const compText = useCompletionStore((s) => s.text);
  const compStatus = useCompletionStore((s) => s.status);
  const compNonce = useCompletionStore((s) => s.nonce);
  const completion = useMemo(
    () => (compIndex >= 0 ? { text: compText, nonce: compNonce, status: compStatus } : undefined),
    [compIndex, compText, compStatus, compNonce],
  );
```

- [ ] **Step 2: Add the callbacks**

Near `onSuggestAction` (~line 183):

```ts
  const onRequestCompletion = useCallback(
    (ctx: { index: number; text: string }) => { void useCompletionStore.getState().request(thesisId, ctx.index, ctx.text); },
    [thesisId],
  );
  const onCommitCompletion = useCallback(
    (index: number, fullText: string) => {
      // The editor already merged the ghost into the block in place — consume the
      // resulting doc change silently (no reseed / rebuild), mirroring suggestion approve.
      useLexicalEditorStore.getState().requestSkipReseed();
      useCompletionStore.getState().accept(thesisId, index, fullText);
    },
    [thesisId],
  );
  const onCancelCompletion = useCallback(() => { useCompletionStore.getState().cancel(); }, []);
```

- [ ] **Step 3: Pass the props to `<LexicalDomEditor>`**

Add to the `<LexicalDomEditor ... />` props (beside `onSuggestAction`, ~line 503):

```tsx
          completionEnabled={completionEnabled}
          completion={completion}
          onRequestCompletion={onRequestCompletion}
          onCommitCompletion={onCommitCompletion}
          onCancelCompletion={onCancelCompletion}
```

- [ ] **Step 4: Cancel any pending completion when leaving the Writer**

In the `active`-change effect (the `else if (!active && wasActive.current)` branch, ~line 239), add before/after `flushNow()`:

```ts
      useCompletionStore.getState().cancel();
```

- [ ] **Step 5: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(workspace): wire completion-store into the Lexical writer"
```

---

## PHASE 5 — Verification

### Task 11: Full typecheck, server tests, and device QA

**Files:** none (verification only).

- [ ] **Step 1: App typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Server typecheck + tests + build**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean; the `completion-prompt` suite passes; build succeeds.

- [ ] **Step 3: Device QA checklist** (real device — WebView + RTL behavior can't be judged in a simulator)

Run the app, open a thesis in the Lexical Writer (Settings → Developer → Lexical Lab, or the workspace Writer), and verify:
- [ ] Type a few words in an Arabic paragraph, pause ~0.6s → grey ghost continuation appears after the caret, streaming in, in the correct RTL flow.
- [ ] **Tap** the ghost → it becomes real text, caret at end, keyboard stays; the block persists after a sync (leave & re-enter the Writer).
- [ ] **Swipe** left across the ghost → same accept.
- [ ] Keep typing instead → ghost disappears immediately, no leftover text; the saved block never contains ghost text (leave & re-enter to confirm).
- [ ] Move the caret / tap elsewhere → ghost disappears.
- [ ] Undo after accept → removes the completed text (one step); undo without accepting never shows ghost artifacts.
- [ ] Settings → toggle **AI text completion OFF** → no ghost appears while typing, and (via network inspector or server logs) no `/complete/stream` requests fire. Toggle ON → it resumes.
- [ ] A per-block AI suggestion / range rewrite / table proposal is showing → no ghost competes with it.
- [ ] LTR (French/English) paragraph → completion appears and reads left-to-right.

- [ ] **Step 4: Commit (only if QA required code fixes)**

```bash
cd /Users/hamzasafwan/modakerati
git add <exact files changed during QA>
git commit -m "fix(workspace): inline autocomplete device-QA fixes"
```

---

## Notes / follow-ups (out of scope for v1)

- Word-by-word partial accept, mid-block completion, empty-block starters — deferred.
- If device latency disappoints: set `OPENROUTER_COMPLETION_MODEL` to a faster model, or drop RAG from the hot path (the route still works with `retrieveCompletionRag` returning "").
- If undo/redo shows ghost artifacts, the ghost mutations already use the `history-merge` tag; confirm that tag is honored by the app's `HistoryPlugin` and adjust if needed.
