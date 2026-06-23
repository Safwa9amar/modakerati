import { create } from "zustand";

export interface WizardPlanSection {
  title: string;
  kind: "introduction" | "section" | "conclusion";
  chapters: { title: string; hint?: string; content?: string }[];
}
interface WizardState {
  title: string;
  language: string;
  templateId: string | null;
  plan: WizardPlanSection[] | null;
  set: (patch: Partial<Pick<WizardState, "title" | "language" | "templateId" | "plan">>) => void;
  reset: () => void;
}
export const useThesisWizard = create<WizardState>((set) => ({
  title: "",
  language: "fr",
  templateId: null,
  plan: null,
  set: (patch) => set(patch),
  reset: () => set({ title: "", language: "fr", templateId: null, plan: null }),
}));
