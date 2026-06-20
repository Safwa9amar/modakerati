import { useChatStore } from "@/stores/chat-store";
import { chatSend, getChatHistory } from "./api";

export type AIProvider = "openrouter" | "ollama" | "lmstudio";

// Default provider and model — user can change in settings
let currentProvider: AIProvider = "openrouter";
let currentModel: string | undefined;

export function setAIProvider(provider: AIProvider, model?: string) {
  currentProvider = provider;
  currentModel = model;
}

export function getAIProvider() {
  return { provider: currentProvider, model: currentModel };
}

export async function sendMessageToAI(
  thesisId: string,
  userMessage: string,
  options?: { provider?: AIProvider; model?: string; chapterId?: string }
): Promise<void> {
  const store = useChatStore.getState();

  // Add user message to local store immediately (optimistic)
  store.addMessage(thesisId, "user", userMessage);
  store.setGenerating(true);

  try {
    // Send to backend API
    const result = await chatSend(thesisId, userMessage, {
      provider: options?.provider || currentProvider,
      model: options?.model || currentModel,
      chapterId: options?.chapterId,
    });

    // Add AI response to local store
    store.addMessage(thesisId, "assistant", result.response);
  } catch (error: any) {
    // On error, add error message as AI response
    store.addMessage(
      thesisId,
      "assistant",
      `Sorry, I couldn't process your message. ${error.message || "Please try again."}`
    );
  } finally {
    store.setGenerating(false);
    store.setGeneratingStep(0);
  }
}

export async function loadInitialMessages(thesisId: string) {
  const store = useChatStore.getState();
  const existing = store.getMessages(thesisId);
  if (existing.length > 0) return;

  try {
    // Try to load history from backend
    const history = await getChatHistory(thesisId);
    if (history && history.length > 0) {
      for (const msg of history) {
        store.addMessage(thesisId, msg.role, msg.content);
      }
      return;
    }
  } catch {
    // Backend not available — use default welcome
  }

  // Default welcome message
  store.addMessage(
    thesisId,
    "assistant",
    "Hello! I'm your thesis assistant. Let's work on your thesis together.\n\nWhat would you like to focus on? You can:\n\n- Tell me about a chapter to draft\n- Ask me to suggest a structure\n- Request help with your methodology"
  );
}
