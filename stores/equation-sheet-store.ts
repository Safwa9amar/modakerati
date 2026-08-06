import { create } from "zustand";

/** Write a new equation, or open one the document already has. */
export type EquationMode = "insert" | "edit";

interface EquationSheetState {
  open: boolean;
  thesisId: string | null;
  mode: EquationMode;
  /**
   * INSERT: the block the new equation goes AFTER.
   * EDIT:   the block whose equation is being changed.
   * Both are engine block indices, the same space the document DTO uses.
   */
  index: number;
  /** The LaTeX the sheet opens with — an existing equation's, or "" for a new one.
   *  The server hands back LaTeX for ANY OMML, so an imported thesis's formulae
   *  open here too rather than being frozen. */
  latex: string;
  /** An existing equation's number ("(I.1)"), shown so the student knows it is kept. */
  number: string;
  /** Bumped whenever the sheet targets a block, so the Writer scrolls it into view —
   *  the sheet covers the lower half and the student is editing something they need
   *  to SEE. Mirrors the caption sheet's revealNonce. */
  revealNonce: number;

  openInsert: (p: { thesisId: string; index: number }) => void;
  openEdit: (p: { thesisId: string; index: number; latex: string; number?: string }) => void;
  close: () => void;
}

/**
 * State for the Equation sheet — the app's version of Word's Insert → Equation.
 *
 * A sheet rather than a pill, for the same reason captions got one: an equation is
 * a document OBJECT with its own editor (a LaTeX field, a live preview, a symbol
 * palette, an optional number), none of which fits in a bar hovering over the page.
 * The block bubble opens it; so can the AI dock.
 *
 * The draft LaTeX lives in the panel, not here — it only matters until Save. What
 * the store holds is WHICH equation is being written, which is what the Writer
 * needs in order to reveal it.
 */
export const useEquationSheetStore = create<EquationSheetState>((set) => ({
  open: false,
  thesisId: null,
  mode: "insert",
  index: 0,
  latex: "",
  number: "",
  revealNonce: 0,

  openInsert: ({ thesisId, index }) =>
    set((s) => ({
      open: true, thesisId, mode: "insert", index, latex: "", number: "",
      revealNonce: s.revealNonce + 1,
    })),

  openEdit: ({ thesisId, index, latex, number }) =>
    set((s) => ({
      open: true, thesisId, mode: "edit", index, latex, number: number ?? "",
      revealNonce: s.revealNonce + 1,
    })),

  close: () => set({ open: false }),
}));

/**
 * The symbol palette. Each chip inserts its LaTeX at the caret; `caret` is where
 * the cursor should land afterwards, counted back from the END of the snippet, so
 * `\frac{}{}`  drops the caret inside the numerator rather than after the whole
 * thing. Grouped the way a student looks for them, not the way TeX groups them.
 */
export type MathSymbol = { label: string; latex: string; caret?: number };
export type MathSymbolGroup = { key: string; symbols: MathSymbol[] };

export const MATH_SYMBOLS: MathSymbolGroup[] = [
  {
    key: "structure",
    symbols: [
      { label: "a/b", latex: "\\frac{}{}", caret: 3 },
      { label: "xⁿ", latex: "^{}", caret: 1 },
      { label: "xₙ", latex: "_{}", caret: 1 },
      { label: "√", latex: "\\sqrt{}", caret: 1 },
      { label: "ⁿ√", latex: "\\sqrt[]{}", caret: 3 },
      { label: "∑", latex: "\\sum_{}^{}", caret: 4 },
      { label: "∏", latex: "\\prod_{}^{}", caret: 4 },
      { label: "∫", latex: "\\int_{}^{}", caret: 4 },
      { label: "lim", latex: "\\lim_{}", caret: 1 },
      { label: "( )", latex: "\\left( \\right)", caret: 8 },
      { label: "[ ]", latex: "\\left[ \\right]", caret: 8 },
      { label: "{", latex: "\\begin{cases}  \\\\  \\end{cases}", caret: 16 },
      { label: "matrix", latex: "\\begin{matrix}  &  \\\\  &  \\end{matrix}", caret: 22 },
      { label: "x̄", latex: "\\overline{}", caret: 1 },
      { label: "x̂", latex: "\\hat{}", caret: 1 },
      { label: "v⃗", latex: "\\vec{}", caret: 1 },
    ],
  },
  {
    key: "greek",
    symbols: [
      { label: "α", latex: "\\alpha " }, { label: "β", latex: "\\beta " },
      { label: "γ", latex: "\\gamma " }, { label: "δ", latex: "\\delta " },
      { label: "ε", latex: "\\epsilon " }, { label: "θ", latex: "\\theta " },
      { label: "λ", latex: "\\lambda " }, { label: "μ", latex: "\\mu " },
      { label: "ν", latex: "\\nu " }, { label: "π", latex: "\\pi " },
      { label: "ρ", latex: "\\rho " }, { label: "σ", latex: "\\sigma " },
      { label: "τ", latex: "\\tau " }, { label: "φ", latex: "\\phi " },
      { label: "ω", latex: "\\omega " }, { label: "Δ", latex: "\\Delta " },
      { label: "Σ", latex: "\\Sigma " }, { label: "Ω", latex: "\\Omega " },
    ],
  },
  {
    key: "operators",
    symbols: [
      { label: "±", latex: "\\pm " }, { label: "×", latex: "\\times " },
      { label: "÷", latex: "\\div " }, { label: "≤", latex: "\\leq " },
      { label: "≥", latex: "\\geq " }, { label: "≠", latex: "\\neq " },
      { label: "≈", latex: "\\approx " }, { label: "∞", latex: "\\infty " },
      { label: "∂", latex: "\\partial " }, { label: "∇", latex: "\\nabla " },
      { label: "→", latex: "\\to " }, { label: "∈", latex: "\\in " },
      { label: "⋅", latex: "\\cdot " }, { label: "∘", latex: "^\\circ " },
    ],
  },
  {
    key: "functions",
    symbols: [
      { label: "sin", latex: "\\sin " }, { label: "cos", latex: "\\cos " },
      { label: "tan", latex: "\\tan " }, { label: "ln", latex: "\\ln " },
      { label: "log", latex: "\\log " }, { label: "exp", latex: "\\exp " },
      { label: "max", latex: "\\max " }, { label: "min", latex: "\\min " },
    ],
  },
];

/**
 * Insert a symbol's LaTeX into `value` at the caret, and report where the caret
 * should land. A chip must never make the student hunt for the hole it left.
 */
export function insertSymbol(
  value: string,
  selection: { start: number; end: number },
  sym: MathSymbol,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  // Text the student had selected goes INSIDE the new structure — selecting `x+1`
  // and tapping √ should give √(x+1), not throw the selection away.
  const selected = value.slice(start, end);
  const hole = sym.caret ?? 0;
  const snippet = selected && hole > 0
    ? sym.latex.slice(0, sym.latex.length - hole) + selected + sym.latex.slice(sym.latex.length - hole)
    : sym.latex;
  return {
    value: value.slice(0, start) + snippet + value.slice(end),
    caret: start + snippet.length - (selected ? hole : hole),
  };
}
