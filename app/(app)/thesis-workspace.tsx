import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Linking,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import Animated, { useSharedValue, useAnimatedStyle } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import * as Device from "expo-device";
import { useTranslation } from "react-i18next";
import { Maximize2, PanelBottomOpen, PanelBottomClose } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRibbonStore } from "@/stores/ribbon-store";
import { useChatStore } from "@/stores/chat-store";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { BackButton } from "@/components/BackButton";
import { WordDocxView, type DocTapBlock } from "@/components/workspace/WordDocxView";
import { OnlyOfficeView } from "@/components/workspace/OnlyOfficeView";
import { PdfView } from "@/components/workspace/PdfView";
import { DocBlock } from "@/components/workspace/DocBlock";
import { PaperPage } from "@/components/workspace/PaperPage";
import {
  WorkspaceComposerSheet,
  COMPOSER_COLLAPSED_HEIGHT,
} from "@/components/workspace/WorkspaceComposerSheet";
import { WorkspaceViewSwitcher } from "@/components/workspace/WorkspaceViewSwitcher";
import { OutlineReorderable } from "@/components/workspace/OutlineReorderable";
import { SourcesSheet } from "@/components/workspace/SourcesSheet";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
import {
  getThesisDocument,
  getThesisEditorConfig,
  getThesisPdf,
  deleteThesisPdf,
  type DocumentDTO,
  type DocBlockDTO,
  type EditorConfigDTO,
  type ThesisPdfDTO,
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
  const { height: windowHeight } = useWindowDimensions();
  const { thesisId, blockIndex } = useLocalSearchParams<{ thesisId: string; blockIndex?: string }>();

  const thesis = useThesisStore((s) => s.theses.find((th) => th.id === thesisId));
  // Select primitives individually — an object-literal selector hands
  // useSyncExternalStore a fresh reference every render → "Maximum update depth
  // exceeded".
  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  // Indices feed the Word view's multi-highlight. Derived once per selection change.
  const selectedIndices = useMemo(() => selectedBlocks.map((b) => b.index), [selectedBlocks]);
  // Drives the live block refresh below: while a turn is generating the AI
  // commits .docx edits mid-turn, so we re-fetch the document to show them.
  const isGenerating = useChatStore((s) => s.isGenerating);
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);
  // The composer sheet writes its LIVE top-edge Y into this shared value (gorhom's
  // `animatedPosition`). The document area reserves exactly the height the sheet
  // covers from the bottom, so content always clears the sheet at any position —
  // peek, expanded, mid-drag, or keyboard-resized — with no stale-padding gaps.
  const sheetPosition = useSharedValue(windowHeight - COMPOSER_COLLAPSED_HEIGHT);

  // Live-.docx document model. `undefined` while loading; `null` once we know
  // the thesis is legacy (available:false) → fall back to the section render.
  const [doc, setDoc] = useState<DocumentDTO | undefined>(undefined);

  // Monotonic reload token, bumped on every doc refresh. Appended to the Word
  // view's URL so the docx-preview WebView reliably re-fetches after an edit —
  // the signed download URL can be byte-identical across two fetches in the same
  // second, so relying on it alone leaves a manual edit (style/alignment) invisible.
  const [docTick, setDocTick] = useState(0);

  // OnlyOffice editor config for the live-docx view. `undefined` while loading;
  // `{ enabled:false }` when the Document Server isn't configured (or the fetch
  // failed) → fall back to the docx-preview WordDocxView. When enabled it carries
  // the signed DocEditor config (its `document.key` bumps after each AI turn).
  const [editorCfg, setEditorCfg] = useState<EditorConfigDTO | undefined>(undefined);

  // PDF render of the live .docx (OnlyOffice-converted, fetched lazily only when
  // the user opens the PDF view). `undefined` while (re)converting; the DTO's
  // `available:false` carries why (no Document Server / conversion failed).
  const [pdfDoc, setPdfDoc] = useState<ThesisPdfDTO | undefined>(undefined);

  const viewMode = useWorkspaceStore((s) => s.viewMode);

  // Mark this thesis current and pull the freshest copy from the server.
  useEffect(() => {
    if (!thesisId) return;
    useThesisStore.getState().setCurrentThesis(thesisId);
    useThesisStore.getState().refreshThesis(thesisId);
    useWorkspaceStore.getState().setThesis(thesisId);
    return () => {
      // Leaving the workspace while the PDF view is open → drop the transient
      // preview (read viewMode BEFORE reset() clears it back to "docx").
      if (useWorkspaceStore.getState().viewMode === "pdf") {
        void deleteThesisPdf(thesisId).catch(() => {});
      }
      useWorkspaceStore.getState().reset();
      useRibbonStore.getState().reset();
      // The chat tab shares `pendingAsk` and the "structure" sheet key, so clear
      // an unanswered question and close the outline panel on leave — otherwise
      // either can ghost open on the chat screen.
      useChatStore.getState().setPendingAsk(null);
      useBottomSheet.getState().closeSheet("structure");
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
      setDocTick((n) => n + 1);
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

  // Convert + fetch the PDF render. Clears to `undefined` first so the view shows
  // a spinner while the Document Server (re)renders. Only called when the PDF
  // view is open (see the effect below) — conversion is too costly to prefetch.
  const refreshPdf = useCallback(async () => {
    if (!thesisId) return;
    setPdfDoc(undefined);
    try {
      setPdfDoc(await getThesisPdf(thesisId));
    } catch {
      setPdfDoc({ available: false, reason: "failed" });
    }
  }, [thesisId]);

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

  // Load the document model + editor config on focus. Using focus (not mount)
  // means returning from the block editor re-fetches, so a saved paragraph edit
  // shows on the pages without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      void refreshDoc();
      void refreshEditorCfg();
    }, [refreshDoc, refreshEditorCfg]),
  );

  const liveDoc = doc?.available ? doc : null;
  const isLiveDoc = !!liveDoc;

  // Tap-target list for the Word view: each engine block → its flat text, so a
  // tapped paragraph/table maps back to its block index for AI targeting.
  const tapBlocks = useMemo<DocTapBlock[]>(
    () => (liveDoc ? liveDoc.blocks.map((b) => ({ index: b.index, text: blockTapText(b) })) : []),
    [liveDoc],
  );

  // Deep-link target: when opened from the detail screen's outline, pre-select
  // the tapped heading's block so the docx-preview view highlights/scrolls to it,
  // and so the AI composer sends its text as the focus. The callers navigate here
  // with the heading text already in the store, so NEVER clobber an existing
  // non-empty selection (doing so dropped the heading text from the AI request).
  // For a cold deep-link with no pre-set text, resolve it from the loaded doc.
  useEffect(() => {
    if (blockIndex == null) return;
    const idx = Number(blockIndex);
    if (!Number.isFinite(idx)) return;
    const store = useWorkspaceStore.getState();
    const existing = store.selectedBlocks.find((b) => b.index === idx);
    if (existing?.text) return;
    const resolved = tapBlocks.find((b) => b.index === idx)?.text ?? existing?.text ?? "";
    store.selectBlock(idx, resolved);
  }, [blockIndex, tapBlocks]);

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

  // Document-version token: the OnlyOffice config's document.key bumps only when
  // the .docx actually changes (it's derived from updatedAt). Keying the PDF
  // fetch on it re-converts after a real edit but not on incidental refreshes.
  const docVersionKey = editorCfg?.enabled ? editorCfg.config?.document?.key : undefined;

  // (Re)fetch the PDF only while its view is open — on first open and whenever the
  // document version changes (after an AI turn / bulk edit). Server-side caching
  // makes an unchanged re-fetch cheap.
  useEffect(() => {
    if (viewMode !== "pdf" || !isLiveDoc) return;
    void refreshPdf();
  }, [viewMode, isLiveDoc, docVersionKey, refreshPdf]);

  // Switching OUT of the PDF view (while staying on the screen) discards the
  // transient preview and drops the local copy so it isn't kept around.
  const prevViewMode = useRef(viewMode);
  useEffect(() => {
    if (prevViewMode.current === "pdf" && viewMode !== "pdf" && thesisId) {
      setPdfDoc(undefined);
      void deleteThesisPdf(thesisId).catch(() => {});
    }
    prevViewMode.current = viewMode;
  }, [viewMode, thesisId]);

  const title = thesis?.title ?? "";

  // Reserve exactly the height the sheet covers from the bottom = containerHeight
  // (≈ window) − the sheet's live top-edge Y. Tracks every position continuously,
  // so there's never a stale gap when the snap point changes.
  const docAreaStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, windowHeight - sheetPosition.value),
  }));

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
        <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {/* One-tap view cycler (Document → Outline → PDF), live docs only. */}
        {liveDoc && <WorkspaceViewSwitcher />}
        {/* Show / hide the AI composer sheet. */}
        {liveDoc && (
          <Pressable
            onPress={() => useWorkspaceStore.getState().toggleComposer()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              composerOpen
                ? t("workspace.hideComposer", { defaultValue: "Hide composer" })
                : t("workspace.showComposer", { defaultValue: "Show composer" })
            }
            style={styles.expandBtn}
          >
            {composerOpen ? (
              <PanelBottomClose size={20} color={colors.brandPrimary} />
            ) : (
              <PanelBottomOpen size={20} color={colors.textPrimary} />
            )}
          </Pressable>
        )}
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

      <Animated.View style={[{ flex: 1 }, docAreaStyle]}>
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
          viewMode === "pdf" ? (
            /* PDF mode: the OnlyOffice-rendered PDF of the live .docx in a WebView
               (PDF.js). Read-only deliverable preview; works on simulator too
               (conversion is server-side). Re-converts after each edit via the
               docVersionKey-keyed fetch above. */
            pdfDoc === undefined ? (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={colors.brandPrimary} />
              </View>
            ) : pdfDoc.available ? (
              <View style={{ flex: 1 }}>
                <PdfView url={pdfDoc.url} />
              </View>
            ) : (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>
                  {pdfDoc.reason === "failed"
                    ? t("workspace.pdfFailed", { defaultValue: "Couldn't generate the PDF. Please try again." })
                    : t("workspace.pdfUnavailable", { defaultValue: "PDF preview isn't available for this document." })}
                </Text>
              </View>
            )
          ) : viewMode === "outline" ? (
            /* Outline mode: the same .docx blocks as lightweight editable text on
               white "paper" — native render (no WebView). Tap a block to select it
               for the AI; long-press the grip handle to drag-reorder it. Reads
               liveDoc.blocks (already in the DTO), so no extra fetch. */
            <OutlineReorderable
              thesisId={thesisId}
              blocks={liveDoc.blocks}
              rtl={docRtl}
              onAfterMove={() => void refreshDoc()}
              paddingBottom={16}
            />
          ) : editorCfg === undefined ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.brandPrimary} />
            </View>
          ) : editorCfg.enabled && Device.isDevice ? (
            <View style={{ flex: 1 }}>
              <OnlyOfficeView
                documentServerUrl={editorCfg.documentServerUrl}
                config={editorCfg.config}
              />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <WordDocxView
                url={`${liveDoc.downloadUrl}${liveDoc.downloadUrl.includes("?") ? "&" : "?"}_v=${docTick}`}
                blocks={tapBlocks}
                selectedIndices={selectedIndices}
                scrollToIndex={
                  blockIndex != null && Number.isFinite(Number(blockIndex))
                    ? Number(blockIndex)
                    : undefined
                }
                rtl={docRtl}
                onSelect={(index, text) => {
                  // Tap: toggle in multi mode, else single-select (replace).
                  const ws = useWorkspaceStore.getState();
                  if (ws.multiSelect) ws.toggleBlock(index, text);
                  else ws.selectBlock(index, text);
                }}
                onLongPress={(index, text) =>
                  useWorkspaceStore.getState().addToSelection(index, text)
                }
              />
            </View>
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
      </Animated.View>

      <WorkspaceComposerSheet
        thesisId={thesisId}
        isLiveDoc={isLiveDoc}
        rtl={docRtl}
        animatedPosition={sheetPosition}
        blocks={liveDoc?.blocks ?? []}
        downloadUrl={liveDoc?.downloadUrl}
        documentId={liveDoc?.id}
        onOpenSources={() => useBottomSheet.getState().openSheet("thesis-sources")}
        onOpenOutline={handleOutlineToggle}
        onExport={() => {
          if (liveDoc?.downloadUrl) Linking.openURL(liveDoc.downloadUrl).catch(() => {});
        }}
        onAfterBulkEdit={() => {
          // A bulk delete / start-on-new-page rewrote the .docx — re-fetch so the
          // view (and OnlyOffice config key) reflect the change immediately.
          void refreshDoc();
          void refreshEditorCfg();
        }}
      />

      {/* Sources sheet — self-hides when closed (conditional unmount). */}
      <SourcesSheet thesisId={thesisId} />

      {/* Outline sheet — mounted only while the outline panel is active. */}
      {activePanel === "outline" && <ThesisStructureSheet />}
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
  outlineContent: { paddingVertical: 8 },

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
