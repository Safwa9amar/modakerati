# Document History + AI Confirm UI (App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Header undo/redo arrows, a one-tap "Undo AI changes" chip, a version-history sheet, and Approve/Cancel chips for gated destructive AI actions — wired to the server endpoints from the two server plans.

**Architecture:** New frames (`[[MODK_CONFIRM]]`, `[[MODK_DOCCHANGES]]`) parse in the existing chat-stream pump; `pendingConfirm`/`lastDocChanges` live in the chat store beside `pendingAsk`; restores apply through the doc store's existing `setDoc`+`drainTick` refresh machinery (never a parallel path — this branch's WordDocxView `__refresh` pipeline keys off those). Undo is disabled while queue ops are pending.

**Tech Stack:** Expo v56 (READ https://docs.expo.dev/versions/v56.0.0/ before writing code — project mandate), Zustand, gorhom bottom-sheet v5, react-i18next (en/fr/ar), lucide-react-native. Repo: `/Users/hamzasafwan/modakerati`.

**Verification:** The app has NO JS test runner. Gate every task with `npx tsc --noEmit` + running the app. Server plans 1+2 must be deployed to the dev server first.

**Zustand rule:** select primitives individually — never return a fresh object/array from a selector (update-depth loop).

**Spec:** `docs/superpowers/specs/2026-07-18-doc-history-ai-confirm-design.md`, sections 6-8.

---

### Task 1: Types + API client

**Files:**
- Modify: `types/chat.ts`
- Modify: `lib/api.ts`

- [ ] **Step 1: Add the payload types** to `types/chat.ts`:

```ts
// A destructive tool the model requested; parked server-side until the student
// approves. Sent inside a [[MODK_CONFIRM]] frame; rendered as Approve/Cancel
// chips. Approval calls /api/chat/confirm-action — NOT a chat message.
export interface ConfirmPayload {
  kind: "confirmAction";
  actionId: string;
  toolName: string;
  preview: {
    kind: string; // tool name — maps to a localized template
    data: Record<string, unknown>;
    text: string; // server-built English fallback
  };
}

// End-of-turn frame: this AI turn changed the .docx. checkpointSeq is the
// history snapshot to restore for one-tap "Undo AI changes".
export interface DocChangesPayload {
  kind: "docChanges";
  turnId: string;
  checkpointSeq: number;
  tools: string[];
}
```

- [ ] **Step 2: History endpoint client** — in `lib/api.ts` next to the other thesis endpoints (~line 950):

```ts
// ── Doc history (undo/redo snapshot ring buffer) ─────────────────────────────

export interface HistoryEntryDTO {
  seq: number;
  label: string;
  source: "ai" | "manual" | "onlyoffice" | "restore" | "import";
  turnId: string | null;
  createdAt: string | null;
}

export interface HistoryStateDTO {
  canUndo: boolean;
  canRedo: boolean;
}

export async function getThesisHistory(thesisId: string) {
  return apiGet<{ entries: HistoryEntryDTO[]; cursorSeq: number | null } & HistoryStateDTO>(
    `/api/thesis/${thesisId}/history`,
  );
}

export type HistoryRestoreResponse = { ok: true; document: DocumentDTO } & HistoryStateDTO;

export async function undoThesisHistory(thesisId: string) {
  return apiPost<HistoryRestoreResponse>(`/api/thesis/${thesisId}/history/undo`, {});
}

export async function redoThesisHistory(thesisId: string) {
  return apiPost<HistoryRestoreResponse>(`/api/thesis/${thesisId}/history/redo`, {});
}

export async function restoreThesisHistory(thesisId: string, seq: number) {
  return apiPost<HistoryRestoreResponse>(`/api/thesis/${thesisId}/history/restore`, { seq });
}
```

- [ ] **Step 3: Optional `history` on the edit echoes.** Widen the block-edit return types (lines 875-949: `editThesisParagraph`, `editThesisParagraphs`, `moveThesisBlock`, `insertThesisImage`, `deleteThesisBlocks`, `startThesisBlocksOnNewPage`): append `history?: { canUndo: boolean; canRedo: boolean }` inside each response object type (e.g. `Promise<{ ok: true; deleted: number; skipped: number; document?: DocumentDTO; history?: HistoryStateDTO }>`).

- [ ] **Step 4: New frames in the stream pump.** In `chatSendStream` (lib/api.ts ~line 230):
  - Extend `ChatStreamHandlers`:

```ts
  onConfirm?: (confirm: ConfirmPayload) => void;
  onDocChanges?: (changes: DocChangesPayload) => void;
```

  (import both types from `@/types/chat`).
  - Add marker constants beside the others: `const CONFIRM_OPEN = "[[MODK_CONFIRM]]"; const CONFIRM_CLOSE = "[[/MODK_CONFIRM]]"; const DC_OPEN = "[[MODK_DOCCHANGES]]"; const DC_CLOSE = "[[/MODK_DOCCHANGES]]";`
  - In the `mode === "answer"` branch, add both to the first-marker scan (`const ci = buf.indexOf(CONFIRM_OPEN); const di = buf.indexOf(DC_OPEN);` → include `ci`,`di` in the `[ti, ai, fi]` array) and to the `heldLen` marker list, then handle each exactly like the FILE frame (wait for the close marker, `JSON.parse` the body, call `handlers.onConfirm?.(…)` / `handlers.onDocChanges?.(…)`, never emit to `onDelta`).

- [ ] **Step 5: Generalize the stream POST for the confirm endpoints.** `chatSendStream` hardcodes `/api/chat/stream`; extract the fetch+pump body into an internal

```ts
async function postChatStream(path: string, body: Record<string, unknown>, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void>
```

(the entire current implementation, with `path` and `body` as parameters), make `chatSendStream` a thin wrapper building today's body, and add:

```ts
// Approve / decline a parked destructive AI action. The server executes (or
// discards) the STORED args and streams a follow-up assistant reply through
// the same frame protocol as /api/chat/stream.
export async function chatConfirmAction(actionId: string, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  return postChatStream("/api/chat/confirm-action", { actionId }, handlers, signal);
}

export async function chatCancelAction(actionId: string, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  return postChatStream("/api/chat/cancel-action", { actionId }, handlers, signal);
}
```

- [ ] **Step 6: Verify** `npx tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add types/chat.ts lib/api.ts
git commit -m "feat(history-app): history endpoints + CONFIRM/DOCCHANGES stream frames"
```

---

### Task 2: Chat store + ai-service wiring

**Files:**
- Modify: `stores/chat-store.ts`
- Modify: `lib/ai-service.ts`

- [ ] **Step 1: Store state.** In `chat-store.ts` add beside `pendingAsk`:

```ts
  pendingConfirm: ConfirmPayload | null; // parked destructive action → Approve/Cancel chips
  // Last AI turn's doc changes per thesis → drives the "Undo AI changes" chip.
  docChanges: Record<string, DocChangesPayload | null>;
```

with actions (and initial values `pendingConfirm: null`, `docChanges: {}`):

```ts
  setPendingConfirm: (confirm: ConfirmPayload | null) => set({ pendingConfirm: confirm }),
  setDocChanges: (thesisId, changes) =>
    set((s) => ({ docChanges: { ...s.docChanges, [thesisId]: changes } })),
```

(declare both in `ChatState`; import `ConfirmPayload`, `DocChangesPayload` from `@/types/chat`).

- [ ] **Step 2: Wire the send path.** In `lib/ai-service.ts` `sendMessageToAI`:
  - At the start of the send (where the user message is added): clear stale chips — `store.setPendingConfirm(null); store.setDocChanges(thesisId, null);`
  - Add to the `chatSendStream` handlers object:

```ts
        onConfirm: (confirm) => {
          useChatStore.getState().setPendingConfirm(confirm);
        },
        onDocChanges: (changes) => {
          useChatStore.getState().setDocChanges(thesisId, changes);
        },
```

  - In the buffered `/send` fallback branch, mirror: `if (result.confirmAction) store.setPendingConfirm(result.confirmAction);` and `if (result.docChanges) store.setDocChanges(thesisId, result.docChanges);` (widen `chatSend`'s response type in lib/api.ts with `confirmAction?: ConfirmPayload; docChanges?: DocChangesPayload;`).

- [ ] **Step 3: Approve/decline actions.** Append to `lib/ai-service.ts`:

```ts
// Approve or decline a parked destructive action. The continuation streams into
// a fresh assistant bubble through the same handlers as a normal turn, so the
// workspace's after-turn refresh (isGenerating true→false) fires as usual.
async function runActionContinuation(
  thesisId: string,
  actionId: string,
  call: typeof chatConfirmAction,
): Promise<void> {
  const store = useChatStore.getState();
  store.setPendingConfirm(null);
  store.setGenerating(true);
  store.setGeneratingPhase("thinking");
  const controller = new AbortController();
  store.setAbortController(controller);
  let assistantId: string | null = null;
  const ensureBubble = () => {
    const s = useChatStore.getState();
    if (!assistantId) {
      assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
      s.setStreamingId(assistantId);
    }
    return s;
  };
  try {
    await call(actionId, {
      onDelta: (chunk) => {
        const s = ensureBubble();
        s.setGeneratingPhase("writing");
        s.appendToMessage(thesisId, assistantId!, chunk);
      },
      onThinking: (chunk) => {
        const s = ensureBubble();
        s.setGeneratingPhase("thinking");
        s.appendToThinking(thesisId, assistantId!, chunk);
      },
      onAsk: (ask) => useChatStore.getState().setPendingAsk(ask),
      onConfirm: (confirm) => useChatStore.getState().setPendingConfirm(confirm),
      onDocChanges: (changes) => useChatStore.getState().setDocChanges(thesisId, changes),
      onFile: (file) => {
        const s = ensureBubble();
        s.addFileToMessage(thesisId, assistantId!, file);
      },
    }, controller.signal);
  } catch (error: any) {
    if (!controller.signal.aborted) {
      const note = `Sorry, I couldn't process the action. ${error?.message || "Please try again."}`;
      const s = ensureBubble();
      s.appendToMessage(thesisId, assistantId!, `\n\n_${note}_`);
    }
  } finally {
    const s = useChatStore.getState();
    if (assistantId) s.markThinkingEnded(thesisId, assistantId);
    s.setGenerating(false);
    s.setGeneratingPhase("idle");
    s.setStreamingId(null);
    s.setAbortController(null);
  }
}

export function approvePendingAction(thesisId: string, actionId: string): Promise<void> {
  return runActionContinuation(thesisId, actionId, chatConfirmAction);
}

export function declinePendingAction(thesisId: string, actionId: string): Promise<void> {
  return runActionContinuation(thesisId, actionId, chatCancelAction);
}
```

(imports: `chatConfirmAction`, `chatCancelAction` from `./api`. Match the surrounding file's exact store-access idioms — mirror `sendMessageToAI`'s prologue/finally if they differ from the above.)

- [ ] **Step 4: Verify** `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add stores/chat-store.ts lib/ai-service.ts
git commit -m "feat(history-app): pendingConfirm + docChanges state and approve/decline continuations"
```

---

### Task 3: Doc store — apply restores + history button state

**Files:**
- Modify: `stores/thesis-doc-store.ts`
- Modify: `lib/thesis-ops.ts` (op result type only)

- [ ] **Step 1: State + actions.** Add to `ThesisDocState`:

```ts
  // Server-reported undo/redo availability (from edit echoes + GET /history).
  history: Record<string, { canUndo: boolean; canRedo: boolean }>;

  setHistoryState: (thesisId: string, h: { canUndo: boolean; canRedo: boolean }) => void;
  refreshHistoryState: (thesisId: string) => Promise<void>;
  // Replace the doc after a server-side restore (undo/redo/history sheet):
  // full reconcile — bumps tick (Word view reloads) AND drainTick (editor
  // config/PDF re-key). Callers must only invoke while pending === 0.
  applyRestoredDoc: (thesisId: string, doc: DocumentDTO, h: { canUndo: boolean; canRedo: boolean }) => void;
```

implementations (inside the store object, `history: {}` in the initial state):

```ts
    setHistoryState: (thesisId, h) =>
      set((s) => ({ history: { ...s.history, [thesisId]: h } })),

    refreshHistoryState: async (thesisId) => {
      try {
        const st = await getThesisHistory(thesisId);
        get().setHistoryState(thesisId, { canUndo: st.canUndo, canRedo: st.canRedo });
      } catch {
        // Endpoint missing (old server) or offline — leave buttons as they were.
      }
    },

    applyRestoredDoc: (thesisId, doc, h) => {
      get().setDoc(thesisId, doc);
      get().setHistoryState(thesisId, h);
      set((s) => ({ drainTick: bump(s.drainTick, thesisId) }));
    },
```

(import `getThesisHistory` from `@/lib/api`.)

- [ ] **Step 2: Pick up `history` from flush echoes.** In `lib/thesis-ops.ts`, widen `executeOp`'s return type with `history?: { canUndo: boolean; canRedo: boolean }` (the api functions already carry it from Task 1 — check the `ThesisOpResult`/inline type it declares and add the field). In `thesis-doc-store.ts`'s `runPump`, where the LAST op reconciles from `res.document` (~line 144-160), add beside it:

```ts
        if (res.history) get().setHistoryState(thesisId, res.history);
```

- [ ] **Step 3: Verify** `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add stores/thesis-doc-store.ts lib/thesis-ops.ts
git commit -m "feat(history-app): applyRestoredDoc + canUndo/canRedo state in the doc store"
```

---

### Task 4: Header undo/redo buttons

**Files:**
- Modify: `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1: Subscriptions + handler.** With the other store subscriptions (~line 97-108) — primitives only:

```ts
  const canUndo = useThesisDocStore((s) => s.history[thesisId]?.canUndo ?? false);
  const canRedo = useThesisDocStore((s) => s.history[thesisId]?.canRedo ?? false);
  const pendingOps = useThesisDocStore((s) => s.pending[thesisId] ?? 0);
```

Handler beside `refreshDoc`/`refreshEditorCfg`:

```ts
  // Undo/redo are server-side restores. Disabled while queue ops are pending
  // (positional indices would replay against the restored doc) and during an AI
  // turn. Applies via the store's full-reconcile path (tick + drainTick).
  const [historyBusy, setHistoryBusy] = useState(false);
  const runHistory = useCallback(async (kind: "undo" | "redo") => {
    if (!thesisId || historyBusy) return;
    setHistoryBusy(true);
    try {
      const res = kind === "undo" ? await undoThesisHistory(thesisId) : await redoThesisHistory(thesisId);
      useThesisDocStore.getState().applyRestoredDoc(thesisId, res.document, { canUndo: res.canUndo, canRedo: res.canRedo });
    } catch (e: any) {
      Alert.alert(t("workspace.historyFailed", { defaultValue: "Couldn't restore the document" }), e?.message ?? "");
    } finally {
      setHistoryBusy(false);
    }
  }, [thesisId, historyBusy, t]);
```

(imports: `undoThesisHistory`, `redoThesisHistory` from `@/lib/api`; `Undo2`, `Redo2`, `History` from `lucide-react-native`; `Alert` from react-native if not present.)

- [ ] **Step 2: Load button state.** Add `void useThesisDocStore.getState().refreshHistoryState(thesisId);` in three existing spots: the `useFocusEffect` load callback, the `drainTick > 0` effect, and the `prevGenerating` after-AI-turn effect (each already calls a refresh — append the history refresh line).

- [ ] **Step 3: Render.** In the top bar, between the title and `<WorkspaceViewSwitcher />`, live docs only:

```tsx
        {liveDoc && (
          <>
            <Pressable
              onPress={() => void runHistory("undo")}
              disabled={!canUndo || pendingOps > 0 || historyBusy || isGenerating}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.undo", { defaultValue: "Undo" })}
              style={styles.expandBtn}
            >
              <Undo2 size={20} color={canUndo && pendingOps === 0 && !historyBusy && !isGenerating ? colors.textPrimary : colors.textPlaceholder} />
            </Pressable>
            <Pressable
              onPress={() => void runHistory("redo")}
              disabled={!canRedo || pendingOps > 0 || historyBusy || isGenerating}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.redo", { defaultValue: "Redo" })}
              style={styles.expandBtn}
            >
              <Redo2 size={20} color={canRedo && pendingOps === 0 && !historyBusy && !isGenerating ? colors.textPrimary : colors.textPlaceholder} />
            </Pressable>
          </>
        )}
```

If the row gets cramped on small screens, drop the two buttons into a single overflow next to the view switcher — but try inline first.

- [ ] **Step 4: Verify live.** `npx tsc --noEmit`, run the app: edit a block from the outline → undo arrow enables → tap → the Word view reloads showing the pre-edit doc, redo enables; redo restores; buttons grey out while the op queue is flushing (make an edit offline to see it).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/thesis-workspace.tsx"
git commit -m "feat(history-app): header undo/redo wired to server restore"
```

---

### Task 5: "Undo AI changes" chip + confirm chips in the composer

**Files:**
- Create: `components/workspace/ComposerConfirm.tsx`
- Modify: `components/workspace/WorkspaceComposerSheet.tsx`
- Modify: `app/(tabs)/chat.tsx` (confirm fallback in the standalone chat)

- [ ] **Step 1: The confirm component**

```tsx
// components/workspace/ComposerConfirm.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { ConfirmPayload } from "@/types/chat";

interface Props {
  confirm: ConfirmPayload;
  onApprove: () => void;
  onCancel: () => void;
  rtl: boolean;
}

// Localized preview line; falls back to the server-built English text.
function previewText(t: (k: string, o?: object) => string, c: ConfirmPayload): string {
  const d = c.preview.data as Record<string, string | number>;
  switch (c.preview.kind) {
    case "delete_block":
      return t("confirmAction.deleteBlock", { index: d.index, snippet: d.snippet, defaultValue: c.preview.text });
    case "replace_text":
      return t("confirmAction.replaceText", { find: d.find, replace: d.replace, count: d.count, defaultValue: c.preview.text });
    case "set_header": case "set_section_header":
      return t("confirmAction.overwriteHeader", { next: d.next, defaultValue: c.preview.text });
    case "set_footer": case "set_section_footer":
      return t("confirmAction.overwriteFooter", { next: d.next, defaultValue: c.preview.text });
    default:
      return t(`confirmAction.${c.preview.kind}`, { defaultValue: c.preview.text });
  }
}

/**
 * A destructive AI action awaiting the student's approval. Approve executes the
 * server-stored args (never a chat message); Cancel discards the action. Shown
 * in the composer sheet in place of the input, like ComposerAsk.
 */
export function ComposerConfirm({ confirm, onApprove, onCancel, rtl }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <View style={styles.container}>
      <View style={[styles.titleRow, rtl && { flexDirection: "row-reverse" }]}>
        <TriangleAlert size={16} color={colors.semanticError} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("confirmAction.title", { defaultValue: "The AI wants to make a critical change" })}
        </Text>
      </View>
      <Text style={[styles.preview, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}>
        {previewText(t, confirm)}
      </Text>
      <Text style={[styles.note, { color: colors.textPlaceholder, textAlign: rtl ? "right" : "left" }]}>
        {t("confirmAction.undoNote", { defaultValue: "You can undo this later from History." })}
      </Text>
      <View style={[styles.actions, rtl && { flexDirection: "row-reverse" }]}>
        <Pressable
          onPress={onApprove}
          style={[styles.btn, { backgroundColor: colors.semanticError }]}
          accessibilityRole="button"
        >
          <Text style={styles.approveText}>{t("confirmAction.approve", { defaultValue: "Approve" })}</Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={[styles.btn, styles.cancelBtn, { borderColor: colors.borderDefault, backgroundColor: colors.bgCard }]}
          accessibilityRole="button"
        >
          <Text style={[styles.cancelText, { color: colors.textPrimary }]}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, paddingTop: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  preview: { fontSize: 14, fontFamily: "Inter_500Medium" },
  note: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", gap: 10 },
  btn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12 },
  cancelBtn: { borderWidth: 1 },
  approveText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  cancelText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
```

(Check `colors.textSecondary`/`colors.semanticError`/`colors.borderDefault` against `hooks/useThemeColors` and use the file's actual prop names.)

- [ ] **Step 2: Composer sheet integration.** In `WorkspaceComposerSheet.tsx`:
  - Subscribe: `const pendingConfirm = useChatStore((s) => s.pendingConfirm);` and `const aiDocChanges = useChatStore((s) => s.docChanges[thesisId] ?? null);`
  - Handlers beside `handleAnswer`:

```ts
  const handleApprove = () => { void approvePendingAction(thesisId, pendingConfirm!.actionId); };
  const handleDecline = () => { void declinePendingAction(thesisId, pendingConfirm!.actionId); };

  // One-tap revert of everything the last AI turn changed.
  const handleUndoAiChanges = () => {
    if (!aiDocChanges) return;
    useChatStore.getState().setDocChanges(thesisId, null);
    void restoreThesisHistory(thesisId, aiDocChanges.checkpointSeq)
      .then((res) => useThesisDocStore.getState().applyRestoredDoc(thesisId, res.document, { canUndo: res.canUndo, canRedo: res.canRedo }))
      .catch(() => useChatStore.getState().setDocChanges(thesisId, aiDocChanges)); // restore the chip on failure
  };
```

  (imports: `approvePendingAction`, `declinePendingAction` from `@/lib/ai-service`; `restoreThesisHistory` from `@/lib/api`; `Undo2` from lucide.)
  - Render priority in the sheet body — confirm > ask > normal input (the existing `pendingAsk ? <ComposerAsk/> : <>…</>` branch at ~line 480 becomes):

```tsx
        {pendingConfirm ? (
          <ComposerConfirm confirm={pendingConfirm} onApprove={handleApprove} onCancel={handleDecline} rtl={rtl} />
        ) : pendingAsk ? (
          /* existing ComposerAsk block unchanged */
        ) : (
          /* existing normal branch unchanged */
        )}
```

  - "Undo AI changes" chip: render above the input area (next to where the bulk-action row renders, visible in ai mode) when `aiDocChanges && !isGenerating && !pendingConfirm`:

```tsx
        {aiDocChanges && !isGenerating && !pendingConfirm && (
          <Pressable
            onPress={handleUndoAiChanges}
            style={[styles.bulkBtn, { borderColor: colors.brandPrimary + "55", backgroundColor: colors.brandPrimary + "12", alignSelf: rtl ? "flex-end" : "flex-start" }]}
            accessibilityRole="button"
          >
            <Undo2 size={15} color={colors.brandPrimary} strokeWidth={2} />
            <Text style={[styles.bulkText, { color: colors.brandPrimary }]} numberOfLines={1}>
              {t("workspace.undoAiChanges", { defaultValue: "Undo AI changes" })}
            </Text>
          </Pressable>
        )}
```

  (reuse the existing `bulkBtn`/`bulkText` styles.)

- [ ] **Step 3: Standalone chat screen.** `app/(tabs)/chat.tsx` renders asks via `AskBottomSheet` (~line 630). Mirror minimally: subscribe to `pendingConfirm`; when set, render `ComposerConfirm` inside the same bottom-sheet surface the ask uses (or a plain absolute-positioned card above the input if the sheet is ask-specific), with the same `approvePendingAction`/`declinePendingAction` handlers. The thesisId comes from the active chat context already used for `sendMessageToAI`. No "Undo AI changes" chip here (the doc isn't visible on this screen).

- [ ] **Step 4: Verify live.** Run the app → workspace chat → "delete the dedication block": Approve/Cancel chips appear (nothing deleted yet); Cancel → polite AI acknowledgment, doc unchanged. Repeat and Approve → block deleted, follow-up bubble streams, then the "Undo AI changes" chip appears; tap it → the block is back. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/ComposerConfirm.tsx components/workspace/WorkspaceComposerSheet.tsx "app/(tabs)/chat.tsx"
git commit -m "feat(history-app): confirm chips + one-tap Undo-AI-changes chip"
```

---

### Task 6: Version history sheet

**Files:**
- Create: `components/workspace/HistorySheet.tsx`
- Modify: `app/(app)/thesis-workspace.tsx` (entry button + mount)

- [ ] **Step 1: The sheet.** Follow the gorhom v5 house rules: conditionally UNMOUNT when closed (`if (!isOpen) return null`) + a single `requestAnimationFrame(present)`; open/close via `getState()`.

```tsx
// components/workspace/HistorySheet.tsx
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { BottomSheetModal, BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { Bot, User, FileInput, RotateCcw, PenLine } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { getThesisHistory, restoreThesisHistory, type HistoryEntryDTO } from "@/lib/api";

interface Props {
  thesisId: string;
  isOpen: boolean;
  onClose: () => void;
}

const SOURCE_ICON = { ai: Bot, manual: User, onlyoffice: PenLine, restore: RotateCcw, import: FileInput } as const;

function relativeTime(iso: string | null, t: (k: string, o?: object) => string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t("history.justNow", { defaultValue: "just now" });
  if (mins < 60) return t("history.minsAgo", { count: mins, defaultValue: `${mins} min ago` });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("history.hoursAgo", { count: hours, defaultValue: `${hours} h ago` });
  return new Date(iso).toLocaleDateString();
}

/**
 * Recent document states (the undo ring buffer), newest first. Tapping Restore
 * confirms, then rolls the working .docx back to that snapshot — itself undoable
 * (restoring snapshots the current state first, server-side).
 */
export function HistorySheet({ thesisId, isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const ref = useRef<BottomSheetModal>(null);
  const [entries, setEntries] = useState<HistoryEntryDTO[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => ref.current?.present());
    getThesisHistory(thesisId)
      .then((h) => setEntries(h.entries))
      .catch(() => setEntries([]));
  }, [thesisId]);

  const restore = (entry: HistoryEntryDTO) => {
    Alert.alert(
      t("history.restoreTitle", { defaultValue: "Restore this version?" }),
      t("history.restoreBody", { defaultValue: "The document will roll back to this state. You can undo the restore afterwards." }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        {
          text: t("history.restore", { defaultValue: "Restore" }),
          style: "destructive",
          onPress: () => {
            setBusy(true);
            restoreThesisHistory(thesisId, entry.seq)
              .then((res) => {
                useThesisDocStore.getState().applyRestoredDoc(thesisId, res.document, { canUndo: res.canUndo, canRedo: res.canRedo });
                onClose();
              })
              .catch((e: any) => Alert.alert(t("workspace.historyFailed", { defaultValue: "Couldn't restore the document" }), e?.message ?? ""))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={["60%"]}
      enableDynamicSizing={false}
      onDismiss={onClose}
      backgroundStyle={{ backgroundColor: colors.bgPrimary }}
      handleIndicatorStyle={{ backgroundColor: colors.borderDefault }}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("history.title", { defaultValue: "Document history" })}
        </Text>
      </View>
      {entries === null ? (
        <ActivityIndicator style={styles.spinner} color={colors.brandPrimary} />
      ) : entries.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textPlaceholder }]}>
          {t("history.empty", { defaultValue: "No earlier versions yet — they appear as you edit." })}
        </Text>
      ) : (
        <BottomSheetFlatList
          data={entries}
          keyExtractor={(e: HistoryEntryDTO) => String(e.seq)}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: HistoryEntryDTO }) => {
            const Icon = SOURCE_ICON[item.source] ?? User;
            return (
              <View style={[styles.row, { borderColor: colors.borderDefault }]}>
                <Icon size={16} color={colors.textPlaceholder} />
                <View style={styles.rowBody}>
                  <Text style={[styles.rowLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                    {item.label || t(`history.source.${item.source}`, { defaultValue: item.source })}
                  </Text>
                  <Text style={[styles.rowTime, { color: colors.textPlaceholder }]}>
                    {relativeTime(item.createdAt, t)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => restore(item)}
                  disabled={busy}
                  style={[styles.restoreBtn, { borderColor: colors.brandPrimary + "55" }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.restoreText, { color: colors.brandPrimary }]}>
                    {t("history.restore", { defaultValue: "Restore" })}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  spinner: { marginTop: 32 },
  empty: { marginTop: 32, textAlign: "center", fontSize: 14, fontFamily: "Inter_400Regular", paddingHorizontal: 32 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  rowTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  restoreBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 },
  restoreText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
```

(Match the surrounding codebase's BottomSheetModal idiom — check an existing sheet like `components/BottomSheet.tsx`/`AskBottomSheet.tsx` for the provider/backdrop pattern and mirror it. Server labels are English ("Delete 2 block(s)", "AI: delete_block") — localizing the raw labels is accepted for v1; the source line under it is localized.)

- [ ] **Step 2: Entry point + mount.** In `thesis-workspace.tsx`: `const [historyOpen, setHistoryOpen] = useState(false);`, a `History` icon Pressable in the top bar next to the `Maximize2` button (live docs only, same `styles.expandBtn` shape, accessibilityLabel `t("history.title")`), and at the bottom of the screen JSX, the unmount-when-closed mount:

```tsx
      {historyOpen && thesisId && (
        <HistorySheet thesisId={thesisId} isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
      )}
```

- [ ] **Step 3: Verify live.** Open History → entries listed newest-first with icons/times; Restore an old entry → confirm dialog → doc reloads at that state; undo arrow can reverse the restore. `npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/HistorySheet.tsx "app/(app)/thesis-workspace.tsx"
git commit -m "feat(history-app): version history sheet with per-entry restore"
```

---

### Task 7: i18n + copy fix

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`
- Modify: `components/workspace/WorkspaceComposerSheet.tsx` (one string)

- [ ] **Step 1: Keys.** Add to all three locale files (translate fr/ar properly; ar mirrors RTL naturally via the components):
`workspace.undo`, `workspace.redo`, `workspace.historyFailed`, `workspace.undoAiChanges`,
`history.title`, `history.empty`, `history.restore`, `history.restoreTitle`, `history.restoreBody`, `history.justNow`, `history.minsAgo`, `history.hoursAgo`, `history.source.ai`, `history.source.manual`, `history.source.onlyoffice`, `history.source.restore`, `history.source.import`,
`confirmAction.title`, `confirmAction.deleteBlock`, `confirmAction.replaceText`, `confirmAction.overwriteHeader`, `confirmAction.overwriteFooter`, `confirmAction.make_thesis_ready`, `confirmAction.front_matter_numbering`, `confirmAction.approve`, `confirmAction.undoNote`.
Follow the files' existing nesting/interpolation style (`{{count}}`, `{{snippet}}`…).

- [ ] **Step 2: The delete dialog no longer lies.** In `WorkspaceComposerSheet.tsx` `handleBulkDelete` (~line 335), change the body defaultValue from `This can't be undone.` to `You can undo this from History.` and update the `workspace.deleteSelectedBody` entry in all three locale files to match.

- [ ] **Step 3: Verify** `npx tsc --noEmit`; switch the app to fr and ar and eyeball the new strings (RTL layout for ar).

- [ ] **Step 4: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json components/workspace/WorkspaceComposerSheet.tsx
git commit -m "feat(history-app): trilingual strings for history/confirm; delete dialog points to History"
```

---

## Final verification (whole feature, all three plans)

- [ ] `npx tsc --noEmit` clean in BOTH repos; `npx vitest run` green on the server.
- [ ] The original bug scenario: ask the AI (in Arabic) to change the dedication header/page — it now either asks via `ask_user` or hard-gates with Approve/Cancel; after an approved destructive change, both the "Undo AI changes" chip and header undo restore the document; the History sheet shows the whole trail.
- [ ] Offline check: make edits offline (queue pending) → undo/redo stay disabled until the queue drains.
- [ ] Update the memory bank + `MEMORY.md` with the landed architecture (history ring buffer chokepoint, gate flow) after everything ships.
