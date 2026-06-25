import { create } from "zustand";

export interface WizardPlanSection {
  title: string;
  kind: "introduction" | "section" | "conclusion";
  chapters: { title: string; hint?: string; content?: string }[];
}

export type WizardStep = "template" | "title" | "plan" | "confirm";

interface WizardState {
  step: WizardStep;
  title: string;
  language: string;
  templateId: string | null;
  normProfileId: string | null;
  supervisor: string;
  academicYear: string;
  plan: WizardPlanSection[] | null;
  set: (patch: Partial<Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "plan">>) => void;
  reset: () => void;
}

const INITIAL: Pick<WizardState, "step" | "title" | "language" | "templateId" | "normProfileId" | "supervisor" | "academicYear" | "plan"> = {
  step: "template",
  title: "",
  language: "fr",
  templateId: null,
  normProfileId: null,
  supervisor: "",
  academicYear: "",
  plan: null,
};

export const useThesisWizard = create<WizardState>((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  reset: () => set(INITIAL),
}));
