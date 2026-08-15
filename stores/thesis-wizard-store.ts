import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

// PERSISTED to AsyncStorage so an app quit, crash, or Metro reload never loses the
// student's in-progress thesis inputs. Only the collected values are persisted (not
// the methods); reset() — called on a successful create — clears the saved draft too.
export const useThesisWizard = create<WizardState>()(
  persist(
    (set) => ({
      ...INITIAL,
      set: (patch) => set(patch),
      reset: () => set({ ...INITIAL, brief: { ...EMPTY_BRIEF } }),
    }),
    {
      name: "kwill-thesis-wizard",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        step: s.step,
        title: s.title,
        language: s.language,
        templateId: s.templateId,
        normProfileId: s.normProfileId,
        supervisor: s.supervisor,
        academicYear: s.academicYear,
        fieldValues: s.fieldValues,
        brief: s.brief,
        plan: s.plan,
      }),
      version: 1,
    },
  ),
);
