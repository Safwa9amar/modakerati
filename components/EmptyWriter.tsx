import { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { PenLine, FolderUp, LayoutGrid, Plus, Sparkles, type LucideIcon } from "lucide-react-native";

import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useThesisStore } from "@/stores/thesis-store";
import { useImportStore } from "@/stores/import-store";
import { DrawerMenuButton } from "@/components/DrawerMenuButton";

/**
 * What the app opens on when there is no thesis to write. The writer is the root
 * surface, so this is a WRITER with nothing in it — same chrome, same composer,
 * same place for the thumb — not a dashboard wearing the writer's clothes. The
 * three starters are the only ways a document can begin.
 */
export function EmptyWriter() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const rtl = useRTL();
  const router = useRouter();

  const handleImport = useCallback(async () => {
    const store = useImportStore.getState();
    store.reset();
    const result = await store.pickAndImport();
    if (result === "ok") {
      const thesis = useImportStore.getState().thesis;
      if (thesis) useThesisStore.getState().upsertThesis(thesis);
      router.push("/(app)/import-analysis" as any);
    } else if (result === "error") {
      Alert.alert(t("import.title"), useImportStore.getState().errorMessage || t("thesis.genericError"));
    }
  }, [router, t]);

  const starters: { key: string; icon: LucideIcon; label: string; onPress: () => void }[] = [
    {
      key: "new",
      icon: PenLine,
      label: t("drawer.newThesis"),
      onPress: () => router.push("/(app)/start-thesis" as any),
    },
    { key: "import", icon: FolderUp, label: t("home.importDocx"), onPress: handleImport },
    {
      key: "templates",
      icon: LayoutGrid,
      label: t("drawer.templates"),
      onPress: () => router.push("/(app)/browse-templates" as any),
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top", "bottom"]}>
      <View style={[styles.topBar, { flexDirection: rtl.flexDirection }]}>
        <DrawerMenuButton />
        <Text style={[styles.brand, { color: colors.textPrimary, textAlign: rtl.textAlign }]} numberOfLines={1}>
          {t("auth.appName")}
        </Text>
      </View>

      <View style={styles.middle}>
        <Text style={[styles.headline, { color: colors.textPrimary }]}>{t("writer.emptyTitle")}</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>{t("writer.emptyHint")}</Text>
      </View>

      <View style={styles.starters}>
        {starters.map((s) => {
          const Icon = s.icon;
          return (
            <Pressable
              key={s.key}
              onPress={s.onPress}
              style={[styles.starter, { flexDirection: rtl.flexDirection }]}
              accessibilityRole="button"
            >
              <Icon size={19} color={colors.textSecondary} />
              <Text
                style={[styles.starterLabel, { color: colors.textPrimary, textAlign: rtl.textAlign }]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* The composer keeps the shape it has over a document, but a chat turn is
          scoped to a thesis and this screen only appears when there is none — so
          tapping it starts one rather than opening a conversation with nothing to
          talk about (which would just land back here). */}
      <Pressable
        onPress={() => router.push("/(app)/start-thesis" as any)}
        style={[
          styles.composer,
          {
            backgroundColor: colors.bgInput,
            borderColor: colors.borderDefault,
            flexDirection: rtl.flexDirection,
          },
        ]}
        accessibilityRole="button"
      >
        <Plus size={18} color={colors.textSecondary} />
        <Text
          style={[styles.composerText, { color: colors.textPlaceholder, textAlign: rtl.textAlign }]}
          numberOfLines={1}
        >
          {t("writer.askPlaceholder")}
        </Text>
        <View style={[styles.send, { backgroundColor: colors.brandPrimary }]}>
          <Sparkles size={14} color="#FFFFFF" />
        </View>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  brand: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 8 },
  headline: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  starters: { paddingHorizontal: 20, paddingBottom: 6, gap: 2 },
  starter: { alignItems: "center", gap: 14, paddingVertical: 13 },
  starterLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  composer: {
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  composerText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  send: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
