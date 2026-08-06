import { useChatStore } from "@/stores/chat-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { chatSend, chatSendStream, chatConfirmAction, chatCancelAction, getChatHistory, getChatHistoryPage } from "./api";
import { getLatestMessages, getOlderMessages, upsertMessages, deletePending, deleteStalePending, getLastSyncedAt, setLastSyncedAt } from "./chat-cache";
import i18n from "./i18n";
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

// Shown when a turn ends without producing anything the student can see. The
// server normally sends its own (localised) note; this is the app's backstop for
// the cases it can't cover — a stream that just ends mid-flight, or an older
// server build. Localised so it doesn't land in English inside an Arabic chat.
// `docChanged` keeps it honest: when the turn's tools already edited the .docx,
// it must not say nothing happened, or the student re-runs an edit that landed.
function emptyTurnNote(docChanged: boolean): string {
  return docChanged
    ? i18n.t("chat.noResponseDocChanged", {
        defaultValue: "I made the changes to your thesis but couldn't write a summary of them. Open your document to check them before trying again.",
      })
    : i18n.t("chat.noResponse", {
        defaultValue: "I couldn't produce a response this time. Tap Regenerate to try again.",
      });
}

const WELCOME =
  "Hello! I'm your thesis assistant. Let's work on your thesis together.\n\nWhat would you like to focus on? You can:\n\n- Tell me about a chapter to draft\n- Ask me to suggest a structure\n- Request help with your methodology";

// How long streamed text is allowed to pool before it is written to the store.
//
// A chunk arrives per model token, and every store write re-renders the whole
// chat: the list, the live bubble, its markdown, the reasoning window. At 30-60
// chunks a second that IS the JS thread's entire budget — and RN dispatches
// touches on that same thread, so for the whole of a long turn nothing on screen
// answers a tap. (It gets worse as the turn runs: each re-render re-scans the
// message, so the cost per chunk grows with the answer.) Coalescing to one write
// per FLUSH_MS makes that ~11 writes a second, which still reads as continuous
// typing while leaving the thread free to handle presses in between.
const FLUSH_MS = 90;

interface StreamPump {
  /** Queue an answer-text chunk for message `id`. */
  delta: (id: string, chunk: string) => void;
  /** Queue a reasoning chunk for message `id`. */
  thinking: (id: string, chunk: string) => void;
  /** Write what's queued NOW. Call before anything that has to land AFTER the
   *  text — a question sheet, a file card, an error note, the end of the turn. */
  flush: () => void;
  /** Drop what's queued and disarm the timer (a stopped or finished turn). */
  cancel: () => void;
}

/**
 * Batches a turn's streamed chunks into periodic store writes (see FLUSH_MS).
 *
 * Ordering is preserved the only way it matters: reasoning and answer text land
 * in the same flush, reasoning first, and `flush()` is the caller's lever for
 * everything that must be sequenced against the text. Writes are gated on `live`
 * exactly like the direct ones were, so a stopped turn's tail is discarded
 * rather than typed into the chat the student already moved on from.
 */
function createStreamPump(thesisId: string, live: () => boolean): StreamPump {
  let target: string | null = null; // the bubble the buffers belong to
  let content = "";
  let think = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const disarm = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    disarm();
    const id = target;
    const reasoning = think;
    const answer = content;
    think = "";
    content = "";
    if (!id || (!reasoning && !answer) || !live()) return;
    const s = useChatStore.getState();
    if (reasoning) s.appendToThinking(thesisId, id, reasoning);
    if (answer) s.appendToMessage(thesisId, id, answer);
  };

  const arm = (id: string) => {
    // A different bubble (a continuation, a regenerate) must never inherit the
    // previous one's queued text — land it where it belongs first.
    if (target !== null && target !== id) flush();
    target = id;
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  };

  return {
    delta: (id, chunk) => {
      arm(id);
      content += chunk;
    },
    thinking: (id, chunk) => {
      arm(id);
      think += chunk;
    },
    flush,
    cancel: () => {
      disarm();
      content = "";
      think = "";
    },
  };
}

export async function sendMessageToAI(
  thesisId: string,
  userMessage: string,
  opts?: { chapterId?: string; sectionId?: string; selection?: string; docBlockIndex?: number | null; docBlockIndices?: number[] }
): Promise<void> {
  // Add user message immediately (optimistic). Marked pending until reconciled.
  // addMessage returns the EXISTING id when this repeats a just-sent message, so
  // a student tapping send on an apparently-frozen turn doesn't stack bubbles.
  const store = useChatStore.getState();
  const userId = store.addMessage(thesisId, "user", userMessage, { chapterId: opts?.chapterId, pending: true });
  // A retry of a failed send starts clean: clear the marker, and let the turn
  // below set it again if this attempt fails too.
  store.setMessageFailed(thesisId, userId, false);
  await runAssistantTurn(thesisId, userMessage, { ...opts, userMessageId: userId });
}

/**
 * Re-send a message whose turn never completed — the Retry on a failed bubble.
 *
 * Runs the turn for the EXISTING user row rather than appending another one.
 * That distinction is the whole point: re-typing the question is what produced
 * the repeated bubbles in the first place, so the affordance that replaces it
 * must not do the same thing.
 */
export async function retryFailedMessage(thesisId: string, messageId: string): Promise<void> {
  const store = useChatStore.getState();
  if (store.isGenerating) return;
  const msg = store.getMessages(thesisId).find((m) => m.id === messageId);
  if (!msg || msg.role !== "user") return;
  store.setMessageFailed(thesisId, messageId, false);
  await runAssistantTurn(thesisId, msg.content, {
    chapterId: msg.chapterId,
    sectionId: msg.sectionId,
    userMessageId: messageId,
  });
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
  // `regenerate` tells the server this question is already in its history: don't
  // save it twice, and drop the reply being replaced.
  await runAssistantTurn(thesisId, userMsg.content, { chapterId: userMsg.chapterId, sectionId: userMsg.sectionId, regenerate: true });
}

// Streams one assistant turn for an already-present user message: opens the
// request, routes tokens/thinking/files/asks into the store, and handles
// abort + the buffered-endpoint fallback. Shared by the initial send and
// regenerate so both behave identically once the user turn exists.
async function runAssistantTurn(
  thesisId: string,
  userMessage: string,
  opts?: {
    chapterId?: string; sectionId?: string; selection?: string;
    docBlockIndex?: number | null; docBlockIndices?: number[]; regenerate?: boolean;
    /** The user row this turn answers. Marked failed if the turn never lands, so
     *  the student sees an undelivered message as undelivered. */
    userMessageId?: string;
  }
): Promise<void> {
  const store = useChatStore.getState();
  store.setPendingConfirm(null);
  store.setDocChanges(thesisId, null);

  // Lets the user cancel this turn from the UI (chat-store.stopGenerating).
  const controller = new AbortController();

  // Claim the turn BEFORE the pre-flight flush below — that flush is a network
  // round-trip, and until the turn is marked generating the chat still looks
  // idle: the composer would take a second send, and the "unanswered question"
  // retry chip would flash under the message already on its way.
  const turnId = store.beginTurn();
  store.setAbortController(controller);

  // False once the user hits Stop or a newer turn takes over. Every write below
  // is gated on it: the request may keep unwinding for a while (an abort the
  // transport is slow to honour, or never honours), and a stopped turn that
  // still streamed into the chat would undo the Stop the user just pressed.
  const live = () => useChatStore.getState().isTurnActive(turnId);

  // The AI edits the SERVER copy of the .docx. Any locally-held manual edits
  // (the composing gate defers their sync) must land first, or the AI works on
  // a stale doc AND the held ops' positional indices get poisoned by its edits
  // (flush-time rejection would drop the user's local work). The turn needs the
  // network anyway; a failed drain (offline) just proceeds to fail like the
  // chat call itself would. Lexical Writer typing serializes FIRST (it lives in
  // the WebView until serialized — a pending pause-save isn't in the op queue).
  await (useLexicalEditorStore.getState().flushEdits?.() ?? Promise.resolve()).catch(() => {});
  await useThesisDocStore.getState().flushOps(thesisId).catch(() => {});

  // That flush is a network round-trip the user can hit Stop inside. Bail before
  // opening the stream rather than starting one only to abort it; the store is
  // already idle, so there is nothing to tear down.
  if (!live()) return;

  // Lazily created on the first streamed chunk so the "thinking" indicator
  // shows until the AI actually starts producing text.
  let assistantId: string | null = null;
  // Flips true at the first answer token → marks the end of reasoning exactly once.
  let sawContent = false;
  // Whether the turn produced anything the student can actually SEE: answer text,
  // a file card, a question sheet or a confirmation. Reasoning does NOT count — a
  // turn that only "thought" leaves a bubble holding a thinking trace and nothing
  // else, which reads as the AI stopping mid-sentence with no way to tell whether
  // it failed. That case is caught below and turned into a visible, retryable note.
  let producedOutput = false;
  // Whether this turn's tools actually mutated the .docx — decides WHICH note.
  let docChanged = false;
  // Streamed text is batched through this rather than written per chunk, so the
  // JS thread stays responsive for the length of the turn (see createStreamPump).
  const pump = createStreamPump(thesisId, live);

  try {
    await chatSendStream(
      thesisId,
      userMessage,
      {
        onDelta: (chunk) => {
          if (!live()) return;
          const s = useChatStore.getState();
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
          }
          producedOutput = true;
          if (!sawContent) {
            sawContent = true;
            // First answer token → reasoning is over. Land the queued reasoning
            // BEFORE stamping its end, so the clock covers all of it.
            pump.flush();
            s.markThinkingEnded(thesisId, assistantId);
            s.setGeneratingPhase("writing");
          }
          pump.delta(assistantId, chunk);
        },
        onAsk: (ask) => {
          if (!live()) return; // a stopped turn must not pop a question sheet
          producedOutput = true; // the sheet IS the turn's output
          pump.flush(); // the question follows the text that leads up to it
          useChatStore.getState().setPendingAsk(ask);
        },
        onConfirm: (confirm) => {
          if (!live()) return; // ditto for the approve/decline chips
          producedOutput = true; // the approve/decline chips ARE the turn's output
          pump.flush();
          useChatStore.getState().setPendingConfirm(confirm);
        },
        onDocChanges: (changes) => {
          // NOT producedOutput: an edited document with no reply still needs the
          // note below — but a doc-aware one (see emptyTurnNote). Recorded even
          // for a stopped turn: the .docx edits already happened server-side, so
          // the student still needs the "Undo AI changes" chip for them.
          docChanged = true;
          useChatStore.getState().setDocChanges(thesisId, changes);
        },
        onThinking: (chunk) => {
          if (!live()) return;
          const s = useChatStore.getState();
          // Reasoning can arrive before any answer token — make the bubble now.
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
          }
          // Only on a real change: this fires per chunk, and an unconditional set
          // notifies every store subscriber for nothing.
          if (s.generatingPhase !== "thinking") s.setGeneratingPhase("thinking");
          pump.thinking(assistantId, chunk);
        },
        onFile: (file) => {
          if (!live()) return;
          const s = useChatStore.getState();
          // A file (e.g. an export) can arrive before any answer text — ensure the
          // assistant bubble exists, then attach the card to it.
          if (!assistantId) {
            assistantId = s.addMessage(thesisId, "assistant", "", { pending: true });
            s.setStreamingId(assistantId);
          }
          producedOutput = true; // a file card alone is a valid answer (e.g. an export)
          pump.flush(); // the card belongs under the text that announced it
          s.addFileToMessage(thesisId, assistantId, file);
        },
        // Developer trace only (server-side AI_SHOW_TOOLS): NOT producedOutput —
        // running tools is not an answer to the student.
        onTool: (tool) => {
          if (!live()) return;
          useChatStore.getState().pushToolTrace(tool);
        },
      },
      { chapterId: opts?.chapterId, sectionId: opts?.sectionId, selection: opts?.selection, docBlockIndex: opts?.docBlockIndex ?? null, docBlockIndices: opts?.docBlockIndices, regenerate: opts?.regenerate, signal: controller.signal }
    );

    // Everything still queued belongs to this turn — land it before the checks
    // below read what the turn produced.
    pump.flush();

    // The stream ended cleanly but the student got nothing — either no bubble at
    // all, or one holding only a thinking trace. Both look identical to a hang, so
    // say what happened; the note also gives the bubble content, which is what the
    // chat's Regenerate affordance keys off.
    if (!producedOutput && live()) {
      const note = emptyTurnNote(docChanged);
      if (assistantId) store.appendToMessage(thesisId, assistantId, note);
      else store.addMessage(thesisId, "assistant", note, { pending: true });
    }
  } catch (error: any) {
    // User tapped Stop (or a newer turn took over) — keep whatever streamed so
    // far and suppress the error note; the abort is intentional, not a failure.
    if (!live()) {
      return;
    }

    // Whatever arrived before the failure is still the turn's answer — land it so
    // the note below reads as its ending, not as a replacement for it.
    pump.flush();

    // If the streaming endpoint isn't available (e.g. an older server build),
    // fall back to the buffered /send endpoint so the chat still works.
    if (!assistantId && (error?.status === 404 || error?.status === 405)) {
      try {
        store.setGeneratingPhase("thinking");
        const result = await chatSend(thesisId, userMessage, { chapterId: opts?.chapterId, sectionId: opts?.sectionId, selection: opts?.selection, docBlockIndex: opts?.docBlockIndex ?? null, docBlockIndices: opts?.docBlockIndices, regenerate: opts?.regenerate });
        // The buffered endpoint takes no signal, so Stop can't cut it short —
        // it can only be ignored. Drop the whole reply rather than dumping it
        // into a chat the student already walked away from.
        if (!live()) return;
        const id = store.addMessage(thesisId, "assistant", result.response || emptyTurnNote(!!result.docChanges), { pending: true });
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

    // The turn never landed. Mark the QUESTION as undelivered, not just the
    // answer: a user bubble that looks identical to a delivered one is what
    // makes a student type the same request again — three times, in the case
    // this was written for. The Retry on that bubble re-runs THIS row.
    if (opts?.userMessageId) store.setMessageFailed(thesisId, opts.userMessageId, true);

    const note = `Sorry, I couldn't process your message. ${error.message || "Please try again."}`;
    if (assistantId) {
      store.appendToMessage(thesisId, assistantId, `\n\n_${note}_`);
    } else {
      store.addMessage(thesisId, "assistant", note, { pending: true });
    }
  } finally {
    // Nothing may write into the chat after the turn ends: every path above has
    // already flushed what it meant to keep, so a chunk still queued here is a
    // stopped turn's tail.
    pump.cancel();
    // Covers turns that end with no answer text (tool-only actions) or a mid-think
    // abort — markThinkingEnded is a no-op if reasoning never started or already ended.
    if (assistantId) store.markThinkingEnded(thesisId, assistantId);
    // Ownership-checked: a turn the user stopped may only unwind here long after
    // the next one started, and must not idle THAT one's chat.
    store.endTurn(turnId);
    // Persist the new turn to the device so it survives restarts and shows
    // instantly next time. Server-id reconciliation happens on the next open.
    await persistCache(thesisId);
  }
}

// How long an unconfirmed optimistic row may survive before it is treated as a
// failed send. Generous enough to outlast the longest agentic turn (the step cap
// is 32 model calls), short enough that a message from a previous app session is
// never shown as if it had been sent.
const STALE_PENDING_MS = 10 * 60 * 1000;

export async function loadInitialMessages(thesisId: string) {
  const store = useChatStore.getState();
  // Already loaded in memory this session — nothing to do.
  if (store.getMessages(thesisId).length > 0) return;

  // A pending row that survived a restart is a send that failed — its turn died
  // long ago. Reap before reading, so the cache can't resurrect it into the list.
  await deleteStalePending(thesisId, STALE_PENDING_MS);

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
  // Reap FIRST, and unconditionally. This used to sit after the early return
  // below, so it only ran when the server happened to have something new — and a
  // pending row whose send had failed was therefore never cleared. Reaching this
  // line means the server answered, so it is authoritative: anything still
  // marked pending is a send that never landed.
  await deletePending(thesisId);
  if (additions.length === 0) {
    // Nothing new upstream, but the reap above may have removed rows the store
    // is still showing — drop them from memory too, or they linger until reload.
    const live = store.getMessages(thesisId).filter((m) => !m.pending);
    if (live.length !== store.getMessages(thesisId).length) store.setMessages(thesisId, live);
    return;
  }
  await upsertMessages(thesisId, additions);
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
  const controller = new AbortController();
  const turnId = store.beginTurn();
  store.setAbortController(controller);
  // See runAssistantTurn: gates every write so a stopped continuation goes quiet.
  const live = () => useChatStore.getState().isTurnActive(turnId);
  let assistantId: string | null = null;
  // See runAssistantTurn: reasoning alone is not an answer, and a continuation
  // that yields only a thinking trace must not end in silence either.
  let producedOutput = false;
  let docChanged = false;
  // See runAssistantTurn: streamed text is batched, not written per chunk.
  const pump = createStreamPump(thesisId, live);
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
        if (!live()) return;
        const s = ensureBubble();
        producedOutput = true;
        if (s.generatingPhase !== "writing") s.setGeneratingPhase("writing");
        pump.delta(assistantId!, chunk);
      },
      onThinking: (chunk) => {
        if (!live()) return;
        const s = ensureBubble();
        if (s.generatingPhase !== "thinking") s.setGeneratingPhase("thinking");
        pump.thinking(assistantId!, chunk);
      },
      onAsk: (ask) => { if (!live()) return; producedOutput = true; pump.flush(); useChatStore.getState().setPendingAsk(ask); },
      onConfirm: (confirm) => { if (!live()) return; producedOutput = true; pump.flush(); useChatStore.getState().setPendingConfirm(confirm); },
      // Not gated: the .docx was already edited, so the undo chip is owed either way.
      onDocChanges: (changes) => { docChanged = true; useChatStore.getState().setDocChanges(thesisId, changes); },
      onFile: (file) => {
        if (!live()) return;
        const s = ensureBubble();
        producedOutput = true;
        pump.flush();
        s.addFileToMessage(thesisId, assistantId!, file);
      },
      // Developer trace only — see runAssistantTurn.
      onTool: (tool) => { if (!live()) return; useChatStore.getState().pushToolTrace(tool); },
    }, controller.signal);
    pump.flush();
    if (!producedOutput && live()) {
      const s = ensureBubble();
      s.appendToMessage(thesisId, assistantId!, emptyTurnNote(docChanged));
    }
  } catch (error: any) {
    if (live()) {
      pump.flush();
      const note = `Sorry, I couldn't process the action. ${error?.message || "Please try again."}`;
      const s = ensureBubble();
      s.appendToMessage(thesisId, assistantId!, `\n\n_${note}_`);
    }
  } finally {
    pump.cancel();
    const s = useChatStore.getState();
    if (assistantId) s.markThinkingEnded(thesisId, assistantId);
    s.endTurn(turnId);
    await persistCache(thesisId);
  }
}

export function approvePendingAction(thesisId: string, actionId: string): Promise<void> {
  return runActionContinuation(thesisId, actionId, chatConfirmAction);
}

export function declinePendingAction(thesisId: string, actionId: string): Promise<void> {
  return runActionContinuation(thesisId, actionId, chatCancelAction);
}
