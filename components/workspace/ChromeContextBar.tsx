import { PanelBottom, PanelTop, SeparatorHorizontal, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

type ChromeKind = "top" | "bottom" | "section";

interface Props {
  kind: ChromeKind;
  text: string;
  rtl: boolean;
  onAskAI: () => void; // opens the section-scoped AI input
  onCollapse?: () => void;
}

const ICON = { top: PanelTop, bottom: PanelBottom, section: SeparatorHorizontal };

/** The context bubble shown when a Word chrome band (top-of-page / bottom-of-page /
 *  new-section marker) is selected in the Lexical writer. Plain-language label + one
 *  explanatory sentence + ✦ Ask (v1's single write path, via the AI tool loop). */
export function ChromeContextBar({ kind, text, rtl, onAskAI }: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const Icon = ICON[kind];

  const label =
    kind === "top"
      ? t("workspace.hf.topOfPage", { defaultValue: "Top of every page" })
      : kind === "bottom"
        ? t("workspace.hf.bottomOfPage", { defaultValue: "Bottom of every page" })
        : t("workspace.hf.newSectionHere", { defaultValue: "New section starts here" });

  const explain =
    kind === "top"
      ? t("workspace.hf.topExplain", { defaultValue: "This title repeats at the top of every page in this section." })
      : kind === "bottom"
        ? t("workspace.hf.bottomExplain", { defaultValue: "This repeats at the bottom of every page — usually the page number." })
        : t("workspace.hf.sectionExplain", { defaultValue: "Everything after this point begins a new section on a fresh page." });

  const askLabel = t("workspace.hf.ask", { defaultValue: "Ask AI to change this" });

  return (
    <View style={[styles.wrap, { backgroundColor: c.bgPrimary, borderColor: c.borderDefault }]}>
      <View style={[styles.head, rtl && styles.headRtl]}>
        <View style={styles.chip}>
          <Icon size={13} color="#fff" />
        </View>
        <Text style={[styles.label, { color: c.textPrimary }]} numberOfLines={1}>
          {label}
        </Text>
        {text ? (
          <Text style={[styles.sub, { color: c.textSecondary }]} numberOfLines={1}>
            {text}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.explain, { color: c.textSecondary }]}>{explain}</Text>
      <View style={[styles.tools, rtl && styles.headRtl]}>
        <Pressable
          onPress={onAskAI}
          style={[styles.ask, { backgroundColor: c.brandPrimary }]}
          accessibilityRole="button"
          accessibilityLabel={askLabel}
        >
          <Sparkles size={14} color="#fff" />
          <Text style={styles.askTxt}>{askLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 16, padding: 10, gap: 8, minWidth: 240 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headRtl: { flexDirection: "row-reverse" },
  chip: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#9A5A31" },
  label: { fontSize: 13, fontWeight: "700" },
  sub: { fontSize: 11, flexShrink: 1 },
  explain: { fontSize: 11, lineHeight: 15 },
  tools: { flexDirection: "row", gap: 6 },
  ask: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  askTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
