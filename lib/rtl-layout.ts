import { I18nManager } from "react-native";

// ─────────────────────────────────────────────────────────────────────────────
// Row direction, for an app that ALREADY mirrors itself.
//
// `I18nManager.forceRTL(true)` (see lib/i18n.ts — Arabic sets it and reboots)
// makes Yoga mirror the whole tree: `flexDirection: "row"` lays its children out
// right-to-left, `left` and `right` swap, the lot. Native mirroring is a layout
// DIRECTION, not a style — you do not get to see it in the style object.
//
// So the obvious-looking `rtl ? "row-reverse" : "row"` is a bug in exactly the
// case it was written for. In Arabic it asks for a SECOND flip on top of the one
// RN already did, and the two cancel: the icon lands on the left, the chevron on
// the right, the avatar on the left — a visually LTR row inside an RTL app. In
// French there is no native flip to cancel, so the same expression is correct,
// which is why this survived: it is right in two of the three languages and the
// third was the one nobody laid a ruler against.
//
// The question a row actually needs answered is "does the direction I want match
// the direction the app is already in?" — if yes, do nothing and let RN mirror;
// if no, flip once to overrule it. That is the whole rule, and it is symmetric:
//
//   rtl=false, app LTR → "row"          (no flip needed)
//   rtl=true,  app RTL → "row"          (RN already flipped it)
//   rtl=true,  app LTR → "row-reverse"  (Arabic content in a French UI)
//   rtl=false, app RTL → "row-reverse"  (a Latin row in an Arabic UI)
//
// `rtl` is whatever direction THIS row should read in — usually the app
// language, but for document content it is the direction detected from the text
// (see thesis-language-rtl), and for a chat message it is that message's own.
// The rule is the same either way.
// ─────────────────────────────────────────────────────────────────────────────

export type RowDirection = "row" | "row-reverse";

/** Lay a row out so it reads in `rtl`'s direction, whatever the app's own is. */
export function visualRow(rtl: boolean): RowDirection {
  return rtl === I18nManager.isRTL ? "row" : "row-reverse";
}

/**
 * Renders children left→right on screen no matter the app locale. For rows we
 * order visually ourselves — table columns, a media strip — where "start" is
 * meaningless because the sequence is positional, not linguistic.
 */
export const LTR_ROW: RowDirection = I18nManager.isRTL ? "row-reverse" : "row";

// ─────────────────────────────────────────────────────────────────────────────
// Text alignment, which is the SAME trap wearing different clothes.
//
// RN's `textAlign: "left" | "right"` is not physical. Android resolves it
// against the paragraph's layout direction (TextLayoutManager.getTextAlignment
// → getTextGravity): "left" becomes ALIGN_NORMAL — the paragraph's START — and
// "right" becomes ALIGN_OPPOSITE, its END. Only then is that turned into a
// physical gravity using the SCRIPT's direction.
//
// So in an Arabic app, `textAlign: "right"` asks for the END of a right-to-left
// paragraph, and the label renders hard against the LEFT edge — which is
// precisely how the drawer looked, every label stranded at the far side of its
// row from the icon it belonged to.
//
// The rule is identical to visualRow's, and so is the payoff: when the app is
// LTR this reduces to the `rtl ? "right" : "left"` it replaces, so French and
// English render byte-identically and only Arabic changes.
// ─────────────────────────────────────────────────────────────────────────────

export type TextAlign = "left" | "right";

/** Align to the reading START of `rtl` — where a label or a heading belongs. */
export function visualTextAlign(rtl: boolean): TextAlign {
  return rtl === I18nManager.isRTL ? "left" : "right";
}

/** Align to the reading END — a trailing slot, a page number, an outer column. */
export function visualTextAlignEnd(rtl: boolean): TextAlign {
  return rtl === I18nManager.isRTL ? "right" : "left";
}
