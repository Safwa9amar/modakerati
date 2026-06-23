# Thesis P4 — Embedded AI Chat Editing in the Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Let the user edit the memoir by chatting with the AI from inside the document workspace. A composer pinned in `thesis-workspace` targets the currently-selected Section/Chapter (shows a context chip), sends through the existing agentic chat (which edits via MCP tools), and the workspace **refreshes live** when the turn completes. Pending `ask_user` questions surface via the existing AskBottomSheet.

**Architecture:** Thread a *focused* `sectionId`/`chapterId` end-to-end: workspace `selected` → `WorkspaceComposer` → `sendMessageToAI(thesisId, msg, { sectionId, chapterId })` → `chatSendStream` body → server `/stream` → `streamChatWithTools(..., { focusedSectionId, focusedChapterId })` → `buildToolSystemPrompt` injects "the student is focused on Section 'X' (id) / Chapter 'Y' (id); prefer editing there." The composer observes `chat-store.isGenerating`; on the true→false transition it calls `refreshThesis(thesisId)` so edited chapters re-render. Reuses the existing streaming/thinking/ask machinery; no new chat protocol.

**Tech Stack:** Existing `lib/ai-service.ts` + `lib/api.ts` chat fns + `stores/chat-store.ts` + `AskBottomSheet`; server `routes/chat.ts` + `lib/ai/tool-loop.ts` + `lib/ai/types.ts`.

**Branch:** `feat/thesis-hierarchy-p0`.

**Verified facts:**
- `lib/ai-service.ts`: `sendMessageToAI(thesisId, userMessage, chapterId?)` → `addMessage(..., {chapterId, pending})` + `runAssistantTurn(thesisId, msg, chapterId)`; `regenerateLastResponse` uses `userMsg.chapterId`; `runAssistantTurn` calls `chatSendStream(thesisId, msg, handlers, { chapterId, signal })` with fallback `chatSend`.
- `lib/api.ts`: `chatSend(thesisId, message, {chapterId?})` and `chatSendStream(thesisId, message, handlers, {chapterId?, signal?})` build body `{ thesisId, message, chapterId }`.
- `stores/chat-store.ts`: `isGenerating`, `streamingId`, `getMessages(thesisId)`, `addMessage(thesisId, role, content, {chapterId?, pending?})`, `pendingAsk`, `setPendingAsk`, `stopGenerating`.
- `app/(tabs)/chat.tsx`: exports `ThesisChat` (variant "screen"|"overlay"); `AskBottomSheet` is rendered there (find its import path — likely `@/components/AskBottomSheet`). The composer JSX + `handleSend` → `sendMessageToAI(thesisId, message)`.
- `types/chat.ts`: `ChatMessage` already has optional `sectionId`.
- Server `routes/chat.ts`: `/send` + `/stream` read `{ thesisId, message, chapterId, model, provider, reasoning }`, persist `chapterId`, call `(stream)ChatWithTools(ai, history, { userId, thesisId, model, reasoning, signal })`.
- `lib/ai/tool-loop.ts`: both `chatWithTools` and `streamChatWithTools` take `opts: { userId, thesisId?, model?, maxSteps?, reasoning?, signal? }` and build messages with `buildToolSystemPrompt({ thesisId: opts.thesisId })`.
- `lib/ai/types.ts`: `buildToolSystemPrompt(ctx: { thesisId?: string })` (already describes the sections→chapters model + tools).
- `stores/thesis-store.ts` (from P3): `selected: {sectionId,chapterId}`, `selectChapter/selectSection/clearSelection`, `refreshThesis(id)`.

---

## Task 1: Server — focus-aware chat

**Files:** Modify `src/routes/chat.ts`, `src/lib/ai/tool-loop.ts`, `src/lib/ai/types.ts`

- [ ] **Step 1:** `buildToolSystemPrompt` — extend the context param + inject focus:
```typescript
export function buildToolSystemPrompt(ctx: { thesisId?: string; focus?: { sectionId?: string; sectionTitle?: string; chapterId?: string; chapterTitle?: string } }): string {
  // ...existing template... then before the final line add:
  const focus = ctx.focus;
  const focusLine = focus && (focus.chapterId || focus.sectionId)
    ? `\n- The student is currently focused on ${focus.chapterId ? `the chapter "${focus.chapterTitle ?? ""}" (id "${focus.chapterId}")` : ""}${focus.chapterId && focus.sectionId ? " in " : ""}${focus.sectionId ? `the section "${focus.sectionTitle ?? ""}" (id "${focus.sectionId}")` : ""}. Unless they clearly mean something else, apply edits THERE (e.g. update_chapter_content on that chapter).`
    : "";
  // include `${focusLine}` in the returned string (e.g. right after the thesisId line).
}
```
- [ ] **Step 2:** `tool-loop.ts` — add `focus` to BOTH `chatWithTools` and `streamChatWithTools` opts and pass it through:
```typescript
opts: { userId: string; thesisId?: string; model?: string; maxSteps?: number; reasoning?: boolean; signal?: AbortSignal; focus?: { sectionId?: string; sectionTitle?: string; chapterId?: string; chapterTitle?: string } }
// and change both buildToolSystemPrompt calls to:
buildToolSystemPrompt({ thesisId: opts.thesisId, focus: opts.focus })
```
- [ ] **Step 3:** `routes/chat.ts` — both `/send` and `/stream`: read `sectionId` from the body; persist it on the messages (`sectionId: sectionId || null` alongside `chapterId`); look up focus titles and pass `focus` into the loop opts:
```typescript
const { thesisId, message, chapterId, sectionId, model, provider, reasoning } = await c.req.json();
// build focus (best-effort; titles optional)
let focus: any = undefined;
if (chapterId || sectionId) {
  focus = { chapterId: chapterId || undefined, sectionId: sectionId || undefined };
  if (chapterId) { const [ch] = await db.select({ title: chapters.title, sectionId: chapters.sectionId }).from(chapters).where(eq(chapters.id, chapterId)); if (ch) { focus.chapterTitle = ch.title; focus.sectionId = focus.sectionId || ch.sectionId; } }
  if (focus.sectionId) { const [se] = await db.select({ title: sections.title }).from(sections).where(eq(sections.id, focus.sectionId)); if (se) focus.sectionTitle = se.title; }
}
// persist both ids on the user + assistant inserts: { ..., chapterId: chapterId || null, sectionId: sectionId || null }
// pass focus to the loop: streamChatWithTools(ai, history, { userId, thesisId, model, reasoning, signal: controller.signal, focus })
```
Add `chapters`, `sections`, `eq` to imports if missing.
- [ ] **Step 4:** `npx tsc --noEmit` → 0. Commit:
```bash
git add src/routes/chat.ts src/lib/ai/tool-loop.ts src/lib/ai/types.ts
git commit -m "feat(server): focus-aware chat — thread sectionId/chapterId into the tool system prompt"
```

---

## Task 2: App — thread focus through the chat client

**Files:** Modify `lib/api.ts`, `lib/ai-service.ts`

- [ ] **Step 1:** `lib/api.ts` — extend both chat fns' options with `sectionId` and include it in the body:
```typescript
export async function chatSend(thesisId: string, message: string, options?: { chapterId?: string; sectionId?: string }): Promise<ChatSendResponse> {
  return apiPost("/api/chat/send", { thesisId, message, chapterId: options?.chapterId, sectionId: options?.sectionId });
}
// chatSendStream: add sectionId to the options type and to the JSON body
body: JSON.stringify({ thesisId, message, chapterId: options?.chapterId, sectionId: options?.sectionId }),
```
- [ ] **Step 2:** `lib/ai-service.ts` — change `sendMessageToAI` to an options object (keep it backward compatible for the existing `sendMessageToAI(thesisId, message)` callers):
```typescript
export async function sendMessageToAI(thesisId: string, userMessage: string, opts?: { chapterId?: string; sectionId?: string }): Promise<void> {
  useChatStore.getState().addMessage(thesisId, "user", userMessage, { chapterId: opts?.chapterId, pending: true });
  await runAssistantTurn(thesisId, userMessage, opts);
}
```
Update `runAssistantTurn(thesisId, userMessage, opts?: { chapterId?: string; sectionId?: string })` to pass `{ chapterId: opts?.chapterId, sectionId: opts?.sectionId, signal }` to `chatSendStream`/`chatSend`. Update `regenerateLastResponse` to call `runAssistantTurn(thesisId, userMsg.content, { chapterId: userMsg.chapterId, sectionId: userMsg.sectionId })`.
- [ ] **Step 3:** Confirm existing callers still compile: `app/(tabs)/chat.tsx` calls `sendMessageToAI(thesisId, message)` (no 3rd arg — fine) and the AskBottomSheet `onAnswer` calls `sendMessageToAI(thesisId, answer)` (fine). `npx tsc --noEmit` → only the 8 known pre-existing errors.
- [ ] **Step 4:** Commit:
```bash
git add lib/api.ts lib/ai-service.ts
git commit -m "feat(app): thread sectionId/chapterId focus through chat client"
```

---

## Task 3: App — WorkspaceComposer + AskBottomSheet, live refresh

**Files:** Create `components/workspace/WorkspaceComposer.tsx`; Modify `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1:** Create `components/workspace/WorkspaceComposer.tsx`:
  - Props: `{ thesisId: string }`.
  - Reads `selected` from `useThesisStore`, and resolves the focused titles from the in-store thesis (find section/chapter by id) for the chip label.
  - Reads `isGenerating` + `streamingId` + messages from `useChatStore` (so it can show the streaming reply + a stop button).
  - **Context chip:** if `selected.chapterId` → `✎ {chapterTitle}`; else if `selected.sectionId` → `✎ {sectionTitle}`; else → `{t("workspace.wholeMemoir", {defaultValue:"Whole memoir"})}`. A small "✕" clears selection (`useThesisStore.getState().clearSelection()`).
  - **Input + send/stop** (mirror the chat.tsx composer styling: `bgSurface` input, `brandPrimary` send, `semanticError` stop): on send, call `sendMessageToAI(thesisId, text.trim(), { sectionId: selected.sectionId ?? undefined, chapterId: selected.chapterId ?? undefined })`; clear input.
  - **Streaming strip:** while `isGenerating`, show a thin strip above the input with a small spinner + the live streaming assistant text (the message whose `id === streamingId`, truncated) + a Stop button (`useChatStore.getState().stopGenerating()`).
  - **Live refresh:** `useEffect` watching `isGenerating`: when it transitions from `true` → `false` (track prev with a ref), call `useThesisStore.getState().refreshThesis(thesisId)`.
  - Pin to the bottom; handle keyboard (KeyboardAvoidingView or the app's existing pattern — check how chat.tsx handles it).
- [ ] **Step 2:** In `app/(app)/thesis-workspace.tsx`: render `<WorkspaceComposer thesisId={thesisId} />` pinned at the bottom (outside the ScrollView, so it stays fixed), and render the `AskBottomSheet` for pending asks:
```typescript
import { AskBottomSheet } from "@/components/AskBottomSheet"; // confirm path from chat.tsx
const pendingAsk = useChatStore((s) => s.pendingAsk);
// ...at the end of the screen tree:
{pendingAsk && <AskBottomSheet ask={pendingAsk} onAnswer={(answer) => { useChatStore.getState().setPendingAsk(null); void sendMessageToAI(thesisId, answer, { sectionId: selected.sectionId ?? undefined, chapterId: selected.chapterId ?? undefined }); }} onClose={() => useChatStore.getState().setPendingAsk(null)} />}
```
(Match the exact `AskBottomSheet` props from how chat.tsx uses it — read that first.)
- [ ] **Step 3:** Enable the ⤢ button placeholder? NO — that's P5. Leave it disabled.
- [ ] **Step 4:** i18n: add `workspace.wholeMemoir`, `workspace.askPlaceholder` (en: "Whole memoir"/"Ask the AI to write or edit…"; fr: "Mémoire entier"/"Demandez à l'IA d'écrire ou modifier…"; ar: "كامل المذكرة"/"اطلب من الذكاء الاصطناعي الكتابة أو التعديل…"). Validate JSON.
- [ ] **Step 5:** `npx tsc --noEmit` → only the 8 pre-existing errors. Commit:
```bash
git add components/workspace/WorkspaceComposer.tsx "app/(app)/thesis-workspace.tsx" locales/
git commit -m "feat(app): workspace AI composer (section/chapter-targeted) + live refresh + ask sheet"
```

---

## Task 4: Verification
- [ ] **Step 1:** `cd /Users/hamzasafwan/modakerati-server && npx tsc --noEmit && echo SERVER_OK`.
- [ ] **Step 2:** `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -vE "global.css|absoluteFillObject|ProviderSelector"` → empty.
- [ ] **Step 3:** (Manual, user) In the workspace: tap a chapter → chip shows it → type "écris une introduction sur X" → AI streams, edits that chapter via tools → on completion the chapter card updates. Try with no selection (whole-memoir) and confirm `ask_user` surfaces the bottom sheet.

## Definition of done (P4)
- Server chat persists + uses `sectionId`/`chapterId`; the tool system prompt names the focused unit so edits land there.
- Workspace has a pinned composer with a context chip targeting the selected Section/Chapter; sending streams a reply (with stop) and **refreshes the pages** when done; `ask_user` surfaces in the workspace.
- Both repos type-check (app: only pre-existing unrelated errors).

## Out of scope (P5/P6)
- ⤢ A4 expand preview (P5). Source-material attachments (P6). Per-chapter quick-action buttons (optional later).
