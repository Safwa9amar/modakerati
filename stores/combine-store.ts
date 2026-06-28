import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { classifyCombineParts, combineThesis, type PartRole } from "@/lib/api";
import type { Thesis } from "@/types/thesis";
import type { AnalysisReport } from "@/lib/api";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type CombineStatus =
  | "idle"
  | "picking"
  | "uploading"
  | "classifying"
  | "arranging"
  | "combining"
  | "done"
  | "error";

export interface CombinePart {
  id: string; // local id (filename + index)
  filename: string;
  base64: string;
  suggestedTitle: string;
  title: string; // user-editable
  role: PartRole;
  order: number;
  wordCount: number;
  pageCount: number;
}

interface CombineState {
  status: CombineStatus;
  parts: CombinePart[];
  normProfileId: string | null;
  title: string;
  thesis: Thesis | null;
  analysisReport: AnalysisReport | null;
  errorMessage: string | null;

  setNormProfileId: (id: string | null) => void;
  setTitle: (title: string) => void;
  setPartTitle: (id: string, title: string) => void;
  removePart: (id: string) => void;
  reorder: (from: number, to: number) => void;
  pickAndClassify: () => Promise<"ok" | "canceled" | "error">;
  combine: () => Promise<"ok" | "error">;
  reset: () => void;
}

const INITIAL = {
  status: "idle" as CombineStatus,
  parts: [] as CombinePart[],
  normProfileId: null as string | null,
  title: "",
  thesis: null as Thesis | null,
  analysisReport: null as AnalysisReport | null,
  errorMessage: null as string | null,
};

function renumber(parts: CombinePart[]): CombinePart[] {
  return parts.map((p, i) => ({ ...p, order: i }));
}

export const useCombineStore = create<CombineState>((set, get) => ({
  ...INITIAL,

  setNormProfileId: (id) => set({ normProfileId: id }),
  setTitle: (title) => set({ title }),
  setPartTitle: (id, title) =>
    set((s) => ({ parts: s.parts.map((p) => (p.id === id ? { ...p, title } : p)) })),
  removePart: (id) => set((s) => ({ parts: renumber(s.parts.filter((p) => p.id !== id)) })),
  reorder: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.parts.length || to >= s.parts.length) {
        return s;
      }
      const next = [...s.parts];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { parts: renumber(next) };
    }),

  pickAndClassify: async () => {
    set({ status: "picking", errorMessage: null });

    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: [DOCX_MIME],
        multiple: true,
        copyToCacheDirectory: true,
      });
    } catch {
      set({ status: "error", errorMessage: "Could not open the file picker" });
      return "error";
    }

    if (picked.canceled || !picked.assets?.length) {
      set({ status: "idle" });
      return "canceled";
    }
    const docx = picked.assets.filter((a) => /\.docx$/i.test(a.name ?? ""));
    if (docx.length < 2) {
      set({ status: "error", errorMessage: "Pick at least 2 .docx files" });
      return "error";
    }

    set({ status: "uploading" });
    try {
      const raw = await Promise.all(
        docx.map(async (a, i) => ({
          id: `${a.name ?? "part"}-${i}`,
          filename: a.name ?? `part-${i}.docx`,
          base64: await FileSystem.readAsStringAsync(a.uri, {
            encoding: FileSystem.EncodingType.Base64,
          }),
        }))
      );

      set({ status: "classifying" });
      const { parts: classified, suggestedOrder } = await classifyCombineParts(
        raw.map((r) => ({ filename: r.filename, base64: r.base64 }))
      );
      const byName = new Map(classified.map((c) => [c.filename, c]));

      const order = suggestedOrder.length ? suggestedOrder : raw.map((r) => r.filename);
      const parts: CombinePart[] = order
        .map((fn) => {
          const r = raw.find((x) => x.filename === fn);
          const c = byName.get(fn);
          if (!r || !c) return null;
          return {
            id: r.id,
            filename: fn,
            base64: r.base64,
            suggestedTitle: c.suggestedTitle,
            title: c.suggestedTitle,
            role: c.role,
            order: 0,
            wordCount: c.wordCount,
            pageCount: c.pageCount,
          } as CombinePart;
        })
        .filter((p): p is CombinePart => p !== null);

      set({ status: "arranging", parts: renumber(parts) });
      return "ok";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Classification failed";
      set({ status: "error", errorMessage: message });
      return "error";
    }
  },

  combine: async () => {
    const { parts, normProfileId, title } = get();
    if (parts.length < 2) {
      set({ status: "error", errorMessage: "Need at least 2 parts" });
      return "error";
    }
    set({ status: "combining", errorMessage: null });
    try {
      const { thesis, analysisReport } = await combineThesis({
        title: title.trim() || parts[0].title || "Combined thesis",
        normProfileId: normProfileId || undefined,
        parts: [...parts]
          .sort((a, b) => a.order - b.order)
          .map((p) => ({ filename: p.filename, base64: p.base64, title: p.title, order: p.order })),
      });
      set({ status: "done", thesis, analysisReport });
      return "ok";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Combine failed";
      set({ status: "error", errorMessage: message });
      return "error";
    }
  },

  reset: () => set(INITIAL),
}));
