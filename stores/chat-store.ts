import { create } from "zustand";
import type { ChatMessage } from "@/types/chat";

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
  messages: Record<string, ChatMessage[]>; // keyed by thesisId
  isGenerating: boolean;
  generatingStep: number;
  generatingPhase: GeneratingPhase;
  streamingId: string | null; // id of the assistant message currently streaming
  abortController: AbortController | null; // aborts the in-flight AI turn when the user taps Stop

  getMessages: (thesisId: string) => ChatMessage[];
  setMessages: (thesisId: string, messages: ChatMessage[]) => void;
  addMessage: (thesisId: string, role: "user" | "assistant", content: string, opts?: { chapterId?: string; pending?: boolean }) => string;
  appendToMessage: (thesisId: string, id: string, chunk: string) => void;
  setGenerating: (generating: boolean) => void;
  setGeneratingStep: (step: number) => void;
  setGeneratingPhase: (phase: GeneratingPhase) => void;
  setStreamingId: (id: string | null) => void;
  setAbortController: (controller: AbortController | null) => void;
  stopGenerating: () => void;
  clearMessages: (thesisId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  isGenerating: false,
  generatingStep: 0,
  generatingPhase: "idle",
  streamingId: null,
  abortController: null,

  getMessages: (thesisId) => get().messages[thesisId] ?? EMPTY_MESSAGES,

  setMessages: (thesisId, messages) =>
    set((s) => ({ messages: { ...s.messages, [thesisId]: messages } })),

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

  setGenerating: (generating) => set({ isGenerating: generating }),
  setGeneratingStep: (step) => set({ generatingStep: step }),
  setGeneratingPhase: (phase) => set({ generatingPhase: phase }),
  setStreamingId: (id) => set({ streamingId: id }),
  setAbortController: (controller) => set({ abortController: controller }),
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
