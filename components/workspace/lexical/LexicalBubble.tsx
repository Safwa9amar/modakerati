import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Quote,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo2,
  Redo2,
  type LucideIcon,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { hSelection } from "@/lib/haptics";
import type { LexicalState } from "./LexicalDomEditor";

// The SAME native bubble concept, driving Lexical instead of the block ops. Every
// chip sends a serializable command out (parent adds the nonce); active state is
// mirrored from Lexical's reported `LexicalState` so B/I/U/heading light up. This
// proves the bubble survives a swap of the editing surface.
export function LexicalBubble({
  active,
  onCommand,
}: {
  active: LexicalState;
  onCommand: (type: string, value?: string) => void;
}) {
  const colors = useThemeColors();

  const chip = (key: string, Icon: LucideIcon, isActive: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={() => {
        hSelection();
        onPress();
      }}
      accessibilityRole="button"
      style={[
        styles.chip,
        { borderColor: colors.borderDefault, backgroundColor: colors.bgCard },
        isActive && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
      ]}
    >
      <Icon size={17} color={isActive ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
    </Pressable>
  );

  const sep = (k: string) => <View key={k} style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />;

  return (
    <View style={[styles.bar, { backgroundColor: colors.bgPrimary, borderTopColor: colors.borderSubtle }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {chip("undo", Undo2, false, () => onCommand("undo"))}
        {chip("redo", Redo2, false, () => onCommand("redo"))}
        {sep("s0")}
        {chip("bold", Bold, active.bold, () => onCommand("bold"))}
        {chip("italic", Italic, active.italic, () => onCommand("italic"))}
        {chip("underline", Underline, active.underline, () => onCommand("underline"))}
        {sep("s1")}
        {chip("h1", Heading1, active.blockType === "h1", () =>
          onCommand("heading", active.blockType === "h1" ? "paragraph" : "h1"),
        )}
        {chip("h2", Heading2, active.blockType === "h2", () =>
          onCommand("heading", active.blockType === "h2" ? "paragraph" : "h2"),
        )}
        {chip("quote", Quote, active.blockType === "quote", () =>
          active.blockType === "quote" ? onCommand("heading", "paragraph") : onCommand("quote"),
        )}
        {sep("s2")}
        {chip("ul", List, active.blockType === "bullet", () =>
          onCommand("list", active.blockType === "bullet" ? "none" : "ul"),
        )}
        {chip("ol", ListOrdered, active.blockType === "number", () =>
          onCommand("list", active.blockType === "number" ? "none" : "ol"),
        )}
        {sep("s3")}
        {chip("al", AlignLeft, false, () => onCommand("align", "left"))}
        {chip("ac", AlignCenter, false, () => onCommand("align", "center"))}
        {chip("ar", AlignRight, false, () => onCommand("align", "right"))}
      </ScrollView>
      {/* Direction read-out from Lexical's auto-bidi — the "left/right" signal. */}
      <View style={[styles.dirBadge, { borderColor: colors.borderDefault }]}>
        <Text style={[styles.dirText, { color: active.isRTL ? colors.brandPrimary : colors.textPlaceholder }]}>
          {active.isRTL ? "RTL" : "LTR"}
        </Text>
      </View>
    </View>
  );
}

const CHIP = 38;
const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: { alignItems: "center", gap: 5, paddingRight: 6 },
  chip: {
    width: CHIP,
    height: CHIP,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },
  dirBadge: {
    paddingHorizontal: 8,
    height: CHIP,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dirText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
