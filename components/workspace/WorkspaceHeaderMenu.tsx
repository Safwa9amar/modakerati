import { useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import {
  MoreHorizontal,
  ListTree,
  Focus,
  Library,
  Download,
  PanelBottomOpen,
  PanelBottomClose,
  Maximize2,
  Check,
  type LucideIcon,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * The workspace header "⋯" (more) overflow menu. Declutters the live-doc header
 * by collapsing the secondary actions — Navigator (outline), Focus mode, Sources,
 * Export, Composer show/hide, and Maximize/A4 — into a single trailing button
 * that opens a bottom action sheet (same transparent-Modal + backdrop pattern as
 * ThesisHeaderMenu). Undo/redo and the read-only Preview button stay in the header.
 *
 * Focus / composer read the workspace store directly (they're toggles with an
 * active state); the outline / sources / export / maximize actions are passed in
 * so the screen keeps ownership of its handlers and the live-doc download URL.
 */
export function HeaderMenuButton({
  onOpenOutline,
  onOpenSources,
  onExport,
  onMaximize,
  downloadUrl,
}: {
  onOpenOutline: () => void;
  onOpenSources: () => void;
  onExport: () => void;
  onMaximize: () => void;
  downloadUrl?: string;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Toggle state for the two rows that reflect a live mode (select primitives
  // individually — never an object-literal selector, which would loop).
  const focusMode = useWorkspaceStore((s) => s.focusMode);
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);

  const canExport = !!downloadUrl;

  // Run a row's action then dismiss the sheet.
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.more", { defaultValue: "More" })}
        style={styles.btn}
      >
        <MoreHorizontal size={22} color={colors.textPrimary} />
      </Pressable>

      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Inner Pressable swallows taps so they don't dismiss the sheet. */}
          <Pressable style={[styles.sheet, { backgroundColor: colors.bgModal }]} onPress={() => {}}>
            <Text style={[styles.sheetTitle, { color: colors.textSecondary }]}>
              {t("workspace.more", { defaultValue: "More" })}
            </Text>

            <Row
              icon={ListTree}
              label={t("workspace.outline", { defaultValue: "Outline" })}
              color={colors.textPrimary}
              onPress={run(onOpenOutline)}
            />
            <Row
              icon={Focus}
              label={t("workspace.focusMode", { defaultValue: "Focus mode" })}
              color={focusMode ? colors.brandPrimary : colors.textPrimary}
              active={focusMode}
              onPress={run(() => useWorkspaceStore.getState().toggleFocusMode())}
            />
            <Row
              icon={Library}
              label={t("workspace.sources", { defaultValue: "Sources" })}
              color={colors.textPrimary}
              onPress={run(onOpenSources)}
            />
            <Row
              icon={Download}
              label={t("workspace.export", { defaultValue: "Export" })}
              color={colors.textPrimary}
              disabled={!canExport}
              onPress={run(onExport)}
            />
            <Row
              icon={composerOpen ? PanelBottomClose : PanelBottomOpen}
              label={
                composerOpen
                  ? t("workspace.hideComposer", { defaultValue: "Hide composer" })
                  : t("workspace.showComposer", { defaultValue: "Show composer" })
              }
              color={composerOpen ? colors.brandPrimary : colors.textPrimary}
              onPress={run(() => useWorkspaceStore.getState().toggleComposer())}
            />
            <Row
              icon={Maximize2}
              label={t("workspace.maximize", { defaultValue: "Full page" })}
              color={colors.textPrimary}
              disabled={!canExport}
              onPress={run(onMaximize)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// A single labeled action row. `active` shows a trailing check (used by the
// Focus toggle); `disabled` dims it and blocks the press (Export / Maximize
// without a download URL). `color` tints both icon and label together.
function Row({
  icon: Icon,
  label,
  color,
  onPress,
  active,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const tint = disabled ? colors.textPlaceholder : color;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, checked: active }}
      style={styles.item}
    >
      <Icon size={19} color={tint} strokeWidth={2} />
      <Text style={[styles.itemText, { color: tint }]}>{label}</Text>
      <View style={styles.spacer} />
      {active && <Check size={18} color={colors.brandPrimary} strokeWidth={2.5} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    padding: 16,
    paddingBottom: 32,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 4,
  },
  sheetTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginLeft: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
  itemText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  spacer: { flex: 1 },
});
