// Imported .docx documents. The .docx file in storage is the source of truth;
// these mirror the server's document-service DTOs (see modakerati-server).

export type Align = "left" | "center" | "right" | "both";

export interface DocumentRecord {
  id: string;
  filename: string;
  title: string;
  language: string | null;
  wordCount: number | null;
  pageCount: number | null;
  sizeBytes: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ParagraphDTO {
  index: number;
  paraId: string | null;
  text: string;
  styleId: string | null;
  /** Heading level: 1..n for Heading{n}, 0 for Title/Subtitle, null for body. */
  level: number | null;
  alignment: string | null;
}

export interface DocumentContent {
  id: string;
  title: string;
  language: string | null;
  // Read-only docs (tables / content controls) can be viewed & previewed but not
  // edited in place yet — the editor disables mutation controls when true.
  readOnly: boolean;
  paragraphs: ParagraphDTO[];
}

export interface ParagraphMutationResult {
  paragraph: ParagraphDTO;
  document: DocumentRecord;
}
