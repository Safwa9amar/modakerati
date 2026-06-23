# Thesis P2 — Guided Creation Wizard + AI Plan Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Turn the disjoint title→template→jump-to-chat path into a coherent wizard that ends at an **AI-generated, user-editable plan** whose approval creates the thesis: **Title (sheet) → Template (picker/preview) → Plan (new screen) → thesis created → thesis-detail**. Plus seed real university template *profiles* so the template step is populated.

**Architecture:** A transient `thesis-wizard-store` (Zustand) holds `{ title, language, templateId, plan }` across screens; the thesis row is created **only at plan approval** (no orphans). The title sheet stops creating the thesis; `template-preview` calls a new server endpoint `POST /api/thesis/generate-plan` (modeled on `enhance.ts`) to get a Section→Chapter outline; the new `thesis-plan` screen lets the user edit/reorder/regenerate, then `createThesis(plan)` → `getThesis` → store → route to `thesis-detail`. Templates come from the server (`GET /api/templates`), seeded with profiles derived from the norms research.

**Tech Stack:** Expo Router + Zustand + react-i18next on the app; Hono + Drizzle + the `ai.chat()` provider on the server.

**Repo branch:** continue on `feat/thesis-hierarchy-p0` (both repos).

**Verified current-state facts (from research):**
- Routing: `app/(app)/_layout.tsx` registers `(app)` Stack screens (`slide_from_right`); navigate via `router.push({ pathname, params })` + `useLocalSearchParams`.
- `components/NewThesisSheet.tsx` currently: collects title (+ AI suggestions), calls `createThesis({title, sections:[{title:"Corps", chapters: DEFAULT_CHAPTERS...}]})`, `getThesis`, `upsertThesis`, routes to `/(tabs)/chat`. Opened via `useBottomSheet.getState().openSheet("new-thesis")`.
- `template-picker.tsx`: 3 quick-start cards (Blank→opens sheet; **AI Wizard** = empty handler line ~60; Import = empty); lists `useThesisStore().templates` (currently empty); tap → `router.push({pathname:"/(app)/template-preview", params:{templateId}})`.
- `template-preview.tsx`: reads `templateId`, looks up template in store, "Use This Template" → `createThesis({title:"${type} - ${university}", templateId, sections: template.chapterStructure.map(title=>({title}))})` → store → `/(tabs)/chat`.
- `stores/bottom-sheet-store.ts`: `SheetName = "structure" | "ask" | "new-thesis"`; `openSheet/closeSheet/isOpen`.
- `stores/thesis-store.ts`: `loadTemplates: () => set({ templates: [] })` (no server fetch). Has `setTheses/upsertThesis/setCurrentThesis/getCurrentThesis` + section/chapter CRUD.
- `lib/api.ts`: `apiGet/apiPost/...` with bearer auth; `createThesis(input)`, `getThesis`, `listTheses`, `suggestThesisTitles`. NO `listTemplates`/`generateThesisPlan` yet.
- Server: routes mounted in `src/index.ts` (`app.route("/api/thesis", thesisRoutes)`, `/api/templates`, `/api/enhance`...). `enhance.ts` pattern: `getProvider("openrouter").chat(messages,{model,systemPrompt,temperature})` → `JSON.parse(response.content)` with fallback. `src/lib/ai/index.ts` `chat(userMessage, history?, {model?,provider?})`. `templates` table exists with profile columns; `GET /api/templates` returns active templates. `seedNews()` pattern exists in `src/db/index.ts` (insert-if-empty at startup).
- Types: `Template` has `discipline/bindingSide/citationStyle/bodyPreset/frontMatter/structure/styleMap/chapterStructure`. `SectionKind = "introduction"|"section"|"conclusion"`.

---

## Task 1: Server — `POST /api/thesis/generate-plan`

**Files:** Modify `src/routes/thesis.ts`; Test `scripts/test-generate-plan.ts`

- [ ] **Step 1: Write the test**
```typescript
// scripts/test-generate-plan.ts
import "dotenv/config";
import { generatePlan } from "../src/lib/thesis-plan";
async function main() {
  const plan = await generatePlan({ title: "L'impact de l'IA sur l'enseignement", language: "fr", bodyPreset: "imrad" });
  const ok = Array.isArray(plan.sections) && plan.sections.length >= 2 &&
    plan.sections.every((s: any) => typeof s.title === "string" && Array.isArray(s.chapters));
  console.log(JSON.stringify(plan, null, 2));
  console.log(`RESULT: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run, expect failure (module missing).**

- [ ] **Step 3: Create `src/lib/thesis-plan.ts`** (the AI call + parse, reusable + testable)
```typescript
import { getProvider } from "./ai";

export interface GeneratedPlan {
  sections: Array<{ title: string; kind: "introduction" | "section" | "conclusion"; chapters: Array<{ title: string; hint?: string }> }>;
}

const PRESET_HINT: Record<string, string> = {
  imrad: "Use the science/experimental structure: an Introduction Générale, then Parties like 'Synthèse Bibliographique', 'Matériel et Méthodes', 'Résultats et Discussion', then a Conclusion Générale. Parties contain chapitres.",
  "law-humanities": "Use the law/humanities structure: Introduction, then thematic Parties each containing numbered Chapitres, then Conclusion.",
  chapters: "Use a simple structure: Introduction, several thematic Chapitres grouped under one or two Parties, then Conclusion.",
};

export async function generatePlan(input: { title: string; language?: string; bodyPreset?: string }): Promise<GeneratedPlan> {
  const lang = input.language || "fr";
  const preset = PRESET_HINT[input.bodyPreset || "chapters"] ?? PRESET_HINT.chapters;
  const ai = getProvider("openrouter");
  const system = `You are an academic thesis-planning assistant for Algerian university students. Given a thesis title, produce a coherent outline as JSON ONLY (no prose), in ${lang === "ar" ? "Arabic" : lang === "en" ? "English" : "French"}.
${preset}
Return EXACTLY this shape:
{"sections":[{"title":"...","kind":"introduction|section|conclusion","chapters":[{"title":"...","hint":"one-sentence guidance on what this chapter covers"}]}]}
Rules: 4-7 sections; "introduction" and "conclusion" kinds have an empty chapters array; "section" kinds have 1-4 chapters. Titles concise and academic. Output valid JSON, nothing else.`;
  const res = await ai.chat([{ role: "user", content: `Thesis title: ${input.title}` }], { model: "openai/gpt-4o-mini", systemPrompt: system, temperature: 0.4 });
  try {
    const raw = res.content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
    const parsed = JSON.parse(raw) as GeneratedPlan;
    if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) throw new Error("empty");
    // normalize
    parsed.sections = parsed.sections.map((s) => ({
      title: String(s.title || "Partie"),
      kind: (["introduction", "section", "conclusion"].includes((s as any).kind) ? (s as any).kind : "section"),
      chapters: Array.isArray(s.chapters) ? s.chapters.map((c) => ({ title: String(c.title || "Chapitre"), hint: c.hint })) : [],
    }));
    return parsed;
  } catch {
    // Fallback: deterministic generic outline so the wizard never dead-ends.
    return {
      sections: [
        { title: lang === "ar" ? "مقدمة عامة" : "Introduction Générale", kind: "introduction", chapters: [] },
        { title: lang === "ar" ? "الإطار النظري" : "Partie Théorique", kind: "section", chapters: [{ title: lang === "ar" ? "الفصل الأول" : "Chapitre 1" }] },
        { title: lang === "ar" ? "الجانب التطبيقي" : "Partie Pratique", kind: "section", chapters: [{ title: lang === "ar" ? "الفصل الثاني" : "Chapitre 2" }] },
        { title: lang === "ar" ? "خاتمة عامة" : "Conclusion Générale", kind: "conclusion", chapters: [] },
      ],
    };
  }
}
```

- [ ] **Step 4: Add the route in `src/routes/thesis.ts`**
```typescript
import { generatePlan } from "../lib/thesis-plan";
// ...
thesisRoutes.post("/generate-plan", async (c) => {
  const { title, language, bodyPreset } = await c.req.json();
  if (!title || typeof title !== "string") return c.json({ error: "title required" }, 400);
  const plan = await generatePlan({ title, language, bodyPreset });
  return c.json(plan);
});
```
Register it BEFORE the `/:id` routes if route-ordering matters (Hono matches in order; `/generate-plan` is a static path so it's fine, but place it near the top of the thesis routes to be safe).

- [ ] **Step 5: Run the test → PASS (requires `OPENROUTER_API_KEY` in `.env`; if the AI call fails/offline, the fallback returns a valid plan so the test still passes the shape check).**

- [ ] **Step 6: `npx tsc --noEmit` clean; commit**
```bash
git add src/lib/thesis-plan.ts src/routes/thesis.ts scripts/test-generate-plan.ts
git commit -m "feat(server): POST /api/thesis/generate-plan (AI outline + deterministic fallback)"
```

---

## Task 2: Server — seed template profiles

**Files:** Modify `src/db/index.ts` (add `seedTemplates()` + call at startup next to `seedNews`); Test `scripts/test-seed-templates.ts`

- [ ] **Step 1: Implement `seedTemplates()` in `src/db/index.ts`** (insert profiles only if the table is empty), derived from the norms research (`docs/research/2026-06-23-algerian-thesis-norms.md`). Include at least: a generic French (science/IMRAD, APA, left binding), a generic Arabic (law-humanities, footnote-ar, right binding), and 2-3 university-flavored ones.
```typescript
import { templates } from "./schema";
export async function seedTemplates() {
  const [{ count }] = (await db.select({ count: sql<number>`count(*)::int` }).from(templates)) as { count: number }[];
  if (count > 0) return;
  const A4 = { paperSize: "A4", lineSpacing: "1.5" };
  await db.insert(templates).values([
    {
      university: "Générique", type: "generic", language: "fr", name: "Mémoire — Français (Sciences)",
      discipline: "science", bindingSide: "left", citationStyle: "apa", bodyPreset: "imrad",
      config: { ...A4, margins: { top: "2.5cm", bottom: "2.5cm", left: "3cm", right: "2cm" }, bodyFont: "Times New Roman", bodySize: "12", headingFont: "Times New Roman" },
      frontMatter: { pageDeGarde: ["university","faculty","department","specialty","theme","authors","supervisor","academicYear"], ficheSynoptique: false, remerciements: true, dedicace: true, resumeLanguages: ["fr","ar","en"], resumePlacement: "back", sommaire: true, listeTableaux: true, listeFigures: true, listeAbreviations: true },
      structure: { sectionLabel: "Partie", chapterLabel: "Chapitre" },
      styleMap: { section: "dividerPage", chapter: "Heading1", contentHeadings: ["Heading2","Heading3","Heading4"], useDirectFormatting: false },
      chapterStructure: ["Introduction Générale","Synthèse Bibliographique","Matériel et Méthodes","Résultats et Discussion","Conclusion Générale"], isActive: true,
    },
    {
      university: "Générique", type: "generic", language: "ar", name: "مذكرة — عربية (علوم إنسانية)",
      discipline: "law-humanities", bindingSide: "right", citationStyle: "footnote-ar", bodyPreset: "law-humanities",
      config: { ...A4, margins: { top: "2.5cm", bottom: "2.5cm", left: "2cm", right: "3cm" }, bodyFont: "Simplified Arabic", bodySize: "16", headingFont: "Simplified Arabic" },
      frontMatter: { pageDeGarde: ["university","faculty","department","specialty","theme","authors","supervisor","academicYear"], ficheSynoptique: false, remerciements: true, dedicace: true, resumeLanguages: ["ar","fr","en"], resumePlacement: "back", sommaire: true, listeTableaux: true, listeFigures: true, listeAbreviations: true },
      structure: { sectionLabel: "قسم", chapterLabel: "فصل" },
      styleMap: { section: "dividerPage", chapter: "Heading1", contentHeadings: ["Heading2","Heading3","Heading4"], useDirectFormatting: true },
      chapterStructure: ["مقدمة عامة","الإطار النظري","الجانب التطبيقي","خاتمة عامة"], isActive: true,
    },
    {
      university: "USTHB Alger", type: "these_doctorat", language: "fr", name: "Thèse de Doctorat — USTHB",
      discipline: "science", bindingSide: "left", citationStyle: "apa", bodyPreset: "imrad",
      config: { ...A4, margins: { top: "2.5cm", bottom: "2.5cm", left: "3.5cm", right: "2.5cm" }, bodyFont: "Times New Roman", bodySize: "12", headingFont: "Times New Roman" },
      frontMatter: { pageDeGarde: ["university","faculty","department","specialty","theme","authors","supervisor","jury","academicYear"], ficheSynoptique: false, remerciements: true, dedicace: true, resumeLanguages: ["fr","en"], resumePlacement: "back", sommaire: true, listeTableaux: true, listeFigures: true, listeAbreviations: true },
      structure: { sectionLabel: "Partie", chapterLabel: "Chapitre" },
      styleMap: { section: "dividerPage", chapter: "Heading1", contentHeadings: ["Heading2","Heading3","Heading4"] },
      chapterStructure: ["Introduction Générale","État de l'art","Problématique et Objectifs","Contribution","Expérimentation et Résultats","Conclusion et Perspectives"], isActive: true,
    },
    {
      university: "ESI Alger", type: "pfe", language: "fr", name: "Projet de Fin d'Études — ESI",
      discipline: "science", bindingSide: "left", citationStyle: "apa", bodyPreset: "imrad",
      config: { ...A4, margins: { top: "2.5cm", bottom: "2.5cm", left: "3cm", right: "2.5cm" }, bodyFont: "Times New Roman", bodySize: "12", headingFont: "Arial" },
      frontMatter: { pageDeGarde: ["university","department","specialty","theme","authors","supervisor","academicYear"], ficheSynoptique: false, remerciements: true, dedicace: true, resumeLanguages: ["fr","en"], resumePlacement: "back", sommaire: true, listeTableaux: true, listeFigures: true, listeAbreviations: true },
      structure: { sectionLabel: "Partie", chapterLabel: "Chapitre" },
      styleMap: { section: "dividerPage", chapter: "Heading1", contentHeadings: ["Heading2","Heading3","Heading4"] },
      chapterStructure: ["Introduction Générale","Étude Préliminaire","Analyse et Spécification","Conception","Implémentation","Tests et Validation","Conclusion Générale"], isActive: true,
    },
  ] as any);
}
```
Add `sql` to imports if not present. In `src/index.ts`, call `seedTemplates()` alongside `seedNews()` at startup (e.g. `ensureSchema().then(seedNews).then(seedTemplates).catch(...).finally(start)`).

- [ ] **Step 2: Test** `scripts/test-seed-templates.ts`: call `seedTemplates()`, then `db.select().from(templates)`, assert ≥4 rows with profile fields populated; print count. Run it.
- [ ] **Step 3: tsc clean; commit**
```bash
git add src/db/index.ts src/index.ts scripts/test-seed-templates.ts
git commit -m "feat(server): seed Algerian template profiles (generic FR/AR + USTHB + ESI)"
```

---

## Task 3: App — API client functions

**Files:** Modify `lib/api.ts`

- [ ] **Step 1: Add** (near the thesis functions):
```typescript
import type { Template } from "@/types/thesis";
export async function listTemplates() { return apiGet<Template[]>("/api/templates"); }
export async function generateThesisPlan(input: { title: string; language?: string; bodyPreset?: string }) {
  return apiPost<{ sections: Array<{ title: string; kind: "introduction"|"section"|"conclusion"; chapters: Array<{ title: string; hint?: string }> }> }>("/api/thesis/generate-plan", input);
}
```
- [ ] **Step 2:** `npx tsc --noEmit` (the 8 pre-existing unrelated errors remain; no NEW errors). Commit:
```bash
git add lib/api.ts && git commit -m "feat(app/api): listTemplates + generateThesisPlan"
```

---

## Task 4: App — wizard state store

**Files:** Create `stores/thesis-wizard-store.ts`

- [ ] **Step 1: Implement**
```typescript
import { create } from "zustand";
import type { GeneratedPlanShape } from "@/types/thesis"; // see note

export interface WizardPlanSection { title: string; kind: "introduction" | "section" | "conclusion"; chapters: { title: string; hint?: string }[]; }
interface WizardState {
  title: string;
  language: string;
  templateId: string | null;
  plan: WizardPlanSection[] | null;
  set: (patch: Partial<Pick<WizardState, "title" | "language" | "templateId" | "plan">>) => void;
  reset: () => void;
}
export const useThesisWizard = create<WizardState>((set) => ({
  title: "", language: "fr", templateId: null, plan: null,
  set: (patch) => set(patch),
  reset: () => set({ title: "", language: "fr", templateId: null, plan: null }),
}));
```
(Drop the `GeneratedPlanShape` import; `WizardPlanSection` is defined inline. Remove the stray import line.)

- [ ] **Step 2:** tsc clean; commit:
```bash
git add stores/thesis-wizard-store.ts && git commit -m "feat(app): transient thesis-wizard store (title/language/templateId/plan)"
```

---

## Task 5: App — rework NewThesisSheet (capture → route, no creation)

**Files:** Modify `components/NewThesisSheet.tsx`

- [ ] **Step 1:** Read the current file. Replace the submit handler so it: validates the title, sets `useThesisWizard.getState().set({ title: name, language })` (default language `i18n.language` or "fr"), closes the sheet (`useBottomSheet.getState().closeSheet("new-thesis")`), and routes to the template picker: `router.push("/(app)/template-picker")`. It MUST NOT call `createThesis` / `getThesis` anymore. Keep the AI title-suggestions UI. Change the button label to e.g. `t("thesis.continue", { defaultValue: "Continue" })`.
- [ ] **Step 2:** tsc clean; commit:
```bash
git add components/NewThesisSheet.tsx && git commit -m "feat(app): title sheet captures title -> routes to template picker (no creation)"
```

---

## Task 6: App — templates from server + wizard wiring in picker/preview

**Files:** Modify `app/(app)/template-picker.tsx`, `app/(app)/template-preview.tsx`, `stores/thesis-store.ts`

- [ ] **Step 1:** In `stores/thesis-store.ts`, change `loadTemplates` to fetch from the server:
```typescript
loadTemplates: async () => {
  try { const { listTemplates } = await import("@/lib/api"); set({ templates: await listTemplates() }); }
  catch { set({ templates: [] }); }
},
```
Update the `ThesisState` type for `loadTemplates: () => Promise<void>`.
- [ ] **Step 2:** In `template-picker.tsx`: call `loadTemplates()` on mount (`useEffect`). Wire the **AI Wizard** card to also open the title sheet (same as Blank for now — both enter the wizard via title→template→plan). Wire the **Import** card to a no-op toast `t(...)` (full import is scenario 2, deferred). On template tap, keep routing to `template-preview` with `templateId`. (Title already lives in the wizard store from Task 5.)
- [ ] **Step 3:** In `template-preview.tsx`: replace `handleUseTemplate`. It must now: set `useThesisWizard.getState().set({ templateId: template.id, language: template.language })`; call `generateThesisPlan({ title: wizard.title || template.name, language: template.language, bodyPreset: template.bodyPreset })`; store the returned `plan` in the wizard (`set({ plan })`); navigate to `router.push("/(app)/thesis-plan")`. Show a loading state while generating (a spinner on the button). Do NOT create the thesis here. If `generateThesisPlan` throws, route to thesis-plan anyway with a `null` plan (the plan screen will show the fallback/regenerate).
- [ ] **Step 4:** tsc clean; commit:
```bash
git add stores/thesis-store.ts "app/(app)/template-picker.tsx" "app/(app)/template-preview.tsx"
git commit -m "feat(app): load server templates; preview generates plan -> routes to plan step"
```

---

## Task 7: App — the Plan editor screen

**Files:** Create `app/(app)/thesis-plan.tsx`; register it in `app/(app)/_layout.tsx`

- [ ] **Step 1:** Register `<Stack.Screen name="thesis-plan" />` in `app/(app)/_layout.tsx`.
- [ ] **Step 2:** Implement `app/(app)/thesis-plan.tsx` — `ThesisPlanEditor`:
  - Reads `plan`, `title`, `language`, `templateId` from `useThesisWizard`.
  - If `plan` is null on mount, call `generateThesisPlan({title,language})` and set it (show a "Génération du plan…" loader). 
  - Renders the plan as a scrollable list: each **Section** (Partie) as a card with an editable title + its **Chapters** (Chapitres) as rows with editable titles; per-section "add chapter" + per-row delete; section add/delete; move up/down for both levels (simple index swaps writing back via `useThesisWizard.getState().set({ plan })`). Use `useThemeColors`, match existing screen styling (cards `bgCard`, primary `brandPrimary`).
  - Header actions: **Regenerate** (re-calls `generateThesisPlan`, replaces plan) and **Create** (primary).
  - **Create** handler: build the `createThesis` payload from the edited plan → `const created = await createThesis({ title, templateId: templateId ?? undefined, language, sections: plan.map(s => ({ title: s.title, kind: s.kind, chapters: s.chapters.map(c => ({ title: c.title })) })) })` → `const full = await getThesis(created.id)` → `useThesisStore.getState().upsertThesis(full)` + `setCurrentThesis(full.id)` → `useThesisWizard.getState().reset()` → `router.replace({ pathname: "/(app)/thesis-detail", params: { id: full.id } })`. (P3 will change this destination to the workspace.)
  - Loading/disabled states on Create while the request is in flight; basic error toast on failure.
- [ ] **Step 3:** tsc clean; commit:
```bash
git add "app/(app)/thesis-plan.tsx" "app/(app)/_layout.tsx"
git commit -m "feat(app): AI plan editor screen; approval creates thesis -> thesis-detail"
```

---

## Task 8: i18n keys

**Files:** Modify `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1:** Add a `wizard` block under the existing structure (en shown; provide fr + ar translations):
```json
"wizard": {
  "continue": "Continue",
  "planTitle": "Your plan",
  "planSubtitle": "Review and adjust the outline. The AI drafts; you decide.",
  "generating": "Generating your plan…",
  "regenerate": "Regenerate",
  "create": "Create thesis",
  "addSection": "Add part",
  "addChapter": "Add chapter",
  "sectionTitle": "Part title",
  "chapterTitle": "Chapter title",
  "creating": "Creating…"
}
```
(fr: "Continuer"/"Votre plan"/"Revoyez et ajustez le plan…"/"Génération de votre plan…"/"Régénérer"/"Créer le mémoire"/"Ajouter une partie"/"Ajouter un chapitre"/… ; ar: "متابعة"/"خطتك"/"راجع وعدّل المخطط…"/"جارٍ توليد خطتك…"/"إعادة التوليد"/"إنشاء المذكرة"/"إضافة قسم"/"إضافة فصل"/…)
- [ ] **Step 2:** Verify keys load (no JSON syntax errors): `node -e "JSON.parse(require('fs').readFileSync('locales/ar.json','utf8'))"` for each. Commit:
```bash
git add locales/ && git commit -m "i18n(app): wizard + plan keys (en/fr/ar)"
```

---

## Task 9: Verification

- [ ] **Step 1:** Server boots; `generate-plan` + `templates` reachable. Quick check:
```bash
cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-generate-plan.ts && npx tsx scripts/test-seed-templates.ts && npx tsc --noEmit && echo SERVER_OK
```
- [ ] **Step 2:** App type-check (only the 8 known pre-existing errors remain, none in wizard files):
```bash
cd /Users/hamzasafwan/modakerati && npx tsc --noEmit 2>&1 | tail -20
```
- [ ] **Step 3:** (Manual, by user) run the app: New thesis → title → template → plan appears → edit → Create → lands on thesis-detail showing the sections/chapters. Flag for user.

## Definition of done (P2)
- `generate-plan` endpoint + template seed live; app lists real templates.
- Title sheet → picker → preview (generates plan) → editable plan screen → Create persists the thesis → thesis-detail. No thesis is created before approval; wizard store resets after.
- Both repos type-check (app: only pre-existing unrelated errors).

## Out of scope (later phases)
- The plan screen routes to `thesis-detail` for now; **P3** swaps that for the document workspace.
- Import flow (scenario 2) remains a no-op card.
