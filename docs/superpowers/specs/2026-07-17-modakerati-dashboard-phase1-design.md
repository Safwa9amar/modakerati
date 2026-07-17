# Modakerati Ops Dashboard — Phase 1 Design

**Date:** 2026-07-17
**Status:** Approved design, pre-implementation-plan
**Scope:** Phase 1 (foundation + 5 core modules). Phases 2–3 are documented as non-goals below.

---

## 1. Goal

Build **`modakerati-dashboard`** — a standalone Next.js admin/ops console for the Modakerati thesis-writing platform — as a new sibling repo alongside `~/modakerati` (Expo app) and `~/modakerati-server` (Hono/Drizzle API). It is a **multi-role staff console** modeled on the existing `~/blink-dashboard`.

Phase 1 delivers a console an operator can actually run the platform with: monitor users and theses, broadcast news, and manage AI/RAG configuration — behind real role-based access control.

## 2. Current state (context)

- `~/modakerati` (Expo app) + `~/modakerati-server` (Hono/Drizzle) share **one Supabase project** (Postgres + Auth + Storage + pgvector).
- **No ops dashboard exists.** The only admin surface is a server-rendered HTML page at `GET /admin/providers` (managing AI providers + embedding config only), gated by a static `ADMIN_API_TOKEN` shared secret — not tied to any user account.
- **No user-role model.** `profiles` has no `role`/`is_admin` column; every account is a student. Admin identity must be introduced.
- **Security gap:** the server's `POST/PUT/DELETE /api/news` write endpoints are behind Supabase auth but **not admin-gated** — any authenticated user can create/edit/delete news. Phase 1 closes this.
- **No analytics tables.** Usage metrics are derived by querying core tables (`profiles`, `theses`, `subscriptions`, etc.).
- `~/blink-dashboard` (Next.js 16) is a proven pattern to mirror.

## 3. Roles & access model

Admin authority is a **separate axis** from the mobile persona. A new nullable enum column **`profiles.staff_role`** identifies staff:

| `staff_role` | Owns |
|---|---|
| `super_admin` | Everything |
| `support_admin` | Users, Theses (student support) |
| `content_admin` | News (Phase 1); templates / norm profiles / knowledge base (Phase 2) |
| `finance_admin` | Subscriptions & billing (Phase 3) |
| `platform_admin` | AI Providers & embeddings, system health (Phase 3) |

`NULL` = not staff → no dashboard access. A `ROLE_ACCESS` map (in `lib/auth/access.ts`) maps each role to `"*"` or a route allowlist; `canAccessPath(role, pathname)` and `defaultPathFor(role)` drive nav filtering and post-login redirect.

**Pre-migration fallback:** until the `staff_role` column exists, a missing-column Postgres error (`42703`) is treated as "grant `super_admin`" so the console is usable during bring-up — mirroring blink. The migration **will** land as part of this work; the fallback is a bridge, not the end state.

## 4. Architecture

### 4.1 Repo & stack
New sibling repo `~/modakerati-dashboard`, mirroring blink-dashboard conventions:
- **Next.js 16** App Router, **React 19**, **Tailwind CSS v4** (CSS-first `@theme inline` tokens — no `tailwind.config.js`), **next-intl** (en/fr/ar + RTL), **`@supabase/ssr`** + `@supabase/supabase-js`, **Zustand**, **`@tanstack/react-table`**, **react-hook-form**.
- **Icons: `lucide-react`** everywhere (consistent with the mobile app's `lucide-react-native`; no emojis).
- **No marketing landing** (unlike blink) — the app is just `/login` + `/d/*` (YAGNI).
- Conventions carried over: feature-first `src/features/<name>` (barrel-only imports via `@/features/<name>`), the **routing triad** `page.tsx` (server fetch) / `client.tsx` (view) / `action.ts` (server mutations), routed-tab `layout.tsx` + `SubNav`, hand-rolled `@/components/ui` kit, co-located i18n via `getAllMessages()`.

### 4.2 Brand tokens
From `~/modakerati/constants/colors.ts`. Primary indigo `#5C6BFF` (dark) / `#4D5CEB` (light); accent teal `#33D6A6`; semantic success/warning/error; dark surfaces `#121220`/`#1C1C2E`/`#171726`. Mapped to Tailwind v4 semantic CSS vars (`--primary`, `--card`, `--border`, …); reference tokens, never hardcode hex.

### 4.3 Data access — **Hybrid (C)**
The governing rule, kept in code comments: **rows → Supabase; logic → server.**
- **`src/lib/supabase/{server,client,middleware,admin}`** — `createAdminClient()` (service-role, bypasses RLS, server-only, no-op cookies) for all CRUD reads/writes and KPI aggregates.
- **`src/lib/api/server.ts`** — a typed fetch wrapper to `modakerati-server` for rich operations that already have real logic there (AI provider test/health, embedding config apply, RAG re-index). The dashboard forwards the staff user's Supabase JWT.
- Row shapes are declared locally in each feature's `types.ts` and kept in sync with the server's Drizzle schema **by hand** (no shared package — matches the ecosystem convention).

### 4.4 Auth & role gating (three enforcement layers)
1. **Middleware** (`middleware.ts` + `lib/supabase/middleware.ts`) — `updateSession()` refreshes the session and redirects unauthenticated users to `/login`. No subdomain split (there is no public landing to hide); the whole app is the console.
2. **`d/layout.tsx`** — `export const dynamic = "force-dynamic"`; calls `getCurrentStaffRole()`, `redirect("/login")` if not staff, passes `staffRole` into the shell (which hides nav per `canAccessPath`).
3. **Every Server Action** re-checks `hasStaffRole(...allowed)` before mutating.

`lib/auth/access.ts` is pure/isomorphic (role map + helpers); `lib/auth/staff.ts` is server-only (`getCurrentStaffRole`, `hasStaffRole`).

## 5. Phase 1 modules

Each: **route · owning roles · data path**. Icons via `lucide-react`.

### 5.1 Overview — `/d` · all staff · Supabase reads + server `/health`
KPI cards (total students, active theses, MRR in Da, system health), signups chart (30d), theses-by-status donut, recent signups list. Read-only. Each role lands on `defaultPathFor(role)`.

### 5.2 Users — `/d/users` · support + super · Supabase CRUD
- **List:** TanStack table — email, university, department, level, plan, #theses, joined; search + filters; pagination.
- **Detail `/d/users/[id]`:** profile fields, subscription, the user's theses (links into Theses), recent chat / notification activity.
- **Actions (Server Actions, `hasStaffRole`):** edit profile fields; resend a notification; **set a user's `staff_role`** (super_admin only — this is how staff are promoted); delete account (super_admin only, confirmation-guarded).

### 5.3 Theses — `/d/theses` · support + super · Supabase reads + server for doc ops
- **List:** title, owner, status, progress, word/page count, `doc_mode`, updated; filters.
- **Detail `/d/theses/[id]`:** metadata, rendered `analysis_report` (jsonb), sources list, chat summary.
- **Rich ops via server:** view outline/document; trigger RAG re-index/re-embed. Diagnostic-focused for v1 (no destructive editing of student docs from the dashboard).

### 5.4 News — `/d/news` · content + super · Supabase CRUD + Storage
- Trilingual editor: `content_eng` / `content_fr` / `content_ar` each `{ title, sum, body }`; category; status (`draft`/`scheduled`/`published`); `pinned`; `push`; `cta_label`; schedule/expiry; cover image upload to the public `news` Storage bucket.
- List with status filters; view/click counters shown read-only.
- **Security fix (server):** lock `POST/PUT/DELETE /api/news` behind `requireStaffRole` so only content/super admins can write.

### 5.5 AI Providers — `/d/ai` · platform + super · server rich-ops
The token-gated HTML page reborn as a gated React UI: active provider, per-provider config (masked secrets, `••••1234`), embedding/RAG config, health checks, test buttons. Calls the server's `/admin/providers/api/*` (config/health/settings/test), **re-gated by staff role** (JWT-forwarded), with `ADMIN_API_TOKEN` kept as fallback.

## 6. Cross-repo changes in `modakerati-server`

This work spans both repos. Server changes (schema is server-owned per the golden rule):
1. Add **`profiles.staff_role`** nullable enum column — Drizzle schema (`src/db/schema.ts`) + matching `supabase/migrations/NNNNN_*.sql`.
2. Add **`requireStaffRole(...roles)`** middleware — reads `profiles.staff_role` for the authed Supabase user; `403` if insufficient.
3. **Gate `/api/news` writes** (`POST`/`PUT`/`DELETE`) behind `requireStaffRole` — the security fix.
4. **Expose the providers admin ops to staff-JWT** (in addition to the existing `ADMIN_API_TOKEN`) so the dashboard can call them with the signed-in staff session.
5. KPI aggregates need **no new endpoints** — the dashboard reads them directly via service-role.

## 7. i18n

**Full trilingual (en/fr/ar) + RTL** from day one, like blink-dashboard. Co-located, not centralized: shared `src/i18n/messages/{en,fr,ar}.json` + per-feature `src/features/<name>/locales/{en,fr,ar}.json`, merged by `getAllMessages()`. Active locale from the `NEXT_LOCALE` cookie. Every new string is added in all three languages and the bundle registered in `messages.ts`. RTL via logical Tailwind classes (`ms-/me-`, `ps-/pe-`, `start/end`, `rtl:`) and `dir` on `<html>`.

## 8. UI kit

Hand-rolled `@/components/ui` (not shadcn), mirroring blink: `Button`, `Badge`, `Card`, `StatCard`, `StatGrid`, `DataTable` (+`Column<T>`, TanStack-backed), `EmptyState`, `PageHeader`, `Modal`, `Skeleton`, `Toolbar`, `SearchBox`, `Avatar`, `Toggle`, `Segmented`, `SubNav`, `FormRow`, `LangTabs`, plus a small chart set (donut, column chart, legend) and a lucide-based `Icon` component. Dark-default theming via `data-theme` + pre-paint inline script.

## 9. Non-goals (deferred to later phases)

- **Phase 2 — Academic content:** University templates, norm/formatting profiles, RAG knowledge-base curation, universities catalog.
- **Phase 3 — Finance & platform ops:** Subscriptions & billing depth, system health & background jobs, notifications management.
- Not in any phase now: student-facing features, editing student thesis content destructively, custom analytics tables (derive from core tables until a real need appears).

## 10. Verification

blink-dashboard ships no test framework; Phase 1 verifies by **running the app**:
- A small seed script sets a `staff_role` on a test account.
- Sign in per role and confirm: nav shows only permitted modules, `defaultPathFor` redirects correctly, and a lower-privilege role gets `403`/redirect on a restricted route and on Server Actions.
- Drive each module against real Supabase data; confirm the News write-gate rejects non-staff at the server.
- `npm run build` + `npm run lint` clean.

## 11. Risks & notes

- **Type drift:** local row types must be updated by hand whenever the server's Drizzle schema changes. Mitigation: keep a short "types mirrored from server" comment header per `types.ts`.
- **Staff-JWT vs `ADMIN_API_TOKEN`:** the providers ops carry two auth paths during transition; keep the token fallback until the staff-JWT gate is proven.
- **Service-role key** must be server-only in the dashboard env (never `NEXT_PUBLIC_*`) or writes fail and reads see only RLS-published rows.
- **Migration ordering:** land the `staff_role` migration on the shared Supabase project before relying on real role gating (the fallback covers the interim).
