import React from "react";
import { View, Pressable, Text, StyleSheet, I18nManager } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Eraser,
  Undo2,
  Redo2,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { hSelection } from "@/lib/haptics";
import type { LexicalState } from "./LexicalDomEditor";

// Text-colour swatches (6-hex, no '#'), mirroring BlockContextBar's palette; the
// trailing eraser sends color:"clear".
const COLORS = ["111827", "C0392B", "E67E22", "27AE60", "2980B9", "8E44AD"] as const;

// The full formatting pill — the BlockContextBar toolset, but driving LEXICAL:
// each chip sends a serializable command out; active state mirrors Lexical's
// reported LexicalState. RTL-aware (row-reverse) like the real bar. ✦ Ask AI is
// optional (the lab screens don't pass it).
export function LexicalBubble({
  active,
  onCommand,
  onAskAI,
}: {
  active: LexicalState;
  onCommand: (type: string, value?: string) => void;
  onAskAI?: () => void;
}) {
  const colors = useThemeColors();
  const rtl = I18nManager.isRTL;

  const chip = (key: string, Icon: LucideIcon, isActive: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={() => { hSelection(); onPress(); }}
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
    <View style={[styles.wrap, { flexDirection: rtl ? "row-reverse" : "row" }]} pointerEvents="box-none">
      <View style={[styles.pill, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle, flexDirection: rtl ? "row-reverse" : "row" }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={styles.scroll}
          contentContainerStyle={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}
        >
          {chip("undo", Undo2, false, () => onCommand("undo"))}
          {chip("redo", Redo2, false, () => onCommand("redo"))}
          {sep("s0")}
          {chip("bold", Bold, active.bold, () => onCommand("bold"))}
          {chip("italic", Italic, active.italic, () => onCommand("italic"))}
          {chip("underline", Underline, active.underline, () => onCommand("underline"))}
          {sep("s1")}
          {chip("h1", Heading1, active.blockType === "h1", () => onCommand("heading", active.blockType === "h1" ? "paragraph" : "h1"))}
          {chip("h2", Heading2, active.blockType === "h2", () => onCommand("heading", active.blockType === "h2" ? "paragraph" : "h2"))}
          {chip("h3", Heading3, active.blockType === "h3", () => onCommand("heading", active.blockType === "h3" ? "paragraph" : "h3"))}
          {chip("quote", Quote, active.blockType === "quote", () => (active.blockType === "quote" ? onCommand("heading", "paragraph") : onCommand("quote")))}
          {sep("s2")}
          {chip("ul", List, active.blockType === "bullet", () => onCommand("list", active.blockType === "bullet" ? "none" : "ul"))}
          {chip("ol", ListOrdered, active.blockType === "number", () => onCommand("list", active.blockType === "number" ? "none" : "ol"))}
          {sep("s3")}
          {chip("al", AlignLeft, false, () => onCommand("align", "left"))}
          {chip("ac", AlignCenter, false, () => onCommand("align", "center"))}
          {chip("ar", AlignRight, false, () => onCommand("align", "right"))}
          {chip("aj", AlignJustify, false, () => onCommand("align", "justify"))}
          {sep("s4")}
          {/* Colour swatches → color command; the eraser clears colour + marks. */}
          {COLORS.map((hex) => (
            <Pressable
              key={`c-${hex}`}
              onPress={() => { hSelection(); onCommand("color", hex); }}
              accessibilityRole="button"
              style={[styles.chip, { borderColor: colors.borderDefault, backgroundColor: colors.bgCard }]}
            >
              <View style={[styles.swatch, { backgroundColor: `#${hex}`, borderColor: colors.borderDefault }]} />
            </Pressable>
          ))}
          {chip("clear", Eraser, false, () => onCommand("clearFormatting"))}
        </ScrollView>
        <View style={[styles.sep, { backgroundColor: colors.borderSubtle }]} />
        <View style={[styles.dirBadge, { borderColor: colors.borderDefault, backgroundColor: colors.bgCard }]}>
          <Text style={[styles.dirText, { color: active.isRTL ? colors.brandPrimary : colors.textPlaceholder }]}>{active.isRTL ? "RTL" : "LTR"}</Text>
        </View>
      </View>
      {onAskAI ? (
        <Pressable onPress={onAskAI} accessibilityRole="button" accessibilityLabel="Ask AI" style={[styles.ask, { backgroundColor: colors.brandPrimary }]}>
          <Sparkles size={18} color={colors.bgPrimary} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const CHIP = 40;
const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, alignItems: "center", gap: 6 },
  pill: {
    flexShrink: 1,
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  scroll: { flexShrink: 1 },
  row: { alignItems: "center", gap: 5 },
  chip: { width: CHIP, height: CHIP, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
  sep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },
  dirBadge: { paddingHorizontal: 8, height: CHIP, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dirText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  ask: { width: CHIP, height: CHIP, borderRadius: CHIP / 2, alignItems: "center", justifyContent: "center", elevation: 6 },
});
