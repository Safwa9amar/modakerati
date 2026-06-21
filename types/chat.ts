export interface ChatMessage {
  id: string;
  thesisId: string;
  role: "user" | "assistant";
  content: string;
  chapterId?: string;
  sectionId?: string;
  createdAt: string;
  // Optimistic message created on-device, not yet reconciled with the server.
  // Dropped and replaced by the authoritative server copy on the next sync.
  pending?: boolean;
}
