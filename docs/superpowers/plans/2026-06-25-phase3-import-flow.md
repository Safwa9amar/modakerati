# Phase 3: Import .docx Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the import flow: user picks .docx → server creates thesis + runs analysis → app shows categorized suggestions (accept/reject) → user confirms → lands in workspace.

**Architecture:** A new import-store handles the file picker + upload + analysis state. The import calls `POST /api/thesis/import` (created in Phase 1) which creates a thesis directly (no separate documents table). A new import-analysis screen shows the analysis report with accept/reject per suggestion. Home screen import buttons are wired up.

**Tech Stack:** Expo Router, Zustand, expo-document-picker, expo-file-system, React Native

**Working directory:** `~/modakerati`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `stores/import-store.ts` | File picker, upload, analysis state, accept/reject |
| Modify | `lib/api.ts` | Add importThesis function (calls POST /api/thesis/import) |
| Create | `app/(app)/import-analysis.tsx` | Suggestions screen: categorized accept/reject |
| Modify | `app/(app)/_layout.tsx` | Register import-analysis screen |
| Modify | `app/(tabs)/index.tsx` | Wire import button to trigger import flow |
| Modify | `locales/en.json` | Add import.* i18n keys |
| Modify | `locales/fr.json` | Add import.* i18n keys |
| Modify | `locales/ar.json` | Add import.* i18n keys |

---

### Task 1: Add importThesis API function + i18n keys

**Files:**
- Modify: `lib/api.ts`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

Add to `lib/api.ts` after the existing thesis API functions:

```typescript
export interface AnalysisReport {
  structure: AnalysisSuggestion[];
  formatting: AnalysisSuggestion[];
  content: AnalysisSuggestion[];
}

export interface AnalysisSuggestion {
  id: string;
  category: "structure" | "formatting" | "content";
  severity: "error" | "warning" | "info";
  message: string;
  fix: string | null;
}

export async function importThesis(input: {
  base64: string;
  filename: string;
  language?: string;
  normProfileId?: string;
}): Promise<{ thesis: Thesis; analysisReport: AnalysisReport | null }> {
  return apiPost("/api/thesis/import", input);
}

export async function getThesisAnalysis(thesisId: string): Promise<AnalysisReport> {
  return apiGet(`/api/thesis/${thesisId}/analysis`);
}

export async function applyThesisSuggestions(thesisId: string, acceptedIds: string[]): Promise<{ applied: string[] }> {
  return apiPost(`/api/thesis/${thesisId}/apply`, { acceptedIds });
}
```

Add i18n keys under `"import"` in all 3 locale files:

**en.json:**
```json
"import": {
  "title": "Import Thesis",
  "analyzing": "Analyzing your document...",
  "analysisTitle": "Analysis Results",
  "structure": "Structure",
  "formatting": "Formatting",
  "content": "Content",
  "noIssues": "No issues found",
  "accept": "Accept",
  "reject": "Reject",
  "acceptAll": "Accept all",
  "apply": "Apply changes",
  "skip": "Skip to workspace",
  "error": "Error",
  "warning": "Warning",
  "info": "Suggestion",
  "pickNormFirst": "Pick a formatting standard first",
  "importing": "Importing your thesis..."
}
```

**fr.json:**
```json
"import": {
  "title": "Importer un memoire",
  "analyzing": "Analyse de votre document...",
  "analysisTitle": "Resultats de l'analyse",
  "structure": "Structure",
  "formatting": "Mise en page",
  "content": "Contenu",
  "noIssues": "Aucun probleme detecte",
  "accept": "Accepter",
  "reject": "Rejeter",
  "acceptAll": "Tout accepter",
  "apply": "Appliquer les modifications",
  "skip": "Aller a l'espace de travail",
  "error": "Erreur",
  "warning": "Avertissement",
  "info": "Suggestion",
  "pickNormFirst": "Choisissez d'abord une norme de mise en page",
  "importing": "Importation de votre memoire..."
}
```

**ar.json:**
```json
"import": {
  "title": "استيراد مذكرة",
  "analyzing": "جاري تحليل مستندك...",
  "analysisTitle": "نتائج التحليل",
  "structure": "الهيكل",
  "formatting": "التنسيق",
  "content": "المحتوى",
  "noIssues": "لم يتم العثور على مشاكل",
  "accept": "قبول",
  "reject": "رفض",
  "acceptAll": "قبول الكل",
  "apply": "تطبيق التعديلات",
  "skip": "الانتقال لمساحة العمل",
  "error": "خطا",
  "warning": "تحذير",
  "info": "اقتراح",
  "pickNormFirst": "اختر معيار التنسيق اولا",
  "importing": "جاري استيراد مذكرتك..."
}
```

Commit: `git commit -m "feat: importThesis API + analysis types + i18n keys"`

---

### Task 2: Create import-store

**Files:**
- Create: `stores/import-store.ts`

The store handles: file picking, base64 encoding, uploading to server, storing analysis report, tracking accepted/rejected suggestions.

```typescript
import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { importThesis, applyThesisSuggestions } from "@/lib/api";
import type { Thesis } from "@/types/thesis";
import type { AnalysisReport, AnalysisSuggestion } from "@/lib/api";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ImportStatus = "idle" | "picking" | "uploading" | "analyzing" | "ready" | "applying" | "done" | "error";

interface ImportState {
  status: ImportStatus;
  thesis: Thesis | null;
  analysisReport: AnalysisReport | null;
  acceptedIds: string[];
  rejectedIds: string[];
  normProfileId: string | null;
  errorMessage: string | null;

  setNormProfileId: (id: string | null) => void;
  pickAndImport: () => Promise<"ok" | "canceled" | "error">;
  toggleSuggestion: (id: string) => void;
  acceptAll: () => void;
  applyAccepted: () => Promise<void>;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as ImportStatus,
  thesis: null as Thesis | null,
  analysisReport: null as AnalysisReport | null,
  acceptedIds: [] as string[],
  rejectedIds: [] as string[],
  normProfileId: null as string | null,
  errorMessage: null as string | null,
};

export const useImportStore = create<ImportState>((set, get) => ({
  ...INITIAL,

  setNormProfileId: (id) => set({ normProfileId: id }),

  pickAndImport: async () => {
    set({ status: "picking", errorMessage: null });

    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: [DOCX_MIME],
        copyToCacheDirectory: true,
      });
    } catch {
      set({ status: "error", errorMessage: "Could not open the file picker" });
      return "error";
    }

    if (picked.canceled || !picked.assets?.[0]) {
      set({ status: "idle" });
      return "canceled";
    }

    const asset = picked.assets[0];
    if (!/\.docx$/i.test(asset.name ?? "")) {
      set({ status: "error", errorMessage: "Please choose a .docx file" });
      return "error";
    }

    set({ status: "uploading" });
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      set({ status: "analyzing" });
      const { thesis, analysisReport } = await importThesis({
        base64,
        filename: asset.name ?? "document.docx",
        normProfileId: get().normProfileId || undefined,
      });

      // Auto-accept all suggestions by default
      const allIds = [
        ...(analysisReport?.structure ?? []),
        ...(analysisReport?.formatting ?? []),
        ...(analysisReport?.content ?? []),
      ].map((s) => s.id);

      set({
        status: "ready",
        thesis,
        analysisReport,
        acceptedIds: allIds,
        rejectedIds: [],
      });
      return "ok";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      set({ status: "error", errorMessage: message });
      return "error";
    }
  },

  toggleSuggestion: (id) => {
    const { acceptedIds, rejectedIds } = get();
    if (acceptedIds.includes(id)) {
      set({
        acceptedIds: acceptedIds.filter((i) => i !== id),
        rejectedIds: [...rejectedIds, id],
      });
    } else {
      set({
        acceptedIds: [...acceptedIds, id],
        rejectedIds: rejectedIds.filter((i) => i !== id),
      });
    }
  },

  acceptAll: () => {
    const { analysisReport } = get();
    if (!analysisReport) return;
    const allIds = [
      ...analysisReport.structure,
      ...analysisReport.formatting,
      ...analysisReport.content,
    ].map((s) => s.id);
    set({ acceptedIds: allIds, rejectedIds: [] });
  },

  applyAccepted: async () => {
    const { thesis, acceptedIds } = get();
    if (!thesis || acceptedIds.length === 0) {
      set({ status: "done" });
      return;
    }
    set({ status: "applying" });
    try {
      await applyThesisSuggestions(thesis.id, acceptedIds);
      set({ status: "done" });
    } catch {
      set({ status: "done" }); // proceed anyway
    }
  },

  reset: () => set(INITIAL),
}));
```

Commit: `git commit -m "feat: import-store — file picker + upload + analysis state"`

---

### Task 3: Create import-analysis screen

**Files:**
- Create: `app/(app)/import-analysis.tsx`
- Modify: `app/(app)/_layout.tsx`

Register `<Stack.Screen name="import-analysis" />` in _layout.tsx.

The screen shows analysis results in 3 categorized sections with accept/reject toggles.

Key UI:
- Header with title + back button
- 3 collapsible sections: Structure, Formatting, Content
- Each suggestion is a card with: severity badge (error=red, warning=yellow, info=blue), message, accept/reject toggle
- Footer with "Apply changes" button (if any accepted) or "Skip to workspace" button
- Loading state while applying

Key imports:
```typescript
import { View, Text, ScrollView, Pressable, SafeAreaView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useImportStore } from "@/stores/import-store";
import { useThesisStore } from "@/stores/thesis-store";
import { BackButton } from "@/components/BackButton";
import { CheckCircle, XCircle, AlertTriangle, AlertCircle, Info, ChevronDown } from "lucide-react-native";
```

Key flow:
1. Read `analysisReport`, `acceptedIds`, `thesis` from import store
2. If no report or no suggestions, show "No issues found" + "Go to workspace" button
3. Show categorized sections with toggles
4. On "Apply": call `applyAccepted()`, then navigate to workspace
5. On "Skip": navigate to workspace directly
6. Navigation: set `currentThesisId` in thesis store, navigate to `/(app)/thesis-workspace`

Severity badge colors:
- error: `#EF4444` (red)
- warning: `#F59E0B` (amber)
- info: `#3B82F6` (blue)

Commit: `git commit -m "feat: import-analysis screen — categorized suggestions with accept/reject"`

---

### Task 4: Wire home screen import button

**Files:**
- Modify: `app/(tabs)/index.tsx`

Read the file. Find the quick action with `FolderUp` icon (the import button) and the empty-state import button. Wire them both to trigger the import flow:

```typescript
import { useImportStore } from "@/stores/import-store";
import { useThesisStore } from "@/stores/thesis-store";
```

The import handler:
```typescript
const handleImport = useCallback(async () => {
  const store = useImportStore.getState();
  store.reset();
  const result = await store.pickAndImport();
  if (result === "ok") {
    // Upsert the created thesis into thesis store
    const thesis = useImportStore.getState().thesis;
    if (thesis) {
      useThesisStore.getState().upsertThesis(thesis);
    }
    router.push("/(app)/import-analysis" as any);
  } else if (result === "error") {
    const msg = useImportStore.getState().errorMessage;
    Alert.alert(t("import.error"), msg || "Import failed");
  }
  // "canceled" — do nothing
}, [router, t]);
```

Replace the empty `onPress: () => {}` handlers for both the quick-action import card and the empty-state import button with `onPress: handleImport`.

Also add an import for `Alert` from `react-native` if not already imported.

Commit: `git commit -m "feat: wire home screen import button to import flow"`

---

### Task 5: Verify compilation

```bash
cd ~/modakerati && npx tsc --noEmit 2>&1 | grep -v "pre-existing\|global.css\|absoluteFillObject\|getProviderHealth\|ProviderHealth\|setAIProvider\|getAIProvider\|AIProvider" | head -20
```

Fix any new errors and commit.

---

## Phase 3 Deliverables Checklist

- [ ] `importThesis()`, `getThesisAnalysis()`, `applyThesisSuggestions()` API functions
- [ ] `AnalysisReport` + `AnalysisSuggestion` types
- [ ] `import-store` with file picker, upload, analysis state, accept/reject, apply
- [ ] `import-analysis` screen with categorized suggestions UI
- [ ] Home screen import button wired to full flow
- [ ] i18n keys for import flow (en/fr/ar)
