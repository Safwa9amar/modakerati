# Templates & Norms — Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the server a real `universities` table, link templates and norm profiles to it, and expose one resolver that ranks a student's starting points by match quality — so the app and dashboard can both be built on top without inventing their own ranking.

**Architecture:** Three layers — `universities` (identity) → `norm_profiles` (rules) → `templates` (documents). A pure ranking core (`rankStartingPoints`) is separated from its database reader (`resolveStartingPoints`) so every rung of the fallback ladder is unit-testable without a DB. All schema changes in this plan are **additive**; the destructive column drop is deliberately deferred to Plan 4.

**Tech Stack:** Hono, Drizzle ORM (node-postgres), Supabase Storage, vitest, TypeScript. All work is in `~/modakerati-server` — **no app or dashboard changes in this plan.**

**Spec:** `docs/superpowers/specs/2026-07-29-templates-norms-design.md` (in `~/modakerati`)

---

## Corrections to the spec

Three things the spec assumed that turned out to be wrong. The plan below follows the corrected version.

1. **Norm profiles have no level dimension and don't need one.** `NORM_PROFILE_SEEDS` is keyed on `(language, discipline)`. The spec's "generic profile for `(level, language)`" is wrong — level selects the *template type* and the skeleton `.docx`; the profile only supplies formatting. **Rung 5 matches on `(language, discipline)`.**

2. **The backfill is much smaller than the spec feared.** Four seeded profiles already have `university: null` (they are the rung-5 generics, already written). Five more carry free-text names — `"Univ. Biskra"`, `"Univ. Constantine 3"`, `"ENSTI Annaba"`, `"Univ. Ouargla"`, `"Univ. El Oued"` — but these are *seed-generated*, so they get fixed at the seed level with an explicit source id rather than fuzzy-matched at runtime. Fuzzy matching applies only to hand-created rows (today: one template).

3. **Slugs derived from the website are not unique.** 130 institutions share 112 hostnames; hostname+type still collides 7 times (annexes share a parent domain). **The JSON's numeric `id` is the stable natural key**, stored as `source_id`, with an append-only invariant enforced by a test.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/db/universities.ts` | `universities` Drizzle table — identity only |
| `src/lib/universities-seed.ts` | Typed seed rows read from the JSON; pure |
| `src/lib/university-storage.ts` | Logo bucket upload/download |
| `src/lib/level-type-map.ts` | `profiles.level` ↔ `templates.type`; pure |
| `src/lib/starting-points.ts` | `rankStartingPoints` — pure ranking core, all five rungs |
| `src/lib/starting-points-db.ts` | `resolveStartingPoints` — loads candidates, calls the core |
| `src/routes/starting-points.ts` | `GET /api/starting-points` |
| `scripts/mirror-university-logos.ts` | One-shot: copy 130 remote logos into our bucket |
| `scripts/backfill-university-ids.ts` | One-shot: match free-text names → ids, **report** misses |
| `src/__tests__/universities-seed.test.ts` | Append-only + uniqueness invariants |
| `src/__tests__/level-type-map.test.ts` | Mapping is total and explicit |
| `src/__tests__/starting-points.test.ts` | One fixture per rung |

**Modified**

| File | Change |
|---|---|
| `src/db/index.ts` | Export universities; `ensureSchema` DDL; `seedUniversities`; make `seedNormProfiles` upsert |
| `src/db/norm-profiles.ts` | Add `slug`, `universityId` |
| `src/db/schema.ts` | `templates.universityId`, `templates.normProfileId`; `profiles.universityId`; `headerFooterTemplates.universityId` |
| `src/lib/norm-profiles-seed.ts` | Add `slug` + `universitySourceId` to every seed |
| `src/lib/template-fields.ts` | `resolveFieldValues` accepts a university row; add `logo_url` field |
| `src/index.ts` | Mount the new route; call `seedUniversities` |

**Why `starting-points.ts` and `starting-points-db.ts` are separate:** the ranking is the only part with real logic and it must be testable without a database. Keeping the Drizzle query in its own module means the core takes plain arrays and returns plain objects. Do not merge them.

---

## Task 1: University seed module

**Files:**
- Create: `src/lib/universities-seed.ts`
- Test: `src/__tests__/universities-seed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/universities-seed.test.ts
import { describe, it, expect } from "vitest";
import { UNIVERSITY_SEEDS } from "../lib/universities-seed";

describe("university seeds", () => {
  it("has all 130 institutions", () => {
    expect(UNIVERSITY_SEEDS.length).toBe(130);
  });

  // source_id is the natural key the upsert seeds on. Renumbering the JSON
  // would silently re-point every FK, so the file must be append-only.
  it("source ids are unique", () => {
    const ids = UNIVERSITY_SEEDS.map((u) => u.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("source ids are a contiguous 1..N range (append-only invariant)", () => {
    const ids = UNIVERSITY_SEEDS.map((u) => u.sourceId).sort((a, b) => a - b);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(UNIVERSITY_SEEDS.length);
  });

  // The contiguity test above is NOT enough on its own: deleting institution 50
  // and decrementing 51..130 down to 50..129 keeps ids unique AND contiguous
  // while silently re-pointing every foreign key. Only anchoring ids to real
  // identities catches that. These seven are pinned because Task 4 hardcodes
  // five of them as a seeded norm profile's universitySourceId; 1 and 130 anchor
  // the ends of the range. Anchors (not a whole-file hash) so that APPENDING a
  // new institution — which is legitimate — does not break the suite.
  it("anchor ids still point at the institutions later tasks assume", () => {
    const nameOf = (sourceId: number) =>
      UNIVERSITY_SEEDS.find((u) => u.sourceId === sourceId)?.nameFr;
    expect(nameOf(1)).toBe("Université Benyoucef Benkhedda d'Alger 1");
    expect(nameOf(27)).toBe("Université Salah Boubnider de Constantine 3");
    expect(nameOf(34)).toBe("Université Mohamed Khider de Biskra");
    expect(nameOf(47)).toBe("Université Kasdi Merbah de Ouargla");
    expect(nameOf(48)).toBe("Université Echahid Hamma Lakhdar d'El Oued");
    expect(nameOf(77)).toBe("École Nationale Supérieure de Technologie et d'Ingénierie");
    expect(nameOf(130)).toBe("Annexe Universitaire de Messaad");
  });

  it("every row has the identity fields the cover page needs", () => {
    for (const u of UNIVERSITY_SEEDS) {
      expect(u.nameFr).toBeTruthy();
      expect(u.nameAr).toBeTruthy();
      expect(u.wilaya).toBeTruthy();
      expect(["university", "ecole", "ens", "centre_universitaire"]).toContain(u.type);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/universities-seed.test.ts`
Expected: FAIL — `Cannot find module '../lib/universities-seed'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/universities-seed.ts
// Typed view over data/algerian-universities.json. Pure — no DB, no network.
// `sourceId` is the JSON's own `id` and is the natural key the seeder upserts
// on, so the JSON file must be treated as APPEND-ONLY: renumbering it would
// re-point every foreign key that references a university.
import raw from "../data/algerian-universities.json" with { type: "json" };

export type UniversityType = "university" | "ecole" | "ens" | "centre_universitaire";

export interface UniversitySeed {
  sourceId: number;
  nameFr: string;
  nameAr: string;
  nameEn: string;
  city: string;
  cityAr: string;
  wilaya: string;
  wilayaCode: number;
  type: UniversityType;
  website: string;
  remoteLogo: string | null;
}

// No `as any[]` cast: tsconfig has resolveJsonModule, so `raw` already carries a
// precise inferred type from the JSON. Keeping that means renaming a field in
// the JSON becomes a tsc error instead of a silent `undefined` in every row.
// Only `type` is narrowed, widening string into the literal union.
export const UNIVERSITY_SEEDS: UniversitySeed[] = raw.map((u) => ({
  sourceId: u.id,
  nameFr: u.nameFr,
  nameAr: u.nameAr,
  nameEn: u.nameEn,
  city: u.city,
  cityAr: u.cityAr,
  wilaya: u.wilaya,
  wilayaCode: u.wilayaCode,
  type: u.type as UniversityType,
  website: u.website,
  remoteLogo: typeof u.logo === "string" && u.logo.length ? u.logo : null,
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/universities-seed.test.ts`
Expected: PASS — 5 tests

**If any anchor pair fails**, stop. It means either the JSON was renumbered (the exact disaster this test exists to catch) or Task 4's hardcoded `universitySourceId` values are wrong. Do not "fix" either side without deciding which one moved.

- [ ] **Step 5: Commit**

```bash
git add src/lib/universities-seed.ts src/__tests__/universities-seed.test.ts
git commit -m "feat(universities): typed seed module over the 130-institution JSON"
```

---

## Task 2: The `universities` table

**Files:**
- Create: `src/db/universities.ts`
- Modify: `src/db/index.ts`

- [ ] **Step 1: Write the table**

```ts
// src/db/universities.ts
import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Identity layer. Owns WHO an institution is and nothing about formatting —
// rules live in norm_profiles, documents in templates.
export const universities = pgTable(
  "universities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Natural key from data/algerian-universities.json. Unique; the seeder
    // upserts on it. See universities-seed.ts for the append-only invariant.
    sourceId: integer("source_id").notNull(),
    nameFr: text("name_fr").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull().default(""),
    city: text("city").notNull().default(""),
    cityAr: text("city_ar").notNull().default(""),
    wilaya: text("wilaya").notNull().default(""),
    wilayaCode: integer("wilaya_code"),
    type: text("type").notNull().default("university"),
    website: text("website").notNull().default(""),
    // Logo copied into OUR bucket. The JSON's `logo` points at university
    // websites, which rot — that URL is only ever a mirroring source.
    logoPath: text("logo_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({ sourceIdx: uniqueIndex("universities_source_id_idx").on(t.sourceId) })
);
```

- [ ] **Step 2: Add the DDL to `ensureSchema`**

In `src/db/index.ts`, inside the existing `await pool.query(\`...\`)` template literal in `ensureSchema()`, append:

```sql
    CREATE TABLE IF NOT EXISTS universities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id integer NOT NULL,
      name_fr text NOT NULL,
      name_ar text NOT NULL,
      name_en text NOT NULL DEFAULT '',
      city text NOT NULL DEFAULT '',
      city_ar text NOT NULL DEFAULT '',
      wilaya text NOT NULL DEFAULT '',
      wilaya_code integer,
      type text NOT NULL DEFAULT 'university',
      website text NOT NULL DEFAULT '',
      logo_path text,
      created_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS universities_source_id_idx ON universities (source_id);
```

- [ ] **Step 3: Add the seeder**

At the end of `src/db/index.ts`, after `seedNormProfiles`:

```ts
// Upsert on source_id so re-running is safe and name corrections in the JSON
// propagate. logo_path is deliberately NOT overwritten — it is owned by
// scripts/mirror-university-logos.ts, not by the JSON.
export async function seedUniversities() {
  await db
    .insert(universities)
    .values(
      UNIVERSITY_SEEDS.map((u) => ({
        sourceId: u.sourceId,
        nameFr: u.nameFr,
        nameAr: u.nameAr,
        nameEn: u.nameEn,
        city: u.city,
        cityAr: u.cityAr,
        wilaya: u.wilaya,
        wilayaCode: u.wilayaCode,
        type: u.type,
        website: u.website,
      }))
    )
    .onConflictDoUpdate({
      target: universities.sourceId,
      set: {
        nameFr: sql`excluded.name_fr`,
        nameAr: sql`excluded.name_ar`,
        nameEn: sql`excluded.name_en`,
        city: sql`excluded.city`,
        cityAr: sql`excluded.city_ar`,
        wilaya: sql`excluded.wilaya`,
        wilayaCode: sql`excluded.wilaya_code`,
        type: sql`excluded.type`,
        website: sql`excluded.website`,
      },
    });
  console.log(`Seeded/updated ${UNIVERSITY_SEEDS.length} universities`);
}
```

Add the imports at the top of `src/db/index.ts`:

```ts
import { universities } from "./universities";
import { UNIVERSITY_SEEDS } from "../lib/universities-seed";
```

and re-export alongside the other tables:

```ts
export { universities } from "./universities";
```

- [ ] **Step 4: Call it at startup**

In `src/index.ts`, find where `seedNormProfiles()` is called and add `seedUniversities()` immediately before it (universities must exist before anything references them).

- [ ] **Step 5: Verify against the local DB**

Run: `npx tsc --noEmit && npm run dev`
Expected: log line `Seeded/updated 130 universities`. Run it twice — the second run must not error and must not duplicate.

Verify: `psql "$DATABASE_URL" -c "select count(*), count(distinct source_id) from universities;"`
Expected: `130 | 130`

- [ ] **Step 6: Commit**

```bash
git add src/db/universities.ts src/db/index.ts src/index.ts
git commit -m "feat(universities): table, idempotent seeder, startup wiring"
```

---

## Task 3: Mirror the logos

**Files:**
- Create: `src/lib/university-storage.ts`
- Create: `scripts/mirror-university-logos.ts`

- [ ] **Step 1: Write the storage helper**

```ts
// src/lib/university-storage.ts
import { supabaseAdmin } from "./supabase";

// PUBLIC bucket — logos are institutional marks shown on cover pages and in the
// picker. Public means the app can render them with a plain <Image> and no
// signed-URL round trip.
const LOGOS_BUCKET = process.env.UNIVERSITY_LOGOS_BUCKET || "university-logos";

async function ensureLogosBucket(): Promise<void> {
  const { error } = await supabaseAdmin.storage.createBucket(LOGOS_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Could not create bucket "${LOGOS_BUCKET}": ${error.message}`);
  }
}

export async function uploadUniversityLogo(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  await ensureLogosBucket();
  const { error } = await supabaseAdmin.storage
    .from(LOGOS_BUCKET)
    .upload(key, buffer, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`Logo upload failed: ${error.message}`);
  return key;
}

export function universityLogoUrl(key: string | null): string | null {
  if (!key) return null;
  const { data } = supabaseAdmin.storage.from(LOGOS_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

export async function downloadUniversityLogo(key: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(LOGOS_BUCKET).download(key);
  if (error || !data) throw new Error(`Logo download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}
```

- [ ] **Step 2: Write the mirroring script**

```ts
// scripts/mirror-university-logos.ts
// One-shot: fetch each institution's remote logo and copy it into our bucket.
// Re-runnable — skips rows that already have a logo_path. Failures are REPORTED,
// never fatal: a missing logo degrades the cover page, it does not break it.
import "dotenv/config";
import { db, universities, pool } from "../src/db";
import { eq, isNull } from "drizzle-orm";
import { uploadUniversityLogo } from "../src/lib/university-storage";
import { UNIVERSITY_SEEDS } from "../src/lib/universities-seed";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};

async function main() {
  const rows = await db.select().from(universities).where(isNull(universities.logoPath));
  console.log(`${rows.length} universities without a mirrored logo`);

  const failed: Array<{ name: string; reason: string }> = [];
  let ok = 0;

  for (const row of rows) {
    const seed = UNIVERSITY_SEEDS.find((s) => s.sourceId === row.sourceId);
    if (!seed?.remoteLogo) {
      failed.push({ name: row.nameFr, reason: "no logo url in seed" });
      continue;
    }
    try {
      const res = await fetch(seed.remoteLogo, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
      const ext = EXT[contentType];
      if (!ext) throw new Error(`unsupported content-type ${contentType}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) throw new Error("empty body");

      const key = `${row.sourceId}.${ext}`;
      await uploadUniversityLogo(key, buffer, contentType);
      await db.update(universities).set({ logoPath: key }).where(eq(universities.id, row.id));
      ok++;
      console.log(`  ✓ ${row.nameFr} → ${key}`);
    } catch (e: any) {
      failed.push({ name: row.nameFr, reason: e?.message ?? String(e) });
      console.warn(`  ✗ ${row.nameFr}: ${e?.message ?? e}`);
    }
  }

  console.log(`\nMirrored ${ok}, failed ${failed.length}`);
  if (failed.length) {
    console.log("\nFailures (fix the URL in the JSON, or upload by hand in the dashboard):");
    for (const f of failed) console.log(`  ${f.name} — ${f.reason}`);
  }
  await pool.end();
}

main();
```

- [ ] **Step 3: Run it**

Run: `npx tsx scripts/mirror-university-logos.ts`
Expected: a per-row ✓/✗ log, then a summary. **Some failures are expected and acceptable** — these are third-party sites. Do not chase 100%; the fallback ladder does not depend on a logo existing.

- [ ] **Step 4: Run it again to confirm idempotency**

Run: `npx tsx scripts/mirror-university-logos.ts`
Expected: only the previously-failed rows are attempted; every success is skipped.

- [ ] **Step 5: Commit**

```bash
git add src/lib/university-storage.ts scripts/mirror-university-logos.ts
git commit -m "feat(universities): mirror institution logos into our own bucket"
```

---

## Task 4: Link norm profiles to universities

**Files:**
- Modify: `src/db/norm-profiles.ts`, `src/lib/norm-profiles-seed.ts`, `src/db/index.ts`
- Test: `src/__tests__/norm-profiles-seed.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `src/__tests__/norm-profiles-seed.test.ts`:

```ts
import { UNIVERSITY_SEEDS } from "../lib/universities-seed";

describe("norm profile seed identity", () => {
  it("every seed has a unique slug", () => {
    const slugs = NORM_PROFILE_SEEDS.map((p) => p.slug);
    expect(slugs.every(Boolean)).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every universitySourceId points at a real institution", () => {
    const known = new Set(UNIVERSITY_SEEDS.map((u) => u.sourceId));
    for (const p of NORM_PROFILE_SEEDS) {
      if (p.universitySourceId !== null) expect(known.has(p.universitySourceId)).toBe(true);
    }
  });

  // Rung 5 of the ladder. Without a generic for a (language, discipline) cell,
  // a student in that cell falls off the bottom of the resolver.
  it("has a generic profile for every language x discipline the app offers", () => {
    const generics = NORM_PROFILE_SEEDS.filter((p) => p.universitySourceId === null);
    for (const language of ["fr", "ar"] as const) {
      for (const discipline of ["science", "law-humanities", "generic"] as const) {
        const hit = generics.find((p) => p.language === language && p.discipline === discipline);
        expect(hit, `missing generic for ${language}/${discipline}`).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/norm-profiles-seed.test.ts`
Expected: FAIL — `slug` does not exist on the seed type, and the generic-coverage test fails (only 4 generics exist today; `fr/generic` and `ar/generic` are missing).

- [ ] **Step 3: Update the seed type and rows**

In `src/lib/norm-profiles-seed.ts`, change the interface:

```ts
export interface NormProfileSeed {
  slug: string;                          // stable key; the seeder upserts on it
  name: string;
  universitySourceId: number | null;     // null = generic (rung 5)
  university: string | null;             // legacy display text; dropped in Plan 4
  language: "fr" | "ar" | "en";
  discipline: "science" | "law-humanities" | "generic";
  bodyPreset: "imrad" | "chapters" | "law-humanities";
  citationStyle: "apa" | "footnote-ar" | "ieee";
  bindingSide: "left" | "right";
  formatting: NormFormatting;
}
```

Then add `slug` and `universitySourceId` to all nine existing rows.

The four generics get `universitySourceId: null` and these slugs:

| Existing `name` | `slug` |
|---|---|
| French Science (IMRAD) | `generic-fr-science` |
| French Law & Humanities | `generic-fr-law-humanities` |
| Arabic Law & Humanities | `generic-ar-law-humanities` |
| Arabic Science | `generic-ar-science` |

The five university-scoped rows get these — the source ids were resolved against the JSON and each is unambiguous:

| Existing `name` | `slug` | `universitySourceId` | Institution |
|---|---|---|---|
| Univ. Biskra — Law (Arabic) | `biskra-ar-law` | `34` | Université Mohamed Khider de Biskra |
| Univ. Constantine 3 — French Science | `constantine3-fr-science` | `27` | Université Salah Boubnider de Constantine 3 |
| ENSTI Annaba — French Science | `ensti-annaba-fr-science` | `77` | École Nationale Supérieure de Technologie et d'Ingénierie |
| Univ. Ouargla — French Generic | `ouargla-fr-generic` | `47` | Université Kasdi Merbah de Ouargla |
| Univ. El Oued — Arabic Generic | `eloued-ar-generic` | `48` | Université Echahid Hamma Lakhdar d'El Oued |

Leave each row's existing `university` free text as-is — it is legacy display text and Plan 4 drops it.

- [ ] **Step 4: Add the two missing generics**

Still in `src/lib/norm-profiles-seed.ts`, add two rows so the `(language, discipline)` grid is complete:

```ts
  {
    slug: "generic-fr-generic",
    name: "French Generic",
    universitySourceId: null,
    university: null,
    language: "fr",
    discipline: "generic",
    bodyPreset: "chapters",
    citationStyle: "apa",
    bindingSide: "left",
    formatting: frenchScience,
  },
  {
    slug: "generic-ar-generic",
    name: "Arabic Generic",
    universitySourceId: null,
    university: null,
    language: "ar",
    discipline: "generic",
    bodyPreset: "chapters",
    citationStyle: "footnote-ar",
    bindingSide: "right",
    formatting: arabicLawHumanities,
  },
```

- [ ] **Step 5: Add the columns**

In `src/db/norm-profiles.ts`, add to `normProfiles`:

```ts
  slug: text("slug"),
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "set null" }),
```

with `import { universities } from "./universities";` at the top.

In `ensureSchema()`, append to the DDL:

```sql
    ALTER TABLE norm_profiles ADD COLUMN IF NOT EXISTS slug text;
    ALTER TABLE norm_profiles ADD COLUMN IF NOT EXISTS university_id uuid REFERENCES universities(id) ON DELETE SET NULL;
    -- Plain (not partial) unique index: Postgres allows many NULLs in a unique
    -- index, so pre-slug rows coexist, AND `ON CONFLICT (slug)` can infer it.
    -- A partial index would need a matching WHERE clause on every upsert.
    CREATE UNIQUE INDEX IF NOT EXISTS norm_profiles_slug_idx ON norm_profiles (slug);
```

- [ ] **Step 6: Make the seeder upsert instead of bailing**

`seedNormProfiles` currently returns early when any row exists, so new seeds never land. Replace its body in `src/db/index.ts`:

```ts
export async function seedNormProfiles() {
  // Resolve source ids → uuids once, so seeds reference universities by their
  // stable natural key rather than a uuid nobody can write down.
  const unis = await db
    .select({ id: universities.id, sourceId: universities.sourceId })
    .from(universities);
  const bySource = new Map(unis.map((u) => [u.sourceId, u.id]));

  await db
    .insert(normProfiles)
    .values(
      NORM_PROFILE_SEEDS.map((p) => ({
        slug: p.slug,
        name: p.name,
        university: p.university,
        universityId: p.universitySourceId === null ? null : bySource.get(p.universitySourceId) ?? null,
        language: p.language,
        discipline: p.discipline,
        bodyPreset: p.bodyPreset,
        citationStyle: p.citationStyle,
        bindingSide: p.bindingSide,
        formatting: p.formatting,
      }))
    )
    .onConflictDoUpdate({
      target: normProfiles.slug,
      set: {
        name: sql`excluded.name`,
        universityId: sql`excluded.university_id`,
        language: sql`excluded.language`,
        discipline: sql`excluded.discipline`,
        bodyPreset: sql`excluded.body_preset`,
        citationStyle: sql`excluded.citation_style`,
        bindingSide: sql`excluded.binding_side`,
        formatting: sql`excluded.formatting`,
      },
    });
  console.log(`Seeded/updated ${NORM_PROFILE_SEEDS.length} norm profiles`);
}
```

**Note:** pre-existing rows seeded before this change have `slug = NULL` and will not conflict — they become orphan duplicates. Task 6's backfill script deletes them.

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/__tests__/norm-profiles-seed.test.ts && npx tsc --noEmit`
Expected: PASS — 7 tests

- [ ] **Step 8: Commit**

```bash
git add src/db/norm-profiles.ts src/lib/norm-profiles-seed.ts src/db/index.ts src/__tests__/norm-profiles-seed.test.ts
git commit -m "feat(norms): slug + universityId on norm profiles, upsert seeding, complete generic grid"
```

---

## Task 5: Add the FK columns everywhere else

**Files:**
- Modify: `src/db/schema.ts`, `src/db/index.ts`

- [ ] **Step 1: Add the columns to the Drizzle tables**

In `src/db/schema.ts`, add `import { universities } from "./universities";` and `import { normProfiles } from "./norm-profiles";`, then:

To `profiles`:
```ts
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "set null" }),
```

To `templates`:
```ts
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "set null" }),
  // Required from Plan 1 Task 11 onward. Nullable here so the backfill can run.
  normProfileId: uuid("norm_profile_id").references(() => normProfiles.id, { onDelete: "restrict" }),
```

To `headerFooterTemplates`:
```ts
  universityId: uuid("university_id").references(() => universities.id, { onDelete: "set null" }),
```

- [ ] **Step 2: Add the DDL**

Append to `ensureSchema()`:

```sql
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS university_id uuid REFERENCES universities(id) ON DELETE SET NULL;
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS university_id uuid REFERENCES universities(id) ON DELETE SET NULL;
    ALTER TABLE templates ADD COLUMN IF NOT EXISTS norm_profile_id uuid REFERENCES norm_profiles(id) ON DELETE RESTRICT;
    ALTER TABLE header_footer_templates ADD COLUMN IF NOT EXISTS university_id uuid REFERENCES universities(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS templates_university_idx ON templates (university_id);
    CREATE INDEX IF NOT EXISTS norm_profiles_university_idx ON norm_profiles (university_id);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run dev`
Expected: server boots clean.

Verify: `psql "$DATABASE_URL" -c "\d templates" | grep -E "university_id|norm_profile_id"`
Expected: both columns listed.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/index.ts
git commit -m "feat(db): nullable universityId/normProfileId foreign keys"
```

---

## Task 6: Backfill script

**Files:**
- Create: `scripts/backfill-university-ids.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/backfill-university-ids.ts
// Matches hand-created rows' free-text `university` against the real table and
// sets university_id. REPORTS anything it cannot match with confidence — it
// never guesses. With one template and a handful of profiles this output is a
// hand-checkable list, not an algorithm anyone has to trust.
import "dotenv/config";
import { db, universities, templates, pool } from "../src/db";
import { normProfiles } from "../src/db/norm-profiles";
import { eq, isNull, and, isNotNull } from "drizzle-orm";

const norm = (s: string) =>
  s.toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")     // Arabic diacritics
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function findMatch(text: string, unis: Array<{ id: string; nameFr: string; nameAr: string; nameEn: string }>) {
  const q = norm(text);
  if (!q) return null;
  const exact = unis.filter((u) => [u.nameFr, u.nameAr, u.nameEn].some((n) => norm(n) === q));
  if (exact.length === 1) return exact[0];
  const partial = unis.filter((u) =>
    [u.nameFr, u.nameAr, u.nameEn].some((n) => n && (norm(n).includes(q) || q.includes(norm(n))))
  );
  return partial.length === 1 ? partial[0] : null;   // ambiguous => no match
}

async function main() {
  const unis = await db
    .select({ id: universities.id, nameFr: universities.nameFr, nameAr: universities.nameAr, nameEn: universities.nameEn })
    .from(universities);

  const unmatched: string[] = [];

  // --- orphan profiles from the pre-slug seeding era -----------------------
  const orphans = await db.select().from(normProfiles).where(isNull(normProfiles.slug));
  if (orphans.length) {
    console.log(`Deleting ${orphans.length} pre-slug norm profile rows (re-seeded with slugs):`);
    for (const o of orphans) console.log(`  - ${o.name}`);
    for (const o of orphans) await db.delete(normProfiles).where(eq(normProfiles.id, o.id));
  }

  // --- templates ----------------------------------------------------------
  const tpls = await db.select().from(templates).where(isNull(templates.universityId));
  for (const t of tpls) {
    const hit = t.university ? findMatch(t.university, unis) : null;
    if (hit) {
      await db.update(templates).set({ universityId: hit.id }).where(eq(templates.id, t.id));
      console.log(`  ✓ template "${t.name}" → ${hit.nameFr}`);
    } else {
      unmatched.push(`template "${t.name}" (university text: "${t.university ?? ""}")`);
    }
  }

  // --- hand-created profiles ---------------------------------------------
  const profs = await db
    .select()
    .from(normProfiles)
    .where(and(isNull(normProfiles.universityId), isNotNull(normProfiles.university)));
  for (const p of profs) {
    const hit = p.university ? findMatch(p.university, unis) : null;
    if (hit) {
      await db.update(normProfiles).set({ universityId: hit.id }).where(eq(normProfiles.id, p.id));
      console.log(`  ✓ profile "${p.name}" → ${hit.nameFr}`);
    } else {
      unmatched.push(`norm profile "${p.name}" (university text: "${p.university ?? ""}")`);
    }
  }

  if (unmatched.length) {
    console.log(`\n${unmatched.length} row(s) NOT matched — set university_id by hand in the dashboard:`);
    for (const u of unmatched) console.log(`  ${u}`);
  } else {
    console.log("\nEverything matched.");
  }
  await pool.end();
}

main();
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/backfill-university-ids.ts`

Expected, verified against the live local DB before this plan was written:

- **1 template**, whose `university` text is `المركز الجامعي نور البشير البيض`. The matcher was dry-run against the real data and this normalizes to an **exact, unambiguous** hit on `source_id = 103` (Centre Universitaire Nour Bachir d'El Bayadh) — the hyphen in the JSON's `nameAr` is removed by the punctuation rule in `norm()`. Expect `✓ template … → Centre Universitaire Nour Bachir d'El Bayadh`.
- **9 norm profiles**: 4 generics (already `universityId: null`) and 5 university-scoped ones that Task 4 already resolved via `universitySourceId`, so they arrive with `universityId` set and are skipped here.
- **3 header/footer templates and 2 profiles** are untouched by this script — they get their `universityId` from the dashboard (Plan 3) and the app (Plan 2) respectively.

**If anything lands in the unmatched list, resolve it by hand before continuing** — Task 11 makes `normProfileId` required and will fail on rows you skipped.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-university-ids.ts
git commit -m "chore(db): backfill university ids, reporting unmatched rows"
```

---

## Task 7: Level ↔ template type mapping

**Files:**
- Create: `src/lib/level-type-map.ts`
- Test: `src/__tests__/level-type-map.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/level-type-map.test.ts
import { describe, it, expect } from "vitest";
import { LEVELS, TEMPLATE_TYPES, templateTypeForLevel, levelForTemplateType } from "../lib/level-type-map";

describe("level <-> template type", () => {
  it("maps every level to a template type", () => {
    for (const level of LEVELS) expect(TEMPLATE_TYPES).toContain(templateTypeForLevel(level));
  });

  it("keeps the misspelled 'license' value — it is pinned by a DB CHECK constraint", () => {
    expect(LEVELS).toContain("license");
    expect(templateTypeForLevel("license")).toBe("memoire_licence");
  });

  it("maps master and doctorat", () => {
    expect(templateTypeForLevel("master")).toBe("memoire_master");
    expect(templateTypeForLevel("doctorat")).toBe("these_doctorat");
  });

  // memoire_ingenieur has no level; it is reachable only by explicit choice.
  it("returns null for a template type with no corresponding level", () => {
    expect(levelForTemplateType("memoire_ingenieur")).toBeNull();
  });

  it("round-trips every mapped type", () => {
    for (const level of LEVELS) expect(levelForTemplateType(templateTypeForLevel(level))).toBe(level);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/level-type-map.test.ts`
Expected: FAIL — `Cannot find module '../lib/level-type-map'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/level-type-map.ts
// profiles.level and templates.type are two different vocabularies of two
// different sizes. This mapping is EXPLICIT on purpose — never infer it by
// string matching. Note "license" is misspelled in the DB CHECK constraint on
// profiles.level; renaming it is a separate migration, not this one.

export const LEVELS = ["license", "master", "doctorat"] as const;
export type Level = (typeof LEVELS)[number];

export const TEMPLATE_TYPES = [
  "memoire_licence",
  "memoire_master",
  "memoire_ingenieur",
  "these_doctorat",
] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

const LEVEL_TO_TYPE: Record<Level, TemplateType> = {
  license: "memoire_licence",
  master: "memoire_master",
  doctorat: "these_doctorat",
};

export function templateTypeForLevel(level: Level): TemplateType {
  return LEVEL_TO_TYPE[level];
}

// memoire_ingenieur intentionally maps to no level — it is reachable only by
// explicit choice in Browse-all, never by profile-driven resolution.
export function levelForTemplateType(type: string): Level | null {
  const hit = (Object.keys(LEVEL_TO_TYPE) as Level[]).find((l) => LEVEL_TO_TYPE[l] === type);
  return hit ?? null;
}

export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/level-type-map.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/level-type-map.ts src/__tests__/level-type-map.test.ts
git commit -m "feat(templates): explicit level <-> template type mapping"
```

---

## Task 8: The ranking core

This is the task with the real risk. It is pure — plain arrays in, ordered results out — so every rung is testable without a database.

**Files:**
- Create: `src/lib/starting-points.ts`
- Test: `src/__tests__/starting-points.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/starting-points.test.ts
import { describe, it, expect } from "vitest";
import { rankStartingPoints } from "../lib/starting-points";
import type { CandidateProfile, CandidateTemplate, ResolveQuery } from "../lib/starting-points";

const UNI_A = "uni-a";
const UNI_B_SAME_WILAYA = "uni-b";
const UNI_C_FAR = "uni-c";

const profile = (over: Partial<CandidateProfile> & { id: string }): CandidateProfile => ({
  universityId: null,
  language: "ar",
  discipline: "generic",
  bodyPreset: "chapters",
  citationStyle: "apa",
  bindingSide: "right",
  ...over,
});

const template = (over: Partial<CandidateTemplate> & { id: string; profile: CandidateProfile }): CandidateTemplate => ({
  universityId: UNI_A,
  type: "memoire_master",
  docxPath: "x.docx",
  ...over,
});

const QUERY: ResolveQuery = {
  universityId: UNI_A,
  wilaya: "El Bayadh",
  uniType: "centre_universitaire",
  level: "master",
  language: "ar",
  discipline: "generic",
};

const GENERIC = profile({ id: "p-generic", universityId: null, language: "ar", discipline: "generic" });

describe("rankStartingPoints", () => {
  it("rung 1 — exact university + type + language wins", () => {
    const own = profile({ id: "p-own", universityId: UNI_A });
    const t = template({ id: "t-exact", profile: own });
    const out = rankStartingPoints({ templates: [t], profiles: [own, GENERIC], universities: [] }, QUERY);
    expect(out[0].rung).toBe(1);
    expect(out[0].templateId).toBe("t-exact");
    expect(out[0].reason).toBe("exact");
  });

  it("rung 2 — same university, wrong type", () => {
    const own = profile({ id: "p-own", universityId: UNI_A });
    const t = template({ id: "t-doctorat", type: "these_doctorat", profile: own });
    const out = rankStartingPoints({ templates: [t], profiles: [own, GENERIC], universities: [] }, QUERY);
    expect(out[0].rung).toBe(2);
    expect(out[0].templateId).toBe("t-doctorat");
    expect(out[0].reason).toBe("same-university-adapted");
  });

  it("rung 2 — a right-language/wrong-type template beats a right-type/wrong-language one", () => {
    const ar = profile({ id: "p-ar", universityId: UNI_A, language: "ar" });
    const fr = profile({ id: "p-fr", universityId: UNI_A, language: "fr" });
    const rightLang = template({ id: "t-ar-doctorat", type: "these_doctorat", profile: ar });
    const rightType = template({ id: "t-fr-master", type: "memoire_master", profile: fr });
    const out = rankStartingPoints(
      { templates: [rightType, rightLang], profiles: [ar, fr, GENERIC], universities: [] },
      QUERY
    );
    expect(out[0].templateId).toBe("t-ar-doctorat");
  });

  it("rung 3 — the university's own profile when it has no template", () => {
    const own = profile({ id: "p-own", universityId: UNI_A, language: "ar" });
    const out = rankStartingPoints({ templates: [], profiles: [own, GENERIC], universities: [] }, QUERY);
    expect(out[0].rung).toBe(3);
    expect(out[0].normProfileId).toBe("p-own");
    expect(out[0].templateId).toBeNull();
    expect(out[0].reason).toBe("own-rules");
  });

  it("rung 4 — a peer in the same wilaya and type beats a distant peer", () => {
    const near = profile({ id: "p-near", universityId: UNI_B_SAME_WILAYA, language: "ar" });
    const far = profile({ id: "p-far", universityId: UNI_C_FAR, language: "ar" });
    const out = rankStartingPoints(
      {
        templates: [],
        profiles: [far, near, GENERIC],
        universities: [
          { id: UNI_B_SAME_WILAYA, wilaya: "El Bayadh", type: "centre_universitaire" },
          { id: UNI_C_FAR, wilaya: "Alger", type: "university" },
        ],
      },
      QUERY
    );
    expect(out[0].rung).toBe(4);
    expect(out[0].normProfileId).toBe("p-near");
    expect(out[0].reason).toBe("peer-rules");
  });

  it("rung 5 — the generic for (language, discipline) when nothing else exists", () => {
    const out = rankStartingPoints({ templates: [], profiles: [GENERIC], universities: [] }, QUERY);
    expect(out[0].rung).toBe(5);
    expect(out[0].normProfileId).toBe("p-generic");
    expect(out[0].reason).toBe("national");
  });

  it("matches the generic on discipline, not just language", () => {
    const wrongDiscipline = profile({ id: "p-sci", universityId: null, language: "ar", discipline: "science" });
    const out = rankStartingPoints({ templates: [], profiles: [wrongDiscipline, GENERIC], universities: [] }, QUERY);
    expect(out[0].normProfileId).toBe("p-generic");
  });

  it("no universityId — falls straight to the generic and never claims a university", () => {
    const own = profile({ id: "p-own", universityId: UNI_A });
    const out = rankStartingPoints(
      { templates: [template({ id: "t", profile: own })], profiles: [own, GENERIC], universities: [] },
      { ...QUERY, universityId: null }
    );
    expect(out[0].rung).toBe(5);
    expect(out.every((r) => r.rung >= 4)).toBe(true);
  });

  it("returns results in strictly non-decreasing rung order", () => {
    const own = profile({ id: "p-own", universityId: UNI_A });
    const out = rankStartingPoints(
      { templates: [template({ id: "t", profile: own })], profiles: [own, GENERIC], universities: [] },
      QUERY
    );
    for (let i = 1; i < out.length; i++) expect(out[i].rung).toBeGreaterThanOrEqual(out[i - 1].rung);
  });

  it("never returns the same profile twice", () => {
    const own = profile({ id: "p-own", universityId: UNI_A });
    const out = rankStartingPoints(
      { templates: [template({ id: "t", profile: own })], profiles: [own, GENERIC], universities: [] },
      QUERY
    );
    const keys = out.map((r) => `${r.templateId ?? ""}:${r.normProfileId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/starting-points.test.ts`
Expected: FAIL — `Cannot find module '../lib/starting-points'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/starting-points.ts
// PURE ranking core for the fallback ladder. No DB, no IO — plain arrays in,
// ordered results out, so every rung is unit-testable. The database read lives
// in starting-points-db.ts. Do not merge the two.
import { templateTypeForLevel, type Level } from "./level-type-map";

export type Rung = 1 | 2 | 3 | 4 | 5;

// Stable keys, not prose. The app maps these to trilingual copy; the honesty
// rule in the spec lives in that mapping.
export type Reason = "exact" | "same-university-adapted" | "own-rules" | "peer-rules" | "national";

export interface CandidateProfile {
  id: string;
  universityId: string | null;
  language: string;
  discipline: string;
  bodyPreset: string;
  citationStyle: string;
  bindingSide: string;
}

export interface CandidateTemplate {
  id: string;
  universityId: string | null;
  type: string;
  docxPath: string | null;
  profile: CandidateProfile;
}

export interface CandidateUniversity {
  id: string;
  wilaya: string;
  type: string;
}

export interface ResolveQuery {
  universityId: string | null;
  wilaya: string | null;
  uniType: string | null;
  level: Level | null;
  language: string;
  discipline?: string;
}

export interface StartingPoint {
  kind: "template" | "profile";
  templateId: string | null;
  normProfileId: string;
  rung: Rung;
  reason: Reason;
}

export interface Candidates {
  templates: CandidateTemplate[];
  profiles: CandidateProfile[];
  universities: CandidateUniversity[];
}

export function rankStartingPoints(c: Candidates, q: ResolveQuery): StartingPoint[] {
  const out: StartingPoint[] = [];
  const seen = new Set<string>();
  const push = (sp: StartingPoint) => {
    const key = `${sp.templateId ?? ""}:${sp.normProfileId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(sp);
  };

  const wantType = q.level ? templateTypeForLevel(q.level) : null;
  const wantDiscipline = q.discipline ?? "generic";
  const ownTemplates = q.universityId ? c.templates.filter((t) => t.universityId === q.universityId) : [];

  // Rung 1 — university, type and language all agree.
  for (const t of ownTemplates) {
    if (wantType && t.type === wantType && t.profile.language === q.language) {
      push({ kind: "template", templateId: t.id, normProfileId: t.profile.id, rung: 1, reason: "exact" });
    }
  }

  // Rung 2 — same university, something else differs. A right-language/wrong-type
  // template misleads less than a right-type/wrong-language one, so language
  // agreement outranks type agreement.
  const rung2 = ownTemplates
    .filter((t) => !out.some((r) => r.templateId === t.id))
    .map((t) => ({
      t,
      score: (t.profile.language === q.language ? 2 : 0) + (wantType && t.type === wantType ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  for (const { t } of rung2) {
    push({
      kind: "template",
      templateId: t.id,
      normProfileId: t.profile.id,
      rung: 2,
      reason: "same-university-adapted",
    });
  }

  // Rung 3 — the university's own rules, no document.
  if (q.universityId) {
    const own = c.profiles
      .filter((p) => p.universityId === q.universityId)
      .sort((a, b) => Number(b.language === q.language) - Number(a.language === q.language));
    for (const p of own) {
      push({ kind: "profile", templateId: null, normProfileId: p.id, rung: 3, reason: "own-rules" });
    }
  }

  // Rung 4 — a peer institution's rules. Nearest first: same wilaya AND type,
  // then same type, then same language only. Skipped entirely when we do not
  // know the student's university: with nothing to be "near", an arbitrary
  // institution's rules are not better than the national generic, and showing
  // one would imply a proximity we cannot justify.
  const uniById = new Map(c.universities.map((u) => [u.id, u]));
  const peers = (q.universityId ? c.profiles : [])
    .filter((p) => p.universityId !== null && p.universityId !== q.universityId)
    .map((p) => {
      const u = uniById.get(p.universityId!);
      const sameWilaya = !!u && !!q.wilaya && u.wilaya === q.wilaya;
      const sameType = !!u && !!q.uniType && u.type === q.uniType;
      const sameLang = p.language === q.language;
      if (!sameLang) return null;                       // never cross languages at rung 4
      return { p, score: (sameWilaya ? 4 : 0) + (sameType ? 2 : 0) + 1 };
    })
    .filter((x): x is { p: CandidateProfile; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  for (const { p } of peers) {
    push({ kind: "profile", templateId: null, normProfileId: p.id, rung: 4, reason: "peer-rules" });
  }

  // Rung 5 — the national generic for (language, discipline). Exact discipline
  // first, then any generic in the right language so this never returns empty.
  const generics = c.profiles.filter((p) => p.universityId === null && p.language === q.language);
  const exactDiscipline = generics.filter((p) => p.discipline === wantDiscipline);
  for (const p of [...exactDiscipline, ...generics]) {
    push({ kind: "profile", templateId: null, normProfileId: p.id, rung: 5, reason: "national" });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/starting-points.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/starting-points.ts src/__tests__/starting-points.test.ts
git commit -m "feat(resolver): pure ranking core for the five-rung fallback ladder"
```

---

## Task 9: Database-backed resolver + route

**Files:**
- Create: `src/lib/starting-points-db.ts`, `src/routes/starting-points.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the DB reader**

```ts
// src/lib/starting-points-db.ts
// Loads candidates and hands them to the pure core. The only logic here is the
// query — all ranking lives in starting-points.ts.
import { db, templates, universities } from "../db";
import { normProfiles } from "../db/norm-profiles";
import { eq } from "drizzle-orm";
import { rankStartingPoints, type CandidateProfile, type CandidateTemplate, type StartingPoint } from "./starting-points";
import type { Level } from "./level-type-map";

export interface ResolveInput {
  universityId: string | null;
  level: Level | null;
  language: string;
  discipline?: string;
}

export async function resolveStartingPoints(input: ResolveInput): Promise<StartingPoint[]> {
  const [profileRows, templateRows, uniRows] = await Promise.all([
    db.select().from(normProfiles),
    db.select().from(templates).where(eq(templates.isActive, true)),
    db.select({ id: universities.id, wilaya: universities.wilaya, type: universities.type }).from(universities),
  ]);

  const profiles: CandidateProfile[] = profileRows.map((p) => ({
    id: p.id,
    universityId: p.universityId ?? null,
    language: p.language,
    discipline: p.discipline,
    bodyPreset: p.bodyPreset,
    citationStyle: p.citationStyle,
    bindingSide: p.bindingSide,
  }));
  const byId = new Map(profiles.map((p) => [p.id, p]));

  // A template with no norm profile cannot be ranked (its formatting is
  // unreachable). Until Task 11 makes the column required, skip those rows.
  const candidateTemplates: CandidateTemplate[] = templateRows.flatMap((t) => {
    const profile = t.normProfileId ? byId.get(t.normProfileId) : undefined;
    if (!profile) return [];
    return [{ id: t.id, universityId: t.universityId ?? null, type: t.type, docxPath: t.docxPath ?? null, profile }];
  });

  const self = input.universityId ? uniRows.find((u) => u.id === input.universityId) : undefined;

  return rankStartingPoints(
    { templates: candidateTemplates, profiles, universities: uniRows },
    {
      universityId: input.universityId,
      wilaya: self?.wilaya ?? null,
      uniType: self?.type ?? null,
      level: input.level,
      language: input.language,
      discipline: input.discipline,
    }
  );
}
```

- [ ] **Step 2: Write the route**

```ts
// src/routes/starting-points.ts
import { Hono } from "hono";
import type { AppVariables } from "../types";
import { resolveStartingPoints } from "../lib/starting-points-db";
import { isLevel } from "../lib/level-type-map";

export const startingPointRoutes = new Hono<{ Variables: AppVariables }>();

// GET /api/starting-points?universityId=&level=&language=&discipline=
// The single ranking endpoint. The app calls it for the "For you" card and for
// Browse-all; the dashboard calls it to colour the coverage grid.
startingPointRoutes.get("/", async (c) => {
  const universityId = c.req.query("universityId") || null;
  const levelRaw = c.req.query("level");
  const language = c.req.query("language") || "fr";
  const discipline = c.req.query("discipline") || undefined;

  const results = await resolveStartingPoints({
    universityId,
    level: isLevel(levelRaw) ? levelRaw : null,
    language,
    discipline,
  });

  return c.json({ count: results.length, startingPoints: results });
});
```

- [ ] **Step 3: Mount it**

In `src/index.ts`, alongside the other `app.route(...)` calls:

```ts
import { startingPointRoutes } from "./routes/starting-points";
app.route("/api/starting-points", startingPointRoutes);
```

- [ ] **Step 4: Verify by hand**

Run: `npx tsc --noEmit && npm run dev`, then:

```bash
curl -s "http://localhost:3000/api/starting-points?language=ar&level=master" | head -c 400
```

Expected: a JSON body whose first entry has `"rung": 5` and `"reason": "national"` (no `universityId` was passed, so nothing may claim a university).

Then repeat with the El Bayadh university's uuid:

```bash
psql "$DATABASE_URL" -c "select id, name_fr from universities where source_id = 103;"
curl -s "http://localhost:3000/api/starting-points?language=ar&level=master&universityId=<that-uuid>" | head -c 400
```

Expected: the first entry is `"rung": 1` **once Task 11 has linked the existing template to a profile**. Before Task 11 it will be rung 3 or 5 — that is correct behaviour for a template with no reachable rules, not a bug.

- [ ] **Step 5: Commit**

```bash
git add src/lib/starting-points-db.ts src/routes/starting-points.ts src/index.ts
git commit -m "feat(resolver): GET /api/starting-points backed by the ranking core"
```

---

## Task 10: Fill the cover from the university row

**Files:**
- Modify: `src/lib/template-fields.ts`
- Test: `src/__tests__/template-fields-identity.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/template-fields-identity.test.ts
import { describe, it, expect } from "vitest";
import { resolveFieldValues, TEMPLATE_FIELDS } from "../lib/template-fields";

describe("identity fill from a university row", () => {
  it("prefers the university row over the profile's free text", () => {
    const v = resolveFieldValues({
      title: "T",
      profile: { university: "typed by hand" },
      university: { nameFr: "Centre Universitaire d'El Bayadh", nameAr: "المركز الجامعي نور البشير", logoUrl: null },
      language: "fr",
    });
    expect(v.institute_name).toBe("Centre Universitaire d'El Bayadh");
  });

  it("uses the Arabic name for an Arabic thesis", () => {
    const v = resolveFieldValues({
      title: "T",
      university: { nameFr: "Centre Universitaire d'El Bayadh", nameAr: "المركز الجامعي نور البشير", logoUrl: null },
      language: "ar",
    });
    expect(v.institute_name).toBe("المركز الجامعي نور البشير");
  });

  it("still honours an explicit frontMatter override", () => {
    const v = resolveFieldValues({
      title: "T",
      frontMatter: { institute_name: "explicit" },
      university: { nameFr: "X", nameAr: "Y", logoUrl: null },
      language: "fr",
    });
    expect(v.institute_name).toBe("explicit");
  });

  it("falls back to the profile string when there is no university row", () => {
    const v = resolveFieldValues({ title: "T", profile: { university: "typed by hand" } });
    expect(v.institute_name).toBe("typed by hand");
  });

  it("exposes logo_url as a registry field so scans and substitution see it", () => {
    expect(TEMPLATE_FIELDS.map((f) => f.key)).toContain("logo_url");
    const v = resolveFieldValues({
      title: "T",
      university: { nameFr: "X", nameAr: "Y", logoUrl: "https://cdn/logo.png" },
      language: "fr",
    });
    expect(v.logo_url).toBe("https://cdn/logo.png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/template-fields-identity.test.ts`
Expected: FAIL — `resolveFieldValues` does not accept `university` / `language`, and `logo_url` is not in the registry.

- [ ] **Step 3: Add the registry field**

In `src/lib/template-fields.ts`, append to `TEMPLATE_FIELDS`:

```ts
  { key: "logo_url", type: "text", required: false, aliases: ["logo", "institute_logo"] },
```

- [ ] **Step 4: Extend `resolveFieldValues`**

Replace the signature and the `institute_name` line:

```ts
export function resolveFieldValues(input: {
  title?: string;
  frontMatter?: Record<string, any> | null;
  profile?: { fullName?: string | null; university?: string | null; department?: string | null } | null;
  // Resolved institution. Outranks the profile's free-text university, because
  // this one came from the catalogue rather than a text box.
  university?: { nameFr: string; nameAr: string; logoUrl: string | null } | null;
  language?: string | null;
}): Record<string, string> {
  const fm = input.frontMatter ?? {};
  const p = input.profile ?? {};
  const u = input.university ?? null;
  const uniName = u ? (input.language === "ar" ? u.nameAr : u.nameFr) : "";
  const authorsArr = Array.isArray(fm.authors) ? fm.authors.filter(Boolean) : null;
  const authorsLine = authorsArr ? authorsArr.join(" • ") : undefined;
  const first = (...vals: Array<unknown>): string => {
    for (const v of vals) if (typeof v === "string" && v.length) return v;
    return "";
  };
  return {
    title: first(input.title, fm.title),
    subtitle: first(fm.subtitle),
    student_name: first(fm.student_name, fm.author, authorsLine, p.fullName),
    supervisor_name: first(fm.supervisor_name, fm.supervisor),
    institute_name: first(fm.institute_name, fm.university, uniName, p.university),
    faculty: first(fm.faculty),
    class_name: first(fm.class_name, fm.department, p.department),
    branch_name: first(fm.branch_name, fm.branch),
    specialty_name: first(fm.specialty_name, fm.specialty),
    academic_year: first(fm.academic_year, fm.academicYear, fm.year),
    logo_url: first(fm.logo_url, u?.logoUrl ?? undefined),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/template-fields-identity.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS — 5 new tests, and the whole suite still green. `resolveFieldValues` gained only optional parameters, so every existing caller keeps compiling.

- [ ] **Step 6: Commit**

```bash
git add src/lib/template-fields.ts src/__tests__/template-fields-identity.test.ts
git commit -m "feat(templates): fill institute_name and logo_url from the university row"
```

---

## Task 11: Make `normProfileId` required

Run this **only after Task 6's unmatched list is empty**.

**Files:**
- Create: `scripts/backfill-template-norm-profiles.ts`
- Modify: `src/db/index.ts`, `src/db/schema.ts`

- [ ] **Step 1: Write the backfill**

```ts
// scripts/backfill-template-norm-profiles.ts
// Every template needs reachable rules. For each template without a
// normProfileId, find or create a profile carrying that template's own six
// taxonomy columns — the values are about to stop living on templates.
import "dotenv/config";
import { db, templates, pool } from "../src/db";
import { normProfiles } from "../src/db/norm-profiles";
import { and, eq, isNull } from "drizzle-orm";

async function main() {
  const rows = await db.select().from(templates).where(isNull(templates.normProfileId));
  console.log(`${rows.length} template(s) without a norm profile`);

  for (const t of rows) {
    const language = t.language ?? "fr";
    const discipline = t.discipline ?? "generic";
    const bindingSide = t.bindingSide ?? (language === "ar" ? "right" : "left");

    const [existing] = await db
      .select()
      .from(normProfiles)
      .where(
        and(
          eq(normProfiles.language, language),
          eq(normProfiles.discipline, discipline),
          t.universityId ? eq(normProfiles.universityId, t.universityId) : isNull(normProfiles.universityId)
        )
      )
      .limit(1);

    let profileId = existing?.id;
    if (!profileId) {
      const [created] = await db
        .insert(normProfiles)
        .values({
          slug: `template-${t.id}`,
          name: `${t.name ?? "Template"} — rules`,
          university: t.university ?? null,
          universityId: t.universityId ?? null,
          language,
          discipline,
          bodyPreset: t.bodyPreset ?? "chapters",
          citationStyle: t.citationStyle ?? "apa",
          bindingSide,
          formatting: await defaultFormatting(language, discipline),
        })
        .returning();
      profileId = created.id;
      console.log(`  + created profile for "${t.name}"`);
    }

    await db.update(templates).set({ normProfileId: profileId }).where(eq(templates.id, t.id));
    console.log(`  ✓ "${t.name}" → profile ${profileId}`);
  }
  await pool.end();
}

// Borrow the generic seed's formatting for this (language, discipline) cell so a
// synthesised profile is never blank.
async function defaultFormatting(language: string, discipline: string) {
  const [generic] = await db
    .select()
    .from(normProfiles)
    .where(and(isNull(normProfiles.universityId), eq(normProfiles.language, language), eq(normProfiles.discipline, discipline)))
    .limit(1);
  if (!generic) throw new Error(`No generic norm profile for ${language}/${discipline} — run seedNormProfiles first`);
  return generic.formatting;
}

main();
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/backfill-template-norm-profiles.ts`
Expected: `✓` for the one existing template.

Verify: `psql "$DATABASE_URL" -c "select count(*) from templates where norm_profile_id is null;"`
Expected: `0`

- [ ] **Step 3: Enforce the constraint**

In `src/db/schema.ts`, add `.notNull()`:

```ts
  normProfileId: uuid("norm_profile_id").references(() => normProfiles.id, { onDelete: "restrict" }).notNull(),
```

In `ensureSchema()`, append:

```sql
    -- Guarded: only tightens once every row is backfilled, so a fresh DB or a
    -- half-migrated one boots instead of crashing on startup.
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM templates WHERE norm_profile_id IS NULL) THEN
        ALTER TABLE templates ALTER COLUMN norm_profile_id SET NOT NULL;
      END IF;
    END $$;
```

- [ ] **Step 4: Verify the resolver now reaches rung 1**

Run: `npm run dev`, then:

```bash
psql "$DATABASE_URL" -c "select id from universities where source_id = 103;"
curl -s "http://localhost:3000/api/starting-points?language=ar&level=master&universityId=<that-uuid>" | head -c 300
```

Expected: the first entry is now `"rung": 1, "reason": "exact"`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/index.ts scripts/backfill-template-norm-profiles.ts
git commit -m "feat(templates): require normProfileId so every template has reachable rules"
```

---

## Done when

- `npx vitest run` is green, including 10 ranking tests, 5 identity-fill tests, 5 mapping tests and 7 seed tests.
- `GET /api/starting-points?language=ar&level=master&universityId=<el-bayadh>` returns rung 1.
- The same call without `universityId` returns rung 5 and **no result claiming a university**.
- `select count(*) from universities` is 130; `select count(*) from templates where norm_profile_id is null` is 0.
- Task 6 and Task 3 reported no unresolved rows you have not hand-checked.

### Not done, by design

**The six duplicated columns are still on `templates`.** Dropped in Plan 4, after the app (Plan 2) and dashboard (Plan 3) stop reading them.

**The generic skeleton `.docx` files are not authored here.** The spec calls for one per `type` × binding side (~6 files) as the document rungs 3–5 compose from. They are deliberately out of this plan because the existing create path already handles a `normProfileId` with no template — `src/routes/thesis/crud.ts:117` applies a norm profile to a generated document today. So a rung-3/4/5 result from this resolver is already *usable* end-to-end the moment the app sends its `normProfileId`, and Plan 1 ships working software without them.

What the skeletons add is fidelity, not function: a hand-authored cover with the `{institute_name}` / `{logo_url}` tokens in the right places, rather than a generated one. That work belongs with Plan 2, where the app starts rendering those results and the quality gap becomes visible and judgeable. **If you would rather have the skeletons before the app work, say so — it is a standalone task, not a dependency reordering.**

---

## Notes for whoever executes this

- **Local DB first.** Per the project's local-Supabase setup, run `drizzle push` then let `ensureSchema()` apply the rest. Do not point this at cloud Supabase until the whole plan is green locally.
- **Run the two one-shot scripts in order:** `backfill-university-ids.ts` (Task 6) before `backfill-template-norm-profiles.ts` (Task 11). The second depends on `university_id` being set.
- **Logo mirroring will partially fail** and that is fine. It hits 130 third-party websites. Do not add retries or chase a perfect score.
- **Nothing in this plan changes app or dashboard behaviour.** The old `GET /api/templates` and `GET /api/norm-profiles` endpoints are untouched and still serve the current picker.
