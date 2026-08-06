import { create } from "zustand";

/** Which running band the sheet is acting on. `null` while the student is still
 *  choosing which part to ADD to a section that has neither. */
export type HfRegion = "header" | "footer";

interface HfSheetState {
  open: boolean;
  thesisId: string | null;
  /** A block index INSIDE the target Word section — the server resolves the section
   *  from it (same contract as every /chrome-op call). */
  index: number;
  region: HfRegion | null;
  /** The band's current text, which grounds the AI request. */
  text: string;
  /** Add mode: which parts the section is still missing. Both false in edit mode. */
  canAddHeader: boolean;
  canAddFooter: boolean;
  /** Bumped every time the sheet targets a band, so the Writer scrolls that band into
   *  view. The sheet covers the lower two-thirds of the screen — without this the
   *  student is editing a header they cannot see. */
  revealNonce: number;
  /** A template or AI proposal rendered ON the real band in the Writer while the
   *  student browses — display-only, never persisted, reverted when cleared. `nonce`
   *  re-applies it as the {token} values are typed. */
  preview: { segments: string[]; text: string; nonce: number } | null;

  /** Tapping a running header / footer band in the document. */
  openBand: (p: { thesisId: string; index: number; region: HfRegion; text: string }) => void;
  /** The section bubble's "+" — the section is missing a header, a footer, or both. */
  openAdd: (p: { thesisId: string; index: number; hasHeader: boolean; hasFooter: boolean }) => void;
  /** After creating a part: the sheet stays open and switches to editing it. */
  editRegion: (region: HfRegion, text: string) => void;
  /** Show (or clear, with null) the live band preview. */
  setPreview: (p: { segments: string[]; text: string } | null) => void;
  close: () => void;
}

/**
 * The header/footer editor's own state, separate from the block toolbar's.
 *
 * These bands used to live in the floating bubble, where the ✦ panel — an instruction
 * input, a compiled preview, and a scrollable list of template cards — had to fit in a
 * pill hovering over the page. It's a bottom sheet now (see components/HeaderFooterSheet),
 * the same push-drawer surface as the Insert menu, so the whole flow has room and the
 * document stays readable behind it.
 */
export const useHfSheetStore = create<HfSheetState>((set) => ({
  open: false,
  thesisId: null,
  index: 0,
  region: null,
  text: "",
  canAddHeader: false,
  canAddFooter: false,
  revealNonce: 0,
  preview: null,

  openBand: ({ thesisId, index, region, text }) =>
    set((s) => ({
      open: true, thesisId, index, region, text,
      canAddHeader: false, canAddFooter: false,
      revealNonce: s.revealNonce + 1,
    })),

  // No reveal yet: there is no band to show until one is created.
  openAdd: ({ thesisId, index, hasHeader, hasFooter }) =>
    set({
      open: true,
      thesisId,
      index,
      region: null,
      text: "",
      canAddHeader: !hasHeader,
      canAddFooter: !hasFooter,
    }),

  // A part was just created — reveal the band it produced.
  editRegion: (region, text) =>
    set((s) => ({ region, text, canAddHeader: false, canAddFooter: false, revealNonce: s.revealNonce + 1 })),

  setPreview: (p) =>
    set((s) => ({ preview: p ? { ...p, nonce: (s.preview?.nonce ?? 0) + 1 } : null })),

  // Closing always drops the preview — the band must go back to what's actually saved.
  close: () => set({ open: false, region: null, text: "", canAddHeader: false, canAddFooter: false, preview: null }),
}));
