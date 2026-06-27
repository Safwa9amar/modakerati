# Workspace Composer Bottom Sheet — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed bottom composer in the thesis workspace with a single expandable gorhom `<BottomSheet>` (collapsed peek → drag up for tools) that shows live AI reasoning, renders the model's clarifying questions inline (removing the broken `AskBottomSheet`), and exposes the AI tools + quick-action presets in a tray.

**Architecture:** A persistent gorhom `BottomSheet` (the non-modal default export) pinned at the bottom of `thesis-workspace.tsx`, with two snap points: collapsed (chip + thinking box + input) and expanded (adds quick-actions + tools tray). It is composed of small presentational sub-components (`ComposerThinking`, `ComposerInput`, `ComposerQuickActions`, `ComposerToolsTray`, `ComposerAsk`) orchestrated by `WorkspaceComposerSheet`. Reasoning is already streamed by the server (`onThinking` → `message.thinking`); no server change in Phase 1.

**Tech Stack:** React Native (Expo SDK 56), TypeScript, `@gorhom/bottom-sheet` ^5.2.14, `react-native-reanimated` 4.3.1, `react-native-gesture-handler` ~2.31.1, Zustand stores, `react-i18next` (en/fr/ar), `lucide-react-native` icons.

---

## Verification reality (read first)

This project has **no test runner** (no jest / testing-library; `package.json` has no `test` script). Do **not** add one — that's out of scope. Every task's verification gate is:

1. **Compile gate:** `npx tsc --noEmit` must pass (the repo currently compiles clean — see commit `c3b6c7d "fix: resolve all TypeScript errors"`).
2. **Manual gate (final task only):** run the app on a **real iOS device** (the workspace's OnlyOffice/WebView path is unreliable on the simulator) via `npx expo start` and walk the checklist in Task 10.

Steps below therefore follow: **implement → `tsc` → commit**, instead of test-first.

## Pre-flight (do once before Task 1)

- [ ] Confirm the working tree. `git status` will show **pre-existing uncommitted edits** to `app/(app)/thesis-workspace.tsx`, `components/workspace/OnlyOfficeView.tsx`, `WordDocxView.tsx`, `WorkspaceComposer.tsx` (carried from the thesis-hierarchy branch). This plan replaces `WorkspaceComposer.tsx` and heavily edits `thesis-workspace.tsx`. **Read those two files first** and preserve any behavior in the uncommitted edits that this plan doesn't explicitly change. If unsure, ask the user before overwriting.
- [ ] Confirm `npx tsc --noEmit` is clean on the starting tree. Run: `npx tsc --noEmit`. Expected: no errors.

## File Structure

**New files** (all under `components/workspace/`):
- `WorkspaceComposerSheet.tsx` — the persistent sheet shell + orchestration + state. Exports `COMPOSER_COLLAPSED_HEIGHT` for the doc padding.
- `ComposerThinking.tsx` — model-thinking box (presentational).
- `ComposerInput.tsx` — text input + inline mic + send/stop (presentational).
- `ComposerQuickActions.tsx` — preset prompt chips (presentational).
- `ComposerToolsTray.tsx` — tools grid (presentational).
- `ComposerAsk.tsx` — inline model question (presentational).

**Modified files:**
- `stores/workspace-store.ts` — add `viewMode` + `thinkingEnabled` state and setters.
- `stores/bottom-sheet-store.ts` — drop `"ask"` from `SheetName`.
- `locales/en.json`, `locales/fr.json`, `locales/ar.json` — add the `composer.*` key block.
- `app/(app)/thesis-workspace.tsx` — mount the sheet, slim the top bar, remove the Ask bridge + `AskBottomSheet`, read `viewMode` from the store, pad the doc area.

**Deleted files:**
- `components/AskBottomSheet.tsx` (replaced by `ComposerAsk`).
- `components/workspace/WorkspaceComposer.tsx` (replaced by `WorkspaceComposerSheet`).

---

## Task 1: Shared state + i18n keys

**Files:**
- Modify: `stores/workspace-store.ts`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Add `viewMode` + `thinkingEnabled` to the workspace store**

In `stores/workspace-store.ts`, extend the interface, INITIAL, and creator. Full new file:

```typescript
import { create } from "zustand";

export type ActivePanel = "sources" | "outline" | null;
export type DocViewMode = "docx" | "outline";

interface WorkspaceState {
  thesisId: string | null;
  selectedBlockIndex: number | null;
  selectedBlockText: string | null;
  activePanel: ActivePanel;
  isFormatting: boolean;
  viewMode: DocViewMode;
  thinkingEnabled: boolean;

  setThesis: (id: string) => void;
  selectBlock: (index: number, text: string | null) => void;
  clearSelection: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  togglePanel: (panel: "sources" | "outline") => void;
  setFormatting: (v: boolean) => void;
  setViewMode: (mode: DocViewMode) => void;
  toggleViewMode: () => void;
  setThinkingEnabled: (v: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  thesisId: null as string | null,
  selectedBlockIndex: null as number | null,
  selectedBlockText: null as string | null,
  activePanel: null as ActivePanel,
  isFormatting: false,
  viewMode: "docx" as DocViewMode,
  thinkingEnabled: true,
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

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleViewMode: () => set({ viewMode: get().viewMode === "docx" ? "outline" : "docx" }),

  setThinkingEnabled: (v) => set({ thinkingEnabled: v }),

  reset: () => set(INITIAL),
}));
```

- [ ] **Step 2: Add the `composer.*` i18n block to `locales/en.json`**

Merge this object into the top-level JSON of `locales/en.json` (add a `"composer"` key alongside the existing top-level keys like `"workspace"`):

```json
"composer": {
  "status": {
    "ready": "Ready — ask me to write or edit this section.",
    "thinking": "Thinking…",
    "writing": "Writing…"
  },
  "toolsLabel": "Tools",
  "tools": {
    "sources": "Sources",
    "format": "Format",
    "outline": "Outline",
    "view": "View",
    "export": "Export",
    "regenerate": "Regenerate",
    "thinking": "Thinking"
  },
  "presets": {
    "expand": { "label": "Expand", "prompt": "Expand this section with more detail and supporting arguments." },
    "rephrase": { "label": "Rephrase", "prompt": "Rephrase this passage for clarity and an academic tone." },
    "cite": { "label": "Cite", "prompt": "Add a relevant citation to support this passage." },
    "summarize": { "label": "Summarize", "prompt": "Summarize this section concisely." },
    "improve": { "label": "Improve", "prompt": "Improve the clarity and flow of this passage." }
  },
  "voiceComingSoon": "Voice input is coming soon."
}
```

- [ ] **Step 3: Add the same block to `locales/fr.json`**

```json
"composer": {
  "status": {
    "ready": "Prêt — demandez-moi d'écrire ou de modifier cette section.",
    "thinking": "Réflexion…",
    "writing": "Rédaction…"
  },
  "toolsLabel": "Outils",
  "tools": {
    "sources": "Sources",
    "format": "Format",
    "outline": "Plan",
    "view": "Vue",
    "export": "Exporter",
    "regenerate": "Régénérer",
    "thinking": "Réflexion"
  },
  "presets": {
    "expand": { "label": "Développer", "prompt": "Développez cette section avec plus de détails et d'arguments." },
    "rephrase": { "label": "Reformuler", "prompt": "Reformulez ce passage pour plus de clarté et un ton académique." },
    "cite": { "label": "Citer", "prompt": "Ajoutez une citation pertinente pour appuyer ce passage." },
    "summarize": { "label": "Résumer", "prompt": "Résumez cette section de manière concise." },
    "improve": { "label": "Améliorer", "prompt": "Améliorez la clarté et la fluidité de ce passage." }
  },
  "voiceComingSoon": "La saisie vocale arrive bientôt."
}
```

- [ ] **Step 4: Add the same block to `locales/ar.json`**

```json
"composer": {
  "status": {
    "ready": "جاهز — اطلب مني كتابة هذا القسم أو تعديله.",
    "thinking": "جارٍ التفكير…",
    "writing": "جارٍ الكتابة…"
  },
  "toolsLabel": "الأدوات",
  "tools": {
    "sources": "المصادر",
    "format": "التنسيق",
    "outline": "المخطط",
    "view": "العرض",
    "export": "تصدير",
    "regenerate": "إعادة التوليد",
    "thinking": "التفكير"
  },
  "presets": {
    "expand": { "label": "توسيع", "prompt": "وسّع هذا القسم بمزيد من التفصيل والحجج الداعمة." },
    "rephrase": { "label": "إعادة صياغة", "prompt": "أعد صياغة هذه الفقرة لزيادة الوضوح وبأسلوب أكاديمي." },
    "cite": { "label": "توثيق", "prompt": "أضف استشهادًا مناسبًا لدعم هذه الفقرة." },
    "summarize": { "label": "تلخيص", "prompt": "لخّص هذا القسم بإيجاز." },
    "improve": { "label": "تحسين", "prompt": "حسّن وضوح هذه الفقرة وانسيابيتها." }
  },
  "voiceComingSoon": "الإدخال الصوتي قادم قريبًا."
}
```

- [ ] **Step 5: Verify compile + valid JSON**

Run: `npx tsc --noEmit && node -e "require('./locales/en.json');require('./locales/fr.json');require('./locales/ar.json');console.log('json ok')"`
Expected: no TS errors, prints `json ok`.

- [ ] **Step 6: Commit**

```bash
git add stores/workspace-store.ts locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(composer): add viewMode/thinkingEnabled state + composer i18n"
```

---

## Task 2: `ComposerThinking` — the model-thinking box

**Files:**
- Create: `components/workspace/ComposerThinking.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { GeneratingPhase } from "@/stores/chat-store";

interface Props {
  isGenerating: boolean;
  phase: GeneratingPhase;
  /** Live reasoning tokens for the streaming message (message.thinking). */
  thinking: string;
  /** Localized idle status line. */
  statusReady: string;
  thinkingLabel: string;
  writingLabel: string;
  rtl: boolean;
}

/**
 * The composer's "model thinking" box. Idle → a one-line muted status. While the
 * AI works → a labelled, scrollable stream of its reasoning (already sent by the
 * server between [[MODK_THINK]] markers → chat-store message.thinking).
 */
export function ComposerThinking({
  isGenerating,
  phase,
  thinking,
  statusReady,
  thinkingLabel,
  writingLabel,
  rtl,
}: Props) {
  const colors = useThemeColors();

  if (!isGenerating) {
    return (
      <View style={[styles.box, { backgroundColor: colors.bgSurface, borderColor: colors.borderSubtle }]}>
        <Text
          style={[styles.status, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}
          numberOfLines={1}
        >
          {statusReady}
        </Text>
      </View>
    );
  }

  const label = phase === "writing" ? writingLabel : thinkingLabel;

  return (
    <View style={[styles.box, { backgroundColor: colors.bgSurface, borderColor: colors.brandPrimary + "44" }]}>
      <View style={[styles.labelRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <ActivityIndicator size="small" color={colors.brandPrimary} />
        <Text style={[styles.label, { color: colors.brandPrimary }]}>{label}</Text>
      </View>
      {thinking ? (
        <BottomSheetScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.reason, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}>
            {thinking}
          </Text>
        </BottomSheetScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 2,
  },
  status: { fontSize: 12, fontFamily: "Inter_400Regular" },
  labelRow: { alignItems: "center", gap: 8, marginBottom: 4 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  scroll: { maxHeight: 140 },
  scrollContent: { paddingBottom: 2 },
  reason: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ComposerThinking.tsx
git commit -m "feat(composer): add ComposerThinking reasoning box"
```

---

## Task 3: `ComposerInput` — text input + mic + send/stop

**Files:**
- Create: `components/workspace/ComposerInput.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { View, Pressable, StyleSheet } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Send, Square, Mic } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  onMicPress: () => void;
  onFocus: () => void;
  isGenerating: boolean;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  micLabel: string;
}

/**
 * The composer's input row: a sheet-aware text input with an inline mic and a
 * send button that becomes a Stop button while the AI is generating.
 */
export function ComposerInput({
  value,
  onChangeText,
  onSend,
  onStop,
  onMicPress,
  onFocus,
  isGenerating,
  placeholder,
  sendLabel,
  stopLabel,
  micLabel,
}: Props) {
  const colors = useThemeColors();
  const hasText = value.trim().length > 0;

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.bgInput }]}>
      <BottomSheetTextInput
        style={[styles.input, { color: colors.textPrimary }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        editable={!isGenerating}
        multiline
        maxLength={2000}
      />
      {!isGenerating && (
        <Pressable
          onPress={onMicPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={micLabel}
          style={[styles.micBtn, { backgroundColor: colors.bgSurface }]}
        >
          <Mic size={16} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      )}
      {isGenerating ? (
        <AnimatedPressable
          entering={FadeIn.duration(150)}
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel={stopLabel}
          style={[styles.actionBtn, { backgroundColor: colors.semanticError }]}
        >
          <Square size={13} color="#FFFFFF" fill="#FFFFFF" />
        </AnimatedPressable>
      ) : hasText ? (
        <AnimatedPressable
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(100)}
          onPress={onSend}
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          style={[styles.actionBtn, { backgroundColor: colors.brandPrimary }]}
        >
          <Send size={16} color="#FFFFFF" strokeWidth={2} />
        </AnimatedPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 6,
  },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", maxHeight: 100, paddingVertical: 4 },
  micBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ComposerInput.tsx
git commit -m "feat(composer): add ComposerInput row with mic + send/stop"
```

---

## Task 4: `ComposerQuickActions` — preset prompt chips

**Files:**
- Create: `components/workspace/ComposerQuickActions.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Pressable, Text, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Preset keys map 1:1 to the composer.presets.* i18n entries. */
export const PRESET_KEYS = ["expand", "rephrase", "cite", "summarize", "improve"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

interface Props {
  /** Receives the localized prompt text to drop into the input. */
  onPreset: (prompt: string) => void;
}

/**
 * A horizontal row of quick-action chips. Tapping one hands its localized prompt
 * up to the composer, which fills (does NOT auto-send) the input so the student
 * can tweak it first.
 */
export function ComposerQuickActions({ onPreset }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {PRESET_KEYS.map((key) => (
        <Pressable
          key={key}
          onPress={() => onPreset(t(`composer.presets.${key}.prompt`))}
          style={[styles.chip, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
        >
          <Text style={[styles.chipText, { color: colors.textPrimary }]}>
            {t(`composer.presets.${key}.label`)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
```

> Note: `ScrollView` is imported from `react-native-gesture-handler` (not `react-native`) so horizontal scroll cooperates with the bottom sheet's pan gesture.

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ComposerQuickActions.tsx
git commit -m "feat(composer): add ComposerQuickActions preset chips"
```

---

## Task 5: `ComposerToolsTray` — tools grid

**Files:**
- Create: `components/workspace/ComposerToolsTray.tsx`

- [ ] **Step 1: Create the component**

Tools are passed as a config array from the parent so the tray stays presentational. `Edit block` is intentionally NOT here (Phase 3).

```tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { LucideIcon } from "lucide-react-native";

export interface ToolItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  /** Renders in the brand-accent "on" style (used by the Thinking toggle). */
  active?: boolean;
}

interface Props {
  label: string;
  tools: ToolItem[];
}

/** The expanded tray: a grid of labelled icon buttons. */
export function ComposerToolsTray({ label, tools }: Props) {
  const colors = useThemeColors();

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.textPlaceholder }]}>{label}</Text>
      <View style={styles.grid}>
        {tools.map((tool) => {
          const Icon = tool.icon;
          const tint = tool.active ? colors.semanticSuccess : colors.textSecondary;
          const bg = tool.active ? colors.semanticSuccess + "1A" : colors.bgSurface;
          const border = tool.active ? colors.semanticSuccess + "55" : colors.borderSubtle;
          return (
            <Pressable
              key={tool.key}
              onPress={tool.onPress}
              disabled={tool.disabled}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              style={[
                styles.tool,
                { backgroundColor: bg, borderColor: border, opacity: tool.disabled ? 0.4 : 1 },
              ]}
            >
              <Icon size={18} color={tint} strokeWidth={2} />
              <Text style={[styles.toolLabel, { color: tint }]} numberOfLines={1}>
                {tool.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12 },
  heading: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tool: {
    width: "22%",
    minWidth: 72,
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
});
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ComposerToolsTray.tsx
git commit -m "feat(composer): add ComposerToolsTray grid"
```

---

## Task 6: `ComposerAsk` — inline model question

**Files:**
- Create: `components/workspace/ComposerAsk.tsx`

This replaces `AskBottomSheet`. Same data shape (`AskPayload` from `@/types/chat`).

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { AskPayload } from "@/types/chat";

interface Props {
  ask: AskPayload;
  onAnswer: (answer: string) => void;
  rtl: boolean;
}

/**
 * The model's clarifying question, rendered inline inside the composer sheet
 * (replaces the standalone AskBottomSheet). Tapping an option answers
 * immediately; the free-text row (when allowed) submits typed answers.
 */
export function ComposerAsk({ ask, onAnswer, rtl }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [text, setText] = useState("");

  const submit = (answer: string) => {
    const a = answer.trim();
    if (a) onAnswer(a);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.question, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}>
        {ask.question}
      </Text>

      <View style={styles.options}>
        {ask.options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => submit(opt)}
            style={[styles.option, { backgroundColor: colors.bgCard, borderColor: colors.brandPrimary + "55" }]}
          >
            <Text style={[styles.optionText, { color: colors.textPrimary }]}>{opt}</Text>
          </Pressable>
        ))}
      </View>

      {ask.allowFreeText && (
        <View style={styles.inputRow}>
          <BottomSheetTextInput
            value={text}
            onChangeText={setText}
            placeholder={t("chat.typeYourOwn", { defaultValue: "Type your own…" })}
            placeholderTextColor={colors.textPlaceholder}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
            onSubmitEditing={() => submit(text)}
            returnKeyType="send"
          />
          <Pressable onPress={() => submit(text)} style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }]}>
            <Text style={styles.sendText}>{t("chat.send", { defaultValue: "Send" })}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, paddingTop: 4 },
  question: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1 },
  optionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12 },
  sendText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ComposerAsk.tsx
git commit -m "feat(composer): add ComposerAsk inline question"
```

---

## Task 7: `WorkspaceComposerSheet` — the persistent sheet shell

**Files:**
- Create: `components/workspace/WorkspaceComposerSheet.tsx`

This is the orchestrator. It owns input text, mounts the gorhom persistent `BottomSheet`, reads the chat/workspace stores, wires send/stop/regenerate/ask, builds the tools array, and auto-expands on focus / generation / pending-ask.

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Alert, Keyboard } from "react-native";
import GorhomBottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import {
  Paperclip,
  Paintbrush,
  ListTree,
  AlignLeft,
  Download,
  RotateCcw,
  Brain,
  X,
} from "lucide-react-native";
import { Text, Pressable } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, regenerateLastResponse } from "@/lib/ai-service";
import type { ChatMessage } from "@/types/chat";
import { ComposerThinking } from "./ComposerThinking";
import { ComposerInput } from "./ComposerInput";
import { ComposerQuickActions } from "./ComposerQuickActions";
import { ComposerToolsTray, type ToolItem } from "./ComposerToolsTray";
import { ComposerAsk } from "./ComposerAsk";

/** Height of the collapsed peek (the doc area pads its bottom by this). */
export const COMPOSER_COLLAPSED_HEIGHT = 210;

// Stable empty array so the messages selector never returns a fresh literal
// (zustand v5 Object.is → "Maximum update depth exceeded").
const EMPTY_MESSAGES: ChatMessage[] = [];

interface Props {
  thesisId: string;
  isLiveDoc: boolean;
  rtl: boolean;
  /** Live-doc only; undefined disables the Export tool. */
  downloadUrl?: string;
  onFormat: () => void;
  onOpenSources: () => void;
  onOpenOutline: () => void;
  onExport: () => void;
}

export function WorkspaceComposerSheet({
  thesisId,
  isLiveDoc,
  rtl,
  downloadUrl,
  onFormat,
  onOpenSources,
  onOpenOutline,
  onExport,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const sheetRef = useRef<GorhomBottomSheet>(null);

  // Select primitives individually (object/array literals loop the render).
  const blockText = useWorkspaceStore((s) => s.selectedBlockText);
  const docBlockIndex = useWorkspaceStore((s) => s.selectedBlockIndex);
  const isFormatting = useWorkspaceStore((s) => s.isFormatting);
  const thinkingEnabled = useWorkspaceStore((s) => s.thinkingEnabled);

  const isGenerating = useChatStore((s) => s.isGenerating);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const streamingId = useChatStore((s) => s.streamingId);
  const messages = useChatStore((s) => s.messages[thesisId] ?? EMPTY_MESSAGES);
  const pendingAsk = useChatStore((s) => s.pendingAsk);

  const [inputText, setInputText] = useState("");

  const snapPoints = useMemo(() => [COMPOSER_COLLAPSED_HEIGHT, "62%"], []);

  // Auto-expand when the AI starts working or asks a question.
  useEffect(() => {
    if (isGenerating || pendingAsk) sheetRef.current?.snapToIndex(1);
  }, [isGenerating, pendingAsk]);

  // Focus chip: tapped block, deep-linked block, or the whole memoir.
  const hasSelection = !!blockText || docBlockIndex != null;
  let chipLabel = t("workspace.wholeMemoir", { defaultValue: "Whole memoir" });
  if (blockText) {
    chipLabel = `✎ ${blockText.replace(/\s+/g, " ").trim().slice(0, 40)}`;
  } else if (docBlockIndex != null) {
    chipLabel = `✎ ${t("workspace.selectedBlock", { defaultValue: "Selected section" })}`;
  }

  const streamingMsg = streamingId ? messages.find((m) => m.id === streamingId) : undefined;
  const thinking = streamingMsg?.thinking ?? "";

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isGenerating) return;
    setInputText("");
    Keyboard.dismiss();
    await sendMessageToAI(thesisId, text, {
      selection: blockText ?? undefined,
      docBlockIndex: docBlockIndex ?? null,
    });
  };

  const handleAnswer = (answer: string) => {
    useChatStore.getState().setPendingAsk(null);
    void sendMessageToAI(thesisId, answer, {
      selection: blockText ?? undefined,
      docBlockIndex: docBlockIndex ?? null,
    });
  };

  const tools: ToolItem[] = [
    { key: "sources", label: t("composer.tools.sources"), icon: Paperclip, onPress: onOpenSources },
    { key: "format", label: t("composer.tools.format"), icon: Paintbrush, onPress: onFormat, disabled: isFormatting },
    { key: "outline", label: t("composer.tools.outline"), icon: ListTree, onPress: onOpenOutline },
    { key: "view", label: t("composer.tools.view"), icon: AlignLeft, onPress: () => useWorkspaceStore.getState().toggleViewMode(), disabled: !isLiveDoc },
    { key: "export", label: t("composer.tools.export"), icon: Download, onPress: onExport, disabled: !downloadUrl },
    { key: "regenerate", label: t("composer.tools.regenerate"), icon: RotateCcw, onPress: () => void regenerateLastResponse(thesisId), disabled: isGenerating },
    { key: "thinking", label: t("composer.tools.thinking"), icon: Brain, active: thinkingEnabled, onPress: () => useWorkspaceStore.getState().setThinkingEnabled(!thinkingEnabled) },
  ];

  return (
    <GorhomBottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose={false}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={{ backgroundColor: colors.bgPrimary }}
      handleIndicatorStyle={{ backgroundColor: colors.textPlaceholder }}
      style={styles.sheetShadow}
    >
      <BottomSheetView style={styles.content}>
        {/* Focus chip */}
        <View style={[styles.chipRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <View style={[styles.chip, { backgroundColor: colors.brandPrimaryLight + "22" }]}>
            <Text style={[styles.chipText, { color: colors.brandPrimary }]} numberOfLines={1}>
              {chipLabel}
            </Text>
            {hasSelection && (
              <Pressable
                onPress={() => useWorkspaceStore.getState().clearSelection()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("common.clear", { defaultValue: "Clear" })}
              >
                <X size={13} color={colors.brandPrimary} strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
        </View>

        {pendingAsk ? (
          <ComposerAsk ask={pendingAsk} onAnswer={handleAnswer} rtl={rtl} />
        ) : (
          <>
            <ComposerThinking
              isGenerating={isGenerating}
              phase={generatingPhase}
              thinking={thinking}
              statusReady={t("composer.status.ready")}
              thinkingLabel={t("composer.status.thinking")}
              writingLabel={t("composer.status.writing")}
              rtl={rtl}
            />
            <View style={styles.inputSpacer} />
            <ComposerInput
              value={inputText}
              onChangeText={setInputText}
              onSend={handleSend}
              onStop={() => useChatStore.getState().stopGenerating()}
              onMicPress={() => Alert.alert(t("composer.voiceComingSoon"))}
              onFocus={() => sheetRef.current?.snapToIndex(1)}
              isGenerating={isGenerating}
              placeholder={t("workspace.askPlaceholder", { defaultValue: "Ask the AI to write or edit…" })}
              sendLabel={t("chat.send", { defaultValue: "Send" })}
              stopLabel={t("chat.stop", { defaultValue: "Stop" })}
              micLabel={t("composer.tools.thinking")}
            />
            <ComposerQuickActions
              onPreset={(prompt) => {
                setInputText(prompt);
                sheetRef.current?.snapToIndex(1);
              }}
            />
            <ComposerToolsTray label={t("composer.toolsLabel")} tools={tools} />
          </>
        )}
      </BottomSheetView>
    </GorhomBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 8 },
  chipRow: { marginBottom: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "85%",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  chipText: { flexShrink: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  inputSpacer: { height: 8 },
  quickSpacer: { height: 8 },
});
```

> Notes for the implementer:
> - `micLabel` reuses an existing label only to avoid an extra key; change later if a dedicated "Microphone" label is added.
> - The `Mic` voice button is a deliberate **Phase 1 stub** (shows `composer.voiceComingSoon`). Real speech-to-text is a later sub-task.
> - `Brain` is the Thinking-toggle icon. In Phase 1 the toggle only flips `thinkingEnabled` in the store (it does not yet gate the model — that's Phase 2).

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors. (If `lucide-react-native` lacks an icon name, substitute a present one — e.g. `Sparkles` for `Brain` — and keep going.)

- [ ] **Step 3: Commit**

```bash
git add components/workspace/WorkspaceComposerSheet.tsx
git commit -m "feat(composer): add WorkspaceComposerSheet persistent sheet shell"
```

---

## Task 8: Integrate into the workspace + slim the top bar + remove the Ask bridge

**Files:**
- Modify: `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1: Swap imports**

In `app/(app)/thesis-workspace.tsx`, remove these imports:
```tsx
import { WorkspaceComposer } from "@/components/workspace/WorkspaceComposer";
import { AskBottomSheet } from "@/components/AskBottomSheet";
```
Add:
```tsx
import { WorkspaceComposerSheet, COMPOSER_COLLAPSED_HEIGHT } from "@/components/workspace/WorkspaceComposerSheet";
```
In the `lucide-react-native` import line, remove the now-unused `Maximize2`? **Keep `Maximize2`** (the slim top bar still uses it). Remove `Paperclip, Download, Paintbrush, ListTree, FileText, AlignLeft` ONLY IF they become unused after Step 3 — verify with `tsc` and delete the unused ones it flags.

- [ ] **Step 2: Read `viewMode` from the store instead of local state**

Remove the local view-mode state:
```tsx
const [viewMode, setViewMode] = useState<"docx" | "outline">("docx");
```
Replace with a store selector (add near the other workspace-store selectors):
```tsx
const viewMode = useWorkspaceStore((s) => s.viewMode);
```
Every existing `setViewMode((m) => ...)` call is removed in Step 3 (the toggle now lives in the tray). Leave the `viewMode === "outline" ? ... : ...` render branch untouched — it already reads the `viewMode` value.

- [ ] **Step 3: Slim the top bar**

In the top bar JSX, **delete** the Pressables for: the docx/outline view toggle, the outline toggle (`ListTree`), the format button (`Paintbrush`), the sources button (`Paperclip`), and the download button (`Download`). **Keep** `BackButton`, the title `Text`, and the `Maximize2` expand button (and its trailing empty `View` fallback). The slimmed top bar JSX is:

```tsx
{/* Top bar */}
<View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
  <BackButton />
  <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
    {title}
  </Text>
  {liveDoc ? (
    <Pressable
      onPress={() => {
        if (liveDoc.downloadUrl) Linking.openURL(liveDoc.downloadUrl).catch(() => {});
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t("preview.a4Title", { defaultValue: "A4 preview" })}
      style={styles.expandBtn}
    >
      <Maximize2 size={20} color={colors.textPrimary} />
    </Pressable>
  ) : (
    <View style={styles.expandBtn} />
  )}
</View>
```

Apply the **same** slim change to the early `if (!thesis)` loading return's top bar (it already only renders BackButton + title + an empty `expandBtn` spacer — leave that one as-is).

- [ ] **Step 4: Remove the pending-ask → sheet bridge effect**

Delete this effect entirely (the inline ask now lives in the composer):
```tsx
// Bridge the model's pending question (chat store) to the global sheet store...
useEffect(() => {
  if (pendingAsk) useBottomSheet.getState().openSheet("ask");
  else useBottomSheet.getState().closeSheet("ask");
}, [pendingAsk]);
```
`pendingAsk` is still selected at the top of the component — keep that selector ONLY if it's still used; after Step 6 it is no longer referenced here, so remove the `const pendingAsk = useChatStore((s) => s.pendingAsk);` line too. (`tsc`/unused-var will guide you.)

- [ ] **Step 5: Replace the composer mount + pad the doc area**

Find the block:
```tsx
{/* AI composer pinned at the bottom... */}
<View style={{ paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.bgPrimary }}>
  <WorkspaceComposer thesisId={thesisId} isLiveDoc={isLiveDoc} />
</View>
```
Delete it. The composer is no longer inside the `KeyboardAvoidingView`; it becomes an overlay sibling. Change the wrapper so the doc no longer needs keyboard avoidance: replace the `<KeyboardAvoidingView style={{ flex: 1 }} behavior={...}>...</KeyboardAvoidingView>` with a plain `<View style={{ flex: 1 }}>...</View>` (the sheet owns keyboard handling). Remove the now-unused `KeyboardAvoidingView` and `Platform` imports if `tsc` flags them.

Then, on the document scroll/render containers, add bottom padding so the collapsed sheet doesn't hide content. For the **outline** `ScrollView`, change its `contentContainerStyle`:
```tsx
<ScrollView
  contentContainerStyle={[styles.outlineContent, { paddingBottom: COMPOSER_COLLAPSED_HEIGHT + insets.bottom }]}
  showsVerticalScrollIndicator={false}
>
```
For the `OnlyOfficeView` / `WordDocxView` branches (WebViews that fill their parent), wrap each in a `View` with `style={{ flex: 1, paddingBottom: COMPOSER_COLLAPSED_HEIGHT + insets.bottom }}` so the WebView isn't overlapped by the peek. (If a WebView must stay full-bleed, instead add the padding to its container — verify on device in Task 10 and adjust.)

- [ ] **Step 6: Mount the sheet + remove the AskBottomSheet block**

After the closing tag of the doc wrapper `View` (the old `KeyboardAvoidingView`), and before `<SourcesSheet .../>`, mount:
```tsx
<WorkspaceComposerSheet
  thesisId={thesisId}
  isLiveDoc={isLiveDoc}
  rtl={docRtl}
  downloadUrl={liveDoc?.downloadUrl}
  onFormat={handleFormat}
  onOpenSources={() => useBottomSheet.getState().openSheet("thesis-sources")}
  onOpenOutline={handleOutlineToggle}
  onExport={() => {
    if (liveDoc?.downloadUrl) Linking.openURL(liveDoc.downloadUrl).catch(() => {});
  }}
/>
```
Delete the entire `{pendingAsk && (<AskBottomSheet ... />)}` block at the bottom of the screen.

- [ ] **Step 7: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any unused-import errors it surfaces by removing the dead imports named above.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/thesis-workspace.tsx
git commit -m "feat(composer): mount expandable composer sheet, slim top bar, drop ask bridge"
```

---

## Task 9: Delete dead files + drop the `"ask"` sheet name

**Files:**
- Delete: `components/AskBottomSheet.tsx`
- Delete: `components/workspace/WorkspaceComposer.tsx`
- Modify: `stores/bottom-sheet-store.ts`

- [ ] **Step 1: Confirm nothing else references them**

Run: `grep -rn "AskBottomSheet\|WorkspaceComposer\b\|openSheet(\"ask\")\|has(\"ask\")\|closeSheet(\"ask\")" app components stores lib --include=*.ts --include=*.tsx`
Expected: only the definitions themselves (and the `WorkspaceComposerSheet` name, which is fine). If anything else references the old names, stop and fix that reference first.

- [ ] **Step 2: Remove `"ask"` from the sheet-name union**

In `stores/bottom-sheet-store.ts` change:
```typescript
export type SheetName = "structure" | "ask" | "new-thesis" | "thesis-sources";
```
to:
```typescript
export type SheetName = "structure" | "new-thesis" | "thesis-sources";
```

- [ ] **Step 3: Delete the dead files**

Run:
```bash
git rm components/AskBottomSheet.tsx components/workspace/WorkspaceComposer.tsx
```

- [ ] **Step 4: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add stores/bottom-sheet-store.ts
git commit -m "chore(composer): remove AskBottomSheet + legacy WorkspaceComposer"
```

---

## Task 10: On-device verification

**Files:** none (manual).

- [ ] **Step 1: Launch on a real iOS device**

Run: `npx expo start` and open on a physical device (simulator is unreliable for the OnlyOffice/WebView doc path).

- [ ] **Step 2: Walk the checklist**

- [ ] Opening a thesis shows the **collapsed** composer (handle + chip + "Ready…" status + input) pinned at the bottom; the document's last lines are not hidden behind it.
- [ ] Dragging the handle up reveals the **quick-actions** row + **tools** grid; dragging down returns to the peek; it never fully disappears.
- [ ] Tapping the input lifts the sheet above the keyboard; typing + send streams a reply.
- [ ] During generation the thinking box shows **"Thinking…"** then **"Writing…"** with streaming reasoning text; the send button becomes **Stop**, and Stop aborts while keeping partial output.
- [ ] Tap each tool: **Sources** opens the sources sheet, **Format** runs formatting, **Outline** opens the structure sheet, **View** toggles docx⟷outline, **Export** opens the .docx, **Regenerate** re-runs the last reply, **Thinking** toggles its on/off (brand-accent) state.
- [ ] A quick-action chip fills the input with its prompt (does not auto-send).
- [ ] The **mic** button shows the "coming soon" alert.
- [ ] Trigger a model question (a prompt that makes the AI ask) → the question + option chips render **inside the sheet**; tapping an option (or typing + Send) answers and continues. **If no question ever appears,** verify the server emits `[[MODK_ASK]]` (log `onAsk` in `lib/ai-service.ts`); a missing ask frame is a server task, not this UI.
- [ ] Open an **Arabic** thesis: the chip, thinking text, and any inline question render right-aligned.
- [ ] No red-box "Maximum update depth exceeded" at any point.

- [ ] **Step 3: Note any device-only adjustments**

If the collapsed height clips the input or the doc padding is off, tune `COMPOSER_COLLAPSED_HEIGHT` in `WorkspaceComposerSheet.tsx` and the matching `paddingBottom` in the workspace, then re-verify. Commit any tweak:
```bash
git add -A && git commit -m "fix(composer): tune collapsed height / doc padding from device check"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** persistent sheet + snaps (T7/T8) · thinking box reasoning+status (T2/T7) · inline ask removing AskBottomSheet (T6/T8/T9) · tools tray with Sources/Format/Outline/View/Export/Regenerate/Thinking (T5/T7) · quick-actions (T4/T7) · voice button stub (T3/T7) · top-bar slim (T8) · viewMode/thinkingEnabled state (T1) · RTL handling (T2/T6/T7). Phase 2 (server thinking gate) and Phase 3 (edit-block route) are intentionally out of this plan, per the spec's phasing.
- **Placeholder scan:** every code step contains full code; no TBD/TODO.
- **Type consistency:** `COMPOSER_COLLAPSED_HEIGHT`, `ToolItem`, `PresetKey`/`PRESET_KEYS`, `DocViewMode`, and the `composer.*` i18n keys are used with identical names across tasks. `GeneratingPhase` is imported from `chat-store` where defined.

## Known risks carried from the spec

- gorhom keyboard handling on a **persistent** (non-modal) sheet is fiddlier than on a modal — Task 10 Step 3 is the tuning valve.
- The persistent composer sheet and the modal sheets (Sources/Outline) must coexist; verify layering in Task 10 (modals should appear above the composer).
- The inline ask is only as good as the `onAsk` data — Task 10 calls out verifying the server actually emits the question.
