import { create } from "zustand";
import type { ChatMessage } from "@/types/chat";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Stable reference for the "no messages yet" case. Returning a fresh `[]` from
// the selector makes zustand's useSyncExternalStore see a new snapshot every
// render, causing an infinite render loop ("Maximum update depth exceeded").
const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatState {
  messages: Record<string, ChatMessage[]>; // keyed by thesisId
  isGenerating: boolean;
  generatingStep: number;

  getMessages: (thesisId: string) => ChatMessage[];
  addMessage: (thesisId: string, role: "user" | "assistant", content: string, chapterId?: string) => void;
  setGenerating: (generating: boolean) => void;
  setGeneratingStep: (step: number) => void;
  clearMessages: (thesisId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  isGenerating: false,
  generatingStep: 0,

  getMessages: (thesisId) => get().messages[thesisId] ?? EMPTY_MESSAGES,

  addMessage: (thesisId, role, content, chapterId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [thesisId]: [
          ...(s.messages[thesisId] ?? []),
          { id: generateId(), thesisId, role, content, chapterId, createdAt: new Date().toISOString() },
        ],
      },
    })),

  setGenerating: (generating) => set({ isGenerating: generating }),
  setGeneratingStep: (step) => set({ generatingStep: step }),
  clearMessages: (thesisId) =>
    set((s) => {
      const msgs = { ...s.messages };
      delete msgs[thesisId];
      return { messages: msgs };
    }),
}));
