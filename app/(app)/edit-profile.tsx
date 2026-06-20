import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { TextInput } from "@/components/ui/TextInput";
import { Camera } from "lucide-react-native";

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();

  const [fullName, setFullName] = useState("Hamza Safwan");
  const [email, setEmail] = useState("hamza@example.com");
  const [university, setUniversity] = useState("Universite de Djelfa");
  const [department, setDepartment] = useState("Computer Science");
  const [level, setLevel] = useState("Master 2");
  const [academicYear, setAcademicYear] = useState("2025/2026");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={[styles.headerAction, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("profile.editProfile")}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={[styles.headerAction, { color: colors.semanticSuccess }]}>{t("common.save")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={[styles.avatar, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimaryLight }]}>
            <Text style={styles.avatarText}>HS</Text>
            <View style={[styles.cameraCircle, { backgroundColor: colors.brandAccent }]}>
              <Camera size={12} color="#fff" />
            </View>
          </View>
          <Pressable>
            <Text style={[styles.changePhoto, { color: colors.brandPrimary }]}>{t("profile.changePhoto")}</Text>
          </Pressable>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <TextInput label={t("auth.fullName")} value={fullName} onChangeText={setFullName} />
          <TextInput label={t("auth.email")} value={email} onChangeText={setEmail} keyboardType="email-address" />
          <TextInput label={t("auth.university")} value={university} onChangeText={setUniversity} />
          <TextInput label={t("profile.department")} value={department} onChangeText={setDepartment} />
          <TextInput label={t("profile.level")} value={level} onChangeText={setLevel} />
          <TextInput label={t("profile.academicYear")} value={academicYear} onChangeText={setAcademicYear} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  headerAction: { fontSize: 15, fontFamily: "Inter_500Medium" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  avatarSection: { alignItems: "center", marginBottom: 32 },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, alignItems: "center", justifyContent: "center", marginBottom: 10, position: "relative" },
  avatarText: { fontSize: 32, fontFamily: "Inter_700Bold", color: "#fff" },
  cameraCircle: { position: "absolute", bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  changePhoto: { fontSize: 14, fontFamily: "Inter_500Medium" },
  form: { gap: 18 },
});
