import React from "react";
import { Sparkles } from "lucide-react-native";
import { useHfSheetStore } from "@/stores/hf-sheet-store";
import { useChipKit, useTools } from "./context";

/**
 * A running header / footer band — a FALLBACK toolset only.
 *
 * These bands normally never reach the bubble at all: tapping one opens the
 * header/footer bottom sheet directly (see WorkspaceLexicalView's chrome branch and
 * components/HeaderFooterSheet), because the whole flow — instruction, compiled
 * preview, template cards — needs a sheet's room, not a pill hovering over the page.
 *
 * This exists so the registry stays total, and so a band that somehow does land in the
 * bubble still has one honest action: open the sheet. There is no sub-panel.
 */
export function HeaderFooterTools() {
  const { chip, t } = useChipKit();
  const { thesisId, chrome } = useTools();
  return (
    <>
      {chip({
        keyProp: "hf-ai",
        Icon: Sparkles,
        accessibilityLabel: t("workspace.hf.aiEdit", { defaultValue: "Ask Kwill to change" }),
        enterIndex: 0,
        onPress: () => {
          if (!chrome || (chrome.kind !== "top" && chrome.kind !== "bottom")) return;
          useHfSheetStore.getState().openBand({
            thesisId,
            index: chrome.index,
            region: chrome.kind === "top" ? "header" : "footer",
            text: chrome.text,
          });
        },
      })}
    </>
  );
}
