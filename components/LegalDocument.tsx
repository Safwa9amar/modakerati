import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { BackButton } from "@/components/BackButton";
import type { LegalDoc } from "@/lib/legal-content";

// Renders a long-form legal document (Terms / Privacy): a back header, the
// localized "last updated" line, an intro paragraph, then titled sections.
// RTL-aware so Arabic reads right-aligned.
export function LegalDocument({ title, doc }: { title: string; doc: LegalDoc }) {
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.updated, { color: colors.textSecondary, textAlign }]}>{doc.updated}</Text>
        <Text style={[styles.intro, { color: colors.textPrimary, textAlign }]}>{doc.intro}</Text>

        {doc.sections.map((section, si) => (
          <View key={si} style={styles.section}>
            <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>{section.heading}</Text>
            {section.body.map((paragraph, pi) => (
              <Text key={pi} style={[styles.paragraph, { color: colors.textSecondary, textAlign }]}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  updated: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 16 },
  intro: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 23, marginBottom: 24 },
  section: { marginBottom: 22 },
  heading: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  paragraph: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 8 },
});
