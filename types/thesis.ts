export type ThesisStatus = "active" | "completed" | "archived";
export type ChapterStatus = "not_started" | "in_progress" | "done";
export type SectionKind = "introduction" | "section" | "conclusion";

// Chapter = content leaf ("Chapitre"), belongs to a Section.
export interface Chapter {
  id: string;
  sectionId: string;
  title: string;
  content: string;          // markdown (#/##/### headings, tables, figures)
  orderIndex: number;
  wordCount: number;
  status: ChapterStatus;
}

// Section = top container ("Partie").
export interface Section {
  id: string;
  thesisId: string;
  title: string;
  kind: SectionKind;
  content?: string | null;  // markdown, for intro/conclusion-style sections
  orderIndex: number;
  chapters: Chapter[];
}

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
  sections: Section[];
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
  };
  frontMatter: {
    pageDeGarde: string[];
    ficheSynoptique: boolean; remerciements: boolean; dedicace: boolean;
    resumeLanguages: Array<"ar" | "fr" | "en">; resumePlacement: "front" | "back";
    sommaire: boolean; listeTableaux: boolean; listeFigures: boolean; listeAbreviations: boolean;
  };
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
