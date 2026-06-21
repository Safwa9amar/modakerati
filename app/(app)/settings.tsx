import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";
import { useNotificationStore } from "@/stores/notification-store";
import { registerForPushNotificationsAsync } from "@/lib/push-notifications";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import {
  Globe, Moon, Cpu, Bell, Sparkles, Clock,
  Cloud, HardDrive, Trash2, AlertTriangle,
  Info, FileText, Shield, ChevronRight,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

interface SettingRow {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  value?: string;
  type: "chevron" | "toggle" | "plain";
  toggleValue?: boolean;
  onToggle?: (v: boolean) => void;
  destructive?: boolean;
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);

  const preferences = useNotificationStore((s) => s.preferences);
  const updatePreferences = useNotificationStore((s) => s.updatePreferences);
  const [cloudSync, setCloudSync] = useState(true);

  useEffect(() => {
    useNotificationStore.getState().loadPreferences();
  }, []);

  const languageLabel = language === "en" ? "English" : language === "fr" ? "Francais" : "العربية";
  const themeLabel = theme === "dark" ? "Dark" : "Light";

  const sections: { title: string; rows: SettingRow[] }[] = [
    {
      title: t("settings.general"),
      rows: [
        { icon: Globe, iconColor: colors.brandPrimary, label: t("settings.language"), value: languageLabel, type: "chevron" },
        { icon: Moon, iconColor: colors.brandAccent, label: t("settings.theme"), value: themeLabel, type: "chevron" },
        { icon: Cpu, iconColor: colors.semanticWarning, label: t("settings.aiModel"), value: "Claude", type: "chevron" },
      ],
    },
    {
      title: t("settings.notificationsSection"),
      rows: [
        { icon: Bell, iconColor: colors.brandPrimary, label: t("settings.pushNotifications"), type: "toggle", toggleValue: preferences.pushEnabled, onToggle: (v) => { updatePreferences({ pushEnabled: v }); if (v) registerForPushNotificationsAsync().catch(() => {}); } },
        { icon: Sparkles, iconColor: colors.brandAccent, label: t("settings.aiSuggestionsSetting"), type: "toggle", toggleValue: preferences.aiSuggestions, onToggle: (v) => updatePreferences({ aiSuggestions: v }) },
        { icon: Clock, iconColor: colors.semanticWarning, label: t("settings.exportReminders"), type: "toggle", toggleValue: preferences.exportReminders, onToggle: (v) => updatePreferences({ exportReminders: v }) },
      ],
    },
    {
      title: t("settings.dataPrivacy"),
      rows: [
        { icon: Cloud, iconColor: colors.brandPrimary, label: t("settings.cloudSync"), type: "toggle", toggleValue: cloudSync, onToggle: setCloudSync },
        { icon: HardDrive, iconColor: colors.textSecondary, label: t("settings.offlineStorage"), type: "chevron" },
        { icon: Trash2, iconColor: colors.semanticWarning, label: t("settings.clearCache"), type: "plain" },
        { icon: AlertTriangle, iconColor: colors.semanticError, label: t("settings.deleteAccount"), type: "plain", destructive: true },
      ],
    },
    {
      title: t("settings.about"),
      rows: [
        { icon: Info, iconColor: colors.textSecondary, label: t("settings.version"), value: "1.0.0", type: "plain" },
        { icon: FileText, iconColor: colors.textSecondary, label: t("settings.terms"), type: "chevron" },
        { icon: Shield, iconColor: colors.textSecondary, label: t("settings.privacy"), type: "chevron" },
      ],
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("settings.settings")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {sections.map((section, si) => (
          <View key={si} style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{section.title}</Text>
            <Card style={styles.sectionCard}>
              {section.rows.map((row, ri) => (
                <View key={ri}>
                  <Pressable style={styles.settingRow}>
                    <View style={[styles.iconBox, { backgroundColor: row.iconColor + "26" }]}>
                      <row.icon size={18} color={row.iconColor} />
                    </View>
                    <Text
                      style={[
                        styles.rowLabel,
                        { color: row.destructive ? colors.semanticError : colors.textPrimary },
                      ]}
                    >
                      {row.label}
                    </Text>
                    {row.type === "chevron" && (
                      <View style={styles.rowRight}>
                        {row.value && <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{row.value}</Text>}
                        <ChevronRight size={16} color={colors.textSecondary} />
                      </View>
                    )}
                    {row.type === "toggle" && (
                      <Switch
                        value={row.toggleValue}
                        onValueChange={row.onToggle}
                        trackColor={{ false: colors.borderDefault, true: colors.brandPrimary + "80" }}
                        thumbColor={row.toggleValue ? colors.brandPrimary : colors.textPlaceholder}
                      />
                    )}
                    {row.type === "plain" && row.value && (
                      <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{row.value}</Text>
                    )}
                  </Pressable>
                  {ri < section.rows.length - 1 && (
                    <View style={[styles.divider, { backgroundColor: colors.borderSubtle }]} />
                  )}
                </View>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", marginBottom: 8 },
  sectionCard: { padding: 0 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  iconBox: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowValue: { fontSize: 13, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginLeft: 60 },
});
