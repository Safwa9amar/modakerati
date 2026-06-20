import { useChatStore } from "@/stores/chat-store";
import { chatSend, getChatHistory } from "./api";

export async function sendMessageToAI(
  thesisId: string,
  userMessage: string,
  chapterId?: string
): Promise<void> {
  const store = useChatStore.getState();

  // Add user message immediately (optimistic)
  store.addMessage(thesisId, "user", userMessage);
  store.setGenerating(true);

  try {
    const result = await chatSend(thesisId, userMessage, { chapterId });
    store.addMessage(thesisId, "assistant", result.response);
  } catch (error: any) {
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
    const history = await getChatHistory(thesisId);
    if (history && history.length > 0) {
      for (const msg of history) {
        store.addMessage(thesisId, msg.role, msg.content);
      }
      return;
    }
  } catch {
    // Backend not available
  }

  store.addMessage(
    thesisId,
    "assistant",
    "Hello! I'm your thesis assistant. Let's work on your thesis together.\n\nWhat would you like to focus on? You can:\n\n- Tell me about a chapter to draft\n- Ask me to suggest a structure\n- Request help with your methodology"
  );
}
