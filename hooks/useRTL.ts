import { I18nManager } from "react-native";
import { useTranslation } from "react-i18next";
import { isRTL } from "@/lib/i18n";

export function useRTL() {
  const { i18n } = useTranslation();
  const rtl = isRTL(i18n.language);

  return {
    isRTL: rtl,
    flexDirection: (rtl ? "row-reverse" : "row") as "row" | "row-reverse",
    textAlign: (rtl ? "right" : "left") as "right" | "left",
    iconRotation: rtl ? "180deg" : "0deg",
    start: rtl ? "right" : "left",
    end: rtl ? "left" : "right",
  };
}
