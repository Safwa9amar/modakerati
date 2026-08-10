import { I18nManager } from "react-native";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/lib/i18n";
import { visualRow, visualTextAlign } from "@/lib/rtl-layout";

export function useRTL() {
  const { i18n } = useTranslation();
  const rtl = isRTL(i18n.language);

  return {
    isRTL: rtl,
    // NOT `rtl ? "row-reverse" : "row"`. Arabic sets I18nManager.forceRTL, so RN
    // has already mirrored every row — asking for row-reverse on top flipped it
    // straight back to visual LTR, which is why icons, chevrons and the account
    // avatar all sat on the wrong side of the Arabic UI. See @/lib/rtl-layout.
    flexDirection: visualRow(rtl),
    // Also NOT `rtl ? "right" : "left"`. RN reads textAlign as start/end against
    // the paragraph direction, so "right" in Arabic means the paragraph's END —
    // which is how every drawer label ended up stranded at the far side of its
    // row from its own icon.
    textAlign: visualTextAlign(rtl),
    // A transform, so RN does NOT mirror it for us — this one really does follow
    // the language alone, whatever the global direction is doing.
    iconRotation: rtl ? "180deg" : "0deg",
    // Physical edge keys (`{[start]: 0}`). Under forceRTL, RN swaps a literal
    // `left`/`right` in layout, so these need the same match-the-app rule the
    // row direction does: emit the plain edge when the directions agree.
    start: (rtl === I18nManager.isRTL ? "left" : "right") as "left" | "right",
    end: (rtl === I18nManager.isRTL ? "right" : "left") as "left" | "right",
  };
}
