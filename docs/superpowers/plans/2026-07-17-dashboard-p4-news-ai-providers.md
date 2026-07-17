# Dashboard Phase 1 — Plan 4: News + AI Providers modules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 1 with the content-admin News editor (trilingual, Supabase CRUD + cover images) and the platform-admin AI Providers console (the token-gated HTML page reborn as a gated React UI), plus the `lib/api/server.ts` Hybrid wrapper both the AI module and future rich-ops use.

**Architecture:** News is CRUD → direct Supabase via `createAdminClient` (Hybrid C "rows"), guarded by `hasStaffRole("content_admin")`. AI Providers is a "logic" surface → the dashboard calls `modakerati-server`'s existing token-gated `/admin/providers/api/*` through `lib/api/server.ts`, holding `ADMIN_API_TOKEN` **server-side only**; the page itself is gated by `hasStaffRole("platform_admin")`.

**Tech Stack:** Next.js 16, `@supabase/ssr` (admin + Storage), react-hook-form, lucide-react.

**Depends on:** Plan 2 (foundation, UI kit, i18n, `hasStaffRole`) and Plan 3 (`DataTable` **and the `requirePathAccess` server guard from Plan 3 Task 0**). Plan 1's news write-gate protects the *mobile/API* path; the dashboard writes news directly via Supabase, so News does not depend on Plan 1. Reference: `~/blink-dashboard/src/features/news` (trilingual editor, `LangTabs`, cover upload) and `~/modakerati-server/src/routes/admin.ts` (the providers API this consumes).

> **SECURITY — server-side per-route authZ is mandatory here too.** Every restricted server `page.tsx` below MUST begin with `await requirePathAccess(...)` (from `@/lib/auth/require-path`, Plan 3 Task 0) before any data fetch — News routes call `requirePathAccess("/d/news")`, AI routes call `requirePathAccess("/d/ai")`. The client shell's `{allowed ? children : null}` is UX only and does not stop a wrong-role staff user's server fetch. (This closes the architectural gap flagged in Plan 2's final review.)

**Plan 4 of 4.** Spec: `docs/superpowers/specs/2026-07-17-modakerati-dashboard-phase1-design.md` §5.4–5.5.

---

## File Structure (under `~/modakerati-dashboard/`)

- `src/lib/api/server.ts` — typed fetch wrapper to modakerati-server (real implementation).
- `src/features/news/{index.ts,types.ts,data.ts,components/*,locales/*}`.
- `src/app/d/news/{page.tsx,client.tsx,action.ts,new/page.tsx,[id]/{page.tsx,client.tsx}}`.
- `src/features/ai-providers/{index.ts,types.ts,components/*,locales/*}`.
- `src/app/d/ai/{page.tsx,client.tsx,action.ts}`.
- Register both feature bundles in `src/i18n/messages.ts`.
- Add `LangTabs` to `src/components/ui` if not already present from blink.

---

## Task 1: `lib/api/server.ts` — the Hybrid wrapper

**Files:** `src/lib/api/server.ts`.

- [ ] **Step 1: Implement the wrapper (server-only)**

Create `src/lib/api/server.ts`:

```ts
import "server-only";

const BASE = process.env.MODAKERATI_SERVER_URL ?? "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!ADMIN_TOKEN) throw new Error("ADMIN_API_TOKEN is not configured on the dashboard");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-admin-token": ADMIN_TOKEN, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`modakerati-server ${path} -> ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json()) as T;
}

// AI providers admin ops (server routes: /admin/providers/api/*, gated by ADMIN_API_TOKEN).
export function getProvidersConfig<T = unknown>() { return adminFetch<T>("/admin/providers/api/config"); }
export function getProvidersHealth<T = unknown>() { return adminFetch<T>("/admin/providers/api/health"); }
export function updateProviderSettings<T = unknown>(body: unknown) {
  return adminFetch<T>("/admin/providers/api/settings", { method: "PUT", body: JSON.stringify(body) });
}
export function testProvider<T = unknown>(body: unknown) {
  return adminFetch<T>("/admin/providers/api/test", { method: "POST", body: JSON.stringify(body) });
}
```

- [ ] **Step 2: Verify**

Run: `cd ~/modakerati-dashboard && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/server.ts
git commit -m "feat(api): server-side wrapper to modakerati-server admin ops (Hybrid C)"
```

---

## Task 2: News — types + data

**Files:** `src/features/news/{types.ts,data.ts,index.ts}`.

- [ ] **Step 1: Types (mirrored from server `news`)**

Create `src/features/news/types.ts`. **Verify column set against `~/modakerati-server/src/db/schema.ts` `news`** before finalizing (the server's `publicShape` in `src/routes/news.ts` confirms: slug, category, cover_url, status, pinned, cta_label, cta_href, content_eng/fr/ar, views, published_at, expires_at):

```ts
// Mirrors modakerati-server news table. Each content_* is jsonb {title,sum,body}.
export type NewsContent = { title: string; sum: string; body: string };
export type NewsStatus = "draft" | "scheduled" | "published";

export type NewsRow = {
  id: string;
  slug: string;
  category: string;
  coverUrl: string | null;
  status: NewsStatus;
  pinned: boolean;
  ctaLabel: string | null;
  ctaHref: string | null;
  contentEng: NewsContent | null;
  contentFr: NewsContent | null;
  contentAr: NewsContent | null;
  views: number | null;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
};
```

- [ ] **Step 2: Data reads**

Create `src/features/news/data.ts` — `listNews({ status?, limit?, offset? })` and `getNews(id)` via `createAdminClient`, mapping snake_case → the `NewsRow` shape above. Barrel re-exports types/data/components.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add src/features/news
git commit -m "feat(news): types + list/detail reads via Supabase admin client"
```

---

## Task 3: News — Server Actions (guarded, with cover upload)

**Files:** `src/app/d/news/action.ts`.

- [ ] **Step 1: Write the actions**

Create `src/app/d/news/action.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasStaffRole } from "@/lib/auth/staff";
import type { NewsContent, NewsStatus } from "@/features/news";

type NewsInput = {
  slug: string; category: string; status: NewsStatus; pinned: boolean;
  ctaLabel: string | null; ctaHref: string | null;
  contentEng: NewsContent | null; contentFr: NewsContent | null; contentAr: NewsContent | null;
  publishedAt: string | null; expiresAt: string | null; coverUrl: string | null;
};

function toRow(input: NewsInput) {
  return {
    slug: input.slug, category: input.category, status: input.status, pinned: input.pinned,
    cta_label: input.ctaLabel, cta_href: input.ctaHref, cover_url: input.coverUrl,
    content_eng: input.contentEng, content_fr: input.contentFr, content_ar: input.contentAr,
    published_at: input.publishedAt, expires_at: input.expiresAt,
  };
}

export async function createNews(input: NewsInput) {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  if (!input.slug) throw new Error("slug is required");
  const db = createAdminClient();
  const { data, error } = await db.from("news").insert(toRow(input)).select("id").single();
  if (error) throw new Error(error.message);
  revalidatePath("/d/news");
  return data.id as string;
}

export async function updateNews(id: string, input: NewsInput) {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  const db = createAdminClient();
  const { error } = await db.from("news").update({ ...toRow(input), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/d/news"); revalidatePath(`/d/news/${id}`);
}

export async function deleteNews(id: string) {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  const db = createAdminClient();
  const { error } = await db.from("news").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/d/news");
}

// Uploads a cover image to the public "news" Storage bucket, returns its public URL.
export async function uploadNewsCover(formData: FormData): Promise<string> {
  if (!(await hasStaffRole("content_admin"))) throw new Error("Forbidden");
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("no file");
  const db = createAdminClient();
  const path = `covers/${crypto.randomUUID()}-${file.name}`;
  const { error } = await db.storage.from("news").upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  return db.storage.from("news").getPublicUrl(path).data.publicUrl;
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add src/app/d/news/action.ts
git commit -m "feat(news): guarded create/update/delete + cover upload to Storage"
```

---

## Task 4: News — trilingual editor + routes

**Files:** `src/features/news/components/{news-list.tsx,news-editor.tsx}`, `src/features/news/locales/{en,fr,ar}.json`, `src/app/d/news/{page.tsx,client.tsx,new/page.tsx,[id]/page.tsx,[id]/client.tsx}`, register bundle. Ensure `LangTabs` exists in `@/components/ui` (mirror blink's).

- [ ] **Step 1: Components**

`news-list.tsx` — `DataTable<NewsRow>` (title from `contentEng?.title`, category, status Badge, pinned, views, publishedAt) + status filter + "New post" → `/d/news/new`. `news-editor.tsx` (`"use client"`, react-hook-form) — the trilingual editor: a `LangTabs` (EN/FR/AR) switching the `{title, sum, body}` fields per language (Arabic tab RTL), plus slug, category, status (`Segmented`), pinned toggle, CTA label/href, publish/expiry dates, and a cover uploader calling `uploadNewsCover`. Submit → `createNews`/`updateNews`. Use `news.*` keys.

- [ ] **Step 2: Locales**

`src/features/news/locales/{en,fr,ar}.json` — `news` namespace (title, columns, editor field labels, statuses, actions). Translate all three. Register in `messages.ts`.

- [ ] **Step 3: Routes**

Every one of these server pages begins with `await requirePathAccess("/d/news")`. `page.tsx` → `listNews` → `<NewsClient>` (`<PageHeader> + <NewsList>`). `new/page.tsx` → `<NewsEditor mode="create">`. `[id]/page.tsx` → `getNews(id)` (404 if null) → `<NewsEditClient>` → `<NewsEditor mode="edit" news={row}>`.

- [ ] **Step 4: Verify**

Run: `cd ~/modakerati-dashboard && npm run build && npm run dev`
Expected: as `content_admin`/`super_admin`, `/d/news` lists posts; create a draft in all three languages, upload a cover, publish, edit, delete — each round-trips in Supabase. As `support_admin`, `/d/news` is blocked.

- [ ] **Step 5: Commit**

```bash
git add src/features/news src/app/d/news src/components/ui src/i18n/messages.ts
git commit -m "feat(news): trilingual editor + list routes with cover upload"
```

---

## Task 5: AI Providers — data + views

**Files:** `src/features/ai-providers/{index.ts,types.ts,components/providers-view.tsx,locales/*}`, `src/app/d/ai/{page.tsx,client.tsx}`.

- [ ] **Step 1: Types**

Create `src/features/ai-providers/types.ts` matching what `/admin/providers/api/config` and `/health` return (inspect `~/modakerati-server/src/routes/admin.ts` for the exact shape — active provider, per-provider fields with masked secrets, embedding config, and the health map). Model them as:

```ts
export type ProviderField = { key: string; label: string; value: string; secret: boolean };
export type ProviderConfig = { id: string; label: string; fields: ProviderField[] };
export type ProvidersConfig = {
  activeProvider: string;
  providers: ProviderConfig[];
  embedding: ProviderField[];
  globals: ProviderField[];
};
export type ProvidersHealth = Record<string, { ok: boolean; detail?: string }>;
```

Adjust field names to the server's actual JSON after inspection; keep the mapping in `data`/`client`.

- [ ] **Step 2: View**

Create `providers-view.tsx` (`"use client"`) — shows the active provider (a `Segmented`/select bound to `updateProviderSettings`), each provider's fields (masked secrets shown as `••••1234`, editable), the embedding/RAG config block, a health panel (green/red per provider from `ProvidersHealth`), and a "Test" button per provider calling the `testProvider` action. Use `ai.*` keys. Export from the feature barrel.

- [ ] **Step 3: Locales**

`src/features/ai-providers/locales/{en,fr,ar}.json` — `ai` namespace (title, activeProvider, embedding, health, test, save, statuses). Translate all three. Register in `messages.ts`.

- [ ] **Step 4: Route (server fetch via wrapper)**

`src/app/d/ai/page.tsx`:

```tsx
export const dynamic = "force-dynamic";
import { getProvidersConfig, getProvidersHealth } from "@/lib/api/server";
import { requirePathAccess } from "@/lib/auth/require-path";
import AiClient from "./client";
import type { ProvidersConfig, ProvidersHealth } from "@/features/ai-providers";

export default async function AiProvidersPage() {
  await requirePathAccess("/d/ai"); // server-side gate before any provider fetch
  const [config, health] = await Promise.all([
    getProvidersConfig<ProvidersConfig>(),
    getProvidersHealth<ProvidersHealth>(),
  ]);
  return <AiClient config={config} health={health} />;
}
```

`client.tsx` → `<PageHeader> + <ProvidersView config={config} health={health} />`.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai-providers src/app/d/ai/page.tsx src/app/d/ai/client.tsx src/i18n/messages.ts
git commit -m "feat(ai): AI providers console reads config + health via server wrapper"
```

---

## Task 6: AI Providers — Server Actions (guarded)

**Files:** `src/app/d/ai/action.ts`.

- [ ] **Step 1: Write the actions**

Create `src/app/d/ai/action.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { hasStaffRole } from "@/lib/auth/staff";
import { updateProviderSettings, testProvider } from "@/lib/api/server";

export async function saveProviderSettings(body: unknown) {
  if (!(await hasStaffRole("platform_admin"))) throw new Error("Forbidden");
  await updateProviderSettings(body);
  revalidatePath("/d/ai");
}

export async function runProviderTest(body: unknown): Promise<unknown> {
  if (!(await hasStaffRole("platform_admin"))) throw new Error("Forbidden");
  return testProvider(body);
}
```

- [ ] **Step 2: Wire the view to the actions**

Point `providers-view.tsx`'s save/test controls at `saveProviderSettings` / `runProviderTest`.

- [ ] **Step 3: Verify end-to-end (needs modakerati-server running + `ADMIN_API_TOKEN` set in both)**

Run: start `~/modakerati-server` (`npm run dev`), set matching `ADMIN_API_TOKEN` and `MODAKERATI_SERVER_URL` in the dashboard env, then `cd ~/modakerati-dashboard && npm run dev`. As `platform_admin`/`super_admin`, `/d/ai` shows current config + health, a settings save persists (re-fetch reflects it), and Test returns a result. As `content_admin`, `/d/ai` is blocked and the actions throw Forbidden.

- [ ] **Step 4: Commit**

```bash
git add src/app/d/ai/action.ts src/features/ai-providers
git commit -m "feat(ai): guarded save/test provider settings via server wrapper"
```

---

## Self-Review

**Spec coverage:** §5.4 News trilingual editor + cover + write-gate context → Tasks 2-4 (dashboard writes via Supabase; the *API* write-gate is Plan 1); §5.5 AI Providers gated React UI over `/admin/providers/api/*` with `ADMIN_API_TOKEN` server-side → Tasks 1,5-6; §4.3 `lib/api/server.ts` wrapper → Task 1. ✅

**Placeholder scan:** No TBD/TODO; `api/server.ts` and all action code is complete. The two type shapes that depend on the server's exact JSON (`ProvidersConfig`, `NewsRow`) carry an explicit "verify against server before finalizing" instruction rather than a guess presented as fact. ✅

**Type consistency:** `NewsContent`/`NewsStatus`/`NewsRow` (T2) consumed by actions (T3) and editor (T4). `ProvidersConfig`/`ProvidersHealth` (T5) consumed by the route (T5) and actions reference the wrapper fns from T1 (`updateProviderSettings`, `testProvider`). Storage bucket name `"news"` matches the server's cover-image bucket. ✅

**Security note:** `ADMIN_API_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are read only in `server-only` modules (`lib/api/server.ts`, `lib/supabase/admin.ts`) and Server Actions — never in a client component and never `NEXT_PUBLIC_*`. The AI page's authority is `hasStaffRole("platform_admin")`; the shared token is an implementation detail the browser never sees.

---

## Phase 1 completion (after all four plans)

Once Plans 1–4 are merged, run the final cross-cutting verification from the spec §10: seed a `staff_role` per role via Plan 1's `set-staff-role` CLI, sign in as each, and confirm nav filtering, `defaultPathFor` redirects, blocked routes/actions (403/redirect), and the news API write-gate. Then dispatch a final full-diff code review and use `superpowers:finishing-a-development-branch`.
