import { create } from "zustand";
import type { ChatMessage, AskPayload, FilePayload, ConfirmPayload, DocChangesPayload } from "@/types/chat";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Stable reference for the "no messages yet" case. Returning a fresh `[]` from
// the selector makes zustand's useSyncExternalStore see a new snapshot every
// render, causing an infinite render loop ("Maximum update depth exceeded").
const EMPTY_MESSAGES: ChatMessage[] = [];

// Phase of the AI turn, surfaced in the chat UI as a typing indicator.
//  - "thinking": request sent, no tokens received yet
//  - "writing":  tokens are streaming into the assistant bubble
//  - "idle":     no generation in progress
export type GeneratingPhase = "idle" | "thinking" | "writing";

interface ChatState {
  messages: Record<string, ChatMessage[]>; // keyed by thesisId — the loaded window, oldest→newest
  // Infinite scroll: whether earlier messages exist before the loaded window, and
  // whether an older page is currently being fetched. Both keyed by thesisId.
  hasMoreOlder: Record<string, boolean>;
  loadingOlder: Record<string, boolean>;
  isGenerating: boolean;
  generatingStep: number;
  generatingPhase: GeneratingPhase;
  streamingId: string | null; // id of the assistant message currently streaming
  abortController: AbortController | null; // aborts the in-flight AI turn when the user taps Stop
  pendingAsk: AskPayload | null; // active model question → drives the AskBottomSheet
  pendingConfirm: ConfirmPayload | null; // parked destructive action → Approve/Cancel chips
  // Last AI turn's doc changes per thesis → drives the "Undo AI changes" chip.
  docChanges: Record<string, DocChangesPayload | null>;

  getMessages: (thesisId: string) => ChatMessage[];
  setMessages: (thesisId: string, messages: ChatMessage[]) => void;
  // Insert an older page at the FRONT of the loaded window (deduped by id).
  prependMessages: (thesisId: string, older: ChatMessage[]) => void;
  getHasMoreOlder: (thesisId: string) => boolean;
  setHasMoreOlder: (thesisId: string, value: boolean) => void;
  getLoadingOlder: (thesisId: string) => boolean;
  setLoadingOlder: (thesisId: string, value: boolean) => void;
  addMessage: (thesisId: string, role: "user" | "assistant", content: string, opts?: { chapterId?: string; pending?: boolean }) => string;
  appendToMessage: (thesisId: string, id: string, chunk: string) => void;
  appendToThinking: (thesisId: string, id: string, chunk: string) => void;
  markThinkingEnded: (thesisId: string, id: string) => void;
  addFileToMessage: (thesisId: string, id: string, file: FilePayload) => void;
  setGenerating: (generating: boolean) => void;
  setGeneratingStep: (step: number) => void;
  setGeneratingPhase: (phase: GeneratingPhase) => void;
  setStreamingId: (id: string | null) => void;
  setAbortController: (controller: AbortController | null) => void;
  setPendingAsk: (ask: AskPayload | null) => void;
  setPendingConfirm: (confirm: ConfirmPayload | null) => void;
  setDocChanges: (thesisId: string, changes: DocChangesPayload | null) => void;
  stopGenerating: () => void;
  clearMessages: (thesisId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  hasMoreOlder: {},
  loadingOlder: {},
  isGenerating: false,
  generatingStep: 0,
  generatingPhase: "idle",
  streamingId: null,
  abortController: null,
  pendingAsk: null,
  pendingConfirm: null,
  docChanges: {},

  getMessages: (thesisId) => get().messages[thesisId] ?? EMPTY_MESSAGES,

  setMessages: (thesisId, messages) =>
    set((s) => ({ messages: { ...s.messages, [thesisId]: messages } })),

  // Prepend an older page, skipping any ids already loaded. `older` is
  // chronological and strictly older than the current window, so front-concat
  // keeps the whole list ordered oldest→newest.
  prependMessages: (thesisId, older) =>
    set((s) => {
      const existing = s.messages[thesisId] ?? [];
      const have = new Set(existing.map((m) => m.id));
      const fresh = older.filter((m) => !have.has(m.id));
      if (fresh.length === 0) return s;
      return { messages: { ...s.messages, [thesisId]: [...fresh, ...existing] } };
    }),

  getHasMoreOlder: (thesisId) => get().hasMoreOlder[thesisId] ?? false,
  setHasMoreOlder: (thesisId, value) =>
    set((s) => (s.hasMoreOlder[thesisId] === value ? s : { hasMoreOlder: { ...s.hasMoreOlder, [thesisId]: value } })),
  getLoadingOlder: (thesisId) => get().loadingOlder[thesisId] ?? false,
  setLoadingOlder: (thesisId, value) =>
    set((s) => (s.loadingOlder[thesisId] === value ? s : { loadingOlder: { ...s.loadingOlder, [thesisId]: value } })),

  addMessage: (thesisId, role, content, opts) => {
    const id = generateId();
    set((s) => ({
      messages: {
        ...s.messages,
        [thesisId]: [
          ...(s.messages[thesisId] ?? []),
          { id, thesisId, role, content, chapterId: opts?.chapterId, pending: opts?.pending, createdAt: new Date().toISOString() },
        ],
      },
    }));
    return id;
  },

  appendToMessage: (thesisId, id, chunk) =>
    set((s) => {
      const list = s.messages[thesisId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          // New object for the target message so memoized bubbles re-render.
          [thesisId]: list.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
        },
      };
    }),

  appendToThinking: (thesisId, id, chunk) =>
    set((s) => {
      const list = s.messages[thesisId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [thesisId]: list.map((m) =>
            m.id === id
              ? {
                  ...m,
                  thinking: (m.thinking ?? "") + chunk,
                  // First reasoning token → start the clock (idempotent).
                  thinkingStartedAt: m.thinkingStartedAt ?? new Date().toISOString(),
                }
              : m,
          ),
        },
      };
    }),

  addFileToMessage: (thesisId, id, file) =>
    set((s) => {
      const list = s.messages[thesisId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [thesisId]: list.map((m) => {
            if (m.id !== id) return m;
            // Dedupe by url so a re-export / replayed frame doesn't double the card.
            if (m.files?.some((f) => f.url === file.url)) return m;
            return { ...m, files: [...(m.files ?? []), file] };
          }),
        },
      };
    }),

  setGenerating: (generating) => set({ isGenerating: generating }),
  setGeneratingStep: (step) => set({ generatingStep: step }),
  setGeneratingPhase: (phase) => set({ generatingPhase: phase }),
  setStreamingId: (id) => set({ streamingId: id }),
  setAbortController: (controller) => set({ abortController: controller }),
  setPendingAsk: (ask) => set({ pendingAsk: ask }),
  setPendingConfirm: (confirm) => set({ pendingConfirm: confirm }),
  setDocChanges: (thesisId, changes) =>
    set((s) => ({ docChanges: { ...s.docChanges, [thesisId]: changes } })),
  // Stamp when reasoning ended. Idempotent: only stamps if thinking actually
  // started and the end isn't already set. Called at the first answer token and
  // again in ai-service's finally (covers tool-only turns and aborts).
  markThinkingEnded: (thesisId, id) =>
    set((s) => {
      const list = s.messages[thesisId];
      if (!list) return s;
      let changed = false;
      const next = list.map((m) => {
        if (m.id !== id || !m.thinkingStartedAt || m.thinkingEndedAt) return m;
        changed = true;
        return { ...m, thinkingEndedAt: new Date().toISOString() };
      });
      return changed ? { messages: { ...s.messages, [thesisId]: next } } : s;
    }),
  // Cancel the in-flight AI turn. The request's reader rejects with an
  // AbortError, which sendMessageToAI swallows — the partial response stays.
  stopGenerating: () => {
    get().abortController?.abort();
  },
  clearMessages: (thesisId) =>
    set((s) => {
      const msgs = { ...s.messages };
      delete msgs[thesisId];
      return { messages: msgs };
    }),
}));
