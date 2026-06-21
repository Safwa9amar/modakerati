import { useChatStore } from "@/stores/chat-store";
import { chatSend, chatSendStream, getChatHistory } from "./api";
import { getCache, setCache } from "./chat-cache";
import type { ChatMessage } from "@/types/chat";

const WELCOME =
  "Hello! I'm your thesis assistant. Let's work on your thesis together.\n\nWhat would you like to focus on? You can:\n\n- Tell me about a chapter to draft\n- Ask me to suggest a structure\n- Request help with your methodology";

export async function sendMessageToAI(
  thesisId: string,
  userMessage: string,
  chapterId?: string
): Promise<void> {
  const store = useChatStore.getState();

  // Lets the user cancel this turn from the UI (chat-store.stopGenerating).
  const controller = new AbortController();
  store.setAbortController(controller);

  // Add user message immediately (optimistic). Marked pending until reconciled.
  store.addMessage(thesisId, "user", userMessage, { chapterId, pending: true });
  store.setGenerating(true);
  store.setGeneratingPhase("thinking");

  // Lazily created on the first streamed chunk so the "thinking" indicator
  // shows until the AI actually starts producing text.
  let assistantId: string | null = null;

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
            s.setGeneratingPhase("writing");
          }
          s.appendToMessage(thesisId, assistantId, chunk);
        },
      },
      { chapterId, signal: controller.signal }
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
        const result = await chatSend(thesisId, userMessage, { chapterId });
        store.addMessage(thesisId, "assistant", result.response, { pending: true });
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

  // 1. Instant: show cached messages from the device (also works offline).
  const cached = await getCache(thesisId);
  if (cached?.messages?.length) {
    store.setMessages(thesisId, cached.messages);
  }

  // 2. Reconcile with the server (incremental when possible). On failure the
  //    cached messages simply remain visible.
  try {
    await syncFromServer(thesisId);
  } catch {
    // offline / backend unavailable
  }

  // 3. Nothing locally or on the server → show the welcome placeholder.
  if (store.getMessages(thesisId).length === 0) {
    store.addMessage(thesisId, "assistant", WELCOME, { pending: true });
  }
}

// Fetch from the server and merge into the store + cache. Uses the cached
// `lastSyncedAt` to pull only the delta; on the first sync it does a full load.
async function syncFromServer(thesisId: string): Promise<void> {
  const store = useChatStore.getState();
  const cached = await getCache(thesisId);
  const since = cached?.lastSyncedAt ?? null;

  const server = await getChatHistory(thesisId, since); // throws when offline
  const fromServer: ChatMessage[] = (server ?? []).map((m: any) => ({
    id: m.id,
    thesisId,
    role: m.role,
    content: m.content,
    chapterId: m.chapterId ?? undefined,
    sectionId: m.sectionId ?? undefined,
    createdAt: m.createdAt,
  }));

  let merged: ChatMessage[];
  if (!since) {
    // First sync: server is the source of truth. If it's empty, keep whatever
    // is local (e.g. a brand-new thesis the user just started typing in).
    if (fromServer.length === 0) return;
    merged = fromServer;
  } else {
    // Incremental: drop un-synced optimistic messages (their authoritative
    // copies arrive below) and append anything new, deduped by server id.
    const synced = store.getMessages(thesisId).filter((m) => !m.pending);
    const have = new Set(synced.map((m) => m.id));
    const additions = fromServer.filter((m) => !have.has(m.id));
    if (additions.length === 0) return; // nothing new to apply
    merged = [...synced, ...additions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  store.setMessages(thesisId, merged);
  const lastSyncedAt = merged.length ? merged[merged.length - 1].createdAt : since;
  await setCache(thesisId, { messages: merged, lastSyncedAt });
}

// Persist the current in-memory messages to the device cache, preserving the
// last confirmed server timestamp.
async function persistCache(thesisId: string): Promise<void> {
  const store = useChatStore.getState();
  const prev = await getCache(thesisId);
  await setCache(thesisId, {
    messages: store.getMessages(thesisId),
    lastSyncedAt: prev?.lastSyncedAt ?? null,
  });
}
