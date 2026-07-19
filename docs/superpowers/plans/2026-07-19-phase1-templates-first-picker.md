# Phase 1 — Templates-First Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's "Choose a template" screen list the **uploaded `.docx` templates** (with PDF preview) as the primary choice, tapping through to the existing preview → "Use template" flow, while keeping norm profiles as a fallback.

**Architecture:** App-only change (Expo, `~/modakerati`). The store already exposes `templates` + `loadTemplates()` (active-only from `GET /api/templates`) and `normProfiles` + `loadNormProfiles()`. `template-picker.tsx` switches its primary list to `templates`, adds a template card (thumbnail + PDF tag), routes taps to `template-preview?templateId=`, and shows norm profiles only as a fallback (bottom link, or automatically when there are zero templates). No server/dashboard change; reuses `template-preview.tsx` unchanged.

**Tech Stack:** React Native / Expo SDK 56, expo-router, react-i18next, Zustand (`useThesisStore`, `useThesisWizard`), `useThemeColors`.

**Scope:** Phase 1 of the spec `docs/superpowers/specs/2026-07-19-templates-first-picker-design.md`. Phase 2 (variable filling) is server-gated and NOT in this plan.

**Verification model:** the app has **no JS test runner** — the gate is `npx tsc --noEmit` + running the app. Do NOT add jest/tests. Each task ends with tsc + a manual-run check.

**Repo hygiene:** the app working tree has **unrelated chat WIP** (`chat.tsx`, `lib/ai-service.ts`, `lib/api.ts`, `lib/chat-cache.ts`, `stores/chat-store.ts`, `WordDocxView.tsx`). **Stage only the files this plan touches — never `git add -A`.**

---

## File Structure

- **Modify** `app/(app)/template-picker.tsx` — the whole screen refactor (list templates; template card; filters on the active list; tap → preview; norm-profile fallback). This is the only substantive file.
- **Modify** `locales/en.json`, `locales/fr.json`, `locales/ar.json` — add the fallback + card strings (aligned).
- **Reuse unchanged:** `stores/thesis-store.ts` (`loadTemplates`/`loadNormProfiles` already exist), `types/thesis.ts` (`Template` already has the fields), `app/(app)/template-preview.tsx` (already handles `templateId`).

---

## Task 1: Load templates + add the templates/profiles mode

**Files:** `app/(app)/template-picker.tsx`

- [ ] **Step 1: Load both lists on mount; read templates from the store**

Replace the current data hookup (which only reads `normProfiles`/`loadNormProfiles`) so the screen reads BOTH and loads BOTH on mount:

```tsx
const templates = useThesisStore((s) => s.templates);
const normProfiles = useThesisStore((s) => s.normProfiles);
const [loading, setLoading] = useState(true);

useEffect(() => {
  setLoading(true);
  const store = useThesisStore.getState();
  Promise.all([store.loadTemplates(), store.loadNormProfiles()]).finally(() =>
    setLoading(false),
  );
}, []);
```

- [ ] **Step 2: Add the mode + derived "show profiles" logic**

Add state and a derived flag. Profiles are shown when the user opted in via the fallback link OR there are zero templates after load:

```tsx
const [showProfiles, setShowProfiles] = useState(false);
const profilesMode = showProfiles || (!loading && templates.length === 0);
```

Add the `Template` import: `import type { Template, NormProfile } from "@/types/thesis";` (keep `NormProfile`).

- [ ] **Step 3: Verify tsc**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors in `template-picker.tsx` (there will be temporary "unused" warnings for the new pieces until later steps use them — resolve by the end of Task 4; a clean final tsc is the gate). Pre-existing errors in the chat WIP files are not yours.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati && git add "app/(app)/template-picker.tsx" && git commit -m "feat(picker): load templates + norm profiles; add profiles-fallback mode"
```

---

## Task 2: Template cards + tap → preview

**Files:** `app/(app)/template-picker.tsx`

- [ ] **Step 1: Filter the active list**

Compute the filtered list from whichever list is active (templates by default, profiles in fallback). Both `Template` and `NormProfile` have `university`, `discipline`, `language`:

```tsx
const filteredTemplates = useMemo(
  () =>
    templates.filter((tpl) => {
      if (universityFilter && tpl.university !== universityFilter) return false;
      if (disciplineFilter && tpl.discipline !== disciplineFilter) return false;
      if (languageFilter && tpl.language !== languageFilter) return false;
      return true;
    }),
  [templates, universityFilter, disciplineFilter, languageFilter],
);

const filteredProfiles = useMemo(
  () =>
    normProfiles.filter((p) => {
      if (universityFilter && p.university !== universityFilter) return false;
      if (disciplineFilter && p.discipline !== disciplineFilter) return false;
      if (languageFilter && p.language !== languageFilter) return false;
      return true;
    }),
  [normProfiles, universityFilter, disciplineFilter, languageFilter],
);
```

- [ ] **Step 2: Template select handler → preview route**

```tsx
const handleSelectTemplate = (tpl: Template) => {
  router.push(`/(app)/template-preview?templateId=${tpl.id}` as any);
};
```
(The existing `handleSelect(profile)` for norm profiles stays for the fallback list.)

- [ ] **Step 3: Render the template card**

In the scroll body, when NOT in `profilesMode`, render the filtered templates. Each card mirrors the existing profile card but adds a doc thumbnail + a "PDF" tag when `tpl.config.pdfUrl` exists:

```tsx
{!loading && !profilesMode &&
  filteredTemplates.map((tpl) => (
    <Pressable
      key={tpl.id}
      onPress={() => handleSelectTemplate(tpl)}
      style={[styles.profileCard, { backgroundColor: colors.bgCard, borderColor: colors.brandPrimary + "33" }]}
    >
      <View style={styles.docThumb} />
      <View style={styles.profileContent}>
        <View style={styles.nameRow}>
          <Text style={[styles.profileName, { color: colors.textPrimary }]} numberOfLines={2}>
            {tpl.name}
          </Text>
          {tpl.config.pdfUrl ? (
            <View style={[styles.pdfTag, { backgroundColor: colors.semanticSuccess + "22" }]}>
              <Text style={[styles.pdfTagText, { color: colors.semanticSuccess }]}>PDF</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.badgeRow}>
          <Badge icon={GraduationCap} label={tpl.university ?? t("wizard.allUniversities")} colors={colors} />
          <Badge icon={BookOpen} label={disciplineLabel(tpl.discipline)} colors={colors} />
        </View>
        <View style={styles.badgeRow}>
          <Badge icon={Globe} label={languageLabel(tpl.language)} colors={colors} />
          <Badge icon={FileText} label={citationLabel(tpl.citationStyle)} colors={colors} />
        </View>
      </View>
      <ChevronRight size={18} color={colors.textSecondary} strokeWidth={2} style={styles.profileChevron} />
    </Pressable>
  ))}
```

- [ ] **Step 4: Add the new styles**

Add to the `StyleSheet.create({...})`:

```tsx
docThumb: {
  width: 34, height: 44, borderRadius: 5, backgroundColor: "#FFFFFF",
  shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.25, shadowRadius: 3, elevation: 2,
},
nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
pdfTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
pdfTagText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
```
(The template card reuses `styles.profileCard`, `profileContent`, `badgeRow`, `profileName`, `profileChevron`.)

- [ ] **Step 5: Verify tsc + run**

Run: `cd ~/modakerati && npx tsc --noEmit` → clean for this file.
Manual run (`npm start`): open "Choose a template" — it now lists the uploaded templates (name + badges + white thumbnail; a green PDF tag on those with a PDF). Tapping one opens `template-preview` for that template (shows its PDF via the Preview button).

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati && git add "app/(app)/template-picker.tsx" && git commit -m "feat(picker): template cards (thumbnail + PDF tag) → template-preview"
```

---

## Task 3: Filters on the active list + header title

**Files:** `app/(app)/template-picker.tsx`

- [ ] **Step 1: Feed the FilterRow from the active list**

`FilterRow` builds its `universities` option list from the `profiles` prop. Pass the ACTIVE list so university options match what's shown. Change the `FilterRow` prop name usage minimally: pass `profiles={profilesMode ? normProfiles : templates}` (both have `university`, so the existing `universities` `useMemo` works unchanged — `FilterRow`'s type can widen to `{ university?: string | null }[]`).

Update `FilterRow`'s prop type from `profiles: NormProfile[]` to:
```tsx
profiles: Array<{ university: string | null }>;
```
(Both `Template.university: string` and `NormProfile.university: string | null` satisfy this; `Template.university` is non-null so it's assignable.)

- [ ] **Step 2: Keep the header title**

Leave `t("wizard.pickTemplate")` as the title (still "Choose a template"). No change.

- [ ] **Step 3: Verify tsc + run**

`npx tsc --noEmit` clean. Run: the filter chips (university/discipline/language) filter the template list; switching to profiles fallback filters profiles. University options reflect the active list.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati && git add "app/(app)/template-picker.tsx" && git commit -m "feat(picker): filters operate on the active (templates/profiles) list"
```

---

## Task 4: Norm-profile fallback + empty states + i18n

**Files:** `app/(app)/template-picker.tsx`, `locales/{en,fr,ar}.json`

- [ ] **Step 1: Render the norm-profile fallback list when in profilesMode**

When `profilesMode`, render the EXISTING profile cards (the current `filtered.map(...)` block, now `filteredProfiles.map(...)` calling `handleSelect`). Above them, a small "Back to templates" link when templates exist:

```tsx
{!loading && profilesMode && (
  <>
    {templates.length > 0 && (
      <Pressable onPress={() => setShowProfiles(false)} style={styles.fallbackLink}>
        <ChevronRight size={14} color={colors.brandPrimary} style={{ transform: [{ rotate: "180deg" }] }} />
        <Text style={[styles.fallbackLinkText, { color: colors.brandPrimary }]}>{t("wizard.backToTemplates")}</Text>
      </Pressable>
    )}
    {filteredProfiles.map((profile) => (
      /* the existing norm-profile <Pressable> card, unchanged, onPress={() => handleSelect(profile)} */
    ))}
  </>
)}
```

- [ ] **Step 2: The "start with a formatting profile" link (templates mode)**

At the bottom of the templates list (when NOT profilesMode and templates exist), a link to switch to profiles:

```tsx
{!loading && !profilesMode && (
  <Pressable onPress={() => setShowProfiles(true)} style={styles.fallbackLink}>
    <Text style={[styles.fallbackLinkText, { color: colors.textSecondary }]}>{t("wizard.orFormattingProfile")}</Text>
  </Pressable>
)}
```

- [ ] **Step 3: Empty states**

- Templates mode, filters match nothing: `{!loading && !profilesMode && filteredTemplates.length === 0 && templates.length > 0 && <Text …>{t("wizard.noTemplatesMatch")}</Text>}`
- Profiles mode, filters match nothing: the existing "No profiles match these filters" → move to `t("wizard.noProfilesMatch")`.
- Nothing loaded at all (0 templates AND 0 profiles): the Blank card is always present, so it's never a dead end; optionally a `t("wizard.noneYet")` note.

- [ ] **Step 4: Add the fallback-link styles**

```tsx
fallbackLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
fallbackLinkText: { fontSize: 13, fontFamily: "Inter_500Medium" },
```

- [ ] **Step 5: Add i18n keys (all three locales, aligned)**

Add under the existing `wizard` namespace in `locales/en.json`, `fr.json`, `ar.json`:
- `orFormattingProfile` — en "No template fits? Start with a formatting profile" · fr "Aucun modèle ne convient ? Commencer avec un profil de mise en forme" · ar "لا يوجد قالب مناسب؟ ابدأ بملف تنسيق"
- `backToTemplates` — en "← Back to templates" · fr "← Retour aux modèles" · ar "← العودة إلى القوالب"
- `noTemplatesMatch` — en "No templates match these filters." · fr "Aucun modèle ne correspond à ces filtres." · ar "لا توجد قوالب تطابق هذه المرشحات."
- `noProfilesMatch` — en "No profiles match these filters." · fr "Aucun profil ne correspond à ces filtres." · ar "لا توجد ملفات تطابق هذه المرشحات."

(Confirm the three files stay key-aligned for the `wizard` namespace.)

- [ ] **Step 6: Verify tsc + run**

`cd ~/modakerati && npx tsc --noEmit` → fully clean for `template-picker.tsx` (no unused vars left). Run the app:
- With active templates: picker shows templates; bottom link → switches to formatting profiles; "Back to templates" returns.
- Simulate zero templates (or point at an env with none): picker auto-shows profiles (never empty).
- Filters + Blank + i18n (fr/ar, RTL) all work.

- [ ] **Step 7: Commit**

```bash
cd ~/modakerati && git add "app/(app)/template-picker.tsx" locales/en.json locales/fr.json locales/ar.json && git commit -m "feat(picker): norm-profile fallback (link + zero-template) + i18n"
```

---

## Self-Review

**Spec coverage** (spec §4, Phase 1):
- §4.1 list active uploaded templates + thumbnail + PDF tag + filters + Blank → Tasks 1-3. ✅
- §4.2 tap → `template-preview?templateId=` → "Use template" (reused) → create-from-docx → Task 2. ✅
- §4.3 norm profiles: bottom fallback link + zero-template fallback + `norm_profile_id` untouched on template path → Task 4. ✅
- §4.4 files (`template-picker.tsx`, store reuse, `Template` type reuse, i18n, `template-preview` unchanged) → matches. ✅

**Placeholder scan:** No TBD/TODO; each step has concrete code + a tsc/run check. The one "existing profile card, unchanged" reference in Task 4 Step 1 points at the current `filtered.map` card body already in the file — reproduce it verbatim with `filteredProfiles` + `handleSelect`. ✅

**Type consistency:** `handleSelectTemplate(tpl: Template)` and `handleSelect(profile: NormProfile)` are distinct; `filteredTemplates`/`filteredProfiles` typed to their lists; `FilterRow.profiles` widened to `{ university: string | null }[]` (satisfied by both). `Template.config.pdfUrl` is the optional field added this session. ✅

**Note:** verification is `tsc --noEmit` + running the app (no test runner). Pre-existing tsc errors in the chat-WIP files are not introduced by this plan; confirm `template-picker.tsx` itself is error-free.
