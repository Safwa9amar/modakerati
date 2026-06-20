import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { Minus, Plus } from "lucide-react-native";

export default function DocumentPreviewScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  const [currentPage, setCurrentPage] = useState(3);
  const [zoom, setZoom] = useState(75);
  const totalPages = 24;
  const totalDots = 5;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]}>
          {t("preview.preview")}
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: "/(app)/export", params: { thesisId } })}
          style={[styles.exportButton, { backgroundColor: colors.brandPrimary }]}
        >
          <Text style={styles.exportButtonText}>{t("export.exportAs").split(" ")[0]}</Text>
        </Pressable>
      </View>

      {/* Page info bar */}
      <View style={[styles.pageInfoBar, { backgroundColor: colors.bgSurface }]}>
        <Text style={[styles.pageInfoText, { color: colors.textSecondary }]}>
          {t("preview.pageOf", { current: currentPage, total: totalPages })}
        </Text>
        <View style={styles.zoomControls}>
          <Pressable
            onPress={() => setZoom((z) => Math.max(25, z - 25))}
            style={styles.zoomButton}
          >
            <Minus size={16} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
          <Text style={[styles.zoomText, { color: colors.textPrimary }]}>
            {zoom}%
          </Text>
          <Pressable
            onPress={() => setZoom((z) => Math.min(200, z + 25))}
            style={styles.zoomButton}
          >
            <Plus size={16} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {/* Preview area */}
      <ScrollView
        style={[styles.previewArea, { backgroundColor: colors.bgPrimary + "CC" }]}
        contentContainerStyle={styles.previewContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.paperShadow}>
          <View style={styles.paper}>
            {/* Chapter label */}
            <Text style={styles.paperChapterLabel}>Chapter 2</Text>

            {/* Chapter title */}
            <Text style={styles.paperTitle}>Literature Review</Text>

            {/* Divider */}
            <View style={styles.paperDivider} />

            {/* Section heading */}
            <Text style={styles.paperSubheading}>2.1 AI in Global Education</Text>

            {/* Body text */}
            <Text style={styles.paperBody}>
              Artificial intelligence has rapidly transformed educational practices across the globe.
              From adaptive learning platforms to automated assessment tools, AI technologies are
              reshaping how students learn and how institutions deliver knowledge.
            </Text>

            <Text style={styles.paperBody}>
              Research indicates that AI-powered tutoring systems can improve student performance
              by up to 30% compared to traditional methods (Zhang et al., 2023). These systems
              leverage natural language processing and machine learning algorithms to provide
              personalized feedback and adaptive learning paths.
            </Text>

            <Text style={styles.paperBody}>
              The integration of AI in higher education represents a paradigm shift in pedagogical
              approaches, enabling unprecedented levels of personalization and efficiency in the
              learning process (Martinez & Chen, 2024).
            </Text>

            {/* Page number */}
            <Text style={styles.pageNumber}>— 3 —</Text>
          </View>
        </View>
      </ScrollView>

      {/* Page dots */}
      <View style={styles.dotsRow}>
        {Array.from({ length: totalDots }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === currentPage - 1
                    ? colors.brandPrimary
                    : colors.textPlaceholder + "44",
                width: i === currentPage - 1 ? 10 : 8,
                height: i === currentPage - 1 ? 10 : 8,
              },
            ]}
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  topTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  exportButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  exportButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  pageInfoBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  pageInfoText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  zoomControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  zoomButton: {
    padding: 4,
  },
  zoomText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    minWidth: 40,
    textAlign: "center",
  },
  previewArea: {
    flex: 1,
  },
  previewContent: {
    padding: 20,
    alignItems: "center",
    paddingBottom: 20,
  },
  paperShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  paper: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    paddingHorizontal: 32,
    paddingVertical: 40,
    width: 320,
    minHeight: 440,
  },
  paperChapterLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "#888888",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  paperTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#1A1A1A",
    marginBottom: 12,
  },
  paperDivider: {
    height: 1,
    backgroundColor: "#E0E0E0",
    marginBottom: 16,
  },
  paperSubheading: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#1A1A1A",
    marginBottom: 12,
  },
  paperBody: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#333333",
    lineHeight: 18,
    marginBottom: 10,
  },
  pageNumber: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#999999",
    textAlign: "center",
    marginTop: 24,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    borderRadius: 10,
  },
});
