import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { TextInput } from "@/components/ui/TextInput";
import { useProfileStore } from "@/stores/profile-store";
import { LEVELS, type Level } from "@/types/profile";
import { AvatarPicker } from "@/components/AvatarPicker";
import { UniversityPicker } from "@/components/UniversityPicker";
import { EditProfileSkeleton } from "@/components/skeletons/EditProfileSkeleton";
import { ChevronDown } from "lucide-react-native";

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();
  const router = useRouter();

  const profile = useProfileStore((s) => s.profile);
  const isLoading = useProfileStore((s) => s.isLoading);
  const isSaving = useProfileStore((s) => s.isSaving);
  const loadError = useProfileStore((s) => s.loadError);
  const fetchProfile = useProfileStore((s) => s.fetchProfile);
  const saveProfile = useProfileStore((s) => s.saveProfile);

  const [fullName, setFullName] = useState("");
  const [university, setUniversity] = useState("");
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [pickingUniversity, setPickingUniversity] = useState(false);
  const [department, setDepartment] = useState("");
  const [level, setLevel] = useState<Level | null>(null);
  const [academicYear, setAcademicYear] = useState("");

  // Fetch on mount when nothing is cached yet.
  useEffect(() => {
    if (!profile) fetchProfile();
  }, []);

  // Seed the form once the profile is available (keyed on id so a background
  // refresh of the same profile doesn't clobber in-progress edits).
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.fullName ?? "");
    setUniversity(profile.university ?? "");
    setUniversityId(profile.universityId ?? null);
    setDepartment(profile.department ?? "");
    setLevel(profile.level ?? null);
    setAcademicYear(profile.academicYear ?? "");
  }, [profile?.id]);

  const handleSave = async () => {
    if (isSaving) return;
    // Never PUT a form that was never filled from a real profile: every field
    // would go up blank and overwrite good server data.
    if (!profile) return;
    const { error } = await saveProfile({
      fullName: fullName.trim(),
      university: university.trim() || null,
      universityId,
      department: department.trim() || null,
      level,
      academicYear: academicYear.trim() || null,
    });
    if (error) {
      Alert.alert(t("profile.editProfile"), t("profile.saveError"));
      return;
    }
    router.back();
  };

  const showLoader = isLoading && !profile;
  // The profile could not be read and nothing is cached — so there is nothing to
  // edit. Showing the form anyway is what made a dead server look like an empty
  // account, and one Save would have written those blanks back.
  const showError = !isLoading && !profile;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <Pressable onPress={() => router.back()} disabled={isSaving} hitSlop={8}>
          <Text style={[styles.headerAction, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("profile.editProfile")}</Text>
        <Pressable onPress={handleSave} disabled={isSaving || showLoader || showError} hitSlop={8}>
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.semanticSuccess} />
          ) : (
            <Text
              style={[
                styles.headerAction,
                { color: showError ? colors.textPlaceholder : colors.semanticSuccess },
              ]}
            >
              {t("common.save")}
            </Text>
          )}
        </Pressable>
      </View>

      {showLoader ? (
        // The skeleton carries the form's own padding — don't double it here.
        <ScrollView scrollEnabled={false}>
          <EditProfileSkeleton />
        </ScrollView>
      ) : showError ? (
        <View style={styles.loader}>
          <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>
            {t("profile.loadFailed", { defaultValue: "Couldn't load your profile" })}
          </Text>
          <Text style={[styles.errorBody, { color: colors.textSecondary }]}>
            {t("profile.loadFailedBody", { defaultValue: "Check your connection and try again." })}
          </Text>
          {/* The raw reason: "Network request failed" and "API Error: 500" send
              the student to very different places. */}
          {!!loadError && (
            <Text style={[styles.errorDetail, { color: colors.textPlaceholder }]}>{loadError}</Text>
          )}
          <Pressable
            onPress={() => void fetchProfile()}
            style={[styles.retry, { backgroundColor: colors.brandPrimary }]}
          >
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <AvatarPicker
              size={100}
              name={fullName}
              avatarUrl={profile?.avatarUrl}
              caption={t("profile.changePhoto")}
            />
          </View>

          {/* Form */}
          <View style={styles.form}>
            <TextInput label={t("auth.fullName")} value={fullName} onChangeText={setFullName} autoCapitalize="words" />

            {/* Email is owned by the auth account, not editable here. */}
            <TextInput
              label={t("auth.email")}
              value={profile?.email ?? ""}
              editable={false}
              style={{ opacity: 0.6 }}
            />

            {/*
              Picked from the catalogue, not typed. The id is what lets the
              server find a starting point that belongs to this institution;
              a typed string can never be joined to anything.
            */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t("auth.university")}</Text>
              {pickingUniversity ? (
                <View style={styles.pickerBox}>
                  <UniversityPicker
                    value={universityId}
                    onChange={(id, uni) => {
                      setUniversityId(id);
                      setUniversity(uni.nameFr);
                      setPickingUniversity(false);
                    }}
                    onSkip={() => setPickingUniversity(false)}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => setPickingUniversity(true)}
                  style={[styles.pickerTrigger, { backgroundColor: colors.bgInput, borderColor: colors.borderSubtle }]}
                >
                  <Text
                    style={{ color: university ? colors.textPrimary : colors.textPlaceholder, fontSize: 15, flex: 1 }}
                    numberOfLines={1}
                  >
                    {university || t("university.select")}
                  </Text>
                  <ChevronDown size={16} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
              )}
            </View>

            <TextInput label={t("profile.department")} value={department} onChangeText={setDepartment} />

            {/* Level — constrained by the DB CHECK to these three values. */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{t("profile.level")}</Text>
              <View style={[styles.segments, { flexDirection }]}>
                {LEVELS.map((opt) => {
                  const selected = level === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setLevel(opt)}
                      style={[
                        styles.segment,
                        {
                          backgroundColor: selected ? colors.brandPrimary + "26" : colors.bgInput,
                          borderColor: selected ? colors.brandPrimary : colors.borderSubtle,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.segmentText,
                          { color: selected ? colors.brandPrimary : colors.textSecondary },
                        ]}>
                        {t(`profile.levels.${opt}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <TextInput
              label={t("profile.academicYear")}
              value={academicYear}
              onChangeText={setAcademicYear}
              placeholder={t("profile.academicYearPlaceholder")}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  headerAction: { fontSize: 15, fontFamily: "Inter_500Medium" },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  errorTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  errorBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  errorDetail: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  retry: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  retryText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  avatarSection: { alignItems: "center", marginBottom: 32 },
  form: { gap: 18 },
  fieldGroup: { gap: 6 },
  pickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  // Bounded so the picker's list scrolls inside the form rather than
  // stretching the page to 130 rows.
  pickerBox: { height: 320 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  segments: { gap: 10 },
  segment: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
