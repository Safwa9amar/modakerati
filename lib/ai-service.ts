import { useChatStore } from "@/stores/chat-store";

const AI_RESPONSES: Record<string, string> = {
  default: "I'd be happy to help with your thesis! Could you tell me more about what you'd like to work on?",
  greeting: "Hello! I'm your thesis assistant. Let's work on your thesis together. What chapter or section would you like to focus on?",
  structure: "Great topic! Here's a suggested structure:\n\n1. Introduction & Background\n2. Literature Review\n3. Methodology\n4. Results & Discussion\n5. Conclusion\n\nShall I draft any of these sections?",
  draft: "I've drafted the section for you. Here are the key points covered:\n\n- Background context and motivation\n- Key definitions and scope\n- Research objectives\n\nYou can review and edit it in the Section Editor, or ask me to modify anything.",
  methodology: "For your methodology chapter, I recommend:\n\n- Research design: Qualitative/Quantitative/Mixed\n- Data collection methods\n- Sample selection criteria\n- Analysis techniques\n\nWhich approach fits your research question best?",
};

function pickResponse(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  if (lower.includes("hello") || lower.includes("hi") || lower.includes("start")) return AI_RESPONSES.greeting;
  if (lower.includes("structure") || lower.includes("chapter") || lower.includes("outline")) return AI_RESPONSES.structure;
  if (lower.includes("draft") || lower.includes("write") || lower.includes("generate")) return AI_RESPONSES.draft;
  if (lower.includes("method") || lower.includes("approach") || lower.includes("design")) return AI_RESPONSES.methodology;
  return AI_RESPONSES.default;
}

export async function sendMessageToAI(thesisId: string, userMessage: string): Promise<void> {
  const store = useChatStore.getState();

  // Add user message
  store.addMessage(thesisId, "user", userMessage);

  // Simulate AI thinking
  store.setGenerating(true);

  // Simulate step-by-step progress
  const steps = [0, 1, 2, 3, 4];
  for (const step of steps) {
    store.setGeneratingStep(step);
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
  }

  // Add AI response
  const response = pickResponse(userMessage);
  store.addMessage(thesisId, "assistant", response);
  store.setGenerating(false);
  store.setGeneratingStep(0);
}

export function loadInitialMessages(thesisId: string) {
  const store = useChatStore.getState();
  const existing = store.getMessages(thesisId);
  if (existing.length > 0) return;

  store.addMessage(
    thesisId,
    "assistant",
    "Hello! I'm your thesis assistant. Let's work on your thesis together.\n\nWhat would you like to focus on? You can:\n\n- Tell me about a chapter to draft\n- Ask me to suggest a structure\n- Request help with your methodology"
  );
}
