# Dashboard Phase 1 — Server Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `modakerati-server` the staff-role primitives the new dashboard needs — a `profiles.staff_role` column, a reusable `requireStaffRole` middleware — and use them to close the open `/api/news` write hole.

**Architecture:** Add `staff_role` as a plain `text` column on `profiles` (Drizzle schema + `ensureSchema()` auto-migration, matching this repo's additive-column pattern). Split authorization into a **pure decision function** (`decideStaffAccess`, unit-tested) and a thin **Hono middleware** (`requireStaffRole`) that looks the role up via an injectable `getStaffRole` seam (mockable, so the middleware is testable without a DB). Gate the three news write handlers with it. Ship a small CLI to promote the first `super_admin`.

**Tech Stack:** Hono 4, Drizzle ORM (pg Pool), Supabase Auth (JWT via existing `authMiddleware`), Vitest 4, tsx.

**This plan is self-contained and shippable on its own** — the news write-gate is a real security fix independent of the dashboard. It is Plan 1 of 4 for Dashboard Phase 1 (spec: `docs/superpowers/specs/2026-07-17-modakerati-dashboard-phase1-design.md`).

---

## File Structure

Files created or modified in `~/modakerati-server`:

- **Modify** `src/db/schema.ts` — add `staffRole` column to the `profiles` table.
- **Modify** `src/db/index.ts` — add the `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_role text;` line inside `ensureSchema()`.
- **Create** `src/middleware/staff.ts` — `STAFF_ROLES`, `StaffRole`, `isStaffRole`, `decideStaffAccess` (pure), `requireStaffRole` (middleware). One responsibility: staff authorization.
- **Create** `src/middleware/staff-lookup.ts` — `getStaffRole(userId)` DB read. Isolated in its own file so tests can mock this seam without touching `../db` (which constructs a pg Pool on import).
- **Modify** `src/types.ts` — extend `AppVariables` with optional `staffRole`.
- **Modify** `src/routes/news.ts` — guard `POST /`, `PUT /:id`, `DELETE /:id` with `requireStaffRole("content_admin")`.
- **Create** `scripts/set-staff-role.ts` — CLI to set/clear a user's `staff_role` by email (bootstraps the first super_admin).
- **Create** `src/__tests__/staff-access.test.ts` — unit tests for `decideStaffAccess` / `isStaffRole`.
- **Create** `src/__tests__/staff-middleware.test.ts` — integration tests for `requireStaffRole` via Hono `app.request()`.

Run all tests with `npm test` (`vitest run`) from `~/modakerati-server`.

---

## Task 1: Add the `staff_role` column

**Files:**
- Modify: `src/db/schema.ts:7-26` (the `profiles` table)
- Modify: `src/db/index.ts` (inside `ensureSchema()`, near line 133)

- [ ] **Step 1: Add the column to the Drizzle schema**

In `src/db/schema.ts`, the `profiles` table currently ends with `updatedAt`. Add `staffRole` just before `createdAt`. `text` is already imported (line 1), so no import change. Result:

```ts
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name").notNull().default(""),
  email: text("email").notNull().default(""),
  university: text("university"),
  department: text("department"),
  level: text("level"),
  academicYear: text("academic_year"),
  avatarUrl: text("avatar_url"),
  language: text("language").default("fr"),
  theme: text("theme").default("dark"),
  notificationPreferences: jsonb("notification_preferences").default({
    pushEnabled: true,
    aiSuggestions: true,
    exportReminders: false,
    marketing: false,
  }),
  // Admin authority axis (separate from the student persona). NULL = not staff.
  // Constrained to STAFF_ROLES in application code (this repo uses no pgEnum).
  staffRole: text("staff_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

- [ ] **Step 2: Add the auto-migration to `ensureSchema()`**

In `src/db/index.ts`, find the existing `ALTER TABLE theses ...` lines (around line 132-133) inside the big SQL template in `ensureSchema()`. Add a profiles ALTER directly after them:

```sql
    ALTER TABLE theses ADD COLUMN IF NOT EXISTS norm_profile_id uuid REFERENCES norm_profiles(id);
    ALTER TABLE theses ADD COLUMN IF NOT EXISTS analysis_report jsonb;

    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_role text;
```

(Keep the exact indentation of the surrounding template literal.)

- [ ] **Step 3: Verify it type-checks**

Run: `cd ~/modakerati-server && npm run build`
Expected: `tsc` completes with no NEW errors. (Baseline note: pre-existing `ws` realtime typing errors in `src/lib/supabase.ts` may appear — those are not yours. There should be no error mentioning `staff_role`, `staffRole`, or `profiles`.)

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati-server
git add src/db/schema.ts src/db/index.ts
git commit -m "feat(db): add profiles.staff_role column (auto-migrated via ensureSchema)"
```

---

## Task 2: `decideStaffAccess` — the pure authorization decision (TDD)

**Files:**
- Create: `src/middleware/staff.ts`
- Test: `src/__tests__/staff-access.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/staff-access.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decideStaffAccess, isStaffRole, STAFF_ROLES } from "../middleware/staff";

describe("isStaffRole", () => {
  it("accepts every known role and rejects anything else", () => {
    for (const r of STAFF_ROLES) expect(isStaffRole(r)).toBe(true);
    expect(isStaffRole("student")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

describe("decideStaffAccess", () => {
  it("rejects a non-staff role with 403", () => {
    expect(decideStaffAccess(null, [])).toMatchObject({ ok: false, status: 403 });
    expect(decideStaffAccess("student", ["support_admin"])).toMatchObject({ ok: false, status: 403 });
  });

  it("lets super_admin bypass the allowed list", () => {
    expect(decideStaffAccess("super_admin", ["finance_admin"])).toEqual({ ok: true });
  });

  it("allows a role that is in the allowed list", () => {
    expect(decideStaffAccess("content_admin", ["content_admin"])).toEqual({ ok: true });
  });

  it("rejects a staff role that is not in a non-empty allowed list", () => {
    expect(decideStaffAccess("support_admin", ["content_admin"])).toMatchObject({ ok: false, status: 403 });
  });

  it("treats an empty allowed list as 'any staff role'", () => {
    expect(decideStaffAccess("finance_admin", [])).toEqual({ ok: true });
    expect(decideStaffAccess("platform_admin", [])).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/staff-access.test.ts`
Expected: FAIL — cannot resolve `../middleware/staff` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/middleware/staff.ts`:

```ts
// Staff authorization for the ops dashboard. Split into a PURE decision
// (decideStaffAccess) and a thin Hono middleware (requireStaffRole, Task 3).

export const STAFF_ROLES = [
  "super_admin",
  "support_admin",
  "content_admin",
  "finance_admin",
  "platform_admin",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

export type StaffDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

/**
 * Pure authorization decision.
 * - A non-staff role (null/unknown) is always denied (403).
 * - `super_admin` bypasses the allowed list.
 * - An empty `allowed` list means "any staff role is sufficient".
 */
export function decideStaffAccess(role: unknown, allowed: readonly StaffRole[]): StaffDecision {
  if (!isStaffRole(role)) {
    return { ok: false, status: 403, message: "Forbidden — staff access required" };
  }
  if (role === "super_admin") return { ok: true };
  if (allowed.length > 0 && !allowed.includes(role)) {
    return { ok: false, status: 403, message: "Forbidden — insufficient role" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/staff-access.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/middleware/staff.ts src/__tests__/staff-access.test.ts
git commit -m "feat(auth): pure decideStaffAccess authorization decision + tests"
```

---

## Task 3: `requireStaffRole` middleware + `getStaffRole` lookup (TDD)

**Files:**
- Create: `src/middleware/staff-lookup.ts`
- Modify: `src/middleware/staff.ts` (add imports + `requireStaffRole`)
- Modify: `src/types.ts:3-7` (extend `AppVariables`)
- Test: `src/__tests__/staff-middleware.test.ts`

- [ ] **Step 1: Create the DB lookup seam**

Create `src/middleware/staff-lookup.ts`:

```ts
import { db, profiles } from "../db";
import { eq } from "drizzle-orm";

/**
 * Reads the staff_role column for a user id. Returns null when unset or no row.
 * Isolated here (not inline in staff.ts) so tests can mock this one function
 * without importing ../db, which constructs a pg Pool on module load.
 */
export async function getStaffRole(userId: string): Promise<string | null> {
  const rows = await db
    .select({ staffRole: profiles.staffRole })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return rows[0]?.staffRole ?? null;
}
```

- [ ] **Step 2: Extend `AppVariables`**

In `src/types.ts`, add `staffRole` so middleware can stash the resolved role:

```ts
import type { User } from "@supabase/supabase-js";

export type AppVariables = {
  user: User;
  userId: string;
  token: string;
  staffRole?: string | null;
};
```

- [ ] **Step 3: Write the failing middleware test**

Create `src/__tests__/staff-middleware.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../types";

// Mock the lookup seam so no DB is needed.
vi.mock("../middleware/staff-lookup", () => ({ getStaffRole: vi.fn() }));
import { getStaffRole } from "../middleware/staff-lookup";
import { requireStaffRole } from "../middleware/staff";

const mockGetStaffRole = vi.mocked(getStaffRole);

// Build a tiny app: a stand-in for authMiddleware sets userId, then the guard.
function buildApp(guard: ReturnType<typeof requireStaffRole>, withUser = true) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    if (withUser) c.set("userId", "user-1");
    await next();
  });
  app.post("/x", guard, (c) => c.json({ ok: true }, 201));
  return app;
}

describe("requireStaffRole middleware", () => {
  beforeEach(() => mockGetStaffRole.mockReset());

  it("401 when there is no authenticated user id", async () => {
    const res = await buildApp(requireStaffRole("content_admin"), false).request("/x", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("403 when the user has no staff role", async () => {
    mockGetStaffRole.mockResolvedValue(null);
    const res = await buildApp(requireStaffRole("content_admin")).request("/x", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("201 when the user's role matches the required role", async () => {
    mockGetStaffRole.mockResolvedValue("content_admin");
    const res = await buildApp(requireStaffRole("content_admin")).request("/x", { method: "POST" });
    expect(res.status).toBe(201);
  });

  it("403 when a staff role is not the required one", async () => {
    mockGetStaffRole.mockResolvedValue("support_admin");
    const res = await buildApp(requireStaffRole("content_admin")).request("/x", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("lets super_admin through any guard", async () => {
    mockGetStaffRole.mockResolvedValue("super_admin");
    const res = await buildApp(requireStaffRole("content_admin")).request("/x", { method: "POST" });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/staff-middleware.test.ts`
Expected: FAIL — `requireStaffRole` is not exported from `../middleware/staff` yet.

- [ ] **Step 5: Add `requireStaffRole` to `src/middleware/staff.ts`**

Add these imports at the TOP of `src/middleware/staff.ts` (above the `STAFF_ROLES` const):

```ts
import type { Context, Next } from "hono";
import type { AppVariables } from "../types";
import { getStaffRole } from "./staff-lookup";
```

Then append this function to the END of the same file:

```ts
/**
 * Hono middleware. Requires the authenticated user (userId set by authMiddleware)
 * to hold one of `allowed` staff roles. super_admin always passes; an empty
 * `allowed` means any staff role. Stashes the resolved role on the context.
 */
export function requireStaffRole(...allowed: StaffRole[]) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const role = await getStaffRole(userId);
    const decision = decideStaffAccess(role, allowed);
    if (!decision.ok) return c.json({ error: decision.message }, decision.status);

    c.set("staffRole", role);
    await next();
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/__tests__/staff-middleware.test.ts`
Expected: PASS — all five cases green.

- [ ] **Step 7: Run the full suite + build**

Run: `cd ~/modakerati-server && npm test && npm run build`
Expected: all tests pass (including the pre-existing `doc-direction` tests); `tsc` shows no new errors.

- [ ] **Step 8: Commit**

```bash
cd ~/modakerati-server
git add src/middleware/staff.ts src/middleware/staff-lookup.ts src/types.ts src/__tests__/staff-middleware.test.ts
git commit -m "feat(auth): requireStaffRole middleware with mockable getStaffRole seam"
```

---

## Task 4: Gate the news write endpoints (the security fix)

**Files:**
- Modify: `src/routes/news.ts` (imports + the 3 write handlers at lines 132, 158, 171)

- [ ] **Step 1: Import the guard**

In `src/routes/news.ts`, add below the existing `import type { AppVariables } from "../types";` (line 2):

```ts
import { requireStaffRole } from "../middleware/staff";
```

- [ ] **Step 2: Add the guard to the three write handlers**

Insert `requireStaffRole("content_admin")` as middleware on each write route. Change the three handler signatures (leave the handler bodies untouched):

```ts
newsRoutes.post("/", requireStaffRole("content_admin"), async (c) => {
```

```ts
newsRoutes.put("/:id", requireStaffRole("content_admin"), async (c) => {
```

```ts
newsRoutes.delete("/:id", requireStaffRole("content_admin"), async (c) => {
```

Do **not** touch `GET /`, `GET /categories`, `GET /:id`, or `POST /:id/click` — reads and the click counter stay open to any authenticated user.

- [ ] **Step 3: Verify it type-checks**

Run: `cd ~/modakerati-server && npm run build`
Expected: `tsc` completes with no new errors.

- [ ] **Step 4: Manual integration check (needs a running server)**

The automated middleware test (Task 3) already proves the guard's logic. This step confirms the wiring end-to-end. In one terminal: `cd ~/modakerati-server && npm run dev`. Then, with a Supabase JWT for a **non-staff** user in `$JWT`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/news \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"slug":"gate-test","category":"Update"}'
```
Expected: `403`.

Then set that user's role (Task 5 script) to `content_admin` and repeat.
Expected: `201`, and the created post is returned. Delete it afterward with `DELETE /api/news/:id` (now also `201`/`200` for the staff user).

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/routes/news.ts
git commit -m "fix(news): gate POST/PUT/DELETE /api/news behind requireStaffRole (content_admin)"
```

---

## Task 5: `set-staff-role` CLI (bootstrap the first admin)

**Files:**
- Create: `scripts/set-staff-role.ts`

- [ ] **Step 1: Write the script**

Create `scripts/set-staff-role.ts`:

```ts
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, profiles } from "../src/db";
import { STAFF_ROLES, isStaffRole } from "../src/middleware/staff";

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !role) {
    console.error("Usage: npx tsx scripts/set-staff-role.ts <email> <role|none>");
    console.error(`Roles: ${STAFF_ROLES.join(", ")} | none`);
    process.exit(1);
  }

  const value = role === "none" ? null : role;
  if (value !== null && !isStaffRole(value)) {
    console.error(`Invalid role "${role}". Valid: ${STAFF_ROLES.join(", ")}, none`);
    process.exit(1);
  }

  const [row] = await db
    .update(profiles)
    .set({ staffRole: value })
    .where(eq(profiles.email, email))
    .returning({ id: profiles.id, email: profiles.email, staffRole: profiles.staffRole });

  if (!row) {
    console.error(`No profile found with email ${email}`);
    process.exit(1);
  }

  console.log(`Set ${row.email} -> staff_role = ${row.staffRole ?? "(none)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd ~/modakerati-server && npx tsc --noEmit scripts/set-staff-role.ts` — if that flags module-resolution noise, instead rely on the project build: `npm run build`.
Expected: no new type errors referencing `set-staff-role`, `staffRole`, or `profiles`.

- [ ] **Step 3: Verify it runs (requires a reachable `DATABASE_URL` + the column from Task 1 applied)**

Run: `cd ~/modakerati-server && npx tsx scripts/set-staff-role.ts your-account@example.com super_admin`
Expected: `Set your-account@example.com -> staff_role = super_admin`.
(If `DATABASE_URL` is unreachable in this environment, the equivalent is one SQL statement in the Supabase SQL editor: `update profiles set staff_role = 'super_admin' where email = 'your-account@example.com';` — note the column exists only after a server boot that ran `ensureSchema`, or after `npx drizzle-kit push`.)

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati-server
git add scripts/set-staff-role.ts
git commit -m "chore(scripts): set-staff-role CLI to promote/demote staff by email"
```

---

## Self-Review

**Spec coverage** (against spec §3 and §6):
- §6.1 `staff_role` column → Task 1 (schema + ensureSchema). ✅
- §6.2 `requireStaffRole` middleware → Tasks 2–3. ✅
- §6.3 gate `/api/news` writes → Task 4. ✅
- §6.4 providers staff-JWT → **intentionally deferred** to the dashboard plans: the dashboard will call the existing token-gated `/admin/providers/api/*` using `ADMIN_API_TOKEN` held server-side, gating the page itself by `staff_role`. No server change needed in Phase 1; revisit if we later want per-staff attribution on provider ops. (Noted so it is not a silent gap.)
- §6.5 KPI aggregates need no new endpoints → nothing to do here. ✅
- §3 five roles + super_admin bypass → `STAFF_ROLES` + `decideStaffAccess`. ✅
- §3 pre-migration super_admin fallback → that fallback lives in the **dashboard** (`lib/auth/staff.ts`), not the server; covered in Plan 2, not here.

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has an expected result. ✅

**Type consistency:** `StaffRole` / `STAFF_ROLES` / `decideStaffAccess` / `isStaffRole` / `getStaffRole` / `requireStaffRole` are named identically everywhere they appear (Tasks 2–5). `AppVariables.staffRole?: string | null` matches `c.set("staffRole", role)` where `role: string | null`. `decideStaffAccess` returns `{ ok, status, message }` consumed exactly by the middleware. ✅

**Note on the `content_admin` guard choice:** news writes are gated to `content_admin` (super_admin bypasses). If you want support/finance staff to post news too, widen the guard to `requireStaffRole("content_admin", "support_admin")` — the variadic API already supports it.
