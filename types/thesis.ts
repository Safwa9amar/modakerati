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

export interface TemplateField {
  key: string;
  type: "text" | "multiline" | "year";
  required: boolean;
  prefill?: "profile.fullName" | "profile.university" | "profile.department" | "currentYear";
}

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
    placeholderFields?: TemplateField[]; // auto-detected fields the create wizard collects
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

/** One of the 130 Algerian institutions, from the server's `universities` table. */
export interface University {
  id: string;              // uuid — what we store as profiles.universityId
  sourceId: number;        // natural key from the seed catalogue
  nameFr: string;
  nameAr: string;
  nameEn: string;
  city: string;
  cityAr: string;
  wilaya: string;
  wilayaCode: number | null;
  type: "university" | "ecole" | "ens" | "centre_universitaire";
  website: string;
  logoUrl: string | null;  // mirrored into our own bucket; null for ~40% of rows
}

/**
 * How well a starting point matches the student, 1 (best) to 5.
 * The server ranks these; the app only renders them.
 */
export type StartingPointRung = 1 | 2 | 3 | 4 | 5;

/**
 * Stable key for why this result was offered. The app maps these to trilingual
 * copy. THE HONESTY RULE: `peer-rules` and `national` come with no university
 * name or crest (the server nulls them), because those rules are not the
 * student's institution's — never present them as if they were.
 */
export type StartingPointReason =
  | "exact"
  | "same-university-adapted"
  | "own-rules"
  | "peer-rules"
  | "national";

export interface StartingPointDisplay {
  title: string | null;           // template name; null when rules-only
  thumbUrl: string | null;
  hasDocument: boolean;
  universityName: string | null;  // null at rungs 4 and 5, by design
  logoUrl: string | null;         // same
  language: string;
  discipline: string;
  citationStyle: string;
  bindingSide: string;
}

export interface StartingPoint {
  kind: "template" | "profile";
  templateId: string | null;
  normProfileId: string;
  rung: StartingPointRung;
  reason: StartingPointReason;
  display: StartingPointDisplay;
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
