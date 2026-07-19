export type ThesisStatus = "active" | "completed" | "archived";

// Structure (Partie/Chapitre) is no longer modeled in the DB/app — the working
// .docx is the single source of truth. The detail screen derives the outline
// from it via GET /api/thesis/:id/outline (see OutlineDTO in lib/api.ts).

export interface ResumeBlock {
  language: "ar" | "fr" | "en";
  body: string;
  keywords: string[];
}

export interface ThesisFrontMatter {
  university?: string; faculty?: string; department?: string; field?: string;
  specialty?: string; degree?: string; theme?: string;
  authors?: string[]; supervisor?: string; coSupervisor?: string;
  jury?: string[]; academicYear?: string; city?: string;
  ficheSynoptique?: string; acknowledgements?: string; dedication?: string;
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
  frontMatter?: ThesisFrontMatter;
  resume?: ResumeBlock[];
  createdAt: string;
  updatedAt: string;
}

export type CitationStyle = "apa" | "footnote-ar";
export type Discipline = "science" | "law-humanities" | "generic";
export type BodyPreset = "imrad" | "chapters" | "law-humanities";

export interface Template {
  id: string;
  university: string;
  type: string;
  language: "ar" | "fr" | "en";
  name: string;
  discipline: Discipline;
  bindingSide: "left" | "right";
  citationStyle: CitationStyle;
  bodyPreset: BodyPreset;
  config: {
    margins: { top: string; bottom: string; left: string; right: string };
    bodyFont: string; bodySize: string; headingFont: string; lineSpacing: string; paperSize: string;
    pdfUrl?: string; // optional public URL to the template's PDF version
    thumbUrl?: string; // optional public URL to the template's preview image / thumbnail
  };
  frontMatter: {
    pageDeGarde: string[];
    ficheSynoptique: boolean; remerciements: boolean; dedicace: boolean;
    resumeLanguages: Array<"ar" | "fr" | "en">; resumePlacement: "front" | "back";
    sommaire: boolean; listeTableaux: boolean; listeFigures: boolean; listeAbreviations: boolean;
  };
  coverTemplate?: string;
  bodyStructure?: Array<{
    title: string;
    kind: "introduction" | "section" | "conclusion";
    chapters: Array<{ title: string; content?: string }>;
  }>;
  structure: { sectionLabel: string; chapterLabel: string };
  styleMap: {
    section: "dividerPage" | "Heading1";
    chapter: "Heading1" | "Heading2";
    contentHeadings: ["Heading2", "Heading3", "Heading4"];
    useDirectFormatting?: boolean;
    headingSizes?: Record<string, number>;
  };
  chapterStructure: string[]; // legacy seed (used as section titles for generic preset)
}

export interface NormProfile {
  id: string;
  name: string;
  university: string | null;
  language: string;
  discipline: Discipline;
  bodyPreset: BodyPreset;
  citationStyle: CitationStyle;
  bindingSide: "left" | "right";
  formatting?: {
    font: string;
    fontSize: number;
    headingSizes: { h1: number; h2: number; h3: number };
    margins: { binding: number; opposite: number; top: number; bottom: number };
    spacing: number;
    footnoteFontSize: number;
    alignment: string;
  };
}
