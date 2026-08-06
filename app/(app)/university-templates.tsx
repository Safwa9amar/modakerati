import { useEffect, useState } from "react";
import { View, Text, Image, Pressable, FlatList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { FileText, ChevronRight, GraduationCap } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useUniversityStore } from "@/stores/university-store";
import { BackButton } from "@/components/BackButton";
import { TemplateListSkeleton } from "@/components/skeletons/TemplateListSkeleton";
import { listTemplates } from "@/lib/api";
import type { Template } from "@/types/thesis";

/**
 * Every template one institution offers.
 *
 * An institution routinely has SEVERAL — Licence / Master / Doctorat, Arabic /
 * French — so this is a list, not a single answer. Reached by tapping an
 * institution in the browse list; it does not touch the student's profile.
 */
export default function UniversityTemplatesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const { universityId } = useLocalSearchParams<{ universityId: string }>();

  const byId = useUniversityStore((s) => s.byId);
  const university = byId(universityId);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listTemplates(universityId);
        if (!cancelled) setTemplates(rows);
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [universityId]);

  const renderItem = ({ item }: { item: Template }) => {
    const thumb = item.config?.thumbUrl ?? null;
    return (
      <Pressable
        onPress={() => router.push(`/(app)/template-preview?templateId=${item.id}` as any)}
        style={[styles.row, { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle }]}
      >
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: colors.bgSurface }]}>
            <FileText size={18} color={colors.textSecondary} strokeWidth={1.8} />
          </View>
        )}
        <View style={styles.flex}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
            {item.name}
          </Text>
          <View style={styles.chips}>
            <Chip label={typeLabel(item.type)} colors={colors} />
            <Chip label={(item.language ?? "").toUpperCase()} colors={colors} />
            {item.citationStyle ? <Chip label={item.citationStyle.toUpperCase()} colors={colors} /> : null}
          </View>
        </View>
        <ChevronRight size={16} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.topRow}>
        <BackButton />
        <View style={styles.flex}>
          <Text style={[styles.screenTitle, { color: colors.textPrimary }]} numberOfLines={2}>
            {university ? (isAr ? university.nameAr : university.nameFr) : t("startingPoint.browseAll")}
          </Text>
          {university ? (
            <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
              {university.city}
            </Text>
          ) : null}
        </View>
        {university?.logoUrl ? (
          <Image source={{ uri: university.logoUrl }} style={styles.headerLogo} resizeMode="contain" />
        ) : (
          <GraduationCap size={22} color={colors.textSecondary} strokeWidth={1.8} />
        )}
      </View>

      {loading ? (
        <TemplateListSkeleton />
      ) : (
        <FlatList
          data={templates}
          renderItem={renderItem}
          keyExtractor={(tpl) => tpl.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {t("startingPoint.noTemplatesHere")}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function Chip({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  if (!label) return null;
  return (
    <View style={[styles.chip, { backgroundColor: colors.bgSurface }]}>
      <Text style={[styles.chipText, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function typeLabel(type: string | null | undefined): string {
  switch (type) {
    case "memoire_licence":
      return "Licence";
    case "memoire_master":
      return "Master";
    case "memoire_ingenieur":
      return "Ingénieur";
    case "these_doctorat":
      return "Doctorat";
    default:
      return type ?? "";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  screenTitle: { fontSize: 16, fontWeight: "700" },
  headerLogo: { width: 30, height: 30, borderRadius: 6 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  centered: { paddingVertical: 40, alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 10 },
  thumb: { width: 46, height: 60, borderRadius: 6 },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  chipText: { fontSize: 10, fontWeight: "600" },
  meta: { fontSize: 12 },
});
