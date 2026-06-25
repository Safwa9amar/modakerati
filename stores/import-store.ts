import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { importThesis, applyThesisSuggestions } from "@/lib/api";
import type { Thesis } from "@/types/thesis";
import type { AnalysisReport } from "@/lib/api";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ImportStatus = "idle" | "picking" | "uploading" | "analyzing" | "ready" | "applying" | "done" | "error";

interface ImportState {
  status: ImportStatus;
  thesis: Thesis | null;
  analysisReport: AnalysisReport | null;
  acceptedIds: string[];
  rejectedIds: string[];
  normProfileId: string | null;
  errorMessage: string | null;

  setNormProfileId: (id: string | null) => void;
  pickAndImport: () => Promise<"ok" | "canceled" | "error">;
  toggleSuggestion: (id: string) => void;
  acceptAll: () => void;
  applyAccepted: () => Promise<void>;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as ImportStatus,
  thesis: null as Thesis | null,
  analysisReport: null as AnalysisReport | null,
  acceptedIds: [] as string[],
  rejectedIds: [] as string[],
  normProfileId: null as string | null,
  errorMessage: null as string | null,
};

export const useImportStore = create<ImportState>((set, get) => ({
  ...INITIAL,

  setNormProfileId: (id) => set({ normProfileId: id }),

  pickAndImport: async () => {
    set({ status: "picking", errorMessage: null });

    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: [DOCX_MIME],
        copyToCacheDirectory: true,
      });
    } catch {
      set({ status: "error", errorMessage: "Could not open the file picker" });
      return "error";
    }

    if (picked.canceled || !picked.assets?.[0]) {
      set({ status: "idle" });
      return "canceled";
    }

    const asset = picked.assets[0];
    if (!/\.docx$/i.test(asset.name ?? "")) {
      set({ status: "error", errorMessage: "Please choose a .docx file" });
      return "error";
    }

    set({ status: "uploading" });
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      set({ status: "analyzing" });
      const { thesis, analysisReport } = await importThesis({
        base64,
        filename: asset.name ?? "document.docx",
        normProfileId: get().normProfileId || undefined,
      });

      const allIds = [
        ...(analysisReport?.structure ?? []),
        ...(analysisReport?.formatting ?? []),
        ...(analysisReport?.content ?? []),
      ].map((s) => s.id);

      set({
        status: "ready",
        thesis,
        analysisReport,
        acceptedIds: allIds,
        rejectedIds: [],
      });
      return "ok";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      set({ status: "error", errorMessage: message });
      return "error";
    }
  },

  toggleSuggestion: (id) => {
    const { acceptedIds, rejectedIds } = get();
    if (acceptedIds.includes(id)) {
      set({
        acceptedIds: acceptedIds.filter((i) => i !== id),
        rejectedIds: [...rejectedIds, id],
      });
    } else {
      set({
        acceptedIds: [...acceptedIds, id],
        rejectedIds: rejectedIds.filter((i) => i !== id),
      });
    }
  },

  acceptAll: () => {
    const { analysisReport } = get();
    if (!analysisReport) return;
    const allIds = [
      ...analysisReport.structure,
      ...analysisReport.formatting,
      ...analysisReport.content,
    ].map((s) => s.id);
    set({ acceptedIds: allIds, rejectedIds: [] });
  },

  applyAccepted: async () => {
    const { thesis, acceptedIds } = get();
    if (!thesis || acceptedIds.length === 0) {
      set({ status: "done" });
      return;
    }
    set({ status: "applying" });
    try {
      await applyThesisSuggestions(thesis.id, acceptedIds);
      set({ status: "done" });
    } catch {
      set({ status: "done" });
    }
  },

  reset: () => set(INITIAL),
}));
