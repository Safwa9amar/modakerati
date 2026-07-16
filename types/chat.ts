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
  // Reasoning ("thinking") tokens from a reasoning model, shown in a collapsible
  // section. Ephemeral — streamed live, not persisted server-side.
  thinking?: string;
  // When reasoning started / ended (ISO). Drives the "Thought for Xs" chip; set
  // by the chat-store as tokens stream (start) and by ai-service at the first
  // answer token / turn end (end).
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
  // Downloadable artifacts (e.g. a DOCX/LaTeX export) attached to this message,
  // rendered as file cards. Carried live via the stream's [[MODK_FILE]] frame;
  // on history reload they're re-parsed from the frame embedded in `content`.
  files?: FilePayload[];
}

// A downloadable file produced by the assistant (e.g. a thesis export). Sent by
// the server inside a [[MODK_FILE]]…[[/MODK_FILE]] frame; the app renders it as a
// tappable file card. Preview happens IN-APP only — the url is never opened
// externally.
export interface FilePayload {
  kind: "file";
  url: string;
  filename: string;
  title?: string;
  /** "docx" | "latex" — drives the file icon. */
  format: string;
  bytes: number;
  /** Human-readable size, e.g. "9.3 KB". */
  size: string;
  /** Estimated page count. */
  pages?: number;
}

// Payload the model sends (via the ask_user tool) to open a question bottom sheet.
export interface AskPayload {
  question: string;
  options: string[];
  allowFreeText: boolean;
}
