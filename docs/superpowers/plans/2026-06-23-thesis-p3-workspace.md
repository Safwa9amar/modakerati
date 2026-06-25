# Thesis P3 — Document Workspace (Paper-Card Preview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** A read-rendering **document workspace** screen that shows the memoir as native "paper" pages — title page → front matter (résumé) → Section (Partie) dividers → Chapter (Chapitre) cards rendering markdown (headings, tables) — on a grey canvas. Tapping a Section/Chapter selects it (state for P4's chat). This becomes the destination after plan approval and from thesis-detail.

**Architecture:** New `app/(app)/thesis-workspace.tsx` reads `thesisId`, ensures the full thesis is loaded (`refreshThesis` → `getThesis` → `upsertThesis`), and renders a `ScrollView` of `PaperPage`s. `ChapterCard` reuses the existing `components/Markdown.tsx` (react-native-marked: tables, headings, RTL-aware) to render `chapter.content`. The thesis store gains `selected` + `refreshThesis`. P4 will pin a chat composer here and react to `selected`; P5 adds the ⤢ expand button. This phase is read-only (no editing/chat yet).

**Tech Stack:** Expo Router, Zustand, the in-app `Markdown` component, `useThemeColors`.

**Branch:** `feat/thesis-hierarchy-p0`.

**Verified facts:**
- `components/Markdown.tsx` exports `Markdown` with props `{ content: string; color?: string; direction?: "ltr"|"rtl" }`; renders headings/bold/lists/tables; uses `getTextDirection` for RTL. Lives at `@/components/Markdown`.
- `lib/text-direction.ts` exports `getTextDirection(text) => "ltr"|"rtl"`.
- `lib/api.ts`: `getThesis(id)` → full `Thesis` (`sections[].chapters[]`).
- `stores/thesis-store.ts`: `useThesisStore` with `theses`, `upsertThesis(thesis)`, `setCurrentThesis(id)`, `getCurrentThesis()`. Types from `@/types/thesis` (`Thesis`, `Section`, `Chapter`).
- `types/thesis.ts`: `Thesis.frontMatter?: ThesisFrontMatter`, `Thesis.resume?: ResumeBlock[]`, `Section.kind`, `Section.content?`, `Section.chapters[]`, `Chapter.content`.
- Theme tokens: `bgPrimary, bgSurface, bgCard, textPrimary, textSecondary, textPlaceholder, brandPrimary, brandPrimaryLight, borderDefault, borderSubtle`.
- `(app)` screens registered in `app/(app)/_layout.tsx`; navigation `router.push/replace({pathname, params})`, read `useLocalSearchParams`.
- The plan screen (P2) currently routes to `thesis-detail` with `params: { thesisId }`.

---

## Task 1: Store — `selected` + `refreshThesis`

**Files:** Modify `stores/thesis-store.ts`

- [ ] **Step 1:** Add to `ThesisState` (interface + impl):
```typescript
  selected: { sectionId: string | null; chapterId: string | null };
  selectChapter: (sectionId: string, chapterId: string) => void;
  selectSection: (sectionId: string) => void;
  clearSelection: () => void;
  refreshThesis: (id: string) => Promise<void>;
```
Implementation:
```typescript
  selected: { sectionId: null, chapterId: null },
  selectChapter: (sectionId, chapterId) => set({ selected: { sectionId, chapterId } }),
  selectSection: (sectionId) => set({ selected: { sectionId, chapterId: null } }),
  clearSelection: () => set({ selected: { sectionId: null, chapterId: null } }),
  refreshThesis: async (id) => {
    try { const { getThesis } = await import("@/lib/api"); const full = await getThesis(id); get().upsertThesis(full); }
    catch (e) { console.warn("refreshThesis failed", e); }
  },
```
- [ ] **Step 2:** tsc clean (only 8 known pre-existing errors). Commit:
```bash
git add stores/thesis-store.ts && git commit -m "feat(app/store): workspace selection state + refreshThesis"
```

---

## Task 2: `PaperPage` component

**Files:** Create `components/workspace/PaperPage.tsx`

- [ ] **Step 1:** Implement a white "page" card on the grey canvas with a subtle shadow, optional selected highlight, optional onPress:
```typescript
import { Pressable, View, StyleSheet, type ViewStyle } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

export function PaperPage({ children, onPress, selected, center }: { children: React.ReactNode; onPress?: () => void; selected?: boolean; center?: boolean; }) {
  const colors = useThemeColors();
  const inner = (
    <View style={[styles.page, { backgroundColor: "#FFFFFF", borderColor: selected ? colors.brandPrimary : "transparent", borderWidth: selected ? 2 : 0 }, center && styles.center]}>
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={styles.wrap}>{inner}</Pressable> : <View style={styles.wrap}>{inner}</View>;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 8 },
  page: { borderRadius: 6, padding: 20, minHeight: 120, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  center: { alignItems: "center", justifyContent: "center", minHeight: 320 },
});
```
(Pages are always white "paper" regardless of dark/light theme — they represent the printed document.)
- [ ] **Step 2:** tsc clean; commit:
```bash
git add components/workspace/PaperPage.tsx && git commit -m "feat(app): PaperPage card component for the workspace"
```

---

## Task 3: `ChapterCard` component (renders markdown)

**Files:** Create `components/workspace/ChapterCard.tsx`

- [ ] **Step 1:** Implement (renders the chapter title + its markdown content via the existing `Markdown` component; empty content shows a placeholder prompt). Text colors are dark (it's on white paper):
```typescript
import { Text, View, StyleSheet } from "react-native";
import { Markdown } from "@/components/Markdown";
import { getTextDirection } from "@/lib/text-direction";
import { PaperPage } from "./PaperPage";
import type { Chapter } from "@/types/thesis";

const INK = "#1A1A1A";
const MUTED = "#8A8A8A";

export function ChapterCard({ chapter, selected, onPress, emptyLabel }: { chapter: Chapter; selected?: boolean; onPress?: () => void; emptyLabel: string; }) {
  const dir = getTextDirection(chapter.title + " " + (chapter.content || ""));
  return (
    <PaperPage selected={selected} onPress={onPress}>
      <Text style={[styles.title, { color: INK, textAlign: dir === "rtl" ? "right" : "left", writingDirection: dir }]}>{chapter.title}</Text>
      {chapter.content?.trim()
        ? <Markdown content={chapter.content} color={INK} direction={dir} />
        : <Text style={[styles.empty, { color: MUTED, textAlign: dir === "rtl" ? "right" : "left" }]}>{emptyLabel}</Text>}
    </PaperPage>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10 },
  empty: { fontSize: 14, fontStyle: "italic", marginTop: 4 },
});
```
(If `Inter_700Bold` isn't the project's bold font token, match what other components use — check `components/Markdown.tsx` which uses `Inter_700Bold`.)
- [ ] **Step 2:** tsc clean; commit:
```bash
git add components/workspace/ChapterCard.tsx && git commit -m "feat(app): ChapterCard renders chapter markdown on a paper page"
```

---

## Task 4: The workspace screen

**Files:** Create `app/(app)/thesis-workspace.tsx`; register in `app/(app)/_layout.tsx`

- [ ] **Step 1:** Register `<Stack.Screen name="thesis-workspace" />`.
- [ ] **Step 2:** Implement `thesis-workspace.tsx`:
  - `const { thesisId } = useLocalSearchParams<{ thesisId: string }>();`
  - Resolve the thesis from the store (`useThesisStore((s) => s.theses.find((t) => t.id === thesisId))`); on mount call `useThesisStore.getState().refreshThesis(thesisId)` and `setCurrentThesis(thesisId)`. Show a loader until the thesis (with `sections`) is present.
  - Canvas background `colors.bgSurface` (grey). A top bar: BackButton + thesis title (+ a disabled placeholder ⤢ button for P5).
  - Render a `ScrollView` of pages in order:
    1. **Title page** — a `PaperPage center`: université / title / author / year from `thesis.frontMatter` (dark ink text). If no frontMatter, just the title.
    2. **Résumé page(s)** — if `thesis.resume?.length`, one `PaperPage` per resume block (label + body + keywords).
    3. For each **Section**: a **divider** `PaperPage center` showing the section title large + a `kind` sublabel (`t("wizard.kindSection")` etc.); if `section.content` present, render it via `Markdown`. Tapping the divider → `selectSection(section.id)`.
    4. For each **Chapter** in the section: a `ChapterCard` with `selected={selected.chapterId === chapter.id}`, `onPress={() => selectChapter(section.id, chapter.id)}`, `emptyLabel={t("workspace.emptyChapter", { defaultValue: "Tap the chat to ask the AI to draft this." })}`.
    5. **References** page if `thesis` has any (note: `getThesis` returns sections/chapters but references may not be in the payload — if not present, skip; references live server-side and appear in export. Only render if available on the thesis object).
  - Use `selected` from the store to highlight.
  - Empty state: if the thesis has no sections, show a friendly message.
- [ ] **Step 3:** tsc clean (only 8 known pre-existing). Commit:
```bash
git add "app/(app)/thesis-workspace.tsx" "app/(app)/_layout.tsx"
git commit -m "feat(app): document workspace screen (paper-card preview of the memoir)"
```

---

## Task 5: Route into the workspace

**Files:** Modify `app/(app)/thesis-plan.tsx` (Create handler) + `app/(app)/thesis-detail.tsx` (a "Open workspace" CTA)

- [ ] **Step 1:** In `thesis-plan.tsx`, change the post-create `router.replace` destination from `thesis-detail` to `thesis-workspace`:
```typescript
router.replace({ pathname: "/(app)/thesis-workspace", params: { thesisId: full.id } });
```
- [ ] **Step 2:** In `thesis-detail.tsx`, add a primary button "Open workspace" (or repurpose the existing "Continue in Chat" CTA) that routes to `router.push({ pathname: "/(app)/thesis-workspace", params: { thesisId } })`. Use `t("workspace.open", { defaultValue: "Open workspace" })`. Keep the existing detail view.
- [ ] **Step 3:** Add i18n keys to en/fr/ar: `"workspace": { "open": ..., "emptyChapter": ..., "titlePage": ..., "resume": ... }` (en: "Open workspace"/"Tap the chat to ask the AI to draft this."/"Title page"/"Abstract"; fr: "Ouvrir l'espace de travail"/"Touchez le chat pour demander à l'IA de rédiger ceci."/"Page de garde"/"Résumé"; ar: "فتح مساحة العمل"/"انقر على المحادثة لتطلب من الذكاء الاصطناعي كتابة هذا."/"صفحة الغلاف"/"ملخص"). Validate JSON.
- [ ] **Step 4:** tsc clean; commit:
```bash
git add "app/(app)/thesis-plan.tsx" "app/(app)/thesis-detail.tsx" locales/
git commit -m "feat(app): route plan-approval + thesis-detail into the workspace; i18n"
```

---

## Task 6: Verification
- [ ] **Step 1:** `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -vE "global.css|absoluteFillObject|ProviderSelector"` → no output (no new errors).
- [ ] **Step 2:** (Manual, user) Create a thesis via the wizard → lands on the workspace showing title page + section dividers + chapter cards; markdown (incl. a table) renders on the white pages; tapping a chapter highlights it.

## Definition of done (P3)
- `thesis-workspace.tsx` renders the memoir as paper pages (title, résumé, section dividers, chapter cards with markdown/tables), reading from the store + `refreshThesis`.
- Tapping a Section/Chapter sets `selected` (highlight) — wiring for P4's chat.
- Plan approval + thesis-detail route into the workspace.
- App type-checks (only pre-existing unrelated errors).

## Out of scope (P4/P5)
- The chat composer + live AI edits (P4) — the ⤢ button + A4 preview (P5). The workspace is read-only this phase.
