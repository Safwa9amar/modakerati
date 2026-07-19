import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
} from "react-native";
import Animated, { useSharedValue, useAnimatedStyle } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import * as Device from "expo-device";
import { useTranslation } from "react-i18next";
import { Undo2, Redo2 } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useRibbonStore } from "@/stores/ribbon-store";
import { useChatStore } from "@/stores/chat-store";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { BackButton } from "@/components/BackButton";
import { WordDocxView, type DocTapBlock } from "@/components/workspace/WordDocxView";
import { OnlyOfficeView } from "@/components/workspace/OnlyOfficeView";
import { PdfView } from "@/components/workspace/PdfView";
import { DocBlock } from "@/components/workspace/DocBlock";
import { PaperPage } from "@/components/workspace/PaperPage";
import { DocSkeleton } from "@/components/workspace/DocSkeleton";
import { BlockComposer, BLOCK_COMPOSER_MIN_INSET } from "@/components/workspace/BlockComposer";
import { PreviewButton, PreviewBar } from "@/components/workspace/WorkspacePreview";
import { HeaderMenuButton } from "@/components/workspace/WorkspaceHeaderMenu";
import { OutlineReorderable } from "@/components/workspace/OutlineReorderable";
import { SourcesSheet } from "@/components/workspace/SourcesSheet";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
import { HistorySheet } from "@/components/workspace/HistorySheet";
import {
  getThesisEditorConfig,
  getThesisPdf,
  deleteThesisPdf,
  undoThesisHistory,
  redoThesisHistory,
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
  // The composer (BlockComposer) measures itself and writes its rendered height
  // here; the document area reserves exactly that many px at the bottom so content
  // always clears whichever composer surface is up — the idle AI bar, the floating
  // block pill, or the keyboard-docked bar. The parent's KeyboardAvoidingView
  // already lifts the composer above the keyboard, so this is a plain height.
  const composerInset = useSharedValue(BLOCK_COMPOSER_MIN_INSET);

  // Live-.docx document model, owned by the thesis-doc store so it can be
  // hydrated from the on-device cache (instant open) and edited optimistically.
  // `undefined` while loading; `available:false` once we know the thesis is
  // legacy → fall back to the section render.
  const doc = useThesisDocStore((s) => s.byId[thesisId]);

  // Monotonic reload token, bumped by the store only when the server .docx bytes
  // actually change (a real reconcile — never on an optimistic edit). Appended to
  // the Word view's URL so the docx-preview WebView reliably re-fetches after an
  // edit — the signed download URL can be byte-identical across two fetches in the
  // same second, so relying on it alone leaves a manual edit invisible.
  const docTick = useThesisDocStore((s) => s.tick[thesisId] ?? 0);
  // Bumped when the durable edit queue fully flushes — the .docx bytes (and thus
  // the OnlyOffice document.key / PDF render) changed on the server.
  const drainTick = useThesisDocStore((s) => s.drainTick[thesisId] ?? 0);

  // Undo/redo availability + queue-pending count, for the header history buttons.
  // Select primitives individually (never an object literal — see the store note
  // atop this file's other selectors).
  const canUndo = useThesisDocStore((s) => s.history[thesisId]?.canUndo ?? false);
  const canRedo = useThesisDocStore((s) => s.history[thesisId]?.canRedo ?? false);
  const pendingOps = useThesisDocStore((s) => s.pending[thesisId] ?? 0);

  // OnlyOffice editor config for the live-docx view. `undefined` while loading;
  // `{ enabled:false }` when the Document Server isn't configured (or the fetch
  // failed) → fall back to the docx-preview WordDocxView. When enabled it carries
  // the signed DocEditor config (its `document.key` bumps after each AI turn).
  const [editorCfg, setEditorCfg] = useState<EditorConfigDTO | undefined>(undefined);

  // PDF render of the live .docx (OnlyOffice-converted, fetched lazily only when
  // the user opens the PDF view). `undefined` while (re)converting; the DTO's
  // `available:false` carries why (no Document Server / conversion failed).
  const [pdfDoc, setPdfDoc] = useState<ThesisPdfDTO | undefined>(undefined);

  const previewMode = useWorkspaceStore((s) => s.previewMode);

  // The three live-.docx views stay mounted at once (see the layered doc area), so
  // switching keeps each view's scroll. The PDF is the exception: its render is a
  // costly server conversion, so its layer is mounted LAZILY on first open and then
  // kept warm. These refs track that lifecycle — delete the server render only on
  // screen-leave (not on every switch) and re-convert only when the doc changes.
  const [pdfMounted, setPdfMounted] = useState(false);
  const pdfMountedRef = useRef(false);
  const pdfConvertedRef = useRef(false);
  const pdfVersionRef = useRef<string | undefined>(undefined);

  // Mark this thesis current and pull the freshest copy from the server.
  useEffect(() => {
    if (!thesisId) return;
    useThesisStore.getState().setCurrentThesis(thesisId);
    useThesisStore.getState().refreshThesis(thesisId);
    useWorkspaceStore.getState().setThesis(thesisId);
    return () => {
      // Leaving the workspace → drop the transient PDF render if it was ever
      // converted this session (its layer now stays mounted across preview switches,
      // so keying on the current previewMode would leak it when leaving from another
      // preview).
      if (pdfMountedRef.current) {
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

  // Revalidate the live-.docx block model from the server (best-effort — the store
  // keeps the last-known doc on failure). Used after an AI turn and after bulk
  // edits; the store also revalidates on focus (see below). Manual edits reconcile
  // themselves via the store's optimistic `mutate`, so they don't call this.
  const refreshDoc = useCallback(async () => {
    if (!thesisId) return;
    await useThesisDocStore.getState().revalidate(thesisId);
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

  // Undo/redo are server-side restores. Disabled while queue ops are pending
  // (positional indices would replay against the restored doc) and during an AI
  // turn. Applies via the store's full-reconcile path (tick + drainTick).
  const [historyBusy, setHistoryBusy] = useState(false);
  // Document history sheet — opened via long-press on the header Undo button
  // (avoids a 6th header button). Conditionally mounted per the app's gorhom rule.
  const [historyOpen, setHistoryOpen] = useState(false);
  const runHistory = useCallback(
    async (kind: "undo" | "redo") => {
      if (!thesisId || historyBusy) return;
      setHistoryBusy(true);
      try {
        const res = kind === "undo" ? await undoThesisHistory(thesisId) : await redoThesisHistory(thesisId);
        useThesisDocStore.getState().applyRestoredDoc(thesisId, res.document, { canUndo: res.canUndo, canRedo: res.canRedo });
      } catch (e: any) {
        Alert.alert(t("workspace.historyFailed", { defaultValue: "Couldn't restore the document" }), e?.message ?? "");
      } finally {
        setHistoryBusy(false);
      }
    },
    [thesisId, historyBusy, t],
  );

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

  // Load the document model + editor config on focus. `load` paints instantly from
  // the on-device cache, replays any unsent edit ops, then revalidates from the
  // server in the background — so reopening a thesis (and returning from the block
  // editor) shows content with no spinner while the fresh copy loads behind it.
  useFocusEffect(
    useCallback(() => {
      if (thesisId) void useThesisDocStore.getState().load(thesisId);
      void refreshEditorCfg();
      if (thesisId) void useThesisDocStore.getState().refreshHistoryState(thesisId);
    }, [thesisId, refreshEditorCfg]),
  );

  // When the durable edit queue fully drains, the .docx bytes changed on the
  // server → re-fetch the editor config so the OnlyOffice layer (document.key)
  // and the PDF view (keyed on it) reload the fresh bytes. The outline view
  // already reconciled from the flush response.
  useEffect(() => {
    if (drainTick === 0) return;
    void refreshEditorCfg();
    if (thesisId) void useThesisDocStore.getState().refreshHistoryState(thesisId);
  }, [drainTick, refreshEditorCfg, thesisId]);

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
      if (thesisId) void useThesisDocStore.getState().refreshHistoryState(thesisId);
    }
    prevGenerating.current = isGenerating;
  }, [isGenerating, isLiveDoc, refreshDoc, refreshEditorCfg, thesisId]);

  // Document-version token: the OnlyOffice config's document.key bumps only when
  // the .docx actually changes (it's derived from updatedAt). Keying the PDF
  // fetch on it re-converts after a real edit but not on incidental refreshes.
  const docVersionKey = editorCfg?.enabled ? editorCfg.config?.document?.key : undefined;

  // Mount the PDF layer on first open and keep it warm thereafter (see the layered
  // doc area), so toggling back to it preserves the rendered page and its scroll.
  // Convert only on first open and after a REAL document change (docVersionKey) —
  // never on a mere re-entry, which would reload the WebView and lose the scroll.
  // The render is dropped on screen-leave (cleanup above), not on view switch.
  useEffect(() => {
    if (previewMode !== "pdf" || !isLiveDoc) return;
    if (!pdfMountedRef.current) {
      pdfMountedRef.current = true;
      setPdfMounted(true);
    }
    if (pdfConvertedRef.current && pdfVersionRef.current === docVersionKey) return;
    pdfConvertedRef.current = true;
    pdfVersionRef.current = docVersionKey;
    void refreshPdf();
  }, [previewMode, isLiveDoc, docVersionKey, refreshPdf]);

  const title = thesis?.title ?? "";

  // Reserve exactly the height the sheet covers from the bottom = the live
  // container height − the sheet's live top-edge Y. Tracks every position
  // continuously, so there's never a stale gap when the snap point changes.
  const docAreaStyle = useAnimatedStyle(() => ({
    paddingBottom: composerInset.value,
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
        <DocSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.bgSurface }]}
      edges={[]}
    >
      {/* Keyboard clearance for the composer: shrink this whole region above the
          keyboard (RN's maintained measurement — works on Android edge-to-edge,
          where the window itself never resizes). The composer sheet's container
          shrinks with it, so its detents always land above the keyboard. */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.container}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
        <BackButton />
        <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {/* Undo / redo: server-side history restores. Disabled while queue ops are
            pending (positional indices would replay against the restored doc) or
            while an AI turn is running. */}
        {liveDoc && (
          <>
            <Pressable
              onPress={() => void runHistory("undo")}
              onLongPress={() => setHistoryOpen(true)}
              delayLongPress={400}
              disabled={!canUndo || pendingOps > 0 || historyBusy || isGenerating}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.undo", { defaultValue: "Undo" })}
              style={styles.expandBtn}
            >
              <Undo2
                size={20}
                color={canUndo && pendingOps === 0 && !historyBusy && !isGenerating ? colors.textPrimary : colors.textPlaceholder}
              />
            </Pressable>
            <Pressable
              onPress={() => void runHistory("redo")}
              disabled={!canRedo || pendingOps > 0 || historyBusy || isGenerating}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.redo", { defaultValue: "Redo" })}
              style={styles.expandBtn}
            >
              <Redo2
                size={20}
                color={canRedo && pendingOps === 0 && !historyBusy && !isGenerating ? colors.textPrimary : colors.textPlaceholder}
              />
            </Pressable>
          </>
        )}
        {/* Read-only preview (Word / PDF), live docs only — editing is the Writer. */}
        {liveDoc && <PreviewButton />}
        {/* Secondary actions (Navigator, Focus, Sources, Export, Composer show/hide,
            Maximize) collapsed into a single ⋯ overflow menu to declutter the header. */}
        {liveDoc ? (
          <HeaderMenuButton
            onOpenOutline={handleOutlineToggle}
            onOpenSources={() => useBottomSheet.getState().openSheet("thesis-sources")}
            onExport={() => {
              if (liveDoc.downloadUrl) Linking.openURL(liveDoc.downloadUrl).catch(() => {});
            }}
            onMaximize={() => {
              if (liveDoc.downloadUrl) Linking.openURL(liveDoc.downloadUrl).catch(() => {});
            }}
            downloadUrl={liveDoc.downloadUrl}
          />
        ) : (
          <View style={styles.expandBtn} />
        )}
      </View>

      {/* In-preview toolbar (Word/PDF/close). Renders nothing while writing. */}
      {liveDoc && <PreviewBar />}

      <Animated.View style={[{ flex: 1 }, docAreaStyle]}>
        {doc === undefined ? (
          /* Document model not resolved yet — avoid flashing the legacy render
             (migrated theses can still have section rows) before we know mode.
             Show a paper-style skeleton so loading reads as a document, not a
             blank spinner. */
          <DocSkeleton />
        ) : liveDoc ? (
          /* All three live-.docx views stay MOUNTED at once, stacked as absolute
             layers; only the active one is on top + interactive (the others sit
             behind at opacity 0). Switching views therefore never unmounts a view,
             so each keeps its own scroll position — crucially including the
             OnlyOffice editor, whose in-canvas scroll we can't otherwise read or
             restore. Each layer refreshes after an edit on its own (OnlyOffice via
             a bumped document.key, docx-preview via a silent in-place refresh —
             double-buffered, keeps scroll, no reload — and PDF via a
             re-convert). The wrapper is a normal flex child so it honours the
             animated paddingBottom (reserved for the composer sheet); the absolute
             layers then fill exactly that reserved box. */
          <View style={styles.layerHost}>
            {/* Word-fidelity layer: prefer the OnlyOffice Docs editor (HTML5-canvas,
                OOXML-native → Word-level fidelity); fall back to docx-preview when
                the Document Server isn't configured. Tap-to-target lives in
                WordDocxView (tapping a paragraph/table selects it); OnlyOffice is
                view-only for now — the composer still works (the AI targets blocks
                via find). OnlyOffice only on REAL devices: its heavy WASM/JS editor
                crashes the iOS Simulator's WebContent process (and is unreliable in
                emulators), so simulators/emulators fall back to docx-preview. */}
            <View
              style={[styles.docLayer, previewMode === "docx" ? styles.layerActive : styles.layerHidden]}
              pointerEvents={previewMode === "docx" ? "auto" : "none"}
            >
              {editorCfg === undefined ? (
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
                  url={`${liveDoc.downloadUrl}${liveDoc.downloadUrl.includes("?") ? "&" : "?"}_v=${docTick}`}
                  thesisId={thesisId}
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
                  editable={false}
                  onEditCommit={(index, text) =>
                    void useThesisDocStore.getState().mutate(thesisId, { type: "editText", index, text })
                  }
                  // Backspace-at-offset-0 merge (dispatched by the WebView Backspace handler).
                  onMerge={(prevIndex, curIndex, mergedText) => {
                    const store = useThesisDocStore.getState();
                    void store.mutate(thesisId, { type: "editText", index: prevIndex, text: mergedText });
                    void store.mutate(thesisId, { type: "deleteBlocks", indices: [curIndex] });
                  }}
                  onSplit={(index, before, after) =>
                    void useThesisDocStore
                      .getState()
                      .mutate(thesisId, { type: "splitParagraph", index, before, after })
                  }
                  onEditActiveChange={(active) => useWorkspaceStore.getState().setInlineEditing(active)}
                />
              )}
            </View>

            {/* Outline layer: the same .docx blocks as lightweight editable text on
                white "paper" — native render (no WebView). Tap a block to select it
                for the AI; long-press the grip handle to drag-reorder it. Reads
                liveDoc.blocks (already in the DTO), so no extra fetch. */}
            <View
              style={[styles.docLayer, previewMode === null ? styles.layerActive : styles.layerHidden]}
              pointerEvents={previewMode === null ? "auto" : "none"}
            >
              <OutlineReorderable
                thesisId={thesisId}
                blocks={liveDoc.blocks}
                sections={liveDoc.sections}
                rtl={docRtl}
                paddingBottom={16}
                version={docTick}
              />
            </View>

            {/* PDF layer: the OnlyOffice-rendered PDF of the live .docx in a WebView
                (PDF.js). Read-only deliverable preview; works on simulator too
                (conversion is server-side). Mounted lazily on first open, then kept
                warm so returning preserves its scroll; re-converts only after a real
                edit (see the effect above). */}
            {(pdfMounted || previewMode === "pdf") && (
              <View
                style={[styles.docLayer, previewMode === "pdf" ? styles.layerActive : styles.layerHidden]}
                pointerEvents={previewMode === "pdf" ? "auto" : "none"}
              >
                {pdfDoc === undefined ? (
                  <View style={styles.centered}>
                    <ActivityIndicator size="large" color={colors.brandPrimary} />
                  </View>
                ) : pdfDoc.available ? (
                  <PdfView url={pdfDoc.url} />
                ) : (
                  <View style={styles.centered}>
                    <Text style={styles.emptyText}>
                      {pdfDoc.reason === "failed"
                        ? t("workspace.pdfFailed", { defaultValue: "Couldn't generate the PDF. Please try again." })
                        : t("workspace.pdfUnavailable", { defaultValue: "PDF preview isn't available for this document." })}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        ) : (
          /* Unseeded thesis (no live .docx yet). Structure lives in the document,
             so there's nothing to render until it's seeded — ask the AI to start. */
          <View style={styles.centered}>
            <Text style={styles.emptyText}>
              {t("workspace.empty", { defaultValue: "No content yet." })}
            </Text>
            <Text style={styles.emptyHint}>
              {t("workspace.emptyHint", {
                defaultValue: "Ask the AI in the composer to draft your first section ✨",
              })}
            </Text>
          </View>
        )}
      </Animated.View>

      {/* Context-aware action zone (replaces the old always-present composer sheet):
          whole-memoir AI input when nothing is selected, a block-anchored formatting
          + Ask-AI bar when a block is. Sources / Outline / Export live in the header
          ⋯ menu now, so the composer no longer carries them. */}
      <BlockComposer
        thesisId={thesisId}
        rtl={docRtl}
        insetValue={composerInset}
        blocks={liveDoc?.blocks ?? []}
      />
        </View>
      </KeyboardAvoidingView>

      {/* Sources sheet — self-hides when closed (conditional unmount). */}
      <SourcesSheet thesisId={thesisId} />

      {/* Outline sheet — mounted only while the outline panel is active. */}
      {activePanel === "outline" && <ThesisStructureSheet />}

      {/* Document history sheet — long-press the header Undo button to open.
          Conditionally mounted so it self-presents on mount / dismisses on unmount. */}
      {historyOpen && thesisId && (
        <HistorySheet thesisId={thesisId} onClose={() => setHistoryOpen(false)} />
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
  // Each live-doc view is an absolute layer filling the doc area; they overlap so
  // switching only toggles which is on top + interactive (all stay mounted → each
  // keeps its scroll). Inactive layers sit behind at opacity 0 (the active layer is
  // opaque/full-bleed, so it fully covers them).
  layerHost: { flex: 1 },
  docLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  layerActive: { opacity: 1, zIndex: 1 },
  layerHidden: { opacity: 0, zIndex: 0 },
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
  emptyHint: {
    color: MUTED,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 32,
    lineHeight: 19,
  },
});
