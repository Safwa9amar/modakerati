import React, { useState } from "react";
import { View, ScrollView, Pressable, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Eraser } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { editThesisParagraph } from "@/lib/api";
import type { DocBlockDTO } from "@/lib/api";

type Align = "left" | "center" | "right" | "justify";

interface Props {
  thesisId: string;
  block: Extract<DocBlockDTO, { kind: "paragraph" }> | null; // the single selected paragraph block, else null
  hint: string;                 // "Select a paragraph to edit."
  styleLabels: { normal: string };
  onAfterEdit: () => void;      // refreshDoc
  rtl: boolean;
}

const STYLE_OPTIONS: Array<{ level: number; label: string }> = [
  { level: 0, label: "" }, // label filled from styleLabels.normal at render
  { level: 1, label: "H1" }, { level: 2, label: "H2" }, { level: 3, label: "H3" },
  { level: 4, label: "H4" }, { level: 5, label: "H5" }, { level: 6, label: "H6" },
];
const ALIGN_OPTIONS: Array<{ value: Align; Icon: typeof AlignLeft }> = [
  { value: "left", Icon: AlignLeft }, { value: "center", Icon: AlignCenter },
  { value: "right", Icon: AlignRight }, { value: "justify", Icon: AlignJustify },
];
// engine "both" == UI "justify"
const alignFromDoc = (a: string | null): Align | null => (a === "both" ? "justify" : (a as Align | null));

export function ComposerEditTools({ thesisId, block, hint, styleLabels, onAfterEdit, rtl }: Props) {
  const colors = useThemeColors();
  const [busy, setBusy] = useState(false);

  if (!block) {
    return <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>;
  }

  const apply = async (changes: Parameters<typeof editThesisParagraph>[2]) => {
    if (busy) return;
    setBusy(true);
    try {
      await editThesisParagraph(thesisId, block.index, changes);
      onAfterEdit();
    } catch {
      Alert.alert("Error");
    } finally {
      setBusy(false);
    }
  };

  const curAlign = alignFromDoc(block.alignment);
  const pill = (active: boolean) => [styles.pill, { borderColor: colors.borderDefault }, active && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }];
  const pillText = (active: boolean) => [styles.pillText, { color: active ? colors.bgPrimary : colors.textPrimary }];

  return (
    <View style={{ gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        {STYLE_OPTIONS.map((o) => {
          const active = block.level === o.level;
          return (
            <Pressable key={o.level} disabled={busy} onPress={() => apply({ level: o.level })} style={pill(active)}>
              <Text style={pillText(active)}>{o.level === 0 ? styleLabels.normal : o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        {ALIGN_OPTIONS.map(({ value, Icon }) => {
          const active = curAlign === value;
          return (
            <Pressable key={value} disabled={busy} onPress={() => apply({ alignment: value })} style={pill(active)}>
              <Icon size={16} color={active ? colors.bgPrimary : colors.textPrimary} strokeWidth={2} />
            </Pressable>
          );
        })}
        <Pressable disabled={busy} onPress={() => apply({ clearFormatting: true })} style={[styles.pill, { borderColor: colors.borderDefault }]}>
          <Eraser size={16} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
        {busy && <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 14, textAlign: "center" },
  row: { gap: 6, alignItems: "center", paddingVertical: 2 },
  pill: { minWidth: 40, height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
