import React from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Eraser,
  Pilcrow,
  PilcrowLeft,
  PilcrowRight,
  type LucideIcon,
} from "lucide-react-native";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useToolbarStore } from "@/stores/toolbar-store";
import { AnimatedChip } from "../AnimatedChip";
import { useChipKit, useTools, type Align } from "./context";
import { toolStyles } from "./styles";

const ALIGN_OPTIONS: { value: Align; Icon: LucideIcon }[] = [
  { value: "left", Icon: AlignLeft },
  { value: "center", Icon: AlignCenter },
  { value: "right", Icon: AlignRight },
  { value: "justify", Icon: AlignJustify },
];
const DIRECTION_OPTIONS: { value: "rtl" | "ltr"; Icon: LucideIcon }[] = [
  { value: "rtl", Icon: PilcrowLeft },
  { value: "ltr", Icon: PilcrowRight },
];

/** Text-colour palette (6-hex RRGGBB, no '#') — a curated set that reads on both
 *  light and dark paper; the trailing eraser sends color:null. */
const TEXT_COLORS = ["111827", "C0392B", "E67E22", "F1C40F", "27AE60", "2980B9", "8E44AD"] as const;

/**
 * The sub-panel shared by the paragraph, heading and list toolbars: Style, Align,
 * Direction, List and Color. Which one shows is the store's `category`; the shell
 * decides where the panel sits (above the pill, or flown out beside the column).
 */
export function FormatPanel() {
  const { t } = useTranslation();
  const { optPill, colors } = useChipKit();
  const { rtl, vertical, canFormat, styleLevels, allLevel, allAlign, allDirection, colorActive, apply, lexActive, lexFmt } = useTools();
  const category = useToolbarStore((s) => s.category);

  const alignLabel: Record<Align, string> = {
    left: t("blockBar.alignLeft", { defaultValue: "Left" }),
    center: t("blockBar.alignCenter", { defaultValue: "Center" }),
    right: t("blockBar.alignRight", { defaultValue: "Right" }),
    justify: t("blockBar.alignJustify", { defaultValue: "Justify" }),
  };
  const directionLabel: Record<"rtl" | "ltr", string> = {
    rtl: t("blockBar.dirRtl", { defaultValue: "Right to left" }),
    ltr: t("blockBar.dirLtr", { defaultValue: "Left to right" }),
  };

  if (category === "style") {
    // Column form: the word "Normal" is wider than the strip, so level 0 shows the
    // ¶ glyph instead (the accessibility label stays "Normal"). Every other option
    // ("H1"…) already fits either way. A column has no reading direction to mirror,
    // so the rtl reversal applies to the row form only.
    const levels = rtl && !vertical ? [...styleLevels].reverse() : styleLevels;
    return (
      <>
        {levels.map((l, i) => {
          const active = allLevel(l);
          const enterIndex = rtl && !vertical ? styleLevels.length - 1 - i : i;
          const normalLabel = t("composer.edit.normal", { defaultValue: "Normal" });
          return (
            <AnimatedChip
              key={l}
              enterIndex={enterIndex}
              onPress={() => apply({ level: l })}
              disabled={!canFormat}
              active={active}
              accessibilityLabel={l === 0 ? normalLabel : `H${l}`}
              style={optPill(active, !canFormat)}
            >
              {l === 0 && vertical ? (
                <Pilcrow size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
              ) : (
                <Text
                  numberOfLines={1}
                  style={[toolStyles.optText, { color: active ? colors.bgPrimary : colors.textPrimary }]}
                >
                  {l === 0 ? normalLabel : `H${l}`}
                </Text>
              )}
            </AnimatedChip>
          );
        })}
      </>
    );
  }

  if (category === "align") {
    return (
      <>
        {ALIGN_OPTIONS.map(({ value, Icon }, i) => {
          const active = allAlign(value);
          return (
            <AnimatedChip
              key={value}
              enterIndex={i}
              onPress={() => apply({ alignment: value })}
              disabled={!canFormat}
              active={active}
              accessibilityLabel={alignLabel[value]}
              style={optPill(active, !canFormat)}
            >
              <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
            </AnimatedChip>
          );
        })}
      </>
    );
  }

  if (category === "direction") {
    return (
      <>
        {DIRECTION_OPTIONS.map(({ value, Icon }, i) => {
          const active = allDirection(value);
          return (
            <AnimatedChip
              key={value}
              enterIndex={i}
              onPress={() => apply({ direction: value })}
              disabled={!canFormat}
              active={active}
              accessibilityLabel={directionLabel[value]}
              style={optPill(active, !canFormat)}
            >
              <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
            </AnimatedChip>
          );
        })}
      </>
    );
  }

  if (category === "color") {
    // Each swatch dispatches format({ color }); the trailing eraser sends color:null.
    // Active = every selected run already carries that colour.
    return (
      <>
        {TEXT_COLORS.map((hex, i) => {
          const active = colorActive(hex);
          return (
            <AnimatedChip
              key={hex}
              enterIndex={i}
              onPress={() => apply({ color: hex })}
              disabled={!canFormat}
              active={active}
              accessibilityLabel={t("blockBar.colorSwatch", { defaultValue: `Color #${hex}`, hex })}
              style={optPill(false, !canFormat)}
            >
              <View
                style={[
                  toolStyles.swatch,
                  { backgroundColor: `#${hex}`, borderColor: colors.borderDefault },
                  active && { borderColor: colors.brandPrimary, borderWidth: 2 },
                ]}
              />
            </AnimatedChip>
          );
        })}
        <AnimatedChip
          key="color-clear"
          enterIndex={TEXT_COLORS.length}
          onPress={() => apply({ color: null })}
          disabled={!canFormat}
          accessibilityLabel={t("blockBar.colorClear", { defaultValue: "Clear color" })}
          style={optPill(false, !canFormat)}
        >
          <Eraser size={16} color={colors.textPrimary} strokeWidth={2} />
        </AnimatedChip>
      </>
    );
  }

  if (category !== "list") return null;

  const dispatchList = (v: "ul" | "ol" | "check" | "none") => useLexicalEditorStore.getState().dispatch("list", v);
  const soon = () =>
    Alert.alert(
      t("blockBar.soonTitle", { defaultValue: "Coming soon" }),
      t("blockBar.soonBody", { defaultValue: "Inline text styling arrives in a later update." }),
    );

  // LIVE in the Lexical Writer: this is the ENTRY point (make a paragraph a list);
  // once it IS one the bubble morphs to the dedicated list toolbar. Tapping the
  // ACTIVE kind removes the list. Bullets and numbers round-trip to Word; the
  // checklist is live-only.
  const blockType = lexFmt.blockType;
  const listOpts = [
    { key: "ul" as const, glyph: "•", label: t("blockBar.listBulleted", { defaultValue: "Bulleted list" }), on: blockType === "bullet" },
    { key: "ol" as const, glyph: "1.", label: t("blockBar.listNumbered", { defaultValue: "Numbered list" }), on: blockType === "number" },
    { key: "check" as const, glyph: "☑", label: t("blockBar.listCheck", { defaultValue: "Checklist" }), on: blockType === "check" },
  ];

  // Legacy (block-model) path: the DTO can't carry list-ness, so the options are
  // shown dimmed with a "coming soon" caption rather than silently doing nothing.
  if (!lexActive) {
    return (
      <>
        {listOpts.map((o, i) => (
          <AnimatedChip key={o.key} enterIndex={i} onPress={soon} accessibilityLabel={o.label} style={optPill(false, true)}>
            <Text style={[toolStyles.optText, { color: colors.textPlaceholder }]}>{o.glyph}</Text>
          </AnimatedChip>
        ))}
        <Text style={[toolStyles.soonCaption, { color: colors.textPlaceholder }]}>
          {t("blockBar.soonTitle", { defaultValue: "Coming soon" })}
        </Text>
      </>
    );
  }

  return (
    <>
      {listOpts.map((o, i) => (
        <AnimatedChip
          key={o.key}
          enterIndex={i}
          onPress={() => dispatchList(o.on ? "none" : o.key)}
          active={o.on}
          accessibilityLabel={o.label}
          style={optPill(o.on)}
        >
          <Text style={[toolStyles.optText, { color: o.on ? colors.bgPrimary : colors.textPrimary }]}>{o.glyph}</Text>
        </AnimatedChip>
      ))}
    </>
  );
}
