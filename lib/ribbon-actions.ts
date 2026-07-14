// lib/ribbon-actions.ts
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { RibbonTool } from "@/components/workspace/ribbon/ribbon-config";
import { buildToolInstruction } from "@/lib/ribbon-ai-bridge";
import i18n from "@/lib/i18n";
import {
  formatThesis,
  insertThesisImage,
  startThesisBlocksOnNewPage,
  editThesisParagraphs,
  setThesisPageSetup,
} from "@/lib/api";

export interface DispatchDeps {
  thesisId: string;
  /** Current focus selection (document order): block index + heading level + text. */
  selection: { index: number; text: string; level?: number }[];
  /** Refresh the document after a wired edit. */
  onAfterEdit: () => void;
  /** Route an AI-bridge action: fill the AI composer input + switch to AI mode. */
  onAiAction: (instruction: string) => void;
  /** Localized label of the chosen option (for AI instructions), if any. */
  optionLabel?: string;
}

/** Run a ribbon tool. `optionValue` is the chosen preset/segment value (if any). */
export async function dispatchRibbonAction(
  tool: RibbonTool,
  optionValue: string | undefined,
  deps: DispatchDeps,
): Promise<void> {
  const first = deps.selection[0];
  const selText = deps.selection.map((s) => s.text).filter(Boolean).join("\n\n");

  // AI-bridge path: any non-wired tool.
  const toAi = () =>
    deps.onAiAction(buildToolInstruction(tool, { optionValue, optionLabel: deps.optionLabel, selectionText: selText }));

  if (tool.status !== "wired") return toAi();

  try {
    switch (tool.actionKey) {
      case "design.thesisReady":
        await formatThesis(deps.thesisId);
        deps.onAfterEdit();
        return;

      case "insert.pageBreak":
      case "layout.breaks": {
        if (!first) return toAi(); // no anchor block → let AI decide placement
        const breakType = (optionValue as "nextPage" | "evenPage" | "oddPage") ?? "nextPage";
        await startThesisBlocksOnNewPage(deps.thesisId, [first.index], breakType);
        deps.onAfterEdit();
        return;
      }

      case "insert.picture": {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
        const asset = res.canceled ? null : res.assets[0];
        if (!asset?.base64) return;
        const mime = asset.mimeType ?? "";
        const format = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg";
        await insertThesisImage(deps.thesisId, {
          data: asset.base64, format, width: asset.width, height: asset.height,
          afterIndex: first ? first.index : -1,
        });
        deps.onAfterEdit();
        return;
      }

      case "heading.promote":
      case "heading.demote": {
        if (!first) return;
        if ((first.level ?? 0) < 1) return toAi(); // not a heading → let AI handle it
        const cur = first.level ?? 0;
        // promote = smaller number (toward H1); demote = larger. Clamp 0..6.
        const next = tool.actionKey === "heading.promote" ? Math.max(1, cur - 1) : Math.min(6, cur + 1);
        await editThesisParagraphs(deps.thesisId, [first.index], { level: next });
        deps.onAfterEdit();
        return;
      }

      case "layout.margins": {
        // MARGIN_OPTS values: normal | narrow | moderate | wide | mirrored
        if (!optionValue) return toAi();
        await setThesisPageSetup(deps.thesisId, { marginPreset: optionValue as any });
        deps.onAfterEdit();
        return;
      }

      case "layout.orientation": {
        // ORIENT_OPTS values: portrait | landscape
        if (optionValue !== "portrait" && optionValue !== "landscape") return toAi();
        await setThesisPageSetup(deps.thesisId, { orientation: optionValue });
        deps.onAfterEdit();
        return;
      }

      case "layout.size": {
        // SIZE_OPTS values: A4 | USLetter | USLegal | A3 | A5
        if (!optionValue) return toAi();
        await setThesisPageSetup(deps.thesisId, { pageSize: optionValue as any });
        deps.onAfterEdit();
        return;
      }

      case "layout.columns": {
        // COLUMN_OPTS values: "1" | "2" | "3" (arrive as strings)
        const count = Number(optionValue);
        if (!(count === 1 || count === 2 || count === 3)) return toAi();
        await setThesisPageSetup(deps.thesisId, { columns: count as 1 | 2 | 3 });
        deps.onAfterEdit();
        return;
      }

      default:
        // Marked wired but unhandled → fail safe to AI.
        return toAi();
    }
  } catch {
    Alert.alert(
      i18n.t("common.error", { defaultValue: "Error" }),
      i18n.t("workspace.bulkEditError", { defaultValue: "Could not apply the change." }),
    );
  }
}
