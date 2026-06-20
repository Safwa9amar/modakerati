import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { FileText, Wand2, Upload, Search } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";

const ACCENT_COLORS = ["#5C6BFF", "#33D6A6", "#9959FF", "#FF9933", "#FF5959"];

export default function TemplatePickerScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { templates, setCurrentThesis } = useThesisStore();
  const [search, setSearch] = useState("");

  const filteredTemplates = templates.filter(
    (tpl) =>
      tpl.university.toLowerCase().includes(search.toLowerCase()) ||
      tpl.type.toLowerCase().includes(search.toLowerCase()) ||
      tpl.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleBlank = async () => {
    try {
      const { createThesis } = await import("@/lib/api");
      const thesis = await createThesis("My Thesis", ["Introduction", "Literature Review", "Methodology", "Results", "Conclusion"]);
      // Add to local store so chat screen can find it
      const store = useThesisStore.getState();
      store.theses.push({ id: thesis.id, title: thesis.title, status: "active", progress: 0, wordCount: 0, pageCount: 0, language: "fr", chapters: [], createdAt: thesis.createdAt, updatedAt: thesis.updatedAt });
      setCurrentThesis(thesis.id);
      router.push("/(tabs)/chat" as any);
    } catch (e: any) {
      console.error("Failed to create thesis:", e.message);
    }
  };

  const handleTemplateTap = (templateId: string) => {
    router.push({ pathname: "/(app)/template-preview", params: { templateId } } as any);
  };

  const quickStarts = [
    {
      icon: FileText,
      label: t("template.blank"),
      subtitle: t("template.startFresh"),
      color: colors.brandPrimary,
      onPress: handleBlank,
    },
    {
      icon: Wand2,
      label: t("template.aiWizard"),
      subtitle: t("template.guidedSetup"),
      color: "#9959FF",
      onPress: () => {},
    },
    {
      icon: Upload,
      label: t("template.import"),
      subtitle: t("template.docxFile"),
      color: colors.brandAccent,
      onPress: () => {},
    },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("template.startNew")}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Search */}
        <View style={styles.searchContainer}>
          <View style={styles.searchIconWrap}>
            <Search size={18} color={colors.textPlaceholder} strokeWidth={2} />
          </View>
          <TextInput
            placeholder={t("template.searchTemplates")}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>

        {/* Quick start row */}
        <View style={styles.quickRow}>
          {quickStarts.map((item, i) => (
            <Pressable
              key={i}
              onPress={item.onPress}
              style={[styles.quickCard, { backgroundColor: colors.bgCard }]}
            >
              <View
                style={[
                  styles.quickIconBg,
                  { backgroundColor: item.color + "22" },
                ]}
              >
                <item.icon
                  size={22}
                  color={item.color}
                  strokeWidth={1.8}
                />
              </View>
              <Text
                style={[styles.quickLabel, { color: colors.textPrimary }]}
              >
                {item.label}
              </Text>
              <Text
                style={[
                  styles.quickSub,
                  { color: colors.textSecondary },
                ]}
              >
                {item.subtitle}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* University Templates */}
        <Text
          style={[styles.sectionTitle, { color: colors.textPrimary }]}
        >
          {t("template.universityTemplates")}
        </Text>

        {filteredTemplates.map((tpl, i) => (
          <Pressable
            key={tpl.id}
            onPress={() => handleTemplateTap(tpl.id)}
          >
            <Card style={styles.templateCard}>
              <View
                style={[
                  styles.accentBar,
                  {
                    backgroundColor:
                      ACCENT_COLORS[i % ACCENT_COLORS.length],
                  },
                ]}
              />
              <View style={styles.templateContent}>
                <Text
                  style={[
                    styles.templateUniversity,
                    { color: colors.textPrimary },
                  ]}
                >
                  {tpl.university}
                </Text>
                <View style={styles.templateMeta}>
                  <Text
                    style={[
                      styles.templateType,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {tpl.type}
                  </Text>
                  <View
                    style={[
                      styles.langBadge,
                      { backgroundColor: colors.bgSurface },
                    ]}
                  >
                    <Text
                      style={[
                        styles.langText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {tpl.language}
                    </Text>
                  </View>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
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
  title: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  content: {
    padding: 20,
    gap: 20,
    paddingBottom: 40,
  },
  searchContainer: {
    position: "relative",
  },
  searchIconWrap: {
    position: "absolute",
    left: 14,
    top: 15,
    zIndex: 1,
  },
  searchInput: {
    paddingLeft: 40,
  },
  quickRow: {
    flexDirection: "row",
    gap: 12,
  },
  quickCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  quickIconBg: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  quickSub: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  templateCard: {
    flexDirection: "row",
    overflow: "hidden",
    padding: 0,
  },
  accentBar: {
    width: 4,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  templateContent: {
    flex: 1,
    padding: 16,
    gap: 6,
  },
  templateUniversity: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  templateMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  templateType: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  langBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  langText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
});
