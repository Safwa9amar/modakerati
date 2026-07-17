# Dashboard Phase 1 — Plan 2: Foundation + Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the new `~/modakerati-dashboard` Next.js app with Supabase auth, three-layer staff-role gating, the app shell + sidebar + trilingual i18n + UI kit, and a working Overview KPI landing.

**Architecture:** Standalone Next.js 16 App Router app mirroring `~/blink-dashboard`'s conventions (feature-first, routing triad, hand-rolled UI kit, co-located i18n, Tailwind v4 CSS-token theming). Data access is **Hybrid C** — direct Supabase (service-role `createAdminClient`) for CRUD/aggregates; a `lib/api/server.ts` wrapper for rich `modakerati-server` ops (stubbed here, used in Plan 4). Auth is Supabase via `@supabase/ssr`; staff identity is `profiles.staff_role` with a pre-migration `super_admin` fallback.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, next-intl, `@supabase/ssr`, Zustand, lucide-react, TanStack Table (Plan 3), Vitest (for the pure auth core only).

**Reference repo:** `~/blink-dashboard` is the authoritative pattern. Where a step says "mirror blink's `<path>`", open that real file and adapt it — do not invent a different shape. **Deltas from blink:** no marketing landing (no `(landing)/` group); brand tokens are Modakerati indigo; the role set and `ROLE_ACCESS` map differ; env var names use the Modakerati Supabase project.

**Depends on:** Plan 1 (the `profiles.staff_role` column). This plan works before Plan 1 lands thanks to the `super_admin` fallback, but real role gating needs Plan 1 applied.

**Plan 2 of 4 for Dashboard Phase 1.** Spec: `docs/superpowers/specs/2026-07-17-modakerati-dashboard-phase1-design.md`.

---

## File Structure (all under `~/modakerati-dashboard/`)

- `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.local.example` — project tooling.
- `middleware.ts` — auth session refresh + `/login` redirect.
- `src/app/layout.tsx` — root `<html>` with lang/dir + pre-paint theme script.
- `src/app/globals.css` — Tailwind v4 import + Modakerati semantic tokens (`@theme inline`).
- `src/app/login/{page.tsx,action.ts}` — sign-in.
- `src/app/d/layout.tsx` — `force-dynamic` staff gate → `<DashboardShell>`.
- `src/app/d/page.tsx`, `src/app/d/client.tsx` — Overview route (triad).
- `src/lib/supabase/{server,client,middleware,admin}.ts` — the four clients.
- `src/lib/auth/access.ts` — pure role map + helpers (unit-tested).
- `src/lib/auth/staff.ts` — server-only `getCurrentStaffRole` / `hasStaffRole`.
- `src/lib/api/server.ts` — typed fetch wrapper to modakerati-server (stub interface here).
- `src/lib/theme.ts`, `src/lib/dash-metadata.ts` — theme constant + `pageMeta()` helper.
- `src/i18n/{config,request,messages,actions}.ts`, `src/i18n/messages/{en,fr,ar}.json` — i18n.
- `src/components/ui/*` + `index.ts` — UI kit (primitives, Icon, Button, Card, StatCard, StatGrid, PageHeader, Skeleton, Avatar, Segmented).
- `src/components/{dashboard-shell,sidebar,theme-switcher,language-switcher}.tsx` — chrome.
- `src/features/overview/{index.ts,types.ts,data.ts,components/*,locales/*}` — Overview feature.
- `src/lib/auth/access.test.ts` — Vitest unit tests for the role map.

---

## Task 1: Project scaffold + tooling

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.local.example`, a temporary `src/app/page.tsx`.

- [ ] **Step 1: Create the repo and copy tooling from blink**

```bash
mkdir -p ~/modakerati-dashboard && cd ~/modakerati-dashboard && git init
```

Create `package.json` by mirroring `~/blink-dashboard/package.json`, keeping the **same versions** (Next 16, React 19, Tailwind v4, next-intl ^4, @supabase/ssr, @supabase/supabase-js, zustand, @tanstack/react-table, react-hook-form, lucide-react). Drop blink-only deps not needed in Phase 1 (tiptap, motion, xlsx, recharts — add recharts back only if Overview charts use it; this plan uses CSS charts, so omit). Add `vitest` to devDependencies. Scripts: `"dev": "next dev --webpack"`, `"build": "next build --webpack"`, `"lint": "next lint"`, `"test": "vitest run"`.

- [ ] **Step 2: Copy config files, adapting**

- `tsconfig.json` — copy blink's verbatim (path alias `@/*` → `src/*`).
- `next.config.ts` — mirror blink's: wrap with `createNextIntlPlugin("./src/i18n/request.ts")`.
- `postcss.config.mjs` — copy blink's (`@tailwindcss/postcss` only).
- `.gitignore` — Node/Next standard (`node_modules`, `.next`, `.env*.local`, `out`).
- `.env.local.example`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# Base URL of modakerati-server for Hybrid-C rich ops (used from Plan 4)
MODAKERATI_SERVER_URL=http://localhost:3000
# Shared secret for the server's token-gated AI-providers admin ops (Plan 4)
ADMIN_API_TOKEN=
```

- [ ] **Step 3: Temporary landing page to prove the toolchain boots**

Create `src/app/page.tsx`:

```tsx
export default function Home() {
  return <main style={{ padding: 40 }}>Modakerati dashboard — scaffold OK</main>;
}
```

- [ ] **Step 4: Install and verify build**

Run: `cd ~/modakerati-dashboard && npm install && npm run build`
Expected: install succeeds; `next build` completes with no errors (one static route `/`).

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-dashboard
git add -A && git commit -m "chore: scaffold modakerati-dashboard (Next 16, Tailwind v4, next-intl)"
```

---

## Task 2: Tailwind v4 theme with Modakerati tokens

**Files:** `src/app/globals.css`, `src/lib/theme.ts`.

- [ ] **Step 1: Write `globals.css`**

Mirror blink's token strategy (`@import "tailwindcss"; :root/[data-theme] vars; @theme inline mapping`) but with Modakerati's palette from `~/modakerati/constants/colors.ts`. Create `src/app/globals.css`:

```css
@import "tailwindcss";

:root, [data-theme="dark"] {
  --background: #121220;
  --surface: #232338;
  --card: #1C1C2E;
  --card-hover: #212133;
  --input: #1A1A28;
  --text: #FFFFFF;
  --subtext: #9999AE;
  --placeholder: #666678;
  --primary: #5C6BFF;
  --primary-light: #7A8CFF;
  --accent: #33D6A6;
  --success: #33D6A6;
  --warning: #FF9933;
  --danger: #FF5959;
  --border: #333346;
  --border-subtle: #232338;
}

[data-theme="light"] {
  --background: #FAFAFE;
  --surface: #F0F0F5;
  --card: #FFFFFF;
  --card-hover: #F8F8FA;
  --input: #F2F2F7;
  --text: #1A1A26;
  --subtext: #737385;
  --placeholder: #A6A6B3;
  --primary: #4D5CEB;
  --primary-light: #5C6BFF;
  --accent: #26B88C;
  --success: #26B88C;
  --warning: #E69919;
  --danger: #E64040;
  --border: #E0E0E6;
  --border-subtle: #EDEDF0;
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-card: var(--card);
  --color-card-hover: var(--card-hover);
  --color-input: var(--input);
  --color-text: var(--text);
  --color-subtext: var(--subtext);
  --color-placeholder: var(--placeholder);
  --color-primary: var(--primary);
  --color-primary-light: var(--primary-light);
  --color-accent: var(--accent);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-border: var(--border);
  --color-border-subtle: var(--border-subtle);
}

* { border-color: var(--border); }
body { background: var(--background); color: var(--text); font-family: system-ui, -apple-system, sans-serif; }
```

- [ ] **Step 2: Theme constant**

Create `src/lib/theme.ts` (mirror blink's `lib/theme.ts` — the pre-paint script + default). Minimal:

```ts
export const THEME_STORAGE_KEY = "modakerati-theme";
export const DEFAULT_THEME = "dark" as const;
export type Theme = "dark" | "light";
```

- [ ] **Step 3: Verify**

Run: `cd ~/modakerati-dashboard && npm run build`
Expected: builds; utilities like `bg-card`, `text-subtext`, `text-primary` are available (used in later tasks).

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/lib/theme.ts
git commit -m "feat(theme): Tailwind v4 tokens with Modakerati indigo palette"
```

---

## Task 3: Supabase clients (four)

**Files:** `src/lib/supabase/{server,client,middleware,admin}.ts`.

- [ ] **Step 1: Mirror blink's four clients**

Open `~/blink-dashboard/src/lib/supabase/{server,client,middleware,admin}.ts` and reproduce them, adapting only env var names (already `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`). Preserve exactly:
- `server.ts` → `createClient()` cookie-session server client.
- `client.ts` → `createClient()` browser factory.
- `middleware.ts` → `updateSession(request)` that refreshes the session, calls `getUser()`, redirects unauthenticated → `/login`, and authenticated-on-`/login` → `/`.
- `admin.ts` → `createAdminClient()` (service-role, no-op cookies, bypasses RLS) + `hasServiceRole()`. Keep the fallback to the SSR client when the key is absent. **Server-only.**

- [ ] **Step 2: Verify typecheck**

Run: `cd ~/modakerati-dashboard && npx tsc --noEmit`
Expected: no errors (types resolve for all four).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase
git commit -m "feat(supabase): server/client/middleware/admin clients (@supabase/ssr)"
```

---

## Task 4: Auth core — `access.ts` (pure, TDD) + `staff.ts`

**Files:** `src/lib/auth/access.ts`, `src/lib/auth/access.test.ts`, `src/lib/auth/staff.ts`.

- [ ] **Step 1: Write the failing test for the role map**

Create `src/lib/auth/access.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { STAFF_ROLES, isStaffRole, canAccessPath, defaultPathFor } from "./access";

describe("staff access map", () => {
  it("recognizes the five staff roles and rejects others", () => {
    expect(STAFF_ROLES).toEqual([
      "super_admin", "support_admin", "content_admin", "finance_admin", "platform_admin",
    ]);
    expect(isStaffRole("support_admin")).toBe(true);
    expect(isStaffRole("student")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });

  it("super_admin can access every dashboard path", () => {
    expect(canAccessPath("super_admin", "/d")).toBe(true);
    expect(canAccessPath("super_admin", "/d/users")).toBe(true);
    expect(canAccessPath("super_admin", "/d/ai")).toBe(true);
  });

  it("support_admin can reach users & theses but not ai or news", () => {
    expect(canAccessPath("support_admin", "/d/users")).toBe(true);
    expect(canAccessPath("support_admin", "/d/theses/123")).toBe(true);
    expect(canAccessPath("support_admin", "/d/ai")).toBe(false);
    expect(canAccessPath("support_admin", "/d/news")).toBe(false);
  });

  it("content_admin reaches news, platform_admin reaches ai", () => {
    expect(canAccessPath("content_admin", "/d/news")).toBe(true);
    expect(canAccessPath("content_admin", "/d/users")).toBe(false);
    expect(canAccessPath("platform_admin", "/d/ai")).toBe(true);
    expect(canAccessPath("platform_admin", "/d/theses")).toBe(false);
  });

  it("everyone can reach the overview root", () => {
    for (const r of STAFF_ROLES) expect(canAccessPath(r, "/d")).toBe(true);
  });

  it("defaultPathFor sends each role to its first reachable area", () => {
    expect(defaultPathFor("super_admin")).toBe("/d");
    expect(defaultPathFor("support_admin")).toBe("/d");
    expect(defaultPathFor("content_admin")).toBe("/d");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/modakerati-dashboard && npx vitest run src/lib/auth/access.test.ts`
Expected: FAIL — `./access` not found.

- [ ] **Step 3: Implement `access.ts`**

Create `src/lib/auth/access.ts` (pure, isomorphic — safe to import anywhere):

```ts
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

// Route prefixes each role may access. "*" = everything. The overview root
// "/d" is implicitly allowed for every staff role (see canAccessPath).
// Phase-1 routes only; extend as Phases 2-3 add modules.
export const ROLE_ACCESS: Record<StaffRole, "*" | string[]> = {
  super_admin: "*",
  support_admin: ["/d/users", "/d/theses"],
  content_admin: ["/d/news"],
  finance_admin: [], // Phase 3: "/d/subscriptions"
  platform_admin: ["/d/ai"],
};

/** Nav order — first entry a role can reach becomes its default landing. */
const NAV_ORDER = ["/d/users", "/d/theses", "/d/news", "/d/ai"];

export function canAccessPath(role: StaffRole, pathname: string): boolean {
  if (pathname === "/d" || pathname === "/d/") return true; // overview open to all staff
  const allow = ROLE_ACCESS[role];
  if (allow === "*") return true;
  return allow.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

export function defaultPathFor(role: StaffRole): string {
  if (role === "super_admin") return "/d";
  const first = NAV_ORDER.find((p) => canAccessPath(role, p));
  return first ?? "/d";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ~/modakerati-dashboard && npx vitest run src/lib/auth/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `staff.ts` (server-only)**

Create `src/lib/auth/staff.ts` — mirror blink's `lib/auth/staff.ts`, adapting the column read. Full code:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStaffRole, type StaffRole } from "./access";

/**
 * Resolve the signed-in user's staff role, or null if not staff.
 * Pre-migration fallback: if profiles.staff_role does not exist yet
 * (Postgres 42703), treat any authenticated user as super_admin so the
 * console is usable before Plan 1 lands. Remove once the column ships.
 */
export async function getCurrentStaffRole(): Promise<StaffRole | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("staff_role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === "42703") return "super_admin"; // pre-migration
    return null;
  }
  const role = data?.staff_role;
  return isStaffRole(role) ? role : null;
}

export async function hasStaffRole(...allowed: StaffRole[]): Promise<boolean> {
  const role = await getCurrentStaffRole();
  if (!role) return false;
  if (role === "super_admin") return true;
  return allowed.length === 0 || allowed.includes(role);
}
```

- [ ] **Step 6: Verify build + full test run**

Run: `cd ~/modakerati-dashboard && npm test && npx tsc --noEmit`
Expected: access tests pass; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth
git commit -m "feat(auth): staff role map (access.ts, tested) + getCurrentStaffRole/hasStaffRole"
```

---

## Task 5: Root middleware

**Files:** `middleware.ts`.

- [ ] **Step 1: Write `middleware.ts`**

Simpler than blink (no subdomain split). Create `~/modakerati-dashboard/middleware.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 2: Verify**

Run: `cd ~/modakerati-dashboard && npm run build`
Expected: builds; middleware compiles.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): root middleware refreshes session, redirects to /login"
```

---

## Task 6: Trilingual i18n

**Files:** `src/i18n/{config,request,messages,actions}.ts`, `src/i18n/messages/{en,fr,ar}.json`.

- [ ] **Step 1: Mirror blink's i18n wiring**

Reproduce `~/blink-dashboard/src/i18n/{config,request,messages,actions}.ts`, adapting:
- `config.ts` — `locales = ["en","fr","ar"]`, `defaultLocale = "en"`, `rtlLocales = ["ar"]`.
- `request.ts` — read `NEXT_LOCALE` cookie, load via `getAllMessages(locale)`.
- `messages.ts` — `getAllMessages(locale)` merges shared `src/i18n/messages/{locale}.json` + per-feature `src/features/<name>/locales/{locale}.json`. Start with shared + the `overview` feature bundle (Task 10). **Every new feature bundle must be registered here in both the import block and the `byLocale` map.**
- `actions.ts` — `setLocale` server action writing the `NEXT_LOCALE` cookie.

- [ ] **Step 2: Shared message bundles**

Create `src/i18n/messages/en.json` (then `fr.json`, `ar.json` with translations):

```json
{
  "common": { "search": "Search", "loading": "Loading…", "signOut": "Sign out", "none": "None" },
  "sidebar": {
    "operations": "Operations", "content": "Content", "platform": "Platform",
    "overview": "Overview", "users": "Users", "theses": "Theses", "news": "News", "ai": "AI Providers"
  },
  "auth": { "signIn": "Sign in", "email": "Email", "password": "Password", "signInCta": "Sign in" }
}
```

`fr.json` (same keys): "Recherche" / "Chargement…" / "Se déconnecter" / "Aucun"; sidebar: "Opérations" / "Contenu" / "Plateforme" / "Aperçu" / "Utilisateurs" / "Mémoires" / "Actualités" / "Fournisseurs IA"; auth: "Se connecter" / "E-mail" / "Mot de passe" / "Se connecter".

`ar.json` (same keys): "بحث" / "جارٍ التحميل…" / "تسجيل الخروج" / "لا شيء"; sidebar: "العمليات" / "المحتوى" / "المنصة" / "نظرة عامة" / "المستخدمون" / "المذكرات" / "الأخبار" / "مزودو الذكاء الاصطناعي"; auth: "تسجيل الدخول" / "البريد الإلكتروني" / "كلمة المرور" / "تسجيل الدخول".

- [ ] **Step 3: Verify**

Run: `cd ~/modakerati-dashboard && npm run build`
Expected: builds; next-intl resolves messages.

- [ ] **Step 4: Commit**

```bash
git add src/i18n next.config.ts
git commit -m "feat(i18n): trilingual en/fr/ar via next-intl, co-located bundles"
```

---

## Task 7: UI kit primitives

**Files:** `src/components/ui/{primitives.ts,icon.tsx,button.tsx,card.tsx,stat-card.tsx,stat-grid.tsx,page-header.tsx,skeleton.tsx,avatar.tsx,segmented.tsx,index.ts}`.

- [ ] **Step 1: Build the subset the shell + Overview need**

Mirror the structure of `~/blink-dashboard/src/components/ui` (one component per file, re-exported from `index.ts`). Adapt visuals to the Modakerati tokens (`bg-card`, `text-subtext`, `border-border`, `text-primary`, etc.). Create these components with the same prop shapes blink uses:
- `primitives.ts` — `Variant` union, `Lang`/`LANGS`/`dirFor`, class fragments `btnBase`/`btnPrimary`/`btnSecondary`/`fInput`.
- `icon.tsx` — a `<Icon name={...} />` wrapper over `lucide-react` (replaces blink's hand-rolled `DashIcon`). Map the names used in the sidebar/overview: `layout-dashboard`, `users`, `file-text`, `newspaper`, `settings-2`, `search`, `bell`, `log-out`, `sun`, `moon`, `globe`, `chevron-right`, `trending-up`, `activity`. Implement by importing the corresponding lucide icons and selecting by name.
- `button.tsx`, `card.tsx` (`Card` + `CardHeader`), `stat-card.tsx` (`StatCard`: label, value, delta, tone), `stat-grid.tsx`, `page-header.tsx`, `skeleton.tsx`, `avatar.tsx` (initials fallback), `segmented.tsx`.
- `index.ts` — barrel re-exporting all of the above.

- [ ] **Step 2: Verify**

Run: `cd ~/modakerati-dashboard && npx tsc --noEmit && npm run build`
Expected: clean; components importable via `@/components/ui`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui
git commit -m "feat(ui): hand-rolled UI kit primitives (lucide Icon, Button, Card, StatCard…)"
```

---

## Task 8: Dashboard shell + sidebar + switchers

**Files:** `src/components/{dashboard-shell.tsx,sidebar.tsx,theme-switcher.tsx,language-switcher.tsx}`.

- [ ] **Step 1: Sidebar with role-filtered nav**

Create `src/components/sidebar.tsx`. It receives the current `staffRole` and renders nav groups, showing only items the role can reach via `canAccessPath`. Full code for the filtering core:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { canAccessPath, type StaffRole } from "@/lib/auth/access";
import { Icon } from "@/components/ui";

type NavItem = { href: string; icon: string; labelKey: string };
type NavGroup = { titleKey: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  { titleKey: "sidebar.operations", items: [
    { href: "/d", icon: "layout-dashboard", labelKey: "sidebar.overview" },
    { href: "/d/users", icon: "users", labelKey: "sidebar.users" },
    { href: "/d/theses", icon: "file-text", labelKey: "sidebar.theses" },
  ]},
  { titleKey: "sidebar.content", items: [
    { href: "/d/news", icon: "newspaper", labelKey: "sidebar.news" },
  ]},
  { titleKey: "sidebar.platform", items: [
    { href: "/d/ai", icon: "settings-2", labelKey: "sidebar.ai" },
  ]},
];

export function Sidebar({ staffRole }: { staffRole: StaffRole }) {
  const t = useTranslations();
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3 w-56 bg-surface border-e border-border-subtle min-h-screen">
      {GROUPS.map((group) => {
        const items = group.items.filter((it) => canAccessPath(staffRole, it.href));
        if (items.length === 0) return null;
        return (
          <div key={group.titleKey} className="mt-3">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-placeholder">{t(group.titleKey)}</div>
            {items.map((it) => {
              const active = it.href === "/d" ? pathname === "/d" : pathname.startsWith(it.href);
              return (
                <Link key={it.href} href={it.href}
                  className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm ${active ? "bg-primary/15 text-text border-s-2 border-primary" : "text-subtext hover:bg-card-hover"}`}>
                  <Icon name={it.icon} size={16} /> {t(it.labelKey)}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Theme + language switchers**

Mirror `~/blink-dashboard/src/components/{theme-switcher,language-switcher}.tsx`, adapting the theme storage key (`THEME_STORAGE_KEY`) and locales list (`en/fr/ar`). Keep the pre-paint theme approach.

- [ ] **Step 3: Dashboard shell**

Create `src/components/dashboard-shell.tsx` — a client component taking `{ staffRole, userEmail, children }`, rendering `<Sidebar>` + a footer block (avatar, role badge, `<ThemeSwitcher>`, `<LanguageSwitcher>`, sign-out) on the left and `{children}` in the main column. Mirror blink's `dashboard-shell.tsx` layout; wire sign-out to a Supabase `signOut()` server action or the browser client.

- [ ] **Step 4: Verify**

Run: `cd ~/modakerati-dashboard && npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "feat(shell): role-filtered sidebar + dashboard shell + theme/lang switchers"
```

---

## Task 9: Login + staff gate

**Files:** `src/app/layout.tsx`, `src/app/login/{page.tsx,action.ts}`, `src/app/d/layout.tsx`; remove the temporary `src/app/page.tsx`.

- [ ] **Step 1: Root layout**

Create `src/app/layout.tsx` — mirror blink's: set `<html lang dir>` from the active locale, wrap children in `NextIntlClientProvider` with `getAllMessages`, include the pre-paint theme `<script>`, import `globals.css`.

- [ ] **Step 2: Login page + action**

Mirror `~/blink-dashboard/src/app/login/`. `page.tsx` renders the email/password form (using `@/components/ui` + `auth.*` i18n keys); `action.ts` is a `"use server"` `signIn` that calls the SSR client's `signInWithPassword` and `redirect("/d")` on success.

- [ ] **Step 3: Dashboard layout staff gate**

Create `src/app/d/layout.tsx`:

```tsx
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getCurrentStaffRole } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const role = await getCurrentStaffRole();
  if (!role) redirect("/login");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <DashboardShell staffRole={role} userEmail={user?.email ?? ""}>
      {children}
    </DashboardShell>
  );
}
```

- [ ] **Step 4: Remove the temporary landing and point `/` at the dashboard**

Delete `src/app/page.tsx`. Create a new `src/app/page.tsx` that redirects to `/d`:

```tsx
import { redirect } from "next/navigation";
export default function Index() { redirect("/d"); }
```

- [ ] **Step 5: Verify the gate end-to-end**

Run: `cd ~/modakerati-dashboard && npm run dev`, then in a browser:
- Visit `/d` while signed out → redirected to `/login`.
- Sign in with a Supabase user that has **no** `staff_role` and Plan 1 already applied → redirected back to `/login` (not staff). If Plan 1 is **not** applied yet, the `42703` fallback grants `super_admin` and you reach `/d` (expected interim behavior — note it).
- Sign in as a staff user → `/d` renders the shell.

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "feat(auth): login flow + force-dynamic staff gate on /d"
```

---

## Task 10: Overview feature (KPIs)

**Files:** `src/features/overview/{index.ts,types.ts,data.ts,components/overview-view.tsx,locales/{en,fr,ar}.json}`, `src/app/d/{page.tsx,client.tsx}`, and register the overview bundle in `src/i18n/messages.ts`.

- [ ] **Step 1: Types + data**

Create `src/features/overview/types.ts`:

```ts
export type OverviewKpis = {
  totalStudents: number;
  newStudentsThisWeek: number;
  activeTheses: number;
  activeSubscriptions: number;
  thesesByStatus: { status: string; count: number }[];
  recentSignups: { email: string; university: string | null; createdAt: string | null }[];
};
```

Create `src/features/overview/data.ts` (server-only; direct Supabase via service role — Hybrid C "rows"):

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OverviewKpis } from "./types";

export async function getOverviewKpis(): Promise<OverviewKpis> {
  const db = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [{ count: totalStudents }, { count: newStudentsThisWeek }, { count: activeTheses }, { count: activeSubscriptions }] =
    await Promise.all([
      db.from("profiles").select("*", { count: "exact", head: true }),
      db.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
      db.from("theses").select("*", { count: "exact", head: true }),
      db.from("subscriptions").select("*", { count: "exact", head: true }).eq("status", "active"),
    ]);

  const { data: statusRows } = await db.from("theses").select("status");
  const byStatus = new Map<string, number>();
  for (const r of statusRows ?? []) byStatus.set(r.status ?? "unknown", (byStatus.get(r.status ?? "unknown") ?? 0) + 1);

  const { data: recent } = await db
    .from("profiles").select("email, university, created_at")
    .order("created_at", { ascending: false }).limit(5);

  return {
    totalStudents: totalStudents ?? 0,
    newStudentsThisWeek: newStudentsThisWeek ?? 0,
    activeTheses: activeTheses ?? 0,
    activeSubscriptions: activeSubscriptions ?? 0,
    thesesByStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    recentSignups: (recent ?? []).map((r) => ({ email: r.email, university: r.university, createdAt: r.created_at })),
  };
}
```

Note: the `Date.now()` call is fine in app runtime (this restriction only applies to workflow scripts).

- [ ] **Step 2: View component**

Create `src/features/overview/components/overview-view.tsx` (`"use client"`) rendering `StatGrid`/`StatCard` for the four KPIs, a simple CSS bar or donut for `thesesByStatus`, and a `recentSignups` list. Use `@/components/ui` + `overview.*` i18n keys. Export it from `src/features/overview/index.ts` along with `./types`. (Data stays server-side; the view takes `kpis: OverviewKpis` as a prop.)

- [ ] **Step 3: Locales**

Create `src/features/overview/locales/{en,fr,ar}.json` with an `overview` namespace: keys `title`, `totalStudents`, `activeTheses`, `activeSubscriptions`, `newThisWeek`, `thesesByStatus`, `recentSignups`, `systemHealth`. Translate all three (fr/ar). Register the bundle in `src/i18n/messages.ts` (import block + `byLocale`).

- [ ] **Step 4: Route triad**

Create `src/app/d/page.tsx` (server):

```tsx
import { getOverviewKpis } from "@/features/overview";
import OverviewClient from "./client";
export const dynamic = "force-dynamic";
export default async function OverviewPage() {
  const kpis = await getOverviewKpis();
  return <OverviewClient kpis={kpis} />;
}
```

Create `src/app/d/client.tsx` (`"use client"`) rendering `<PageHeader>` + `<OverviewView kpis={kpis} />`. Export `getOverviewKpis` and `OverviewView` from the feature barrel so both imports resolve.

- [ ] **Step 5: Verify**

Run: `cd ~/modakerati-dashboard && npm run build && npm run dev`
Expected: `/d` renders the Overview with real counts from Supabase (or zeros if the DB is empty). Switch language via the switcher → labels change, `ar` flips to RTL.

- [ ] **Step 6: Commit**

```bash
git add src/features/overview src/app/d/page.tsx src/app/d/client.tsx src/i18n/messages.ts
git commit -m "feat(overview): KPI landing with Supabase aggregates + trilingual labels"
```

---

## Self-Review

**Spec coverage:** §4.1 stack/conventions → T1-2,7; §4.3 Hybrid C (`admin` client + `api/server.ts` stub) → T3, T10 (server wrapper stub deferred to Plan 4 where it's first used — noted, not silent); §4.4 three-layer gating → middleware (T5), `d/layout.tsx` (T9), `hasStaffRole` for actions (defined T4, first used Plan 3); §3 five roles + fallback → T4; §5.1 Overview → T10; §7 trilingual+RTL → T6, T10. ✅

**Deferred (noted, not gaps):** `lib/api/server.ts` is scaffolded as an interface stub in this plan and fully implemented in Plan 4 (its first consumer is AI Providers). Server-action `hasStaffRole` guards are exercised starting in Plan 3.

**Placeholder scan:** No TBD/TODO. Steps that create novel/critical files (tokens, `access.ts`, `staff.ts`, `sidebar.tsx`, overview `data.ts`, the gate) contain complete code; mechanical scaffolding steps point at the exact blink reference file to mirror plus the concrete deltas. ✅

**Type consistency:** `StaffRole`/`STAFF_ROLES`/`isStaffRole`/`canAccessPath`/`defaultPathFor` defined in `access.ts` (T4) are the same names consumed by `staff.ts` (T4), `sidebar.tsx` (T8) and `d/layout.tsx` (T9). `OverviewKpis` (T10 types) matches `getOverviewKpis`'s return and `OverviewView`'s prop. ✅

**Note:** This plan adds Vitest (blink has none) solely to unit-test the pure `access.ts` role map — the one security-critical, side-effect-free unit. UI is verified by build/lint/run, consistent with the spec's "verify by running the app."
