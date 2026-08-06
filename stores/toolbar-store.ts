import { create } from "zustand";
import { chromeBubbleKind, resolveBubbleKind, type BubbleKind } from "@/lib/bubble-configs";
import type { DocBlockDTO } from "@/lib/api";

/** One toolbar component per kind — see components/workspace/bubble-tools/index.ts,
 *  which maps these 1:1 onto {Tools, Panel} modules. Same vocabulary as the collapsed
 *  bubble's icon registry (lib/bubble-configs), so the glyph and the toolset can never
 *  disagree. "ai" means nothing is selected: the AI dock owns that state, not a toolbar. */
export type ToolbarKind = BubbleKind;

/** A toolbar's open sub-panel. Each belongs to exactly one toolbar family — see
 *  ownsCategory, which is what keeps a panel from surviving into a selection that
 *  can't render it. */
export type ToolbarCategory =
  | "style" | "align" | "direction" | "list" | "color"
  | "tblRows" | "tblCols" | "tblLayout" | "tblShade" | "tblBorders"
  | "hfLink";

export type BorderStyleKey = "single" | "double" | "dashed" | "dotted" | "thick";

/**
 * THE SWITCH — pure, so both the collapsed bubble's icon and the expanded toolbar can
 * resolve the same answer synchronously during render (a store round-trip would show
 * one frame of the previous kind on every selection change).
 *
 * `listType` is the live Lexical block format when the Writer is active: a caret
 * inside a list outranks the DTO, which can't be trusted for list-ness.
 */
export function resolveToolbarKind(input: {
  block?: DocBlockDTO | null;
  listType?: string | null;
  chrome?: { kind: "top" | "bottom" | "section" } | null;
  count: number;
}): ToolbarKind {
  if (input.chrome) return chromeBubbleKind(input.chrome.kind);
  if (input.count === 0) return "ai";
  return resolveBubbleKind(input.block, input.listType);
}

/** Which toolbar family renders a given sub-panel. A category that the incoming kind
 *  doesn't own is dropped on selection change — otherwise a table's Rows panel would
 *  linger over a paragraph, with nothing to render it. */
export function ownsCategory(kind: ToolbarKind, category: ToolbarCategory): boolean {
  switch (category) {
    case "style":
    case "align":
    case "direction":
    case "list":
    case "color":
      return kind === "text" || kind === "heading" || kind === "list";
    case "tblRows":
    case "tblCols":
    case "tblLayout":
    case "tblShade":
    case "tblBorders":
      return kind === "table";
    case "hfLink":
      return kind === "hfSection";
  }
}

/**
 * Entry rules — what a freshly selected target opens with: a heading reveals Style when
 * there's room for it (the wide form), since H1/H2/H3 is usually what you came for.
 * Everything else opens closed and keeps whatever panel the new kind still owns.
 *
 * (Header/footer bands used to auto-open their ✦ panel here. They no longer reach the
 * bubble at all — tapping one opens the header/footer sheet; see stores/hf-sheet-store.)
 */
function entryCategory(kind: ToolbarKind, wideForm: boolean): ToolbarCategory | null {
  if (kind === "heading" && wideForm) return "style";
  return null;
}

interface ToolbarState {
  /** Which toolbar the current selection resolves to. */
  kind: ToolbarKind;
  /** Target identity — the selected indices, or "top:12" for a chrome band. Two
   *  different blocks of the same kind are still different targets. */
  targetKey: string;
  /** The open sub-panel, or null. */
  category: ToolbarCategory | null;
  /** (+) More — the full toolset instead of the curated compact one. Deliberately NOT
   *  reset per target: moving block→block keeps the pill open, as it did when this was
   *  component state. */
  expanded: boolean;
  /** True while the toolbar is the keyboard-docked bar, which always shows the full
   *  toolset. With `expanded` it forms the "wide form" the entry rules read. */
  keyboardOpen: boolean;
  /** Table Rows/Columns panels: "pick the row/column to delete" mode. */
  delPick: "row" | "col" | null;
  /** Border picker state — a user preference, so it deliberately survives selection
   *  changes (the next table starts from the style you last chose). */
  border: { style: BorderStyleKey; sizePt: number; color: string };
  /** Block index whose figure is open in the crop modal (the shell renders it). */
  cropIndex: number | null;

  /** Point the store at the current selection. Idempotent — safe to call every render
   *  from a layout effect; it only does work when the target actually changed. */
  syncTarget: (target: { kind: ToolbarKind; key: string }) => void;

  /** Open a sub-panel. Separate from closeCategory on purpose — opening and closing
   *  are different transitions with different animations (see lib/motion.ts), and
   *  keeping them apart is what lets lib/pill-swap.ts tell a REPLACEMENT (one panel
   *  for another) from a plain open or a plain close. */
  openCategory: (c: ToolbarCategory) => void;
  closeCategory: () => void;
  /** Tap a category chip: opens it, or closes it if it's the one already open. */
  toggleCategory: (c: ToolbarCategory) => void;
  /** (+) More / ✕ — likewise split, so each direction owns its own animation. */
  openMore: () => void;
  closeMore: () => void;
  setKeyboardOpen: (v: boolean) => void;
  setDelPick: (v: "row" | "col" | null) => void;
  setBorder: (patch: Partial<ToolbarState["border"]>) => void;
  setCropIndex: (v: number | null) => void;
}

export const useToolbarStore = create<ToolbarState>((set) => ({
  kind: "text",
  targetKey: "",
  category: null,
  expanded: false,
  keyboardOpen: false,
  delPick: null,
  border: { style: "single", sizePt: 0.5, color: "000000" },
  cropIndex: null,

  syncTarget: ({ kind, key }) =>
    set((s) => {
      if (kind === s.kind && key === s.targetKey) return {};
      // Only a KIND change re-runs the entry rule — moving between two headings must
      // not keep re-opening a panel the student just closed.
      const entry = kind !== s.kind ? entryCategory(kind, s.keyboardOpen || s.expanded) : null;
      const kept = s.category && ownsCategory(kind, s.category) ? s.category : null;
      return { kind, targetKey: key, delPick: null, category: entry ?? kept };
    }),

  // Leaving or entering a category always exits the table delete-pick mode.
  openCategory: (category) => set({ category, delPick: null }),
  closeCategory: () => set({ category: null, delPick: null }),
  toggleCategory: (c) => set((s) => ({ category: s.category === c ? null : c, delPick: null })),
  openMore: () => set({ expanded: true }),
  closeMore: () =>
    set((s) => ({
      expanded: false,
      // A heading in the COMPACT form has no sub-panel — its H1…Hn chips ARE the
      // toolset — so collapsing takes the Style panel with it.
      category: !s.keyboardOpen && s.kind === "heading" ? null : s.category,
    })),
  setKeyboardOpen: (v) =>
    set((s) => ({
      keyboardOpen: v,
      category: !v && !s.expanded && s.kind === "heading" ? null : s.category,
    })),
  setDelPick: (delPick) => set({ delPick }),
  setBorder: (patch) => set((s) => ({ border: { ...s.border, ...patch } })),
  setCropIndex: (cropIndex) => set({ cropIndex }),
}));
