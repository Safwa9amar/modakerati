import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { deleteAccount } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { AlertTriangle, Check } from "lucide-react-native";

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();
  const signOut = useAuthStore((s) => s.signOut);

  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Items wiped on deletion — keep in sync with the server cascade (profile is
  // the cascade root: theses, documents, sources, chats, notifications, etc.).
  const consequences = [
    t("deleteAccountScreen.itemProfile"),
    t("deleteAccountScreen.itemTheses"),
    t("deleteAccountScreen.itemSources"),
    t("deleteAccountScreen.itemSubscription"),
  ];

  const runDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      // Account no longer exists; clear the dead session. The root layout's auth
      // guard redirects to login once isAuthenticated flips to false.
      await signOut();
    } catch {
      setDeleting(false);
      Alert.alert(t("common.error"), t("deleteAccountScreen.error"));
    }
  };

  const handleDelete = () => {
    if (deleting) return;
    Alert.alert(
      t("deleteAccountScreen.confirmTitle"),
      t("deleteAccountScreen.confirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("deleteAccountScreen.confirmButton"), style: "destructive", onPress: runDelete },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("settings.deleteAccount")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.warnIcon, { backgroundColor: colors.semanticError + "1F" }]}>
          <AlertTriangle size={32} color={colors.semanticError} />
        </View>

        <Text style={[styles.lead, { color: colors.textPrimary, textAlign }]}>
          {t("deleteAccountScreen.lead")}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary, textAlign }]}>
          {t("deleteAccountScreen.permanentNote")}
        </Text>

        <Card style={styles.listCard}>
          <Text style={[styles.listTitle, { color: colors.textSecondary, textAlign }]}>
            {t("deleteAccountScreen.whatGetsDeleted")}
          </Text>
          {consequences.map((item, i) => (
            <View key={i} style={[styles.listRow, { flexDirection }]}>
              <View style={[styles.bullet, { backgroundColor: colors.semanticError }]} />
              <Text style={[styles.listItem, { color: colors.textPrimary, textAlign }]}>{item}</Text>
            </View>
          ))}
        </Card>

        <Pressable
          style={[styles.checkRow, { flexDirection }]}
          onPress={() => setConfirmed((v) => !v)}
          disabled={deleting}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: confirmed ? colors.semanticError : colors.borderDefault,
                backgroundColor: confirmed ? colors.semanticError : "transparent",
              },
            ]}
          >
            {confirmed && <Check size={14} color={colors.bgPrimary} strokeWidth={3} />}
          </View>
          <Text style={[styles.checkLabel, { color: colors.textPrimary, textAlign }]}>
            {t("deleteAccountScreen.acknowledge")}
          </Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.borderSubtle }]}>
        <Pressable
          style={[
            styles.deleteButton,
            { backgroundColor: colors.semanticError, opacity: confirmed && !deleting ? 1 : 0.5 },
          ]}
          onPress={handleDelete}
          disabled={!confirmed || deleting}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.bgPrimary} />
          ) : (
            <Text style={[styles.deleteButtonText, { color: colors.bgPrimary }]}>
              {t("deleteAccountScreen.deleteButton")}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 24, alignItems: "center" },
  warnIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginTop: 12, marginBottom: 20 },
  lead: { fontSize: 18, fontFamily: "Inter_600SemiBold", alignSelf: "stretch", marginBottom: 8 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, alignSelf: "stretch", marginBottom: 20 },
  listCard: { alignSelf: "stretch", gap: 12, marginBottom: 20 },
  listTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  listRow: { alignItems: "center", gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3 },
  listItem: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  checkRow: { alignSelf: "stretch", alignItems: "center", gap: 12, paddingVertical: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  checkLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1 },
  deleteButton: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  deleteButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
