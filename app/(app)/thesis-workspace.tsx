import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ScrollView,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import * as Device from "expo-device";
import { useTranslation } from "react-i18next";
import { Maximize2, Paperclip, Download, Paintbrush, ListTree, FileText, AlignLeft } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { sendMessageToAI } from "@/lib/ai-service";
import { BackButton } from "@/components/BackButton";
import { WordDocxView, type DocTapBlock } from "@/components/workspace/WordDocxView";
import { OnlyOfficeView } from "@/components/workspace/OnlyOfficeView";
import { DocBlock } from "@/components/workspace/DocBlock";
import { PaperPage } from "@/components/workspace/PaperPage";
import { WorkspaceComposer } from "@/components/workspace/WorkspaceComposer";
import { AskBottomSheet } from "@/components/AskBottomSheet";
import { SourcesSheet } from "@/components/workspace/SourcesSheet";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
import {
  formatThesis,
  getThesisDocument,
  getThesisEditorConfig,
  type DocumentDTO,
  type DocBlockDTO,
  type EditorConfigDTO,
} from "@/lib/api";

// Ink colors retained by the workspace stylesheet.
const INK = "#1A1A1A";
const MUTED = "#777777";

// Flat text of a block for tap→index matching in the docx-preview fallback view.
function blockTapText(b: DocBlockDTO): string {
  if (b.kind === "paragraph") return b.text;
  if (b.kind === "table") return b.rows.map((r) => r.join(" ")).join(" ");
  if (b.kind === "image") return b.caption ?? "";
  return "";
}

export default function ThesisWorkspaceScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { thesisId, blockIndex } = useLocalSearchParams<{ thesisId: string; blockIndex?: string }>();

  const thesis = useThesisStore((s) => s.theses.find((th) => th.id === thesisId));
  // Select primitives individually — an object-literal selector hands
  // useSyncExternalStore a fresh reference every render → "Maximum update depth
  // exceeded".
  const blockText = useWorkspaceStore((s) => s.selectedBlockText);
  const docBlockIndex = useWorkspaceStore((s) => s.selectedBlockIndex);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  // Drives the live block refresh below: while a turn is generating the AI
  // commits .docx edits mid-turn, so we re-fetch the document to show them.
  const isGenerating = useChatStore((s) => s.isGenerating);
  const isFormatting = useWorkspaceStore((s) => s.isFormatting);
  const activePanel = useWorkspaceStore((s) => s.activePanel);

  // Live-.docx document model. `undefined` while loading; `null` once we know
  // the thesis is legacy (available:false) → fall back to the section render.
  const [doc, setDoc] = useState<DocumentDTO | undefined>(undefined);

  // OnlyOffice editor config for the live-docx view. `undefined` while loading;
  // `{ enabled:false }` when the Document Server isn't configured (or the fetch
  // failed) → fall back to the docx-preview WordDocxView. When enabled it carries
  // the signed DocEditor config (its `document.key` bumps after each AI turn).
  const [editorCfg, setEditorCfg] = useState<EditorConfigDTO | undefined>(undefined);

  // Main-view mode. "docx" renders the real Word document at full fidelity
  // (headers, page numbers, pagination via docx-preview/OnlyOffice); "outline"
  // renders the same blocks as lightweight editable text on white paper (native,
  // no WebView). Defaults to "docx" so a thesis always opens as the real document.
  const [viewMode, setViewMode] = useState<"docx" | "outline">("docx");

  // Mark this thesis current and pull the freshest copy from the server.
  useEffect(() => {
    if (!thesisId) return;
    useThesisStore.getState().setCurrentThesis(thesisId);
    useThesisStore.getState().refreshThesis(thesisId);
    useWorkspaceStore.getState().setThesis(thesisId);
    return () => {
      useWorkspaceStore.getState().reset();
    };
  }, [thesisId]);

  // Fetch the live-.docx block model. Best-effort: on any failure we leave the
  // legacy section/chapter render in place. `getThesisDocument` now reflects
  // fresh bytes, so re-calling it surfaces the AI's in-flight block edits.
  const refreshDoc = useCallback(async () => {
    if (!thesisId) return;
    try {
      const result = await getThesisDocument(thesisId);
      setDoc(result);
    } catch {
      // Keep whatever we last had; only fall to legacy if we never loaded a doc.
      setDoc((prev) => prev ?? { docMode: "legacy-db", available: false });
    }
  }, [thesisId]);

  // Fetch the OnlyOffice editor config (only meaningful for live docs). On any
  // failure we fall back to docx-preview by marking the editor disabled.
  const refreshEditorCfg = useCallback(async () => {
    if (!thesisId) return;
    try {
      setEditorCfg(await getThesisEditorConfig(thesisId));
    } catch {
      setEditorCfg({ enabled: false });
    }
  }, [thesisId]);

  // Format the thesis (apply norm-profile styles to the live .docx).
  const handleFormat = useCallback(async () => {
    const th = useThesisStore.getState().getCurrentThesis();
    if (!th) return;
    useWorkspaceStore.getState().setFormatting(true);
    try {
      await formatThesis(th.id);
      Alert.alert(t("workspace.formatted"));
      void refreshDoc();
    } catch {
      Alert.alert(t("workspace.formatError"));
    } finally {
      useWorkspaceStore.getState().setFormatting(false);
    }
  }, [t, refreshDoc]);

  // Toggle the outline panel. The ThesisStructureSheet gates on the bottom-sheet
  // store's "structure" key for its open state, so we sync both stores.
  const handleOutlineToggle = useCallback(() => {
    const ws = useWorkspaceStore.getState();
    const bs = useBottomSheet.getState();
    if (ws.activePanel === "outline") {
      ws.togglePanel("outline");
      bs.closeSheet("structure");
    } else {
      ws.togglePanel("outline");
      bs.openSheet("structure");
    }
  }, []);

  // Initial load of the document model + editor config.
  useEffect(() => {
    void refreshDoc();
    void refreshEditorCfg();
  }, [refreshDoc, refreshEditorCfg]);

  // Deep-link target: when opened from the detail screen's outline, pre-select
  // the tapped heading's block so the docx-preview view highlights/scrolls to it.
  useEffect(() => {
    if (blockIndex == null) return;
    const idx = Number(blockIndex);
    if (Number.isFinite(idx)) useWorkspaceStore.getState().selectBlock(idx, "");
  }, [blockIndex]);

  const liveDoc = doc?.available ? doc : null;
  const isLiveDoc = !!liveDoc;

  // Tap-target list for the Word view: each engine block → its flat text, so a
  // tapped paragraph/table maps back to its block index for AI targeting.
  const tapBlocks = useMemo<DocTapBlock[]>(
    () => (liveDoc ? liveDoc.blocks.map((b) => ({ index: b.index, text: blockTapText(b) })) : []),
    [liveDoc],
  );

  // Base text direction for rendering. The thesis `language` field is unreliable
  // (imports default to "fr" even for Arabic docs), so detect from the actual
  // block content — RTL when right-to-left characters dominate. Drives both the
  // docx-preview container direction and the outline view's block fallback.
  const docRtl = useMemo(() => {
    if (!liveDoc) return false;
    const RTL = /[֐-ࣿיִ-﻿]/;
    const LTR = /[A-Za-z]/;
    let r = 0;
    let l = 0;
    for (const b of liveDoc.blocks) {
      const text = b.kind === "paragraph" ? b.text : b.kind === "table" ? b.rows.flat().join(" ") : "";
      for (const ch of text) {
        if (RTL.test(ch)) r++;
        else if (LTR.test(ch)) l++;
      }
      if (r + l > 3000) break;
    }
    return r > l;
  }, [liveDoc]);

  // Refresh the document when a turn finishes (generating true → false): the AI
  // committed its block edits to the .docx during the turn, so re-fetching gives
  // a fresh signed url → the Word view reloads with the updated document.
  const prevGenerating = useRef(isGenerating);
  useEffect(() => {
    if (prevGenerating.current && !isGenerating && isLiveDoc) {
      void refreshDoc();
      // New .docx bytes → the server returns a config with a bumped document.key,
      // which remounts the OnlyOffice editor onto the updated document.
      void refreshEditorCfg();
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating, isLiveDoc, refreshDoc, refreshEditorCfg]);

  // Bridge the model's pending question (chat store) to the global sheet store,
  // which is what actually drives the AskBottomSheet's open state.
  useEffect(() => {
    if (pendingAsk) useBottomSheet.getState().openSheet("ask");
    else useBottomSheet.getState().closeSheet("ask");
  }, [pendingAsk]);

  const title = thesis?.title ?? "";

  // Loading: no thesis yet (refreshThesis still in flight).
  if (!thesis) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bgSurface }]}
        edges={[]}
      >
        <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
          <BackButton />
          <Text
            style={[styles.topTitle, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <View style={styles.expandBtn} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgSurface }]}
      edges={[]}
    >
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
        <BackButton />
        <Text
          style={[styles.topTitle, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {/* View toggle: docx (real document) ⟷ outline (editable text blocks).
            Shows the icon of the mode you'll switch TO. Only when a live doc exists. */}
        {liveDoc ? (
          <Pressable
            onPress={() => setViewMode((m) => (m === "docx" ? "outline" : "docx"))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              viewMode === "docx"
                ? t("workspace.viewOutline", { defaultValue: "Outline view" })
                : t("workspace.viewDocument", { defaultValue: "Document view" })
            }
            style={styles.expandBtn}
          >
            {viewMode === "docx" ? (
              <AlignLeft size={20} color={colors.textPrimary} />
            ) : (
              <FileText size={20} color={colors.brandPrimary} />
            )}
          </Pressable>
        ) : null}
        {/* Outline toggle */}
        <Pressable
          onPress={handleOutlineToggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.outline", { defaultValue: "Outline" })}
          style={styles.expandBtn}
        >
          <ListTree
            size={20}
            color={activePanel === "outline" ? colors.brandPrimary : colors.textPrimary}
          />
        </Pressable>
        {/* Format thesis → apply norm-profile styles. */}
        <Pressable
          onPress={handleFormat}
          hitSlop={8}
          disabled={isFormatting}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.format", { defaultValue: "Format" })}
          style={[styles.expandBtn, isFormatting && { opacity: 0.5 }]}
        >
          {isFormatting ? (
            <ActivityIndicator size="small" color={colors.brandPrimary} />
          ) : (
            <Paintbrush size={20} color={colors.textPrimary} />
          )}
        </Pressable>
        {/* Sources → reference files the AI can draw from. */}
        <Pressable
          onPress={() => useBottomSheet.getState().openSheet("thesis-sources")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("sources.title", { defaultValue: "Sources" })}
          style={styles.expandBtn}
        >
          <Paperclip size={20} color={colors.textPrimary} />
        </Pressable>
        {/* Download → open the real .docx (live-docx mode only). */}
        {liveDoc ? (
          <Pressable
            onPress={() => {
              if (liveDoc.downloadUrl) {
                Linking.openURL(liveDoc.downloadUrl).catch(() => {});
              }
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.download", { defaultValue: "Download" })}
            style={styles.expandBtn}
          >
            <Download size={20} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        {/* Expand → open the real .docx (the live document is the deliverable). */}
        {liveDoc ? (
          <Pressable
            onPress={() => {
              if (liveDoc.downloadUrl) Linking.openURL(liveDoc.downloadUrl).catch(() => {});
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("preview.a4Title", { defaultValue: "A4 preview" })}
            style={styles.expandBtn}
          >
            <Maximize2 size={20} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.expandBtn} />
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {doc === undefined ? (
          /* Document model not resolved yet — avoid flashing the legacy render
             (migrated theses can still have section rows) before we know mode. */
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
          </View>
        ) : liveDoc ? (
          /* Live-.docx: prefer the OnlyOffice Docs editor (HTML5-canvas, OOXML-
             native → Word-level fidelity); fall back to docx-preview when the
             Document Server isn't configured. Both reload after each AI turn:
             OnlyOffice via a bumped document.key, docx-preview via the signed url.
             Tap-to-target isn't available in the OnlyOffice view yet — the composer
             still works (the AI targets blocks via find), unlike WordDocxView where
             tapping a paragraph/table selects it. No synthetic title page.

             OnlyOffice only on REAL devices: its heavy WASM/JS editor crashes the
             iOS Simulator's WebContent process (and is unreliable in emulators), so
             simulators/emulators fall back to the lighter docx-preview render. */
          viewMode === "outline" ? (
            /* Outline mode: the same .docx blocks as lightweight editable text on
               white "paper" — native render (no WebView), tap a block to select it
               for the AI. Reads liveDoc.blocks (already in the DTO), so no extra
               fetch and no editor-config gating. */
            <ScrollView
              contentContainerStyle={styles.outlineContent}
              showsVerticalScrollIndicator={false}
            >
              <PaperPage>
                {liveDoc.blocks.map((b) => (
                  <DocBlock key={b.index} block={b} rtl={docRtl} />
                ))}
              </PaperPage>
            </ScrollView>
          ) : editorCfg === undefined ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.brandPrimary} />
            </View>
          ) : editorCfg.enabled && Device.isDevice ? (
            <OnlyOfficeView
              documentServerUrl={editorCfg.documentServerUrl}
              config={editorCfg.config}
            />
          ) : (
            <WordDocxView
              url={liveDoc.downloadUrl}
              blocks={tapBlocks}
              selectedIndex={docBlockIndex}
              rtl={docRtl}
              onSelect={(index, text) =>
                useWorkspaceStore.getState().selectBlock(index, text)
              }
            />
          )
        ) : (
          /* Unseeded thesis (no live .docx yet). Structure lives in the document,
             so there's nothing to render until it's seeded — ask the AI to start. */
          <View style={styles.centered}>
            <Text style={styles.emptyText}>
              {t("workspace.empty", { defaultValue: "No content yet." })}
            </Text>
          </View>
        )}

        {/* AI composer pinned at the bottom, outside the ScrollView so the pages
            scroll above it and it stays fixed. */}
        <View style={{ paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.bgPrimary }}>
          <WorkspaceComposer thesisId={thesisId} isLiveDoc={isLiveDoc} />
        </View>
      </KeyboardAvoidingView>

      {/* Sources sheet — self-hides when closed (conditional unmount). */}
      <SourcesSheet thesisId={thesisId} />

      {/* Outline sheet — mounted only while the outline panel is active. */}
      {activePanel === "outline" && <ThesisStructureSheet />}

      {/* The model's pending question → blocking answer sheet. */}
      {pendingAsk && (
        <AskBottomSheet
          ask={pendingAsk}
          onAnswer={(answer) => {
            useChatStore.getState().setPendingAsk(null);
            void sendMessageToAI(thesisId, answer, {
              selection: blockText ?? undefined,
              docBlockIndex: docBlockIndex ?? null,
            });
          }}
          onClose={() => useChatStore.getState().setPendingAsk(null)}
        />
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
  topTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  expandBtn: {
    width: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  expandIcon: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { paddingBottom: 40 },
  outlineContent: { paddingVertical: 8, paddingBottom: 40 },

  // Title page
  titleUniversity: {
    color: INK,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  titleMuted: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 2,
  },
  titleMain: {
    color: INK,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 29,
  },
  titleMeta: {
    color: INK,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 4,
  },
  titleSpacer: { height: 28 },

  // Résumé / generic page heading
  pageHeading: {
    color: INK,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    marginBottom: 10,
  },
  keywords: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 12,
  },

  // Section divider (centered)
  sectionTitleCenter: {
    color: INK,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  sectionKindCenter: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 8,
  },

  // Section with content (left-aligned)
  sectionTitleLeft: {
    color: INK,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  sectionKindLeft: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginTop: 4,
  },
  contentSpacer: { height: 10 },

  // Empty state
  emptyText: {
    color: MUTED,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
});
