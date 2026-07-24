import { create } from "zustand";

export interface WizardPlanSection {
  title: string;
  kind: "introduction" | "section" | "conclusion";
  chapters: { title: string; hint?: string; content?: string }[];
}

export interface WizardBrief {
  description: string;
  objectives: string;
  keywords: string;
  methodology: string;
}

export type WizardStep = "template" | "title" | "topic" | "fields" | "plan" | "confirm";

interface WizardState {
  step: WizardStep;
  title: string;
  language: string;
  templateId: string | null;
  normProfileId: string | null;
  supervisor: string;
  academicYear: string;
  fieldValues: Record<string, string>;
  brief: WizardBrief;
  plan: WizardPlanSection[] | null;
  set: (patch: Partial<Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "fieldValues" | "brief" | "plan">>) => void;
  reset: () => void;
}

const EMPTY_BRIEF: WizardBrief = { description: "", objectives: "", keywords: "", methodology: "" };

const INITIAL: Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "fieldValues" | "brief" | "plan"> = {
  step: "template",
  title: "",
  language: "fr",
  templateId: null,
  normProfileId: null,
  supervisor: "",
  academicYear: "",
  fieldValues: {},
  brief: EMPTY_BRIEF,
  plan: null,
};

export const useThesisWizard = create<WizardState>((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  reset: () => set({ ...INITIAL, brief: { ...EMPTY_BRIEF } }),
}));
