# Phase 4: Workspace Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract workspace state into its own store, add "Format thesis" button for Stage 4 formatting, and add outline panel toggle within the workspace.

**Architecture:** The workspace already has live .docx viewing, AI chat, block selection, and source uploads. This phase extracts workspace-specific state from thesis-store into workspace-store, adds the formatting pipeline trigger, and makes the outline sheet accessible from within the workspace.

**Tech Stack:** Expo Router, Zustand, React Native

**Working directory:** `~/modakerati`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `stores/workspace-store.ts` | Workspace-specific state (blocks, selection, panels) |
| Modify | `stores/thesis-store.ts` | Remove block selection state (moved to workspace-store) |
| Modify | `lib/api.ts` | Add formatThesis API function |
| Modify | `app/(app)/thesis-workspace.tsx` | Add format button, outline toggle, use workspace-store |
| Modify | `components/workspace/WorkspaceComposer.tsx` | Use workspace-store for selection |
| Modify | `locales/en.json` | Add workspace.* i18n keys |
| Modify | `locales/fr.json` | Add workspace.* i18n keys |
| Modify | `locales/ar.json` | Add workspace.* i18n keys |

---

### Task 1: Add formatThesis API + i18n keys

**Files:**
- Modify: `lib/api.ts`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

Add to lib/api.ts after the thesis analysis functions:
```typescript
export async function formatThesis(
  thesisId: string,
  normProfileId?: string
): Promise<{ formatted: boolean; applied: string[]; skipped: string[] }> {
  return apiPost(`/api/thesis/${thesisId}/format`, normProfileId ? { normProfileId } : {});
}
```

Add `"workspace"` i18n keys to all 3 locale files:

**en.json:**
```json
"workspace": {
  "formatThesis": "Format thesis",
  "formatting": "Formatting...",
  "formatted": "Formatting applied",
  "formatError": "Could not format thesis",
  "noNormProfile": "No formatting standard assigned",
  "outline": "Outline",
  "sources": "Sources",
  "export": "Export"
}
```

**fr.json:**
```json
"workspace": {
  "formatThesis": "Formater le memoire",
  "formatting": "Formatage en cours...",
  "formatted": "Formatage applique",
  "formatError": "Impossible de formater le memoire",
  "noNormProfile": "Aucune norme de mise en page assignee",
  "outline": "Plan",
  "sources": "Sources",
  "export": "Exporter"
}
```

**ar.json:**
```json
"workspace": {
  "formatThesis": "تنسيق المذكرة",
  "formatting": "جاري التنسيق...",
  "formatted": "تم تطبيق التنسيق",
  "formatError": "تعذر تنسيق المذكرة",
  "noNormProfile": "لم يتم تعيين معيار تنسيق",
  "outline": "الخطة",
  "sources": "المصادر",
  "export": "تصدير"
}
```

Commit: `git commit -m "feat: formatThesis API + workspace i18n keys"`

---

### Task 2: Create workspace-store

**Files:**
- Create: `stores/workspace-store.ts`

```typescript
import { create } from "zustand";

export type ActivePanel = "sources" | "outline" | null;

interface WorkspaceState {
  thesisId: string | null;
  selectedBlockIndex: number | null;
  selectedBlockText: string | null;
  activePanel: ActivePanel;
  isFormatting: boolean;

  setThesis: (id: string) => void;
  selectBlock: (index: number, text: string | null) => void;
  clearSelection: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  togglePanel: (panel: "sources" | "outline") => void;
  setFormatting: (v: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  thesisId: null as string | null,
  selectedBlockIndex: null as number | null,
  selectedBlockText: null as string | null,
  activePanel: null as ActivePanel,
  isFormatting: false,
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...INITIAL,

  setThesis: (id) => set({ thesisId: id }),

  selectBlock: (index, text) => set({
    selectedBlockIndex: index,
    selectedBlockText: text,
  }),

  clearSelection: () => set({
    selectedBlockIndex: null,
    selectedBlockText: null,
  }),

  setActivePanel: (panel) => set({ activePanel: panel }),

  togglePanel: (panel) => {
    const current = get().activePanel;
    set({ activePanel: current === panel ? null : panel });
  },

  setFormatting: (v) => set({ isFormatting: v }),

  reset: () => set(INITIAL),
}));
```

Commit: `git commit -m "feat: workspace-store — selection, panels, formatting state"`

---

### Task 3: Migrate thesis-store block selection to workspace-store

**Files:**
- Modify: `stores/thesis-store.ts`
- Modify: `components/workspace/WorkspaceComposer.tsx`
- Modify: `app/(app)/thesis-workspace.tsx`

Read each file first. The changes:

1. **thesis-store.ts**: Remove the `selected` state, `selectDocBlock`, and `clearSelection` methods. Keep everything else.

2. **WorkspaceComposer.tsx**: Replace imports from thesis-store for selection with workspace-store:
   - Change `useThesisStore(s => s.selected)` to `useWorkspaceStore`
   - Change `selectDocBlock` / `clearSelection` calls to `useWorkspaceStore.getState().selectBlock()` / `.clearSelection()`
   - Update the focus chip to read from workspace-store
   - Update `sendMessageToAI` to get `docBlockIndex` from workspace-store

3. **thesis-workspace.tsx**: Replace thesis-store selection usage with workspace-store:
   - Import `useWorkspaceStore`
   - Replace `selectDocBlock` calls with `useWorkspaceStore.getState().selectBlock()`
   - On mount: `useWorkspaceStore.getState().setThesis(thesisId)`
   - On unmount: `useWorkspaceStore.getState().reset()`

Commit: `git commit -m "refactor: migrate block selection from thesis-store to workspace-store"`

---

### Task 4: Add format button + outline toggle to workspace

**Files:**
- Modify: `app/(app)/thesis-workspace.tsx`

Read the file. Add:

1. **Format button** in the top bar or action row:
   - Icon: `Paintbrush` from lucide-react-native
   - On press: call `formatThesis(thesisId)`, show loading state, show success/error alert, refresh doc
   - If no normProfileId on thesis, show alert with "No formatting standard assigned"
   - Use `isFormatting` from workspace-store for loading state

2. **Outline toggle** in the action row (alongside Sources):
   - Icon: `List` or `ListTree` from lucide-react-native
   - On press: `useWorkspaceStore.getState().togglePanel("outline")`
   - Show ThesisStructureSheet when `activePanel === "outline"`

3. **Panel state**: Use `activePanel` from workspace-store to conditionally mount SourcesSheet and ThesisStructureSheet

The format handler:
```typescript
const handleFormat = useCallback(async () => {
  const thesis = useThesisStore.getState().getCurrentThesis();
  if (!thesis?.normProfileId) {
    Alert.alert(t("workspace.formatError"), t("workspace.noNormProfile"));
    return;
  }
  useWorkspaceStore.getState().setFormatting(true);
  try {
    await formatThesis(thesis.id);
    Alert.alert(t("workspace.formatted"));
    // Refresh doc to show new formatting
    refreshDoc();
  } catch {
    Alert.alert(t("workspace.formatError"));
  } finally {
    useWorkspaceStore.getState().setFormatting(false);
  }
}, [t, refreshDoc]);
```

Commit: `git commit -m "feat: format thesis button + outline toggle in workspace"`

---

### Task 5: Verify compilation

```bash
cd ~/modakerati && npx tsc --noEmit 2>&1 | grep -v "global.css\|absoluteFillObject\|getProviderHealth\|ProviderHealth\|setAIProvider\|getAIProvider\|AIProvider\|implicitly has an 'any'" | head -20
```

Fix any new errors and commit.

---

## Phase 4 Deliverables Checklist

- [ ] `formatThesis()` API function
- [ ] `workspace-store` with selection, panel toggles, formatting state
- [ ] Block selection migrated from thesis-store to workspace-store
- [ ] "Format thesis" button in workspace (calls Stage 4 pipeline)
- [ ] Outline panel toggle in workspace
- [ ] i18n keys for workspace features (en/fr/ar)
