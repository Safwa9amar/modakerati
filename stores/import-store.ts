import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { importThesis, applyThesisSuggestions } from "@/lib/api";
import { useBillingStore } from "@/stores/billing-store";
import { rememberThesisLimit, thesisLimitBody } from "@/lib/thesis-limit";
import { isThesisLimitError } from "@/types/billing";
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

  /** Name and size of the file being imported — the processing screen's subtitle. */
  fileName: string | null;
  totalBytes: number;
  /** How much of the body has reached the server, 0..1 — a real measurement. */
  uploadProgress: number;

  setNormProfileId: (id: string | null) => void;
  /**
   * `onPicked` fires the moment the picker hands back a valid .docx — BEFORE the
   * read and the server round trip, which together run for tens of seconds on a
   * real thesis. The caller uses it to put the processing screen on screen;
   * without it the app sits on the previous page looking dead for the whole job.
   */
  pickAndImport: (opts?: { onPicked?: (fileName: string) => void }) => Promise<
    "ok" | "canceled" | "error"
  >;
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
  fileName: null as string | null,
  totalBytes: 0,
  uploadProgress: 0,
};

export const useImportStore = create<ImportState>((set, get) => ({
  ...INITIAL,

  setNormProfileId: (id) => set({ normProfileId: id }),

  pickAndImport: async (opts) => {
    set({ status: "picking", errorMessage: null, fileName: null, totalBytes: 0 });

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

    set({
      status: "uploading",
      fileName: asset.name ?? "document.docx",
      totalBytes: asset.size ?? 0,
      uploadProgress: 0,
    });
    // The picker is closed and the file is valid: show the work now, because
    // everything below this line is the slow part.
    opts?.onPicked?.(asset.name ?? "document.docx");

    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { thesis, analysisReport } = await importThesis(
        {
          base64,
          filename: asset.name ?? "document.docx",
          normProfileId: get().normProfileId || undefined,
        },
        {
          onUploadProgress: (fraction) => {
            // The body is up; everything after this is the server working.
            set(fraction >= 1 ? { status: "analyzing", uploadProgress: 1 } : { uploadProgress: fraction });
          },
        },
      );

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
      // An import IS a new thesis — count it against the plan's ceiling, or the
      // next one is refused by the server rather than by the screen.
      useBillingStore.getState().noteThesisCreated();
      return "ok";
    } catch (err) {
      // The plan's thesis ceiling. AppDrawer asks before the picker opens, so
      // getting here means the count moved underneath this upload — show the same
      // wording rather than the server's fallback sentence.
      if (isThesisLimitError(err)) {
        rememberThesisLimit(err);
        set({ status: "error", errorMessage: thesisLimitBody(err) });
        return "error";
      }
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
