import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { FileText, Trash2, Upload } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BottomSheet } from "@/components/BottomSheet";
import { useSourceStore } from "@/stores/source-store";
import { addSource } from "@/lib/api";
import type { ThesisSource } from "@/types/source";

// Stable empty default for the selector — returning a fresh `[]` would make
// Zustand re-render every tick and can trigger a "Maximum update depth" crash.
const MODULE_EMPTY: ThesisSource[] = [];

// MIME types we accept as reference material: .docx, plain text, markdown.
const ACCEPTED_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

interface SourcesSheetProps {
  thesisId: string;
}

/**
 * Sources / helper-files sheet for a thesis. Lets the user attach reference
 * files (.docx / .txt / .md) the AI can draw from. Built on the reusable
 * <BottomSheet>; opened with useBottomSheet.getState().openSheet("thesis-sources").
 *
 * The inner content only mounts while the sheet is open (the wrapper
 * conditionally unmounts), so the list is (re)loaded on each open.
 */
export function SourcesSheet({ thesisId }: SourcesSheetProps) {
  return (
    <BottomSheet name="thesis-sources" snapPoints={["55%", "90%"]} keyboardBehavior="extend">
      <SourcesContent thesisId={thesisId} />
    </BottomSheet>
  );
}

function SourcesContent({ thesisId }: SourcesSheetProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  const sources = useSourceStore((s) => s.byThesis[thesisId] ?? MODULE_EMPTY);
  const loading = useSourceStore((s) => s.loading);

  const [picked, setPicked] = useState<{ uri: string; name: string } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);

  // Refresh the list whenever the sheet (re)mounts for this thesis.
  useEffect(() => {
    useSourceStore.getState().load(thesisId);
  }, [thesisId]);

  const handleChoose = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const name = asset.name ?? "source";
      setPicked({ uri: asset.uri, name });
      // Prefill the title with the filename so the user rarely has to type it.
      if (!title.trim()) setTitle(name);
    } catch {
      Alert.alert(t("sources.title", { defaultValue: "Sources" }));
    }
  };

  const handleUpload = async () => {
    if (!picked || uploading) return;
    setUploading(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(picked.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const src = await addSource(thesisId, {
        base64,
        filename: picked.name,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      });
      useSourceStore.getState().add(thesisId, src);
      // Reset the form for the next upload.
      setPicked(null);
      setTitle("");
      setDescription("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      Alert.alert(t("sources.title", { defaultValue: "Sources" }), message);
    } finally {
      setUploading(false);
    }
  };

  const canUpload = !!picked && !uploading;

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {t("sources.title", { defaultValue: "Sources" })}
      </Text>

      {/* Add form */}
      <View style={styles.form}>
        <Pressable
          onPress={handleChoose}
          style={[
            styles.chooseBtn,
            { borderColor: colors.brandPrimary + "55" },
          ]}
        >
          <FileText size={15} color={colors.brandPrimary} strokeWidth={2} />
          <Text
            style={[styles.chooseBtnText, { color: colors.brandPrimary }]}
            numberOfLines={1}
          >
            {picked ? picked.name : t("sources.chooseFile", { defaultValue: "Choose file" })}
          </Text>
        </Pressable>

        <BottomSheetTextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t("sources.sourceTitle", { defaultValue: "Title" })}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
        />

        <BottomSheetTextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t("sources.description", {
            defaultValue: "What should the AI take from this?",
          })}
          placeholderTextColor={colors.textPlaceholder}
          multiline
          style={[
            styles.input,
            styles.inputMultiline,
            { color: colors.textPrimary, backgroundColor: colors.bgCard },
          ]}
        />

        <Pressable
          onPress={handleUpload}
          disabled={!canUpload}
          style={[
            styles.uploadBtn,
            { backgroundColor: colors.brandPrimary, opacity: canUpload ? 1 : 0.5 },
          ]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Upload size={16} color="#FFFFFF" strokeWidth={2} />
              <Text style={styles.uploadBtnText}>
                {t("sources.upload", { defaultValue: "Upload" })}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {/* List */}
      {loading && sources.length === 0 ? (
        <ActivityIndicator size="small" color={colors.brandPrimary} style={styles.listLoader} />
      ) : sources.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          {t("sources.empty", {
            defaultValue: "No sources yet. Add reference files to help the AI.",
          })}
        </Text>
      ) : (
        <BottomSheetScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {sources.map((source) => (
            <View key={source.id} style={[styles.row, { backgroundColor: colors.bgCard }]}>
              <View style={styles.rowMain}>
                <Text
                  style={[styles.rowTitle, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {source.title || source.filename}
                </Text>
                {source.description ? (
                  <Text
                    style={[styles.rowDescription, { color: colors.textSecondary }]}
                    numberOfLines={2}
                  >
                    {source.description}
                  </Text>
                ) : null}
                <View style={styles.badgeRow}>
                  {source.fileType ? (
                    <View style={[styles.badge, { backgroundColor: colors.bgSurface }]}>
                      <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                        {source.fileType}
                      </Text>
                    </View>
                  ) : null}
                  {source.status === "unextracted" ? (
                    <View style={[styles.badge, { backgroundColor: colors.semanticWarning + "22" }]}>
                      <Text style={[styles.badgeText, { color: colors.semanticWarning }]}>
                        {t("sources.unextracted", { defaultValue: "Not extracted" })}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Pressable
                onPress={() => useSourceStore.getState().remove(thesisId, source.id)}
                hitSlop={8}
                accessibilityRole="button"
                style={styles.deleteBtn}
              >
                <Trash2 size={18} color={colors.semanticError} strokeWidth={2} />
              </Pressable>
            </View>
          ))}
        </BottomSheetScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 16 },
  form: { gap: 12, marginBottom: 20 },
  chooseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  chooseBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
  },
  uploadBtnText: { color: "#FFFFFF", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  listLoader: { marginTop: 8 },
  empty: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginTop: 8,
  },
  list: { flex: 1 },
  listContent: { gap: 10, paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  rowMain: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowDescription: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  deleteBtn: { padding: 2 },
});
