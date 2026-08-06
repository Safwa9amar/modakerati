import { create } from "zustand";
import type { CaptionNumberFormat, CaptionSeparator } from "@/lib/api";

/** Insert a new caption for a block, or re-word one that already exists. */
export type CaptionMode = "insert" | "edit";

interface CaptionSheetState {
  open: boolean;
  thesisId: string | null;
  mode: CaptionMode;
  /**
   * INSERT: the block the caption describes (figure / table / equation).
   * EDIT:   the caption paragraph's own block index.
   * Both are engine block indices, the same space the document DTO uses.
   */
  index: number;
  /** What the caption is being written for — only used to pre-pick a label. */
  kind: "figure" | "table" | "equation";
  /** The wording the sheet opens with (the current caption, in edit mode). */
  text: string;
  /** Bumped whenever the sheet targets a block, so the Writer scrolls it into view —
   *  the sheet covers the lower half and the student is captioning something they
   *  need to SEE. Mirrors the header/footer sheet's revealNonce. */
  revealNonce: number;

  openInsert: (p: { thesisId: string; index: number; kind: CaptionSheetState["kind"] }) => void;
  openEdit: (p: { thesisId: string; index: number; text: string }) => void;
  close: () => void;
}

/**
 * State for the Caption sheet — the app's version of Word's References → Insert
 * Caption dialog (components/CaptionSheet).
 *
 * Deliberately NOT part of the block toolbar store: a caption is a document object
 * with its own numbering options (label, format, chapter numbers, separator), which
 * never fit in a pill hovering over the page — the same reason the header/footer
 * editor became a sheet. The picture bubble, the References/Picture ribbon tabs and
 * the AI dock all open this one surface.
 *
 * The sheet holds no draft of the numbering options here: they're local to the panel
 * and only matter until Insert is pressed. What lives in the store is WHICH block is
 * being captioned, which is what the Writer needs to reveal.
 */
export const useCaptionSheetStore = create<CaptionSheetState>((set) => ({
  open: false,
  thesisId: null,
  mode: "insert",
  index: 0,
  kind: "figure",
  text: "",
  revealNonce: 0,

  openInsert: ({ thesisId, index, kind }) =>
    set((s) => ({
      open: true, thesisId, mode: "insert", index, kind, text: "",
      revealNonce: s.revealNonce + 1,
    })),

  openEdit: ({ thesisId, index, text }) =>
    set((s) => ({
      open: true, thesisId, mode: "edit", index, kind: "figure", text,
      revealNonce: s.revealNonce + 1,
    })),

  close: () => set({ open: false }),
}));

/** Word's Caption Numbering → Format list, in the dialog's order. */
export const CAPTION_FORMATS: { value: CaptionNumberFormat; sample: string }[] = [
  { value: "arabic", sample: "1, 2, 3" },
  { value: "ALPHABETIC", sample: "A, B, C" },
  { value: "alphabetic", sample: "a, b, c" },
  { value: "ROMAN", sample: "I, II, III" },
  { value: "roman", sample: "i, ii, iii" },
];

/** Word's "Use separator" list. */
export const CAPTION_SEPARATORS: CaptionSeparator[] = ["-", ".", ":", "–", "—"];

/** Render the number a caption WOULD get, so the sheet's preview reads like Word's. */
export function previewNumber(n: number, format: CaptionNumberFormat): string {
  if (format === "ALPHABETIC" || format === "alphabetic") {
    const letter = String.fromCharCode(65 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
    return format === "alphabetic" ? letter.toLowerCase() : letter;
  }
  if (format === "ROMAN" || format === "roman") {
    const pairs: [number, string][] = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
      [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
    ];
    let out = "";
    let rest = n;
    for (const [v, sym] of pairs) while (rest >= v) { out += sym; rest -= v; }
    return format === "roman" ? out.toLowerCase() : out;
  }
  return String(n);
}
