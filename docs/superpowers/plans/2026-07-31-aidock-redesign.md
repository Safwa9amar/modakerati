# Scope-Aware AIDock Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the workspace ✦ AI dock as a scope-aware command bar — a header that declares what the AI will act on *and* whether the result is reviewable, an always-live ask input, and a single horizontal action row whose chips change with the selection.

**Architecture:** A pure `resolveDockScope()` maps the live selection to one of nine scope kinds. Both the rendered UI and the send routing read that one value, so the header's promise and the actual behaviour cannot drift. `AIDock` splits from one 618-line file into a folder of focused components, mirroring the `bubble-tools/` refactor. The four non-AI view toggles leave the dock for `GlobalDockBar` and the header ⋮ menu.

**Tech Stack:** Expo SDK 56 / React Native (New Architecture), TypeScript, Zustand, Reanimated 3, react-native-gesture-handler, react-i18next, lucide-react-native.

**Spec:** `docs/superpowers/specs/2026-07-31-aidock-redesign-design.md`

---

## ⚠️ Read before starting

**1. There is no JS test runner in this app.** Do not invent one, do not add
Jest/Vitest, do not write `.test.ts` files. The verification gate for every task
is:

```bash
npx tsc --noEmit
```

plus the named device check in that task's steps. Where a task below says
"verify", that is what it means. This deviates from the usual TDD loop in this
skill, deliberately and with the user's knowledge — the server and dashboard
repos have vitest; this one does not.

**2. The working tree has uncommitted work from parallel sessions.** Never run
`git add -A`, `git add .`, or `git commit -a`. Every commit step below lists
exact paths — use exactly those. Never `git commit --amend`; always a fresh
commit.

**3. Locale files contain duplicate keys.** `locales/{en,fr,ar}.json` must be
edited surgically with the Edit tool. Do not parse and re-serialise them (a
`json.load` / `json.dump` round-trip silently drops the duplicates and reformats
the entire file).

**4. Do not touch `BlockContextBar` or `components/workspace/bubble-tools/`.**
That is the formatting bubble, a separate surface, out of scope.

---

## File Structure

| Path | Responsibility |
|---|---|
| `lib/ai-dock-scopes.ts` | **new** — types, per-kind action registry, pure `resolveDockScope()` |
| `components/workspace/ai-dock/styles.ts` | **new** — shared StyleSheet for the dock parts |
| `components/workspace/ai-dock/ScopeHeader.tsx` | **new** — target + outcome line, clear/collapse controls |
| `components/workspace/ai-dock/AskBar.tsx` | **new** — always-live input + send button |
| `components/workspace/ai-dock/ActionRow.tsx` | **new** — horizontal scroller, suggestions lead, reserved slots |
| `components/workspace/ai-dock/useDockSuggestions.ts` | **new** — scoped suggestion fetch (lifted verbatim from today's effect) |
| `components/workspace/ai-dock/send.ts` | **new** — routing, switched on `DockScopeKind` |
| `components/workspace/ai-dock/AIDock.tsx` | **new** — shell composing the three rows |
| `components/workspace/ai-dock/index.ts` | **new** — re-export |
| `components/workspace/AIDock.tsx` | **deleted** at the end of Task 8 |
| `components/workspace/FloatingPill.tsx` | modify — import path, measured keyboard clearance |
| `components/workspace/GlobalDockBar.tsx` | modify — Select blocks + Reorder chips, `active` on `chip()` |
| `components/workspace/WorkspaceHeaderMenu.tsx` | modify — Section markers row |
| `locales/{en,fr,ar}.json` | modify — new `aiDock.*` keys |

---

## Task 1: The scope registry

**Files:**
- Create: `lib/ai-dock-scopes.ts`

- [ ] **Step 1: Create the module**

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean. If `selectedBlock.level` errors, confirm the paragraph variant
in `lib/api.ts:747` — it is `level: 0 | 1 | 2 | 3 | 4 | 5 | 6` inside the
discriminated union, so the narrowing on `kind === "paragraph"` must come first.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-dock-scopes.ts
git commit -m "feat(app): pure scope registry for the AI dock"
```

---

## Task 2: Dock styles

**Files:**
- Create: `components/workspace/ai-dock/styles.ts`

- [ ] **Step 1: Create the file**

```ts
import { StyleSheet } from "react-native";

/** Shared metrics for the dock's three rows. Kept in one place so the header,
 *  ask bar and action row stay on the same rhythm — mirrors bubble-tools/styles.ts. */
export const dockStyles = StyleSheet.create({
  container: { gap: 9 },

  // ── ScopeHeader ──
  header: { alignItems: "center", gap: 7 },
  headerText: { flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  headerBtn: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  // ── AskBar ──
  askBar: { alignItems: "center", gap: 7, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 5, paddingHorizontal: 5 },
  askInput: { flex: 1, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },

  // ── ActionRow ──
  rowScroll: { flexGrow: 0 },
  rowContent: { alignItems: "center", gap: 7, paddingHorizontal: 1 },
  chip: { alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  suggChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  suggChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  /** Reserved slot while suggestions load — same box as a suggestion chip so
   *  nothing shifts when the real one lands. */
  slot: { width: 104, height: 35, borderRadius: 14 },

  dim: { opacity: 0.4 },
});
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ai-dock/styles.ts
git commit -m "feat(app): shared styles for the AI dock parts"
```

---

## Task 3: ScopeHeader

**Files:**
- Create: `components/workspace/ai-dock/ScopeHeader.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from "react";
import { View, Text, Pressable } from "react-native";
import { ChevronsDownUp, Sparkles, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { DockScope } from "@/lib/ai-dock-scopes";
import { dockStyles as s } from "./styles";

interface Props {
  scope: DockScope;
  /** Number of selected blocks — interpolated into the count-bearing headers. */
  count: number;
  /** Clear the selection WITHOUT leaving select mode (matching today's split:
   *  "Clear selection" and "Done selecting" were separate controls, and exiting
   *  the mode now lives on GlobalDockBar). Hidden when nothing is selected. */
  onClear: () => void;
  onCollapse: () => void;
}

/**
 * The dock's first row: what the AI is about to act on, and — the point of this
 * redesign — whether the result is something the student reviews or something
 * that just happens. The outcome tints the ✦ glyph and the text, so the two are
 * distinguishable at a glance without spending a row on it.
 */
export function ScopeHeader({ scope, count, onClear, onCollapse }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();

  const tint = scope.outcome === "review" ? colors.semanticSuccess : colors.semanticWarning;
  const target = t(scope.headerKey, { defaultValue: scope.headerFallback, count });
  const outcome = t(scope.outcomeKey, { defaultValue: scope.outcomeFallback });

  return (
    <View style={[s.header, { flexDirection }]}>
      <Sparkles size={13} color={tint} strokeWidth={2.4} />
      <Text numberOfLines={1} style={[s.headerText, { color: tint }]}>
        {`${target} · ${outcome}`}
      </Text>
      {count > 0 ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={t("dockBar.clearSelection", { defaultValue: "Clear selection" })}
          style={[s.headerBtn, { backgroundColor: colors.bgCard }]}
        >
          <X size={13} color={colors.textSecondary} strokeWidth={2.2} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onCollapse}
        accessibilityRole="button"
        accessibilityLabel={t("blockBar.collapse", { defaultValue: "Collapse" })}
        style={[s.headerBtn, { backgroundColor: colors.bgCard }]}
      >
        <ChevronsDownUp size={13} color={colors.textSecondary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ai-dock/ScopeHeader.tsx
git commit -m "feat(app): AI dock scope header declaring target and outcome"
```

---

## Task 4: AskBar

**Files:**
- Create: `components/workspace/ai-dock/AskBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React, { useState } from "react";
import { View, Pressable, Keyboard } from "react-native";
import { TextInput } from "react-native-gesture-handler";
import { Send } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { dockStyles as s } from "./styles";

interface Props {
  placeholder: string;
  /** floating-pill-store's `inputOpen` — which now means "focus me", not
   *  "exist". The bar itself is always rendered. */
  autoFocus: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
}

/** Row two: the free-form ask. Always present — the tap-to-reveal step this
 *  replaced put the one thing a student can't get from a chip behind an extra
 *  tap, at the bottom of the panel. */
export function AskBar({ placeholder, autoFocus, disabled, onSend }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();
  const [text, setText] = useState("");

  const empty = !text.trim();

  const send = () => {
    if (empty || disabled) return;
    onSend(text.trim());
    setText("");
    Keyboard.dismiss();
  };

  return (
    <View
      style={[s.askBar, { flexDirection, backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
    >
      <TextInput
        autoFocus={autoFocus}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        style={[s.askInput, { color: colors.textPrimary, textAlign }]}
        multiline={false}
        returnKeyType="send"
        onSubmitEditing={send}
        editable={!disabled}
      />
      <Pressable
        onPress={send}
        disabled={empty || disabled}
        accessibilityRole="button"
        accessibilityLabel={t("chat.send", { defaultValue: "Send" })}
        style={[s.sendBtn, { backgroundColor: colors.brandPrimary }, (empty || disabled) && s.dim]}
      >
        <Send size={15} color={colors.bgPrimary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ai-dock/AskBar.tsx
git commit -m "feat(app): always-live ask bar for the AI dock"
```

---

## Task 5: Suggestions hook

**Files:**
- Create: `components/workspace/ai-dock/useDockSuggestions.ts`

- [ ] **Step 1: Create the hook**

This is today's effect from `components/workspace/AIDock.tsx:108-142`, lifted
without behaviour change: the preference gate, the AbortController, and the
`cancelled` guard that stops a stale response overwriting fresher chips.

```ts
import { useEffect, useState } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import { getComposerSuggestions, type ComposerSuggestion } from "@/lib/api";

/**
 * Scope-grounded suggestion chips. Intentionally separate from
 * hooks/useComposerSuggestions (no debounce, no cache — the dock unmounts on
 * collapse) but honours the same `preferences.aiSuggestions` gate.
 */
export function useDockSuggestions(thesisId: string, indices: number[]) {
  // Subscribed, not read once, so toggling the setting clears/restores chips live.
  const enabled = useNotificationStore((s) => s.preferences.aiSuggestions);
  const [suggestions, setSuggestions] = useState<ComposerSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  // The primitive identity of `indices` — an array literal would re-fire every render.
  const scopeKey = indices.join(",");

  useEffect(() => {
    if (!enabled) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const list = scopeKey ? scopeKey.split(",").map(Number) : [];
    getComposerSuggestions(
      thesisId,
      {
        docBlockIndex: list.length ? list[0] : null,
        docBlockIndices: list.length > 1 ? list : undefined,
      },
      controller.signal,
    )
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [thesisId, scopeKey, enabled]);

  return { suggestions, loading: loading && enabled, enabled };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ai-dock/useDockSuggestions.ts
git commit -m "refactor(app): lift the AI dock suggestion fetch into a hook"
```

---

## Task 6: ActionRow

**Files:**
- Create: `components/workspace/ai-dock/ActionRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React, { useEffect } from "react";
import { Text } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { ListPlus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { ComposerSuggestion } from "@/lib/api";
import type { DockAction } from "@/lib/ai-dock-scopes";
import { AnimatedChip } from "../AnimatedChip";
import { dockStyles as s } from "./styles";

/** One reserved slot, pulsing, occupying exactly a suggestion chip's box. */
function Slot({ color }: { color: string }) {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => {
      pulse.value = 0.35;
    };
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[s.slot, { backgroundColor: color }, style]} />;
}

interface Props {
  actions: DockAction[];
  suggestions: ComposerSuggestion[];
  loading: boolean;
  disabled: boolean;
  /** Gapped paragraph selection → offer the one-tap upgrade back to a
   *  reviewable range rewrite. */
  showSelectGaps: boolean;
  onSelectGaps: () => void;
  onPrompt: (prompt: string) => void;
}

/**
 * Row three: ONE horizontally scrolling row. Suggestions lead — they are the
 * scope-aware prompts a student can't easily type — and the canned actions
 * follow.
 *
 * While suggestions load, two reserved slots hold the leading positions, so the
 * chips under the student's thumb never move. If more than two arrive, the
 * extras append and push the canned block rightward: a horizontal shift inside
 * a scroller, not a reflow of the panel.
 *
 * gesture-handler's ScrollView, not RN's — nested inside the reorderable list,
 * RN's loses the horizontal pan to the list's gesture handler. Same reason
 * BlockContextBar and GlobalDockBar use it.
 */
export function ActionRow({
  actions,
  suggestions,
  loading,
  disabled,
  showSelectGaps,
  onSelectGaps,
  onPrompt,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();

  let enterIndex = 0;
  const next = () => enterIndex++;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={s.rowScroll}
      contentContainerStyle={[s.rowContent, { flexDirection }]}
    >
      {showSelectGaps ? (
        <AnimatedChip
          onPress={onSelectGaps}
          accessibilityLabel={t("aiDock.selectGaps", { defaultValue: "Select the gaps" })}
          enterIndex={next()}
          style={[s.chip, { flexDirection, borderColor: colors.semanticWarning, backgroundColor: colors.bgCard }]}
        >
          <ListPlus size={15} color={colors.semanticWarning} strokeWidth={2} />
          <Text numberOfLines={1} style={[s.chipText, { color: colors.semanticWarning }]}>
            {t("aiDock.selectGaps", { defaultValue: "Select the gaps" })}
          </Text>
        </AnimatedChip>
      ) : null}

      {loading ? (
        <>
          <Slot color={colors.bgCard} />
          <Slot color={colors.bgCard} />
        </>
      ) : (
        suggestions.map((sg, i) => (
          <AnimatedChip
            key={`sugg-${i}`}
            onPress={() => onPrompt(sg.prompt)}
            disabled={disabled}
            accessibilityLabel={sg.label}
            enterIndex={next()}
            style={[
              s.suggChip,
              { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "1A" },
              disabled && s.dim,
            ]}
          >
            <Text numberOfLines={1} style={[s.suggChipText, { color: colors.brandPrimary }]}>
              {sg.label}
            </Text>
          </AnimatedChip>
        ))
      )}

      {actions.map((a) => (
        <AnimatedChip
          key={a.key}
          onPress={() => onPrompt(a.prompt)}
          disabled={disabled}
          accessibilityLabel={t(a.labelKey, { defaultValue: a.labelFallback })}
          enterIndex={next()}
          style={[
            s.chip,
            { flexDirection, borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
            disabled && s.dim,
          ]}
        >
          <a.Icon size={15} color={colors.textPrimary} strokeWidth={2} />
          <Text numberOfLines={1} style={[s.chipText, { color: colors.textPrimary }]}>
            {t(a.labelKey, { defaultValue: a.labelFallback })}
          </Text>
        </AnimatedChip>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ai-dock/ActionRow.tsx
git commit -m "feat(app): single-row AI dock action scroller with reserved slots"
```

---

## Task 7: Send routing

**Files:**
- Create: `components/workspace/ai-dock/send.ts`

- [ ] **Step 1: Create the module**

```ts
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useTableSuggestionStore } from "@/stores/table-suggestion-store";
import { sendMessageToAI } from "@/lib/ai-service";
import type { DocBlockDTO } from "@/lib/api";
import type { DockScope } from "@/lib/ai-dock-scopes";

export interface SendArgs {
  thesisId: string;
  scope: DockScope;
  prompt: string;
  indices: number[];
  selectedBlock: DocBlockDTO | null;
  scopeBlocks: { index: number; text: string; level: number }[];
  scopeText?: string;
}

/**
 * The dock's ONLY send path, switched on the scope kind that the header already
 * displayed. It does not re-derive the route from its own conditionals — that is
 * the whole point: the promise the student read and the thing that happens are
 * the same value.
 *
 * ⚠️ Invariant this structure now enforces: a block-scoped ask must go through
 * useSuggestionStore/useTableSuggestionStore — the dedicated suggest endpoints,
 * which return a proposal to approve or reject. sendMessageToAI is the plain
 * chat/tool loop and edits the document directly with no review step. The dock
 * bypassed this once already (regression, fixed a8b14a8).
 */
export function sendFromDock({
  thesisId,
  scope,
  prompt,
  indices,
  selectedBlock,
  scopeBlocks,
  scopeText,
}: SendArgs): void {
  const pill = useFloatingPillStore.getState();
  const collapse = () => {
    pill.setExpanded(false);
    pill.setInputOpen(false);
  };

  switch (scope.kind) {
    case "emptyParagraph":
      if (!selectedBlock) break;
      // The fill flow lets the model choose prose vs a real table; both come
      // back as an inline proposal.
      void useSuggestionStore.getState().requestFill(thesisId, selectedBlock.index, prompt);
      collapse();
      return;

    case "paragraph":
    case "heading":
      if (!selectedBlock || selectedBlock.kind !== "paragraph") break;
      void useSuggestionStore
        .getState()
        .request(thesisId, selectedBlock.index, selectedBlock.text, prompt);
      collapse();
      return;

    case "image":
      if (!selectedBlock || selectedBlock.kind !== "image") break;
      void useSuggestionStore
        .getState()
        .request(thesisId, selectedBlock.index, selectedBlock.caption ?? "", prompt, "image");
      collapse();
      return;

    case "table":
      if (!selectedBlock) break;
      void useTableSuggestionStore.getState().request(thesisId, selectedBlock.index, prompt);
      collapse();
      return;

    case "range":
      void useSuggestionStore.getState().requestRange(thesisId, scopeBlocks, prompt);
      collapse();
      return;

    case "chrome":
    case "memoir":
    case "scattered":
      break;
  }

  // Every `direct` outcome, plus any defensive fall-through above.
  void sendMessageToAI(thesisId, prompt, {
    docBlockIndex: indices.length ? indices[0] : null,
    docBlockIndices: indices.length > 1 ? indices : undefined,
    // Ground the ask on the selected text; whole-memoir asks carry no selection.
    selection: indices.length ? scopeText || undefined : undefined,
  });
  pill.setExpanded(false);
  // Only this branch gets the peek card — every `review` branch above returned
  // early and shows its own in-place approve/reject UI instead.
  pill.setAwaitingReply(true);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean. If `requestFill` / `requestRange` / `request` signatures
mismatch, read `stores/suggestion-store.ts` and match them — do not change the
store.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/ai-dock/send.ts
git commit -m "feat(app): route AI dock sends off the resolved scope kind"
```

---

## Task 8: The shell, and delete the old dock

**Files:**
- Create: `components/workspace/ai-dock/AIDock.tsx`
- Create: `components/workspace/ai-dock/index.ts`
- Delete: `components/workspace/AIDock.tsx`
- Modify: `components/workspace/FloatingPill.tsx:35`

- [ ] **Step 1: Create the shell**

```tsx
import React from "react";
import { View, Keyboard } from "react-native";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/stores/chat-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { fillGaps, resolveDockScope } from "@/lib/ai-dock-scopes";
import type { DocBlockDTO } from "@/lib/api";
import { ScopeHeader } from "./ScopeHeader";
import { AskBar } from "./AskBar";
import { ActionRow } from "./ActionRow";
import { useDockSuggestions } from "./useDockSuggestions";
import { sendFromDock } from "./send";
// NOT aliased to `s` here (unlike the other parts): this file's Zustand
// selectors already bind `s`, and shadowing the styles inside them is a trap.
import { dockStyles } from "./styles";

interface Props {
  thesisId: string;
  /** Doc-block indices the chips and the ask target. Empty → whole memoir. */
  scopeIndices: number[];
  /** The sole selected block when scopeIndices.length === 1. */
  selectedBlock?: DocBlockDTO | null;
  /** Combined text of the selected blocks, sent as `selection` to ground the ask. */
  scopeText?: string;
  /** The selected PARAGRAPH blocks (index + text + level), in document order. */
  scopeBlocks?: { index: number; text: string; level: number }[];
  /** True when the bubble is targeting a header/footer band. */
  chrome?: boolean;
  /** All doc blocks — needed to fill the gaps in a gapped selection. */
  blocks: DocBlockDTO[];
}

/**
 * The AI-mode panel inside the floating ✦ bubble. Rendered INSIDE FloatingPill's
 * dark panel — it owns only its rows, not the container, position or drag.
 *
 * Three rows: ScopeHeader (what, and whether you get to review it), AskBar
 * (always live), ActionRow (suggestions then canned actions, one h-scroller).
 *
 * The dock is APP UI, so it lays out by the app language's direction via
 * useRTL() inside each part — NOT by the thesis document's direction.
 */
export function AIDock({
  thesisId,
  scopeIndices,
  selectedBlock,
  scopeText,
  scopeBlocks,
  chrome = false,
  blocks,
}: Props) {
  const { t } = useTranslation();
  const isGenerating = useChatStore((s) => s.isGenerating);
  const inputOpen = useFloatingPillStore((s) => s.inputOpen);
  const lexicalActive = useLexicalEditorStore((s) => s.active);

  const paragraphs = scopeBlocks ?? [];

  // PURE, during render — see resolveDockScope's doc comment. Going through
  // store state would paint one frame of the previous scope on every change.
  const scope = resolveDockScope({
    indices: scopeIndices,
    selectedBlock: selectedBlock ?? null,
    scopeBlocks: paragraphs,
    allBlocks: blocks,
    lexicalActive,
    chrome,
  });

  const { suggestions, loading } = useDockSuggestions(thesisId, scopeIndices);

  const onPrompt = (prompt: string) => {
    if (isGenerating) return;
    sendFromDock({
      thesisId,
      scope,
      prompt,
      indices: scopeIndices,
      selectedBlock: selectedBlock ?? null,
      scopeBlocks: paragraphs,
      scopeText,
    });
  };

  const onSelectGaps = () => {
    const filled = fillGaps(scopeIndices, blocks);
    if (filled.length) useWorkspaceStore.getState().setSelection(filled, true);
  };

  const collapse = () => {
    const pill = useFloatingPillStore.getState();
    pill.setInputOpen(false);
    pill.setExpanded(false);
    Keyboard.dismiss();
  };

  return (
    <View style={dockStyles.container}>
      <ScopeHeader
        scope={scope}
        count={scopeIndices.length}
        onClear={() => useWorkspaceStore.getState().clearSelection()}
        onCollapse={collapse}
      />
      <AskBar
        placeholder={t(scope.placeholderKey, {
          defaultValue: scope.placeholderFallback,
          count: scopeIndices.length,
        })}
        autoFocus={inputOpen}
        disabled={isGenerating}
        onSend={onPrompt}
      />
      <ActionRow
        actions={scope.actions}
        suggestions={suggestions}
        loading={loading}
        disabled={isGenerating}
        showSelectGaps={scope.canSelectGaps}
        onSelectGaps={onSelectGaps}
        onPrompt={onPrompt}
      />
    </View>
  );
}
```

- [ ] **Step 2: Create the barrel**

```ts
export { AIDock } from "./AIDock";
```

- [ ] **Step 3: Point FloatingPill at the new module**

In `components/workspace/FloatingPill.tsx`, replace line 35:

```tsx
import { AIDock } from "./AIDock";
```

with:

```tsx
import { AIDock } from "./ai-dock";
```

- [ ] **Step 4: Update both AIDock call sites in FloatingPill**

`scopeLabel` is gone (the header replaces it) and two props are new. The chrome
call site (around line 678) becomes:

```tsx
<AIDock
  thesisId={thesisId}
  scopeIndices={[chromeSelection.index]}
  selectedBlock={null}
  scopeText={chromeSelection.text}
  scopeBlocks={[]}
  chrome
  blocks={blocks}
/>
```

The main call site (around line 712) becomes:

```tsx
<AIDock
  thesisId={thesisId}
  scopeIndices={indices}
  selectedBlock={selectedBlock}
  scopeText={scopeText}
  scopeBlocks={paragraphSelection.map((b) => ({ index: b.index, text: b.text, level: b.level }))}
  blocks={blocks}
/>
```

- [ ] **Step 5: Delete the old file**

```bash
git rm components/workspace/AIDock.tsx
```

- [ ] **Step 6: Verify nothing else imported it**

Run: `grep -rn "workspace/AIDock\|from \"./AIDock\"" --include="*.tsx" --include="*.ts" . | grep -v node_modules`
Expected: no output.

Run: `npx tsc --noEmit`
Expected: clean. A `scopeLabel` error means a call site was missed.

- [ ] **Step 7: Commit**

```bash
git add components/workspace/ai-dock/AIDock.tsx components/workspace/ai-dock/index.ts components/workspace/AIDock.tsx components/workspace/FloatingPill.tsx
git commit -m "feat(app): scope-aware AI dock shell replaces the flat chip panel"
```

---

## Task 9: Locale keys

**Files:**
- Modify: `locales/en.json`
- Modify: `locales/fr.json`
- Modify: `locales/ar.json`

⚠️ Use the Edit tool on each file. Do **not** parse and re-serialise — these
files contain duplicate keys that a round-trip silently drops.

- [ ] **Step 1: Extend the `aiDock` block in `locales/en.json`**

Find the existing block:

```json
  "aiDock": {
    "table": {
      "checkNumbers": "Check numbers",
      "addTotals": "Add totals row",
      "format": "Format table"
    }
  },
```

Replace with:

```json
  "aiDock": {
    "table": {
      "checkNumbers": "Check numbers",
      "addTotals": "Add totals row",
      "format": "Format table"
    },
    "header": {
      "chrome": "This header/footer section",
      "memoir": "Whole memoir",
      "table": "This table",
      "image": "This figure",
      "heading": "This heading",
      "emptyParagraph": "Empty paragraph",
      "paragraph": "This paragraph",
      "range": "{{count}} adjacent sections",
      "gapped": "{{count}} sections, not adjacent",
      "notLexical": "{{count}} sections",
      "mixed_one": "1 block",
      "mixed": "{{count}} blocks"
    },
    "outcome": {
      "review": "you'll review the change",
      "write": "AI will write it",
      "range": "rewritten as one passage",
      "direct": "applied directly"
    },
    "ask": {
      "chrome": "Ask about this section…",
      "memoir": "Ask the AI…",
      "table": "Ask about this table…",
      "image": "Ask about this figure…",
      "heading": "Ask about this heading…",
      "emptyParagraph": "What should go here?",
      "paragraph": "Ask about this paragraph…",
      "range_one": "Ask about this block…",
      "range": "Ask about these {{count}} sections…"
    },
    "summarize": "Summarize",
    "improve": "Improve writing",
    "format": "Fix formatting",
    "translate": "Translate",
    "rewrite": "Rewrite",
    "expand": "Expand",
    "shorten": "Shorten",
    "writeIt": "Write it",
    "insertTable": "Insert a table",
    "continueAbove": "Continue from above",
    "writeSection": "Write the section",
    "rewordTitle": "Reword title",
    "writeCaption": "Write a caption",
    "improveCaption": "Improve caption",
    "rewriteAsOne": "Rewrite as one",
    "unifyStyle": "Unify style",
    "selectGaps": "Select the gaps"
  },
```

- [ ] **Step 2: Same structure in `locales/fr.json`**

Insert these keys inside the existing `"aiDock"` object, immediately **after** its
`"table"` sub-block — add a comma after `"table": { … }`'s closing brace, and do
not touch the `"table"` values themselves.

⚠️ `outcome.review` is a **promise about what will happen next**. Keep the
future/conditional sense — a rendering that reads "the change has been reviewed"
inverts the meaning of the single most important new element on this surface.

```json
    "header": {
      "chrome": "Cette section d'en-tête/pied de page",
      "memoir": "Tout le mémoire",
      "table": "Ce tableau",
      "image": "Cette figure",
      "heading": "Ce titre",
      "emptyParagraph": "Paragraphe vide",
      "paragraph": "Ce paragraphe",
      "range": "{{count}} sections adjacentes",
      "gapped": "{{count}} sections, non adjacentes",
      "notLexical": "{{count}} sections",
      "mixed_one": "1 bloc",
      "mixed": "{{count}} blocs"
    },
    "outcome": {
      "review": "vous validerez la modification",
      "write": "l'IA va l'écrire",
      "range": "réécrit en un seul passage",
      "direct": "appliqué directement"
    },
    "ask": {
      "chrome": "Poser une question sur cette section…",
      "memoir": "Demander à l'IA…",
      "table": "Poser une question sur ce tableau…",
      "image": "Poser une question sur cette figure…",
      "heading": "Poser une question sur ce titre…",
      "emptyParagraph": "Que faut-il mettre ici ?",
      "paragraph": "Poser une question sur ce paragraphe…",
      "range_one": "Poser une question sur ce bloc…",
      "range": "Poser une question sur ces {{count}} sections…"
    },
    "summarize": "Résumer",
    "improve": "Améliorer la rédaction",
    "format": "Corriger la mise en forme",
    "translate": "Traduire",
    "rewrite": "Réécrire",
    "expand": "Développer",
    "shorten": "Raccourcir",
    "writeIt": "L'écrire",
    "insertTable": "Insérer un tableau",
    "continueAbove": "Continuer ci-dessus",
    "writeSection": "Rédiger la section",
    "rewordTitle": "Reformuler le titre",
    "writeCaption": "Rédiger une légende",
    "improveCaption": "Améliorer la légende",
    "rewriteAsOne": "Réécrire en un seul",
    "unifyStyle": "Uniformiser le style",
    "selectGaps": "Sélectionner les intervalles"
```

- [ ] **Step 3: Same structure in `locales/ar.json`**

Same insertion point: inside the existing `"aiDock"` object, immediately after
its `"table"` sub-block.

```json
    "header": {
      "chrome": "قسم الرأس/التذييل هذا",
      "memoir": "المذكرة كاملة",
      "table": "هذا الجدول",
      "image": "هذا الشكل",
      "heading": "هذا العنوان",
      "emptyParagraph": "فقرة فارغة",
      "paragraph": "هذه الفقرة",
      "range": "{{count}} أقسام متجاورة",
      "gapped": "{{count}} أقسام غير متجاورة",
      "notLexical": "{{count}} أقسام",
      "mixed_one": "كتلة واحدة",
      "mixed": "{{count}} كتل"
    },
    "outcome": {
      "review": "ستراجع التغيير قبل تطبيقه",
      "write": "سيكتبها الذكاء الاصطناعي",
      "range": "تُعاد كتابتها كمقطع واحد",
      "direct": "يُطبَّق مباشرة"
    },
    "ask": {
      "chrome": "اسأل عن هذا القسم…",
      "memoir": "اسأل الذكاء الاصطناعي…",
      "table": "اسأل عن هذا الجدول…",
      "image": "اسأل عن هذا الشكل…",
      "heading": "اسأل عن هذا العنوان…",
      "emptyParagraph": "ما الذي يجب أن يوضع هنا؟",
      "paragraph": "اسأل عن هذه الفقرة…",
      "range_one": "اسأل عن هذه الكتلة…",
      "range": "اسأل عن هذه الأقسام ({{count}})…"
    },
    "summarize": "لخّص",
    "improve": "حسّن الصياغة",
    "format": "أصلح التنسيق",
    "translate": "ترجم",
    "rewrite": "أعد الصياغة",
    "expand": "وسّع",
    "shorten": "اختصر",
    "writeIt": "اكتبها",
    "insertTable": "أدرج جدولاً",
    "continueAbove": "أكمل ممّا سبق",
    "writeSection": "اكتب القسم",
    "rewordTitle": "أعد صياغة العنوان",
    "writeCaption": "اكتب تسمية توضيحية",
    "improveCaption": "حسّن التسمية التوضيحية",
    "rewriteAsOne": "أعد كتابتها كمقطع واحد",
    "unifyStyle": "وحّد الأسلوب",
    "selectGaps": "حدّد الفجوات"
```

- [ ] **Step 4: Verify all three files are still valid JSON**

Run: `for f in en fr ar; do node -e "JSON.parse(require('fs').readFileSync('locales/$f.json','utf8')); console.log('$f ok')"; done`
Expected: `en ok`, `fr ok`, `ar ok`.

- [ ] **Step 5: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(app): AI dock scope headers, outcomes and action labels"
```

---

## Task 10: Move Select blocks + Reorder to GlobalDockBar

**Files:**
- Modify: `components/workspace/GlobalDockBar.tsx`

- [ ] **Step 1: Give `chip()` an `active` prop**

`AnimatedChip` already accepts `active`; the local helper just never passed it.
Replace the helper at `components/workspace/GlobalDockBar.tsx:290-316` with:

```tsx
  const chip = (opts: {
    keyProp: string;
    Icon: LucideIcon;
    onPress: () => void;
    disabled?: boolean;
    busy?: boolean;
    active?: boolean;
    accessibilityLabel: string;
    enterIndex?: number;
  }) => (
    <AnimatedChip
      key={opts.keyProp}
      onPress={opts.onPress}
      disabled={opts.disabled || opts.busy}
      active={opts.active}
      accessibilityLabel={opts.accessibilityLabel}
      enterIndex={opts.enterIndex}
      style={[
        styles.chip,
        opts.active
          ? { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary }
          : { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
        (opts.disabled || opts.busy) && styles.chipDim,
      ]}
    >
      {opts.busy ? (
        <ActivityIndicator size="small" color={colors.textPrimary} />
      ) : (
        <opts.Icon
          size={17}
          color={
            opts.active
              ? colors.bgPrimary
              : opts.disabled
                ? colors.textPlaceholder
                : colors.textPrimary
          }
          strokeWidth={2}
        />
      )}
    </AnimatedChip>
  );
```

- [ ] **Step 2: Add the two icons to the lucide import**

In the import block at the top of the file, add `ArrowUpDown` and `ListChecks`
to the existing named imports from `lucide-react-native`.

- [ ] **Step 3: Subscribe to the two toggles**

Beside the other `useWorkspaceStore` selectors near the top of the component
body, add:

```tsx
  const selectMode = useWorkspaceStore((s) => s.selectMode);
  const reorderMode = useWorkspaceStore((s) => s.reorderMode);
```

- [ ] **Step 4: Insert the chips after the `search` chip**

Immediately after the `search` chip block (around line 496-503) and before
`{sep("s3")}`:

```tsx
            {chip({
              keyProp: "selectMode",
              Icon: ListChecks,
              active: selectMode,
              accessibilityLabel: selectMode
                ? t("dockBar.selectDone", { defaultValue: "Done selecting" })
                : t("dockBar.select", { defaultValue: "Select blocks" }),
              enterIndex: 6,
              onPress: () => {
                const wasOn = useWorkspaceStore.getState().selectMode;
                useWorkspaceStore.getState().toggleSelectMode();
                // Turning it ON: the next thing to do is tap blocks in the
                // document, so get the dock out of the way.
                if (!wasOn) {
                  useFloatingPillStore.getState().setInputOpen(false);
                  useFloatingPillStore.getState().setExpanded(false);
                  Keyboard.dismiss();
                }
              },
            })}
            {chip({
              keyProp: "reorderMode",
              Icon: ArrowUpDown,
              active: reorderMode,
              accessibilityLabel: t("dockBar.reorder", { defaultValue: "Reorder" }),
              enterIndex: 6,
              onPress: () => useWorkspaceStore.getState().toggleReorderMode(),
            })}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/workspace/GlobalDockBar.tsx
git commit -m "feat(app): select-blocks and reorder toggles move to the dock bar"
```

---

## Task 11: Move Section markers to the header ⋮ menu

**Files:**
- Modify: `components/workspace/WorkspaceHeaderMenu.tsx`

- [ ] **Step 1: Import the icon**

Add `Eye` to the existing named imports from `lucide-react-native`.

- [ ] **Step 2: Subscribe to the toggle**

Beside the existing `focusMode` / `composerOpen` selectors:

```tsx
  const showChrome = useWorkspaceStore((s) => s.showChrome);
```

- [ ] **Step 3: Add the row after Focus mode**

`Row` already renders a trailing check for `active`, exactly as Focus mode uses:

```tsx
            <Row
              icon={Eye}
              label={t("dockBar.sectionMarkers", { defaultValue: "Section markers" })}
              color={showChrome ? colors.brandPrimary : colors.textPrimary}
              active={showChrome}
              onPress={run(() => useWorkspaceStore.getState().toggleShowChrome())}
            />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/WorkspaceHeaderMenu.tsx
git commit -m "feat(app): section markers toggle moves to the header menu"
```

---

## Task 12: Measured keyboard clearance

**Files:**
- Modify: `components/workspace/FloatingPill.tsx:57-58`, `:386-400`

The dock drops from roughly four rows to two. `DOCK_CLEARANCE = 240` is sized for
the old panel and would now strand the dock well above the keyboard.

- [ ] **Step 1: Replace the constant with a fallback**

Replace lines 57-58:

```tsx
// Dock panel height + margin — how far above the keyboard the inline Ask input
// needs to clear so it isn't occluded once it opens.
const DOCK_CLEARANCE = 240;
```

with:

```tsx
// Fallback clearance for the dock, used only for the very first keyboard rise
// before onLayout has reported a real height. The measured height replaces it
// as soon as the panel has been laid out once.
const DOCK_CLEARANCE_FALLBACK = 150;
```

- [ ] **Step 2: Add the measurement state**

Beside the existing `columnH` state:

```tsx
  // Real laid-out height of the dock panel, so keyboard clearance tracks the
  // panel instead of a constant that goes stale whenever its rows change.
  const [dockH, setDockH] = useState(0);
```

- [ ] **Step 3: Measure both dock panels**

Both `<View style={[styles.dockPanel, …]}>` wrappers (the chrome one around line
674 and the main one around line 709) get:

```tsx
onLayout={(e) => setDockH(e.nativeEvent.layout.height)}
```

- [ ] **Step 4: Use it in the clearance math**

Replace the `clearance` line at :396:

```tsx
    const clearance = inputOpen ? DOCK_CLEARANCE : columnForm ? curH + 24 : expanded ? DOCK_CLEARANCE : PILL_H + 24;
```

with:

```tsx
    const dockClearance = (dockH || DOCK_CLEARANCE_FALLBACK) + 24;
    const clearance = inputOpen
      ? dockClearance
      : columnForm
        ? curH + 24
        : expanded
          ? dockClearance
          : PILL_H + 24;
```

- [ ] **Step 5: Add `dockH` to the effect's dependency array**

```tsx
  }, [keyboardHeight, inputOpen, expanded, columnForm, curH, dockH]);
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `grep -n "DOCK_CLEARANCE\b" components/workspace/FloatingPill.tsx`
Expected: no output (only `DOCK_CLEARANCE_FALLBACK` remains).

- [ ] **Step 7: Commit**

```bash
git add components/workspace/FloatingPill.tsx
git commit -m "fix(app): clear the keyboard by the dock's measured height"
```

---

## Task 13: Device verification pass

**Files:** none — this is a manual gate.

Run the app on a device (`LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios`
— CocoaPods dies at pod install without a UTF-8 locale in agent shells, and
never trust a build exit code piped to `tail`).

- [ ] **Step 1: Nine scope states**

For each, open the dock and confirm the header's declared outcome matches what
actually happens on send:

| State | How to reach it | Header must read | Send must produce |
|---|---|---|---|
| memoir | nothing selected | Whole memoir · applied directly | chat reply + peek |
| paragraph | tap one body paragraph | This paragraph · you'll review… | inline approve/reject |
| emptyParagraph | tap an empty paragraph | Empty paragraph · AI will write it | prose or table proposal |
| heading | tap a heading | This heading · you'll review… | inline approve/reject |
| table | tap a table | This table · you'll review… | table cell diff |
| image | tap a figure | This figure · you'll review… | caption proposal |
| range | select 4 adjacent paragraphs in the Lexical writer | 4 adjacent sections · rewritten as one passage | one proposal over the span |
| gapped | select paragraph 5 and paragraph 30 | 4 sections, not adjacent · applied directly | direct edit |
| chrome | tap a header/footer band, then ✦ | This header/footer section · applied directly | direct edit |

- [ ] **Step 2: Select the gaps**

In the gapped state, tap `Select the gaps`. Expected: the header flips to
"N adjacent sections · rewritten as one passage" and the chip disappears.

- [ ] **Step 3: Not-Lexical wording**

Select 2+ adjacent paragraphs with the native (non-Lexical) view active.
Expected: header reads "N sections · applied directly" — **not** "not adjacent" —
and no `Select the gaps` chip.

- [ ] **Step 4: Suggestion slots**

Open the dock on a chapter with slow suggestions. Expected: two pulsing slots
hold the leading positions, and the canned chips do not jump vertically when the
real chips land.

- [ ] **Step 5: Suggestions off**

Settings → turn AI suggestions off. Expected: no slots, canned actions lead,
no empty labelled section.

- [ ] **Step 6: Ask entry points**

Confirm all three still focus the input: the pill's ✦, `GlobalDockBar`'s pinned
✦ (which must also revive a dismissed bubble), and `BlockContextBar`'s ✦.

- [ ] **Step 7: Keyboard clearance**

On the smallest available device, focus the ask input. Expected: the whole dock
sits above the keyboard with no clipping and no excessive gap.

- [ ] **Step 8: RTL**

Switch the app language to Arabic. Expected: header, ask bar and the action
scroller all start from the right; the scroller pans in the correct direction.

- [ ] **Step 9: Evicted toggles**

With the dock closed: `GlobalDockBar` → Select blocks enters and exits select
mode (tinted while on); Reorder toggles drag-to-reorder; header ⋮ → Section
markers shows a check and toggles the bands. Confirm select mode is never a trap.

- [ ] **Step 10: Commit nothing; report findings**

If any state's header disagrees with its behaviour, that is a `resolveDockScope`
bug, not a copy bug — fix the resolver, not the string.

---

## Notes for the implementer

- **`useLexicalEditorStore.active` must be read as a subscribed selector** in the
  shell (it is, in Task 8). Reading it via `getState()` during render would not
  re-render the dock when the surface changes, and the header would go stale.
- **Do not reintroduce a `scopeLabel` prop.** The header owns that text now, and
  a second source for it is how the header and the routing drift apart.
- **`inputOpen` keeps its name** on purpose: `BlockComposer`'s `keyboardWillHide`
  guard, `GlobalDockBar`'s ✦ and `BlockContextBar`'s `onAskAI` all reference it.
  Only its meaning changed, from "the input exists" to "focus the input".
- If a scope needs a new action, add it to `lib/ai-dock-scopes.ts` and nowhere
  else — that is the file's entire reason for existing.
