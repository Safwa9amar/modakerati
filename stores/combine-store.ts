import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { classifyCombineParts, combineThesis, type PartRole, type ClassifyFailure } from "@/lib/api";
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
  /** This file is the rest of the part above it (a chapter split across two
   *  documents), not a section of its own. */
  continuesPrevious: boolean;
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

  // Real progress for the local read pass, so the processing screen can show a
  // determinate bar instead of an indeterminate spinner. Reading a 900 KB .docx
  // to base64 on a phone is seconds of work per file, and it is the ONLY part of
  // the flow the client can actually measure.
  readDone: number;
  readTotal: number;
  /** Total bytes picked — the "6 files · 2.1 MB" line while we work. */
  totalBytes: number;
  /** How much of the request body has reached the server, 0..1. */
  uploadProgress: number;
  /** Whether the server's part labels came from the model or its content fallback. */
  classifiedBy: "ai" | "heuristic" | null;
  /** Why the model call failed, when it did — decides which notice is shown. */
  classifyReason: ClassifyFailure | null;
  /**
   * true  — the full setup: chapter headings, numbering, divider pages and one
   *         font from the chosen standard.
   * false — join the files and nothing else; each part keeps its own formatting
   *         and simply starts its own section.
   */
  fullSetup: boolean;

  setNormProfileId: (id: string | null) => void;
  setFullSetup: (full: boolean) => void;
  setTitle: (title: string) => void;
  setPartTitle: (id: string, title: string) => void;
  toggleContinuesPrevious: (id: string) => void;
  removePart: (id: string) => void;
  reorder: (from: number, to: number) => void;
  /**
   * `onPicked` fires the moment the OS picker hands back a valid selection —
   * BEFORE the reads and the classify round trip, which together run for tens of
   * seconds. The caller uses it to put the processing screen on screen; without
   * it the app sits on the previous page looking dead for the whole job.
   */
  pickAndClassify: (opts?: { onPicked?: (fileCount: number) => void }) => Promise<
    "ok" | "canceled" | "error"
  >;
  /**
   * Ask the model again with the files already in memory. The student never
   * re-picks: the base64 is still here, only the classify call is repeated.
   */
  reclassify: () => Promise<"ok" | "error">;
  /** Keep the names the content rules produced and move on to arranging. */
  acceptHeuristicNames: () => void;
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
  readDone: 0,
  readTotal: 0,
  totalBytes: 0,
  uploadProgress: 0,
  classifiedBy: null as "ai" | "heuristic" | null,
  classifyReason: null as ClassifyFailure | null,
  fullSetup: true,
};

function renumber(parts: CombinePart[]): CombinePart[] {
  return parts.map((p, i) => ({ ...p, order: i }));
}

/** Ignore case, accents and the "1-"/"2-" prefixes students number copies with. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/^\d+\s*[-.)]*\s*/, "")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "");
}

/**
 * Pre-tick "continues the previous part" where two consecutive uploads are
 * plainly halves of one section — `1-Introduction générale.docx` followed by
 * `2-Introduction générale.docx`. It is only a first guess: the checkbox on
 * each card is what decides, and the student can clear it.
 */
function markContinuations(parts: CombinePart[]): CombinePart[] {
  return parts.map((p, i) => {
    if (i === 0) return p;
    const prev = parts[i - 1];
    const sameTitle = titleKey(p.title) === titleKey(prev.title);
    return { ...p, continuesPrevious: sameTitle && p.role === prev.role };
  });
}

/** The classify round trip, shared by the first pass and every retry. */
async function runClassify(
  set: (partial: Partial<CombineState>) => void,
  files: { id: string; filename: string; base64: string }[],
): Promise<void> {
  const { parts: classified, suggestedOrder, classifiedBy, classifyReason } =
    await classifyCombineParts(
      files.map((f) => ({ filename: f.filename, base64: f.base64 })),
      { onUploadProgress: (uploadProgress) => set({ uploadProgress }) },
    );
  const byName = new Map(classified.map((c) => [c.filename, c]));

  const order = suggestedOrder.length ? suggestedOrder : files.map((f) => f.filename);
  const parts: CombinePart[] = order
    .map((fn) => {
      const f = files.find((x) => x.filename === fn);
      const c = byName.get(fn);
      if (!f || !c) return null;
      return {
        id: f.id,
        continuesPrevious: false,
        filename: fn,
        base64: f.base64,
        suggestedTitle: c.suggestedTitle,
        title: c.suggestedTitle,
        role: c.role,
        order: 0,
        wordCount: c.wordCount,
        pageCount: c.pageCount,
      } as CombinePart;
    })
    .filter((p): p is CombinePart => p !== null);

  set({
    status: "arranging",
    parts: renumber(markContinuations(parts)),
    classifiedBy: classifiedBy ?? null,
    classifyReason: classifyReason ?? null,
  });
}

export const useCombineStore = create<CombineState>((set, get) => ({
  ...INITIAL,

  setNormProfileId: (id) => set({ normProfileId: id }),
  setFullSetup: (full) => set({ fullSetup: full }),
  toggleContinuesPrevious: (id) =>
    set((s) => ({
      parts: s.parts.map((p, i) =>
        // The first part has nothing above it to continue.
        p.id === id && i > 0 ? { ...p, continuesPrevious: !p.continuesPrevious } : p,
      ),
    })),
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

  pickAndClassify: async (opts) => {
    set({ status: "picking", errorMessage: null, readDone: 0, readTotal: 0, totalBytes: 0 });

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

    set({
      status: "uploading",
      readDone: 0,
      readTotal: docx.length,
      totalBytes: docx.reduce((n, a) => n + (a.size ?? 0), 0),
    });
    // The picker is closed and the selection is valid: show the work now, because
    // everything below this line is the slow part.
    opts?.onPicked?.(docx.length);

    try {
      const raw = await Promise.all(
        docx.map(async (a, i) => {
          const base64 = await FileSystem.readAsStringAsync(a.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          // Counted as each read lands (not in pick order) — the number only ever
          // reflects files actually in memory.
          set((s) => ({ readDone: s.readDone + 1 }));
          return {
            id: `${a.name ?? "part"}-${i}`,
            filename: a.name ?? `part-${i}.docx`,
            base64,
          };
        })
      );

      set({ status: "classifying" });
      await runClassify(set, raw);
      return "ok";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Classification failed";
      set({ status: "error", errorMessage: message });
      return "error";
    }
  },

  reclassify: async () => {
    const files = get().parts.map((p) => ({ id: p.id, filename: p.filename, base64: p.base64 }));
    if (files.length === 0) return "error";
    set({ status: "classifying", errorMessage: null });
    try {
      await runClassify(set, files);
      return "ok";
    } catch (err) {
      set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Classification failed",
      });
      return "error";
    }
  },

  acceptHeuristicNames: () => set({ classifiedBy: null, classifyReason: null }),

  combine: async () => {
    const { parts, normProfileId, title, fullSetup } = get();
    if (parts.length < 2) {
      set({ status: "error", errorMessage: "Need at least 2 parts" });
      return "error";
    }
    set({ status: "combining", errorMessage: null, uploadProgress: 0 });
    try {
      const { thesis, analysisReport } = await combineThesis({
        title: title.trim() || parts[0].title || "Combined thesis",
        normProfileId: normProfileId || undefined,
        structure: fullSetup ? "full" : "plain",
        parts: [...parts]
          .sort((a, b) => a.order - b.order)
          .map((p) => ({
            filename: p.filename,
            base64: p.base64,
            title: p.title,
            order: p.order,
            role: p.role,
            continuesPrevious: p.continuesPrevious,
          })),
      }, { onUploadProgress: (uploadProgress) => set({ uploadProgress }) });
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
