# Thesis P5 — A4 Expand Preview (WebView) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** The ⤢ button in the workspace opens a full-screen, read-only **A4 preview** of the memoir — paginated white pages with the template's fonts/margins, rendered in a WebView from server-generated HTML — with a ⤓ download that produces the real `.docx`/`.tex`.

**Architecture:** New server endpoint `GET /api/thesis/:id/preview-html` returns `{ html }` — a self-contained HTML document (own CSS, A4 page blocks) built from `loadThesisTree` + `marked.parse` for chapter markdown (tables/headings/lists become real HTML). The app fetches it with auth (`apiGet`) and renders it in a `react-native-webview` `<WebView source={{ html }} />` on the new `thesis-preview-a4` screen. The ⤓ button calls the existing export route (`POST /api/export/:thesisId`) via a new `exportThesis` client fn and opens the signed URL with `Linking`. The workspace's disabled ⤢ button is enabled to route here.

**Tech Stack:** Hono + Drizzle + `marked` (server); `react-native-webview` + `Linking` + Expo Router (app).

**Branch:** `feat/thesis-hierarchy-p0`.

**Verified facts:**
- `marked` is installed server-side; `import { marked } from "marked"; marked.parse(md)` → HTML string (GFM tables supported).
- `loadThesisTree(thesisId)` → `{ thesis, profile, template, sections: (Section & {chapters})[], references }`.
- `referencesLabel(lang)` + the citation formatter `formatReferenceEntry(ref, style)` (from P1, `src/lib/docx-references.ts`) exist.
- Server route mount: `app.route("/api/thesis", thesisRoutes)`; auth middleware on `/api/*`. The thesis routes file has the `/:id` GET; add `/:id/preview-html` BEFORE the generic `/:id` won't matter (distinct suffix) but keep it tidy.
- Export route exists: `POST /api/export/:thesisId` body `{ format }` → `{ success, url, filename, format, bytes, ... }`.
- App `lib/api.ts`: `apiGet<T>(path)` (JSON, bearer auth), `apiPost<T>(path, body)`. No `exportThesis`/`getThesisPreviewHtml` yet.
- `react-native-webview` `WebView` is used in `components/RenderHtml.tsx` (`source={{ html }}`, `onShouldStartLoadWithRequest` opens real links via `Linking`).
- Workspace (`app/(app)/thesis-workspace.tsx`) has a disabled ⤢ placeholder button in its top bar; it has `thesisId`.
- Theme tokens + `useThemeColors`; i18n `t(...)`.

---

## Task 1: Server — `GET /api/thesis/:id/preview-html`

**Files:** Create `src/lib/preview-html.ts`; Modify `src/routes/thesis.ts`; Test `scripts/test-preview-html.ts`

- [ ] **Step 1:** Create `src/lib/preview-html.ts`:
```typescript
import { marked } from "marked";
import { loadThesisTree, referencesLabel } from "./thesis-export";
import { formatReferenceEntry } from "./docx-references";

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build a self-contained, paginated A4 HTML document for the WebView preview. */
export async function buildPreviewHtml(thesisId: string): Promise<string> {
  const tree = await loadThesisTree(thesisId);
  const { thesis, profile, template } = tree as any;
  const lang = thesis.language || "fr";
  const rtl = template?.bindingSide === "right" || lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const fm = thesis.frontMatter ?? {};
  const cfg = template?.config ?? {};
  const bodyFont = cfg.bodyFont || (rtl ? "'Traditional Arabic', 'Amiri', serif" : "'Times New Roman', Georgia, serif");

  const page = (inner: string, opts: { center?: boolean } = {}) =>
    `<section class="page${opts.center ? " center" : ""}">${inner}</section>`;

  const pages: string[] = [];

  // Page de garde
  const cover: string[] = [];
  const uni = fm.university ?? profile?.university;
  if (uni) cover.push(`<div class="uni">${esc(uni)}</div>`);
  if (fm.faculty) cover.push(`<div class="sub">${esc(fm.faculty)}</div>`);
  if (fm.department ?? profile?.department) cover.push(`<div class="sub">${esc(fm.department ?? profile.department)}</div>`);
  cover.push(`<h1 class="title">${esc(thesis.title)}</h1>`);
  const authors = (fm.authors ?? (profile?.fullName ? [profile.fullName] : [])).filter(Boolean);
  if (authors.length) cover.push(`<div class="meta">${esc(authors.join(" • "))}</div>`);
  if (fm.supervisor) cover.push(`<div class="meta">${esc(fm.supervisor)}</div>`);
  cover.push(`<div class="meta">${esc(fm.academicYear ?? `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`)}</div>`);
  pages.push(page(cover.join("\n"), { center: true }));

  // Résumé
  for (const rb of (Array.isArray(thesis.resume) ? thesis.resume : [])) {
    pages.push(page(`<h2>${rb.language === "ar" ? "ملخص" : rb.language === "en" ? "Abstract" : "Résumé"}</h2><p>${esc(rb.body)}</p>${rb.keywords?.length ? `<p><b>${rb.language === "ar" ? "الكلمات المفتاحية" : "Mots-clés"}:</b> ${esc(rb.keywords.join(", "))}</p>` : ""}`));
  }

  // Body
  for (const sec of tree.sections) {
    const inner: string[] = [`<h1 class="partie">${esc(sec.title)}</h1>`];
    if (sec.content) inner.push(marked.parse(sec.content) as string);
    pages.push(page(inner.join("\n"), { center: !sec.content }));
    for (const ch of sec.chapters) {
      pages.push(page(`<h1 class="chapitre">${esc(ch.title)}</h1>${marked.parse(ch.content || "") as string}`));
    }
  }

  // Références
  if (tree.references.length) {
    const style = template?.citationStyle === "footnote-ar" ? "footnote-ar" : "apa";
    const items = tree.references.map((r: any) => `<p class="ref">${esc(formatReferenceEntry(r, style))}</p>`).join("\n");
    pages.push(page(`<h1 class="chapitre">${esc(referencesLabel(lang))}</h1>${items}`));
  }

  return `<!DOCTYPE html><html dir="${dir}" lang="${lang}"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  html,body{margin:0;padding:0;background:#d9dbe0;}
  body{font-family:${bodyFont};color:#111;-webkit-text-size-adjust:100%;}
  .page{background:#fff;width:794px;max-width:92vw;min-height:1123px;margin:18px auto;padding:64px 56px;box-shadow:0 4px 18px rgba(0,0,0,.25);box-sizing:border-box;}
  .page.center{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}
  h1{font-size:20pt;margin:0 0 14px;} h2{font-size:16pt;} h3{font-size:14pt;}
  .partie{font-size:24pt;text-transform:uppercase;letter-spacing:.04em;}
  .chapitre{font-size:18pt;border-bottom:1px solid #ccc;padding-bottom:6px;}
  .title{font-size:26pt;font-weight:800;margin:32px 0;} .uni{font-weight:700;font-size:14pt;} .sub{font-size:12pt;color:#444;} .meta{font-size:12pt;margin-top:6px;}
  p{font-size:12pt;line-height:1.6;text-align:${rtl ? "right" : "justify"};margin:0 0 10px;}
  table{border-collapse:collapse;width:100%;margin:12px 0;} th,td{border:1px solid #777;padding:6px 9px;font-size:11pt;text-align:${rtl ? "right" : "left"};} th{background:#eee;font-weight:700;}
  ul,ol{padding-${rtl ? "right" : "left"}:1.4em;} li{font-size:12pt;margin:4px 0;}
  .ref{font-size:11pt;text-indent:-1.2em;padding-${rtl ? "right" : "left"}:1.2em;}
</style></head><body>${pages.join("\n")}</body></html>`;
}
```
- [ ] **Step 2:** Route in `src/routes/thesis.ts` (scope by user — confirm ownership like other routes):
```typescript
import { buildPreviewHtml } from "../lib/preview-html";
thesisRoutes.get("/:id/preview-html", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return c.json({ error: "Thesis not found" }, 404);
  try { const html = await buildPreviewHtml(id); return c.json({ html }); }
  catch (e: any) { console.error("preview-html error:", e?.message); return c.json({ error: "Preview failed" }, 500); }
});
```
- [ ] **Step 3:** Test `scripts/test-preview-html.ts`: create a fixture thesis (section+chapter with a markdown table), call `buildPreviewHtml(id)`, assert the HTML contains the title, `class="partie"`, `<table`, the chapter content, and `<!DOCTYPE`. Clean up. Run it → PASS.
- [ ] **Step 4:** `npx tsc --noEmit` → 0. Commit:
```bash
git add src/lib/preview-html.ts src/routes/thesis.ts scripts/test-preview-html.ts
git commit -m "feat(server): GET /api/thesis/:id/preview-html (paginated A4 HTML)"
```

---

## Task 2: App — api fns (`getThesisPreviewHtml`, `exportThesis`)

**Files:** Modify `lib/api.ts`

- [ ] **Step 1:** Add:
```typescript
export async function getThesisPreviewHtml(id: string) {
  return apiGet<{ html: string }>(`/api/thesis/${id}/preview-html`);
}
export async function exportThesis(thesisId: string, format: "docx" | "latex" = "docx") {
  return apiPost<{ success: boolean; url: string; filename: string; format: string; bytes: number; pageCount?: number }>(`/api/export/${thesisId}`, { format });
}
```
- [ ] **Step 2:** tsc clean; commit:
```bash
git add lib/api.ts && git commit -m "feat(app/api): getThesisPreviewHtml + exportThesis"
```

---

## Task 3: App — A4 preview screen

**Files:** Create `app/(app)/thesis-preview-a4.tsx`; register in `app/(app)/_layout.tsx`

- [ ] **Step 1:** Register `<Stack.Screen name="thesis-preview-a4" />`.
- [ ] **Step 2:** Implement `thesis-preview-a4.tsx`:
  - `const { thesisId } = useLocalSearchParams<{ thesisId: string }>();`
  - State `html: string | null`, `loading: boolean`, `downloading: boolean`. On mount, `getThesisPreviewHtml(thesisId)` → set `html` (catch → Alert + go back).
  - Dark top bar (`colors.bgPrimary`): a close button (BackButton or an X → `router.back()`), the title `t("preview.a4Title", { defaultValue: "A4 preview" })`, and a ⤓ download Pressable.
  - Body: while loading, centered ActivityIndicator on a grey bg. Else `<WebView originWhitelist={["*"]} source={{ html }} style={{ flex: 1 }} onShouldStartLoadWithRequest={(req) => { if (req.url === "about:blank" || req.url.startsWith("data:")) return true; Linking.openURL(req.url).catch(()=>{}); return false; }} />` (import `WebView` from `react-native-webview`, `Linking` from react-native). The server HTML carries its own CSS/scroll; let the WebView scroll (default).
  - ⤓ handler: `setDownloading(true)`; `const res = await exportThesis(thesisId, "docx"); await Linking.openURL(res.url);` (catch → Alert); `finally setDownloading(false)`. Show a spinner on the button while downloading. Label/icon: `Download` from lucide-react-native.
- [ ] **Step 3:** i18n: add `preview` block to en/fr/ar: `{ "a4Title": ..., "download": ... }` (en: "A4 preview"/"Download"; fr: "Aperçu A4"/"Télécharger"; ar: "معاينة A4"/"تحميل"). Validate JSON.
- [ ] **Step 4:** tsc clean (only 8 pre-existing); commit:
```bash
git add "app/(app)/thesis-preview-a4.tsx" "app/(app)/_layout.tsx" locales/
git commit -m "feat(app): A4 preview WebView screen + download"
```

---

## Task 4: App — enable the workspace ⤢ button

**Files:** Modify `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1:** Replace the disabled ⤢ placeholder in the top bar with an enabled Pressable that routes to the preview:
```typescript
<Pressable onPress={() => router.push({ pathname: "/(app)/thesis-preview-a4", params: { thesisId } })} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("preview.a4Title", { defaultValue: "A4 preview" })} style={...}>
  <Maximize2 size={20} color={colors.textPrimary} />
</Pressable>
```
(Use the `Maximize2` icon from lucide-react-native, or keep the existing ⤢ glyph but make it pressable + full opacity. Ensure `useRouter`/`router` is available in the screen.)
- [ ] **Step 2:** tsc clean; commit:
```bash
git add "app/(app)/thesis-workspace.tsx" && git commit -m "feat(app): enable workspace expand -> A4 preview"
```

---

## Task 5: Verification
- [ ] **Step 1:** `cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-preview-html.ts && npx tsc --noEmit && echo SERVER_OK`.
- [ ] **Step 2:** `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -vE "global.css|absoluteFillObject|ProviderSelector"` → empty.
- [ ] **Step 3:** (Manual, user) In the workspace tap ⤢ → A4 pages render (title page, chapters, a real table); tap ⤓ → a `.docx` downloads/opens.

## Definition of done (P5)
- `preview-html` endpoint returns a paginated A4 HTML doc (front matter, parties/chapitres, markdown→HTML incl. tables, references), RTL-aware.
- A4 preview screen renders it in a WebView with a working ⤓ download; the workspace ⤢ button opens it.
- Both repos type-check (app: only pre-existing unrelated errors).

## Out of scope
- True print pagination fidelity (CSS page-break tuning) beyond the fixed A4 page blocks — acceptable for an on-screen preview. Image/figure rendering follows whatever `marked` emits (`<img>`); embedding into the real `.docx` is still P1.x.
