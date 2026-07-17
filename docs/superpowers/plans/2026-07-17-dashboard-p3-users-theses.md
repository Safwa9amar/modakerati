# Dashboard Phase 1 — Plan 3: Users + Theses modules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the support-admin seat — a Users directory + detail (with the super-admin "set staff role" action) and a Theses monitor + read-only drill-in.

**Architecture:** Feature-first modules (`src/features/users`, `src/features/theses`) with the routing triad, on the Plan-2 foundation. All data is plain CRUD → direct Supabase via `createAdminClient` (Hybrid C "rows"). Mutations are Server Actions guarded by `hasStaffRole`. Adds a `DataTable` to the UI kit.

> **SECURITY (from Plan 2's final review) — server-side per-route authZ is mandatory.** In the App Router, a route's server `page.tsx` runs and streams its RSC payload *before* any client shell can hide it. The Plan-2 `DashboardShell` client guard (`{allowed ? children : null}`) is UX only — it does NOT stop a wrong-role staff user's server `data.ts` from executing and returning data. Therefore **every restricted server `page.tsx` in this plan (and Plan 4) MUST call the `requirePathAccess` guard below as its first line** (before any data fetch). This is introduced as Task 0 and used in Tasks 4 & 6.

**Tech Stack:** Next.js 16, `@tanstack/react-table`, `@supabase/ssr` (admin client), lucide-react.

**Depends on:** Plan 2 (foundation), and Plan 1 (`profiles.staff_role`) for the set-staff-role action to persist. Reference: `~/blink-dashboard/src/features/users` and its `DataTable`.

**Plan 3 of 4.** Spec: `docs/superpowers/specs/2026-07-17-modakerati-dashboard-phase1-design.md` §5.2–5.3.

---

## File Structure (under `~/modakerati-dashboard/`)

- `src/components/ui/data-table.tsx` (+ export from `index.ts`) — TanStack table with sort + pagination.
- `src/features/users/{index.ts,types.ts,data.ts,components/*,locales/*}`.
- `src/features/theses/{index.ts,types.ts,data.ts,components/*,locales/*}`.
- `src/app/d/users/{page.tsx,client.tsx,action.ts,[id]/{page.tsx,client.tsx}}`.
- `src/app/d/theses/{page.tsx,client.tsx,[id]/{page.tsx,client.tsx}}`.
- Register both feature bundles in `src/i18n/messages.ts`.

---

## Task 0: `requirePathAccess` server guard

**Files:** `src/lib/auth/require-path.ts`.

- [ ] **Step 1: Add the server-side route guard**

Create `src/lib/auth/require-path.ts`:

```ts
import "server-only";
import { redirect } from "next/navigation";
import { getCurrentStaffRole } from "./staff";
import { canAccessPath, type StaffRole } from "./access";

/**
 * Server-side per-route authorization. Call as the FIRST line of every
 * restricted server page.tsx (before any data fetch). Non-staff → /no-access;
 * wrong-role staff → their default landing. Returns the role for convenience.
 */
export async function requirePathAccess(pathname: string): Promise<StaffRole> {
  const role = await getCurrentStaffRole();
  if (!role) redirect("/no-access");
  if (!canAccessPath(role, pathname)) {
    const { defaultPathFor } = await import("./access");
    redirect(defaultPathFor(role));
  }
  return role;
}
```

- [ ] **Step 2: Verify + commit**

Run `cd ~/modakerati-dashboard && npx tsc --noEmit` → clean.
```bash
git add src/lib/auth/require-path.ts
git commit -m "feat(auth): requirePathAccess server-side route guard"
```

**Usage rule for the rest of this plan:** every server `page.tsx` under a restricted route begins with `await requirePathAccess("<its route prefix>")` — e.g. `/d/users` and `/d/users/[id]` both call `requirePathAccess("/d/users")`; `/d/theses*` call `requirePathAccess("/d/theses")`. The `/d` overview (open to all staff) does not need it.

---

## Task 1: `DataTable` UI primitive

**Files:** `src/components/ui/data-table.tsx`, `src/components/ui/index.ts`.

- [ ] **Step 1: Mirror blink's DataTable**

Reproduce `~/blink-dashboard/src/components/ui/` DataTable (the TanStack-backed `DataTable<T>` + `Column<T>` type with sorting + pagination), adapting classes to Modakerati tokens. Export both from the `@/components/ui` barrel.

- [ ] **Step 2: Verify**

Run: `cd ~/modakerati-dashboard && npx tsc --noEmit`
Expected: clean; `DataTable`/`Column` importable from `@/components/ui`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/data-table.tsx src/components/ui/index.ts
git commit -m "feat(ui): TanStack DataTable + Column primitive"
```

---

## Task 2: Users — types + data

**Files:** `src/features/users/{types.ts,data.ts,index.ts}`.

- [ ] **Step 1: Types (mirrored from server Drizzle `profiles`)**

Create `src/features/users/types.ts`. Keep in sync by hand with `~/modakerati-server/src/db/schema.ts` `profiles`:

```ts
// Mirrors modakerati-server profiles table. Keep in sync by hand.
export type UserRow = {
  id: string;
  email: string;
  fullName: string;
  university: string | null;
  department: string | null;
  level: string | null;
  academicYear: string | null;
  language: string | null;
  staffRole: string | null;
  createdAt: string | null;
};

export type UserListItem = UserRow & { thesisCount: number; plan: string | null };

export type UserDetail = {
  profile: UserRow;
  plan: string | null;
  subscriptionStatus: string | null;
  theses: { id: string; title: string; status: string | null; updatedAt: string | null }[];
  recentNotifications: { id: string; title: string | null; createdAt: string | null }[];
};
```

- [ ] **Step 2: Data reads (server-only, admin client)**

Create `src/features/users/data.ts`:

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserListItem, UserDetail } from "./types";

export async function listUsers(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: UserListItem[]; total: number }> {
  const db = createAdminClient();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let query = db.from("profiles")
    .select("id,email,full_name,university,department,level,academic_year,language,staff_role,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (opts.q) query = query.or(`email.ilike.%${opts.q}%,full_name.ilike.%${opts.q}%,university.ilike.%${opts.q}%`);
  const { data, count } = await query;

  const ids = (data ?? []).map((r) => r.id);
  const [{ data: theses }, { data: subs }] = await Promise.all([
    ids.length ? db.from("theses").select("user_id").in("user_id", ids) : Promise.resolve({ data: [] as { user_id: string }[] }),
    ids.length ? db.from("subscriptions").select("user_id,plan,status").in("user_id", ids) : Promise.resolve({ data: [] as { user_id: string; plan: string; status: string }[] }),
  ]);
  const countByUser = new Map<string, number>();
  for (const t of theses ?? []) countByUser.set(t.user_id, (countByUser.get(t.user_id) ?? 0) + 1);
  const planByUser = new Map<string, string>();
  for (const s of subs ?? []) if (s.status === "active") planByUser.set(s.user_id, s.plan);

  const rows: UserListItem[] = (data ?? []).map((r) => ({
    id: r.id, email: r.email, fullName: r.full_name, university: r.university, department: r.department,
    level: r.level, academicYear: r.academic_year, language: r.language, staffRole: r.staff_role, createdAt: r.created_at,
    thesisCount: countByUser.get(r.id) ?? 0, plan: planByUser.get(r.id) ?? null,
  }));
  return { rows, total: count ?? 0 };
}

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const db = createAdminClient();
  const { data: p } = await db.from("profiles")
    .select("id,email,full_name,university,department,level,academic_year,language,staff_role,created_at")
    .eq("id", id).maybeSingle();
  if (!p) return null;
  const [{ data: sub }, { data: theses }, { data: notifs }] = await Promise.all([
    db.from("subscriptions").select("plan,status").eq("user_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("theses").select("id,title,status,updated_at").eq("user_id", id).order("updated_at", { ascending: false }),
    db.from("notifications").select("id,title,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  return {
    profile: {
      id: p.id, email: p.email, fullName: p.full_name, university: p.university, department: p.department,
      level: p.level, academicYear: p.academic_year, language: p.language, staffRole: p.staff_role, createdAt: p.created_at,
    },
    plan: sub?.plan ?? null,
    subscriptionStatus: sub?.status ?? null,
    theses: (theses ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, updatedAt: t.updated_at })),
    recentNotifications: (notifs ?? []).map((n) => ({ id: n.id, title: n.title, createdAt: n.created_at })),
  };
}
```

- [ ] **Step 3: Barrel + verify**

Create `src/features/users/index.ts` re-exporting `./types`, `./data`, and (after Task 3) the components. Run `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/users
git commit -m "feat(users): list/detail data reads via Supabase admin client"
```

---

## Task 3: Users — Server Actions (guarded)

**Files:** `src/app/d/users/action.ts`.

- [ ] **Step 1: Write the actions**

Create `src/app/d/users/action.ts`. Every action starts with a `hasStaffRole` guard, mutates via the admin client, then `revalidatePath`. Full code:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasStaffRole } from "@/lib/auth/staff";
import { isStaffRole } from "@/lib/auth/access";

export async function updateUserProfile(id: string, fields: { fullName?: string; university?: string; department?: string; level?: string }) {
  if (!(await hasStaffRole("support_admin"))) throw new Error("Forbidden");
  const db = createAdminClient();
  const { error } = await db.from("profiles").update({
    full_name: fields.fullName, university: fields.university, department: fields.department, level: fields.level,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/d/users/${id}`);
}

// super_admin only — this promotes/demotes staff. Requires Plan 1's column.
export async function setStaffRole(id: string, role: string | null) {
  if (!(await hasStaffRole())) throw new Error("Forbidden"); // hasStaffRole() with no args = any staff…
  const { getCurrentStaffRole } = await import("@/lib/auth/staff");
  if ((await getCurrentStaffRole()) !== "super_admin") throw new Error("Forbidden — super_admin only");
  if (role !== null && !isStaffRole(role)) throw new Error("Invalid role");
  const db = createAdminClient();
  const { error } = await db.from("profiles").update({ staff_role: role }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/d/users/${id}`);
}

export async function deleteUserAccount(id: string) {
  const { getCurrentStaffRole } = await import("@/lib/auth/staff");
  if ((await getCurrentStaffRole()) !== "super_admin") throw new Error("Forbidden — super_admin only");
  const db = createAdminClient();
  const { error } = await db.auth.admin.deleteUser(id); // cascades to profiles via FK
  if (error) throw new Error(error.message);
  revalidatePath("/d/users");
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd ~/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/d/users/action.ts
git commit -m "feat(users): guarded server actions (update, setStaffRole, deleteAccount)"
```

---

## Task 4: Users — views + routes

**Files:** `src/features/users/components/{users-list.tsx,user-detail.tsx}`, `src/features/users/locales/{en,fr,ar}.json`, `src/app/d/users/{page.tsx,client.tsx,[id]/page.tsx,[id]/client.tsx}`, register bundle in `src/i18n/messages.ts`.

- [ ] **Step 1: List + detail components**

Create `users-list.tsx` (`"use client"`) — a `DataTable<UserListItem>` with columns email, university, department, level, plan (Badge), thesisCount, joined; a `SearchBox` that updates a `?q=` param; row click → `/d/users/[id]`. Create `user-detail.tsx` — profile fields (editable via `updateUserProfile`), subscription block, the user's theses list (links to `/d/theses/[id]`), recent notifications, and a super-admin-only role selector calling `setStaffRole` + a delete-account button calling `deleteUserAccount` (confirm modal). Use `@/components/ui` + `users.*` keys. Export from the feature barrel.

- [ ] **Step 2: Locales**

Create `src/features/users/locales/{en,fr,ar}.json` with a `users` namespace (title, columns, detail labels, actions). Translate all three. Register in `src/i18n/messages.ts`.

- [ ] **Step 3: Routes**

`src/app/d/users/page.tsx` (server) — **first line `await requirePathAccess("/d/users")`**, then read `?q`/pagination from `searchParams`, call `listUsers`, render `<UsersClient>`. `client.tsx` — `<PageHeader> + <UsersList>`. `[id]/page.tsx` — **first line `await requirePathAccess("/d/users")`**, then `getUserDetail(params.id)`, 404 if null, render `<UserDetailClient>`. `[id]/client.tsx` — `<UserDetail>`.

- [ ] **Step 4: Verify**

Run: `cd ~/modakerati-dashboard && npm run build && npm run dev`
Expected: `/d/users` lists real users, search works, row → detail; as super_admin the role selector persists (if Plan 1 applied) — verify a set/clear round-trips. As `support_admin`, `/d/users` loads but the role selector + delete are hidden/blocked.

- [ ] **Step 5: Commit**

```bash
git add src/features/users src/app/d/users src/i18n/messages.ts
git commit -m "feat(users): directory + detail routes with guarded actions"
```

---

## Task 5: Theses — types + data (read-only)

**Files:** `src/features/theses/{types.ts,data.ts,index.ts}`.

- [ ] **Step 1: Types (mirrored from server `theses`)**

Create `src/features/theses/types.ts`:

```ts
// Mirrors modakerati-server theses table. Keep in sync by hand.
export type ThesisListItem = {
  id: string; title: string; ownerEmail: string | null; status: string | null;
  progress: number | null; wordCount: number | null; pageCount: number | null;
  docMode: string | null; updatedAt: string | null;
};

export type ThesisDetail = {
  id: string; title: string; status: string | null; progress: number | null;
  wordCount: number | null; pageCount: number | null; docMode: string | null;
  analysisReport: unknown | null; chatSummary: string | null;
  owner: { id: string; email: string | null } | null;
  sources: { id: string; title: string | null; filename: string | null; status: string | null; sizeBytes: number | null }[];
};
```

- [ ] **Step 2: Data reads**

Create `src/features/theses/data.ts` — `listTheses({ q, status, limit, offset })` and `getThesisDetail(id)` using `createAdminClient`. List joins owner email (fetch profiles for the page's `user_id`s and map, same pattern as users `data.ts`). Detail pulls the thesis row + owner + `thesis_sources` for that thesis. All read-only. Barrel `index.ts` re-exports types/data/components.

- [ ] **Step 3: Verify**

Run: `cd ~/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/theses
git commit -m "feat(theses): read-only list/detail data via Supabase admin client"
```

---

## Task 6: Theses — views + routes

**Files:** `src/features/theses/components/{theses-list.tsx,thesis-detail.tsx}`, `src/features/theses/locales/{en,fr,ar}.json`, `src/app/d/theses/{page.tsx,client.tsx,[id]/page.tsx,[id]/client.tsx}`, register bundle.

- [ ] **Step 1: Components**

`theses-list.tsx` — `DataTable<ThesisListItem>` (title, owner, status Badge, progress, word/page counts, docMode, updated) + status filter (`Segmented`/`FilterPills`) + search. `thesis-detail.tsx` — metadata header, a rendered `analysisReport` (pretty-print the JSON into labeled sections; if its shape is unknown, render a readable key/value tree), the `sources` list, and the `chatSummary`. Read-only. **Note:** the "trigger RAG re-index / view rendered document" rich-ops are deferred to Plan 4 (they need `lib/api/server.ts`, first implemented there) — leave a placeholder area with a disabled control labeled "available after AI Providers module", so the gap is visible, not silent.

- [ ] **Step 2: Locales**

`src/features/theses/locales/{en,fr,ar}.json` — `theses` namespace (title, columns, statuses, detail labels). Translate all three. Register in `messages.ts`.

- [ ] **Step 3: Routes**

`src/app/d/theses/page.tsx` → **first line `await requirePathAccess("/d/theses")`**, then `listTheses` → `<ThesesClient>`; `client.tsx` → `<PageHeader> + <ThesesList>`. `[id]/page.tsx` → **first line `await requirePathAccess("/d/theses")`**, then `getThesisDetail` (404 if null) → `<ThesisDetailClient>` → `<ThesisDetail>`.

- [ ] **Step 4: Verify**

Run: `cd ~/modakerati-dashboard && npm run build && npm run dev`
Expected: `/d/theses` lists real theses; filters/search work; row → detail shows analysis report + sources. As `content_admin` or `platform_admin`, `/d/theses` is blocked (not in their `ROLE_ACCESS`); as `support_admin`/`super_admin` it loads.

- [ ] **Step 5: Commit**

```bash
git add src/features/theses src/app/d/theses src/i18n/messages.ts
git commit -m "feat(theses): monitor list + read-only detail drill-in"
```

---

## Self-Review

**Spec coverage:** §5.2 Users list/detail + edit/resend/set-staff-role/delete → Tasks 2-4 (resend-notification is a thin add: if not built here, it's a known Phase-1.1 follow-up — flag in the PR, don't claim it silently); §5.3 Theses list/detail read-only, rich-ops deferred → Tasks 5-6 (deferral made visible via disabled control). ✅

**Placeholder scan:** No TBD/TODO; data + action code is complete; component steps specify exact columns/props and point at blink's `DataTable`/`users` feature for shape. ✅

**Type consistency:** `UserListItem`/`UserDetail`/`UserRow` (T2) consumed by actions (T3) and views (T4); `ThesisListItem`/`ThesisDetail` (T5) consumed by views (T6). `setStaffRole` uses `isStaffRole` from `access.ts` (Plan 2). Column names in `data.ts` (`full_name`, `staff_role`, `academic_year`, `user_id`, `updated_at`) match the server's snake_case schema. ✅

**Cross-plan note:** `setStaffRole`/`deleteUserAccount` require the Plan-2 `hasStaffRole`/`getCurrentStaffRole` and Plan-1's `staff_role` column; before Plan 1 applies, `setStaffRole` will error on write (column missing) — expected, and covered by the pre-migration fallback for read gating.
