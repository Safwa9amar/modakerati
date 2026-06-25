# Phase 2: New Thesis Creation Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the thesis creation wizard to: template picker (with norm profiles) → title & details → AI plan generation (editable) → confirm & create .docx with correct formatting.

**Architecture:** The wizard store gains norm profile awareness. The template-picker screen adds filtering by university/discipline/language and a prominent "Blank" option. A new thesis-title screen collects title + details between template selection and plan generation. The plan screen is refactored for inline editing. Server-side, createThesis gains normProfileId support.

**Tech Stack:** Expo Router, Zustand, React Native, NativeWind, i18next

**Working directories:** `~/modakerati` (app) and `~/modakerati-server` (server)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `types/thesis.ts` | Add NormProfile type |
| Modify | `lib/api.ts` | Add listNormProfiles, getNormProfile; update createThesis to accept normProfileId |
| Modify | `stores/thesis-wizard-store.ts` | Add normProfileId, step tracking, supervisor/academicYear fields |
| Modify | `stores/thesis-store.ts` | Add normProfiles list + loadNormProfiles |
| Modify | `app/(app)/template-picker.tsx` | Rebuild: norm profile filter, blank option, navigate to thesis-title |
| Create | `app/(app)/thesis-title.tsx` | New screen: title + language + optional details |
| Modify | `app/(app)/thesis-plan.tsx` | Refactor: use wizard store normProfileId, pass to createThesis |
| Modify | `app/(app)/_layout.tsx` | Register thesis-title screen |
| Modify | `locales/en.json` | Add i18n keys for new screens |
| Modify | `locales/fr.json` | Add i18n keys for new screens |
| Modify | `locales/ar.json` | Add i18n keys for new screens |
| Modify (server) | `src/routes/thesis.ts` | Update POST / to accept normProfileId, apply norm profile formatting to seeded .docx |

---

### Task 1: Add NormProfile type + API functions

**Files:**
- Modify: `~/modakerati/types/thesis.ts`
- Modify: `~/modakerati/lib/api.ts`

- [ ] **Step 1: Add NormProfile type to types/thesis.ts**

After the `Template` interface (line 75), add:
```typescript
export interface NormProfile {
  id: string;
  name: string;
  university: string | null;
  language: string;
  discipline: Discipline;
  bodyPreset: BodyPreset;
  citationStyle: CitationStyle;
  bindingSide: "left" | "right";
  formatting?: {
    font: string;
    fontSize: number;
    headingSizes: { h1: number; h2: number; h3: number };
    margins: { binding: number; opposite: number; top: number; bottom: number };
    spacing: number;
    footnoteFontSize: number;
    alignment: string;
  };
}
```

- [ ] **Step 2: Add API functions to lib/api.ts**

Add import of `NormProfile` from `@/types/thesis` (line 16).

After `listTemplates()` (around line 340), add:
```typescript
export async function listNormProfiles() {
  return apiGet<NormProfile[]>("/api/norm-profiles");
}

export async function getNormProfile(id: string) {
  return apiGet<NormProfile>(`/api/norm-profiles/${id}`);
}
```

- [ ] **Step 3: Update createThesis to accept normProfileId**

In the `createThesis` function input type (line 303), add `normProfileId?: string` field:
```typescript
export async function createThesis(input: {
  title: string;
  templateId?: string;
  normProfileId?: string;
  language?: string;
  sections?: Array<{ title: string; kind?: "introduction" | "section" | "conclusion"; chapters?: Array<{ title: string; content?: string }> }>;
}) {
  return apiPost<Thesis>("/api/thesis", input);
}
```

- [ ] **Step 4: Commit**

```bash
git add types/thesis.ts lib/api.ts
git commit -m "feat: add NormProfile type + API functions for norm profiles"
```

---

### Task 2: Update thesis-wizard-store

**Files:**
- Modify: `~/modakerati/stores/thesis-wizard-store.ts`

- [ ] **Step 1: Expand wizard state with norm profile + step tracking**

Replace the entire file:
```typescript
import { create } from "zustand";

export interface WizardPlanSection {
  title: string;
  kind: "introduction" | "section" | "conclusion";
  chapters: { title: string; hint?: string; content?: string }[];
}

export type WizardStep = "template" | "title" | "plan" | "confirm";

interface WizardState {
  step: WizardStep;
  title: string;
  language: string;
  templateId: string | null;
  normProfileId: string | null;
  supervisor: string;
  academicYear: string;
  plan: WizardPlanSection[] | null;
  set: (patch: Partial<Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "plan">>) => void;
  reset: () => void;
}

const INITIAL: Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "plan"> = {
  step: "template",
  title: "",
  language: "fr",
  templateId: null,
  normProfileId: null,
  supervisor: "",
  academicYear: "",
  plan: null,
};

export const useThesisWizard = create<WizardState>((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  reset: () => set(INITIAL),
}));
```

- [ ] **Step 2: Commit**

```bash
git add stores/thesis-wizard-store.ts
git commit -m "feat: expand thesis-wizard-store with normProfileId + step tracking"
```

---

### Task 3: Add normProfiles to thesis-store

**Files:**
- Modify: `~/modakerati/stores/thesis-store.ts`

- [ ] **Step 1: Read the file, then add normProfiles state + loader**

Add to the state interface:
```typescript
normProfiles: NormProfile[];
```

Add import of `NormProfile` from `@/types/thesis` and `listNormProfiles` from `@/lib/api`.

Add to the initial state:
```typescript
normProfiles: [],
```

Add method:
```typescript
loadNormProfiles: async () => {
  try {
    const profiles = await listNormProfiles();
    set({ normProfiles: profiles });
  } catch (e) {
    console.error("Failed to load norm profiles:", e);
  }
},
```

- [ ] **Step 2: Commit**

```bash
git add stores/thesis-store.ts
git commit -m "feat: add normProfiles list + loader to thesis-store"
```

---

### Task 4: Add i18n keys for new screens

**Files:**
- Modify: `~/modakerati/locales/en.json`
- Modify: `~/modakerati/locales/fr.json`
- Modify: `~/modakerati/locales/ar.json`

- [ ] **Step 1: Add keys to all 3 locale files**

Add under a new `"wizard"` key in each file:

**en.json:**
```json
"wizard": {
  "pickTemplate": "Choose a template",
  "blank": "Blank thesis",
  "blankDesc": "Start from scratch",
  "filterUniversity": "Filter by university",
  "filterDiscipline": "Filter by discipline",
  "filterLanguage": "Filter by language",
  "allUniversities": "All universities",
  "allDisciplines": "All disciplines",
  "titleScreen": "Thesis details",
  "enterTitle": "Enter your thesis title",
  "titlePlaceholder": "e.g. Impact of AI on education",
  "supervisor": "Supervisor (optional)",
  "academicYear": "Academic year (optional)",
  "language": "Language",
  "next": "Next",
  "back": "Back",
  "generatePlan": "Generate outline",
  "regenerate": "Regenerate",
  "editPlan": "Edit your outline",
  "createThesis": "Create thesis",
  "creating": "Creating your thesis...",
  "sectionTitle": "Section title",
  "chapterTitle": "Chapter title",
  "addSection": "Add section",
  "addChapter": "Add chapter",
  "normProfile": "Formatting standard",
  "pickNormProfile": "Choose formatting standard"
}
```

**fr.json:**
```json
"wizard": {
  "pickTemplate": "Choisir un modele",
  "blank": "Memoire vierge",
  "blankDesc": "Commencer de zero",
  "filterUniversity": "Filtrer par universite",
  "filterDiscipline": "Filtrer par discipline",
  "filterLanguage": "Filtrer par langue",
  "allUniversities": "Toutes les universites",
  "allDisciplines": "Toutes les disciplines",
  "titleScreen": "Details du memoire",
  "enterTitle": "Entrez le titre de votre memoire",
  "titlePlaceholder": "ex. Impact de l'IA sur l'education",
  "supervisor": "Encadreur (optionnel)",
  "academicYear": "Annee universitaire (optionnel)",
  "language": "Langue",
  "next": "Suivant",
  "back": "Retour",
  "generatePlan": "Generer le plan",
  "regenerate": "Regenerer",
  "editPlan": "Modifier votre plan",
  "createThesis": "Creer le memoire",
  "creating": "Creation de votre memoire...",
  "sectionTitle": "Titre de la section",
  "chapterTitle": "Titre du chapitre",
  "addSection": "Ajouter une section",
  "addChapter": "Ajouter un chapitre",
  "normProfile": "Norme de mise en page",
  "pickNormProfile": "Choisir la norme de mise en page"
}
```

**ar.json:**
```json
"wizard": {
  "pickTemplate": "اختر قالبا",
  "blank": "مذكرة فارغة",
  "blankDesc": "ابدا من الصفر",
  "filterUniversity": "تصفية حسب الجامعة",
  "filterDiscipline": "تصفية حسب التخصص",
  "filterLanguage": "تصفية حسب اللغة",
  "allUniversities": "كل الجامعات",
  "allDisciplines": "كل التخصصات",
  "titleScreen": "تفاصيل المذكرة",
  "enterTitle": "ادخل عنوان مذكرتك",
  "titlePlaceholder": "مثال: تاثير الذكاء الاصطناعي على التعليم",
  "supervisor": "المشرف (اختياري)",
  "academicYear": "السنة الجامعية (اختياري)",
  "language": "اللغة",
  "next": "التالي",
  "back": "رجوع",
  "generatePlan": "توليد الخطة",
  "regenerate": "اعادة التوليد",
  "editPlan": "تعديل خطتك",
  "createThesis": "انشاء المذكرة",
  "creating": "جاري انشاء مذكرتك...",
  "sectionTitle": "عنوان القسم",
  "chapterTitle": "عنوان الفصل",
  "addSection": "اضافة قسم",
  "addChapter": "اضافة فصل",
  "normProfile": "معيار التنسيق",
  "pickNormProfile": "اختر معيار التنسيق"
}
```

- [ ] **Step 2: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "feat: add i18n keys for thesis creation wizard (en/fr/ar)"
```

---

### Task 5: Rebuild template-picker screen

**Files:**
- Modify: `~/modakerati/app/(app)/template-picker.tsx`

- [ ] **Step 1: Read the current file, then rebuild**

The rebuilt template-picker should:
1. Load norm profiles on mount via `useThesisStore.loadNormProfiles()`
2. Show a prominent "Blank" card at the top
3. Show filter row: university dropdown, discipline dropdown, language dropdown
4. Show filterable list of norm profiles (NOT templates — norm profiles are the new templates)
5. On select: set `normProfileId` in wizard store, navigate to `thesis-title`
6. On "Blank": set `normProfileId: null`, navigate to `thesis-title`

Key implementation notes:
- Use `useThesisStore` for `normProfiles` array
- Use `useThesisWizard.getState().set()` to update wizard
- Use `router.push("/(app)/thesis-title")` to navigate
- Use `useTranslation()` for all strings with `wizard.*` keys
- Use `useThemeColors()` for theming
- Follow existing NativeWind patterns from the current file
- Keep the same header/back-button pattern

- [ ] **Step 2: Commit**

```bash
git add app/(app)/template-picker.tsx
git commit -m "feat: rebuild template-picker with norm profile selection + filtering"
```

---

### Task 6: Create thesis-title screen

**Files:**
- Create: `~/modakerati/app/(app)/thesis-title.tsx`
- Modify: `~/modakerati/app/(app)/_layout.tsx`

- [ ] **Step 1: Register screen in _layout.tsx**

Read `app/(app)/_layout.tsx`. Add a new `<Stack.Screen name="thesis-title" />` after the `template-picker` screen.

- [ ] **Step 2: Create thesis-title.tsx**

The screen collects:
- **Title** (required) — text input with AI title suggestions (use existing `suggestThesisTitles` from api.ts)
- **Language** selector — 3 options: FR, AR, EN (default from norm profile or "fr")
- **Supervisor** (optional) — text input
- **Academic year** (optional) — text input

Layout:
- Safe area + scroll view
- Back button in header
- Title: `t("wizard.titleScreen")`
- Each field with label
- "Next" button at bottom → navigates to `thesis-plan`
- On "Next": validate title not empty, save all fields to wizard store

```typescript
import { View, Text, TextInput, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { BackButton } from "@/components/BackButton";
import { useState, useCallback, useEffect, useRef } from "react";
import { suggestThesisTitles } from "@/lib/api";
import { ChevronRight } from "lucide-react-native";
```

Key behavior:
- Debounced title suggestions: as user types (>5 chars), call `suggestThesisTitles(text, language)` after 500ms
- Show suggestions as tappable chips below the input
- Language picker: 3 horizontal buttons (FR / AR / EN), selected state highlighted
- Pre-fill from wizard store if user navigates back
- "Next" button saves to wizard store and navigates to `thesis-plan`

- [ ] **Step 3: Commit**

```bash
git add app/(app)/thesis-title.tsx app/(app)/_layout.tsx
git commit -m "feat: thesis-title screen — title + details entry with AI suggestions"
```

---

### Task 7: Refactor thesis-plan screen

**Files:**
- Modify: `~/modakerati/app/(app)/thesis-plan.tsx`

- [ ] **Step 1: Read and refactor**

Key changes:
1. Pass `normProfileId` from wizard store to `generateThesisPlan()` call (the server can use it for discipline-aware outlines)
2. Pass `normProfileId` to `createThesis()` call alongside sections
3. Read `bodyPreset` from wizard store's norm profile to inform plan generation
4. Update the `handleCreate()` function to include `normProfileId` in the createThesis input:
```typescript
const { normProfileId } = useThesisWizard.getState();
const created = await createThesis({
  title: wiz.title,
  language: wiz.language,
  templateId: wiz.templateId || undefined,
  normProfileId: normProfileId || undefined,
  sections: wiz.plan,
});
```

5. Keep all existing plan editing UI (sections, chapters, reorder, add, delete) — it works well

- [ ] **Step 2: Commit**

```bash
git add app/(app)/thesis-plan.tsx
git commit -m "feat: refactor thesis-plan to pass normProfileId to createThesis"
```

---

### Task 8: Server — update POST /api/thesis to accept normProfileId

**Files:**
- Modify: `~/modakerati-server/src/routes/thesis.ts`

- [ ] **Step 1: Read the file, find the POST / handler**

Update the handler to:
1. Accept `normProfileId` from request body
2. Include it in the thesis insert
3. After seeding the .docx (seedThesisDoc), if normProfileId exists, apply formatting:
```typescript
// After seedThesisDoc succeeds:
if (normProfileId) {
  const [profile] = await db.select().from(normProfiles).where(eq(normProfiles.id, normProfileId));
  if (profile) {
    const engine = await loadThesisEngine(docPath);
    const docXml = engine.zip.readAsText("word/document.xml") || "";
    const { xml } = applyFormattingToXml(docXml, profile.formatting as any, profile.bindingSide);
    engine.zip.writeText("word/document.xml", xml);
    await uploadDocx(docPath, engine.zip.toBuffer());
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/modakerati-server
git add src/routes/thesis.ts
git commit -m "feat: POST /api/thesis accepts normProfileId + applies formatting on create"
```

---

### Task 9: Verify both repos compile

- [ ] **Step 1: Check server**

```bash
cd ~/modakerati-server && npx tsc --noEmit
```

- [ ] **Step 2: Check app**

```bash
cd ~/modakerati && npx expo export --platform web --no-bundle 2>&1 | tail -5
```
Or simply: `npx tsc --noEmit` if tsconfig is set up.

- [ ] **Step 3: Fix any issues and commit**

---

## Phase 2 Deliverables Checklist

- [ ] `NormProfile` type in app
- [ ] `listNormProfiles()` + `getNormProfile()` API functions
- [ ] `createThesis()` accepts `normProfileId`
- [ ] `thesis-wizard-store` with normProfileId + step + supervisor + academicYear
- [ ] `thesis-store` loads + stores normProfiles
- [ ] Template-picker rebuilt: norm profile list with university/discipline/language filters + blank option
- [ ] New `thesis-title` screen: title (with AI suggestions) + language + supervisor + academic year
- [ ] `thesis-plan` passes normProfileId to createThesis
- [ ] Server POST /api/thesis applies norm profile formatting on .docx creation
- [ ] i18n keys for all new UI (en/fr/ar)
