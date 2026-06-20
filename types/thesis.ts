export type ThesisStatus = "active" | "completed" | "archived";
export type ChapterStatus = "not_started" | "in_progress" | "done";

export interface Section {
  id: string;
  chapterId: string;
  title: string;
  content: string;
  orderIndex: number;
  wordCount: number;
  status: ChapterStatus;
}

export interface Chapter {
  id: string;
  thesisId: string;
  title: string;
  orderIndex: number;
  status: ChapterStatus;
  sections: Section[];
}

export interface Thesis {
  id: string;
  title: string;
  templateId?: string;
  language: string;
  status: ThesisStatus;
  progress: number;
  wordCount: number;
  pageCount: number;
  chapters: Chapter[];
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  university: string;
  type: string;
  language: string;
  name: string;
  config: {
    margins: { top: string; bottom: string; left: string; right: string };
    bodyFont: string;
    bodySize: string;
    headingFont: string;
    lineSpacing: string;
    paperSize: string;
  };
  chapterStructure: string[];
}
