# Phase 1: Server Pipeline Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side pipeline engine: norm profiles, thesis analysis, deterministic formatting, and import flow — the foundation all other phases depend on.

**Architecture:** New `normProfiles` table stores per-university formatting rules. An analysis engine parses imported .docx files and compares against norm profiles to produce categorized suggestions. A formatting engine applies norm profiles deterministically to any thesis .docx. New routes expose these capabilities. Chat summary moves to its own table.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, mdocxengine, vitest

**Working directory:** `~/modakerati-server`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/db/norm-profiles.ts` | normProfiles + chatSummaries table definitions |
| Modify | `src/db/schema.ts` | Add normProfileId + analysisReport to theses, keep documents for now |
| Modify | `src/db/index.ts` | Add ensureSchema SQL for new tables/columns, seed norm profiles |
| Create | `src/lib/norm-profiles-seed.ts` | Seed data: 7+ norm profiles from researched Algerian norms |
| Create | `src/lib/thesis-analysis.ts` | Analysis engine: parse .docx → compare against norm profile → suggestions |
| Create | `src/lib/thesis-formatting.ts` | Formatting engine: apply norm profile to .docx deterministically |
| Create | `src/routes/norm-profiles.ts` | GET /api/norm-profiles, GET /api/norm-profiles/:id |
| Modify | `src/routes/thesis.ts` | Add POST /import, GET /:id/analysis, POST /:id/apply, POST /:id/format |
| Modify | `src/lib/chat-memory.ts` | Read/write chatSummaries table instead of theses columns |
| Modify | `src/mcp/server.ts` | Add analyze_thesis, apply_formatting, get_norm_profile tools |
| Modify | `src/index.ts` | Register norm-profiles route, seed norm profiles on startup |
| Create | `vitest.config.ts` | Test configuration |
| Create | `src/__tests__/norm-profiles-seed.test.ts` | Tests for seed data integrity |
| Create | `src/__tests__/thesis-analysis.test.ts` | Tests for analysis engine |
| Create | `src/__tests__/thesis-formatting.test.ts` | Tests for formatting engine |

---

### Task 1: Add vitest test framework

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add devDependency + script)

- [ ] **Step 1: Install vitest**

```bash
cd ~/modakerati-server && npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs**

```bash
cd ~/modakerati-server && npm test
```
Expected: "No test files found" (no tests yet), exit 0.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add vitest test framework"
```

---

### Task 2: Create normProfiles table definition

**Files:**
- Create: `src/db/norm-profiles.ts`

- [ ] **Step 1: Write the normProfiles type and table**

Create `src/db/norm-profiles.ts`:
```typescript
import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// ============================================================
// Norm Profiles — formatting rules per university × language × discipline.
// These are the "template" for how a thesis LOOKS, not its content structure.
// ============================================================

export interface NormFormatting {
  font: string;                  // e.g. "Times New Roman", "Simplified Arabic"
  fontSize: number;              // pt, e.g. 12
  headingSizes: {                // pt per heading level
    h1: number;                  // Partie / Part
    h2: number;                  // Chapitre / Chapter
    h3: number;                  // Section
  };
  headingBold: boolean;
  margins: {
    binding: number;             // cm, the side where the thesis is bound
    opposite: number;            // cm
    top: number;                 // cm
    bottom: number;              // cm
  };
  spacing: number;               // line spacing multiplier, e.g. 1.5
  footnoteFontSize: number;      // pt
  alignment: "justified" | "left" | "right";
  pagination: {
    frontMatter: "roman" | "none";
    body: "arabic";
    position: "center-bottom" | "right-bottom" | "left-bottom";
  };
  tocStyle: "dots" | "plain";
}

export const normProfiles = pgTable("norm_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  university: text("university"),                               // null = generic
  language: text("language").notNull(),                          // fr | ar | en
  discipline: text("discipline").notNull().default("generic"),   // science | law-humanities | generic
  bodyPreset: text("body_preset").notNull().default("chapters"), // imrad | chapters | law-humanities
  citationStyle: text("citation_style").notNull().default("apa"),// apa | footnote-ar | ieee
  bindingSide: text("binding_side").notNull().default("left"),   // left (FR) | right (AR)
  formatting: jsonb("formatting").notNull().$type<NormFormatting>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ============================================================
// Chat Summaries — running conversation summary per thesis.
// Extracted from theses table to keep it focused.
// ============================================================
export const chatSummaries = pgTable("chat_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisId: uuid("thesis_id").notNull().unique(),
  summary: text("summary").notNull().default(""),
  messageCount: integer("message_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

Wait — `integer` import is missing. Fix:

```typescript
import { pgTable, uuid, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Commit**

```bash
git add src/db/norm-profiles.ts
git commit -m "feat: add normProfiles + chatSummaries table definitions"
```

---

### Task 3: Update schema.ts — add columns to theses

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add normProfileId and analysisReport to theses table**

In `src/db/schema.ts`, add import at top:
```typescript
import { normProfiles } from "./norm-profiles";
```

In the `theses` table definition, after line `templateId`:
```typescript
  normProfileId: uuid("norm_profile_id").references(() => normProfiles.id),
  analysisReport: jsonb("analysis_report"),
```

- [ ] **Step 2: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add normProfileId + analysisReport columns to theses"
```

---

### Task 4: Update db/index.ts — ensureSchema + exports

**Files:**
- Modify: `src/db/index.ts`

- [ ] **Step 1: Add ensureSchema SQL for new tables and columns**

In `src/db/index.ts`, add import:
```typescript
import { normProfiles, chatSummaries } from "./norm-profiles";
```

Add re-export at bottom:
```typescript
export * from "./norm-profiles";
```

Inside `ensureSchema()`, append to the SQL template literal (before the closing backtick):
```sql
    CREATE TABLE IF NOT EXISTS norm_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      university text,
      language text NOT NULL,
      discipline text NOT NULL DEFAULT 'generic',
      body_preset text NOT NULL DEFAULT 'chapters',
      citation_style text NOT NULL DEFAULT 'apa',
      binding_side text NOT NULL DEFAULT 'left',
      formatting jsonb NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chat_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thesis_id uuid NOT NULL UNIQUE,
      summary text NOT NULL DEFAULT '',
      message_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz DEFAULT now()
    );

    ALTER TABLE theses ADD COLUMN IF NOT EXISTS norm_profile_id uuid REFERENCES norm_profiles(id);
    ALTER TABLE theses ADD COLUMN IF NOT EXISTS analysis_report jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: ensureSchema for normProfiles, chatSummaries, theses columns"
```

---

### Task 5: Create norm profiles seed data

**Files:**
- Create: `src/lib/norm-profiles-seed.ts`
- Create: `src/__tests__/norm-profiles-seed.test.ts`

- [ ] **Step 1: Write test for seed data integrity**

Create `src/__tests__/norm-profiles-seed.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { NORM_PROFILE_SEEDS } from "../lib/norm-profiles-seed";

describe("norm profile seeds", () => {
  it("has at least 7 profiles", () => {
    expect(NORM_PROFILE_SEEDS.length).toBeGreaterThanOrEqual(7);
  });

  it("every profile has required fields", () => {
    for (const p of NORM_PROFILE_SEEDS) {
      expect(p.name).toBeTruthy();
      expect(["fr", "ar", "en"]).toContain(p.language);
      expect(["science", "law-humanities", "generic"]).toContain(p.discipline);
      expect(["imrad", "chapters", "law-humanities"]).toContain(p.bodyPreset);
      expect(["apa", "footnote-ar", "ieee"]).toContain(p.citationStyle);
      expect(["left", "right"]).toContain(p.bindingSide);
      expect(p.formatting.font).toBeTruthy();
      expect(p.formatting.fontSize).toBeGreaterThan(0);
      expect(p.formatting.margins.binding).toBeGreaterThan(0);
      expect(p.formatting.spacing).toBeGreaterThan(0);
    }
  });

  it("has both French and Arabic profiles", () => {
    const langs = new Set(NORM_PROFILE_SEEDS.map((p) => p.language));
    expect(langs.has("fr")).toBe(true);
    expect(langs.has("ar")).toBe(true);
  });

  it("has both science and law-humanities profiles", () => {
    const discs = new Set(NORM_PROFILE_SEEDS.map((p) => p.discipline));
    expect(discs.has("science")).toBe(true);
    expect(discs.has("law-humanities")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/norm-profiles-seed.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the seed data**

Create `src/lib/norm-profiles-seed.ts`:
```typescript
import type { NormFormatting } from "../db/norm-profiles";

interface NormProfileSeed {
  name: string;
  university: string | null;
  language: string;
  discipline: string;
  bodyPreset: string;
  citationStyle: string;
  bindingSide: string;
  formatting: NormFormatting;
}

const frenchScience: NormFormatting = {
  font: "Times New Roman",
  fontSize: 12,
  headingSizes: { h1: 16, h2: 14, h3: 13 },
  headingBold: true,
  margins: { binding: 3.5, opposite: 1.5, top: 2.5, bottom: 2.5 },
  spacing: 1.5,
  footnoteFontSize: 10,
  alignment: "justified",
  pagination: { frontMatter: "roman", body: "arabic", position: "center-bottom" },
  tocStyle: "dots",
};

const frenchLawHumanities: NormFormatting = {
  font: "Times New Roman",
  fontSize: 12,
  headingSizes: { h1: 16, h2: 14, h3: 13 },
  headingBold: true,
  margins: { binding: 3, opposite: 2, top: 2.5, bottom: 2.5 },
  spacing: 1.5,
  footnoteFontSize: 10,
  alignment: "justified",
  pagination: { frontMatter: "roman", body: "arabic", position: "center-bottom" },
  tocStyle: "dots",
};

const arabicLawHumanities: NormFormatting = {
  font: "Simplified Arabic",
  fontSize: 16,
  headingSizes: { h1: 26, h2: 22, h3: 18 },
  headingBold: true,
  margins: { binding: 3, opposite: 1.5, top: 2, bottom: 2 },
  spacing: 1.5,
  footnoteFontSize: 12,
  alignment: "justified",
  pagination: { frontMatter: "roman", body: "arabic", position: "center-bottom" },
  tocStyle: "dots",
};

const arabicScience: NormFormatting = {
  font: "Simplified Arabic",
  fontSize: 14,
  headingSizes: { h1: 22, h2: 18, h3: 16 },
  headingBold: true,
  margins: { binding: 3, opposite: 2, top: 2, bottom: 2 },
  spacing: 1.5,
  footnoteFontSize: 12,
  alignment: "justified",
  pagination: { frontMatter: "roman", body: "arabic", position: "center-bottom" },
  tocStyle: "dots",
};

export const NORM_PROFILE_SEEDS: NormProfileSeed[] = [
  // ── Generic profiles ──────────────────────────────────────
  {
    name: "Generic French — Science (IMRAD)",
    university: null,
    language: "fr",
    discipline: "science",
    bodyPreset: "imrad",
    citationStyle: "apa",
    bindingSide: "left",
    formatting: frenchScience,
  },
  {
    name: "Generic French — Law & Humanities",
    university: null,
    language: "fr",
    discipline: "law-humanities",
    bodyPreset: "law-humanities",
    citationStyle: "apa",
    bindingSide: "left",
    formatting: frenchLawHumanities,
  },
  {
    name: "Generic Arabic — Law & Humanities",
    university: null,
    language: "ar",
    discipline: "law-humanities",
    bodyPreset: "law-humanities",
    citationStyle: "footnote-ar",
    bindingSide: "right",
    formatting: arabicLawHumanities,
  },
  {
    name: "Generic Arabic — Science",
    university: null,
    language: "ar",
    discipline: "science",
    bodyPreset: "imrad",
    citationStyle: "footnote-ar",
    bindingSide: "right",
    formatting: arabicScience,
  },

  // ── University-specific profiles ──────────────────────────
  {
    name: "Univ. Biskra — Law (Arabic)",
    university: "Université Mohamed Khider Biskra",
    language: "ar",
    discipline: "law-humanities",
    bodyPreset: "law-humanities",
    citationStyle: "footnote-ar",
    bindingSide: "right",
    formatting: {
      ...arabicLawHumanities,
      fontSize: 16,
      headingSizes: { h1: 26, h2: 22, h3: 18 },
      margins: { binding: 3, opposite: 1.5, top: 2, bottom: 2 },
      footnoteFontSize: 12,
    },
  },
  {
    name: "Univ. Constantine 3 — French Science",
    university: "Université Salah Boubnider Constantine 3",
    language: "fr",
    discipline: "science",
    bodyPreset: "imrad",
    citationStyle: "apa",
    bindingSide: "left",
    formatting: {
      ...frenchScience,
      margins: { binding: 3.5, opposite: 1.5, top: 2.5, bottom: 2.5 },
    },
  },
  {
    name: "ENSTI Annaba — French Science",
    university: "ENSTI Annaba",
    language: "fr",
    discipline: "science",
    bodyPreset: "imrad",
    citationStyle: "apa",
    bindingSide: "left",
    formatting: {
      ...frenchScience,
      margins: { binding: 2.5, opposite: 2.5, top: 2.5, bottom: 2.5 },
      spacing: 1.3,
    },
  },
  {
    name: "Univ. Ouargla — French (Generic)",
    university: "Université Kasdi Merbah Ouargla",
    language: "fr",
    discipline: "generic",
    bodyPreset: "chapters",
    citationStyle: "apa",
    bindingSide: "left",
    formatting: {
      ...frenchScience,
      margins: { binding: 3.5, opposite: 1.5, top: 2.5, bottom: 2.5 },
    },
  },
  {
    name: "Univ. El Oued — Arabic (Generic)",
    university: "Université Hamma Lakhdar El Oued",
    language: "ar",
    discipline: "generic",
    bodyPreset: "chapters",
    citationStyle: "footnote-ar",
    bindingSide: "right",
    formatting: {
      ...arabicLawHumanities,
      margins: { binding: 3, opposite: 2, top: 2, bottom: 2 },
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/norm-profiles-seed.test.ts
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/norm-profiles-seed.ts src/__tests__/norm-profiles-seed.test.ts
git commit -m "feat: norm profile seed data — 9 profiles from Algerian university research"
```

---

### Task 6: Wire seed into db/index.ts startup

**Files:**
- Modify: `src/db/index.ts`

- [ ] **Step 1: Add seedNormProfiles function**

In `src/db/index.ts`, add import:
```typescript
import { NORM_PROFILE_SEEDS } from "../lib/norm-profiles-seed";
```

Add function after `seedTemplates`:
```typescript
export async function seedNormProfiles() {
  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(normProfiles)) as { count: number }[];
  if (count > 0) return;

  await db.insert(normProfiles).values(
    NORM_PROFILE_SEEDS.map((p) => ({
      name: p.name,
      university: p.university,
      language: p.language,
      discipline: p.discipline,
      bodyPreset: p.bodyPreset,
      citationStyle: p.citationStyle,
      bindingSide: p.bindingSide,
      formatting: p.formatting,
    }))
  );
  console.log(`Seeded ${NORM_PROFILE_SEEDS.length} norm profiles`);
}
```

- [ ] **Step 2: Call seedNormProfiles in startup chain**

In `src/index.ts`, change the startup sequence:
```typescript
import { ensureSchema, seedNews, seedTemplates, seedNormProfiles } from "./db";
```

Replace the startup chain:
```typescript
ensureSchema()
  .then(() => seedNews())
  .then(() => seedTemplates())
  .then(() => seedNormProfiles())
  .catch((e) => console.error("ensureSchema/seed failed:", e?.message))
  .finally(() => {
    console.log(`Modakerati API running on 0.0.0.0:${port}`);
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/db/index.ts src/index.ts
git commit -m "feat: seed norm profiles on startup"
```

---

### Task 7: Create norm-profiles route

**Files:**
- Create: `src/routes/norm-profiles.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create the route file**

Create `src/routes/norm-profiles.ts`:
```typescript
import { Hono } from "hono";
import { db, normProfiles } from "../db";
import { eq } from "drizzle-orm";
import type { AppVariables } from "../types";

export const normProfileRoutes = new Hono<{ Variables: AppVariables }>();

// GET / — list all norm profiles
normProfileRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      id: normProfiles.id,
      name: normProfiles.name,
      university: normProfiles.university,
      language: normProfiles.language,
      discipline: normProfiles.discipline,
      bodyPreset: normProfiles.bodyPreset,
      citationStyle: normProfiles.citationStyle,
      bindingSide: normProfiles.bindingSide,
    })
    .from(normProfiles)
    .orderBy(normProfiles.name);

  return c.json(rows);
});

// GET /:id — get full profile with formatting
normProfileRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db
    .select()
    .from(normProfiles)
    .where(eq(normProfiles.id, id));

  if (!row) return c.json({ error: "Norm profile not found" }, 404);
  return c.json(row);
});
```

- [ ] **Step 2: Register in index.ts**

In `src/index.ts`, add import:
```typescript
import { normProfileRoutes } from "./routes/norm-profiles";
```

Add route registration after the news route:
```typescript
app.route("/api/norm-profiles", normProfileRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/norm-profiles.ts src/index.ts
git commit -m "feat: GET /api/norm-profiles routes"
```

---

### Task 8: Build thesis analysis engine

**Files:**
- Create: `src/lib/thesis-analysis.ts`
- Create: `src/__tests__/thesis-analysis.test.ts`

- [ ] **Step 1: Write tests for the analysis engine**

Create `src/__tests__/thesis-analysis.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  analyzeStructure,
  analyzeFormatting,
  type ThesisMetadata,
  type Suggestion,
} from "../lib/thesis-analysis";
import type { NormFormatting } from "../db/norm-profiles";

const baseFormatting: NormFormatting = {
  font: "Times New Roman",
  fontSize: 12,
  headingSizes: { h1: 16, h2: 14, h3: 13 },
  headingBold: true,
  margins: { binding: 3.5, opposite: 1.5, top: 2.5, bottom: 2.5 },
  spacing: 1.5,
  footnoteFontSize: 10,
  alignment: "justified",
  pagination: { frontMatter: "roman", body: "arabic", position: "center-bottom" },
  tocStyle: "dots",
};

describe("analyzeStructure", () => {
  it("flags missing introduction", () => {
    const meta: ThesisMetadata = {
      headings: [
        { text: "Partie I", level: 1 },
        { text: "Chapitre 1", level: 2 },
        { text: "Conclusion", level: 1 },
      ],
      hasAbstract: false,
      hasBibliography: false,
      hasToc: false,
      hasListOfFigures: false,
      hasListOfTables: false,
      language: "fr",
      wordCount: 5000,
    };
    const suggestions = analyzeStructure(meta);
    const ids = suggestions.map((s) => s.id);
    expect(ids).toContain("missing-introduction");
    expect(ids).toContain("missing-abstract");
    expect(ids).toContain("missing-bibliography");
    expect(ids).toContain("missing-toc");
  });

  it("returns no structure errors for well-formed thesis", () => {
    const meta: ThesisMetadata = {
      headings: [
        { text: "Introduction Generale", level: 1 },
        { text: "Partie I", level: 1 },
        { text: "Chapitre 1", level: 2 },
        { text: "Conclusion", level: 1 },
      ],
      hasAbstract: true,
      hasBibliography: true,
      hasToc: true,
      hasListOfFigures: true,
      hasListOfTables: true,
      language: "fr",
      wordCount: 15000,
    };
    const suggestions = analyzeStructure(meta);
    const errors = suggestions.filter((s) => s.severity === "error");
    expect(errors).toHaveLength(0);
  });
});

describe("analyzeFormatting", () => {
  it("flags wrong font", () => {
    const detected = { font: "Arial", fontSize: 11, spacing: 1.0 };
    const suggestions = analyzeFormatting(detected, baseFormatting);
    const ids = suggestions.map((s) => s.id);
    expect(ids).toContain("wrong-font");
    expect(ids).toContain("wrong-font-size");
    expect(ids).toContain("wrong-spacing");
  });

  it("returns no errors when formatting matches", () => {
    const detected = { font: "Times New Roman", fontSize: 12, spacing: 1.5 };
    const suggestions = analyzeFormatting(detected, baseFormatting);
    expect(suggestions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/thesis-analysis.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the analysis engine**

Create `src/lib/thesis-analysis.ts`:
```typescript
import type { NormFormatting } from "../db/norm-profiles";

export interface Suggestion {
  id: string;
  category: "structure" | "formatting" | "content";
  severity: "error" | "warning" | "info";
  message: string;
  fix: string | null;
}

export interface ThesisMetadata {
  headings: { text: string; level: number }[];
  hasAbstract: boolean;
  hasBibliography: boolean;
  hasToc: boolean;
  hasListOfFigures: boolean;
  hasListOfTables: boolean;
  language: string;
  wordCount: number;
}

export interface DetectedFormatting {
  font: string;
  fontSize: number;
  spacing: number;
}

export interface AnalysisReport {
  structure: Suggestion[];
  formatting: Suggestion[];
  content: Suggestion[];
}

// ── Structure analysis ──────────────────────────────────────

const INTRO_PATTERNS = /^(introduction|مقدمة)/i;
const CONCLUSION_PATTERNS = /^(conclusion|خاتمة)/i;
const BIBLIO_PATTERNS = /^(bibliograph|références|المراجع|قائمة المراجع)/i;

export function analyzeStructure(meta: ThesisMetadata): Suggestion[] {
  const suggestions: Suggestion[] = [];

  const hasIntro = meta.headings.some((h) => INTRO_PATTERNS.test(h.text.trim()));
  if (!hasIntro) {
    suggestions.push({
      id: "missing-introduction",
      category: "structure",
      severity: "error",
      message: "No introduction section found",
      fix: "insert_introduction",
    });
  }

  const hasConclusion = meta.headings.some((h) => CONCLUSION_PATTERNS.test(h.text.trim()));
  if (!hasConclusion) {
    suggestions.push({
      id: "missing-conclusion",
      category: "structure",
      severity: "error",
      message: "No conclusion section found",
      fix: "insert_conclusion",
    });
  }

  if (!meta.hasAbstract) {
    suggestions.push({
      id: "missing-abstract",
      category: "structure",
      severity: "error",
      message: "No abstract/résumé found",
      fix: "insert_abstract",
    });
  }

  if (!meta.hasBibliography) {
    suggestions.push({
      id: "missing-bibliography",
      category: "structure",
      severity: "error",
      message: "No bibliography/references section found",
      fix: "insert_bibliography",
    });
  }

  if (!meta.hasToc) {
    suggestions.push({
      id: "missing-toc",
      category: "structure",
      severity: "warning",
      message: "No table of contents found",
      fix: "insert_toc",
    });
  }

  if (!meta.hasListOfFigures) {
    suggestions.push({
      id: "missing-list-figures",
      category: "structure",
      severity: "info",
      message: "No list of figures found",
      fix: "insert_list_figures",
    });
  }

  if (!meta.hasListOfTables) {
    suggestions.push({
      id: "missing-list-tables",
      category: "structure",
      severity: "info",
      message: "No list of tables found",
      fix: "insert_list_tables",
    });
  }

  // Check heading hierarchy: should have at least one level-1 heading with level-2 children
  const l1Count = meta.headings.filter((h) => h.level === 1).length;
  const l2Count = meta.headings.filter((h) => h.level === 2).length;
  if (l1Count > 0 && l2Count === 0) {
    suggestions.push({
      id: "no-chapters",
      category: "structure",
      severity: "warning",
      message: "Parts found but no chapters — thesis may lack proper subdivision",
      fix: null,
    });
  }

  return suggestions;
}

// ── Formatting analysis ─────────────────────────────────────

export function analyzeFormatting(
  detected: DetectedFormatting,
  expected: NormFormatting
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (detected.font.toLowerCase() !== expected.font.toLowerCase()) {
    suggestions.push({
      id: "wrong-font",
      category: "formatting",
      severity: "error",
      message: `Font is "${detected.font}", expected "${expected.font}"`,
      fix: "apply_font",
    });
  }

  if (detected.fontSize !== expected.fontSize) {
    suggestions.push({
      id: "wrong-font-size",
      category: "formatting",
      severity: "error",
      message: `Font size is ${detected.fontSize}pt, expected ${expected.fontSize}pt`,
      fix: "apply_font_size",
    });
  }

  if (Math.abs(detected.spacing - expected.spacing) > 0.05) {
    suggestions.push({
      id: "wrong-spacing",
      category: "formatting",
      severity: "warning",
      message: `Line spacing is ${detected.spacing}, expected ${expected.spacing}`,
      fix: "apply_spacing",
    });
  }

  return suggestions;
}

// ── Content analysis ────────────────────────────────────────

export function analyzeContent(meta: ThesisMetadata): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (meta.wordCount < 5000) {
    suggestions.push({
      id: "too-short",
      category: "content",
      severity: "warning",
      message: `Thesis is only ${meta.wordCount} words — typical minimum is 15,000-20,000`,
      fix: null,
    });
  }

  return suggestions;
}

// ── Full analysis ───────────────────────────────────────────

export function buildAnalysisReport(
  meta: ThesisMetadata,
  detected: DetectedFormatting,
  normFormatting: NormFormatting
): AnalysisReport {
  return {
    structure: analyzeStructure(meta),
    formatting: analyzeFormatting(detected, normFormatting),
    content: analyzeContent(meta),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/modakerati-server && npx vitest run src/__tests__/thesis-analysis.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/thesis-analysis.ts src/__tests__/thesis-analysis.test.ts
git commit -m "feat: thesis analysis engine — structure + formatting + content checks"
```

---

### Task 9: Build .docx metadata extractor

**Files:**
- Create: `src/lib/thesis-extractor.ts`

This module bridges mdocxengine output to the analysis engine's `ThesisMetadata` and `DetectedFormatting` types.

- [ ] **Step 1: Implement the extractor**

Create `src/lib/thesis-extractor.ts`:
```typescript
import type { ThesisMetadata, DetectedFormatting } from "./thesis-analysis";

// Extract metadata from mdocxengine's parsed blocks + raw XML.
// `blocks` = engine.body (BodyBlock[]), `documentXml` = raw word/document.xml

interface BodyBlock {
  type: string;
  xml: string;
  text?: string;
  styleId?: string;
}

const ABSTRACT_PATTERNS = /résumé|abstract|ملخص|summary/i;
const BIBLIO_PATTERNS = /bibliograph|références|المراجع|references|قائمة المراجع/i;
const TOC_PATTERNS = /<w:sdt[\s\S]*?docPartGallery[\s\S]*?Table of Contents/i;
const LOF_PATTERNS = /liste?\s+(des\s+)?figures?|قائمة\s+الأشكال|list\s+of\s+figures/i;
const LOT_PATTERNS = /liste?\s+(des\s+)?tableaux?|قائمة\s+الجداول|list\s+of\s+tables/i;

function levelFromStyle(styleId: string | undefined): number {
  if (!styleId) return 0;
  const s = styleId.toLowerCase();
  if (s === "heading1" || s === "titre1") return 1;
  if (s === "heading2" || s === "titre2") return 2;
  if (s === "heading3" || s === "titre3") return 3;
  if (s === "heading4" || s === "titre4") return 4;
  return 0;
}

export function extractMetadata(
  blocks: BodyBlock[],
  documentXml: string,
  language: string
): ThesisMetadata {
  const headings: { text: string; level: number }[] = [];
  let wordCount = 0;
  let hasAbstract = false;
  let hasBibliography = false;
  let hasListOfFigures = false;
  let hasListOfTables = false;

  for (const block of blocks) {
    const text = (block.text ?? "").trim();
    const level = levelFromStyle(block.styleId);

    if (level > 0) {
      headings.push({ text, level });
    }

    if (ABSTRACT_PATTERNS.test(text)) hasAbstract = true;
    if (BIBLIO_PATTERNS.test(text)) hasBibliography = true;
    if (LOF_PATTERNS.test(text)) hasListOfFigures = true;
    if (LOT_PATTERNS.test(text)) hasListOfTables = true;

    // Rough word count
    if (text) wordCount += text.split(/\s+/).filter(Boolean).length;
  }

  const hasToc = TOC_PATTERNS.test(documentXml) ||
    blocks.some((b) => /table\s+(des\s+)?mati[eè]res|فهرس|table\s+of\s+contents/i.test(b.text ?? ""));

  return {
    headings,
    hasAbstract,
    hasBibliography,
    hasToc,
    hasListOfFigures,
    hasListOfTables,
    language,
    wordCount,
  };
}

// Detect dominant font, size, spacing from raw document.xml
export function extractFormatting(documentXml: string): DetectedFormatting {
  // Count font occurrences — most frequent wins
  const fontCounts = new Map<string, number>();
  const fontMatches = documentXml.matchAll(/<w:rFonts[^>]*w:ascii="([^"]+)"/g);
  for (const m of fontMatches) {
    const font = m[1];
    fontCounts.set(font, (fontCounts.get(font) ?? 0) + 1);
  }
  let dominantFont = "Times New Roman";
  let maxCount = 0;
  for (const [font, count] of fontCounts) {
    if (count > maxCount) {
      dominantFont = font;
      maxCount = count;
    }
  }

  // Detect dominant font size (w:sz is in half-points)
  const sizeCounts = new Map<number, number>();
  const sizeMatches = documentXml.matchAll(/<w:sz\s+w:val="(\d+)"/g);
  for (const m of sizeMatches) {
    const pt = parseInt(m[1], 10) / 2;
    sizeCounts.set(pt, (sizeCounts.get(pt) ?? 0) + 1);
  }
  let dominantSize = 12;
  maxCount = 0;
  for (const [size, count] of sizeCounts) {
    if (count > maxCount) {
      dominantSize = size;
      maxCount = count;
    }
  }

  // Detect line spacing (w:spacing w:line in 240ths of a line)
  const spacingMatches = documentXml.matchAll(/<w:spacing[^>]*w:line="(\d+)"/g);
  const spacings: number[] = [];
  for (const m of spacingMatches) {
    spacings.push(parseInt(m[1], 10) / 240);
  }
  const dominantSpacing = spacings.length > 0
    ? spacings.sort((a, b) =>
        spacings.filter((v) => v === b).length - spacings.filter((v) => v === a).length
      )[0]
    : 1.5;

  return {
    font: dominantFont,
    fontSize: dominantSize,
    spacing: Math.round(dominantSpacing * 100) / 100,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/thesis-extractor.ts
git commit -m "feat: .docx metadata + formatting extractor for analysis pipeline"
```

---

### Task 10: Build formatting engine

**Files:**
- Create: `src/lib/thesis-formatting.ts`

- [ ] **Step 1: Implement the formatting engine**

Create `src/lib/thesis-formatting.ts`:
```typescript
import type { NormFormatting } from "../db/norm-profiles";

// Apply a norm profile's formatting to a .docx via raw OOXML manipulation.
// This is Stage 4 of the pipeline — deterministic, no AI involved.

// Convert cm to EMU (English Metric Units, used in OOXML)
function cmToTwips(cm: number): number {
  return Math.round(cm * 567);
}

// Convert pt to half-points (used in w:sz)
function ptToHalfPoints(pt: number): number {
  return pt * 2;
}

// Convert line spacing multiplier to 240ths (used in w:spacing w:line)
function spacingTo240ths(multiplier: number): number {
  return Math.round(multiplier * 240);
}

export interface FormattingResult {
  applied: string[];
  skipped: string[];
}

// Apply font to all runs in the document
function applyFont(xml: string, formatting: NormFormatting): string {
  const font = formatting.font;
  const isArabic = font === "Simplified Arabic" || font === "Traditional Arabic";

  // Replace existing rFonts
  xml = xml.replace(
    /<w:rFonts[^/]*\/>/g,
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"${isArabic ? ` w:cs="${font}"` : ""}/>`
  );

  return xml;
}

// Apply font size to body text (not headings — those are handled separately)
function applyFontSize(xml: string, formatting: NormFormatting): string {
  const halfPt = ptToHalfPoints(formatting.fontSize);
  // Replace w:sz in normal paragraph runs
  xml = xml.replace(/<w:sz\s+w:val="\d+"/g, `<w:sz w:val="${halfPt}"`);
  xml = xml.replace(/<w:szCs\s+w:val="\d+"/g, `<w:szCs w:val="${halfPt}"`);
  return xml;
}

// Apply line spacing
function applySpacing(xml: string, formatting: NormFormatting): string {
  const lineVal = spacingTo240ths(formatting.spacing);
  xml = xml.replace(
    /<w:spacing([^/]*?)w:line="\d+"([^/]*?)\/>/g,
    `<w:spacing$1w:line="${lineVal}"$2/>`
  );
  return xml;
}

// Apply margins to section properties
function applyMargins(xml: string, formatting: NormFormatting): string {
  const { binding, opposite, top, bottom } = formatting.margins;
  const bindingSide = formatting.alignment === "right" ? "right" : "left";

  const leftMargin = bindingSide === "left" ? cmToTwips(binding) : cmToTwips(opposite);
  const rightMargin = bindingSide === "left" ? cmToTwips(opposite) : cmToTwips(binding);

  xml = xml.replace(
    /<w:pgMar[^/]*\/>/g,
    `<w:pgMar w:top="${cmToTwips(top)}" w:right="${rightMargin}" w:bottom="${cmToTwips(bottom)}" w:left="${leftMargin}" w:header="720" w:footer="720" w:gutter="0"/>`
  );

  return xml;
}

// Main formatting function — applies norm profile to raw document.xml
export function applyFormattingToXml(
  documentXml: string,
  formatting: NormFormatting,
  bindingSide: string
): { xml: string; result: FormattingResult } {
  const applied: string[] = [];
  const skipped: string[] = [];
  let xml = documentXml;

  try {
    xml = applyFont(xml, formatting);
    applied.push("font");
  } catch {
    skipped.push("font");
  }

  try {
    xml = applyFontSize(xml, formatting);
    applied.push("fontSize");
  } catch {
    skipped.push("fontSize");
  }

  try {
    xml = applySpacing(xml, formatting);
    applied.push("spacing");
  } catch {
    skipped.push("spacing");
  }

  try {
    xml = applyMargins(xml, { ...formatting, alignment: bindingSide === "right" ? "right" : "justified" });
    applied.push("margins");
  } catch {
    skipped.push("margins");
  }

  return { xml, result: { applied, skipped } };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/thesis-formatting.ts
git commit -m "feat: deterministic formatting engine — Stage 4 of pipeline"
```

---

### Task 11: Add import + analysis + apply + format endpoints to thesis routes

**Files:**
- Modify: `src/routes/thesis.ts`

- [ ] **Step 1: Add imports at top of thesis.ts**

Add to the imports in `src/routes/thesis.ts`:
```typescript
import { normProfiles } from "../db";
import { buildAnalysisReport } from "../lib/thesis-analysis";
import { extractMetadata, extractFormatting } from "../lib/thesis-extractor";
import { applyFormattingToXml } from "../lib/thesis-formatting";
import { uploadDocx, downloadDocx } from "../lib/document-storage";
```

- [ ] **Step 2: Add POST /import endpoint**

Add before the existing `POST /` handler:
```typescript
// POST /import — Import .docx as a new thesis (Flow B)
thesisRoutes.post("/import", async (c) => {
  const userId = c.get("userId");
  const { base64, filename, language, normProfileId } = await c.req.json<{
    base64: string;
    filename: string;
    language?: string;
    normProfileId?: string;
  }>();

  if (!base64 || !filename) {
    return c.json({ error: "base64 and filename are required" }, 400);
  }

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 50 * 1024 * 1024) {
    return c.json({ error: "File too large (max 50MB)" }, 400);
  }

  // Create thesis row
  const title = filename.replace(/\.docx$/i, "").replace(/[-_]/g, " ");
  const [thesis] = await db
    .insert(theses)
    .values({
      userId,
      title,
      language: language || "fr",
      status: "active",
      normProfileId: normProfileId || null,
    })
    .returning();

  // Upload .docx to storage
  const docPath = `theses/${userId}/${thesis.id}/working.docx`;
  await uploadDocx(docPath, buffer);
  await db.update(theses).set({ docPath }).where(eq(theses.id, thesis.id));

  // Run analysis if norm profile provided
  let analysisReport = null;
  if (normProfileId) {
    const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, normProfileId));
    if (profile) {
      const { loadThesisEngine } = await import("../lib/thesis-doc");
      const engine = await loadThesisEngine(docPath);
      const docXml = engine.zip.readAsText("word/document.xml") || "";
      const meta = extractMetadata(engine.body, docXml, language || "fr");
      const detected = extractFormatting(docXml);
      analysisReport = buildAnalysisReport(meta, detected, profile.formatting as any);
      await db.update(theses).set({ analysisReport }).where(eq(theses.id, thesis.id));
    }
  }

  return c.json({ thesis: { ...thesis, docPath, analysisReport }, analysisReport }, 201);
});
```

- [ ] **Step 3: Add GET /:id/analysis endpoint**

```typescript
// GET /:id/analysis — get stored analysis report
thesisRoutes.get("/:id/analysis", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [thesis] = await db
    .select({ analysisReport: theses.analysisReport })
    .from(theses)
    .where(and(eq(theses.id, id), eq(theses.userId, userId)));

  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  return c.json(thesis.analysisReport || { structure: [], formatting: [], content: [] });
});
```

- [ ] **Step 4: Add POST /:id/apply endpoint**

```typescript
// POST /:id/apply — apply accepted suggestions (re-analyze after)
thesisRoutes.post("/:id/apply", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { acceptedIds } = await c.req.json<{ acceptedIds: string[] }>();

  const [thesis] = await db
    .select()
    .from(theses)
    .where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  if (!thesis.docPath) return c.json({ error: "No document to apply suggestions to" }, 400);

  // For now, formatting fixes are applied via the /format endpoint.
  // Structure fixes (insert sections) will be handled by AI tools.
  // This endpoint records which suggestions were accepted.
  const report = (thesis.analysisReport as any) || { structure: [], formatting: [], content: [] };
  const accepted = [
    ...report.structure.filter((s: any) => acceptedIds.includes(s.id)),
    ...report.formatting.filter((s: any) => acceptedIds.includes(s.id)),
    ...report.content.filter((s: any) => acceptedIds.includes(s.id)),
  ];

  // If any formatting fixes were accepted, apply them
  const formattingFixes = accepted.filter((s: any) => s.category === "formatting");
  if (formattingFixes.length > 0 && thesis.normProfileId) {
    const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, thesis.normProfileId));
    if (profile) {
      const { loadThesisEngine } = await import("../lib/thesis-doc");
      const engine = await loadThesisEngine(thesis.docPath);
      const docXml = engine.zip.readAsText("word/document.xml") || "";
      const { xml } = applyFormattingToXml(docXml, profile.formatting as any, profile.bindingSide);
      engine.zip.writeText("word/document.xml", xml);
      const newBuffer = engine.zip.toBuffer();
      await uploadDocx(thesis.docPath, newBuffer);
    }
  }

  return c.json({ applied: accepted.map((s: any) => s.id) });
});
```

- [ ] **Step 5: Add POST /:id/format endpoint**

```typescript
// POST /:id/format — apply full formatting pass (Stage 4)
thesisRoutes.post("/:id/format", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const [thesis] = await db
    .select()
    .from(theses)
    .where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  if (!thesis.docPath) return c.json({ error: "No document to format" }, 400);

  // Determine norm profile to use
  let profileId = thesis.normProfileId;
  const bodyProfileId = (await c.req.json().catch(() => ({})) as any).normProfileId;
  if (bodyProfileId) profileId = bodyProfileId;

  if (!profileId) {
    return c.json({ error: "No norm profile assigned — pick a template or norm profile first" }, 400);
  }

  const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, profileId));
  if (!profile) return c.json({ error: "Norm profile not found" }, 404);

  const { loadThesisEngine } = await import("../lib/thesis-doc");
  const engine = await loadThesisEngine(thesis.docPath);
  const docXml = engine.zip.readAsText("word/document.xml") || "";

  const { xml, result } = applyFormattingToXml(docXml, profile.formatting as any, profile.bindingSide);
  engine.zip.writeText("word/document.xml", xml);
  const newBuffer = engine.zip.toBuffer();
  await uploadDocx(thesis.docPath, newBuffer);

  // Update norm profile reference if changed
  if (profileId !== thesis.normProfileId) {
    await db.update(theses).set({ normProfileId: profileId }).where(eq(theses.id, thesis.id));
  }

  return c.json({ formatted: true, ...result });
});
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/thesis.ts
git commit -m "feat: import + analysis + apply + format endpoints on thesis routes"
```

---

### Task 12: Migrate chat-memory to chatSummaries table

**Files:**
- Modify: `src/lib/chat-memory.ts`

- [ ] **Step 1: Update buildChatContext to read from chatSummaries**

Replace the contents of `src/lib/chat-memory.ts`:
```typescript
import { db, chatMessages, theses } from "../db";
import { chatSummaries } from "../db/norm-profiles";
import { eq, asc } from "drizzle-orm";
import type { AIProvider, ChatMessage } from "./ai";

const KEEP_RECENT = 8;
const SUMMARIZE_TRIGGER = 14;

export async function buildChatContext(thesisId: string): Promise<ChatMessage[]> {
  // Try new chatSummaries table first, fall back to legacy theses columns
  const [summaryRow] = await db
    .select({ summary: chatSummaries.summary, messageCount: chatSummaries.messageCount })
    .from(chatSummaries)
    .where(eq(chatSummaries.thesisId, thesisId));

  // Legacy fallback: read from theses table if no chatSummaries row exists
  let summarizedCount = summaryRow?.messageCount ?? 0;
  let summary = summaryRow?.summary || null;

  if (!summaryRow) {
    const [thesis] = await db
      .select({ summary: theses.chatSummary, summarizedCount: theses.chatSummaryCount })
      .from(theses)
      .where(eq(theses.id, thesisId));
    summarizedCount = thesis?.summarizedCount ?? 0;
    summary = thesis?.summary || null;
  }

  const tail = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.thesisId, thesisId))
    .orderBy(asc(chatMessages.createdAt))
    .offset(summarizedCount);

  const messages: ChatMessage[] = [];
  if (summary) {
    messages.push({
      role: "system",
      content: `Summary of the earlier conversation so far:\n${summary}`,
    });
  }
  for (const m of tail) {
    messages.push({ role: m.role as ChatMessage["role"], content: m.content });
  }
  return messages;
}

export async function maybeSummarize(
  thesisId: string,
  provider: AIProvider,
  model?: string
): Promise<void> {
  // Read from chatSummaries, fall back to theses
  let [summaryRow] = await db
    .select()
    .from(chatSummaries)
    .where(eq(chatSummaries.thesisId, thesisId));

  let summarizedCount = summaryRow?.messageCount ?? 0;
  let existingSummary = summaryRow?.summary || null;

  if (!summaryRow) {
    const [thesis] = await db
      .select({ summary: theses.chatSummary, summarizedCount: theses.chatSummaryCount })
      .from(theses)
      .where(eq(theses.id, thesisId));
    summarizedCount = thesis?.summarizedCount ?? 0;
    existingSummary = thesis?.summary || null;
  }

  const tail = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.thesisId, thesisId))
    .orderBy(asc(chatMessages.createdAt))
    .offset(summarizedCount);

  if (tail.length <= SUMMARIZE_TRIGGER) return;

  const toFold = tail.slice(0, tail.length - KEEP_RECENT);
  if (toFold.length === 0) return;

  const transcript = toFold.map((m) => `${m.role}: ${m.content}`).join("\n");
  const result = await provider.chat(
    [
      {
        role: "user",
        content:
          (existingSummary ? `Existing summary:\n${existingSummary}\n\n` : "") +
          `Update the running summary of this thesis-assistant conversation. ` +
          `Write it in the conversation's language, max ~200 words, capturing the ` +
          `thesis topic, decisions made, outline/structure choices, and any facts ` +
          `needed to keep helping. New messages to fold in:\n\n${transcript}`,
      },
    ],
    {
      model,
      maxTokens: 400,
      temperature: 0.3,
      systemPrompt: "You compress conversations into compact, factual running summaries.",
    }
  );

  const newCount = summarizedCount + toFold.length;

  // Write to chatSummaries table (upsert)
  if (summaryRow) {
    await db
      .update(chatSummaries)
      .set({ summary: result.content, messageCount: newCount, updatedAt: new Date() })
      .where(eq(chatSummaries.thesisId, thesisId));
  } else {
    await db.insert(chatSummaries).values({
      thesisId,
      summary: result.content,
      messageCount: newCount,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/chat-memory.ts
git commit -m "refactor: migrate chat-memory to chatSummaries table (legacy fallback kept)"
```

---

### Task 13: Add MCP tools — analyze_thesis, apply_formatting, get_norm_profile

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Add imports to server.ts**

Add at the top of `src/mcp/server.ts`:
```typescript
import { normProfiles } from "../db";
import { buildAnalysisReport } from "../lib/thesis-analysis";
import { extractMetadata, extractFormatting } from "../lib/thesis-extractor";
import { applyFormattingToXml } from "../lib/thesis-formatting";
```

- [ ] **Step 2: Add get_norm_profile tool**

Add in the tool registration section:
```typescript
server.tool(
  "get_norm_profile",
  "Get the formatting norms (font, margins, spacing, citation style) assigned to this thesis or a specific profile",
  { userId: { type: "string" }, thesisId: { type: "string" }, profileId: { type: "string", description: "Optional: specific profile ID. If omitted, uses the thesis's assigned profile." } },
  async ({ userId, thesisId, profileId }) => {
    let id = profileId;
    if (!id) {
      const [thesis] = await db.select({ normProfileId: theses.normProfileId }).from(theses).where(eq(theses.id, thesisId));
      id = thesis?.normProfileId ?? undefined;
    }
    if (!id) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No norm profile assigned" }) }] };
    const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, id));
    if (!profile) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Profile not found" }) }] };
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, profile }) }] };
  }
);
```

- [ ] **Step 3: Add analyze_thesis tool**

```typescript
server.tool(
  "analyze_thesis",
  "Analyze the thesis document against its norm profile — checks structure, formatting, and content quality. Returns categorized suggestions.",
  { userId: { type: "string" }, thesisId: { type: "string" } },
  async ({ userId, thesisId }) => {
    const guard = await requireLiveThesis(thesisId, userId);
    if (!guard.ok) return guard.reply;
    const { thesis } = guard;

    if (!thesis.normProfileId) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No norm profile assigned — ask the user to pick one first" }) }] };
    }

    const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, thesis.normProfileId));
    if (!profile) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Norm profile not found" }) }] };

    const { loadThesisEngine } = await import("../lib/thesis-doc");
    const engine = await loadThesisEngine(thesis.docPath!);
    const docXml = engine.zip.readAsText("word/document.xml") || "";
    const meta = extractMetadata(engine.body, docXml, thesis.language || "fr");
    const detected = extractFormatting(docXml);
    const report = buildAnalysisReport(meta, detected, profile.formatting as any);

    await db.update(theses).set({ analysisReport: report }).where(eq(theses.id, thesisId));

    return { content: [{ type: "text", text: JSON.stringify({ ok: true, report }) }] };
  }
);
```

- [ ] **Step 4: Add apply_formatting tool**

```typescript
server.tool(
  "apply_formatting",
  "Apply the thesis's norm profile formatting (font, margins, spacing) to the document deterministically. This is Stage 4 of the pipeline.",
  { userId: { type: "string" }, thesisId: { type: "string" } },
  async ({ userId, thesisId }) => {
    const guard = await requireLiveThesis(thesisId, userId);
    if (!guard.ok) return guard.reply;
    const { thesis } = guard;

    if (!thesis.normProfileId) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No norm profile assigned" }) }] };
    }

    const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, thesis.normProfileId));
    if (!profile) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Norm profile not found" }) }] };

    const { loadThesisEngine } = await import("../lib/thesis-doc");
    const engine = await loadThesisEngine(thesis.docPath!);
    const docXml = engine.zip.readAsText("word/document.xml") || "";

    const { xml, result } = applyFormattingToXml(docXml, profile.formatting as any, profile.bindingSide);
    engine.zip.writeText("word/document.xml", xml);
    const newBuffer = engine.zip.toBuffer();

    const { uploadDocx } = await import("../lib/document-storage");
    await uploadDocx(thesis.docPath!, newBuffer);

    return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...result }) }] };
  }
);
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: MCP tools — analyze_thesis, apply_formatting, get_norm_profile"
```

---

### Task 14: Verify build compiles

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compiler**

```bash
cd ~/modakerati-server && npx tsc --noEmit
```
Expected: no errors. If there are errors, fix them.

- [ ] **Step 2: Run all tests**

```bash
cd ~/modakerati-server && npm test
```
Expected: all tests pass.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve TypeScript/test issues from Phase 1"
```
(Skip if no fixes needed.)

---

### Task 15: Final commit — Phase 1 complete

- [ ] **Step 1: Verify everything is committed**

```bash
cd ~/modakerati-server && git status
```
Expected: clean working tree.

- [ ] **Step 2: Tag the milestone**

```bash
git tag phase1-server-pipeline-engine
```

---

## Phase 1 Deliverables Checklist

- [ ] `normProfiles` table with 9 seeded profiles (Algerian university norms)
- [ ] `chatSummaries` table (extracted from theses)
- [ ] `theses.normProfileId` + `theses.analysisReport` columns
- [ ] `GET /api/norm-profiles` + `GET /api/norm-profiles/:id` routes
- [ ] `POST /api/thesis/import` — upload .docx, create thesis, run analysis
- [ ] `GET /api/thesis/:id/analysis` — retrieve stored analysis report
- [ ] `POST /api/thesis/:id/apply` — apply accepted suggestions
- [ ] `POST /api/thesis/:id/format` — deterministic formatting pass (Stage 4)
- [ ] MCP tools: `analyze_thesis`, `apply_formatting`, `get_norm_profile`
- [ ] Chat memory migrated to `chatSummaries` table
- [ ] vitest setup + passing tests
- [ ] TypeScript compiles clean
