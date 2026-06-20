export interface ChatMessage {
  id: string;
  thesisId: string;
  role: "user" | "assistant";
  content: string;
  chapterId?: string;
  sectionId?: string;
  createdAt: string;
}
