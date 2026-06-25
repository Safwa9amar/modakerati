# Thesis Foundation P0 — Data Model + Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the thesis data model to the correct domain hierarchy — `thesis → sections (Partie, top container) → chapters (Chapitre, content-bearing) → numbered headings inside markdown` — across the Drizzle DB, server routes, MCP tools, and the Expo app types/stores, and turn `templates` into per-university "formatting profiles".

**Architecture:** This **inverts the current DB table meanings** (today `chapters`=top, `sections`=leaf-with-content). Because the app is pre-production, we migrate via a **one-time `tsx` script that drops & recreates** the two tables with their new shape (guarded by a row-count check that aborts unless `--force`). `schema.ts` becomes the new source of truth; the project's runtime `ensureSchema()` is updated to additively guarantee the new columns going forward. The server's nested serializer, all chapter/section MCP tools, and the app's `Thesis`/`Chapter`/`Section` types + `thesis-store` are re-wired to the new nesting. **P1 (norm-compliant `.docx` export) is a separate follow-up plan** that builds on this model; this plan only keeps the existing export compiling against the new shape.

**Tech Stack:** Hono + Drizzle ORM (node-postgres) + Postgres (Supabase) on the server; Zod for MCP tool schemas; Zustand + Expo Router on the app. **No unit-test runner exists** — the repo verifies with `tsx` scripts that hit the dev database and clean up after themselves (see `~/modakerati-server/scripts/test-export.ts`). We follow that exact pattern; "write the failing test" means "write a `tsx` assertion script and run it".

**Repos / absolute roots:**
- Server: `/Users/hamzasafwan/modakerati-server`
- App: `/Users/hamzasafwan/modakerati`

**Domain reference:** `/Users/hamzasafwan/modakerati/docs/superpowers/specs/2026-06-23-thesis-guided-creation-design.md` (§4) and `/Users/hamzasafwan/modakerati/docs/research/2026-06-23-algerian-thesis-norms.md`.

---

## Target schema (the shape every task builds toward)

```
theses        (unchanged + frontMatter jsonb, resume jsonb)
  └─ sections (NEW top container = "Partie")
        id, thesisId→theses, title, kind, content?(markdown, nullable), orderIndex, createdAt, updatedAt
        kind ∈ {introduction, section, conclusion}
     └─ chapters (now the CONTENT leaf = "Chapitre")
           id, sectionId→sections, title, content(markdown), orderIndex, wordCount, status, createdAt, updatedAt

templates  (+ discipline, bindingSide, citationStyle, bodyPreset, frontMatter jsonb, structure jsonb, styleMap jsonb)
references (unchanged)
chat_messages (sectionId now → sections(top); chapterId now → chapters(leaf))
```

> **⚠️ Naming inversion:** after this plan the table named `chapters` has a `section_id` FK (a chapter belongs to a section). This is intentional and matches the user's domain vocabulary (Section = Partie = top). Do not "fix" it.

---

## Task 0: Branch + baseline build

**Files:** none (git + build check)

- [ ] **Step 1: Create a feature branch in BOTH repos**

```bash
cd /Users/hamzasafwan/modakerati-server && git checkout -b feat/thesis-hierarchy-p0
cd /Users/hamzasafwan/modakerati && git checkout -b feat/thesis-hierarchy-p0
```

- [ ] **Step 2: Confirm the server type-checks before changes (baseline)**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit
```
Expected: exits 0 (no errors). If there are pre-existing errors, note them — they are NOT ours to fix, but record the baseline so we can tell new errors apart.

- [ ] **Step 3: Commit the branch point (no changes yet)**

No commit needed yet; proceed to Task 1.

---

## Task 1: Pre-flight data-volume guard

**Files:**
- Create: `/Users/hamzasafwan/modakerati-server/scripts/check-thesis-data.ts`

This script tells us whether the destructive migration is safe. We run it BEFORE migrating.

- [ ] **Step 1: Write the check script**

```typescript
// /Users/hamzasafwan/modakerati-server/scripts/check-thesis-data.ts
/**
 * Reports row counts for the tables the hierarchy migration will drop & recreate.
 *   npx tsx scripts/check-thesis-data.ts
 * Exit code 0 = safe (no rows). Exit code 2 = data present (migration needs --force).
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

async function count(table: string): Promise<number> {
  const r = (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as any;
  // node-postgres returns { rows: [{ n }] }
  return r.rows?.[0]?.n ?? 0;
}

async function main() {
  const tables = ["chapters", "sections", "chat_messages"];
  let total = 0;
  for (const t of tables) {
    const n = await count(t);
    total += n;
    console.log(`${t}: ${n} rows`);
  }
  if (total === 0) {
    console.log("\nSAFE: no rows — drop & recreate migration can run without data loss.");
    process.exit(0);
  } else {
    console.log(`\nDATA PRESENT (${total} rows). The migration is destructive; run it with --force only after confirming this data is disposable.`);
    process.exit(2);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/check-thesis-data.ts
```
Expected: prints per-table counts. Note the result. If exit code is 2 (data present), STOP and confirm with the user before continuing — the migration will erase that data.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add scripts/check-thesis-data.ts
git commit -m "chore: add pre-migration data-volume check script"
```

---

## Task 2: Redefine the Drizzle schema (sections=top, chapters=leaf)

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/db/schema.ts` (tables `chapters` ~67-74, `sections` ~79-89, `theses` ~45-62, `templates` ~30-40, `chatMessages` ~114-122)

- [ ] **Step 1: Replace the `chapters` and `sections` table definitions**

Find the current definitions (chapters references `theses`; sections references `chapters`). Replace BOTH with the inverted shape. `sections` must be declared BEFORE `chapters` (chapters now references sections):

```typescript
// Sections = TOP container ("Partie"). Declared before chapters (chapters FK -> sections).
export const sections = pgTable("sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisId: uuid("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").default("section"), // introduction | section | conclusion
  content: text("content"),              // nullable markdown (intro/conclusion-style sections)
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Chapters = CONTENT leaf ("Chapitre"), belongs to a section.
export const chapters = pgTable("chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").default(""), // markdown: #/##/### headings, tables, figures
  orderIndex: integer("order_index").notNull().default(0),
  wordCount: integer("word_count").default(0),
  status: text("status").default("not_started"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

- [ ] **Step 2: Add `frontMatter` + `resume` to the `theses` table**

Inside the existing `theses = pgTable("theses", { ... })`, add two columns before `createdAt`:

```typescript
  frontMatter: jsonb("front_matter").default({}),
  resume: jsonb("resume").default([]),
```
(`jsonb` is already imported — it is used by `templates`/`news`. If not imported, add it to the `drizzle-orm/pg-core` import.)

- [ ] **Step 3: Extend the `templates` table into a formatting profile**

Inside `templates = pgTable("templates", { ... })`, add after `chapterStructure`:

```typescript
  discipline: text("discipline").default("generic"),       // science | law-humanities | generic
  bindingSide: text("binding_side").default("left"),       // left (FR/Latin) | right (AR/RTL)
  citationStyle: text("citation_style").default("apa"),    // apa | footnote-ar
  bodyPreset: text("body_preset").default("chapters"),     // imrad | chapters | law-humanities
  frontMatter: jsonb("front_matter").default({}),          // page-de-garde fields + flags
  structure: jsonb("structure").default({}),               // { sectionLabel, chapterLabel }
  styleMap: jsonb("style_map").default({}),                // docx outline mapping
```

- [ ] **Step 4: Re-point `chat_messages` FKs to the new tables**

In `chatMessages = pgTable("chat_messages", { ... })`, the columns `chapterId` and `sectionId` keep their names but now mean: `sectionId` → a top section, `chapterId` → a leaf chapter. The Drizzle references must compile against the new tables (they already point at `chapters`/`sections` by symbol, so they will resolve to the new definitions automatically). Confirm the lines read:

```typescript
  chapterId: uuid("chapter_id").references(() => chapters.id), // leaf chapter
  sectionId: uuid("section_id").references(() => sections.id), // top section
```
No change needed if they already reference the symbols; just verify.

- [ ] **Step 5: Type-check**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit
```
Expected: NEW errors appear in `src/routes/thesis.ts`, `src/lib/thesis-export.ts`, `src/lib/docx.ts`, `src/lib/latex.ts`, and `src/mcp/server.ts` (they reference the old shape, e.g. `chapters.thesisId`, `sections.chapterId`). That is expected — later tasks fix each. The schema file itself must have NO errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/db/schema.ts
git commit -m "feat(schema): invert hierarchy — sections(top) -> chapters(content); template profile + thesis front matter"
```

---

## Task 3: One-time migration script (drop & recreate)

**Files:**
- Create: `/Users/hamzasafwan/modakerati-server/scripts/migrate-hierarchy.ts`

- [ ] **Step 1: Write the migration script**

```typescript
// /Users/hamzasafwan/modakerati-server/scripts/migrate-hierarchy.ts
/**
 * One-time migration: invert thesis hierarchy to sections(top) -> chapters(content).
 * DESTRUCTIVE: drops & recreates the chapters/sections tables (pre-production).
 *
 *   npx tsx scripts/migrate-hierarchy.ts            # dry-run: prints plan + row counts
 *   npx tsx scripts/migrate-hierarchy.ts --force    # actually run
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const FORCE = process.argv.includes("--force");

async function rowCount(table: string): Promise<number> {
  const r = (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as any;
  return r.rows?.[0]?.n ?? 0;
}

async function main() {
  const before = {
    chapters: await rowCount("chapters"),
    sections: await rowCount("sections"),
  };
  console.log("Current rows:", before);

  if (!FORCE) {
    console.log("\nDRY RUN. Re-run with --force to drop & recreate. The migration will:");
    console.log(" 1. NULL chat_messages.chapter_id / section_id (orphaned by the swap)");
    console.log(" 2. DROP TABLE chapters, sections (CASCADE)");
    console.log(" 3. CREATE sections(top: thesis_id, kind, content?) + chapters(leaf: section_id, content)");
    console.log(" 4. Re-add chat_messages FKs to the new tables");
    console.log(" 5. ADD theses.front_matter/resume + templates profile columns (IF NOT EXISTS)");
    process.exit(0);
  }

  if (before.chapters + before.sections > 0) {
    console.warn(`\n⚠️  ${before.chapters + before.sections} rows will be ERASED.`);
  }

  // Postgres runs each statement; we wrap destructive steps in a transaction.
  await db.execute(sql.raw(`
    BEGIN;

    -- 1. Orphan chat_messages refs (they pointed at old tables).
    UPDATE chat_messages SET chapter_id = NULL, section_id = NULL;
    ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_chapter_id_chapters_id_fk;
    ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_section_id_sections_id_fk;

    -- 2. Drop old tables (sections referenced chapters → CASCADE handles order).
    DROP TABLE IF EXISTS sections CASCADE;
    DROP TABLE IF EXISTS chapters CASCADE;

    -- 3a. New top container = sections.
    CREATE TABLE sections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thesis_id uuid NOT NULL REFERENCES theses (id) ON DELETE CASCADE,
      title text NOT NULL,
      kind text DEFAULT 'section',
      content text,
      order_index integer NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE INDEX idx_sections_thesis ON sections (thesis_id, order_index);

    -- 3b. New content leaf = chapters (belongs to a section).
    CREATE TABLE chapters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      section_id uuid NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
      title text NOT NULL,
      content text DEFAULT '',
      order_index integer NOT NULL DEFAULT 0,
      word_count integer DEFAULT 0,
      status text DEFAULT 'not_started',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE INDEX idx_chapters_section ON chapters (section_id, order_index);

    -- 4. Re-add chat_messages FKs to the new tables.
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_section_id_sections_id_fk
      FOREIGN KEY (section_id) REFERENCES sections (id);
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_chapter_id_chapters_id_fk
      FOREIGN KEY (chapter_id) REFERENCES chapters (id);

    -- 5. Additive columns on theses + templates.
    ALTER TABLE theses ADD COLUMN IF NOT EXISTS front_matter jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE theses ADD COLUMN IF NOT EXISTS resume jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS discipline text DEFAULT 'generic';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS binding_side text DEFAULT 'left';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS citation_style text DEFAULT 'apa';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS body_preset text DEFAULT 'chapters';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS front_matter jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS structure jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS style_map jsonb DEFAULT '{}'::jsonb;

    COMMIT;
  `));

  console.log("\n✅ Migration complete. New tables:");
  console.log("   sections:", await rowCount("sections"), "| chapters:", await rowCount("chapters"));
  process.exit(0);
}
main().catch((e) => { console.error("Migration failed (rolled back):", e); process.exit(1); });
```

- [ ] **Step 2: Dry-run it**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/migrate-hierarchy.ts
```
Expected: prints current row counts + the 5-step plan, exits 0. No DB changes yet.

- [ ] **Step 3: Run for real**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/migrate-hierarchy.ts --force
```
Expected: "✅ Migration complete. New tables: sections: 0 | chapters: 0".

- [ ] **Step 4: Verify the new shape**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx -e "import 'dotenv/config'; import {sql} from 'drizzle-orm'; import {db} from './src/db'; const r = await db.execute(sql.raw(\"SELECT column_name FROM information_schema.columns WHERE table_name='chapters' ORDER BY ordinal_position\")); console.log((r as any).rows.map((x:any)=>x.column_name).join(', ')); process.exit(0);"
```
Expected output includes `section_id` and `content` (proving chapters is now the content leaf under sections).

- [ ] **Step 5: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add scripts/migrate-hierarchy.ts
git commit -m "feat(db): one-time migration to invert thesis hierarchy (drop & recreate)"
```

---

## Task 4: Update `ensureSchema()` for the new shape

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/db/index.ts:16-60` (the `ensureSchema` function)

`ensureSchema()` runs at every server start and must additively guarantee the NEW columns (so a fresh DB or a redeploy stays correct). It must NOT recreate the swapped tables (the migration script owns that).

- [ ] **Step 1: Add the new additive columns to the `ensureSchema` SQL**

Inside the `await pool.query(\`...\`)` template, append these statements (after the existing `theses` ALTERs, before/after the `news`/`documents` blocks — order among additive statements is irrelevant):

```sql
    ALTER TABLE theses ADD COLUMN IF NOT EXISTS front_matter jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE theses ADD COLUMN IF NOT EXISTS resume jsonb DEFAULT '[]'::jsonb;

    ALTER TABLE templates ADD COLUMN IF NOT EXISTS discipline text DEFAULT 'generic';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS binding_side text DEFAULT 'left';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS citation_style text DEFAULT 'apa';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS body_preset text DEFAULT 'chapters';
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS front_matter jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS structure jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS style_map jsonb DEFAULT '{}'::jsonb;

    ALTER TABLE sections ADD COLUMN IF NOT EXISTS kind text DEFAULT 'section';
    ALTER TABLE sections ADD COLUMN IF NOT EXISTS content text;
    CREATE INDEX IF NOT EXISTS idx_sections_thesis ON sections (thesis_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_chapters_section ON chapters (section_id, order_index);
```

- [ ] **Step 2: Type-check + start the server once to run ensureSchema**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit 2>&1 | head -30
```
(There will still be errors in routes/mcp/export — fixed in later tasks. `src/db/index.ts` itself must be clean.)

```bash
cd /Users/hamzasafwan/modakerati-server && timeout 8 npx tsx -e "import 'dotenv/config'; import {ensureSchema} from './src/db'; await ensureSchema(); console.log('ensureSchema OK'); process.exit(0);"
```
Expected: "ensureSchema OK" with no SQL error.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/db/index.ts
git commit -m "feat(db): ensureSchema guarantees new hierarchy columns going forward"
```

---

## Task 5: Update the export tree loader (keep export compiling)

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/lib/thesis-export.ts` (`loadThesisTree` ~25-52 + the `ThesisTree` type)
- Modify: `/Users/hamzasafwan/modakerati-server/src/lib/docx.ts` (the loop ~87-95)
- Modify: `/Users/hamzasafwan/modakerati-server/src/lib/latex.ts` (the loop)
- Modify: `/Users/hamzasafwan/modakerati-server/src/lib/thesis-export-storage.ts` (`exportThesis` word-count reduce)

> This task ONLY makes the existing exporters compile and run against the new nesting (sections→chapters). The full norm-compliant rewrite is the P1 plan.

- [ ] **Step 1: Rewrite `loadThesisTree` to the new nesting**

Replace the chapter/section loading with section/chapter loading. New `ThesisTree` type and loader:

```typescript
export interface ThesisTree {
  thesis: ThesisRow;
  profile: ProfileRow | null;
  sections: (SectionRow & { chapters: ChapterRow[] })[];
  references: ReferenceRow[];
}

export async function loadThesisTree(thesisId: string): Promise<ThesisTree> {
  const [thesis] = await db.select().from(theses).where(eq(theses.id, thesisId));
  if (!thesis) throw new Error("Thesis not found");

  const sectionList = await db
    .select().from(sections)
    .where(eq(sections.thesisId, thesisId))
    .orderBy(sections.orderIndex);

  const withChapters = await Promise.all(
    sectionList.map(async (sec) => {
      const chs = await db
        .select().from(chapters)
        .where(eq(chapters.sectionId, sec.id))
        .orderBy(chapters.orderIndex);
      return { ...sec, chapters: chs };
    })
  );

  const refs = await db.select().from(references).where(eq(references.thesisId, thesisId));
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, thesis.userId));
  return { thesis, profile: profile ?? null, sections: withChapters, references: refs };
}
```
Update the imports at the top of the file to include both `sections` and `chapters` from `../db` (both are still exported). Update `ChapterRow`/`SectionRow` type aliases if they are derived via `typeof chapters.$inferSelect` / `typeof sections.$inferSelect` — they will now reflect the new columns automatically.

- [ ] **Step 2: Rewrite the docx loop to walk sections → chapters**

In `src/lib/docx.ts`, replace the `for (const ch of tree.chapters)` block (~87-95) with:

```typescript
  for (const sec of tree.sections) {
    // Top "Partie" divider.
    paras.push(para(sec.title, { bold: true, fontSize: 18, styleId: "Heading1", align: headAlign }));
    // A section may carry its own content (intro/conclusion) OR contain chapters.
    if (sec.content) {
      const blocks = sec.content.split(/\n{2,}|\r?\n/).map((b) => b.trim()).filter(Boolean);
      for (const block of blocks) paras.push(para(block, { align: bodyAlign }));
    }
    for (const ch of sec.chapters) {
      paras.push(para(ch.title, { bold: true, fontSize: 15, styleId: "Heading2", align: headAlign }));
      const blocks = (ch.content || "").split(/\n{2,}|\r?\n/).map((b) => b.trim()).filter(Boolean);
      for (const block of blocks) paras.push(para(block, { align: bodyAlign }));
      if (blocks.length === 0) paras.push(blank());
    }
  }
```

- [ ] **Step 3: Rewrite the latex loop the same way**

In `src/lib/latex.ts`, replace `for (const ch of chapters)` with a sections→chapters walk:

```typescript
  for (const sec of sections) {
    out.push(`\\chapter{${tex(sec.title)}}`);
    if (sec.content) {
      for (const block of sec.content.split(/\n{2,}|\r?\n/).map((b) => b.trim()).filter(Boolean)) {
        out.push(tex(block)); out.push("");
      }
    }
    for (const ch of sec.chapters) {
      out.push(`\\section{${tex(ch.title)}}`);
      for (const block of (ch.content || "").split(/\n{2,}|\r?\n/).map((b) => b.trim()).filter(Boolean)) {
        out.push(tex(block)); out.push("");
      }
    }
  }
```
Update the destructuring at the top of `buildThesisLatex` from `const { thesis, profile, chapters, references } = await loadThesisTree(...)` to `const { thesis, profile, sections, references } = await loadThesisTree(...)`.

Also update `thesis-export-storage.ts` `exportThesis`'s word-count reduce (it reads `chapterTree`): change to sum over `sections → chapters`:
```typescript
  const { thesis, sections: sectionTree } = await loadThesisTree(thesisId);
  const wordCount = sectionTree.reduce(
    (sum, sec) => sum + sec.chapters.reduce((s, ch) => s + (ch.wordCount ?? 0), 0),
    0,
  );
```

- [ ] **Step 4: Type-check the export libs**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit 2>&1 | grep -E "thesis-export|docx.ts|latex.ts|thesis-export-storage" | head
```
Expected: no errors from these four files (remaining errors are in routes/mcp — next tasks).

- [ ] **Step 5: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/lib/thesis-export.ts src/lib/docx.ts src/lib/latex.ts src/lib/thesis-export-storage.ts
git commit -m "refactor(export): walk sections->chapters; keep docx/latex compiling on new model"
```

---

## Task 6: Update thesis HTTP routes (serializer + create + child CRUD)

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/routes/thesis.ts`

- [ ] **Step 1: Rewrite `GET /:id` to serialize sections → chapters**

Replace the chapter/section serialization (~96-114) with:

```typescript
thesisRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  const sectionList = await db.select().from(sections).where(eq(sections.thesisId, id)).orderBy(sections.orderIndex);
  const sectionsWithChapters = await Promise.all(
    sectionList.map(async (sec) => {
      const chs = await db.select().from(chapters).where(eq(chapters.sectionId, sec.id)).orderBy(chapters.orderIndex);
      return { ...sec, chapters: chs };
    })
  );
  return c.json({ ...thesis, sections: sectionsWithChapters });
});
```

- [ ] **Step 2: Rewrite `GET /` counts (chapterCount/sectionCount)**

The list endpoint (~62-94) computes per-thesis counts. Update it so `sectionCount` counts top sections and `chapterCount` counts leaf chapters. Replace the count queries with:

```typescript
  // sections per thesis
  const secRows = await db.select({ thesisId: sections.thesisId, id: sections.id })
    .from(sections).where(inArray(sections.thesisId, ids));
  const sectionMap = new Map<string, number>();
  const secIdToThesis = new Map<string, string>();
  for (const r of secRows) {
    sectionMap.set(r.thesisId, (sectionMap.get(r.thesisId) ?? 0) + 1);
    secIdToThesis.set(r.id, r.thesisId);
  }
  // chapters per thesis (via their section)
  const chRows = await db.select({ sectionId: chapters.sectionId })
    .from(chapters).where(inArray(chapters.sectionId, Array.from(secIdToThesis.keys()).length ? Array.from(secIdToThesis.keys()) : ["00000000-0000-0000-0000-000000000000"]));
  const chapterMap = new Map<string, number>();
  for (const r of chRows) {
    const thesisId = secIdToThesis.get(r.sectionId);
    if (thesisId) chapterMap.set(thesisId, (chapterMap.get(thesisId) ?? 0) + 1);
  }
```
Where `ids` is the array of the user's thesis ids (`data.map((t) => t.id)`). Add `inArray` to the `drizzle-orm` import. Keep the final `data.map(t => ({ ...t, sectionCount: sectionMap.get(t.id) ?? 0, chapterCount: chapterMap.get(t.id) ?? 0 }))`. If `ids` is empty, guard by returning `c.json([])` early.

- [ ] **Step 3: Rewrite `POST /` to accept the new `sections` payload**

Replace the create handler (~117-132):

```typescript
thesisRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { title, templateId, language } = body;
  const [thesis] = await db.insert(theses).values({
    userId, title, templateId: templateId || null, language: language || "fr",
    frontMatter: body.frontMatter ?? {}, resume: body.resume ?? [],
  }).returning();

  // New shape: sections:[{ title, kind?, chapters:[{ title, content? }] }]
  // Legacy shape: chapters: string[]  -> wrap in one default section.
  let planSections: Array<{ title: string; kind?: string; chapters?: Array<{ title: string; content?: string }> }> = [];
  if (Array.isArray(body.sections)) {
    planSections = body.sections;
  } else if (Array.isArray(body.chapters)) {
    planSections = [{ title: "Corps", kind: "section", chapters: body.chapters.map((t: string) => ({ title: t })) }];
  }

  for (let si = 0; si < planSections.length; si++) {
    const s = planSections[si];
    const [sec] = await db.insert(sections).values({
      thesisId: thesis.id, title: s.title, kind: s.kind ?? "section", orderIndex: si,
    }).returning();
    const chs = s.chapters ?? [];
    if (chs.length) {
      await db.insert(chapters).values(
        chs.map((ch, ci) => ({ sectionId: sec.id, title: ch.title, content: ch.content ?? "", orderIndex: ci }))
      );
    }
  }
  return c.json(thesis, 201);
});
```

- [ ] **Step 4: Update the child-CRUD endpoints to the new nesting**

The existing nested routes (`/:id/chapters`, `/:id/chapters/:chapterId`, `/:id/chapters/:chapterId/sections`, …) encode the OLD hierarchy in their URLs. Replace them with section/chapter routes:

```typescript
// Sections (top)
thesisRoutes.post("/:id/sections", async (c) => {
  const thesisId = c.req.param("id");
  const { title, kind, orderIndex } = await c.req.json();
  const [data] = await db.insert(sections).values({ thesisId, title, kind: kind ?? "section", orderIndex: orderIndex ?? 0 }).returning();
  return c.json(data, 201);
});
thesisRoutes.put("/:id/sections/:sectionId", async (c) => {
  const sectionId = c.req.param("sectionId");
  const updates = await c.req.json();
  const [data] = await db.update(sections).set({ ...updates, updatedAt: new Date() }).where(eq(sections.id, sectionId)).returning();
  return c.json(data);
});
thesisRoutes.delete("/:id/sections/:sectionId", async (c) => {
  await db.delete(sections).where(eq(sections.id, c.req.param("sectionId")));
  return c.json({ success: true });
});
// Chapters (content leaf, under a section)
thesisRoutes.post("/:id/sections/:sectionId/chapters", async (c) => {
  const sectionId = c.req.param("sectionId");
  const { title, content, orderIndex } = await c.req.json();
  const [data] = await db.insert(chapters).values({ sectionId, title, content: content ?? "", orderIndex: orderIndex ?? 0 }).returning();
  return c.json(data, 201);
});
thesisRoutes.put("/:id/sections/:sectionId/chapters/:chapterId", async (c) => {
  const chapterId = c.req.param("chapterId");
  const updates = await c.req.json();
  if (typeof updates.content === "string") updates.wordCount = updates.content.trim() ? updates.content.trim().split(/\s+/).length : 0;
  const [data] = await db.update(chapters).set({ ...updates, updatedAt: new Date() }).where(eq(chapters.id, chapterId)).returning();
  return c.json(data);
});
thesisRoutes.delete("/:id/sections/:sectionId/chapters/:chapterId", async (c) => {
  await db.delete(chapters).where(eq(chapters.id, c.req.param("chapterId")));
  return c.json({ success: true });
});
```
Delete the old `/:id/chapters...` route blocks entirely.

- [ ] **Step 5: Type-check the routes file**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit 2>&1 | grep "routes/thesis" | head
```
Expected: no errors from `routes/thesis.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/routes/thesis.ts
git commit -m "feat(routes): thesis API serializes sections->chapters; new section/chapter CRUD + create payload"
```

---

## Task 7: Re-wire the MCP tools to the new hierarchy

**Files:**
- Modify: `/Users/hamzasafwan/modakerati-server/src/mcp/server.ts` (ownership helpers ~26-53; tools ~157-456)
- Modify: `/Users/hamzasafwan/modakerati-server/src/lib/ai/types.ts` (`buildToolSystemPrompt` — terminology)

- [ ] **Step 1: Update the ownership helpers**

Replace `chapterOwnerThesis` / `sectionOwner` with helpers for the new nesting (a section belongs to a thesis; a chapter belongs to a section→thesis):

```typescript
// section (top) -> thesis
async function sectionOwnerThesis(sectionId: string, userId: string): Promise<string | null> {
  const [row] = await db.select({ thesisId: theses.id })
    .from(sections).innerJoin(theses, eq(sections.thesisId, theses.id))
    .where(and(eq(sections.id, sectionId), eq(theses.userId, userId)));
  return row?.thesisId ?? null;
}
// chapter (leaf) -> { sectionId, thesisId }
async function chapterOwner(chapterId: string, userId: string): Promise<{ sectionId: string; thesisId: string } | null> {
  const [row] = await db.select({ sectionId: sections.id, thesisId: theses.id })
    .from(chapters)
    .innerJoin(sections, eq(chapters.sectionId, sections.id))
    .innerJoin(theses, eq(sections.thesisId, theses.id))
    .where(and(eq(chapters.id, chapterId), eq(theses.userId, userId)));
  return row ?? null;
}
```
Keep `userOwnsThesis` unchanged.

- [ ] **Step 2: Replace the section/chapter tools with the new set**

Delete the old `add_chapter`, `update_chapter`, `delete_chapter`, `reorder_chapters`, `add_section`, `update_section_content`, `get_section_content`, `list_sections`, `update_section`, `delete_section`, `move_section` tools, and register this new set (top = section, leaf = chapter):

```typescript
// ---- Sections (top container = Partie) ----
server.tool("add_section", "Add a top-level section (Partie) to a thesis.", {
  thesisId: z.string(), title: z.string(),
  kind: z.enum(["introduction", "section", "conclusion"]).optional(),
  orderIndex: z.number().optional(),
}, async ({ thesisId, title, kind, orderIndex }) => {
  const existing = await db.select({ id: sections.id }).from(sections).where(eq(sections.thesisId, thesisId));
  const [section] = await db.insert(sections).values({
    thesisId, title, kind: kind ?? "section", orderIndex: orderIndex ?? existing.length,
  }).returning();
  return asText(section);
});

server.tool("update_section", "Rename a top-level section, set its kind, or set its own content (for intro/conclusion-style sections).", {
  userId: z.string(), sectionId: z.string(),
  title: z.string().optional(), kind: z.enum(["introduction", "section", "conclusion"]).optional(),
  content: z.string().optional(),
}, async ({ userId, sectionId, title, kind, content }) => {
  if (!(await sectionOwnerThesis(sectionId, userId))) return asText("Section not found");
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (kind !== undefined) updates.kind = kind;
  if (content !== undefined) updates.content = content;
  const [section] = await db.update(sections).set(updates).where(eq(sections.id, sectionId)).returning();
  return asText(section);
});

server.tool("delete_section", "Delete a top-level section and all its chapters. Destructive — confirm with ask_user first.", {
  userId: z.string(), sectionId: z.string(),
}, async ({ userId, sectionId }) => {
  if (!(await sectionOwnerThesis(sectionId, userId))) return asText("Section not found");
  await db.delete(sections).where(eq(sections.id, sectionId));
  return asText({ deleted: true, sectionId });
});

server.tool("reorder_sections", "Set the top-to-bottom order of a thesis's sections.", {
  userId: z.string(), thesisId: z.string(), sectionIds: z.array(z.string()),
}, async ({ userId, thesisId, sectionIds }) => {
  if (!(await userOwnsThesis(thesisId, userId))) return asText("Thesis not found");
  const owned = await db.select({ id: sections.id }).from(sections).where(eq(sections.thesisId, thesisId));
  const ownedIds = new Set(owned.map((s) => s.id));
  let i = 0;
  for (const id of sectionIds) { if (!ownedIds.has(id)) continue; await db.update(sections).set({ orderIndex: i, updatedAt: new Date() }).where(eq(sections.id, id)); i++; }
  return asText(await db.select().from(sections).where(eq(sections.thesisId, thesisId)).orderBy(sections.orderIndex));
});

// ---- Chapters (content leaf = Chapitre, under a section) ----
server.tool("add_chapter", "Add a chapter (content unit) to a section.", {
  sectionId: z.string(), title: z.string(), content: z.string().optional(),
}, async ({ sectionId, title, content }) => {
  const existing = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.sectionId, sectionId));
  const [chapter] = await db.insert(chapters).values({
    sectionId, title, content: content || "", orderIndex: existing.length,
    wordCount: content ? content.trim().split(/\s+/).length : 0,
  }).returning();
  return asText(chapter);
});

server.tool("update_chapter_content", "Replace the markdown content of a chapter (headings #/##/###, tables, figures).", {
  chapterId: z.string(), content: z.string(),
}, async ({ chapterId, content }) => {
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const [chapter] = await db.update(chapters).set({ content, wordCount, status: "in_progress", updatedAt: new Date() }).where(eq(chapters.id, chapterId)).returning();
  return asText(chapter);
});

server.tool("update_chapter", "Rename a chapter or change its status (not_started, in_progress, done). For prose use update_chapter_content.", {
  userId: z.string(), chapterId: z.string(),
  title: z.string().optional(), status: z.enum(["not_started", "in_progress", "done"]).optional(),
}, async ({ userId, chapterId, title, status }) => {
  if (!(await chapterOwner(chapterId, userId))) return asText("Chapter not found");
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (status !== undefined) updates.status = status;
  const [chapter] = await db.update(chapters).set(updates).where(eq(chapters.id, chapterId)).returning();
  return asText(chapter);
});

server.tool("get_chapter_content", "Read the full content of a chapter.", { chapterId: z.string() }, async ({ chapterId }) => {
  const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
  return asText(chapter ?? "Chapter not found");
});

server.tool("list_chapters", "List a section's chapters (title, order, word count, status) without loading prose.", { sectionId: z.string() }, async ({ sectionId }) => {
  const data = await db.select({ id: chapters.id, title: chapters.title, orderIndex: chapters.orderIndex, wordCount: chapters.wordCount, status: chapters.status })
    .from(chapters).where(eq(chapters.sectionId, sectionId)).orderBy(chapters.orderIndex);
  return asText(data);
});

server.tool("delete_chapter", "Delete a chapter. Destructive — confirm with ask_user first.", {
  userId: z.string(), chapterId: z.string(),
}, async ({ userId, chapterId }) => {
  if (!(await chapterOwner(chapterId, userId))) return asText("Chapter not found");
  await db.delete(chapters).where(eq(chapters.id, chapterId));
  return asText({ deleted: true, chapterId });
});

server.tool("move_chapter", "Move a chapter to a different section and/or position (same thesis only).", {
  userId: z.string(), chapterId: z.string(), targetSectionId: z.string().optional(), newIndex: z.number().optional(),
}, async ({ userId, chapterId, targetSectionId, newIndex }) => {
  const owner = await chapterOwner(chapterId, userId);
  if (!owner) return asText("Chapter not found");
  let sectionId = owner.sectionId;
  if (targetSectionId && targetSectionId !== owner.sectionId) {
    const targetThesis = await sectionOwnerThesis(targetSectionId, userId);
    if (!targetThesis) return asText("Target section not found");
    if (targetThesis !== owner.thesisId) return asText("Cannot move a chapter to a section in a different thesis");
    sectionId = targetSectionId;
  }
  const siblings = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.sectionId, sectionId)).orderBy(chapters.orderIndex);
  const order = siblings.map((s) => s.id).filter((id) => id !== chapterId);
  const pos = newIndex === undefined ? order.length : Math.max(0, Math.min(newIndex, order.length));
  order.splice(pos, 0, chapterId);
  let i = 0;
  for (const id of order) { await db.update(chapters).set({ sectionId, orderIndex: i, updatedAt: new Date() }).where(eq(chapters.id, id)); i++; }
  const [moved] = await db.select().from(chapters).where(eq(chapters.id, chapterId));
  return asText(moved);
});
```

- [ ] **Step 3: Update `apply_template` to create sections from the body preset**

In `apply_template` (~157-194), the chapter-creation block must now create SECTIONS (using `template.chapterStructure` as section titles for the generic case). Replace the `if (existing.length === 0 ...)` block's insert target from `chapters` to `sections`:

```typescript
      const existing = await db.select({ id: sections.id }).from(sections).where(eq(sections.thesisId, thesisId));
      const structure = Array.isArray(template.chapterStructure) ? template.chapterStructure : [];
      if (existing.length === 0 && structure.length > 0) {
        const titles = structure
          .map((entry: any) => (typeof entry === "string" ? entry : entry?.title ?? entry?.name))
          .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0);
        if (titles.length > 0) {
          createdSections = await db.insert(sections)
            .values(titles.map((title, i) => ({ thesisId, title, kind: "section", orderIndex: i })))
            .returning();
        }
      }
```
Rename the local `createdChapters` variable to `createdSections` (and its type to `typeof sections.$inferSelect`), and update the returned `asText({ thesis: updated, createdSections: createdSections.length, sections: createdSections })`.

- [ ] **Step 4: Update the tool system prompt terminology**

In `src/lib/ai/types.ts`, `buildToolSystemPrompt(...)`: update any wording that says a thesis has "chapters" containing "sections" to the new model — a thesis has **sections (Parties)**, each containing **chapters (Chapitres)** whose markdown content holds numbered sub-headings (`#`→Heading 2, etc.). Update tool-name references (`add_section` now adds a top section; `add_chapter`/`update_chapter_content` operate on the content leaf). Keep the rules about `ask_user` and confirming destructive ops.

- [ ] **Step 5: Type-check the whole server**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit
```
Expected: exits 0. If `asText` helper or `createdSections` typing complains, fix inline.

- [ ] **Step 6: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add src/mcp/server.ts src/lib/ai/types.ts
git commit -m "feat(mcp): re-wire tools to sections(top)->chapters(content); apply_template creates sections"
```

---

## Task 8: End-to-end server verification script

**Files:**
- Create: `/Users/hamzasafwan/modakerati-server/scripts/test-hierarchy.ts`

- [ ] **Step 1: Write the verification script (create → serialize → export)**

```typescript
// /Users/hamzasafwan/modakerati-server/scripts/test-hierarchy.ts
/**
 * Verifies the new thesis hierarchy end to end against the dev DB.
 *   npx tsx scripts/test-hierarchy.ts
 * Creates a thesis with sections→chapters, checks the export tree shape + a docx build, cleans up.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, profiles, theses, sections, chapters } from "../src/db";
import { loadThesisTree } from "../src/lib/thesis-export";
import { buildThesisDocxBuffer } from "../src/lib/docx";

async function main() {
  const [user] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!user) { console.error("No profiles — create a user first."); process.exit(1); }

  const [thesis] = await db.insert(theses).values({ userId: user.id, title: "Test Hierarchy", language: "fr" }).returning();
  const [secTheo] = await db.insert(sections).values({ thesisId: thesis.id, title: "Partie Théorique", kind: "section", orderIndex: 0 }).returning();
  const [secPrat] = await db.insert(sections).values({ thesisId: thesis.id, title: "Partie Pratique", kind: "section", orderIndex: 1 }).returning();
  await db.insert(chapters).values([
    { sectionId: secTheo.id, title: "Chapitre 1: Cadre", content: "# Définitions\n\nTexte.", orderIndex: 0 },
    { sectionId: secPrat.id, title: "Chapitre 2: Étude", content: "## Méthode\n\nTexte.", orderIndex: 0 },
  ]);

  try {
    const tree = await loadThesisTree(thesis.id);
    const okShape = tree.sections.length === 2 && tree.sections[0].chapters.length === 1 && tree.sections[0].chapters[0].content.includes("Définitions");
    console.log(`tree shape: sections=${tree.sections.length}, chapters[0]=${tree.sections[0].chapters.length} -> ${okShape ? "PASS" : "FAIL"}`);

    const docx = await buildThesisDocxBuffer(thesis.id);
    const isZip = docx.buffer.length > 4 && docx.buffer[0] === 0x50 && docx.buffer[1] === 0x4b;
    console.log(`docx build: ${docx.buffer.length} bytes, valid zip: ${isZip} -> ${isZip ? "PASS" : "FAIL"}`);

    console.log(`\nRESULT: ${okShape && isZip ? "PASS" : "FAIL"}`);
  } finally {
    await db.delete(theses).where(eq(theses.id, thesis.id));
    console.log(`Cleaned up ${thesis.id}.`);
    process.exit(0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-hierarchy.ts
```
Expected: `tree shape: ... PASS`, `docx build: ... PASS`, `RESULT: PASS`.

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati-server
git add scripts/test-hierarchy.ts
git commit -m "test: end-to-end verification of new thesis hierarchy (tree + docx build)"
```

---

## Task 9: App — restructure the `Thesis` types

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/types/thesis.ts` (full file)

- [ ] **Step 1: Rewrite the type file to the new hierarchy**

```typescript
export type ThesisStatus = "active" | "completed" | "archived";
export type ChapterStatus = "not_started" | "in_progress" | "done";
export type SectionKind = "introduction" | "section" | "conclusion";

// Chapter = content leaf ("Chapitre"), belongs to a Section.
export interface Chapter {
  id: string;
  sectionId: string;
  title: string;
  content: string;          // markdown (#/##/### headings, tables, figures)
  orderIndex: number;
  wordCount: number;
  status: ChapterStatus;
}

// Section = top container ("Partie").
export interface Section {
  id: string;
  thesisId: string;
  title: string;
  kind: SectionKind;
  content?: string | null;  // markdown, for intro/conclusion-style sections
  orderIndex: number;
  chapters: Chapter[];
}

export interface ResumeBlock {
  language: "ar" | "fr" | "en";
  body: string;
  keywords: string[];
}

export interface ThesisFrontMatter {
  university?: string; faculty?: string; department?: string; field?: string;
  specialty?: string; degree?: string; theme?: string;
  authors?: string[]; supervisor?: string; coSupervisor?: string;
  jury?: string[]; academicYear?: string; city?: string;
  ficheSynoptique?: string; acknowledgements?: string; dedication?: string;
}

export interface Thesis {
  id: string;
  title: string;
  templateId?: string;
  language: string;
  status: ThesisStatus;
  progress: number;
  wordCount: number;
  pageCount: number;
  frontMatter?: ThesisFrontMatter;
  resume?: ResumeBlock[];
  sections: Section[];
  createdAt: string;
  updatedAt: string;
}

export type CitationStyle = "apa" | "footnote-ar";
export type Discipline = "science" | "law-humanities" | "generic";
export type BodyPreset = "imrad" | "chapters" | "law-humanities";

export interface Template {
  id: string;
  university: string;
  type: string;
  language: "ar" | "fr" | "en";
  name: string;
  discipline: Discipline;
  bindingSide: "left" | "right";
  citationStyle: CitationStyle;
  bodyPreset: BodyPreset;
  config: {
    margins: { top: string; bottom: string; left: string; right: string };
    bodyFont: string; bodySize: string; headingFont: string; lineSpacing: string; paperSize: string;
  };
  frontMatter: {
    pageDeGarde: string[];
    ficheSynoptique: boolean; remerciements: boolean; dedicace: boolean;
    resumeLanguages: Array<"ar" | "fr" | "en">; resumePlacement: "front" | "back";
    sommaire: boolean; listeTableaux: boolean; listeFigures: boolean; listeAbreviations: boolean;
  };
  structure: { sectionLabel: string; chapterLabel: string };
  styleMap: {
    section: "dividerPage" | "Heading1";
    chapter: "Heading1" | "Heading2";
    contentHeadings: ["Heading2", "Heading3", "Heading4"];
    useDirectFormatting?: boolean;
    headingSizes?: Record<string, number>;
  };
  chapterStructure: string[]; // legacy seed (used as section titles for generic preset)
}
```

- [ ] **Step 2: Find every consumer of the old shape**

```bash
cd /Users/hamzasafwan/modakerati && grep -rn "\.chapters\b\|\.sections\b\|chapterId\|sectionId\|chapterStructure" app components stores lib --include=*.ts --include=*.tsx | grep -v node_modules
```
Expected: a list of files (e.g. `thesis-detail.tsx`, `edit-chapter.tsx`, `section-editor.tsx`, `thesis-store.ts`, etc.). Record them — Tasks 10–11 fix stores/api; any SCREEN files that read `thesis.chapters` must be updated to `thesis.sections` (those screens are out of P0's behavioral scope but must keep TYPE-checking — update field access minimally, no redesign).

- [ ] **Step 3: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add types/thesis.ts
git commit -m "feat(app/types): restructure Thesis to sections(top)->chapters(content) + profile template"
```

---

## Task 10: App — restructure `thesis-store`

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/stores/thesis-store.ts` (full file)

> The store is a client cache. Rewrite its actions to the new nesting. Server is source of truth; keep `createThesis` building the local optimistic object that mirrors the server.

- [ ] **Step 1: Rewrite the state interface + actions**

Replace the `ThesisState` interface and implementation so the hierarchy is `sections → chapters`:

```typescript
interface ThesisState {
  theses: Thesis[];
  currentThesisId: string | null;
  templates: Template[];

  setTheses: (theses: Thesis[]) => void;
  upsertThesis: (thesis: Thesis) => void;     // replace/insert one (after getThesis)
  deleteThesis: (id: string) => void;
  setCurrentThesis: (id: string | null) => void;
  getCurrentThesis: () => Thesis | null;

  // Section (top) actions — local cache mirror of server ops
  addSection: (thesisId: string, title: string, kind?: SectionKind) => void;
  updateSection: (thesisId: string, sectionId: string, updates: Partial<Section>) => void;
  deleteSection: (thesisId: string, sectionId: string) => void;
  reorderSections: (thesisId: string, sectionIds: string[]) => void;

  // Chapter (content leaf) actions
  addChapter: (thesisId: string, sectionId: string, title: string) => void;
  updateChapter: (thesisId: string, sectionId: string, chapterId: string, updates: Partial<Chapter>) => void;
  deleteChapter: (thesisId: string, sectionId: string, chapterId: string) => void;

  loadTemplates: () => void;
}
```

- [ ] **Step 2: Implement the store with the new nesting**

```typescript
import { create } from "zustand";
import type { Thesis, Section, Chapter, Template, SectionKind, ChapterStatus } from "@/types/thesis";

const generateId = (): string =>
  Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);

export const useThesisStore = create<ThesisState>()((set, get) => ({
  theses: [],
  currentThesisId: null,
  templates: [],

  setTheses: (theses) => set({ theses }),
  upsertThesis: (thesis) => set((s) => ({
    theses: s.theses.some((t) => t.id === thesis.id)
      ? s.theses.map((t) => (t.id === thesis.id ? thesis : t))
      : [...s.theses, thesis],
  })),
  deleteThesis: (id) => set((s) => ({
    theses: s.theses.filter((t) => t.id !== id),
    currentThesisId: s.currentThesisId === id ? null : s.currentThesisId,
  })),
  setCurrentThesis: (id) => set({ currentThesisId: id }),
  getCurrentThesis: () => {
    const { theses, currentThesisId } = get();
    return theses.find((t) => t.id === currentThesisId) ?? null;
  },

  addSection: (thesisId, title, kind = "section") => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: [...t.sections, { id: generateId(), thesisId, title, kind, orderIndex: t.sections.length, chapters: [] }],
      updatedAt: new Date().toISOString(),
    }),
  })),
  updateSection: (thesisId, sectionId, updates) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t, sections: t.sections.map((sec) => sec.id === sectionId ? { ...sec, ...updates } : sec), updatedAt: new Date().toISOString(),
    }),
  })),
  deleteSection: (thesisId, sectionId) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t, sections: t.sections.filter((sec) => sec.id !== sectionId).map((sec, i) => ({ ...sec, orderIndex: i })), updatedAt: new Date().toISOString(),
    }),
  })),
  reorderSections: (thesisId, sectionIds) => set((s) => ({
    theses: s.theses.map((t) => {
      if (t.id !== thesisId) return t;
      const map = new Map(t.sections.map((sec) => [sec.id, sec]));
      const reordered = sectionIds.map((id, i) => { const sec = map.get(id); return sec ? { ...sec, orderIndex: i } : null; }).filter(Boolean) as Section[];
      return { ...t, sections: reordered, updatedAt: new Date().toISOString() };
    }),
  })),

  addChapter: (thesisId, sectionId, title) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: t.sections.map((sec) => sec.id !== sectionId ? sec : {
        ...sec,
        chapters: [...sec.chapters, { id: generateId(), sectionId, title, content: "", orderIndex: sec.chapters.length, wordCount: 0, status: "not_started" as ChapterStatus }],
      }),
      updatedAt: new Date().toISOString(),
    }),
  })),
  updateChapter: (thesisId, sectionId, chapterId, updates) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: t.sections.map((sec) => sec.id !== sectionId ? sec : {
        ...sec, chapters: sec.chapters.map((ch) => ch.id === chapterId ? { ...ch, ...updates } : ch),
      }),
      updatedAt: new Date().toISOString(),
    }),
  })),
  deleteChapter: (thesisId, sectionId, chapterId) => set((s) => ({
    theses: s.theses.map((t) => t.id !== thesisId ? t : {
      ...t,
      sections: t.sections.map((sec) => sec.id !== sectionId ? sec : {
        ...sec, chapters: sec.chapters.filter((ch) => ch.id !== chapterId).map((ch, i) => ({ ...ch, orderIndex: i })),
      }),
      updatedAt: new Date().toISOString(),
    }),
  })),

  loadTemplates: () => set({ templates: [] }), // templates now come from the server; see lib/api (P2)
}));
```

> Note: the old hardcoded `loadTemplates` list of 5 templates is removed — templates are now server profiles (a later plan seeds them). For P0 this returns `[]`; any screen relying on local templates must tolerate an empty list (it already handles "no templates" in `template-picker`).

- [ ] **Step 3: Type-check the app**

```bash
cd /Users/hamzasafwan/modakerati && npx tsc --noEmit 2>&1 | head -40
```
Expected: errors now point at SCREEN files (`thesis-detail.tsx`, `edit-chapter.tsx`, `section-editor.tsx`, `template-picker.tsx`, `NewThesisSheet.tsx`, chat) that use old store methods / `thesis.chapters`. Fix each minimally to TYPE-check against the new shape (e.g. `thesis.chapters` → `thesis.sections`; `addChapter(thesisId, title)` → new signature). Do NOT redesign screens (that's P2/P3) — just keep them compiling and not crashing. Re-run until `npx tsc --noEmit` is clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add stores/thesis-store.ts app components lib
git commit -m "feat(app/store): restructure thesis-store to sections->chapters; fix consumers to type-check"
```

---

## Task 11: App — update `lib/api.ts` thesis functions

**Files:**
- Modify: `/Users/hamzasafwan/modakerati/lib/api.ts:275-312` (thesis API block)

- [ ] **Step 1: Update `createThesis` to send the new `sections` payload + type the responses**

```typescript
import type { Thesis, Section, SectionKind } from "@/types/thesis";

export async function listTheses() {
  return apiGet<Array<Thesis & { sectionCount: number; chapterCount: number }>>("/api/thesis");
}

export async function getThesis(id: string) {
  return apiGet<Thesis>(`/api/thesis/${id}`);
}

// New plan-shaped create. Falls back-compatible: pass either `sections` or legacy `chapters`.
export async function createThesis(input: {
  title: string;
  templateId?: string;
  language?: string;
  sections?: Array<{ title: string; kind?: SectionKind; chapters?: Array<{ title: string; content?: string }> }>;
}) {
  return apiPost<Thesis>("/api/thesis", input);
}
```

- [ ] **Step 2: Fix `createThesis` call sites**

```bash
cd /Users/hamzasafwan/modakerati && grep -rn "createThesis(" app components --include=*.tsx | grep -v node_modules
```
Update each call (e.g. in `NewThesisSheet.tsx` and `template-preview.tsx`) from the old positional `createThesis(name, DEFAULT_CHAPTERS)` to the object form, e.g.:
```typescript
const thesis = await createThesis({ title: name, sections: [{ title: "Corps", chapters: DEFAULT_CHAPTERS.map((t) => ({ title: t })) }] });
```
After creating, the screen should call `getThesis(thesis.id)` and `upsertThesis(...)` (server is source of truth). Keep behavior minimal — full wizard rework is P2.

- [ ] **Step 3: Type-check the app (must be clean now)**

```bash
cd /Users/hamzasafwan/modakerati && npx tsc --noEmit
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/hamzasafwan/modakerati
git add lib/api.ts app components
git commit -m "feat(app/api): createThesis sends sections payload; typed thesis responses"
```

---

## Task 12: Manual smoke test (server + app boot)

**Files:** none

- [ ] **Step 1: Boot the server and confirm ensureSchema + routes**

```bash
cd /Users/hamzasafwan/modakerati-server && timeout 12 npm run dev 2>&1 | head -30
```
Expected: server starts, no SQL errors from `ensureSchema`, no crash. (Ctrl-C / timeout ends it.)

- [ ] **Step 2: Re-run the end-to-end verification**

```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-hierarchy.ts
```
Expected: `RESULT: PASS`.

- [ ] **Step 3: Confirm the app type-checks and bundles**

```bash
cd /Users/hamzasafwan/modakerati && npx tsc --noEmit && echo "APP TYPECHECK OK"
```
Expected: `APP TYPECHECK OK`.

- [ ] **Step 4: Final commit / branch ready**

```bash
cd /Users/hamzasafwan/modakerati-server && git log --oneline -8
cd /Users/hamzasafwan/modakerati && git log --oneline -6
```
Both branches `feat/thesis-hierarchy-p0` now hold the restructure. Open PRs (or merge) per the team's flow — do NOT push without the user's go-ahead.

---

## Definition of done (P0)

- DB hierarchy is `thesis → sections(top) → chapters(content)`, migration script run, `ensureSchema()` keeps a fresh DB correct.
- `templates` carries the profile columns (discipline, bindingSide, citationStyle, bodyPreset, frontMatter, structure, styleMap); `theses` carries `frontMatter`/`resume`.
- `GET /api/thesis/:id` serializes `sections[].chapters[]`; `POST /api/thesis` accepts the `sections` payload (legacy `chapters` still works).
- All MCP tools operate on the new hierarchy; `apply_template` creates sections.
- The existing docx/latex export compiles and produces a valid file against the new tree (NOT yet norm-compliant — that's P1).
- App `Thesis` type, `thesis-store`, and `lib/api` use the new shape; `npx tsc --noEmit` is clean in both repos.
- `scripts/test-hierarchy.ts` prints `RESULT: PASS`.

## Out of scope (later plans)
- **P1** — norm-compliant `.docx` (page de garde, front matter, Section dividers + numbered Heading 2/3/4 from markdown, tables/figures, sommaire, citations per `citationStyle`, roman→arabic numbering, RTL binding mirror, base-template style audit). Written as `2026-06-23-thesis-foundation-p1-docx-export.md`.
- P2 wizard+plan, P3 workspace, P4 chat editing, P5 A4 preview, P6 source materials.
