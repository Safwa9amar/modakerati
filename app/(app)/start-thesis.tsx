import { useEffect, useState, useCallback } from "react";
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { FileText, ChevronRight, GraduationCap, Sparkles } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useProfileStore } from "@/stores/profile-store";
import { useThesisWizard } from "@/stores/thesis-wizard-store";
import { UniversityPicker } from "@/components/UniversityPicker";
import { BackButton } from "@/components/BackButton";
import { getStartingPoints } from "@/lib/api";
import type { StartingPoint, University } from "@/types/thesis";

/**
 * The match-first choice moment.
 *
 * Instead of an empty filter grid, this opens on ONE recommended starting point
 * derived from the student's own institution, with everything else demoted to a
 * link. The server does the ranking; this screen only renders it.
 *
 * THE HONESTY RULE: the university's name and crest are shown only when the
 * server sends them, which it does exclusively for rungs 1-3 (their own
 * template or their own rules). At rungs 4-5 those fields arrive null, so a
 * generic fallback can never dress itself up as the student's own institution.
 */
export default function StartThesisScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t, i18n } = useTranslation();

  const profile = useProfileStore((s) => s.profile);
  const saveProfile = useProfileStore((s) => s.saveProfile);

  const [points, setPoints] = useState<StartingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsUniversity, setNeedsUniversity] = useState(false);

  const universityId = profile?.universityId ?? null;
  const level = profile?.level ?? null;

  const fetchPoints = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getStartingPoints({
        universityId,
        level,
        language: i18n.language,
      });
      setPoints(res);
    } catch {
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [universityId, level, i18n.language]);

  useEffect(() => {
    // Ask once, inline, rather than sending the student off to settings.
    if (!universityId) {
      setNeedsUniversity(true);
      setLoading(false);
      return;
    }
    setNeedsUniversity(false);
    fetchPoints();
  }, [universityId, fetchPoints]);

  const handlePickUniversity = async (id: string, uni: University) => {
    setNeedsUniversity(false);
    setLoading(true);
    // Persist both: the id is what the resolver joins on, the name keeps the
    // profile readable for anyone looking at it directly.
    await saveProfile({ universityId: id, university: uni.nameFr });
  };

  const handleStart = (sp: StartingPoint) => {
    if (sp.templateId) {
      // Templates keep their existing preview step.
      router.push(`/(app)/template-preview?templateId=${sp.templateId}` as any);
      return;
    }
    useThesisWizard.getState().set({
      normProfileId: sp.normProfileId,
      language: sp.display.language as any,
      step: "title",
    });
    router.push("/(app)/thesis-title" as any);
  };

  const handleBlank = () => {
    useThesisWizard.getState().set({ normProfileId: null, step: "title" });
    router.push("/(app)/thesis-title" as any);
  };

  const best = points[0] ?? null;
  const alternative = points[1] ?? null;

  return (
    <SafeAreaView edges={["top"]} style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.topRow}>
        <BackButton />
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>{t("startingPoint.title")}</Text>
      </View>

      {needsUniversity ? (
        <View style={styles.pickerWrap}>
          <Text style={[styles.askTitle, { color: colors.textPrimary }]}>{t("startingPoint.askUniversity")}</Text>
          <Text style={[styles.askHint, { color: colors.textSecondary }]}>{t("startingPoint.askUniversityHint")}</Text>
          <UniversityPicker
            value={null}
            onChange={handlePickUniversity}
            onSkip={() => {
              setNeedsUniversity(false);
              fetchPoints();
            }}
          />
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {best ? (
            <ForYouCard point={best} colors={colors} onPress={() => handleStart(best)} />
          ) : (
            <Text style={[styles.askHint, { color: colors.textSecondary }]}>{t("startingPoint.empty")}</Text>
          )}

          {alternative ? (
            <>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                {t("startingPoint.otherOption")}
              </Text>
              <QuietRow point={alternative} colors={colors} onPress={() => handleStart(alternative)} />
            </>
          ) : null}

          <Pressable
            onPress={() => router.push("/(app)/browse-templates" as any)}
            style={[styles.quietRow, { borderColor: colors.borderSubtle }]}
          >
            <Text style={[styles.quietText, { color: colors.textSecondary }]}>{t("startingPoint.browseAll")}</Text>
            <ChevronRight size={16} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>

          <Pressable
            onPress={handleBlank}
            style={[styles.quietRow, styles.dashed, { borderColor: colors.borderDefault }]}
          >
            <FileText size={16} color={colors.textSecondary} strokeWidth={2} />
            <View style={styles.flex}>
              <Text style={[styles.quietText, { color: colors.textPrimary }]}>{t("startingPoint.blank")}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{t("startingPoint.blankSubtitle")}</Text>
            </View>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function ForYouCard({
  point,
  colors,
  onPress,
}: {
  point: StartingPoint;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const d = point.display;

  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.brandPrimary }]}>
      <View style={[styles.badge, { backgroundColor: colors.brandPrimary + "22" }]}>
        <Sparkles size={12} color={colors.brandPrimary} strokeWidth={2.5} />
        <Text style={[styles.badgeText, { color: colors.brandPrimary }]}>
          {t(`startingPoint.reason.${point.reason}`)}
        </Text>
      </View>

      <View style={styles.cardBody}>
        {d.thumbUrl ? (
          <Image source={{ uri: d.thumbUrl }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: colors.bgSurface }]}>
            <FileText size={20} color={colors.textSecondary} strokeWidth={1.8} />
          </View>
        )}

        <View style={styles.flex}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]} numberOfLines={2}>
            {d.title ?? t("startingPoint.noDocument")}
          </Text>

          {/* Rendered only when the server sent it — i.e. rungs 1-3. */}
          {d.universityName ? (
            <View style={styles.uniRow}>
              {d.logoUrl ? (
                <Image source={{ uri: d.logoUrl }} style={styles.uniLogo} resizeMode="contain" />
              ) : (
                <GraduationCap size={12} color={colors.textSecondary} strokeWidth={2} />
              )}
              <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                {d.universityName}
              </Text>
            </View>
          ) : null}

          <View style={styles.chips}>
            <Chip label={d.language.toUpperCase()} colors={colors} />
            <Chip label={d.citationStyle.toUpperCase()} colors={colors} />
            <Chip label={d.bindingSide === "right" ? "RTL" : "LTR"} colors={colors} />
          </View>
        </View>
      </View>

      <Pressable onPress={onPress} style={[styles.cta, { backgroundColor: colors.brandPrimary }]}>
        <Text style={styles.ctaText}>{t("startingPoint.startWriting")}</Text>
      </Pressable>
    </View>
  );
}

function QuietRow({
  point,
  colors,
  onPress,
}: {
  point: StartingPoint;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const d = point.display;
  return (
    <Pressable onPress={onPress} style={[styles.quietRow, { borderColor: colors.borderSubtle }]}>
      <View style={styles.flex}>
        <Text style={[styles.quietText, { color: colors.textPrimary }]} numberOfLines={1}>
          {d.title ?? t("startingPoint.noDocument")}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {t(`startingPoint.reason.${point.reason}`)}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.textSecondary} strokeWidth={2} />
    </Pressable>
  );
}

function Chip({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={[styles.chip, { backgroundColor: colors.bgSurface }]}>
      <Text style={[styles.chipText, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  screenTitle: { fontSize: 18, fontWeight: "700" },
  scroll: { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  pickerWrap: { flex: 1, paddingHorizontal: 16, gap: 6 },
  askTitle: { fontSize: 17, fontWeight: "700" },
  askHint: { fontSize: 13, marginBottom: 8 },
  card: { borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 12 },
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  cardBody: { flexDirection: "row", gap: 12 },
  thumb: { width: 58, height: 78, borderRadius: 8 },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  uniRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  uniLogo: { width: 16, height: 16, borderRadius: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  chipText: { fontSize: 10, fontWeight: "600" },
  cta: { borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  ctaText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  sectionLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  quietRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  dashed: { borderStyle: "dashed" },
  quietText: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12 },
});
