import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";
import { useNotificationStore } from "@/stores/notification-store";
import { registerForPushNotificationsAsync } from "@/lib/push-notifications";
import { setLanguageWithRTL } from "@/lib/i18n";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import {
  Globe, Moon, Sun, Bell, Sparkles, Clock,
  Trash2, AlertTriangle, RefreshCw,
  Info, FileText, Shield, ChevronRight, ChevronDown, Check, FlaskConical,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

type Language = "ar" | "en" | "fr";

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ar", label: "العربية" },
];

interface SettingRow {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  value?: string;
  type: "chevron" | "toggle" | "plain" | "select";
  toggleValue?: boolean;
  onToggle?: (v: boolean) => void;
  onPress?: () => void;
  destructive?: boolean;
  // select-only
  options?: { value: string; label: string }[];
  selectedValue?: string;
  onSelect?: (value: string) => void;
  expanded?: boolean;
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const syncWhileEditing = useSettingsStore((s) => s.syncWhileEditing);
  const setSyncWhileEditing = useSettingsStore((s) => s.setSyncWhileEditing);

  const preferences = useNotificationStore((s) => s.preferences);
  const updatePreferences = useNotificationStore((s) => s.updatePreferences);
  const [langExpanded, setLangExpanded] = useState(false);

  useEffect(() => {
    useNotificationStore.getState().loadPreferences();
  }, []);

  const handleSelectLanguage = async (code: Language) => {
    setLangExpanded(false);
    if (code === language) return;
    setLanguage(code);
    const needsRestart = await setLanguageWithRTL(code);
    if (needsRestart) {
      Alert.alert(t("settings.rtlRestartTitle"), t("settings.rtlRestartMessage"), [
        { text: t("common.ok") },
      ]);
    }
  };

  // Clears the app's temporary cache directory (downloaded previews, exported
  // PDFs, picked-file copies). Does NOT touch AsyncStorage, the session, or any
  // saved preferences — only disposable on-device files.
  const handleClearCache = () => {
    Alert.alert(
      t("settings.clearCacheConfirmTitle"),
      t("settings.clearCacheConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.clearCache"),
          style: "destructive",
          onPress: async () => {
            try {
              const dir = FileSystem.cacheDirectory;
              if (dir) {
                const entries = await FileSystem.readDirectoryAsync(dir);
                await Promise.all(
                  entries.map((name) => FileSystem.deleteAsync(dir + name, { idempotent: true })),
                );
              }
              Alert.alert(t("settings.clearCacheDoneTitle"), t("settings.clearCacheDoneMessage"));
            } catch {
              Alert.alert(t("common.error"), t("settings.clearCacheError"));
            }
          },
        },
      ],
    );
  };

  const languageLabel = LANGUAGES.find((l) => l.value === language)?.label ?? language;

  const sections: { title: string; rows: SettingRow[] }[] = [
    {
      title: t("settings.general"),
      rows: [
        {
          icon: Globe, iconColor: colors.brandPrimary, label: t("settings.language"),
          type: "select", value: languageLabel, options: LANGUAGES, selectedValue: language,
          expanded: langExpanded, onPress: () => setLangExpanded((e) => !e),
          onSelect: (v) => handleSelectLanguage(v as Language),
        },
        {
          icon: theme === "dark" ? Moon : Sun, iconColor: colors.brandAccent, label: t("settings.theme"),
          type: "toggle", toggleValue: theme === "dark",
          onToggle: (v) => setTheme(v ? "dark" : "light"),
        },
        // OFF (default) = local-first editing: document edits save on-device and
        // sync in the background when the user leaves the composer. ON = every
        // edit syncs to the server immediately while editing — noticeably slower,
        // so turning it ON asks for confirmation first (OFF applies silently).
        {
          icon: RefreshCw, iconColor: colors.brandPrimary, label: t("settings.syncWhileEditing"),
          type: "toggle", toggleValue: syncWhileEditing,
          onToggle: (v) => {
            if (!v) {
              setSyncWhileEditing(false);
              return;
            }
            Alert.alert(
              t("settings.syncWhileEditingWarnTitle"),
              t("settings.syncWhileEditingWarnMessage"),
              [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("settings.syncWhileEditingWarnConfirm"), onPress: () => setSyncWhileEditing(true) },
              ],
            );
          },
        },
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
        { icon: Trash2, iconColor: colors.semanticWarning, label: t("settings.clearCache"), type: "plain", onPress: handleClearCache },
        { icon: AlertTriangle, iconColor: colors.semanticError, label: t("settings.deleteAccount"), type: "plain", destructive: true, onPress: () => router.push("/(app)/delete-account" as any) },
      ],
    },
    {
      title: t("settings.about"),
      rows: [
        { icon: Info, iconColor: colors.textSecondary, label: t("settings.version"), value: "1.0.0", type: "plain" },
        { icon: FileText, iconColor: colors.textSecondary, label: t("settings.terms"), type: "chevron", onPress: () => router.push("/(app)/terms-of-service" as any) },
        { icon: Shield, iconColor: colors.textSecondary, label: t("settings.privacy"), type: "chevron", onPress: () => router.push("/(app)/privacy-policy" as any) },
      ],
    },
    // Dev-only: reach the Lexical rich-text spike (native bubble ⇄ web editor).
    ...(__DEV__
      ? [
          {
            title: "Developer",
            rows: [
              {
                icon: FlaskConical,
                iconColor: colors.brandPrimary,
                label: "Lexical Lab",
                type: "chevron" as const,
                onPress: () => router.push("/(app)/lexical-lab" as any),
              },
            ],
          },
        ]
      : []),
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
                  <Pressable
                    style={styles.settingRow}
                    onPress={row.type === "toggle" ? undefined : row.onPress}
                  >
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
                    {row.type === "select" && (
                      <View style={styles.rowRight}>
                        {row.value && <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{row.value}</Text>}
                        {row.expanded
                          ? <ChevronDown size={16} color={colors.textSecondary} />
                          : <ChevronRight size={16} color={colors.textSecondary} />}
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

                  {row.type === "select" && row.expanded && row.options && (
                    <View style={[styles.optionsWrap, { borderTopColor: colors.borderSubtle }]}>
                      {row.options.map((opt) => {
                        const active = opt.value === row.selectedValue;
                        return (
                          <Pressable
                            key={opt.value}
                            style={styles.optionRow}
                            onPress={() => row.onSelect?.(opt.value)}
                          >
                            <Text
                              style={[
                                styles.optionLabel,
                                { color: active ? colors.brandPrimary : colors.textPrimary },
                              ]}
                            >
                              {opt.label}
                            </Text>
                            {active && <Check size={18} color={colors.brandPrimary} />}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

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
  optionsWrap: { borderTopWidth: 1, marginLeft: 60, paddingRight: 16 },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingRight: 4 },
  optionLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
