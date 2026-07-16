import { useChatStore } from "@/stores/chat-store";
import { chatSend, chatSendStream, getChatHistory } from "./api";
import { getCache, setCache } from "./chat-cache";
import type { ChatMessage } from "@/types/chat";

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
  const store = useChatStore.getState();

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
