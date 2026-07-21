import { useChatStore } from "@/stores/chat-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { chatSend, chatSendStream, chatConfirmAction, chatCancelAction, getChatHistory, getChatHistoryPage } from "./api";
import { getLatestMessages, getOlderMessages, upsertMessages, deletePending, getLastSyncedAt, setLastSyncedAt } from "./chat-cache";
import type { ChatMessage } from "@/types/chat";

// The first view shows only the most recent few messages; scrolling to the top
// pages in older history a larger batch at a time.
const INITIAL_PAGE_SIZE = 5;
const OLDER_PAGE_SIZE = 20;

// Map a raw server chat row into the app's ChatMessage shape.
function mapServerMessages(rows: any[], thesisId: string): ChatMessage[] {
  return (rows ?? []).map((m: any) => ({
    id: m.id,
    thesisId,
    role: m.role,
    content: m.content,
    chapterId: m.chapterId ?? undefined,
    sectionId: m.sectionId ?? undefined,
    createdAt: m.createdAt,
  }));
}

const WELCOME =
  "Hello! I'm your thesis assistant. Let's work on your thesis together.\n\nWhat would you like to focus on? You can:\n\n- Tell me about a chapter to draft\n- Ask me to suggest a structure\n- Request help with your methodology";

export async function sendMessageToAI(
  thesisId: string,
  userMessage: string,
  opts?: { chapterId?: string; sectionId?: string; selection?: string; docBlockIndex?: number | null; docBlockIndices?: number[] }
): Promise<void> {
  // Add user message immediately (optimistic). Marked pending until reconciled.
  useChatStore.getState().addMessage(thesisId, "user", userMessage, { chapterId: opts?.chapterId, pending: true });
  await runAssistantTurn(thesisId, userMessage, opts);
}

/**
 * Re-run the assistant's answer to the most recent user message — the
 * "regenerate" / "try again" affordance. Drops the previous assistant reply
 * (everything after the last user turn) and streams a fresh one for the same
 * prompt; the user's own message is left in place. No-op while a turn is already
 * generating, or when there's no user message to answer.
 */
export async function regenerateLastResponse(thesisId: string): Promise<void> {
  const store = useChatStore.getState();
  if (store.isGenerating) return;

  const msgs = store.getMessages(thesisId);
  let i = msgs.length - 1;
  while (i >= 0 && msgs[i].role !== "user") i--;
  if (i < 0) return; // nothing the user asked — nothing to regenerate

  const userMsg = msgs[i];
  // Keep up to and including the user message; discard the stale reply so the
  // new one streams into a fresh bubble.
  store.setMessages(thesisId, msgs.slice(0, i + 1));
  await runAssistantTurn(thesisId, userMsg.content, { chapterId: userMsg.chapterId, sectionId: userMsg.sectionId });
}

// Streams one assistant turn for an already-present user message: opens the
// request, routes tokens/thinking/files/asks into the store, and handles
// abort + the buffered-endpoint fallback. Shared by the initial send and
// regenerate so both behave identically once the user turn exists.
async function runAssistantTurn(
  thesisId: string,
  userMessage: string,
  opts?: { chapterId?: string; sectionId?: string; selection?: string; docBlockIndex?: number | null; docBlockIndices?: number[] }
): Promise<void> {
  // The AI edits the SERVER copy of the .docx. Any locally-held manual edits
  // (the composing gate defers their sync) must land first, or the AI works on
  // a stale doc AND the held ops' positional indices get poisoned by its edits
  // (flush-time rejection would drop the user's local work). The turn needs the
  // network anyway; a failed drain (offline) just proceeds to fail like the
  // chat call itself would.
  await useThesisDocStore.getState().flushOps(thesisId).catch(() => {});

  const store = useChatStore.getState();
  store.setPendingConfirm(null);
  store.setDocChanges(thesisId, null);

  // Lets the user cancel this turn from the UI (chat-store.stopGenerating).
  const controller = new AbortController();
  store.setAbortController(controller);

  store.setGenerating(true);
  store.setGeneratingPhase("thinking");

  // Lazily created on the first streamed chunk so the "thinking" indicator
  // shows until the AI actually starts producing text.
  let assistantId: string | null = null;
  // Flips true at the first answer token → marks the end of reasoning exactly once.
  let sawContent = false;

  try {
    await chatSendStream(
      thesisId,
      userMessage,
      {
        onDelta: (chunk) => {
          const s = useChatStore.getState();
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
          }
          if (!sawContent) {
            sawContent = true;
            // First answer token → reasoning is over; stamp its end and flip phase.
            s.markThinkingEnded(thesisId, assistantId);
            s.setGeneratingPhase("writing");
          }
          s.appendToMessage(thesisId, assistantId, chunk);
        },
        onAsk: (ask) => {
          useChatStore.getState().setPendingAsk(ask);
        },
        onConfirm: (confirm) => {
          useChatStore.getState().setPendingConfirm(confirm);
        },
        onDocChanges: (changes) => {
          useChatStore.getState().setDocChanges(thesisId, changes);
        },
        onThinking: (chunk) => {
          const s = useChatStore.getState();
          // Reasoning can arrive before any answer token — make the bubble now.
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
          }
          s.setGeneratingPhase("thinking");
          s.appendToThinking(thesisId, assistantId, chunk);
        },
        onFile: (file) => {
          const s = useChatStore.getState();
          // A file (e.g. an export) can arrive before any answer text — ensure the
          // assistant bubble exists, then attach the card to it.
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
          }
          s.addFileToMessage(thesisId, assistantId, file);
        },
      },
      { chapterId: opts?.chapterId, sectionId: opts?.sectionId, selection: opts?.selection, docBlockIndex: opts?.docBlockIndex ?? null, docBlockIndices: opts?.docBlockIndices, signal: controller.signal }
    );

    // Stream completed but produced nothing.
    if (!assistantId) {
      store.addMessage(thesisId, "assistant", "I couldn't generate a response. Please try again.", { pending: true });
    }
  } catch (error: any) {
    // User tapped Stop — keep whatever streamed so far and suppress the error
    // note; the abort is intentional, not a failure.
    if (controller.signal.aborted) {
      return;
    }

    // If the streaming endpoint isn't available (e.g. an older server build),
    // fall back to the buffered /send endpoint so the chat still works.
    if (!assistantId && (error?.status === 404 || error?.status === 405)) {
      try {
        store.setGeneratingPhase("thinking");
        const result = await chatSend(thesisId, userMessage, { chapterId: opts?.chapterId, sectionId: opts?.sectionId, selection: opts?.selection, docBlockIndex: opts?.docBlockIndex ?? null, docBlockIndices: opts?.docBlockIndices });
        const id = store.addMessage(thesisId, "assistant", result.response, { pending: true });
        // Mirror the streaming path: surface any file cards and open the ask sheet.
        result.files?.forEach((f) => store.addFileToMessage(thesisId, id, f));
        if (result.ask) store.setPendingAsk(result.ask);
        if (result.confirmAction) store.setPendingConfirm(result.confirmAction);
        if (result.docChanges) store.setDocChanges(thesisId, result.docChanges);
        return;
      } catch (fallbackError: any) {
        error = fallbackError;
      }
    }

    const note = `Sorry, I couldn't process your message. ${error.message || "Please try again."}`;
    if (assistantId) {
      store.appendToMessage(thesisId, assistantId, `\n\n_${note}_`);
    } else {
      store.addMessage(thesisId, "assistant", note, { pending: true });
    }
  } finally {
    // Covers turns that end with no answer text (tool-only actions) or a mid-think
    // abort — markThinkingEnded is a no-op if reasoning never started or already ended.
    if (assistantId) store.markThinkingEnded(thesisId, assistantId);
    store.setGenerating(false);
    store.setGeneratingPhase("idle");
    store.setStreamingId(null);
    store.setGeneratingStep(0);
    store.setAbortController(null);
    // Persist the new turn to the device so it survives restarts and shows
    // instantly next time. Server-id reconciliation happens on the next open.
    await persistCache(thesisId);
  }
}

export async function loadInitialMessages(thesisId: string) {
  const store = useChatStore.getState();
  // Already loaded in memory this session — nothing to do.
  if (store.getMessages(thesisId).length > 0) return;

  // 1. Instant: show the latest page from the device cache (also works offline).
  const cached = await getLatestMessages(thesisId, INITIAL_PAGE_SIZE);
  if (cached.messages.length) {
    store.setMessages(thesisId, cached.messages);
    store.setHasMoreOlder(thesisId, cached.hasMore);
  }

  // 2. Reconcile the newest messages with the server (latest page on first sync,
  //    delta after). On failure the cached messages simply remain visible.
  try {
    await syncLatestFromServer(thesisId);
  } catch {
    // offline / backend unavailable
  }

  // 3. Nothing locally or on the server → show the welcome placeholder.
  if (store.getMessages(thesisId).length === 0) {
    store.addMessage(thesisId, "assistant", WELCOME, { pending: true });
  }
}

// Reconcile the newest messages with the server. First sync (no cursor yet) pulls
// the latest page and marks whether older history exists; afterwards it pulls only
// the delta created since. Older history already paged in is never touched here —
// that grows through loadOlderMessages.
async function syncLatestFromServer(thesisId: string): Promise<void> {
  const store = useChatStore.getState();
  const lastSyncedAt = await getLastSyncedAt(thesisId);

  if (!lastSyncedAt) {
    // First sync: the server's latest page is authoritative for the tail.
    const server = await getChatHistoryPage(thesisId, { limit: INITIAL_PAGE_SIZE }); // throws when offline
    const fromServer = mapServerMessages(server, thesisId);
    // Empty server → keep whatever is local (e.g. a brand-new thesis just started).
    if (fromServer.length === 0) return;
    await upsertMessages(thesisId, fromServer);
    await deletePending(thesisId); // clear stale optimistic rows now superseded
    store.setMessages(thesisId, fromServer);
    store.setHasMoreOlder(thesisId, server.length >= INITIAL_PAGE_SIZE);
    await setLastSyncedAt(thesisId, fromServer[fromServer.length - 1].createdAt);
    return;
  }

  // Incremental: fetch messages created after the last confirmed timestamp,
  // replace optimistic copies with their server-id versions, append new ones.
  const server = await getChatHistory(thesisId, lastSyncedAt);
  const additions = mapServerMessages(server, thesisId);
  if (additions.length === 0) return; // nothing new to apply
  await upsertMessages(thesisId, additions);
  await deletePending(thesisId);
  const synced = store.getMessages(thesisId).filter((m) => !m.pending);
  const have = new Set(synced.map((m) => m.id));
  const merged = [...synced, ...additions.filter((m) => !have.has(m.id))].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  store.setMessages(thesisId, merged);
  await setLastSyncedAt(thesisId, merged[merged.length - 1].createdAt);
}

// Reveal the previous page of history (scroll-to-top). Server-authoritative with a
// device-cache fallback when offline; the store's loadingOlder/hasMoreOlder guards
// keep it from double-loading or paging past the beginning.
export async function loadOlderMessages(thesisId: string): Promise<void> {
  const store = useChatStore.getState();
  if (store.getLoadingOlder(thesisId) || !store.getHasMoreOlder(thesisId)) return;

  const current = store.getMessages(thesisId);
  // Cursor = oldest loaded message with a server row. Optimistic (pending) rows
  // carry a client clock and have no server row to page against, so skip them.
  const cursor = current.find((m) => !m.pending) ?? current[0];
  if (!cursor) return;
  const before = cursor.createdAt;

  store.setLoadingOlder(thesisId, true);
  try {
    let older: ChatMessage[];
    let hasMore: boolean;
    try {
      const server = await getChatHistoryPage(thesisId, { before, limit: OLDER_PAGE_SIZE });
      older = mapServerMessages(server, thesisId);
      hasMore = server.length >= OLDER_PAGE_SIZE; // a full page → older messages may remain
      if (older.length) await upsertMessages(thesisId, older);
    } catch {
      // Offline → serve the older page from the device cache instead.
      const page = await getOlderMessages(thesisId, before, OLDER_PAGE_SIZE);
      older = page.messages;
      hasMore = page.hasMore;
    }
    if (older.length) store.prependMessages(thesisId, older);
    // Stop paging once a page comes back empty or short (reached the beginning).
    store.setHasMoreOlder(thesisId, older.length > 0 && hasMore);
  } finally {
    store.setLoadingOlder(thesisId, false);
  }
}

// Persist the current in-memory window to the device cache. Upsert (not
// replace-all) so older pages already cached survive; optimistic rows reconcile to
// their server ids on the next open (see syncLatestFromServer).
async function persistCache(thesisId: string): Promise<void> {
  const store = useChatStore.getState();
  await upsertMessages(thesisId, store.getMessages(thesisId));
}

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
    await persistCache(thesisId);
  }
}

export function approvePendingAction(thesisId: string, actionId: string): Promise<void> {
  return runActionContinuation(thesisId, actionId, chatConfirmAction);
}

export function declinePendingAction(thesisId: string, actionId: string): Promise<void> {
  return runActionContinuation(thesisId, actionId, chatCancelAction);
}
