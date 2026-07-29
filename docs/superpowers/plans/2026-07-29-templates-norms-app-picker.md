# Templates & Norms — App Picker Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the empty-feeling "Choose a template" screen with a match-first flow: one recommended starting point derived from the student's own institution, with a ranked browse list behind a link.

**Architecture:** The server already exposes `GET /api/starting-points`, which ranks by a five-rung fallback ladder. This plan (a) enriches that response so one request renders a card, (b) makes the student's university a real picked id rather than typed text, and (c) splits the 797-line `template-picker.tsx` into two focused screens.

**Tech Stack:** Expo (SDK 56) + expo-router, Zustand, react-i18next (en/fr/ar), Hono/Drizzle server.

**Depends on:** Plan 1, complete on branch `feat/university-layer` in `~/modakerati-server`.

**Spec:** `docs/superpowers/specs/2026-07-29-templates-norms-design.md`

---

## Critical repo constraints

- **The app has NO JS test runner.** Gate every app change with `npx tsc --noEmit` plus running the app. Do not add jest/vitest to the app. The *server* half of this plan (Task 1) DOES have vitest — use it there.
- **`locales/{en,fr,ar}.json` contain duplicate keys.** Edit them **surgically with string insertion** — never `json.load` / `json.dump`, which silently drops keys and reformats the whole file.
- **Zustand v5 selector trap:** a selector returning a fresh object/array literal causes "Maximum update depth exceeded". Select primitives individually.
- **Another session may hold uncommitted work** in `~/modakerati` (voice-lab) and `~/modakerati-server` (MCP). `git add` exact paths only; never stage files you did not write.
- **Server branch:** all server work goes on `feat/university-layer`, not master.

---

## File Structure

**Server (`~/modakerati-server`, branch `feat/university-layer`)**

| File | Change |
|---|---|
| `src/lib/starting-points-db.ts` | Enrich results with display data |
| `src/routes/universities.ts` | Serve the `universities` TABLE, not the JSON |
| `src/__tests__/starting-points-display.test.ts` | New — pins the enrichment shape |

**App (`~/modakerati`)**

| File | Change |
|---|---|
| `lib/api.ts` | Add `listUniversities`, `getStartingPoints` |
| `types/thesis.ts` | Add `University`, `StartingPoint` types |
| `stores/university-store.ts` | New — the 130-row list, cached |
| `components/UniversityPicker.tsx` | New — searchable institution picker |
| `app/(auth)/signup.tsx` | University `TextInput` → picker |
| `app/(app)/edit-profile.tsx` | Same |
| `app/(app)/start-thesis.tsx` | New — match-first screen |
| `app/(app)/browse-templates.tsx` | New — ranked list |
| `app/(app)/template-picker.tsx` | **Deleted** |
| `stores/thesis-wizard-store.ts` | Carry `startingPoint` |
| `locales/{en,fr,ar}.json` | New strings, surgically inserted |

---

## Task 1: Enrich the starting-points response (SERVER)

The endpoint currently returns `{ kind, templateId, normProfileId, rung, reason }` — ids only. A card needs a name, a thumbnail, and the institution's crest. Without this the app makes N+1 requests to render one card.

**Files:**
- Modify: `src/lib/starting-points-db.ts`
- Test: `src/__tests__/starting-points-display.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/starting-points-display.test.ts
import { describe, it, expect } from "vitest";
import { buildDisplay } from "../lib/starting-points-db";

describe("starting point display data", () => {
  const uni = { id: "u1", nameFr: "Centre X", nameAr: "مركز س", logoPath: "1.png", wilaya: "Alger", type: "university" };
  const profile = { id: "p1", universityId: "u1", language: "ar", discipline: "generic", bodyPreset: "chapters", citationStyle: "apa", bindingSide: "right" };

  it("uses the Arabic university name for an Arabic result", () => {
    const d = buildDisplay({ template: null, profile, university: uni, language: "ar" });
    expect(d.universityName).toBe("مركز س");
  });

  it("uses the French name otherwise", () => {
    const d = buildDisplay({ template: null, profile, university: uni, language: "fr" });
    expect(d.universityName).toBe("Centre X");
  });

  it("carries the template name and thumb when a template backs the result", () => {
    const template = { id: "t1", name: "Master AR", config: { thumbUrl: "https://x/t.png" } } as any;
    const d = buildDisplay({ template, profile, university: uni, language: "ar" });
    expect(d.title).toBe("Master AR");
    expect(d.thumbUrl).toBe("https://x/t.png");
    expect(d.hasDocument).toBe(true);
  });

  it("marks a rules-only result as having no document", () => {
    const d = buildDisplay({ template: null, profile, university: uni, language: "ar" });
    expect(d.hasDocument).toBe(false);
    expect(d.thumbUrl).toBeNull();
  });

  it("tolerates a missing university", () => {
    const d = buildDisplay({ template: null, profile, university: null, language: "fr" });
    expect(d.universityName).toBeNull();
    expect(d.logoUrl).toBeNull();
  });

  it("carries the formatting facts a card shows as chips", () => {
    const d = buildDisplay({ template: null, profile, university: uni, language: "ar" });
    expect(d.language).toBe("ar");
    expect(d.citationStyle).toBe("apa");
    expect(d.bindingSide).toBe("right");
  });
});
```

Run: `npx vitest run src/__tests__/starting-points-display.test.ts` → FAIL, `buildDisplay` not exported.

- [ ] **Step 2: Implement `buildDisplay` and widen the result type**

In `src/lib/starting-points-db.ts`, add an exported pure helper and an enriched result type. `buildDisplay` must be **pure** (no DB, no IO) so the test needs no database:

```ts
export interface StartingPointDisplay {
  title: string | null;          // template name, or null for rules-only
  thumbUrl: string | null;
  hasDocument: boolean;
  universityName: string | null; // language-appropriate
  logoUrl: string | null;
  language: string;
  discipline: string;
  citationStyle: string;
  bindingSide: string;
}

export function buildDisplay(input: {
  template: { id: string; name: string | null; config: any } | null;
  profile: { language: string; discipline: string; citationStyle: string; bindingSide: string };
  university: { nameFr: string; nameAr: string; logoPath: string | null } | null;
  language: string;
}): StartingPointDisplay { /* ... */ }
```

`logoUrl` uses `universityLogoUrl(university.logoPath)` from `src/lib/university-storage.ts` (returns null for a null path).

Then have `resolveStartingPoints` attach `display` to every returned entry. **Do not change `rankStartingPoints`** — enrichment happens after ranking, in the DB layer. The ranking core stays pure and untouched.

To build display for a rules-only result you need the *university that owns the profile* (rung 3) or none (rungs 4/5 — those must NOT show a university name, per the honesty rule). Be explicit: **only attach `universityName`/`logoUrl` when the entry's rung is 1, 2 or 3.** At rungs 4 and 5 the student's own institution is not the source of the rules, and showing its crest next to "Standard Algerian layout" would imply otherwise.

- [ ] **Step 3: Run tests**

`npx vitest run` — report the count. `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/starting-points-db.ts src/__tests__/starting-points-display.test.ts
git commit -m "feat(resolver): attach display data so one request renders a card"
```

---

## Task 2: Serve universities from the table (SERVER)

`src/routes/universities.ts` still reads `algerian-universities.json` directly and has a dead `/browse` HTML page whose "Create Template" button POSTs to a nonexistent endpoint.

**Files:** Modify `src/routes/universities.ts`

- [ ] **Step 1:** Replace the JSON import with a query against the `universities` table. Keep the existing query params (`q`, `type`, `wilaya`) and the `{ count, universities }` response shape so nothing else breaks. Include `id` (the uuid), `sourceId`, names, city, wilaya, type, website, and a resolved `logoUrl` via `universityLogoUrl(logoPath)`.

- [ ] **Step 2:** **Delete the `/browse` HTML route entirely.** It is a developer artifact, its "Create Template" button posts to `/api/templates/from-university` which does not exist, and the dashboard now owns this surface.

- [ ] **Step 3:** Verify — `npx tsc --noEmit`, `npx vitest run`, then:
```bash
curl -s "http://localhost:3000/universities?q=bayadh" | head -c 300
```
Expect one result with a real uuid `id` and a `logoUrl`.

- [ ] **Step 4: Commit**
```bash
git add src/routes/universities.ts
git commit -m "feat(universities): serve the table instead of the static JSON; drop the dead browse page"
```

---

## Task 3: App API client + types

**Files:** `lib/api.ts`, `types/thesis.ts`, `stores/university-store.ts`

- [ ] **Step 1:** Add to `types/thesis.ts`:

```ts
export interface University {
  id: string;
  sourceId: number;
  nameFr: string;
  nameAr: string;
  nameEn: string;
  city: string;
  wilaya: string;
  type: "university" | "ecole" | "ens" | "centre_universitaire";
  logoUrl: string | null;
}

export type StartingPointRung = 1 | 2 | 3 | 4 | 5;
export type StartingPointReason =
  | "exact" | "same-university-adapted" | "own-rules" | "peer-rules" | "national";

export interface StartingPoint {
  kind: "template" | "profile";
  templateId: string | null;
  normProfileId: string;
  rung: StartingPointRung;
  reason: StartingPointReason;
  display: {
    title: string | null;
    thumbUrl: string | null;
    hasDocument: boolean;
    universityName: string | null;
    logoUrl: string | null;
    language: string;
    discipline: string;
    citationStyle: string;
    bindingSide: string;
  };
}
```

- [ ] **Step 2:** Add to `lib/api.ts`, following the existing `apiGet` conventions in that file:

```ts
export async function listUniversities(q?: string): Promise<{ count: number; universities: University[] }>
export async function getStartingPoints(input: {
  universityId?: string | null;
  level?: string | null;
  language: string;
  discipline?: string;
}): Promise<{ count: number; startingPoints: StartingPoint[] }>
```

`listUniversities` hits `/universities` (public, outside `/api/*`); `getStartingPoints` hits `/api/starting-points` (authenticated).

- [ ] **Step 3:** Create `stores/university-store.ts` — a Zustand store holding the 130 rows with a `loaded` flag so it fetches once per session. **Select primitives individually in consumers**; never return a fresh object from a selector.

- [ ] **Step 4:** `npx tsc --noEmit` clean. Commit.

---

## Task 4: University picker component + profile capture

**Files:** `components/UniversityPicker.tsx` (new), `app/(auth)/signup.tsx`, `app/(app)/edit-profile.tsx`

- [ ] **Step 1:** Build `UniversityPicker` — a searchable list over the university store showing logo, `nameFr`, `nameAr` (RTL-correct), city and wilaya. Search must match French, Arabic and English names plus city. Follow existing app patterns: `useThemeColors`, trilingual labels via `useTranslation`.

Props: `value: string | null` (universityId), `onChange: (id: string | null, uni: University | null) => void`, and an `allowSkip` affordance — a student whose institution is genuinely absent must be able to continue.

- [ ] **Step 2:** In `signup.tsx`, replace the free-text university `TextInput` with the picker, submitting `universityId`. **Keep sending the display name too** so `profiles.university` stays populated for anyone the picker can't cover.

- [ ] **Step 3:** Same in `edit-profile.tsx`.

- [ ] **Step 4:** Verify the profile round-trips: create/edit a profile, confirm `profiles.university_id` is set:
```bash
psql "$DATABASE_URL" -c "select id, university, university_id from profiles;"
```

- [ ] **Step 5:** `npx tsc --noEmit`. Commit.

---

## Task 5: `start-thesis.tsx` — the match-first screen

**Files:** `app/(app)/start-thesis.tsx` (new)

- [ ] **Step 1:** Build the screen. On mount, read the profile's `universityId`, `level` and the chosen thesis language, then call `getStartingPoints`.

Layout, top to bottom:
1. **The "For you" card** — the first result. Shows the crest and institution name **only when `display.universityName` is non-null** (rungs 1–3), the title, chips for language/citation/binding, a rung badge, and a primary **Start writing** button.
2. **The next-best alternative**, quiet, one line.
3. `Browse all templates ›`
4. `Blank thesis`

- [ ] **Step 2: The honesty rule in UI.** Map `reason` → copy via i18n keys. **A rung 4 or 5 result must never render the student's university name or crest.** Badge text:

| reason | key |
|---|---|
| `exact` | `startingPoint.reason.exact` — "Your university" |
| `same-university-adapted` | "Your university — adapted" |
| `own-rules` | "Built to your university's rules" |
| `peer-rules` | "Standard {{language}} layout" |
| `national` | "Standard Algerian layout" |

- [ ] **Step 3:** If the profile has **no** `universityId`, render the `UniversityPicker` inline once, at the top, rather than routing to settings. Persist the choice to the profile, then re-fetch.

- [ ] **Step 4:** Wire `Start writing` into the existing wizard: set `templateId` / `normProfileId` on `thesis-wizard-store` from the chosen starting point, then navigate to the next wizard step exactly as `template-picker.tsx` did. **Read the old screen's navigation carefully and preserve it.**

- [ ] **Step 5:** `npx tsc --noEmit`, then run the app and confirm the screen renders with a real account. Commit.

---

## Task 6: `browse-templates.tsx` + delete the old picker

**Files:** `app/(app)/browse-templates.tsx` (new), `app/(app)/template-picker.tsx` (delete), `app/(app)/_layout.tsx`, `stores/thesis-wizard-store.ts`

- [ ] **Step 1:** Build the ranked list: a single search field (replacing the three filter chips) and cards ordered by rung, each showing its reason badge. Same honesty rule.

- [ ] **Step 2:** Delete `app/(app)/template-picker.tsx` and its route registration; point every navigation that targeted it at `start-thesis`. **Grep for `template-picker` across the whole app** and fix each hit.

- [ ] **Step 3:** Remove the `profilesMode` concept and the "No template fits? Start with a formatting profile" link. Norm profiles are no longer a user-facing choice — they are what rungs 3–5 resolve through.

- [ ] **Step 4:** Leave `combine-arrange.tsx`'s explicit norm-profile selector **alone**. Combining existing documents is a different act and the student there is deliberately choosing rules.

- [ ] **Step 5:** `npx tsc --noEmit`. Run the app: create a thesis end to end. Commit.

---

## Task 7: Trilingual strings

**Files:** `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1:** Add every new key to all three files.

⚠️ **These files contain duplicate keys.** Insert new keys with targeted string edits (the Edit tool). **Never** parse-and-rewrite the file — `json.load`/`json.dump` silently drops the duplicates and reformats everything.

- [ ] **Step 2:** Verify each file still parses and that the key count only went up:
```bash
for f in en fr ar; do node -e "JSON.parse(require('fs').readFileSync('locales/$f.json','utf8')); console.log('$f ok')"; done
```

- [ ] **Step 3:** Check the Arabic strings render RTL correctly in the app. Commit.

---

## Done when

- `npx tsc --noEmit` clean in both repos; server `npx vitest run` green.
- A student with a `universityId` opens the app and sees ONE recommended card with their institution's name and crest, not an empty filter grid.
- A student with no `universityId` is asked once, inline.
- No rung-4 or rung-5 result displays a university name or crest anywhere.
- `template-picker.tsx` and `profilesMode` are gone; nothing references them.
- All three locale files parse and contain the new keys.

## Out of scope

- The generic skeleton `.docx` files (composition fidelity) — a later pass.
- Dashboard work — Plan 3.
- Dropping the six duplicated `templates` columns — Plan 4.
