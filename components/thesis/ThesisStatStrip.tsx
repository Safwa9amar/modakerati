import { Fragment } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

/** Slim 3-column stat strip (sections · chapters · words). */
export function ThesisStatStrip({
  sections,
  chapters,
  words,
}: {
  sections: number;
  chapters: number;
  words: number;
}) {
  const colors = useThemeColors();
  const { t } = useTranslation();

  const items = [
    { value: String(sections), label: t("home.sections") },
    { value: String(chapters), label: t("home.chapters") },
    { value: words.toLocaleString(), label: t("home.words") },
  ];

  return (
    <View style={styles.strip}>
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: colors.borderDefault }]} />}
          <View style={styles.cell}>
            <Text style={[styles.value, { color: colors.textPrimary }]}>{it.value}</Text>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{it.label}</Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8 },
  cell: { flex: 1, alignItems: "center", gap: 2 },
  divider: { width: 1, height: 26 },
  value: { fontSize: 17, fontFamily: "Inter_700Bold" },
  label: { fontSize: 10, fontFamily: "Inter_500Medium" },
});
