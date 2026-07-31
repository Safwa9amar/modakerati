import {
  ArrowDownToLine,
  Calculator,
  Combine,
  FileText,
  Languages,
  LayoutPanelTop,
  PenLine,
  Rows3,
  Scissors,
  StretchHorizontal,
  Table2,
  Type,
  WandSparkles,
  type LucideIcon,
} from "lucide-react-native";
import type { DocBlockDTO } from "@/lib/api";

/** Which selection the dock is looking at. Resolution is first-match, in the
 *  order the resolver checks them — see resolveDockScope. */
export type DockScopeKind =
  | "chrome"
  | "memoir"
  | "table"
  | "image"
  | "heading"
  | "emptyParagraph"
  | "paragraph"
  | "range"
  | "scattered";

/** What pressing send actually produces.
 *  `review` — a dedicated suggest endpoint returns a proposal the student
 *             approves or rejects before anything changes.
 *  `direct` — sendMessageToAI runs the agentic tool loop, which may edit the
 *             document immediately; only the existing confirm gate protects
 *             destructive tools.
 *  There is deliberately no third "only chats" outcome: every direct state,
 *  whole-memoir included, can change the document. */
export type DockOutcome = "review" | "direct";

/** Why a 2+ selection fell through to `scattered`. Drives the header wording —
 *  calling a contiguous native-view selection "not adjacent" would be a lie. */
export type ScatteredCause = "gapped" | "notLexical" | "mixed";

export interface DockAction {
  key: string;
  Icon: LucideIcon;
  labelKey: string;
  labelFallback: string;
  /** The instruction sent to the model. English regardless of UI locale, as the
   *  existing quickActions prompts already are. */
  prompt: string;
}

export interface DockScope {
  kind: DockScopeKind;
  outcome: DockOutcome;
  actions: DockAction[];
  /** i18n key + fallback for the header's target phrase. */
  headerKey: string;
  headerFallback: string;
  /** i18n key + fallback for the header's outcome phrase. */
  outcomeKey: string;
  outcomeFallback: string;
  /** i18n key + fallback for the ask input's placeholder. */
  placeholderKey: string;
  placeholderFallback: string;
  /** Only set when kind === "scattered". */
  cause?: ScatteredCause;
  /** True only for a GAPPED paragraph selection in the Lexical editor: filling
   *  the gaps upgrades it to a reviewable range rewrite. */
  canSelectGaps: boolean;
}

export interface ResolveInput {
  /** Selected doc-block indices. Empty → whole memoir. */
  indices: number[];
  /** The sole selected block, when exactly one is selected. */
  selectedBlock: DocBlockDTO | null;
  /** The selected PARAGRAPH blocks only, in document order.
   *  INVARIANT: every entry's index must also appear in `indices`. The resolver
   *  uses `scopeBlocks.length === indices.length` as its "all paragraphs" test,
   *  which is only sound while that holds. */
  scopeBlocks: { index: number; text: string; level: number }[];
  /** ALL doc blocks, not just the selected ones — needed to decide whether the
   *  span between the lowest and highest selection is fillable. */
  allBlocks: { index: number; kind: string }[];
  /** True when the Lexical editor is the active surface — a range rewrite needs
   *  it to render the proposal into. */
  lexicalActive: boolean;
  /** True when the bubble is targeting a header/footer band. */
  chrome: boolean;
}

// ── Action sets ────────────────────────────────────────────────────────────

const SUMMARIZE_DOC: DockAction = {
  key: "summarize",
  Icon: FileText,
  labelKey: "aiDock.summarize",
  labelFallback: "Summarize",
  prompt: "Summarize the current state of this thesis and its chapters.",
};
const IMPROVE_DOC: DockAction = {
  key: "improve",
  Icon: PenLine,
  labelKey: "aiDock.improve",
  labelFallback: "Improve writing",
  prompt: "Review the writing quality and improve weak passages.",
};
const FORMAT_DOC: DockAction = {
  key: "format",
  Icon: LayoutPanelTop,
  labelKey: "aiDock.format",
  labelFallback: "Fix formatting",
  prompt: "Check and fix formatting, numbering and layout issues in the document.",
};
const TRANSLATE_DOC: DockAction = {
  key: "translate",
  Icon: Languages,
  labelKey: "aiDock.translate",
  labelFallback: "Translate",
  prompt: "Help me translate parts of this thesis.",
};

const SUMMARIZE_SEL: DockAction = {
  key: "summarize-sel",
  Icon: FileText,
  labelKey: "aiDock.summarize",
  labelFallback: "Summarize",
  prompt: "Summarize the selected sections into a concise summary.",
};
const IMPROVE_SEL: DockAction = {
  key: "improve-sel",
  Icon: PenLine,
  labelKey: "aiDock.improve",
  labelFallback: "Improve writing",
  prompt: "Improve the writing quality of the selected sections.",
};
const FORMAT_SEL: DockAction = {
  key: "format-sel",
  Icon: LayoutPanelTop,
  labelKey: "aiDock.format",
  labelFallback: "Fix formatting",
  prompt: "Fix the formatting of the selected sections.",
};
const TRANSLATE_SEL: DockAction = {
  key: "translate-sel",
  Icon: Languages,
  labelKey: "aiDock.translate",
  labelFallback: "Translate",
  prompt: "Translate the selected sections.",
};

const PARAGRAPH_ACTIONS: DockAction[] = [
  {
    key: "rewrite",
    Icon: WandSparkles,
    labelKey: "aiDock.rewrite",
    labelFallback: "Rewrite",
    prompt: "Rewrite this paragraph more clearly, keeping its meaning and its language.",
  },
  {
    key: "expand",
    Icon: StretchHorizontal,
    labelKey: "aiDock.expand",
    labelFallback: "Expand",
    prompt: "Expand this paragraph with more detail and supporting explanation, in the same language and register.",
  },
  {
    key: "shorten",
    Icon: Scissors,
    labelKey: "aiDock.shorten",
    labelFallback: "Shorten",
    prompt: "Make this paragraph more concise without losing any of its substance.",
  },
  {
    key: "translate-par",
    Icon: Languages,
    labelKey: "aiDock.translate",
    labelFallback: "Translate",
    prompt: "Translate this paragraph.",
  },
];

const EMPTY_PARAGRAPH_ACTIONS: DockAction[] = [
  {
    key: "write-it",
    Icon: PenLine,
    labelKey: "aiDock.writeIt",
    labelFallback: "Write it",
    prompt: "Write the content that belongs here, fitting the surrounding section and its language.",
  },
  {
    key: "insert-table",
    Icon: Table2,
    labelKey: "aiDock.insertTable",
    labelFallback: "Insert a table",
    prompt: "Propose a table that belongs here, based on the surrounding section.",
  },
  {
    key: "continue-above",
    Icon: ArrowDownToLine,
    labelKey: "aiDock.continueAbove",
    labelFallback: "Continue from above",
    prompt: "Continue directly from the paragraph above, in the same voice and language.",
  },
];

const HEADING_ACTIONS: DockAction[] = [
  {
    key: "write-section",
    Icon: PenLine,
    labelKey: "aiDock.writeSection",
    labelFallback: "Write the section",
    prompt: "Write the opening content for the section under this heading, in the document's language.",
  },
  {
    key: "reword-title",
    Icon: Type,
    labelKey: "aiDock.rewordTitle",
    labelFallback: "Reword title",
    prompt: "Reword this heading to be clearer and more academic, keeping its language.",
  },
  {
    key: "translate-head",
    Icon: Languages,
    labelKey: "aiDock.translate",
    labelFallback: "Translate",
    prompt: "Translate this heading.",
  },
];

// Verbatim from today's tableActions in components/workspace/AIDock.tsx.
const TABLE_ACTIONS: DockAction[] = [
  {
    key: "tbl-check",
    Icon: Calculator,
    labelKey: "aiDock.table.checkNumbers",
    labelFallback: "Check numbers",
    prompt:
      "Check the table's numbers for consistency (sums, percentages, totals) and fix any that are wrong. Keep everything else unchanged.",
  },
  {
    key: "tbl-totals",
    Icon: Rows3,
    labelKey: "aiDock.table.addTotals",
    labelFallback: "Add totals row",
    prompt:
      "Add a totals row at the bottom of the table summing/aggregating the numeric columns, labeled appropriately in the table's language. Keep existing cells unchanged.",
  },
  {
    key: "tbl-format",
    Icon: Table2,
    labelKey: "aiDock.table.format",
    labelFallback: "Format table",
    prompt:
      "Tidy the table: consistent number formats, a proper header row, and the correct direction/alignment for its language. Keep the cell contents' meaning unchanged.",
  },
];

const IMAGE_ACTIONS: DockAction[] = [
  {
    key: "write-caption",
    Icon: PenLine,
    labelKey: "aiDock.writeCaption",
    labelFallback: "Write a caption",
    prompt: "Write a caption for this figure, numbered and worded to the document's conventions.",
  },
  {
    key: "improve-caption",
    Icon: WandSparkles,
    labelKey: "aiDock.improveCaption",
    labelFallback: "Improve caption",
    prompt: "Improve this figure's caption, keeping its language and numbering.",
  },
  {
    key: "translate-caption",
    Icon: Languages,
    labelKey: "aiDock.translate",
    labelFallback: "Translate",
    prompt: "Translate this figure's caption.",
  },
];

const RANGE_ACTIONS: DockAction[] = [
  {
    key: "rewrite-one",
    Icon: Combine,
    labelKey: "aiDock.rewriteAsOne",
    labelFallback: "Rewrite as one",
    prompt: "Rewrite the selected passage as one coherent piece, keeping its language and every fact it states.",
  },
  {
    key: "shorten-range",
    Icon: Scissors,
    labelKey: "aiDock.shorten",
    labelFallback: "Shorten",
    prompt: "Make the selected passage more concise without losing any of its substance.",
  },
  {
    key: "unify-style",
    Icon: WandSparkles,
    labelKey: "aiDock.unifyStyle",
    labelFallback: "Unify style",
    prompt: "Make the selected passage consistent in voice, tense and terminology throughout.",
  },
];

const CHROME_ACTIONS: DockAction[] = [SUMMARIZE_SEL, IMPROVE_SEL, TRANSLATE_SEL];
const MEMOIR_ACTIONS: DockAction[] = [SUMMARIZE_DOC, IMPROVE_DOC, FORMAT_DOC, TRANSLATE_DOC];
const SCATTERED_ACTIONS: DockAction[] = [SUMMARIZE_SEL, IMPROVE_SEL, FORMAT_SEL, TRANSLATE_SEL];

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Map the live selection to exactly one scope. PURE and called during render —
 * deliberately not store state, for the same reason resolveToolbarKind in
 * stores/toolbar-store.ts is pure: routing it through the store would paint one
 * frame of the PREVIOUS scope's chips on every selection change.
 *
 * First match wins, and the order matters: a heading is a paragraph carrying a
 * level, so it must be tested before either paragraph case, and an EMPTY heading
 * must still resolve as a heading.
 */
export function resolveDockScope(input: ResolveInput): DockScope {
  const { indices, selectedBlock, scopeBlocks, allBlocks, lexicalActive, chrome } = input;
  const count = indices.length;

  if (chrome) {
    return {
      kind: "chrome",
      outcome: "direct",
      actions: CHROME_ACTIONS,
      headerKey: "aiDock.header.chrome",
      headerFallback: "This header/footer section",
      outcomeKey: "aiDock.outcome.direct",
      outcomeFallback: "applied directly",
      placeholderKey: "aiDock.ask.chrome",
      placeholderFallback: "Ask about this section…",
      canSelectGaps: false,
    };
  }

  if (count === 0) {
    return {
      kind: "memoir",
      outcome: "direct",
      actions: MEMOIR_ACTIONS,
      headerKey: "aiDock.header.memoir",
      headerFallback: "Whole memoir",
      outcomeKey: "aiDock.outcome.direct",
      outcomeFallback: "applied directly",
      placeholderKey: "aiDock.ask.memoir",
      placeholderFallback: "Ask the AI…",
      canSelectGaps: false,
    };
  }

  if (count === 1 && selectedBlock) {
    if (selectedBlock.kind === "table") {
      return {
        kind: "table",
        outcome: "review",
        actions: TABLE_ACTIONS,
        headerKey: "aiDock.header.table",
        headerFallback: "This table",
        outcomeKey: "aiDock.outcome.review",
        outcomeFallback: "you'll review the change",
        placeholderKey: "aiDock.ask.table",
        placeholderFallback: "Ask about this table…",
        canSelectGaps: false,
      };
    }
    if (selectedBlock.kind === "image") {
      return {
        kind: "image",
        outcome: "review",
        actions: IMAGE_ACTIONS,
        headerKey: "aiDock.header.image",
        headerFallback: "This figure",
        outcomeKey: "aiDock.outcome.review",
        outcomeFallback: "you'll review the change",
        placeholderKey: "aiDock.ask.image",
        placeholderFallback: "Ask about this figure…",
        canSelectGaps: false,
      };
    }
    if (selectedBlock.kind === "paragraph") {
      if (selectedBlock.level > 0) {
        return {
          kind: "heading",
          outcome: "review",
          actions: HEADING_ACTIONS,
          headerKey: "aiDock.header.heading",
          headerFallback: "This heading",
          outcomeKey: "aiDock.outcome.review",
          outcomeFallback: "you'll review the change",
          placeholderKey: "aiDock.ask.heading",
          placeholderFallback: "Ask about this heading…",
          canSelectGaps: false,
        };
      }
      if (!selectedBlock.text.trim()) {
        return {
          kind: "emptyParagraph",
          outcome: "review",
          actions: EMPTY_PARAGRAPH_ACTIONS,
          headerKey: "aiDock.header.emptyParagraph",
          headerFallback: "Empty paragraph",
          outcomeKey: "aiDock.outcome.write",
          outcomeFallback: "AI will write it",
          placeholderKey: "aiDock.ask.emptyParagraph",
          placeholderFallback: "What should go here?",
          canSelectGaps: false,
        };
      }
      return {
        kind: "paragraph",
        outcome: "review",
        actions: PARAGRAPH_ACTIONS,
        headerKey: "aiDock.header.paragraph",
        headerFallback: "This paragraph",
        outcomeKey: "aiDock.outcome.review",
        outcomeFallback: "you'll review the change",
        placeholderKey: "aiDock.ask.paragraph",
        placeholderFallback: "Ask about this paragraph…",
        canSelectGaps: false,
      };
    }
    // A single textbox / chart / unmapped OOXML block: no dedicated suggest
    // endpoint exists for it, so it takes the plain send like a mixed set.
    return buildScatteredScope("mixed", false);
  }

  // A stale one-item selection whose block was deleted or reindexed by the
  // optimistic edit path leaves count === 1 with no selectedBlock. Caught here
  // so it can't fall into the 2+ logic below and be described as a range.
  if (count === 1) return buildScatteredScope("mixed", false);

  // 2+ blocks. A range rewrite needs every selected block to BE a paragraph…
  const allParagraphs = scopeBlocks.length === count;
  if (!allParagraphs) return buildScatteredScope("mixed", false);

  // …CONTIGUOUS, because approveRange replaces the whole span [min..max]: a
  // gapped set (tap block 5, tap block 30) would wipe out the 24 blocks in
  // between that the student never selected…
  const span = [...indices].sort((a, b) => a - b);
  const contiguous = span.every((v, i) => i === 0 || v === span[i - 1] + 1);

  // …and the Lexical editor active, because it renders the range node.
  if (!lexicalActive) return buildScatteredScope("notLexical", false);
  if (!contiguous) {
    // Offer the gap-fill ONLY if filling actually helps. A table sitting between
    // two selected paragraphs cannot be merged into a range rewrite, so filling
    // would return the same selection and the chip would be a dead end that
    // re-offers itself forever.
    const lo = span[0];
    const hi = span[span.length - 1];
    const spanFillable = allBlocks
      .filter((b) => b.index >= lo && b.index <= hi)
      .every((b) => b.kind === "paragraph");
    return buildScatteredScope("gapped", spanFillable);
  }

  return {
    kind: "range",
    outcome: "review",
    actions: RANGE_ACTIONS,
    headerKey: "aiDock.header.range",
    headerFallback: "{{count}} adjacent sections",
    outcomeKey: "aiDock.outcome.range",
    outcomeFallback: "rewritten as one passage",
    placeholderKey: "aiDock.ask.range",
    placeholderFallback: "Ask about these {{count}} sections…",
    canSelectGaps: false,
  };
}

function buildScatteredScope(cause: ScatteredCause, canSelectGaps: boolean): DockScope {
  const header =
    cause === "gapped"
      ? { key: "aiDock.header.gapped", fallback: "{{count}} sections, not adjacent" }
      : cause === "notLexical"
        ? { key: "aiDock.header.notLexical", fallback: "{{count}} sections" }
        : { key: "aiDock.header.mixed", fallback: "{{count}} blocks" };
  return {
    kind: "scattered",
    outcome: "direct",
    actions: SCATTERED_ACTIONS,
    headerKey: header.key,
    headerFallback: header.fallback,
    outcomeKey: "aiDock.outcome.direct",
    outcomeFallback: "applied directly",
    placeholderKey: "aiDock.ask.range",
    placeholderFallback: "Ask about these {{count}} sections…",
    cause,
    canSelectGaps,
  };
}

/** Fill in every paragraph index between the lowest and highest selected, so a
 *  gapped set becomes contiguous and re-resolves to `range`. Returns the blocks
 *  to hand to workspace-store's setSelection. */
export function fillGaps(
  indices: number[],
  blocks: { index: number; kind: string; text?: string }[],
): { index: number; text: string }[] {
  if (indices.length < 2) return [];
  const lo = Math.min(...indices);
  const hi = Math.max(...indices);
  return blocks
    .filter((b) => b.index >= lo && b.index <= hi && b.kind === "paragraph")
    .map((b) => ({ index: b.index, text: b.text ?? "" }));
}
