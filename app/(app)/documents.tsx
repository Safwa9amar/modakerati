import { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { FileText, Plus, Trash2 } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { useNavBarClearance } from "@/components/FloatingNavBar";
import { useDocumentStore } from "@/stores/document-store";
import type { DocumentRecord } from "@/types/document";

export default function DocumentsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const bottomPad = useNavBarClearance();

  const documents = useDocumentStore((s) => s.documents);
  const loading = useDocumentStore((s) => s.loading);
  const importing = useDocumentStore((s) => s.importing);
  const fetchList = useDocumentStore((s) => s.fetchList);
  const importDocx = useDocumentStore((s) => s.importDocx);
  const remove = useDocumentStore((s) => s.remove);

  useFocusEffect(
    useCallback(() => {
      fetchList();
    }, [fetchList])
  );

  async function handleImport() {
    const result = await importDocx();
    if (result.status === "ok") {
      router.push({
        pathname: "/(app)/document-editor",
        params: { id: result.document.id },
      } as any);
    } else if (result.status === "error") {
      // Store-origin errors carry a code we localize here; "generic" passes the
      // already-meaningful server/native message through.
      const body = result.code === "generic" ? result.message : t(`documents.err_${result.code}`);
      Alert.alert(t("documents.importFailed"), body);
    }
  }

  function confirmDelete(doc: DocumentRecord) {
    Alert.alert(t("documents.deleteTitle"), t("documents.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => remove(doc.id) },
    ]);
  }

  function metaLine(doc: DocumentRecord): string {
    const words = `${doc.wordCount ?? 0} ${t("documents.words")}`;
    const pages = `${doc.pageCount ?? 0} ${t("documents.pages")}`;
    return `${words} · ${pages}`;
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
      edges={["top"]}
    >
      <View style={styles.topBar}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t("documents.title")}
        </Text>
        <Pressable
          onPress={handleImport}
          disabled={importing}
          style={[styles.newButton, { backgroundColor: colors.brandPrimary }]}
        >
          <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={styles.newButtonText}>{t("documents.import")}</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {loading && documents.length === 0 ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
          </View>
        ) : documents.length === 0 ? (
          <View style={styles.emptyState}>
            <FileText size={40} color={colors.textPlaceholder} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t("documents.empty")}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textPlaceholder }]}>
              {t("documents.emptyHint")}
            </Text>
          </View>
        ) : (
          documents.map((doc) => (
            <Pressable
              key={doc.id}
              onPress={() =>
                router.push({
                  pathname: "/(app)/document-editor",
                  params: { id: doc.id },
                } as any)
              }
            >
              <Card style={styles.docCard}>
                <View style={[styles.docIcon, { backgroundColor: colors.bgSurface }]}>
                  <FileText size={20} color={colors.brandPrimary} strokeWidth={2} />
                </View>
                <View style={styles.docBody}>
                  <Text
                    style={[styles.docTitle, { color: colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {doc.title || doc.filename}
                  </Text>
                  <Text
                    style={[styles.docMeta, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {metaLine(doc)}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => confirmDelete(doc)}
                  style={styles.deleteBtn}
                >
                  <Trash2 size={18} color={colors.semanticError} strokeWidth={2} />
                </Pressable>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>

      {importing && (
        <View style={[styles.overlay, { backgroundColor: colors.bgPrimary + "E6" }]}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={[styles.overlayText, { color: colors.textPrimary }]}>
            {t("documents.parsing")}
          </Text>
        </View>
      )}
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
  title: { flex: 1, fontSize: 20, fontFamily: "Inter_700Bold" },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  newButtonText: { color: "#FFFFFF", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  list: { flex: 1 },
  listContent: { padding: 20, gap: 12, paddingBottom: 100 },
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 0,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  docBody: { flex: 1, gap: 4 },
  docTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  docMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  deleteBtn: { padding: 6 },
  emptyState: { paddingTop: 80, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 40 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  overlayText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
