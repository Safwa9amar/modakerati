import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Keyboard, Platform } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import { useFloatingPillStore } from "@/stores/floating-pill-store";
import { sendMessageToAI, approvePendingAction, declinePendingAction } from "@/lib/ai-service";
import { type DocBlockDTO } from "@/lib/api";
import { ComposerAsk } from "./ComposerAsk";
import { ComposerConfirm } from "./ComposerConfirm";
import { GlobalDockBar } from "./GlobalDockBar";

/** Initial reserved bottom inset (before the bar measures itself). */
export const BLOCK_COMPOSER_MIN_INSET = 150;

interface Props {
  thesisId: string;
  rtl: boolean;
  /** The doc area reserves this many px at the bottom so content clears the
   *  composer at any state (pill / docked bar). Written on every layout. */
  insetValue: SharedValue<number>;
  /** Live-.docx block model — powers the block formatting tools. */
  blocks: DocBlockDTO[];
}

/**
 * The context-aware action zone that replaces the old always-present composer
 * sheet. Its shape follows selection + keyboard state:
 *   • pending confirm / ask → the AI's gate surface (docked).
 *   • a block selected, keyboard UP → the GLOBAL keyboard-docked toolbar
 *     (GlobalDockBar): undo/redo, outline, prev/next block, page break/setup,
 *     thesis-ready + the pinned ✦ Ask AI.
 *   • otherwise → nothing docks here. The floating ✦ bubble (FloatingPill/AIDock)
 *     is the ONLY idle AI surface — there is no bottom fallback bar anymore; if
 *     the bubble was drag-to-X dismissed, the dock's ✦ re-arms it (GlobalDockBar).
 * Positioned absolutely at the container bottom; the parent's KeyboardAvoidingView
 * lifts it above the keyboard, so its own detent/docking math isn't needed.
 */
export function BlockComposer({ thesisId, rtl, insetValue, blocks }: Props) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  // Selection + edit state (primitives / stored refs only — never object literals).
  const selectedBlocks = useWorkspaceStore((s) => s.selectedBlocks);
  const inlineEditing = useWorkspaceStore((s) => s.inlineEditing);
  const composerOpen = useWorkspaceStore((s) => s.composerOpen);
  const composerInputFocused = useWorkspaceStore((s) => s.composerInputFocused);

  const isGenerating = useChatStore((s) => s.isGenerating);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);

  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ——— Selection derivations ———
  const ordered = useMemo(() => [...selectedBlocks].sort((a, b) => a.index - b.index), [selectedBlocks]);
  const indices = useMemo(() => ordered.map((b) => b.index), [ordered]);
  const count = selectedBlocks.length;
  const combinedSelection = useMemo(() => {
    const parts = ordered.map((b) => b.text).filter((x) => x && x.trim());
    if (!parts.length) return undefined;
    const joined = parts.join("\n\n");
    return joined.length > 6000 ? joined.slice(0, 6000) + "…" : joined;
  }, [ordered]);

  // ——— Keyboard tracking ———
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboardVisible(false);
        // Dismissing the keyboard CLOSES the block tool entirely (clears the
        // selection) → back to the idle state, so no floating pill lingers over the
        // vacated keyboard space. On iOS keyboardWillHide fires before the keyboard
        // drops, so the tool closes first ("close the tool before the keyboard").
        // Guarded: never while the block Ask-AI input is up (its keyboard toggles
        // too, and it still needs the block target).
        // Clear when ANY block is selected (not gated on editingBlockIndex — the
        // block's onBlur may have already nulled it before this fires). The keyboard
        // only comes up for paragraph editing / the Ask-AI input, so this only
        // triggers a real dismiss. Never while Ask-AI is up (it needs the target).
        const ws = useWorkspaceStore.getState();
        // Also never while the bubble's dock inline input is up — its keyboard
        // toggles too and it still needs the block target (mirrors askAiOpen above).
        const fp = useFloatingPillStore.getState();
        if (ws.selectedBlocks.length > 0 && !ws.askAiOpen && !fp.inputOpen) {
          if (fp.visible) {
            // Always-on bubble alive: exit inline editing but KEEP the selection —
            // the block's bubble must persist (clearing here flipped the text
            // bubble to the ✦ AI bubble on every keyboard dismiss).
            ws.setEditingBlock(null);
          } else {
            // Legacy fallback (bubble dismissed): old behavior, clear everything.
            ws.clearSelection();
          }
        }
      },
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // AI activity forces the composer visible so its progress/question is seen even
  // if the user had hidden it via the header ⋯ menu.
  useEffect(() => {
    if (isGenerating || pendingAsk || pendingConfirm) useWorkspaceStore.getState().setComposerOpen(true);
  }, [isGenerating, pendingAsk, pendingConfirm]);

  // Whether ANY bottom surface renders (mirrors the surface chain in the render
  // below: confirm > ask > keyboard-docked block bar). A block selected with the
  // keyboard down renders nothing here — its pill floats inline on the block in
  // the outline.
  const blockKeyboardOpen = keyboardVisible && (inlineEditing || composerInputFocused);
  const hasSurface = !!pendingConfirm || !!pendingAsk || blockKeyboardOpen;

  // Collapse the reserved inset imperatively whenever nothing renders at the
  // bottom (hidden via the header ⋯ toggle, or the floating-pill state above).
  // Relying on the host's onLayout(0) alone is not enough: the outgoing surface
  // contains `exiting` animations (send button, category expansion row), so
  // Reanimated keeps the removed subtree alive — and if its removal callback is
  // dropped (flaky on the New Architecture) the 0-height layout never arrives,
  // stranding a tall white paddingBottom under the document.
  useEffect(() => {
    if (!composerOpen || !hasSurface) insetValue.value = 0;
  }, [composerOpen, hasSurface, insetValue]);

  // Mirror for onLayout: measurements that arrive while no surface should be up
  // come from a lingering exiting subtree — ignore them so they can't re-inflate
  // the inset after the effect above zeroed it.
  const hasSurfaceRef = useRef(false);
  hasSurfaceRef.current = composerOpen && hasSurface;

  // Focus payload: combined text + every selected index (empty → whole memoir).
  const focusOpts = {
    selection: combinedSelection,
    docBlockIndex: indices.length ? indices[0] : null,
    docBlockIndices: indices.length > 1 ? indices : undefined,
  };

  const markInputFocused = useCallback(() => useWorkspaceStore.getState().setComposerInputFocused(true), []);
  const markInputBlurred = useCallback(() => {
    useWorkspaceStore.getState().setComposerInputFocused(false);
  }, []);

  const handleAnswer = (answer: string) => {
    useChatStore.getState().setPendingAsk(null);
    void sendMessageToAI(thesisId, answer, focusOpts);
  };

  // The user always has the right to walk away from a question unanswered —
  // the ask lives only in memory, so clearing it is the whole dismissal.
  const handleDismissAsk = () => {
    useChatStore.getState().setPendingAsk(null);
  };

  const handleApprove = () => {
    if (pendingConfirm) void approvePendingAction(thesisId, pendingConfirm.actionId);
  };
  const handleDecline = () => {
    if (pendingConfirm) void declinePendingAction(thesisId, pendingConfirm.actionId);
  };

  if (!composerOpen) return null;

  // Measure whatever surface renders → reserve exactly its height at the doc bottom.
  const onLayout = (h: number) => {
    if (!hasSurfaceRef.current) return;
    insetValue.value = h;
  };

  // Which surface: confirm > ask > keyboard-open block bar. Default null: a block
  // selected with the keyboard DOWN docks nothing here — its formatting pill
  // floats inline on the block in the outline instead. Keep this chain in sync
  // with `hasSurface` above.
  let surface: React.ReactNode = null;
  if (pendingConfirm) {
    surface = (
      <Dock colors={colors} insets={insets} keyboardVisible={keyboardVisible}>
        <ComposerConfirm confirm={pendingConfirm} onApprove={handleApprove} onCancel={handleDecline} rtl={rtl} />
      </Dock>
    );
  } else if (pendingAsk) {
    surface = (
      <Dock colors={colors} insets={insets} keyboardVisible={keyboardVisible}>
        <ComposerAsk ask={pendingAsk} onAnswer={handleAnswer} onDismiss={handleDismissAsk} rtl={rtl} onInputFocus={markInputFocused} onInputBlur={markInputBlurred} />
      </Dock>
    );
  } else if (blockKeyboardOpen) {
    // Keyboard UP → the GLOBAL keyboard-docked toolbar (undo/redo, outline,
    // prev/next block, page break/setup, thesis-ready) + the pinned ✦ Ask AI.
    // Block FORMATTING tools (bold/align/style/…) are product-decision EXCLUDED
    // here — the floating bubble owns those exclusively, keyboard up or down.
    // Keyboard DOWN → nothing docks here: the floating bubble (FloatingPill,
    // screen-level overlay) carries the block tools, so `surface` stays null
    // and the reserved bottom inset collapses (the doc reclaims height).
    surface = <GlobalDockBar thesisId={thesisId} blocks={blocks} />;
  }

  return (
    <View
      style={styles.host}
      pointerEvents="box-none"
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
    >
      {surface}
    </View>
  );
}

// A bottom-docked surface wrapper for the AI gate (ask / confirm).
function Dock({
  children,
  colors,
  insets,
  keyboardVisible,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useThemeColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  keyboardVisible: boolean;
}) {
  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: colors.bgPrimary,
          borderTopColor: colors.borderSubtle,
          paddingBottom: keyboardVisible ? 10 : insets.bottom + 12,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, bottom: 0 },
  dock: {
    paddingHorizontal: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 10,
  },
});
