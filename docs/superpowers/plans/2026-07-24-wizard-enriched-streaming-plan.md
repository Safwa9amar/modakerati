# Enriched, Reordered Creation Wizard + Streaming Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect a topic brief (description/objectives/keywords/methodology) + cover tokens *before* generating the plan, feed the brief into `generate-plan`, and stream the outline (NDJSON, one section per line) so sections appear one by one.

**Architecture:** Server plan logic becomes pure + testable (`buildPlanPrompt`, `normalizePlanSection`, `parseNdjsonLines`, `fallbackSections`, `resolvePreset`) and gains a streaming generator `streamPlan(input, write)` wired into `POST /generate-plan` behind a `stream:true` flag (the non-streaming path stays for fallback/blank flow). The app adds a Topic step, moves plan generation out of `template-preview` into `thesis-plan` (which live-fills the outline via a new `streamThesisPlan` client using `expo/fetch` streaming), and persists the brief in `frontMatter.brief`.

**Tech Stack:** Server — Hono `streamText`, OpenRouter (OpenAI-SDK) streaming, Drizzle, Vitest. App — Expo/React Native, `expo/fetch` streaming, Zustand, react-i18next.

**Reference spec:** `docs/superpowers/specs/2026-07-24-wizard-enriched-streaming-plan-design.md`

---

## File Structure

**Server (`~/modakerati-server`)**
- `src/lib/thesis-plan.ts` — **modify**. Add `PlanBrief`/`PlanInput` types, pure helpers, `streamPlan`; refactor `generatePlan` to share them.
- `src/routes/thesis/ai-suggest.ts` — **modify**. `POST /generate-plan` streams NDJSON when `stream:true`; JSON otherwise.
- `src/__tests__/thesis-plan.test.ts` — **new**. Pure-helper + `streamPlan` (fixed-structure + fallback) tests.

**App (`~/modakerati`)**
- `stores/thesis-wizard-store.ts` — **modify**. Add `"topic"` step + `brief`.
- `lib/api.ts` — **modify**. `streamThesisPlan`, `PlanBrief`, `generateThesisPlan` accepts `brief`, `createThesis` frontMatter widened.
- `app/(app)/thesis-topic.tsx` — **new**. Topic brief form + the has-fields branch.
- `app/(app)/template-preview.tsx` — **modify**. Stop generating; route to `thesis-topic`.
- `app/(app)/thesis-plan.tsx` — **modify**. Stream on mount (live-fill) + send `brief` in frontMatter.
- `locales/{en,fr,ar}.json` — **modify** (surgical). `wizard.topic.*` + methodology labels.

**Conventions**
- Server: `npm test` → `vitest run`. One file: `npx vitest run src/__tests__/thesis-plan.test.ts`. Tests open with `import "dotenv/config";` (module-load pulls in the Supabase client — same idiom as `template-fields.test.ts`).
- App: no JS test runner → gate with `npx tsc --noEmit` from `~/modakerati`.
- Git: `git add` **exact paths only**, never `-A`/`--amend`. Server on `master` (commit directly, exact paths, never touch `src/routes/thesis/crud.ts` or other concurrent files). App on `spike/lexical-bubble`. Append to every commit message: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. App screen paths have parentheses — quote them in `git add`.
- **Pre-existing:** `src/__tests__/destructive-gate.test.ts` has ONE unrelated failure (7 vs 9 tools). Not yours — ignore; add no new failures.

---

## Task 1: Pure plan helpers + refactor `generatePlan` (server)

**Files:**
- Modify: `~/modakerati-server/src/lib/thesis-plan.ts`
- Test: `~/modakerati-server/src/__tests__/thesis-plan.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/thesis-plan.test.ts`:

```ts
import "dotenv/config";
import { describe, it, expect } from "vitest";
import {
  buildPlanPrompt,
  normalizePlanSection,
  parseNdjsonLines,
  fallbackSections,
  resolvePreset,
} from "../lib/thesis-plan";

describe("resolvePreset", () => {
  it("maps methodology to a preset, else falls back", () => {
    expect(resolvePreset({ methodology: "experimental" }, "chapters")).toBe("imrad");
    expect(resolvePreset({ methodology: "theoretical" }, "chapters")).toBe("law-humanities");
    expect(resolvePreset({ methodology: "survey" }, "chapters")).toBe("chapters");
    expect(resolvePreset({}, "law-humanities")).toBe("law-humanities");
    expect(resolvePreset(undefined, "")).toBe("chapters");
  });
});

describe("buildPlanPrompt", () => {
  it("includes the brief fields in the user prompt", () => {
    const { user } = buildPlanPrompt(
      { title: "AI in schools", brief: { description: "How AI helps teachers", objectives: "Measure impact", keywords: "AI, education" } },
      "chapters",
    );
    expect(user).toContain("AI in schools");
    expect(user).toContain("How AI helps teachers");
    expect(user).toContain("Measure impact");
    expect(user).toContain("AI, education");
  });
  it("omits empty brief fields", () => {
    const { user } = buildPlanPrompt({ title: "T" }, "chapters");
    expect(user).toContain("Thesis title: T");
    expect(user).not.toContain("Objectives");
  });
  it("asks for NDJSON in stream mode, one JSON object otherwise", () => {
    expect(buildPlanPrompt({ title: "T" }, "chapters", { stream: true }).system).toMatch(/one JSON object per line|NDJSON/i);
    expect(buildPlanPrompt({ title: "T" }, "chapters").system).toContain(`"sections"`);
  });
});

describe("normalizePlanSection", () => {
  it("normalizes a valid section and defaults a bad kind to 'section'", () => {
    expect(normalizePlanSection({ title: "  Intro ", kind: "introduction", chapters: [] }))
      .toEqual({ title: "Intro", kind: "introduction", chapters: [] });
    expect(normalizePlanSection({ title: "P", kind: "weird", chapters: [{ title: "C", hint: "h" }] }))
      .toEqual({ title: "P", kind: "section", chapters: [{ title: "C", hint: "h" }] });
  });
  it("drops sections without a usable title and bad chapters", () => {
    expect(normalizePlanSection({ kind: "section" })).toBeNull();
    expect(normalizePlanSection({ title: "P", chapters: [{ nope: 1 }, { title: "" }] }))
      .toEqual({ title: "P", kind: "section", chapters: [] });
  });
});

describe("parseNdjsonLines", () => {
  it("returns complete lines and keeps the trailing partial as rest", () => {
    expect(parseNdjsonLines('{"a":1}\n{"b":2}\n{"c":')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c":' });
    expect(parseNdjsonLines("  \n\n")).toEqual({ lines: [], rest: "" });
  });
});

describe("fallbackSections", () => {
  it("returns a non-empty deterministic outline", () => {
    expect(fallbackSections("fr").length).toBeGreaterThan(0);
    expect(fallbackSections("ar")[0].title).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-plan.test.ts`
Expected: FAIL — `buildPlanPrompt` / `resolvePreset` / etc. are not exported.

- [ ] **Step 3: Implement the helpers + refactor `generatePlan`**

Replace the entire contents of `src/lib/thesis-plan.ts` with:

```ts
import { getProvider } from "./ai";
import { db, templates } from "../db";
import { eq } from "drizzle-orm";

export interface GeneratedPlan {
  sections: Array<{ title: string; kind: "introduction" | "section" | "conclusion"; chapters: Array<{ title: string; hint?: string; content?: string }> }>;
}

export interface PlanBrief {
  description?: string;
  objectives?: string;
  keywords?: string;
  methodology?: string;
}

export interface PlanInput {
  title: string;
  language?: string;
  bodyPreset?: string;
  templateId?: string;
  brief?: PlanBrief;
}

const PRESET_HINT: Record<string, string> = {
  imrad: "Use the science/experimental structure: an Introduction Générale, then Parties like 'Synthèse Bibliographique', 'Matériel et Méthodes', 'Résultats et Discussion', then a Conclusion Générale. Parties contain chapitres.",
  "law-humanities": "Use the law/humanities structure: Introduction, then thematic Parties each containing numbered Chapitres, then Conclusion.",
  chapters: "Use a simple structure: Introduction, several thematic Chapitres grouped under one or two Parties, then Conclusion.",
};

const METHODOLOGY_PRESET: Record<string, string> = {
  experimental: "imrad",
  case_study: "chapters",
  survey: "chapters",
  theoretical: "law-humanities",
  // "mixed" and anything else fall through to the template/default preset
};

/** Methodology (from the brief) selects a structure preset, else the caller's fallback. */
export function resolvePreset(brief: PlanBrief | undefined, fallback: string): string {
  const m = brief?.methodology;
  return (m && METHODOLOGY_PRESET[m]) || fallback || "chapters";
}

/** Build the system + user prompt. `stream` mode asks for NDJSON (one section per line). */
export function buildPlanPrompt(
  input: PlanInput,
  preset: string,
  opts: { stream?: boolean } = {},
): { system: string; user: string } {
  const lang = input.language || "fr";
  const langName = lang === "ar" ? "Arabic" : lang === "en" ? "English" : "French";
  const presetHint = PRESET_HINT[preset] ?? PRESET_HINT.chapters;
  const shape = opts.stream
    ? `Output NDJSON: emit ONE JSON object per line, with NO wrapping array. Each line is exactly one section object: {"title":"...","kind":"introduction|section|conclusion","chapters":[{"title":"...","hint":"one-sentence guidance"}]}. Nothing else on a line.`
    : `Return EXACTLY this shape: {"sections":[{"title":"...","kind":"introduction|section|conclusion","chapters":[{"title":"...","hint":"one-sentence guidance"}]}]}. Output valid JSON, nothing else.`;
  const system = `You are an academic thesis-planning assistant for Algerian university students. Produce a coherent thesis outline in ${langName}.
${presetHint}
${shape}
Rules: 4-7 sections; "introduction" and "conclusion" kinds have an empty chapters array; "section" kinds have 1-4 chapters. Titles concise and academic.`;
  const b = input.brief || {};
  const user = [
    `Thesis title: ${input.title}`,
    b.description ? `Topic description: ${b.description}` : "",
    b.objectives ? `Objectives / research questions: ${b.objectives}` : "",
    b.keywords ? `Keywords: ${b.keywords}` : "",
    b.methodology ? `Methodology: ${b.methodology}` : "",
  ].filter(Boolean).join("\n");
  return { system, user };
}

/** Validate/normalize one raw section object; returns null if it has no usable title. */
export function normalizePlanSection(raw: any): GeneratedPlan["sections"][number] | null {
  if (!raw || typeof raw.title !== "string" || !raw.title.trim()) return null;
  const kind = ["introduction", "section", "conclusion"].includes(raw.kind) ? raw.kind : "section";
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters
        .filter((c: any) => c && typeof c.title === "string" && c.title.trim())
        .map((c: any) => ({ title: String(c.title).trim(), hint: typeof c.hint === "string" ? c.hint : undefined }))
    : [];
  return { title: raw.title.trim(), kind: kind as any, chapters };
}

/** Split an NDJSON buffer into complete (trimmed, non-empty) lines + a trailing partial `rest`. */
export function parseNdjsonLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

/** Deterministic outline used when the model is unavailable. */
export function fallbackSections(lang: string): GeneratedPlan["sections"] {
  return [
    { title: lang === "ar" ? "مقدمة عامة" : "Introduction Générale", kind: "introduction", chapters: [] },
    { title: lang === "ar" ? "الإطار النظري" : "Partie Théorique", kind: "section", chapters: [{ title: lang === "ar" ? "الفصل الأول" : "Chapitre 1" }] },
    { title: lang === "ar" ? "الجانب التطبيقي" : "Partie Pratique", kind: "section", chapters: [{ title: lang === "ar" ? "الفصل الثاني" : "Chapitre 2" }] },
    { title: lang === "ar" ? "خاتمة عامة" : "Conclusion Générale", kind: "conclusion", chapters: [] },
  ];
}

/** Load a template's fixed body structure (verbatim plan) if it has one. */
async function loadTemplate(templateId?: string): Promise<any | undefined> {
  if (!templateId) return undefined;
  const [t] = await db.select().from(templates).where(eq(templates.id, templateId));
  return t;
}

/** Non-streaming plan generation (used by the blank flow and as the app's fallback). */
export async function generatePlan(input: PlanInput): Promise<GeneratedPlan> {
  const template = await loadTemplate(input.templateId);
  const bodyStructure = template?.bodyStructure as GeneratedPlan["sections"] | undefined;
  if (Array.isArray(bodyStructure) && bodyStructure.length > 0) {
    return {
      sections: bodyStructure.map((s) => ({
        title: s.title,
        kind: s.kind,
        chapters: (s.chapters || []).map((c) => ({ title: c.title, content: (c as any).content })),
      })),
    };
  }
  const lang = input.language || "fr";
  const preset = resolvePreset(input.brief, template?.bodyPreset || input.bodyPreset || "chapters");
  const { system, user } = buildPlanPrompt(input, preset);
  const ai = getProvider("openrouter");
  try {
    const res = await ai.chat([{ role: "user", content: user }], { systemPrompt: system, temperature: 0.4, maxTokens: 1024 });
    const raw = res.content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    const parsed = JSON.parse(raw) as GeneratedPlan;
    if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) throw new Error("empty");
    const sections = parsed.sections.map(normalizePlanSection).filter(Boolean) as GeneratedPlan["sections"];
    if (sections.length === 0) throw new Error("empty");
    return { sections };
  } catch {
    return { sections: fallbackSections(lang) };
  }
}

/** Streaming plan generation: writes ONE NDJSON section per line via `write`. */
export async function streamPlan(
  input: PlanInput,
  write: (chunk: string) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<void> {
  const template = await loadTemplate(input.templateId);
  const bodyStructure = template?.bodyStructure as GeneratedPlan["sections"] | undefined;
  if (Array.isArray(bodyStructure) && bodyStructure.length > 0) {
    for (const s of bodyStructure) {
      const n = normalizePlanSection(s);
      if (n) await write(JSON.stringify(n) + "\n");
    }
    return;
  }
  const lang = input.language || "fr";
  const preset = resolvePreset(input.brief, template?.bodyPreset || input.bodyPreset || "chapters");
  const { system, user } = buildPlanPrompt(input, preset, { stream: true });
  const client = getProvider("openrouter").getClient?.();
  let emitted = 0;
  if (client) {
    const model = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.8";
    try {
      const completion = await client.chat.completions.create(
        { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.4, max_tokens: 1024, stream: true },
        signal ? { signal } : undefined,
      );
      let buf = "";
      for await (const chunk of completion) {
        const delta = chunk?.choices?.[0]?.delta?.content || "";
        if (!delta) continue;
        buf += delta;
        const { lines, rest } = parseNdjsonLines(buf);
        buf = rest;
        for (const line of lines) {
          let obj: any;
          try { obj = JSON.parse(line); } catch { continue; }
          const n = normalizePlanSection(obj);
          if (n) { await write(JSON.stringify(n) + "\n"); emitted++; }
        }
      }
      const tail = buf.trim();
      if (tail) {
        try { const n = normalizePlanSection(JSON.parse(tail)); if (n) { await write(JSON.stringify(n) + "\n"); emitted++; } } catch { /* partial junk */ }
      }
    } catch (e) {
      console.warn("streamPlan AI failed:", (e as any)?.message ?? e);
    }
  }
  if (emitted === 0) {
    for (const s of fallbackSections(lang)) await write(JSON.stringify(s) + "\n");
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-plan.test.ts`
Expected: PASS (all describe blocks). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/thesis-plan.ts src/__tests__/thesis-plan.test.ts
git commit -m "feat(plan): brief-aware pure helpers + streamPlan (NDJSON) in thesis-plan"
```

---

## Task 2: Stream the plan endpoint (server)

**Files:**
- Modify: `~/modakerati-server/src/routes/thesis/ai-suggest.ts:24-29`
- Test: `~/modakerati-server/src/__tests__/thesis-plan.test.ts`

- [ ] **Step 1: Add a `streamPlan` unit test (fallback path)**

`streamPlan` already exists from Task 1, so this test should **pass immediately** — it locks in the NDJSON/fallback behavior. (The route wiring in Step 3 has no unit test; it's covered by `tsc --noEmit` + device QA.) Append to `src/__tests__/thesis-plan.test.ts`:

```ts
import { streamPlan } from "../lib/thesis-plan";

async function collect(input: any): Promise<any[]> {
  const out: any[] = [];
  await streamPlan(input, (chunk) => {
    for (const line of chunk.split("\n")) {
      const t = line.trim();
      if (t) out.push(JSON.parse(t));
    }
  });
  return out;
}

describe("streamPlan", () => {
  it("with no template + no AI client configured, ends with the fallback outline", async () => {
    // In the test env OPENROUTER isn't configured, so getClient?.() is undefined
    // and streamPlan emits the deterministic fallback — every line is valid JSON.
    const sections = await collect({ title: "Test", language: "fr" });
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((s) => typeof s.title === "string" && s.title.length > 0)).toBe(true);
    expect(sections.map((s) => s.kind)).toContain("introduction");
  });
});
```

Note: this test assumes the vitest env has **no** working OpenRouter client (so the AI branch is skipped and the fallback is emitted). If `getProvider("openrouter").getClient?.()` returns a client in this env, the test may hit the network — if so, the implementer should confirm the fallback branch another way (e.g. a template with a fixed `bodyStructure`) and note it; do not add network calls to the suite.

- [ ] **Step 2: Run the test**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-plan.test.ts -t streamPlan`
Expected: PASS (the fallback outline is emitted as valid NDJSON). If it instead hits the network because this env has a live OpenRouter client, switch the test to drive `streamPlan` through a template with a fixed `bodyStructure` (deterministic, no AI) and note the change. Then proceed to wire the route.

- [ ] **Step 3: Wire streaming into the route**

In `src/routes/thesis/ai-suggest.ts`, add to the imports at the top (there is already `import { streamText } from "hono/streaming";` at line 3, and `import { generatePlan } from "../../lib/thesis-plan";` at line 9 — extend the latter):

```ts
import { generatePlan, streamPlan } from "../../lib/thesis-plan";
```

Replace the current handler (`src/routes/thesis/ai-suggest.ts:24-29`):

```ts
  app.post("/generate-plan", async (c) => {
    const { title, language, bodyPreset, templateId } = await c.req.json();
    if (!title || typeof title !== "string") return c.json({ error: "title required" }, 400);
    const plan = await generatePlan({ title, language, bodyPreset, templateId });
    return c.json(plan);
  });
```

with:

```ts
  app.post("/generate-plan", async (c) => {
    const { title, language, bodyPreset, templateId, brief, stream } = await c.req.json();
    if (!title || typeof title !== "string") return c.json({ error: "title required" }, 400);
    const input = { title, language, bodyPreset, templateId, brief };
    // Streaming path (template flow): NDJSON, one section per line, so the app
    // can render the outline as it forms. Non-streaming path (blank flow /
    // fallback) returns the whole plan as JSON, unchanged.
    if (stream) {
      c.header("X-Accel-Buffering", "no"); // don't let a proxy buffer the stream
      c.header("Cache-Control", "no-cache");
      return streamText(c, async (s) => {
        const controller = new AbortController();
        s.onAbort(() => controller.abort());
        await streamPlan(input, (chunk) => s.write(chunk), controller.signal);
      });
    }
    const plan = await generatePlan(input);
    return c.json(plan);
  });
```

- [ ] **Step 4: Verify tests + typecheck**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-plan.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/routes/thesis/ai-suggest.ts src/__tests__/thesis-plan.test.ts
git commit -m "feat(plan): stream generate-plan as NDJSON when stream:true"
```

---

## Task 3: Wizard store — `topic` step + `brief` (app)

**Files:**
- Modify: `~/modakerati/stores/thesis-wizard-store.ts`

- [ ] **Step 1: Add the step + brief state**

Replace the whole body of `stores/thesis-wizard-store.ts` with:

```ts
import { create } from "zustand";

export interface WizardPlanSection {
  title: string;
  kind: "introduction" | "section" | "conclusion";
  chapters: { title: string; hint?: string; content?: string }[];
}

export interface WizardBrief {
  description: string;
  objectives: string;
  keywords: string;
  methodology: string;
}

export type WizardStep = "template" | "title" | "topic" | "fields" | "plan" | "confirm";

interface WizardState {
  step: WizardStep;
  title: string;
  language: string;
  templateId: string | null;
  normProfileId: string | null;
  supervisor: string;
  academicYear: string;
  fieldValues: Record<string, string>;
  brief: WizardBrief;
  plan: WizardPlanSection[] | null;
  set: (patch: Partial<Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "fieldValues" | "brief" | "plan">>) => void;
  reset: () => void;
}

const EMPTY_BRIEF: WizardBrief = { description: "", objectives: "", keywords: "", methodology: "" };

const INITIAL: Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "fieldValues" | "brief" | "plan"> = {
  step: "template",
  title: "",
  language: "fr",
  templateId: null,
  normProfileId: null,
  supervisor: "",
  academicYear: "",
  fieldValues: {},
  brief: EMPTY_BRIEF,
  plan: null,
};

export const useThesisWizard = create<WizardState>((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  reset: () => set({ ...INITIAL, brief: { ...EMPTY_BRIEF } }),
}));
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add stores/thesis-wizard-store.ts
git commit -m "feat(wizard): add topic step + brief to wizard store"
```

---

## Task 4: Client streaming + brief plumbing (app)

**Files:**
- Modify: `~/modakerati/lib/api.ts` (`generateThesisPlan` at :457, `createThesis` at :406, add `streamThesisPlan`)

- [ ] **Step 1: Add `PlanBrief`, `streamThesisPlan`, and brief plumbing**

In `lib/api.ts`, replace `generateThesisPlan` (`lib/api.ts:457`):

```ts
export async function generateThesisPlan(input: { title: string; language?: string; bodyPreset?: string; templateId?: string }) {
  return apiPost<{ sections: Array<{ title: string; kind: "introduction" | "section" | "conclusion"; chapters: Array<{ title: string; hint?: string; content?: string }> }> }>("/api/thesis/generate-plan", input);
}
```

with:

```ts
export interface PlanBrief { description?: string; objectives?: string; keywords?: string; methodology?: string }

export type PlanSectionDTO = { title: string; kind: "introduction" | "section" | "conclusion"; chapters: Array<{ title: string; hint?: string; content?: string }> };

export async function generateThesisPlan(input: { title: string; language?: string; bodyPreset?: string; templateId?: string; brief?: PlanBrief }) {
  return apiPost<{ sections: PlanSectionDTO[] }>("/api/thesis/generate-plan", input);
}

/**
 * Streams the generated outline from `/api/thesis/generate-plan` (stream:true),
 * invoking `onSection` for each NDJSON section as it arrives. Uses `expo/fetch`
 * (real ReadableStream body; core RN fetch buffers the whole response) with a
 * streaming TextDecoder so multi-byte UTF-8 (Arabic) isn't split. Throws on a
 * non-OK/bodyless response so callers can fall back to `generateThesisPlan`.
 */
export async function streamThesisPlan(
  input: { title: string; language?: string; bodyPreset?: string; templateId?: string; brief?: PlanBrief },
  onSection: (section: PlanSectionDTO) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await expoFetch(`${API_URL}/api/thesis/generate-plan`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...input, stream: true }),
    signal,
  });
  if (!response.ok || !response.body) {
    const err = new Error(`API Error: ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const drain = (flushAll: boolean) => {
    const parts = buf.split("\n");
    // Keep the last (possibly partial) line buffered — unless this is the final
    // flush, in which case every part (including the last) is complete.
    buf = flushAll ? "" : (parts.pop() ?? "");
    for (const line of parts) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (obj && typeof obj.title === "string") onSection(obj as PlanSectionDTO);
      } catch { /* partial/garbage line — skip */ }
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      drain(false);
    }
    buf += decoder.decode();
    drain(true);
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 2: Widen `createThesis` frontMatter so it can carry the nested `brief`**

In `lib/api.ts`, in the `createThesis` input type (`lib/api.ts:406-414`), change the `frontMatter` line:

```ts
  frontMatter?: Record<string, string>;
```

to:

```ts
  frontMatter?: Record<string, unknown>;
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors. (`getAuthHeaders`, `API_URL`, `expoFetch` are already imported at the top of `lib/api.ts`.)

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add lib/api.ts
git commit -m "feat(wizard): streamThesisPlan client + brief plumbing"
```

---

## Task 5: Topic step screen (app)

**Files:**
- Create: `~/modakerati/app/(app)/thesis-topic.tsx`

- [ ] **Step 1: Create the screen (topic brief + has-fields branch)**

Create `app/(app)/thesis-topic.tsx`:

```tsx
import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisWizard, type WizardBrief } from "@/stores/thesis-wizard-store";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";

const METHODOLOGIES = ["experimental", "theoretical", "case_study", "survey", "mixed"] as const;

export default function ThesisTopicScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { templateId, brief } = useThesisWizard();
  const templates = useThesisStore((s) => s.templates);

  const [values, setValues] = useState<WizardBrief>(brief);
  const [showErrors, setShowErrors] = useState(false);

  const descMissing = !values.description.trim();

  const handleContinue = () => {
    if (descMissing) { setShowErrors(true); return; }
    useThesisWizard.getState().set({ brief: values });
    const tpl = templates.find((x) => x.id === templateId);
    const hasFields = (tpl?.config.placeholderFields?.length ?? 0) > 0;
    router.push(hasFields ? "/(app)/thesis-fields" : "/(app)/thesis-plan");
  };

  const patch = (k: keyof WizardBrief, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("wizard.topic.stepTitle")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t("wizard.topic.stepSubtitle")}</Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.description")} *</Text>
          <TextInput
            value={values.description}
            onChangeText={(v) => patch("description", v)}
            multiline
            placeholder={t("wizard.topic.descriptionPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: showErrors && descMissing ? "#E5484D" : colors.borderDefault, height: 120 }]}
          />
          {showErrors && descMissing && <Text style={styles.errText}>{t("wizard.fieldsRequired")}</Text>}
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.objectives")}</Text>
          <TextInput
            value={values.objectives}
            onChangeText={(v) => patch("objectives", v)}
            multiline
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderDefault, height: 96 }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.keywords")}</Text>
          <TextInput
            value={values.keywords}
            onChangeText={(v) => patch("keywords", v)}
            placeholder={t("wizard.topic.keywordsPlaceholder")}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgInput, borderColor: colors.borderDefault, height: 48 }]}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("wizard.topic.methodology")}</Text>
          <View style={styles.chips}>
            {METHODOLOGIES.map((m) => {
              const selected = values.methodology === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => patch("methodology", selected ? "" : m)}
                  style={[styles.chip, { borderColor: selected ? colors.brandPrimary : colors.borderDefault, backgroundColor: selected ? colors.brandPrimary : "transparent" }]}
                >
                  <Text style={[styles.chipText, { color: selected ? "#FFFFFF" : colors.textPrimary }]}>{t(`wizard.topic.method.${m}`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button title={t("wizard.continue")} onPress={handleContinue} variant="accent" disabled={showErrors && descMissing} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  content: { padding: 20, gap: 18, paddingBottom: 100 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 4 },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular", textAlignVertical: "top" },
  errText: { fontSize: 12, color: "#E5484D", fontFamily: "Inter_400Regular" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  bottomBar: { padding: 20, paddingBottom: 30 },
});
```

- [ ] **Step 2: Typecheck (confirms theme tokens + Button/imports)**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors. `colors.bgInput` and `colors.borderDefault` are valid tokens (verified via `constants/colors.ts`). If any token is missing, open `hooks/useThemeColors.ts` and substitute the nearest existing one — do not invent keys.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add "app/(app)/thesis-topic.tsx"
git commit -m "feat(wizard): topic brief step screen"
```

---

## Task 6: Preview stops generating; routes to Topic (app)

**Files:**
- Modify: `~/modakerati/app/(app)/template-preview.tsx:48-69`

- [ ] **Step 1: Replace `handleUseTemplate` to route to the Topic step without generating**

In `app/(app)/template-preview.tsx`, replace `handleUseTemplate` (`template-preview.tsx:48-69`):

```tsx
  const handleUseTemplate = async () => {
    if (generating) return;
    const wizard = useThesisWizard.getState();
    wizard.set({ templateId: template.id, language: template.language });
    // If the template declares placeholder fields, collect them next; otherwise
    // go straight to the plan. The AI plan generates in the background either way.
    const hasFields = (template.config.placeholderFields?.length ?? 0) > 0;
    const nextRoute = hasFields ? "/(app)/thesis-fields" : "/(app)/thesis-plan";
    setGenerating(true);
    try {
      const { sections } = await generateThesisPlan({
        title: useThesisWizard.getState().title || template.name,
        language: template.language,
        bodyPreset: template.bodyPreset,
        templateId: template.id,
      });
      useThesisWizard.getState().set({ plan: sections });
      router.push(nextRoute);
    } catch (e) {
      console.error("Failed to generate plan:", e instanceof Error ? e.message : e);
      // The plan screen regenerates / falls back when no plan is present.
      router.push(nextRoute);
    } finally {
      setGenerating(false);
    }
  };
```

with:

```tsx
  const handleUseTemplate = () => {
    // Record the chosen template and advance to the Topic step. The plan is NOT
    // generated here anymore — it streams later (in thesis-plan) once the student
    // has filled the topic brief + cover details, so the AI has the full picture.
    useThesisWizard.getState().set({ templateId: template.id, language: template.language });
    router.push("/(app)/thesis-topic");
  };
```

- [ ] **Step 2: Remove the now-unused generating state + import if they dangle**

`generateThesisPlan` and the `generating`/`setGenerating` state were only used by the old `handleUseTemplate`. Run the typecheck; if TS flags `generateThesisPlan` as an unused import or `generating`/`setGenerating` as unused, remove them. The bottom `Button` still references `generating` for its loading/disabled props (`template-preview.tsx:161-170`) — replace those two props so the button is a plain CTA:

```tsx
        <Button
          title={t("template.useTemplate")}
          onPress={handleUseTemplate}
          variant="accent"
        />
```

Then delete the `const [generating, setGenerating] = useState(false);` line and drop `generateThesisPlan` from the `@/lib/api` import (keep `PdfView` etc.). Keep `useState` imported only if still used elsewhere in the file (it isn't after this — remove `useState` from the React import if TS flags it).

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors (no unused-symbol errors).

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add "app/(app)/template-preview.tsx"
git commit -m "feat(wizard): preview routes to topic step, defers plan generation"
```

---

## Task 7: Stream the plan in `thesis-plan` + send `brief` (app)

**Files:**
- Modify: `~/modakerati/app/(app)/thesis-plan.tsx` (mount effect ~:44-68, `handleCreate` ~:169-180)

- [ ] **Step 1: Replace the mount generation with streaming live-fill**

In `app/(app)/thesis-plan.tsx`, update the imports from `@/lib/api` (currently `import { generateThesisPlan, createThesis, getThesis } from "@/lib/api";`) to also pull the streamer and the store's brief/templates:

```tsx
import { generateThesisPlan, streamThesisPlan, createThesis, getThesis } from "@/lib/api";
```

Add `brief` to the wizard destructure (`thesis-plan.tsx:37`):

```tsx
  const { plan, title, language, templateId } = useThesisWizard();
```
→
```tsx
  const { plan, title, language, templateId, brief } = useThesisWizard();
```

Replace the mount `useEffect` that generates a plan when none exists (`thesis-plan.tsx:46-68`):

```tsx
  useEffect(() => {
    if (plan && plan.length > 0) return;
    let active = true;
    setGenerating(true);
    (async () => {
      try {
        const { sections } = await generateThesisPlan({ title, language });
        if (!active) return;
        setLocalPlan(sections);
        useThesisWizard.getState().set({ plan: sections });
      } catch (e) {
        if (active) {
          Alert.alert(
            t("common.error", { defaultValue: "Error" }),
            e instanceof Error ? e.message : String(e)
          );
        }
      } finally {
        if (active) setGenerating(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
```

with (stream sections in as they arrive; fall back to non-streaming on stream failure):

```tsx
  useEffect(() => {
    if (plan && plan.length > 0) return;
    let active = true;
    const controller = new AbortController();
    setGenerating(true);
    setLocalPlan([]);
    (async () => {
      const streamed: WizardPlanSection[] = [];
      try {
        await streamThesisPlan(
          { title, language, templateId: templateId ?? undefined, brief },
          (section) => {
            if (!active) return;
            streamed.push(section as WizardPlanSection);
            setLocalPlan((prev) => [...prev, section as WizardPlanSection]);
          },
          controller.signal,
        );
        if (active && streamed.length > 0) useThesisWizard.getState().set({ plan: streamed });
      } catch {
        // Streaming unavailable → one-shot fallback so a plan still appears.
        try {
          const { sections } = await generateThesisPlan({ title, language, templateId: templateId ?? undefined, brief });
          if (!active) return;
          setLocalPlan(sections);
          useThesisWizard.getState().set({ plan: sections });
        } catch (e) {
          if (active) Alert.alert(t("common.error", { defaultValue: "Error" }), e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (active) setGenerating(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
```

- [ ] **Step 2: Send the brief inside `frontMatter` on create**

In `handleCreate` (`thesis-plan.tsx:169-180`), replace:

```tsx
      const wiz = useThesisWizard.getState();
      const frontMatter = Object.keys(wiz.fieldValues).length ? wiz.fieldValues : undefined;
      const created = await createThesis({
        title,
        templateId: templateId ?? undefined,
        language,
        normProfileId: wiz.normProfileId || undefined,
        frontMatter,
        sections: localPlan.map((s) => ({
          title: s.title || "Partie",
          kind: s.kind,
          chapters: s.chapters.map((c) => ({ title: c.title || "Chapitre", content: c.content })),
        })),
      });
```

with:

```tsx
      const wiz = useThesisWizard.getState();
      const hasBrief = Object.values(wiz.brief).some((v) => v && v.trim());
      const frontMatter: Record<string, unknown> = { ...wiz.fieldValues };
      if (hasBrief) frontMatter.brief = wiz.brief;
      const created = await createThesis({
        title,
        templateId: templateId ?? undefined,
        language,
        normProfileId: wiz.normProfileId || undefined,
        frontMatter: Object.keys(frontMatter).length ? frontMatter : undefined,
        sections: localPlan.map((s) => ({
          title: s.title || "Partie",
          kind: s.kind,
          chapters: s.chapters.map((c) => ({ title: c.title || "Chapitre", content: c.content })),
        })),
      });
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors. (`WizardPlanSection` is already imported at `thesis-plan.tsx:19`.)

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add "app/(app)/thesis-plan.tsx"
git commit -m "feat(wizard): stream the outline live-fill + persist brief in frontMatter"
```

---

## Task 8: i18n for the Topic step (app)

Surgical inserts only (duplicate-key files — never reserialize). Insert immediately after the `"wizard": {` line in each file.

**Files:**
- Modify: `~/modakerati/locales/{en,fr,ar}.json` (each at its `"wizard": {` line ~448)

- [ ] **Step 1: English — insert after `"wizard": {`**

```json
    "topic": {
      "stepTitle": "Your topic",
      "stepSubtitle": "Describe your thesis so the AI can build a plan that fits it.",
      "description": "Description",
      "descriptionPlaceholder": "What is your thesis about?",
      "objectives": "Objectives & research questions",
      "keywords": "Keywords",
      "keywordsPlaceholder": "e.g. machine learning, education, Algeria",
      "methodology": "Methodology",
      "method": { "experimental": "Experimental", "theoretical": "Theoretical", "case_study": "Case study", "survey": "Survey", "mixed": "Mixed" }
    },
```

- [ ] **Step 2: French — insert after `"wizard": {`**

```json
    "topic": {
      "stepTitle": "Votre sujet",
      "stepSubtitle": "Décrivez votre mémoire pour que l'IA construise un plan adapté.",
      "description": "Description",
      "descriptionPlaceholder": "De quoi parle votre mémoire ?",
      "objectives": "Objectifs & questions de recherche",
      "keywords": "Mots-clés",
      "keywordsPlaceholder": "ex. apprentissage automatique, éducation, Algérie",
      "methodology": "Méthodologie",
      "method": { "experimental": "Expérimentale", "theoretical": "Théorique", "case_study": "Étude de cas", "survey": "Enquête", "mixed": "Mixte" }
    },
```

- [ ] **Step 3: Arabic — insert after `"wizard": {`**

```json
    "topic": {
      "stepTitle": "موضوعك",
      "stepSubtitle": "صف مذكرتك حتى يبني الذكاء الاصطناعي خطة تناسبها.",
      "description": "الوصف",
      "descriptionPlaceholder": "ما هو موضوع مذكرتك؟",
      "objectives": "الأهداف وأسئلة البحث",
      "keywords": "الكلمات المفتاحية",
      "keywordsPlaceholder": "مثال: تعلم الآلة، التعليم، الجزائر",
      "methodology": "المنهجية",
      "method": { "experimental": "تجريبية", "theoretical": "نظرية", "case_study": "دراسة حالة", "survey": "استبيان", "mixed": "مختلطة" }
    },
```

- [ ] **Step 4: Verify all three parse**

Run: `cd ~/modakerati && node -e "['en','fr','ar'].forEach(l=>{JSON.parse(require('fs').readFileSync('locales/'+l+'.json','utf8'));console.log(l,'ok')})"`
Expected: `en ok` / `fr ok` / `ar ok`.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(wizard): i18n for the topic step (en/fr/ar)"
```

---

## Task 9: Full verification

- [ ] **Step 1: Server tests + typecheck**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/thesis-plan.test.ts && npx tsc --noEmit`
Expected: plan tests PASS; tsc clean. (Full `npm test` may show the one pre-existing `destructive-gate` failure — ignore.)

- [ ] **Step 2: App typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Device QA — the reordered streaming flow**

With the app + server running:
1. New thesis → name it → pick a template → "Use template".
2. Confirm the **Topic** step appears; Continue is blocked until Description is filled; fill it, optionally objectives/keywords, tap a methodology chip.
3. If the template has cover fields → the **Cover** step appears next; else it goes straight to the plan.
4. On the plan screen, confirm sections **stream in one by one** (not a 61s blank wait), then become editable.
5. Create → open the workspace; verify the cover reflects the cover fields.
6. Repeat in **Arabic** (RTL) — Topic labels/chips + streaming render correctly.
7. Kill Wi-Fi mid-generation once → confirm it falls back to a deterministic outline (no crash).

- [ ] **Step 4: Final git status**

Run: `cd ~/modakerati && git status && cd ~/modakerati-server && git status`
Expected: clean trees or only unrelated concurrent-session files.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 reorder → Tasks 6,5,7; §2 Topic step → Tasks 3,5,8; §3 Cover unchanged → (no task, verified); §4 streaming (server NDJSON + client reader + methodology→preset + fallback) → Tasks 1,2,4,7; §5 persistence (`frontMatter.brief`) → Tasks 4,7; §6 error/edge → Tasks 1,2,7; §7 i18n+testing → Tasks 1,2,8,9.
- **Types consistent:** `PlanBrief`/`PlanInput` (server) ↔ `PlanBrief`/`WizardBrief` (app); `streamPlan`/`streamThesisPlan`/`buildPlanPrompt`/`normalizePlanSection`/`parseNdjsonLines`/`fallbackSections`/`resolvePreset` referenced identically where used; NDJSON contract (one section object per line) matches between `streamPlan` writer and `streamThesisPlan` reader.
- **Known limitation:** the plan stream isn't emoji-escaped (unlike chat); academic titles are Arabic/Latin (2-byte, safe) — an emoji in a title could corrupt, an accepted non-case. Documented, not fixed.
- **RN transport:** `streamThesisPlan` uses `expo/fetch` (real stream body) exactly like `postChatStream`/`thesis-suggest` — the proven app pattern.
```
