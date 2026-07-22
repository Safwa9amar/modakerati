import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { LexicalBubble } from "@/components/workspace/lexical/LexicalBubble";
import { applyThesisOps, type DocBlockDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
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
  const [activeFmt, setActiveFmt] = useState<LexicalState>({ bold: false, italic: false, underline: false, blockType: "paragraph", isRTL: false, index: -1, text: "" });
  const [command, setCommand] = useState<LexicalCommand | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const nonce = useRef(0);
  const pendingSave = useRef(false);
  const wasActive = useRef(active);

  // Re-seed from the latest server truth when the user ENTERS the Lexical view (so
  // it reflects edits made elsewhere), but never mid-session (that would clobber the
  // user's in-progress edits).
  useEffect(() => {
    if (active && !wasActive.current) {
      const doc = useThesisDocStore.getState().byId[thesisId];
      const latest = doc?.available ? stripMedia(doc.blocks) : stripMedia(blocks);
      baselineRef.current = latest;
      setSeed(latest);
      setSeedNonce((n) => n + 1);
    }
    wasActive.current = active;
  }, [active, thesisId, blocks]);

  const send = useCallback((type: string, value?: string) => {
    setCommand({ type, value, nonce: ++nonce.current } as LexicalCommand);
  }, []);
  const onState = useCallback((s: LexicalState) => setActiveFmt(s), []);

  const onBlocks = useCallback(async (serialized: DocBlockDTO[]) => {
    if (!pendingSave.current) return;
    pendingSave.current = false;
    const { ops, unsupported } = planOps(baselineRef.current, serialized);
    if (ops.length === 0) {
      setBanner(unsupported.length ? "No saveable changes" : "Saved · no changes");
      setTimeout(() => setBanner(null), 2000);
      return;
    }
    setSaving(true);
    try {
      const res = await applyThesisOps(thesisId, ops); // ONE batch call
      if (res.document) {
        useThesisDocStore.getState().setDoc(thesisId, res.document);
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

  const doSave = useCallback(() => {
    if (saving) return;
    pendingSave.current = true;
    send("serialize");
  }, [saving, send]);

  return (
    <View style={styles.container}>
      <View style={styles.editorWrap}>
        <LexicalDomEditor
          key={`ws:${thesisId}:${seedNonce}`}
          initialBlocks={seed}
          command={command}
          onState={onState}
          onBlocks={onBlocks}
          dom={{ style: { flex: 1 }, scrollEnabled: true, keyboardDisplayRequiresUserAction: false, hideKeyboardAccessoryView: true }}
        />
        {/* Save action + status, floating over the editor. */}
        <View style={styles.saveRow} pointerEvents="box-none">
          {banner ? (
            <View style={[styles.banner, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
              <Text style={[styles.bannerText, { color: colors.textSecondary }]}>{banner}</Text>
            </View>
          ) : null}
          <Pressable onPress={doSave} disabled={saving} style={[styles.saveBtn, { backgroundColor: colors.brandPrimary }]}>
            {saving ? <ActivityIndicator color={colors.bgPrimary} size="small" /> : <Text style={[styles.saveText, { color: colors.bgPrimary }]}>Save</Text>}
          </Pressable>
        </View>
      </View>
      <LexicalBubble active={activeFmt} onCommand={send} />
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
