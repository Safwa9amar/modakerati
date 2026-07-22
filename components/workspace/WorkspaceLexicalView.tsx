import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, AppState } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { applyThesisOps, type DocBlockDTO, type DocumentDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { planOps, tally } from "@/lib/lexical-writeback";

// PHASE 1 of the in-workspace Lexical editor: a real editing surface (Lexical in an
// Expo DOM component) over the live thesis, saving through the batch /ops endpoint
// (one call per Save). It renders as a NON-DESTRUCTIVE additional workspace layer —
// the native Writer, bubble/pill, outline drawer, auto-scroll and inline-AI all stay
// intact and unchanged. Bridging those legacy features TO Lexical (shared selection,
// outline nav, inline suggestions) is Phase 2+. For now the editor carries its own
// native formatting pill (LexicalBubble) and a Save action.

// Drop heavy base64 image bytes before crossing the DOM bridge — the editor shows
// image placeholders (fine for text editing) and, because the baseline uses the
// SAME stripped blocks, images produce no ops on save (the server keeps their bytes).
function stripMedia(blocks: DocBlockDTO[]): DocBlockDTO[] {
  return blocks.map((b) => (b.kind === "image" && b.dataUri ? { ...b, dataUri: undefined } : b));
}

export function WorkspaceLexicalView({
  thesisId,
  blocks,
  rtl,
  active,
}: {
  thesisId: string;
  blocks: DocBlockDTO[];
  rtl: boolean;
  active: boolean;
}) {
  const colors = useThemeColors();
  const baselineRef = useRef<DocBlockDTO[]>(stripMedia(blocks));
  const [seed, setSeed] = useState<DocBlockDTO[]>(baselineRef.current);
  const [seedNonce, setSeedNonce] = useState(0);
  // In-place reconcile trigger (surgical reseed — no remount) for external edits.
  const [reseed, setReseed] = useState<{ blocks: DocBlockDTO[]; nonce: number } | undefined>(undefined);
  const reseedNonce = useRef(0);
  const [command, setCommand] = useState<LexicalCommand | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const nonce = useRef(0);
  const pendingSave = useRef(false);
  const wasActive = useRef(active);
  // For anchoring the native pill/AI-dock over the WebView: the editor's absolute
  // screen top + the block's reported in-WebView Y = the block's screen Y.
  const wrapRef = useRef<View>(null);
  const editorTopRef = useRef(0);
  const lastIndexRef = useRef(-1);
  // Focused block index + its in-WebView Y — used to overlay the inline-AI suggestion.
  const focusRef = useRef<{ index: number; y: number }>({ index: -1, y: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  // SYNC LAYER (block model → Lexical): subscribe to this thesis's doc in the
  // store. When it changes because of something OTHER than our own save — the
  // native pill/BlockContextBar, the AI dock (Ask/Improve/Translate), undo/redo —
  // re-seed Lexical so those edits show up here too. `syncedDocRef` tracks the doc
  // Lexical currently matches, so our own save (setDoc) never triggers a reseed.
  const doc = useThesisDocStore((s) => s.byId[thesisId]);
  const syncedDocRef = useRef<DocumentDTO | undefined>(undefined);
  const inited = useRef(false);
  // Outline-drawer navigation target (heading tapped in the Structure drawer).
  const scrollTarget = useWorkspaceStore((s) => s.scrollTarget);
  // Inline-AI: the pending AI proposal (if any) to render as an in-flow node in
  // Lexical. Select the STABLE byIndex ref (a fresh-object selector loops — see
  // the zustand Object.is trap) and derive the proposal in useMemo.
  const byIndex = useSuggestionStore((s) => s.byIndex);
  const suggestion = useMemo(() => {
    const keys = Object.keys(byIndex);
    if (!keys.length) return null;
    const idx = Number(keys[0]);
    const p = byIndex[idx];
    return { index: idx, original: p.original, proposed: p.proposed, status: p.status as string };
  }, [byIndex]);
  const suggestionActiveRef = useRef(false);
  suggestionActiveRef.current = !!suggestion;

  // Approve/reject from the in-editor suggestion node → the native store (its
  // approve dispatches an editText op that flows back through the sync layer).
  const onSuggestAction = useCallback((action: string) => {
    const store = useSuggestionStore.getState();
    const keys = Object.keys(store.byIndex);
    if (!keys.length) return;
    const idx = Number(keys[0]);
    if (action === "approve") store.approve(thesisId, idx);
    else store.reject(idx);
  }, [thesisId]);

  const send = useCallback((type: string, value?: string) => {
    setCommand({ type, value, nonce: ++nonce.current } as LexicalCommand);
  }, []);
  const flushNow = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    pendingSave.current = true;
    send("serialize");
  }, [send]);

  // Re-seed from the latest server truth when the user ENTERS the Lexical view (so
  // it reflects edits made elsewhere), but never mid-session (that would clobber the
  // user's in-progress edits).
  useEffect(() => {
    if (active && !wasActive.current) {
      const cur = useThesisDocStore.getState().byId[thesisId];
      const latest = cur?.available ? stripMedia(cur.blocks) : stripMedia(blocks);
      baselineRef.current = latest;
      setSeed(latest);
      setSeedNonce((n) => n + 1);
      syncedDocRef.current = cur;
    } else if (!active && wasActive.current) {
      flushNow(); // leaving the Writer (e.g. opening a preview) → flush edits
    }
    wasActive.current = active;
  }, [active, thesisId, blocks, flushNow]);

  // App going to background = the user stopped composing → flush (no local
  // durability for Lexical edits, so this matters).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st !== "active" && activeRef.current) flushNow();
    });
    return () => sub.remove();
  }, [flushNow]);

  // Reflect external edits (native pill/BlockContextBar, AI dock, undo/redo) into
  // Lexical by re-seeding — but never over the user's unsaved typing, and never
  // from our own save (guarded by syncedDocRef).
  useEffect(() => {
    if (!inited.current) { inited.current = true; syncedDocRef.current = doc; return; }
    if (!active || doc === syncedDocRef.current || saveTimer.current || suggestionActiveRef.current) return;
    if (doc?.available) {
      const latest = stripMedia(doc.blocks);
      baselineRef.current = latest;
      setReseed({ blocks: latest, nonce: ++reseedNonce.current }); // in-place, no remount
      syncedDocRef.current = doc;
    }
  }, [doc, active]);

  // Auto-sync (no manual Save): mirror the native gate — hold while actively
  // editing, then background-flush shortly after the user pauses. (Debounced,
  // because Lexical edits — unlike the durable op-queue — aren't in SQLite, so a
  // pause-save avoids losing work if the app is backgrounded/killed.)
  const scheduleSave = useCallback(() => {
    if (suggestionActiveRef.current) return; // a pending AI proposal is in the editor — don't serialize it
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; pendingSave.current = true; send("serialize"); }, 1500);
  }, [send]);

  // Bridge Lexical's selection to the NATIVE tools + schedule a background sync.
  const onState = useCallback((s: LexicalState) => {
    scheduleSave();
    if (s.index < 0) return;
    focusRef.current = { index: s.index, y: typeof s.y === "number" ? s.y : 0 };
    if (s.index !== lastIndexRef.current) {
      lastIndexRef.current = s.index;
      useWorkspaceStore.getState().selectBlock(s.index, s.text);
    }
    if (typeof s.y === "number" && s.y >= 0) {
      useFloatingPillStore.getState().setAnchorY(editorTopRef.current + s.y);
    }
  }, [scheduleSave]);

  const onBlocks = useCallback(async (serialized: DocBlockDTO[]) => {
    if (!pendingSave.current) return;
    pendingSave.current = false;
    const { ops } = planOps(baselineRef.current, serialized);
    if (ops.length === 0) return; // nothing changed — stay silent (auto-save runs on every pause)
    setSaving(true);
    setBanner("Syncing…");
    try {
      const res = await applyThesisOps(thesisId, ops); // ONE batch call
      if (res.document) {
        useThesisDocStore.getState().setDoc(thesisId, res.document);
        syncedDocRef.current = res.document; // our own change — don't reseed from it
        if (res.document.available) baselineRef.current = stripMedia(res.document.blocks);
      }
      setBanner(`Saved · ${tally(ops)}${res.skipped?.length ? ` (${res.skipped.length} skipped)` : ""}`);
    } catch {
      setBanner("Save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setBanner(null), 2600);
    }
  }, [thesisId]);

  return (
    <View
      style={styles.container}
      ref={wrapRef}
      onLayout={() => wrapRef.current?.measureInWindow((_x, y) => { editorTopRef.current = y; })}
    >
      <View style={styles.editorWrap}>
        <LexicalDomEditor
          key={`ws:${thesisId}:${seedNonce}`}
          initialBlocks={seed}
          command={command}
          onState={onState}
          onBlocks={onBlocks}
          reseed={reseed}
          scrollToIndex={scrollTarget ? { index: scrollTarget.index, nonce: scrollTarget.nonce } : undefined}
          suggestion={suggestion ?? undefined}
          onSuggestAction={onSuggestAction}
          dom={{ style: { flex: 1 }, scrollEnabled: true, keyboardDisplayRequiresUserAction: false, hideKeyboardAccessoryView: true }}
        />
        {/* Auto-save status (no manual button — background sync on pause / exit). */}
        {banner ? (
          <View style={styles.saveRow} pointerEvents="none">
            <View style={[styles.banner, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
              <Text style={[styles.bannerText, { color: colors.textSecondary }]}>{banner}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  editorWrap: { flex: 1, position: "relative" },
  // Covers the suggested block on the paper with the native inline-suggestion UI.
  sugOverlay: { position: "absolute", left: 0, right: 0, paddingHorizontal: 12, backgroundColor: "#ffffff" },
  saveRow: { position: "absolute", top: 8, right: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  banner: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  bannerText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  saveBtn: { minWidth: 64, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 4 },
  saveText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
