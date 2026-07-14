import { useRef, type FC } from "react";
import { Pressable, Animated, StyleSheet } from "react-native";
import { DocxIcon, OutlineIcon, PdfIcon } from "./FileTypeIcons";
import { useWorkspaceStore, type DocViewMode } from "@/stores/workspace-store";

// One header button that CYCLES the live-.docx view modes. It shows the CURRENT
// mode's icon and spins 360° on each tap as it advances to the next mode.
// Entering "pdf" kicks off the server conversion and leaving it drops the render
// — both handled by effects in the workspace screen that key on viewMode, so this
// only calls setViewMode.
const CYCLE: DocViewMode[] = ["docx", "outline", "pdf"];
const ICONS: Record<DocViewMode, FC<{ size?: number }>> = {
  docx: DocxIcon,
  outline: OutlineIcon,
  pdf: PdfIcon,
};

export function WorkspaceViewSwitcher() {
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const spin = useRef(new Animated.Value(0)).current;

  const Icon = ICONS[viewMode] ?? DocxIcon;

  const cycle = () => {
    const i = CYCLE.indexOf(viewMode);
    const next = CYCLE[(i + 1) % CYCLE.length];
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    useWorkspaceStore.getState().setViewMode(next);
  };

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Pressable
      onPress={cycle}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`View: ${viewMode}`}
      style={styles.btn}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Icon size={22} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, alignItems: "center", justifyContent: "center" },
});
