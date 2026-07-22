import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, AppState } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { applyThesisOps, getAuthHeader, type DocBlockDTO, type DocumentDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useSettingsStore } from "@/stores/settings-store";
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
// Keep inlined image bytes so figures actually RENDER in the editor, but bound the
// total that crosses the DOM bridge — beyond the budget, drop the dataUri (the node
// falls back to the lazy media URL / placeholder). The server already only inlines
// small figures (<=~200KB each) as dataUri; large ones arrive with hasMedia + no
// dataUri. Deterministic (same input → same output) so the save baseline and the
// editor seed use identical blocks → images never produce spurious ops.
const INLINE_MEDIA_BUDGET = 4 * 1024 * 1024; // ~4MB of base64 across the bridge
function stripMedia(blocks: DocBlockDTO[]): DocBlockDTO[] {
  let budget = INLINE_MEDIA_BUDGET;
  return blocks.map((b) => {
    if (b.kind !== "image" || !b.dataUri) return b;
    if (b.dataUri.length <= budget) { budget -= b.dataUri.length; return b; }
    return { ...b, dataUri: undefined };
  });
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
  // Commands (formatting from the native pill + our own serialize) flow through the
  // shared editor store so BlockContextBar can drive Lexical directly.
  const command = useLexicalEditorStore((s) => s.command);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const pendingSave = useRef(false);
  const wasActive = useRef(active);
  // For anchoring the native pill/AI-dock over the WebView: the editor's absolute
  // screen top + the block's reported in-WebView Y = the block's screen Y.
  const wrapRef = useRef<View>(null);
  const editorTopRef = useRef(0);
  // Dedupe the native selection sync on the SET of spanned block indices (joined),
  // not the anchor index — extending a cross-paragraph selection keeps the same
  // anchor while the set grows, so an anchor-only guard would miss the growth.
  const lastSelKeyRef = useRef<string>("");
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
  // Auth token for loading LARGE figures in the WebView (via <img src>?token=). The
  // server accepts the token query param; refreshed on doc change (freshness).
  const [mediaToken, setMediaToken] = useState("");
  useEffect(() => {
    let alive = true;
    getAuthHeader().then((h) => { if (alive) setMediaToken((h.Authorization ?? "").replace(/^Bearer\s+/, "")); }).catch(() => {});
    return () => { alive = false; };
  }, [doc]);
  // The store's `tick` bumps on every reconcile (setDoc) — including an image edit
  // that keeps the same block count (crop/rotate/replace). Use it as the media
  // cache-buster so an edited figure's URL changes and the WebView <img> refetches.
  const docTick = useThesisDocStore((s) => s.tick[thesisId] ?? 0);
  const media = useMemo(
    () => ({ base: process.env.EXPO_PUBLIC_API_URL ?? "", token: mediaToken, thesisId, version: docTick }),
    [mediaToken, thesisId, docTick],
  );
  // Outline-drawer navigation target (heading tapped in the Structure drawer).
  const scrollTarget = useWorkspaceStore((s) => s.scrollTarget);
  // Persistent highlight for a MULTI-block selection: once the OS text selection is
  // dismissed (e.g. the AI dock opens), keep the chosen blocks visibly marked in the
  // editor. Only for multi-select — a single selected block is the caret/editing case
  // and shouldn't be painted. Primitive subscriptions (no fresh-object selector loop).
  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const multiSelect = useWorkspaceStore((s) => s.multiSelect);
  // Inline-AI: the pending AI proposal (if any) to render as an in-flow node in
  // Lexical. Select the STABLE byIndex ref (a fresh-object selector loops — see
  // the zustand Object.is trap) and derive the proposal in useMemo.
  const byIndex = useSuggestionStore((s) => s.byIndex);
  const range = useSuggestionStore((s) => s.range);
  const suggestion = useMemo(() => {
    const keys = Object.keys(byIndex);
    if (!keys.length) return null;
    const idx = Number(keys[0]);
    const p = byIndex[idx];
    return {
      index: idx,
      original: p.original,
      proposed: p.proposed,
      status: p.status as string,
      instruction: p.instruction,
      label: p.label,
      reasoning: p.reasoning,
      reasoningMs: p.reasoningMs,
    };
  }, [byIndex]);
  // The range proposal (multi-block dynamic rewrite) passed to the editor as an
  // in-flow node covering the whole selected range.
  const rangeSuggestion = useMemo(() => {
    if (!range) return undefined;
    return {
      start: range.start,
      end: range.end,
      originalBlocks: range.originalBlocks,
      original: range.original,
      proposed: range.proposed,
      status: range.status as string,
      instruction: range.instruction,
      reasoning: range.reasoning,
      reasoningMs: range.reasoningMs,
    };
  }, [range]);
  const suggestionActiveRef = useRef(false);
  // Any pending proposal (per-block OR range) suppresses the sync-layer reseed and
  // the auto-save serialize, so the proposal isn't clobbered / serialized mid-flight.
  suggestionActiveRef.current = !!suggestion || !!range;
  // Persistent highlight for a MULTI-block selection: once the OS text selection is
  // dismissed (e.g. the AI dock opens), keep the chosen blocks visibly marked. Only
  // for multi-select, and NOT while a proposal is showing (the cards ARE the focus
  // then, and the range node has replaced those blocks). Primitive subscriptions.
  const highlightIndices = useMemo(
    () =>
      multiSelect && selectedBlocks.length > 1 && !range && Object.keys(byIndex).length === 0
        ? selectedBlocks.map((b) => b.index)
        : [],
    [multiSelect, selectedBlocks, range, byIndex],
  );

  // Approve/reject from the in-editor suggestion node → the native store (its
  // approve dispatches an editText op that flows back through the sync layer).
  const onSuggestAction = useCallback((action: string, text?: string) => {
    const store = useSuggestionStore.getState();
    const keys = Object.keys(store.byIndex);
    if (!keys.length) return;
    const idx = Number(keys[0]);
    if (action === "approve") { useLexicalEditorStore.getState().requestSkipReseed(); store.approve(thesisId, idx); }
    else if (action === "again") void store.again(thesisId, idx);
    else if (action === "edit") { if (text) store.setProposed(idx, text); }
    else store.reject(idx);
  }, [thesisId]);

  // Force-reseed the editor from the current (unchanged) stored doc — used when a
  // range proposal is REJECTED: the server never changed, so restore the editor to
  // the doc (the originals WITH their runs/alignment/direction), which the in-editor
  // plugin can't reconstruct from its plain-text capture.
  const reseedFromCurrentDoc = useCallback(() => {
    const cur = useThesisDocStore.getState().byId[thesisId];
    if (!cur?.available) return;
    const latest = stripMedia(cur.blocks);
    baselineRef.current = latest;
    syncedDocRef.current = cur;
    setReseed({ blocks: latest, nonce: ++reseedNonce.current });
  }, [thesisId]);

  // Approve/reject/again/edit from the in-editor RANGE node → the native store.
  // Approve applies the replace-range (server echoes the doc → the sync layer reseeds
  // it in); reject restores the originals via a reseed from the unchanged doc.
  const onRangeAction = useCallback((action: string, text?: string) => {
    const store = useSuggestionStore.getState();
    if (!store.range) return;
    if (action === "approve") void store.approveRange(thesisId, text);
    else if (action === "again") void store.againRange(thesisId);
    else if (action === "edit") { if (text) store.setRangeProposed(text); }
    else { store.rejectRange(); reseedFromCurrentDoc(); }
  }, [thesisId, reseedFromCurrentDoc]);

  const send = useCallback((type: string, value?: string) => {
    useLexicalEditorStore.getState().dispatch(type, value);
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

  // Tell the shared editor store whether the Lexical Writer is the active surface,
  // so the native pill routes formatting to Lexical (vs the legacy op queue).
  useEffect(() => {
    useLexicalEditorStore.getState().setActive(active);
    return () => useLexicalEditorStore.getState().setActive(false);
  }, [active]);

  // Reflect external edits (native pill/BlockContextBar, AI dock, undo/redo) into
  // Lexical by re-seeding — but never over the user's unsaved typing, and never
  // from our own save (guarded by syncedDocRef).
  useEffect(() => {
    if (!inited.current) { inited.current = true; syncedDocRef.current = doc; return; }
    if (!active || doc === syncedDocRef.current) return;
    // Single-block pill/approve applied the edit IN PLACE — consume the doc change
    // silently (sync baseline/synced) without re-seeding, so it doesn't rebuild every
    // node + scroll away. Checked FIRST so an ordering race can't leave it stuck.
    if (useLexicalEditorStore.getState().consumeSkipReseed()) {
      if (doc?.available) baselineRef.current = stripMedia(doc.blocks);
      syncedDocRef.current = doc;
      return;
    }
    // A DELIBERATE authoritative apply (range-rewrite approve) forces the reseed:
    // bypass the pending-save + proposal guards and CANCEL any stale debounced save,
    // so the applied doc always lands (the pending save would otherwise fire against a
    // stale baseline and revert it). Normal external changes still yield to a pending
    // save / an on-screen proposal.
    const forced = useLexicalEditorStore.getState().consumeForceReseed();
    if (forced) {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; pendingSave.current = false; }
    } else {
      if (saveTimer.current) return;
      if (suggestionActiveRef.current) return;
    }
    if (doc?.available) {
      const latest = stripMedia(doc.blocks);
      baselineRef.current = latest;
      syncedDocRef.current = doc;
      setReseed({ blocks: latest, nonce: ++reseedNonce.current }); // in-place, no remount
    }
  }, [doc, active]);

  // Auto-sync (no manual Save): mirror the native gate — hold while actively
  // editing, then background-flush shortly after the user pauses. (Debounced,
  // because Lexical edits — unlike the durable op-queue — aren't in SQLite, so a
  // pause-save avoids losing work if the app is backgrounded/killed.)
  const scheduleSave = useCallback(() => {
    if (suggestionActiveRef.current) return; // a pending AI proposal is in the editor — don't serialize it
    // Mirror the legacy composing gate: while editing we DON'T periodically flush
    // (a per-pause API call is what flooded the server) — everything persists in
    // ONE batched /ops call on leave/background. Only the explicit "sync while
    // editing" setting re-enables the periodic flush.
    if (!useSettingsStore.getState().syncWhileEditing) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; pendingSave.current = true; send("serialize"); }, 1500);
  }, [send]);

  // Bridge Lexical's selection to the NATIVE tools + report the block's live format
  // (so the pill's Bold/H2/RTL/centered highlights match the caret) + schedule sync.
  const onState = useCallback((s: LexicalState) => {
    scheduleSave();
    if (s.index < 0) return;
    useLexicalEditorStore.getState().setFormat({
      bold: s.bold, italic: s.italic, underline: s.underline,
      blockType: s.blockType, isRTL: s.isRTL, alignment: s.alignment,
    });
    focusRef.current = { index: s.index, y: typeof s.y === "number" ? s.y : 0 };
    // Sync Lexical's selection to the native multi-block model. A cross-paragraph
    // drag reports EVERY spanned block (s.blocks) so the pill + AI dock target the
    // whole set (Summarize/Improve/… then act on all of them); a caret or in-block
    // selection reports one → single-select (keeps the inline-suggestion path).
    const spanned = s.blocks && s.blocks.length ? s.blocks : [{ index: s.index, text: s.text }];
    const selKey = spanned.map((b) => b.index).join(",");
    if (selKey !== lastSelKeyRef.current) {
      lastSelKeyRef.current = selKey;
      const ws = useWorkspaceStore.getState();
      if (spanned.length > 1) ws.setSelection(spanned, true);
      else ws.selectBlock(spanned[0].index, spanned[0].text);
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
          rangeSuggestion={rangeSuggestion}
          onRangeAction={onRangeAction}
          selectedIndices={highlightIndices}
          media={media}
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
  saveRow: { position: "absolute", top: 8, right: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  banner: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  bannerText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  saveBtn: { minWidth: 64, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 4 },
  saveText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
