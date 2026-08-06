import React from "react";
import { Alert, Text } from "react-native";
import { ChevronDown, ChevronUp, Link2, Plus, SeparatorHorizontal } from "lucide-react-native";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useToolbarStore, type ToolbarCategory } from "@/stores/toolbar-store";
import { useHfSheetStore } from "@/stores/hf-sheet-store";
import { chromeOp, type ChromeOp } from "@/lib/api";
import { AnimatedChip } from "../AnimatedChip";
import { useChipKit, useTools } from "./context";
import { toolStyles } from "./styles";

/** Direct (non-AI) chrome edits. `index` is a block inside the target Word section;
 *  the server resolves the section, persists, and echoes the mutated document, which
 *  we hand to the optimistic doc store. */
export function useChromeOp(thesisId: string) {
  return (op: ChromeOp, onError: string) => {
    void (async () => {
      try {
        const res = await chromeOp(thesisId, op);
        if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
      } catch {
        Alert.alert(onError);
      }
    })();
  };
}

/**
 * A section-break band. Its actions are all about the SECTION rather than any block:
 * add the header/footer parts it lacks, share or unshare the running chrome with the
 * previous section, jump between section boundaries, and (while the break is still
 * continuous) make it start on a fresh page.
 */
export function SectionTools() {
  const { chip, t } = useChipKit();
  const { thesisId, chrome } = useTools();
  const category = useToolbarStore((s) => s.category);
  const toggleCategory = useToolbarStore((s) => s.toggleCategory);
  const closeCategory = useToolbarStore((s) => s.closeCategory);
  const applyChrome = useChromeOp(thesisId);
  // The live doc — used to walk between section boundaries. Selecting the stored
  // object (a stable ref) avoids a render loop.
  const doc = useThesisDocStore((s) => s.byId[thesisId]);

  if (!chrome || chrome.kind !== "section") return null;

  const sections = doc?.available ? doc.sections ?? [] : [];
  const pos = sections.findIndex((sc) => sc.startBlockIndex === chrome.index);
  const hasPrev = pos > 0;
  const hasNext = pos >= 0 && pos < sections.length - 1;
  const goToSection = (delta: -1 | 1) => {
    const target = sections[pos + delta];
    if (!target) return;
    closeCategory();
    useWorkspaceStore.getState().requestScrollToBlock(target.startBlockIndex);
  };

  // One-way: the chip only shows while the section still flows continuously.
  const startOnNewPage = () => {
    applyChrome({ op: "startOnNewPage", index: chrome.index }, t("common.error", { defaultValue: "Something went wrong" }));
    useWorkspaceStore.getState().setChromeSelection({ ...chrome, startsOnNewPage: true });
  };

  return (
    <>
      {/* Creating a part opens the header/footer SHEET (which then hands straight over
          to editing it) rather than a sub-panel — same surface the bands themselves
          open, so "add" and "change" are one flow. */}
      {!chrome.hasHeader || !chrome.hasFooter
        ? chip({
            keyProp: "hf-add",
            Icon: Plus,
            accessibilityLabel: t("workspace.hf.addHeaderFooter", { defaultValue: "Add header / footer" }),
            enterIndex: 0,
            onPress: () =>
              useHfSheetStore.getState().openAdd({
                thesisId,
                index: chrome.index,
                hasHeader: !!chrome.hasHeader,
                hasFooter: !!chrome.hasFooter,
              }),
          })
        : null}
      {/* A bare link icon reads as nothing to a student, so the chip opens a sub-panel
          with two plain-language choices instead of toggling in place. */}
      {chrome.linkedToPrevious != null
        ? chip({
            keyProp: "hf-link",
            Icon: Link2,
            accessibilityLabel: t("workspace.hf.linkToggle", { defaultValue: "Link to previous section" }),
            active: category === "hfLink",
            enterIndex: 1,
            onPress: () => toggleCategory("hfLink"),
          })
        : null}
      {chip({ keyProp: "hf-prev-sec", Icon: ChevronUp, accessibilityLabel: t("workspace.hf.prevSection", { defaultValue: "Previous section" }), active: false, disabled: !hasPrev, enterIndex: 2, onPress: () => goToSection(-1) })}
      {chip({ keyProp: "hf-next-sec", Icon: ChevronDown, accessibilityLabel: t("workspace.hf.nextSection", { defaultValue: "Next section" }), active: false, disabled: !hasNext, enterIndex: 3, onPress: () => goToSection(1) })}
      {!chrome.startsOnNewPage
        ? chip({ keyProp: "hf-newpage", Icon: SeparatorHorizontal, accessibilityLabel: t("workspace.hf.startOnNewPage", { defaultValue: "Start on a new page" }), active: false, enterIndex: 4, onPress: startOnNewPage })
        : null}
    </>
  );
}

/** The section band's two sub-panels: "add a part" and "link to previous". Both are
 *  labelled in words — these choices are meaningless as bare icons. */
export function SectionPanel() {
  const { optPill, colors, t } = useChipKit();
  const { thesisId, chrome } = useTools();
  const category = useToolbarStore((s) => s.category);
  const closeCategory = useToolbarStore((s) => s.closeCategory);
  const applyChrome = useChromeOp(thesisId);
  const errorMsg = t("common.error", { defaultValue: "Something went wrong" });

  if (!chrome || chrome.kind !== "section") return null;

  const labelOpt = (key: string, label: string, active: boolean, enterIndex: number, onPress: () => void) => (
    <AnimatedChip key={key} enterIndex={enterIndex} onPress={onPress} active={active} accessibilityLabel={label} style={optPill(active)}>
      <Text numberOfLines={1} style={[toolStyles.optText, { color: active ? colors.bgPrimary : colors.textPrimary }]}>
        {label}
      </Text>
    </AnimatedChip>
  );

  if (category !== "hfLink") return null;

  // Linked → the section shares the previous section's running chrome; unlinked → it
  // gets its own independent copy. Optimistically set the state; the echoed document
  // reconciles doc.sections for the next tap.
  const linked = !!chrome.linkedToPrevious;
  const setLinkedToPrev = (v: boolean) => {
    applyChrome({ op: v ? "linkToPrevious" : "unlinkFromPrevious", index: chrome.index }, errorMsg);
    useWorkspaceStore.getState().setChromeSelection({ ...chrome, linkedToPrevious: v });
    closeCategory();
  };
  return (
    <>
      {labelOpt("lk-on", t("workspace.hf.linkToPrevious", { defaultValue: "Same as previous section" }), linked, 0, () => setLinkedToPrev(true))}
      {labelOpt("lk-off", t("workspace.hf.unlinkFromPrevious", { defaultValue: "Give this section its own" }), !linked, 1, () => setLinkedToPrev(false))}
    </>
  );
}
