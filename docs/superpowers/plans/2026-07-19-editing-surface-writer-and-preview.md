# Editing Surface — The Writer + Preview (Plan 1 of the Workspace Redesign)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native outline the single default editing surface ("the Writer"), and replace the three-way docx→outline→pdf view cycler with one read-only **Preview** (Word or PDF) opened on demand and closed back to the Writer.

**Architecture:** The three document layers already stay mounted and stacked as absolute layers; today a `viewMode` string picks which layer is active. We replace `viewMode` with `previewMode` (`"docx" | "pdf" | null`): `null` means the Writer (native outline) is active; a non-null value puts that read-only preview layer on top. A header **Preview** button opens preview; a small in-preview toolbar switches Word⇄PDF and closes back to the Writer. The docx preview is forced read-only (editing now lives only in the Writer).

**Tech Stack:** React Native (Expo v56), Zustand, TypeScript, react-i18next, lucide-react-native icons.

**Verification model (IMPORTANT):** This app has **no JS test runner**. Do **not** write jest/vitest tests. Each task is verified by `npx tsc --noEmit` (must be clean) **plus** a described manual check in the running app. Because this is one tightly-coupled refactor, `tsc` only returns to green at the end of Task 1 — that's expected; do not commit mid-Task-1.

**Scope note:** This is Plan 1 of three. It is independently shippable. It does **not** include Focus mode, the Navigator, the composer redesign, or the friendly/fast enhancements — those are Plans 1b / 2 / 3 (see "Next plans" at the end). Spec: `docs/superpowers/specs/2026-07-19-workspace-writing-experience-redesign-design.md` §5.1–5.2.

---

## File Structure

- **Modify** `stores/workspace-store.ts` — replace the `viewMode: DocViewMode` model with `previewMode: PreviewMode` + `openPreview`/`setPreviewMode`/`closePreview`.
- **Create** `components/workspace/WorkspacePreview.tsx` — two small exports: `PreviewButton` (header eye button) and `PreviewBar` (in-preview Word/PDF/close toolbar). One responsibility: the preview entry/switch UI.
- **Delete** `components/workspace/WorkspaceViewSwitcher.tsx` — the old 3-way cycler; fully replaced.
- **Modify** `app/(app)/thesis-workspace.tsx` — read `previewMode`, drive the three layers from it (Writer active when `previewMode === null`), render `PreviewButton` in the header + `PreviewBar` above the doc area, key the PDF effect on `previewMode`, and set the docx preview `editable={false}`.
- **Modify** `locales/en.json`, `locales/fr.json`, `locales/ar.json` — add `workspace.preview`, `workspace.previewWord`, `workspace.previewPdf`, `workspace.closePreview`.

---

## Task 1: Swap the 3-way cycler for Writer + Preview

**Files:**
- Modify: `stores/workspace-store.ts` (lines 3–7, 37, 68–69, 87, 150–152)
- Create: `components/workspace/WorkspacePreview.tsx`
- Delete: `components/workspace/WorkspaceViewSwitcher.tsx`
- Modify: `app/(app)/thesis-workspace.tsx` (lines 38, 130, 332/341, 402, 473–475, 504–505, 537, 562–563, 580–583)

- [ ] **Step 1: Replace the view-mode type + docstring in the store**

In `stores/workspace-store.ts`, replace lines 3–7:

```ts
export type ActivePanel = "sources" | "outline" | null;
// "docx" = Word-fidelity editor (OnlyOffice / docx-preview), "outline" = native
// block render, "pdf" = OnlyOffice-rendered PDF in a WebView (PDF.js). The PDF
// tool sets this directly; toggleViewMode only swaps the docx↔outline pair.
export type DocViewMode = "docx" | "outline" | "pdf";
```

with:

```ts
export type ActivePanel = "sources" | "outline" | null;
// The native outline ("the Writer") is the single editing surface. A read-only
// preview overlay may sit on top of it: "docx" = Word-fidelity pages (OnlyOffice /
// docx-preview), "pdf" = the OnlyOffice-converted PDF (PDF.js). null = writing
// (the Writer is active, no preview).
export type PreviewMode = "docx" | "pdf" | null;
```

- [ ] **Step 2: Replace the state field**

In `stores/workspace-store.ts`, change line 37 from:

```ts
  viewMode: DocViewMode;
```

to:

```ts
  previewMode: PreviewMode;
```

- [ ] **Step 3: Replace the action signatures**

In `stores/workspace-store.ts`, replace lines 68–69:

```ts
  setViewMode: (mode: DocViewMode) => void;
  toggleViewMode: () => void;
```

with:

```ts
  openPreview: (mode: "docx" | "pdf") => void;
  setPreviewMode: (mode: PreviewMode) => void;
  closePreview: () => void;
```

- [ ] **Step 4: Replace the initial value**

In `stores/workspace-store.ts`, change line 87 from:

```ts
  viewMode: "docx" as DocViewMode,
```

to:

```ts
  previewMode: null as PreviewMode,
```

- [ ] **Step 5: Replace the action implementations**

In `stores/workspace-store.ts`, replace lines 150–152:

```ts
  setViewMode: (mode) => set({ viewMode: mode }),

  toggleViewMode: () => set({ viewMode: get().viewMode === "docx" ? "outline" : "docx" }),
```

with:

```ts
  openPreview: (mode) => set({ previewMode: mode }),

  setPreviewMode: (mode) => set({ previewMode: mode }),

  closePreview: () => set({ previewMode: null }),
```

(`get` is still used by `togglePanel`, so leave the `create<WorkspaceState>((set, get) => ...` signature unchanged.)

- [ ] **Step 6: Create the Preview components**

Create `components/workspace/WorkspacePreview.tsx` with exactly:

```tsx
import { Pressable, View, Text, StyleSheet } from "react-native";
import { Eye, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Header button: opens the read-only preview (defaults to Word-fidelity). While a
// preview is open, PreviewBar lets the user switch Word⇄PDF or close back to the
// Writer. Highlights (brand color) while a preview is showing.
export function PreviewButton() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const previewMode = useWorkspaceStore((s) => s.previewMode);
  return (
    <Pressable
      onPress={() => useWorkspaceStore.getState().openPreview("docx")}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t("workspace.preview", { defaultValue: "Preview" })}
      style={styles.btn}
    >
      <Eye size={22} color={previewMode ? colors.brandPrimary : colors.textPrimary} />
    </Pressable>
  );
}

// In-preview top toolbar: a Word | PDF segmented toggle + a close (✕) back to the
// Writer. Renders nothing while writing (previewMode === null).
export function PreviewBar() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const previewMode = useWorkspaceStore((s) => s.previewMode);
  if (!previewMode) return null;
  const isDocx = previewMode === "docx";
  return (
    <View style={[styles.bar, { backgroundColor: colors.bgSurface, borderBottomColor: colors.textPlaceholder }]}>
      <View style={[styles.seg, { borderColor: colors.textPlaceholder }]}>
        <Pressable
          onPress={() => useWorkspaceStore.getState().setPreviewMode("docx")}
          style={[styles.segItem, isDocx && { backgroundColor: colors.brandPrimary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.segText, { color: isDocx ? "#FFFFFF" : colors.textPrimary }]}>
            {t("workspace.previewWord", { defaultValue: "Word" })}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => useWorkspaceStore.getState().setPreviewMode("pdf")}
          style={[styles.segItem, !isDocx && { backgroundColor: colors.brandPrimary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.segText, { color: !isDocx ? "#FFFFFF" : colors.textPrimary }]}>
            {t("workspace.previewPdf", { defaultValue: "PDF" })}
          </Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => useWorkspaceStore.getState().closePreview()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.closePreview", { defaultValue: "Close preview" })}
        style={styles.close}
      >
        <X size={20} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, alignItems: "center", justifyContent: "center" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seg: { flexDirection: "row", borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: "hidden" },
  segItem: { paddingHorizontal: 18, paddingVertical: 6 },
  segText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
```

Note: uses only theme keys already proven in `thesis-workspace.tsx` (`bgSurface`, `brandPrimary`, `textPrimary`, `textPlaceholder`). If your `useThemeColors` exposes a dedicated `borderDefault`, you may swap the two `textPlaceholder` border usages for it.

- [ ] **Step 7: Delete the old cycler**

```bash
git rm components/workspace/WorkspaceViewSwitcher.tsx
```

- [ ] **Step 8: Update the workspace import + selector**

In `app/(app)/thesis-workspace.tsx`, change line 38 from:

```tsx
import { WorkspaceViewSwitcher } from "@/components/workspace/WorkspaceViewSwitcher";
```

to:

```tsx
import { PreviewButton, PreviewBar } from "@/components/workspace/WorkspacePreview";
```

Then change line 130 from:

```tsx
  const viewMode = useWorkspaceStore((s) => s.viewMode);
```

to:

```tsx
  const previewMode = useWorkspaceStore((s) => s.previewMode);
```

- [ ] **Step 9: Key the PDF lifecycle effect on `previewMode`**

In `app/(app)/thesis-workspace.tsx`, change the effect guard at line 332 from:

```tsx
    if (viewMode !== "pdf" || !isLiveDoc) return;
```

to:

```tsx
    if (previewMode !== "pdf" || !isLiveDoc) return;
```

and the dependency array at line 341 from:

```tsx
  }, [viewMode, isLiveDoc, docVersionKey, refreshPdf]);
```

to:

```tsx
  }, [previewMode, isLiveDoc, docVersionKey, refreshPdf]);
```

- [ ] **Step 10: Swap the header cycler for the Preview button**

In `app/(app)/thesis-workspace.tsx`, change line 402 from:

```tsx
        {/* One-tap view cycler (Document → Outline → PDF), live docs only. */}
        {liveDoc && <WorkspaceViewSwitcher />}
```

to:

```tsx
        {/* Read-only preview (Word / PDF), live docs only — editing is the Writer. */}
        {liveDoc && <PreviewButton />}
```

- [ ] **Step 11: Render the PreviewBar above the doc area**

In `app/(app)/thesis-workspace.tsx`, between the closing `</View>` of the top bar (line 473) and the `<Animated.View style={[{ flex: 1 }, docAreaStyle]}>` (line 475), insert:

```tsx
      {/* In-preview toolbar (Word/PDF/close). Renders nothing while writing. */}
      {liveDoc && <PreviewBar />}

```

- [ ] **Step 12: Drive the docx layer from `previewMode`**

In `app/(app)/thesis-workspace.tsx`, change lines 504–505 from:

```tsx
              style={[styles.docLayer, viewMode === "docx" ? styles.layerActive : styles.layerHidden]}
              pointerEvents={viewMode === "docx" ? "auto" : "none"}
```

to:

```tsx
              style={[styles.docLayer, previewMode === "docx" ? styles.layerActive : styles.layerHidden]}
              pointerEvents={previewMode === "docx" ? "auto" : "none"}
```

- [ ] **Step 13: Force the docx preview read-only**

In `app/(app)/thesis-workspace.tsx`, change line 537 from:

```tsx
                  editable={!isGenerating}
```

to:

```tsx
                  editable={false}
```

- [ ] **Step 14: Make the Writer (outline) the default active layer**

In `app/(app)/thesis-workspace.tsx`, change lines 562–563 from:

```tsx
              style={[styles.docLayer, viewMode === "outline" ? styles.layerActive : styles.layerHidden]}
              pointerEvents={viewMode === "outline" ? "auto" : "none"}
```

to:

```tsx
              style={[styles.docLayer, previewMode === null ? styles.layerActive : styles.layerHidden]}
              pointerEvents={previewMode === null ? "auto" : "none"}
```

- [ ] **Step 15: Drive the PDF layer from `previewMode`**

In `app/(app)/thesis-workspace.tsx`, change lines 580–583 from:

```tsx
            {(pdfMounted || viewMode === "pdf") && (
              <View
                style={[styles.docLayer, viewMode === "pdf" ? styles.layerActive : styles.layerHidden]}
                pointerEvents={viewMode === "pdf" ? "auto" : "none"}
```

to:

```tsx
            {(pdfMounted || previewMode === "pdf") && (
              <View
                style={[styles.docLayer, previewMode === "pdf" ? styles.layerActive : styles.layerHidden]}
                pointerEvents={previewMode === "pdf" ? "auto" : "none"}
```

- [ ] **Step 16: Typecheck (must be clean now)**

Run: `npx tsc --noEmit`
Expected: no errors. (If `viewMode`/`DocViewMode`/`WorkspaceViewSwitcher` still appears, a site above was missed — grep `grep -rn "viewMode\|DocViewMode\|WorkspaceViewSwitcher" app components stores` should return nothing.)

- [ ] **Step 17: Verify in the running app**

Start the app (e.g. `npx expo start`, open a live-.docx thesis workspace). Confirm:
1. The workspace **opens in the Writer** (native outline — editable blocks on white paper), not the Word WebView.
2. The header shows an **eye (Preview)** button instead of the cycling file-type icon.
3. Tapping Preview shows the **Word-fidelity** layer with a top bar: `Word | PDF` toggle + `✕`.
4. Tapping **PDF** switches to the PDF render (spinner then pages); tapping **Word** switches back.
5. Tapping **✕** returns to the Writer; the eye button is brand-colored while previewing, default otherwise.
6. In the Writer, inline paragraph edit / split / drag-reorder still work; in the Word preview, tapping text does **not** enter edit mode (read-only).

- [ ] **Step 18: Commit**

```bash
git add stores/workspace-store.ts components/workspace/WorkspacePreview.tsx app/(app)/thesis-workspace.tsx
git commit -m "feat(workspace): outline becomes the Writer; docx/pdf become one Preview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(The `git rm` from Step 7 is already staged; `git add` the rest. Commit only these exact paths — the tree has unrelated edits from parallel sessions.)

---

## Task 2: Translations for the preview strings

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

The `defaultValue` fallbacks already make the UI work; this adds proper trilingual strings under the existing `workspace` namespace.

- [ ] **Step 1: Locate the workspace block in each locale**

Run: `grep -n '"workspace"' locales/en.json locales/fr.json locales/ar.json`
Expected: one line per file pointing at the `"workspace": { ... }` object. Open each and find an existing key (e.g. `"undo"`) to match indentation/quoting style.

- [ ] **Step 2: Add the four keys to `locales/en.json`**

Inside the `"workspace"` object, add:

```json
    "preview": "Preview",
    "previewWord": "Word",
    "previewPdf": "PDF",
    "closePreview": "Close preview",
```

(Ensure the preceding line ends with a comma and JSON stays valid.)

- [ ] **Step 3: Add the four keys to `locales/fr.json`**

Inside the `"workspace"` object, add:

```json
    "preview": "Aperçu",
    "previewWord": "Word",
    "previewPdf": "PDF",
    "closePreview": "Fermer l'aperçu",
```

- [ ] **Step 4: Add the four keys to `locales/ar.json`**

Inside the `"workspace"` object, add:

```json
    "preview": "معاينة",
    "previewWord": "Word",
    "previewPdf": "PDF",
    "closePreview": "إغلاق المعاينة",
```

- [ ] **Step 5: Validate JSON**

Run: `node -e "['en','fr','ar'].forEach(l=>require('./locales/'+l+'.json'))"`
Expected: no output (all three parse). If it throws, fix the trailing comma / brace it names.

- [ ] **Step 6: Verify in the app**

Reload the app; switch language to Arabic and French (via the app's language setting) and confirm the Preview button's accessibility label / any visible preview text is translated (the `Word`/`PDF` labels are intentionally identical across languages).

- [ ] **Step 7: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(workspace): preview strings (en/fr/ar)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (§5.1–5.2 of the spec):**
- "Outline becomes the single Writer" → Task 1, Steps 4 + 14 (default `previewMode === null` → outline layer active).
- "docx + pdf collapse into one read-only Preview" → Task 1, Steps 6, 10–15 (PreviewButton/Bar; docx `editable={false}`).
- "Exiting returns to the Writer at the same place" → layers stay mounted (unchanged architecture); `closePreview` sets `previewMode = null`.
- Focus mode (§5.3) and Navigator (§5.4) are **intentionally not in this plan** — see Next plans (Plan 1b). This is a deliberate decomposition, not a gap.

**Placeholder scan:** none — every step shows exact old/new code or an exact command.

**Type consistency:** `PreviewMode`, `previewMode`, `openPreview`, `setPreviewMode`, `closePreview` are used identically in the store (Task 1 Steps 1–5), the components (Step 6), and the screen (Steps 8–15). The removed names (`DocViewMode`, `viewMode`, `setViewMode`, `toggleViewMode`, `WorkspaceViewSwitcher`) are eliminated at every site found by the grep in the plan header.

---

## Next plans (not this document)

- **Plan 1b — Focus mode + Navigator** (§5.3–5.4): a `focusMode` store flag that dims non-active blocks in the Writer, and a section navigator (jump + drag-reorder) built on/around the existing `ThesisStructureSheet` + `OutlineReorderable`. To be detailed after reading `OutlineReorderable.tsx` / `DocBlock.tsx`.
- **Plan 2 — Block-anchored composer** (spec Part A): decompose `WorkspaceComposerSheet.tsx`, the two-form context bar, category expansion, inline AI suggestions, idle AI bar, header declutter (tools → ⋯), remove `composerMode`.
- **Plan 3 — Friendly/fast enhancements** (spec §6): the 12 selected items (skeleton screens, warm preview, virtualization, streaming suggestions, batched sync + status chip, AI-explains, empty states, milestones, haptics, voice, progress & momentum).
