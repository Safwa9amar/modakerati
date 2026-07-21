# Document Search (Find & Replace + Semantic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A top-pinned search panel in the thesis workspace: instant exact find & replace over the in-memory blocks (Arabic-aware, offline, via the durable op queue) plus "Search by meaning" semantic search through a new server route over the existing RAG block index.

**Architecture:** Pure matching logic lives in `lib/text-normalize.ts` + `lib/search-match.ts` (offset-mapped Arabic folding so normalized matches map back to original-text spans). UI state in a new `stores/search-store.ts`; `SearchPanel` renders under the workspace header and drives everything; `DocBlock` renders amber highlight spans; jumps reuse `requestScrollToBlock`. Replace enqueues `editText` ops (paragraphs only — table/caption hits are jump-only). The server adds `GET /api/thesis/:id/search` wrapping `searchThesisBlocks` (pgvector over `thesis_block_chunks`, hits already carry engine `blockIndex`).

**Tech Stack:** React Native (Expo v56 — read https://docs.expo.dev/versions/v56.0.0/ before deviating), zustand, lucide-react-native, i18n en/fr/ar; server: Hono + Drizzle + pgvector (repo `~/modakerati-server`).

**Spec:** `docs/superpowers/specs/2026-07-21-document-search-design.md`

**Verification note:** The app has NO JS test runner (do not add jest). Pure logic is verified with a scratch `npx -y tsx` script; everything else gates on `npx tsc --noEmit` + the final on-device QA list. TWO repos are touched: app (`~/modakerati`) and server (`~/modakerati-server`) — commit in the repo you edited.

**Commit policy (both trees are DIRTY with the user's parallel work):** before each commit run `git status --porcelain -- <files>`. Stage ONLY files that were clean before this task (new files, or tracked files with no pre-existing modifications). A file that already carried user WIP (modified `M` or untracked `??` before your edit): APPLY the edits but DO NOT stage or commit it — the user commits it with their WIP; list every such file in the Task 8 report. Never `git add -A`, never `git add -p` (interactive — unsupported), never `--amend`; re-check `git status` after any interruption.

---

### Task 1: Shared Arabic-aware normalizer + match engine

**Files:**
- Create: `lib/text-normalize.ts`
- Create: `lib/search-match.ts`
- Modify: `components/workspace/ThesisOutlinePanel.tsx:21-32` (use the shared normalize)
- Scratch: `<scratchpad>/verify-search.ts` (throwaway verification script — NOT committed)

- [ ] **Step 1: Create `lib/text-normalize.ts`**

```ts
// Fold case + Arabic orthographic variants so search matches regardless of
// tashkeel, tatweel, or alef/ya/ta-marbuta spelling. Extracted from
// ThesisOutlinePanel so document search shares one folding.

// Characters the fold removes entirely: Arabic tashkeel (U+064B–U+0652,
// U+0670 superscript alef) and tatweel (U+0640).
const REMOVED = /[ً-ْٰـ]/;

function foldChar(ch: string): string {
  if (REMOVED.test(ch)) return "";
  if (/[أإآٱ]/.test(ch)) return "ا";
  if (/[ىئ]/.test(ch)) return "ي";
  if (ch === "ؤ") return "و";
  if (ch === "ة") return "ه";
  return ch.toLowerCase();
}

/** Plain fold (query side / outline heading filter): fold + trim. */
export function normalize(s: string): string {
  return normalizeWithMap(s).norm.trim();
}

/**
 * Fold `s` while recording, for every folded character, the index of the
 * ORIGINAL character it came from — so a match found in `norm` maps back to a
 * span in the original string (for highlighting and replace). `map[i]` is the
 * original index of `norm[i]`. NOT trimmed (offsets must hold).
 */
export function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const folded = foldChar(s[i]);
    for (const ch of folded) {
      // toLowerCase can emit >1 char (e.g. İ) — each maps to the same original.
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}
```

- [ ] **Step 2: Create `lib/search-match.ts`**

Note the RELATIVE `./text-normalize` import (same directory) — it lets the
scratch script in Step 4 run under tsx, which can't resolve the `@/` alias.
The `@/lib/api` import is type-only, so tsx erases it.

```ts
import type { DocBlockDTO } from "@/lib/api";
import { normalize, normalizeWithMap } from "./text-normalize";

/** One exact hit: a span in the ORIGINAL text of block `blockIndex`. For
 * table/image blocks the span indexes the flattened text and is unused (those
 * hits are jump-only — no highlight, no replace). */
export type SearchMatch = {
  blockIndex: number;
  start: number;
  end: number;
  kind: DocBlockDTO["kind"];
};

export const MIN_QUERY = 2; // 1-char queries are noise (thousands of hits)
export const MAX_MATCHES = 500; // perf guard; the counter shows "500+" when hit

/** The searchable text of a block (same extraction as GlobalDockBar's textOf). */
export function blockSearchText(b: DocBlockDTO): string {
  if (b.kind === "paragraph") return b.text;
  if (b.kind === "image") return b.caption ?? "";
  if (b.kind === "table") return b.rows.flat().join(" ");
  return "";
}

export function computeMatches(
  blocks: DocBlockDTO[],
  rawQuery: string,
): { matches: SearchMatch[]; capped: boolean } {
  const q = normalize(rawQuery);
  if (q.length < MIN_QUERY) return { matches: [], capped: false };
  const matches: SearchMatch[] = [];
  for (const b of blocks) {
    const text = blockSearchText(b);
    if (!text) continue;
    const { norm, map } = normalizeWithMap(text);
    let from = 0;
    while (true) {
      const j = norm.indexOf(q, from);
      if (j === -1) break;
      const start = map[j];
      // End extends to the start of the NEXT normalized char, so trailing
      // folded-away diacritics stay inside the span (replace must eat them).
      const end = j + q.length < map.length ? map[j + q.length] : text.length;
      matches.push({ blockIndex: b.index, start, end, kind: b.kind });
      from = j + q.length;
      if (matches.length >= MAX_MATCHES) return { matches, capped: true };
    }
  }
  return { matches, capped: false };
}
```

- [ ] **Step 3: Switch `ThesisOutlinePanel.tsx` to the shared normalize**

Delete the local `normalize` function (lines 21-32, the block starting with the
`// Fold case + Arabic orthographic variants` comment) and add to the imports:

```ts
import { normalize } from "@/lib/text-normalize";
```

Behavior is identical (fold + trim); nothing else in the file changes.

- [ ] **Step 4: Write and run the scratch verification script**

Write `<scratchpad>/verify-search.ts` (scratchpad path is in the session
system prompt; adjust the absolute repo path if the repo lives elsewhere):

```ts
import { normalize, normalizeWithMap } from "/Users/hamzasafwan/modakerati/lib/text-normalize";
import { computeMatches } from "/Users/hamzasafwan/modakerati/lib/search-match";

const assert = (cond: boolean, label: string) => {
  if (!cond) {
    console.error("FAIL:", label);
    process.exit(1);
  }
  console.log("ok:", label);
};

// 1. Case folding (accents preserved, case dropped)
assert(normalize("MÉTHodologie") === "méthodologie", "lowercase");

// 2. Arabic diacritics fold away, ta-marbuta folds to ha
const src = "المُقَدِّمَةُ العامة";
const { norm } = normalizeWithMap(src);
assert(norm === "المقدمه العامه", "tashkeel stripped + ta-marbuta folded");

// 3. Span maps back over diacritics
const blocks = [
  { index: 3, kind: "paragraph", text: src, styleId: null, level: 0, alignment: null, direction: null },
] as any[];
const r = computeMatches(blocks, "مقدمة");
assert(r.matches.length === 1, "one hit");
const m = r.matches[0];
assert(src.slice(m.start, m.end) === "مُقَدِّمَةُ", "span covers the diacritic'd original");

// 4. Replace through the span keeps surrounding text intact
assert(src.slice(0, m.start) + "تمهيد" + src.slice(m.end) === "التمهيد العامة", "splice replace");

// 5. Cross-kind matching, ordering, min length
const blocks2 = [
  { index: 0, kind: "paragraph", text: "alpha beta alpha", styleId: null, level: 0, alignment: null, direction: null },
  { index: 1, kind: "table", rows: [["alpha", "x"], ["y", "z"]] },
  { index: 2, kind: "image", caption: "Alpha chart" },
] as any[];
const r2 = computeMatches(blocks2, "ALPHA");
assert(r2.matches.length === 4, "4 case-insensitive hits across kinds");
assert(r2.matches[0].blockIndex === 0 && r2.matches[0].start === 0, "ordering");
assert(computeMatches(blocks2, "a").matches.length === 0, "min query length 2");
console.log("ALL PASS");
```

Run: `cd /Users/hamzasafwan/modakerati && npx -y tsx <scratchpad>/verify-search.ts`
Expected: five+ `ok:` lines then `ALL PASS`. If any FAIL, fix the lib — do not
weaken the assertion.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no NEW errors (the tree is a WIP — compare against `git stash`-free
baseline only if errors appear; our three files must be error-free).

- [ ] **Step 6: Commit (app repo)**

`ThesisOutlinePanel.tsx` is expected to be user WIP (untracked at planning
time) — per the commit policy, edit it but do NOT stage it; the two new lib
files are ours:

```bash
cd /Users/hamzasafwan/modakerati
git add lib/text-normalize.ts lib/search-match.ts
git commit -m "feat(workspace): Arabic-aware normalizer with offset map + document match engine

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Search store

**Files:**
- Create: `stores/search-store.ts`

- [ ] **Step 1: Create `stores/search-store.ts`**

Rules baked in: per-block match arrays are rebuilt ONLY inside `setMatches`, so
`s.matchesByBlock[i]` selectors stay `Object.is`-stable (zustand selector-loop
rule); `current` clamps on every recompute.

```ts
import { create } from "zustand";
import type { SearchMatch } from "@/lib/search-match";

export type SemanticHit = {
  blockIndex: number;
  headingPath: string | null;
  snippet: string;
  score: number;
};

interface SearchState {
  open: boolean;
  query: string;
  replaceText: string;
  replaceOpen: boolean;
  matches: SearchMatch[];
  // matches grouped per block — rebuilt ONLY in setMatches so per-block array
  // refs stay stable across unrelated updates (DocBlock selects one entry).
  matchesByBlock: Record<number, SearchMatch[]>;
  capped: boolean;
  current: number; // index into matches; -1 = none
  semantic: SemanticHit[] | null; // null = not run yet for this query
  semanticLoading: boolean;
  semanticError: boolean;
  semanticIndexing: boolean; // server said the RAG index is (re)building

  openSearch: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  setReplaceText: (t: string) => void;
  toggleReplace: () => void;
  setMatches: (matches: SearchMatch[], capped: boolean) => void;
  setCurrent: (i: number) => void;
  semanticStart: () => void;
  semanticDone: (hits: SemanticHit[], indexing: boolean) => void;
  semanticFail: () => void;
}

const INITIAL = {
  open: false,
  query: "",
  replaceText: "",
  replaceOpen: false,
  matches: [] as SearchMatch[],
  matchesByBlock: {} as Record<number, SearchMatch[]>,
  capped: false,
  current: -1,
  semantic: null as SemanticHit[] | null,
  semanticLoading: false,
  semanticError: false,
  semanticIndexing: false,
};

export const useSearchStore = create<SearchState>((set) => ({
  ...INITIAL,

  openSearch: () => set({ open: true }),

  // Full reset — closing must leave zero highlight/replace state behind.
  close: () => set(INITIAL),

  // A new query invalidates any semantic results shown for the old one.
  setQuery: (q) =>
    set({ query: q, semantic: null, semanticError: false, semanticIndexing: false }),

  setReplaceText: (t) => set({ replaceText: t }),

  toggleReplace: () => set((s) => ({ replaceOpen: !s.replaceOpen })),

  setMatches: (matches, capped) =>
    set((s) => {
      const byBlock: Record<number, SearchMatch[]> = {};
      for (const m of matches) (byBlock[m.blockIndex] ??= []).push(m);
      const current =
        matches.length === 0 ? -1 : Math.min(Math.max(s.current, 0), matches.length - 1);
      return { matches, matchesByBlock: byBlock, capped, current };
    }),

  setCurrent: (i) => set({ current: i }),

  semanticStart: () =>
    set({ semanticLoading: true, semanticError: false, semanticIndexing: false }),

  semanticDone: (hits, indexing) =>
    set({ semantic: hits, semanticLoading: false, semanticIndexing: indexing }),

  semanticFail: () => set({ semanticLoading: false, semanticError: true }),
}));
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit (app repo)**

```bash
cd /Users/hamzasafwan/modakerati
git add stores/search-store.ts
git commit -m "feat(workspace): search store — exact matches, current-hit cursor, semantic results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Server route `GET /api/thesis/:id/search`

**Files (SERVER repo `/Users/hamzasafwan/modakerati-server`):**
- Modify: `src/routes/thesis.ts:4` (imports) and after the `/:id/outline` route (~line 209)

- [ ] **Step 1: Capture the typecheck baseline**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit 2>&1 | tail -5`
Note any PRE-EXISTING errors (the tree is a user WIP) — Step 4 must not add new ones.

- [ ] **Step 2: Add imports**

In `src/routes/thesis.ts` change line 4:

```ts
import { db, pool, theses, sections, chapters, normProfiles, profiles } from "../db";
```

(`pool` is already exported from `../db` — `src/lib/rag/retrieval.ts` imports it.)
Then add two imports next to the existing `scheduleReconcileFromStorage` import (line ~17):

```ts
import { searchThesisBlocks } from "../lib/rag/retrieval";
import { embedText } from "../lib/embedding-service";
```

- [ ] **Step 3: Add the route directly AFTER the `/:id/outline` handler (after its closing `});`, ~line 209)**

```ts
// Semantic in-document search: embed the query and cosine-search the thesis's
// RAG block index (thesis_block_chunks — chunks carry the engine block index,
// so hits map straight onto DocumentDTO block indices / requestScrollToBlock).
// Mirrors getRagContext's lazy backfill: an empty index on a live thesis
// schedules a background (re)build and reports { indexing: true } as a hint.
thesisRoutes.get("/:id/search", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ error: "q required" }, 400);
  const kRaw = Number(c.req.query("k") ?? 8);
  const k = Number.isFinite(kRaw) ? Math.min(Math.max(Math.trunc(kRaw), 1), 20) : 8;
  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  try {
    const embedding = await embedText(q);
    const hits = await searchThesisBlocks(id, embedding, k);
    let indexing = false;
    if (hits.length === 0 && thesis.docMode === "live-docx" && thesis.docPath) {
      const { rows } = await pool.query(
        `SELECT status, updated_at FROM thesis_index_state WHERE thesis_id = $1`,
        [id],
      );
      const stale =
        rows.length > 0 &&
        rows[0].status !== "ready" &&
        Date.now() - new Date(rows[0].updated_at).getTime() > 10 * 60 * 1000;
      if (rows.length === 0 || stale) {
        scheduleReconcileFromStorage(id, thesis.docPath);
        indexing = true;
      } else if (rows[0].status !== "ready") {
        indexing = true;
      }
    }
    return c.json({
      results: hits.map((h) => ({
        blockIndex: h.blockIndex,
        headingPath: h.headingPath ?? null,
        snippet: String(h.content ?? "").slice(0, 200),
        score: Number(h.score),
      })),
      indexing,
    });
  } catch (e: any) {
    console.error("thesis semantic search failed:", id, e?.message ?? e);
    return c.json({ error: "Search failed" }, 500);
  }
});
```

- [ ] **Step 4: Typecheck against the baseline**

Run: `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit 2>&1 | tail -5`
Expected: identical to Step 1's output (no new errors).

- [ ] **Step 5: (If the local stack is running) smoke the route**

Only if the local server + Supabase are already up — do not start them for this.
With a valid `$TOKEN` and thesis `$TID`:
`curl -s "http://localhost:3000/api/thesis/$TID/search?q=methodologie" -H "Authorization: Bearer $TOKEN"`
Expected shape: `{"results":[{"blockIndex":…,"headingPath":…,"snippet":…,"score":…}],"indexing":false}`
(or `results: []` + `indexing: true` on an unindexed thesis). Skip freely if the
stack is down — the device QA in Task 8 covers it.

- [ ] **Step 6: Commit (SERVER repo — commit policy applies)**

Check `git status --porcelain -- src/routes/thesis.ts` BEFORE editing (Step 2).
If it was clean, commit; if it already carried WIP, leave it uncommitted and
list it in the Task 8 report.

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/routes/thesis.ts
git commit -m "feat(thesis): GET /:id/search — semantic block search over the RAG index

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: App API client

**Files:**
- Modify: `lib/api.ts` (insert after `getThesisOutline`, ~line 654)

- [ ] **Step 1: Add the type + function**

```ts
// Semantic in-document search ("search by meaning"): the server embeds `q` and
// cosine-searches the thesis's RAG block index. `blockIndex` is the engine
// block index — feed it straight to requestScrollToBlock. `indexing: true`
// means the index is (re)building in the background; try again shortly.
export type ThesisSearchHit = {
  blockIndex: number;
  headingPath: string | null;
  snippet: string;
  score: number;
};
export async function searchThesisSemantic(
  id: string,
  q: string,
  k = 8,
): Promise<{ results: ThesisSearchHit[]; indexing?: boolean }> {
  return apiGet(`/api/thesis/${id}/search?q=${encodeURIComponent(q)}&k=${k}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit — likely NONE (commit policy)**

`lib/api.ts` is expected to already carry user WIP (`M` at planning time). Per
the commit policy: apply the edit, do NOT stage it, and record `lib/api.ts` for
the Task 8 report. Only if `git status --porcelain -- lib/api.ts` was clean
before this task, commit it alone:

```bash
cd /Users/hamzasafwan/modakerati
git add lib/api.ts
git commit -m "feat(workspace): searchThesisSemantic API client

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: SearchPanel component + i18n strings

**Files:**
- Create: `components/workspace/SearchPanel.tsx`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Create `components/workspace/SearchPanel.tsx`**

```tsx
import { useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Search, X, ChevronUp, ChevronDown, Replace, Sparkles } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useSearchStore } from "@/stores/search-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { computeMatches } from "@/lib/search-match";
import { searchThesisSemantic, type DocBlockDTO } from "@/lib/api";
import { hSelection } from "@/lib/haptics";

/**
 * Top-pinned document search (find & replace + semantic), rendered directly
 * under the workspace header so it survives keyboard dismissal (the dock bar
 * doesn't). Exact matching is fully client-side over the in-memory blocks;
 * "Search by meaning" flushes the op queue (AI-turn rule: never query a stale
 * server doc) then hits GET /api/thesis/:id/search. Writer view only — the
 * openers close any docx/PDF preview, and opening a preview closes the panel.
 */
export function SearchPanel({ thesisId, blocks }: { thesisId: string; blocks: DocBlockDTO[] }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();

  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const replaceOpen = useSearchStore((s) => s.replaceOpen);
  const replaceText = useSearchStore((s) => s.replaceText);
  const matchCount = useSearchStore((s) => s.matches.length);
  const capped = useSearchStore((s) => s.capped);
  const current = useSearchStore((s) => s.current);
  // Stable ref: the array element itself, not a fresh object.
  const cur = useSearchStore((s) => s.matches[s.current] ?? null);
  const semantic = useSearchStore((s) => s.semantic);
  const semanticLoading = useSearchStore((s) => s.semanticLoading);
  const semanticError = useSearchStore((s) => s.semanticError);
  const semanticIndexing = useSearchStore((s) => s.semanticIndexing);
  const previewMode = useWorkspaceStore((s) => s.previewMode);

  const inputRef = useRef<TextInput>(null);

  // Debounced recompute over the in-memory blocks. Also re-runs when the doc
  // mutates — every optimistic patch yields a fresh `blocks` array.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      const { matches, capped: c } = computeMatches(blocks, query);
      useSearchStore.getState().setMatches(matches, c);
    }, 150);
    return () => clearTimeout(id);
  }, [open, query, blocks]);

  // Focus the input on open (next frame — mount-commit focus can drop the
  // keyboard on heavy renders, same backstop pattern as DocBlock).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Writer-only v1: switching to a docx/PDF preview closes the panel.
  useEffect(() => {
    if (previewMode != null) useSearchStore.getState().close();
  }, [previewMode]);

  // Leaving the workspace unmounts the panel → drop all search state.
  useEffect(() => () => useSearchStore.getState().close(), []);

  if (!open) return null;

  const jumpTo = (i: number) => {
    const m = useSearchStore.getState().matches[i];
    if (!m) return;
    hSelection();
    useSearchStore.getState().setCurrent(i);
    useWorkspaceStore.getState().requestScrollToBlock(m.blockIndex);
  };
  const next = () => {
    const s = useSearchStore.getState();
    if (s.matches.length) jumpTo((s.current + 1) % s.matches.length);
  };
  const prev = () => {
    const s = useSearchStore.getState();
    if (s.matches.length) jumpTo((s.current - 1 + s.matches.length) % s.matches.length);
  };

  const curBlock = cur ? blocks.find((b) => b.index === cur.blockIndex) : undefined;
  const canReplace = curBlock?.kind === "paragraph";

  const replaceCurrent = () => {
    const s = useSearchStore.getState();
    const m = s.matches[s.current];
    if (!m || !curBlock || curBlock.kind !== "paragraph") return;
    const text = curBlock.text.slice(0, m.start) + s.replaceText + curBlock.text.slice(m.end);
    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index: m.blockIndex, text });
    // Matches recompute from the fresh blocks; `current` stays put, so the
    // next hit slides into the same slot.
  };

  const replaceAll = () => {
    const s = useSearchStore.getState();
    let replaced = 0;
    let blocksTouched = 0;
    let skipped = 0;
    for (const [indexStr, ms] of Object.entries(s.matchesByBlock)) {
      const index = Number(indexStr);
      const block = blocks.find((b) => b.index === index);
      if (!block || block.kind !== "paragraph") {
        skipped += ms.length;
        continue;
      }
      // Splice right-to-left so earlier spans stay valid.
      let text = block.text;
      for (const m of [...ms].sort((a, b) => b.start - a.start)) {
        text = text.slice(0, m.start) + s.replaceText + text.slice(m.end);
      }
      void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index, text });
      blocksTouched += 1;
      replaced += ms.length;
    }
    Alert.alert(
      t("workspace.replaceDoneTitle", { defaultValue: "Replace all" }),
      t("workspace.replaceDone", {
        n: replaced,
        blocks: blocksTouched,
        defaultValue: "Replaced {{n}} in {{blocks}} paragraphs",
      }) +
        (skipped > 0
          ? "\n" +
            t("workspace.replaceSkipped", {
              n: skipped,
              defaultValue: "{{n}} non-editable hits skipped",
            })
          : ""),
    );
  };

  const runSemantic = async () => {
    const store = useSearchStore.getState();
    const q = store.query.trim();
    if (q.length < 2 || store.semanticLoading) return;
    store.semanticStart();
    try {
      // Composing holds edits on-device — drain the queue before querying the
      // server doc (same contract as AI turns).
      await useThesisDocStore.getState().flushOps(thesisId, { timeoutMs: 15_000 });
      const res = await searchThesisSemantic(thesisId, q);
      useSearchStore.getState().semanticDone(res.results, res.indexing ?? false);
    } catch {
      useSearchStore.getState().semanticFail();
    }
  };

  const jumpSemantic = (blockIndex: number) => {
    hSelection();
    const ws = useWorkspaceStore.getState();
    // Semantic hits have no text highlight — select the block so the landing
    // spot is visibly tinted (mirrors an outline tap).
    ws.selectBlock(blockIndex, null);
    ws.requestScrollToBlock(blockIndex);
  };

  const counter = `${matchCount === 0 ? 0 : current + 1}/${matchCount}${capped ? "+" : ""}`;
  const iconColor = (enabled: boolean) => (enabled ? colors.textPrimary : colors.textPlaceholder);

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.bgPrimary, borderBottomColor: colors.borderDefault },
      ]}
    >
      <View style={[styles.row, { flexDirection }]}>
        <Search size={16} color={colors.textPlaceholder} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={(v) => useSearchStore.getState().setQuery(v)}
          placeholder={t("workspace.searchPlaceholder", { defaultValue: "Find in document" })}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.input, { color: colors.textPrimary }]}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={next}
        />
        <Text style={[styles.counter, { color: colors.textSecondary }]}>{counter}</Text>
        <Pressable
          onPress={prev}
          disabled={matchCount === 0}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.searchPrev", { defaultValue: "Previous match" })}
        >
          <ChevronUp size={18} color={iconColor(matchCount > 0)} />
        </Pressable>
        <Pressable
          onPress={next}
          disabled={matchCount === 0}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.searchNext", { defaultValue: "Next match" })}
        >
          <ChevronDown size={18} color={iconColor(matchCount > 0)} />
        </Pressable>
        <Pressable
          onPress={() => useSearchStore.getState().toggleReplace()}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.searchReplaceToggle", { defaultValue: "Find and replace" })}
        >
          <Replace size={16} color={replaceOpen ? colors.brandPrimary : colors.textPrimary} />
        </Pressable>
        <Pressable
          onPress={() => useSearchStore.getState().close()}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.searchClose", { defaultValue: "Close search" })}
        >
          <X size={18} color={colors.textPrimary} />
        </Pressable>
      </View>

      {replaceOpen && (
        <View style={[styles.row, { flexDirection }]}>
          <Replace size={16} color={colors.textPlaceholder} />
          <TextInput
            value={replaceText}
            onChangeText={(v) => useSearchStore.getState().setReplaceText(v)}
            placeholder={t("workspace.replacePlaceholder", { defaultValue: "Replace with" })}
            placeholderTextColor={colors.textPlaceholder}
            style={[styles.input, { color: colors.textPrimary }]}
            autoCorrect={false}
          />
          <Pressable
            onPress={replaceCurrent}
            disabled={!canReplace}
            style={[
              styles.btn,
              { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
              !canReplace && styles.dim,
            ]}
          >
            <Text style={[styles.btnText, { color: colors.textPrimary }]}>
              {t("workspace.replace", { defaultValue: "Replace" })}
            </Text>
          </Pressable>
          <Pressable
            onPress={replaceAll}
            disabled={matchCount === 0}
            style={[
              styles.btn,
              { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
              matchCount === 0 && styles.dim,
            ]}
          >
            <Text style={[styles.btnText, { color: colors.textPrimary }]}>
              {t("workspace.replaceAll", { defaultValue: "All" })}
            </Text>
          </Pressable>
        </View>
      )}

      <Pressable
        onPress={() => void runSemantic()}
        disabled={semanticLoading || query.trim().length < 2}
        style={[
          styles.meaningRow,
          { flexDirection, borderColor: colors.brandPrimary + "66" },
          query.trim().length < 2 && styles.dim,
        ]}
      >
        {semanticLoading ? (
          <ActivityIndicator size="small" color={colors.brandPrimary} />
        ) : (
          <Sparkles size={14} color={colors.brandPrimary} />
        )}
        <Text style={[styles.meaningText, { color: colors.brandPrimary }]}>
          {t("workspace.searchByMeaning", { defaultValue: "Search by meaning" })}
        </Text>
      </Pressable>

      {semanticError && (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t("workspace.searchMeaningError", {
            defaultValue: "Couldn't search — check your connection",
          })}
        </Text>
      )}
      {semantic != null && semantic.length === 0 && !semanticError && (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {semanticIndexing
            ? t("workspace.searchIndexing", {
                defaultValue: "Preparing the search index — try again in a moment",
              })
            : t("workspace.searchMeaningEmpty", { defaultValue: "No related passages found" })}
        </Text>
      )}
      {semantic != null && semantic.length > 0 && (
        <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
          {semantic.map((h) => (
            <Pressable
              key={h.blockIndex}
              onPress={() => jumpSemantic(h.blockIndex)}
              style={[styles.resRow, { borderStartColor: colors.brandPrimary }]}
            >
              {h.headingPath ? (
                <Text
                  style={[styles.resPath, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {h.headingPath}
                </Text>
              ) : null}
              <Text style={[styles.resSnippet, { color: colors.textPrimary }]} numberOfLines={2}>
                {h.snippet}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  row: { alignItems: "center", gap: 8 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 4 },
  counter: { fontSize: 12, fontFamily: "Inter_600SemiBold", minWidth: 38, textAlign: "center" },
  btn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dim: { opacity: 0.4 },
  meaningRow: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 6,
  },
  meaningText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 12, textAlign: "center", paddingVertical: 2 },
  results: { maxHeight: 220 },
  resRow: { borderStartWidth: 2, paddingHorizontal: 8, paddingVertical: 5, marginVertical: 2 },
  resPath: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  resSnippet: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
```

- [ ] **Step 2: Add i18n keys**

In `locales/en.json`, inside the existing `"dockBar"` object (~line 24) add:

```json
"search": "Search"
```

Inside the existing `"workspace"` object add:

```json
"searchTitle": "Search",
"searchPlaceholder": "Find in document",
"searchPrev": "Previous match",
"searchNext": "Next match",
"searchClose": "Close search",
"searchReplaceToggle": "Find and replace",
"replacePlaceholder": "Replace with",
"replace": "Replace",
"replaceAll": "All",
"searchByMeaning": "Search by meaning",
"searchMeaningEmpty": "No related passages found",
"searchMeaningError": "Couldn't search — check your connection",
"searchIndexing": "Preparing the search index — try again in a moment",
"replaceDoneTitle": "Replace all",
"replaceDone": "Replaced {{n}} in {{blocks}} paragraphs",
"replaceSkipped": "{{n}} non-editable hits skipped"
```

In `locales/fr.json` (same two objects):

```json
"search": "Recherche"
```

```json
"searchTitle": "Recherche",
"searchPlaceholder": "Rechercher dans le document",
"searchPrev": "Résultat précédent",
"searchNext": "Résultat suivant",
"searchClose": "Fermer la recherche",
"searchReplaceToggle": "Rechercher et remplacer",
"replacePlaceholder": "Remplacer par",
"replace": "Remplacer",
"replaceAll": "Tout",
"searchByMeaning": "Recherche par sens",
"searchMeaningEmpty": "Aucun passage pertinent trouvé",
"searchMeaningError": "Recherche impossible — vérifiez votre connexion",
"searchIndexing": "Préparation de l'index de recherche — réessayez dans un instant",
"replaceDoneTitle": "Tout remplacer",
"replaceDone": "{{n}} remplacement(s) dans {{blocks}} paragraphe(s)",
"replaceSkipped": "{{n}} occurrence(s) non modifiable(s) ignorée(s)"
```

In `locales/ar.json` (same two objects):

```json
"search": "بحث"
```

```json
"searchTitle": "بحث",
"searchPlaceholder": "ابحث في المستند",
"searchPrev": "النتيجة السابقة",
"searchNext": "النتيجة التالية",
"searchClose": "إغلاق البحث",
"searchReplaceToggle": "بحث واستبدال",
"replacePlaceholder": "استبدال بـ",
"replace": "استبدال",
"replaceAll": "الكل",
"searchByMeaning": "البحث بالمعنى",
"searchMeaningEmpty": "لا توجد مقاطع ذات صلة",
"searchMeaningError": "تعذر البحث — تحقق من اتصالك",
"searchIndexing": "جارٍ تجهيز فهرس البحث — حاول بعد قليل",
"replaceDoneTitle": "استبدال الكل",
"replaceDone": "تم {{n}} استبدالًا في {{blocks}} فقرة",
"replaceSkipped": "تم تجاهل {{n}} نتيجة غير قابلة للتعديل"
```

Watch JSON commas when inserting; the interpolation deliberately uses `{{n}}`,
NOT `{{count}}` (i18next's `count` option triggers plural-suffix lookup, which
would fall back to English on fr/ar).

- [ ] **Step 3: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors. Also sanity-check the JSON:
`node -e "['en','fr','ar'].forEach(l=>JSON.parse(require('fs').readFileSync('locales/'+l+'.json')))" && echo JSON-OK`
Expected: `JSON-OK`.

- [ ] **Step 4: Commit (commit policy: locale files are expected user WIP — edit but don't stage; record for the Task 8 report)**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/SearchPanel.tsx
git commit -m "feat(workspace): SearchPanel — top-pinned find/replace + search-by-meaning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: DocBlock match highlighting

**Files:**
- Modify: `components/workspace/DocBlock.tsx` (imports ~line 29, selectors ~line 129, paragraph render ~lines 335-375)

- [ ] **Step 1: Import + colors**

Add with the other store imports (~line 28):

```ts
import { useSearchStore } from "@/stores/search-store";
```

Add after the `BORDER` constant (~line 35) — fixed hexes are correct here, the
paper is always white (same rationale as `INK`):

```ts
// Search-hit highlight on the always-white paper: soft amber for every hit,
// strong amber for the CURRENT hit the ↑↓ cursor is on.
const SEARCH_HIT_BG = "#FFE08A";
const SEARCH_HIT_CURRENT_BG = "#FFB300";
```

- [ ] **Step 2: Add the two selectors**

Directly after the `justApplied` selector (~line 128), BEFORE the
`if (block.kind === "other")` early return (hooks must run for every kind):

```ts
// Search-hit spans for THIS block (undefined for most blocks). The per-block
// array ref is rebuilt only inside setMatches, so this stays Object.is-stable
// across unrelated search-store updates.
const searchMatches = useSearchStore((s) => (s.open ? s.matchesByBlock[block.index] : undefined));
// Original-text start offset of the CURRENT hit when it's in this block, else
// -1 — a primitive, so safe for zustand's Object.is.
const searchCurrentStart = useSearchStore((s) => {
  if (!s.open) return -1;
  const m = s.matches[s.current];
  return m && m.blockIndex === block.index ? m.start : -1;
});
```

- [ ] **Step 3: Build the segments in the read-only paragraph branch**

In the final read-only paragraph render (the block ending the component, which
returns the `<SettleFlash>`-wrapped `<Text>`, ~line 335), insert immediately
before its `return (`:

```tsx
// While searching, hits render as amber spans and take precedence over the
// per-run formatting branch (search is transient; runs come back on close).
const searchSegs =
  !empty && searchMatches?.length
    ? (() => {
        const out: React.ReactNode[] = [];
        let pos = 0;
        for (const m of searchMatches) {
          if (m.start > pos) out.push(block.text.slice(pos, m.start));
          out.push(
            <Text
              key={`h${m.start}`}
              style={{
                backgroundColor:
                  m.start === searchCurrentStart ? SEARCH_HIT_CURRENT_BG : SEARCH_HIT_BG,
              }}
            >
              {block.text.slice(m.start, m.end)}
            </Text>,
          );
          pos = m.end;
        }
        if (pos < block.text.length) out.push(block.text.slice(pos));
        return out;
      })()
    : null;
```

- [ ] **Step 4: Wire it into the render expression**

Replace (inside that same return):

```tsx
{empty
  ? "·"
  : useRuns && runs
    ? runs.map((r, i) => (
        <Text key={i} style={runTextStyle(r)}>
          {r.text}
        </Text>
      ))
    : block.text}
```

with:

```tsx
{empty
  ? "·"
  : searchSegs
    ? searchSegs
    : useRuns && runs
      ? runs.map((r, i) => (
          <Text key={i} style={runTextStyle(r)}>
            {r.text}
          </Text>
        ))
      : block.text}
```

(New-Arch caveat for device QA: if the nested-`Text` backgroundColor doesn't
paint, add a no-op `top: 0` to the span style — see the rn-new-arch-render-traps
note about nested `Animated.Text` backgrounds.)

- [ ] **Step 5: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit (app repo)**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/DocBlock.tsx
git commit -m "feat(workspace): amber search-hit highlighting in Writer paragraphs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Entry points + panel mount

**Files:**
- Modify: `components/workspace/GlobalDockBar.tsx` (imports, handler ~line 161, chips ~lines 408-447)
- Modify: `components/workspace/WorkspaceHeaderMenu.tsx` (imports, props, rows)
- Modify: `app/(app)/thesis-workspace.tsx` (imports, `HeaderMenuButton` props ~line 583, mount ~line 600)

- [ ] **Step 1: GlobalDockBar — 🔍 chip**

Add `Search` to the existing `lucide-react-native` import list, and:

```ts
import { useSearchStore } from "@/stores/search-store";
```

Add after the `openOutline` handler (~line 161):

```ts
// ── Document search (top-pinned panel; Writer-only v1 → closes any preview) ──
const openSearch = () => {
  Keyboard.dismiss();
  const ws = useWorkspaceStore.getState();
  if (ws.previewMode != null) ws.closePreview();
  useSearchStore.getState().openSearch();
};
```

Insert a chip between the `next` chip and `sep("s3")` (~line 423), and bump the
later `enterIndex` values (pageBreak 6→7, pageSetup 7→8, thesisReady 8→9):

```tsx
{chip({
  keyProp: "search",
  Icon: Search,
  accessibilityLabel: t("dockBar.search", { defaultValue: "Search" }),
  enterIndex: 6,
  onPress: openSearch,
})}
```

- [ ] **Step 2: WorkspaceHeaderMenu — "Search" row**

Add `Search` to its `lucide-react-native` imports. Add an `onOpenSearch: () => void`
prop (destructure alongside `onOpenOutline`, add to the props type). Insert a
row right after the Outline `<Row … />`:

```tsx
<Row
  icon={Search}
  label={t("workspace.searchTitle", { defaultValue: "Search" })}
  color={colors.textPrimary}
  onPress={run(onOpenSearch)}
/>
```

- [ ] **Step 3: thesis-workspace — wire + mount**

Add imports:

```ts
import { SearchPanel } from "@/components/workspace/SearchPanel";
import { useSearchStore } from "@/stores/search-store";
```

On the `<HeaderMenuButton` (~line 583) add:

```tsx
onOpenSearch={() => {
  useWorkspaceStore.getState().closePreview();
  useSearchStore.getState().openSearch();
}}
```

After `{liveDoc && <PreviewBar />}` (~line 600) add:

```tsx
{/* Top-pinned document search (find/replace + semantic). Sits between the
    header and the doc area so it survives keyboard dismissal. */}
{liveDoc && <SearchPanel thesisId={thesisId} blocks={liveDoc.blocks} />}
```

Note: if the header-cleanup work (auto-hiding header) has landed on this tree by
now (look for a scroll-driven `Animated.View` around the header row), the search
panel must NOT hide with it — mount `SearchPanel` OUTSIDE/below that animated
wrapper and, while `useSearchStore`'s `open` is true, pin the header visible
(set its scroll-progress shared value to shown). If the header is still static,
nothing extra is needed.

- [ ] **Step 4: Typecheck**

Run: `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit (commit policy: `GlobalDockBar.tsx` and `thesis-workspace.tsx` are expected user WIP — edit but don't stage, record for the Task 8 report; `WorkspaceHeaderMenu.tsx` was clean at planning time)**

```bash
cd /Users/hamzasafwan/modakerati
git add components/workspace/WorkspaceHeaderMenu.tsx
git commit -m "feat(workspace): search entry points — header ⋯ Search row (dock chip + mount ride user WIP files)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: Typecheck both repos**

```bash
cd /Users/hamzasafwan/modakerati && npx tsc --noEmit
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit
```
Expected: no new errors versus the Task 1/Task 3 baselines.

- [ ] **Step 2: On-device QA (run the app: `npx expo start`; requires the server + a live thesis)**

1. Editing a block → dock bar shows the 🔍 chip → tap: keyboard drops, panel
   opens under the header, input focused.
2. Header ⋯ menu → Search opens the same panel (works while just reading).
3. Type an Arabic word WITHOUT diacritics that appears WITH diacritics in the
   doc → counter counts hits; hits render amber in the Writer; current hit is
   the darker amber. (If no amber paints: apply the `top: 0` no-op from Task 6.)
4. ↑/↓ cycle hits: scroll + flash lands on each; counter tracks (`2/12`…);
   wrap-around works.
5. Open ⇄ replace: "Replace" swaps the current hit (correct splice, diacritics
   of the matched word consumed, rest of paragraph untouched); "All" replaces
   everywhere, Alert reports counts; undo (header or dock) restores.
6. A hit inside a table: navigable, but Replace is dimmed.
7. "Search by meaning" with a paraphrase (not the literal words) → results with
   heading paths; tap → jumps to and selects a sensible block.
8. Airplane mode: exact search + replace still work (ops queue); meaning row
   errors with the connection hint; back online → works again.
9. Open docx preview while search is open → panel closes. Reopen search from
   ⋯ menu while in preview → preview closes, Writer + panel show.
10. ✕ closes the panel; ALL highlights disappear; reopening starts clean.
11. French + Arabic UI languages: all new strings localized (no English
    fallbacks); panel rows mirror correctly in RTL.

- [ ] **Step 3: Report**

Report QA outcomes honestly per item (pass/fail/not-run) — failures loop back
into the relevant task before any "done" claim. Also list every EDITED-BUT-
UNCOMMITTED file (the user-WIP files from the commit policy — expected:
`ThesisOutlinePanel.tsx`, `lib/api.ts`, `locales/*.json`, `GlobalDockBar.tsx`,
`app/(app)/thesis-workspace.tsx`, possibly server `src/routes/thesis.ts`) so
the user knows exactly which of their WIP files now also carry search changes.
