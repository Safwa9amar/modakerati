import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { BackButton } from "@/components/BackButton";
import {
  FileText,
  ChevronRight,
  Globe,
  BookOpen,
  GraduationCap,
  ChevronDown,
  X,
} from "lucide-react-native";
import type { NormProfile } from "@/types/thesis";

// ---------------------------------------------------------------------------
// Filter chip component
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.filterChip,
        {
          backgroundColor: active ? colors.brandPrimary + "18" : colors.bgSurface,
          borderColor: active ? colors.brandPrimary : colors.borderSubtle,
        },
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          { color: active ? colors.brandPrimary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
      {active ? (
        <X size={12} color={colors.brandPrimary} strokeWidth={2.5} />
      ) : (
        <ChevronDown size={12} color={colors.textSecondary} strokeWidth={2} />
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Filter row with expandable options
// ---------------------------------------------------------------------------

type FilterKey = "university" | "discipline" | "language";

function FilterRow({
  profiles,
  universityFilter,
  disciplineFilter,
  languageFilter,
  setUniversityFilter,
  setDisciplineFilter,
  setLanguageFilter,
  colors,
  t,
}: {
  profiles: NormProfile[];
  universityFilter: string | null;
  disciplineFilter: string | null;
  languageFilter: string | null;
  setUniversityFilter: (v: string | null) => void;
  setDisciplineFilter: (v: string | null) => void;
  setLanguageFilter: (v: string | null) => void;
  colors: ReturnType<typeof useThemeColors>;
  t: (key: string) => string;
}) {
  const [expandedFilter, setExpandedFilter] = useState<FilterKey | null>(null);

  const universities = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => {
      if (p.university) set.add(p.university);
    });
    return Array.from(set).sort();
  }, [profiles]);

  const disciplines = ["science", "law-humanities", "generic"];
  const languages = ["fr", "ar", "en"];

  const disciplineLabel = (d: string) => {
    switch (d) {
      case "science": return "Science / IMRAD";
      case "law-humanities": return "Law & Humanities";
      case "generic": return "Generic";
      default: return d;
    }
  };

  const languageLabel = (l: string) => {
    switch (l) {
      case "fr": return "Fran\u00e7ais";
      case "ar": return "\u0627\u0644\u0639\u0631\u0628\u064a\u0629";
      case "en": return "English";
      default: return l.toUpperCase();
    }
  };

  const toggleFilter = (key: FilterKey) => {
    setExpandedFilter((prev) => (prev === key ? null : key));
  };

  const selectOption = (key: FilterKey, value: string | null) => {
    if (key === "university") setUniversityFilter(value);
    else if (key === "discipline") setDisciplineFilter(value);
    else setLanguageFilter(value);
    setExpandedFilter(null);
  };

  return (
    <View style={styles.filterSection}>
      {/* Chip row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <FilterChip
          label={universityFilter ?? t("wizard.allUniversities")}
          active={!!universityFilter}
          onPress={() =>
            universityFilter ? setUniversityFilter(null) : toggleFilter("university")
          }
          colors={colors}
        />
        <FilterChip
          label={
            disciplineFilter
              ? disciplineLabel(disciplineFilter)
              : t("wizard.allDisciplines")
          }
          active={!!disciplineFilter}
          onPress={() =>
            disciplineFilter ? setDisciplineFilter(null) : toggleFilter("discipline")
          }
          colors={colors}
        />
        <FilterChip
          label={
            languageFilter
              ? languageLabel(languageFilter)
              : t("wizard.filterLanguage")
          }
          active={!!languageFilter}
          onPress={() =>
            languageFilter ? setLanguageFilter(null) : toggleFilter("language")
          }
          colors={colors}
        />
      </ScrollView>

      {/* Expanded options */}
      {expandedFilter === "university" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.optionsRow}
        >
          {universities.map((u) => (
            <Pressable
              key={u}
              onPress={() => selectOption("university", u)}
              style={[styles.optionPill, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
            >
              <Text style={[styles.optionPillText, { color: colors.textPrimary }]}>{u}</Text>
            </Pressable>
          ))}
          {universities.length === 0 && (
            <Text style={[styles.emptyFilter, { color: colors.textSecondary }]}>--</Text>
          )}
        </ScrollView>
      )}

      {expandedFilter === "discipline" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.optionsRow}
        >
          {disciplines.map((d) => (
            <Pressable
              key={d}
              onPress={() => selectOption("discipline", d)}
              style={[styles.optionPill, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
            >
              <Text style={[styles.optionPillText, { color: colors.textPrimary }]}>{disciplineLabel(d)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {expandedFilter === "language" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.optionsRow}
        >
          {languages.map((l) => (
            <Pressable
              key={l}
              onPress={() => selectOption("language", l)}
              style={[styles.optionPill, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
            >
              <Text style={[styles.optionPillText, { color: colors.textPrimary }]}>{languageLabel(l)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Badge component
// ---------------------------------------------------------------------------

function Badge({
  icon: Icon,
  label,
  colors,
}: {
  icon: typeof Globe;
  label: string;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: colors.bgSurface }]}>
      <Icon size={12} color={colors.textSecondary} strokeWidth={2} />
      <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function TemplatePickerScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const normProfiles = useThesisStore((s) => s.normProfiles);
  const [loading, setLoading] = useState(true);

  const [universityFilter, setUniversityFilter] = useState<string | null>(null);
  const [disciplineFilter, setDisciplineFilter] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    useThesisStore
      .getState()
      .loadNormProfiles()
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    return normProfiles.filter((p) => {
      if (universityFilter && p.university !== universityFilter) return false;
      if (disciplineFilter && p.discipline !== disciplineFilter) return false;
      if (languageFilter && p.language !== languageFilter) return false;
      return true;
    });
  }, [normProfiles, universityFilter, disciplineFilter, languageFilter]);

  // -- handlers --

  const handleBlank = () => {
    useThesisWizard.getState().set({
      normProfileId: null,
      step: "title",
    });
    router.push("/(app)/thesis-title" as any);
  };

  const handleSelect = (profile: NormProfile) => {
    useThesisWizard.getState().set({
      normProfileId: profile.id,
      language: profile.language,
      step: "title",
    });
    router.push("/(app)/thesis-title" as any);
  };

  // -- discipline display --
  const disciplineLabel = (d: string) => {
    switch (d) {
      case "science": return "Science";
      case "law-humanities": return "Law & Humanities";
      case "generic": return "Generic";
      default: return d;
    }
  };

  const languageLabel = (l: string) => {
    switch (l) {
      case "fr": return "FR";
      case "ar": return "AR";
      case "en": return "EN";
      default: return l.toUpperCase();
    }
  };

  const citationLabel = (c: string) => {
    switch (c) {
      case "apa": return "APA";
      case "footnote-ar": return "Footnote";
      default: return c;
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      {/* Header */}
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("wizard.pickTemplate")}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Blank card */}
        <Pressable
          onPress={handleBlank}
          style={[
            styles.blankCard,
            {
              backgroundColor: colors.bgCard,
              borderColor: colors.brandPrimary + "44",
            },
          ]}
        >
          <View
            style={[
              styles.blankIconWrap,
              { backgroundColor: colors.brandPrimary + "18" },
            ]}
          >
            <FileText size={28} color={colors.brandPrimary} strokeWidth={1.6} />
          </View>
          <View style={styles.blankTextWrap}>
            <Text style={[styles.blankTitle, { color: colors.textPrimary }]}>
              {t("wizard.blank")}
            </Text>
            <Text style={[styles.blankSubtitle, { color: colors.textSecondary }]}>
              {t("wizard.blankDesc")}
            </Text>
          </View>
          <ChevronRight size={20} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>

        {/* Filters */}
        <FilterRow
          profiles={normProfiles}
          universityFilter={universityFilter}
          disciplineFilter={disciplineFilter}
          languageFilter={languageFilter}
          setUniversityFilter={setUniversityFilter}
          setDisciplineFilter={setDisciplineFilter}
          setLanguageFilter={setLanguageFilter}
          colors={colors}
          t={t}
        />

        {/* Loading state */}
        {loading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          </View>
        )}

        {/* Norm profile cards */}
        {!loading &&
          filtered.map((profile) => (
            <Pressable
              key={profile.id}
              onPress={() => handleSelect(profile)}
              style={[
                styles.profileCard,
                {
                  backgroundColor: colors.bgCard,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.profileContent}>
                <Text
                  style={[styles.profileName, { color: colors.textPrimary }]}
                  numberOfLines={2}
                >
                  {profile.name}
                </Text>

                <View style={styles.badgeRow}>
                  <Badge
                    icon={GraduationCap}
                    label={profile.university ?? t("wizard.allUniversities")}
                    colors={colors}
                  />
                  <Badge
                    icon={BookOpen}
                    label={disciplineLabel(profile.discipline)}
                    colors={colors}
                  />
                </View>

                <View style={styles.badgeRow}>
                  <Badge
                    icon={Globe}
                    label={languageLabel(profile.language)}
                    colors={colors}
                  />
                  <Badge
                    icon={FileText}
                    label={citationLabel(profile.citationStyle)}
                    colors={colors}
                  />
                </View>
              </View>

              <ChevronRight
                size={18}
                color={colors.textSecondary}
                strokeWidth={2}
                style={styles.profileChevron}
              />
            </Pressable>
          ))}

        {/* Empty state */}
        {!loading && filtered.length === 0 && normProfiles.length > 0 && (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No profiles match these filters.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
    gap: 16,
    paddingBottom: 40,
  },

  // Blank card
  blankCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    padding: 16,
    gap: 14,
  },
  blankIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  blankTextWrap: { flex: 1, gap: 2 },
  blankTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  blankSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  // Filters
  filterSection: { gap: 8 },
  filterRow: { gap: 8 },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  optionsRow: {
    gap: 8,
    paddingVertical: 4,
  },
  optionPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  optionPillText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  emptyFilter: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 8,
  },

  // Loading
  loadingWrap: {
    paddingVertical: 32,
    alignItems: "center",
  },

  // Profile cards
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  profileContent: {
    flex: 1,
    gap: 8,
  },
  profileName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  profileChevron: {
    alignSelf: "center",
  },

  // Empty
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 24,
  },
});
