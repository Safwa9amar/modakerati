import React, { createContext, useContext } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Plus, type LucideIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { isWidePanel, useToolbarStore, type ToolbarCategory } from "@/stores/toolbar-store";
import type { DocBlockDTO } from "@/lib/api";
import type { FormatChange } from "@/lib/thesis-ops";
import { AnimatedChip } from "../AnimatedChip";
import { toolStyles } from "./styles";

export type ParagraphBlock = Extract<DocBlockDTO, { kind: "paragraph" }>;
export type Align = "left" | "center" | "right" | "justify";

/** A selected Word chrome band (running header / footer / section break). Mirrors
 *  the workspace store's shape — see BlockContextBar's `chrome` prop. */
export interface ChromeSelection {
  kind: "top" | "bottom" | "section";
  index: number;
  text: string;
  pageNumbers?: boolean;
  linkedToPrevious?: boolean | null;
  startsOnNewPage?: boolean;
  segments?: string[];
  hasHeader?: boolean;
  hasFooter?: boolean;
}

/**
 * Everything a bubble toolbar needs about the current selection, plus the actions
 * that more than one toolbar shares (formatting, move, delete, search). Kind-SPECIFIC
 * behaviour — table ops, picture ops, chrome ops, list dispatch — deliberately lives
 * inside the toolbar that owns it, not here.
 *
 * Built once per render by the shell (BlockContextBar) and read through useTools().
 */
export interface ToolbarCtx {
  thesisId: string;
  /** DOCUMENT direction — NOT the app's UI language (see useRTL for that). */
  rtl: boolean;
  /** Column form: chips stack, dividers turn, options fly out sideways. */
  vertical: boolean;

  blocks?: DocBlockDTO[];
  blockCount: number;
  paragraphSelection: ParagraphBlock[];
  selectedBlock: DocBlockDTO | null;
  selectedIndices: number[];
  count: number;
  chrome: ChromeSelection | null;

  /** At least one PARAGRAPH is selected — the text tools' precondition. */
  canFormat: boolean;
  /** The sole selected paragraph (null unless exactly one). */
  single: ParagraphBlock | null;
  /** The sole selected block of ANY kind — move/replace/delete anchor. */
  soleIndex: number | null;
  paraIndices: number[];
  canUp: boolean;
  canDown: boolean;
  /** [0, 1…N] — Normal plus every heading level in use, capped one deeper. */
  styleLevels: number[];
  headingLevels: number[];

  /** Is the Lexical Writer the live surface? Then formatting dispatches into the
   *  editor instead of the durable op queue, and its reported format is the truth. */
  lexActive: boolean;
  lexFmt: { blockType: string; alignment: string | null; isRTL: boolean; bold: boolean; italic: boolean; underline: boolean };

  allLevel: (l: number) => boolean;
  allAlign: (v: Align) => boolean;
  allDirection: (v: "rtl" | "ltr") => boolean;
  allBold: boolean;
  allItalic: boolean;
  allUnderline: boolean;
  colorActive: (hex: string) => boolean;

  apply: (changes: FormatChange) => void;
  move: (dir: "up" | "down") => void;
  del: () => void;
  openSearch: () => void;
  pickImage: () => void;
  /** Insert whatever image the system clipboard holds, no picker detour. */
  pasteImage: () => void;
}

const Ctx = createContext<ToolbarCtx | null>(null);

export function ToolbarProvider({ value, children }: { value: ToolbarCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read the selection + shared actions. Throws outside a provider — every toolbar
 *  is rendered by the shell, so that can only be a wiring mistake. */
export function useTools(): ToolbarCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTools must be used inside <ToolbarProvider>");
  return ctx;
}

/**
 * The chip builders every toolbar draws with. They're element-returning FUNCTIONS,
 * not components, on purpose: a component declared inline would be a fresh type each
 * render and remount every chip (killing the press/active springs mid-gesture).
 * AnimatedChip itself is declared once at module scope, so identity stays stable.
 */
export function useChipKit() {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { vertical, canFormat } = useTools();
  const category = useToolbarStore((s) => s.category);
  const toggleCategory = useToolbarStore((s) => s.toggleCategory);

  const chip = (opts: {
    keyProp: string;
    Icon: LucideIcon;
    onPress: () => void;
    active?: boolean;
    disabled?: boolean;
    dim?: boolean;
    accessibilityLabel: string;
    enterIndex?: number | null;
  }) => {
    const { Icon } = opts;
    return (
      <AnimatedChip
        key={opts.keyProp}
        onPress={opts.onPress}
        disabled={opts.disabled}
        active={opts.active}
        accessibilityLabel={opts.accessibilityLabel}
        enterIndex={opts.enterIndex}
        style={[
          toolStyles.chip,
          { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
          opts.active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
          (opts.disabled || opts.dim) && toolStyles.chipDim,
        ]}
      >
        <Icon size={17} color={opts.active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
      </AnimatedChip>
    );
  };

  /** A chip that opens/closes its sub-panel. The text categories disable themselves
   *  when nothing formattable is selected. */
  const categoryChip = (c: ToolbarCategory, Icon: LucideIcon, label: string, enterIndex?: number) =>
    chip({
      keyProp: "cat-" + c,
      Icon,
      accessibilityLabel: label,
      enterIndex,
      active: category === c,
      disabled: (c === "style" || c === "align" || c === "direction") && !canFormat,
      onPress: () => toggleCategory(c),
    });

  const sep = (k: string) => (
    <View key={k} style={[vertical ? toolStyles.sepV : toolStyles.sep, { backgroundColor: colors.borderSubtle }]} />
  );

  /** Option pill inside a sub-panel (a level, an alignment, a swatch…). In the column
   *  form the fly-out is one chip wide, so its options wear the chip's square footprint
   *  rather than the roomy pill — see optPillNarrow. The wide-fly-out categories (their
   *  options are words) keep the pill in both forms. */
  const narrowPanel = vertical && !isWidePanel(category);
  const optPill = (active: boolean, disabled?: boolean) => [
    toolStyles.optPill,
    narrowPanel && toolStyles.optPillNarrow,
    { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
    active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
    disabled && toolStyles.chipDim,
  ];

  /** Icon-only option pill — the shape the table + chrome panels are built from. */
  const iconOpt = (
    key: string,
    Icon: LucideIcon,
    label: string,
    enterIndex: number,
    onPress: () => void,
    opts?: { active?: boolean; disabled?: boolean },
  ) => (
    <AnimatedChip
      key={key}
      enterIndex={enterIndex}
      onPress={onPress}
      disabled={opts?.disabled}
      active={opts?.active}
      accessibilityLabel={label}
      style={optPill(!!opts?.active, !!opts?.disabled)}
    >
      <Icon
        size={16}
        color={opts?.active ? colors.bgPrimary : opts?.disabled ? colors.textPlaceholder : colors.textPrimary}
        strokeWidth={2}
      />
    </AnimatedChip>
  );

  /** Shared "More tools" chip — the compact toolsets' last entry. */
  const moreChip = (keyProp: string, enterIndex: number) =>
    chip({
      keyProp,
      Icon: Plus,
      accessibilityLabel: t("blockBar.more", { defaultValue: "More tools" }),
      enterIndex,
      onPress: () => useToolbarStore.getState().openMore(),
    });

  return { chip, categoryChip, sep, optPill, iconOpt, moreChip, colors, t };
}
