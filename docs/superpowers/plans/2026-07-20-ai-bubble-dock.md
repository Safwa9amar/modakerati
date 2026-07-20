# AI Bubble + Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Always-on ✦ AI bubble: never auto-closes; at count===0 expands to an AI dock (fixed chips run immediately, suggested chips, on-demand inline prompt input that lifts above the keyboard); legacy bottom AI inputs removed (fallback returns only after drag-to-X dismiss).

**Spec:** `docs/superpowers/specs/2026-07-20-ai-bubble-dock-design.md`
**Verification:** `npx tsc --noEmit` per task (~2min; ignore parallel-session errors in untouched files). Device QA at the end.
**Git:** exact-path adds, fresh commits, never --amend; report bundled parallel WIP.

---

### Task 1: store — `inputOpen`

**Files:** Modify `stores/floating-pill-store.ts`.

- [ ] Add `inputOpen: boolean` (default false) + `setInputOpen: (v: boolean) => void` to the interface and creator (`setInputOpen: (v) => set({ inputOpen: v })`). `hide()` gains `inputOpen: false`; `reset()` gains `inputOpen: false`. Doc comment: "The dock's inline Ask input (variant: on-demand). Opened by the Ask… chip or the pill's ✦; closed on send/hide/reset."
- [ ] `npx tsc --noEmit` clean → `git add stores/floating-pill-store.ts && git commit -m "feat(workspace): floating-pill store — inline Ask input state"`

---

### Task 2: `components/workspace/AIDock.tsx` (new)

The AI-mode expanded panel (Dock layout A + input-on-demand). VERIFY all imports/signatures against the actual files before writing (`lib/ai-service.ts` `sendMessageToAI`, `lib/api.ts` `getComposerSuggestions` + `ComposerSuggestion` type, `stores/chat-store.ts` `isGenerating`, theme tokens via `useThemeColors`, i18n via `useTranslation` with defaultValue convention, `AnimatedChip` for press feedback, motion presets from `lib/motion.ts`).

**Structure (props: `{ thesisId: string; rtl: boolean; scopeLabel: string; scopeIndices: number[] }`):**

- [ ] **Fixed chips row** (always): four AnimatedChip-based chips with icon+label —
  Summarize `t("aiDock.summarize", {defaultValue: "Summarize"})` → prompt "Summarize the current state of this thesis and its chapters.";
  Improve `aiDock.improve`/"Improve writing" → "Review the writing quality and improve weak passages.";
  Format `aiDock.format`/"Fix formatting" → "Check and fix formatting/numbering/layout issues in the document.";
  Translate `aiDock.translate`/"Translate" → "Help me translate parts of this thesis.".
  Tapping a chip: `void sendMessageToAI(...)` with the canned prompt (match the real signature — read how BlockComposer/chat sends and mirror; include scopeIndices when non-empty), then `useFloatingPillStore.getState().setExpanded(false)` (collapse; the bubble spinner takes over).
- [ ] **Suggested section:** on mount (and when scopeIndices change), `getComposerSuggestions(thesisId, { docBlockIndices: scopeIndices.length ? scopeIndices : undefined }, abortSignal)` with an AbortController aborting superseded fetches (mirror the existing pattern — grep `getComposerSuggestions` usages). While loading show 2 shimmer skeleton bars (reanimated withRepeat opacity); on result render suggestion chips (tap = send its prompt/text via the same send path); on empty/error hide the whole section (server convention: empty array on failure).
- [ ] **Ask… chip → inline input (on demand):** a brand-filled chip; tapping sets `setInputOpen(true)`. When `inputOpen` (from the store): render instead an input row — scope tag (small pill: `scopeLabel`), `TextInput` (autoFocus, `keyboardShouldPersistTaps` handled by parent, placeholder `t("aiDock.askPlaceholder", {defaultValue: "Ask the AI…"})`, multiline false), send button (disabled when empty). Send: `void sendMessageToAI(...)` with the typed text (+ scopeIndices), clear text, `setInputOpen(false)`, `setExpanded(false)`, `Keyboard.dismiss()`.
- [ ] Styling mirrors the dark pill language (bgPrimary panel, chip borders, brand accents) via useThemeColors; rows `flexDirection: rtl ? "row-reverse" : "row"`; entering animations via `chipIn(i)` staggers.
- [ ] `npx tsc --noEmit` clean → `git add components/workspace/AIDock.tsx && git commit -m "feat(workspace): AIDock — quick actions, suggested chips, on-demand inline Ask input"`

---

### Task 3: FloatingPill integration

**Files:** Modify `components/workspace/FloatingPill.tsx`.

- [ ] **Always-on:** replace the spawn-on-selection effect with mount-time show: `useEffect(() => { useFloatingPillStore.getState().show(); }, []);` (visible persists; drag-to-X still the only close). Keep the comment explaining persistence.
- [ ] **Suppression:** remove `count === 0` from `suppressed` (keep `aiGateActive || soleSuggested || !composerOpen || previewMode != null`; `askAiOpen` term: remove it too IF nothing else can set askAiOpen anymore after Task 4 — VERIFY with grep; if other setters remain (e.g. chat flows), keep the term).
- [ ] **Mode render:** `count === 0` → Bubble icon becomes ✦ (Sparkles); expanded renders `<AIDock thesisId rtl scopeLabel scopeIndices={indices} />` instead of BlockContextBar. `count > 0` → existing behavior. Bubble's adaptive icon fn gains the sparkles case for count===0.
- [ ] **Pill ✦ → inline input:** BlockContextBar's `onAskAI` prop (floating instance only) becomes `() => { useFloatingPillStore.getState().setInputOpen(true); }` — and when `inputOpen` is true in block mode, render the AIDock (with block scopeLabel/indices) INSTEAD of BlockContextBar so the input is available with block scope. (Simplest: `expanded && (count === 0 || inputOpen) ? <AIDock/> : <BlockContextBar/>`.)
- [ ] **Keyboard lift:** when `inputOpen && keyboardHeight > 0`, ensure the dock sits above the keyboard: add an effect on `[keyboardHeight, inputOpen]` that computes `const limit = height - keyboardHeight - DOCK_CLEARANCE; if (ty.value > limit) ty.value = withSpring(limit, SPRING);` with `DOCK_CLEARANCE ≈ 220` (panel height + margin; tune constant). Also keep the existing `dismissBottom` behavior.
- [ ] **Working spinner:** subscribe `const busy = useChatStore((s) => s.isGenerating);` and when busy, spin the bubble's icon (wrap icon in Animated.View with withRepeat rotate while busy; stop on unmount/not-busy).
- [ ] `npx tsc --noEmit` clean → `git add components/workspace/FloatingPill.tsx && git commit -m "feat(workspace): always-on AI bubble — AI dock mode, inline input, keyboard lift, busy spin"`

---

### Task 4: legacy input removal (BlockComposer)

**Files:** Modify `components/workspace/BlockComposer.tsx` (⚠️ carries parallel-session WIP — read current state first, report bundling).

- [ ] Gate the two legacy input surfaces on the floating pill being DISMISSED: read `const pillAlive = useFloatingPillStore((s) => s.visible);` —
  - the whole-memoir IdleAIBar branch (count===0) renders only when `!pillAlive`;
  - the askAiOpen block-scoped input branch renders only when `!pillAlive` (with pill alive, ✦ routes to the dock input instead).
  Keep: docked BlockContextBar (keyboard form), pendingAsk/pendingConfirm gate surfaces, insets logic (hasSurface should treat the suppressed branches as no-surface when pillAlive — trace `hasSurface` and adjust so the composer doesn't reserve inset space for bars it no longer shows).
- [ ] `npx tsc --noEmit` clean → `git add components/workspace/BlockComposer.tsx && git commit -m "feat(workspace): legacy AI inputs yield to the AI bubble (fallback only when dismissed)"`

---

### Task 5: reviews + device QA

- [ ] Final integration review (whole feature) then device QA: always-on lifecycle (enter workspace → ✦ bubble; keyboard dismiss ≠ close; drag-to-X → legacy bar fallback returns); AI dock chips fire the chat (confirm gate intact); suggested chips shimmer→load or hide; Ask… input above the keyboard (type + send, dock collapses, bubble spins); pill ✦ opens block-scoped input; RTL; Reduce Motion.
