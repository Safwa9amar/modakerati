import { useEffect, useRef, useState } from "react";
import { View, Pressable, Share, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize2,
  RotateCcw,
  Share2,
  Square,
  Volume2,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { visualRow } from "@/lib/rtl-layout";

// ─────────────────────────────────────────────────────────────────────────────
// The row of affordances under a finished assistant answer.
//
// ICONS ONLY, on the page itself — no labels, no framing box, no separator. The
// previous version was a bordered strip of icon+text pairs inside the bubble,
// and at three or four actions it took more vertical space than a short answer
// did. What the reader wants from an answer is the answer; these are the quiet
// second row, the same way every assistant app does it.
//
// Every icon here does something REAL. There is no thumbs-up/down pair, because
// nothing server-side records one yet and a button that swallows the tap is
// worse than no button.
// ─────────────────────────────────────────────────────────────────────────────

// How long the copy button stays a ✓ before returning to the copy glyph.
const COPIED_MS = 1600;
const ICON = 17;

/** One borderless icon button. Generous hit slop — the glyphs are small. */
function ActionIcon({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </Pressable>
  );
}

interface Props {
  /** The answer's text — what copy and share hand over. */
  text: string;
  /** Direction of THIS message, so the row reads the way the answer does. */
  rtl?: boolean;
  /** Long answers collapse; these drive the inline expand and the full-screen viewer. */
  canExpand?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onViewFull?: () => void;
  canSpeak?: boolean;
  isSpeaking?: boolean;
  onSpeak?: () => void;
  canRegenerate?: boolean;
  onRegenerate?: () => void;
}

export function MessageActions({
  text,
  rtl,
  canExpand,
  expanded,
  onToggleExpand,
  onViewFull,
  canSpeak,
  isSpeaking,
  onSpeak,
  canRegenerate,
  onRegenerate,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The ✓ is on a timer, and a message can leave the list (thread switch,
  // regenerate) before it fires — clear it or the setState lands on a gone row.
  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      return; // nothing was copied — don't claim otherwise
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  async function handleShare() {
    try {
      // The share SHEET, not a file: an answer is text, and the student is
      // usually sending it to a supervisor in whatever app they already use.
      await Share.share({ message: text });
    } catch {
      // Dismissed, or no share target. Nothing to say.
    }
  }

  const ink = colors.textSecondary;

  return (
    <View style={[styles.row, { flexDirection: visualRow(!!rtl) }]}>
      <ActionIcon
        label={copied ? t("chat.copied", { defaultValue: "Copied" }) : t("chat.copy", { defaultValue: "Copy" })}
        onPress={handleCopy}
      >
        {copied ? (
          <Check size={ICON} color={colors.semanticSuccess} strokeWidth={2.2} />
        ) : (
          <Copy size={ICON} color={ink} strokeWidth={1.9} />
        )}
      </ActionIcon>

      <ActionIcon label={t("chat.share", { defaultValue: "Share" })} onPress={handleShare}>
        <Share2 size={ICON} color={ink} strokeWidth={1.9} />
      </ActionIcon>

      {canSpeak && (
        <ActionIcon
          label={isSpeaking ? t("chat.stopAudio", { defaultValue: "Stop" }) : t("chat.listen", { defaultValue: "Listen" })}
          onPress={() => onSpeak?.()}
        >
          {isSpeaking ? (
            <Square size={ICON - 3} color={ink} strokeWidth={2} fill={ink} />
          ) : (
            <Volume2 size={ICON} color={ink} strokeWidth={1.9} />
          )}
        </ActionIcon>
      )}

      {canExpand && (
        <>
          <ActionIcon
            label={expanded ? t("chat.showLess", { defaultValue: "Show less" }) : t("chat.viewMore", { defaultValue: "View more" })}
            onPress={() => onToggleExpand?.()}
          >
            {expanded ? (
              <ChevronUp size={ICON + 1} color={ink} strokeWidth={1.9} />
            ) : (
              <ChevronDown size={ICON + 1} color={ink} strokeWidth={1.9} />
            )}
          </ActionIcon>
          <ActionIcon label={t("chat.viewFull", { defaultValue: "View full" })} onPress={() => onViewFull?.()}>
            <Maximize2 size={ICON - 1} color={ink} strokeWidth={1.9} />
          </ActionIcon>
        </>
      )}

      {canRegenerate && (
        <ActionIcon label={t("chat.regenerate", { defaultValue: "Regenerate" })} onPress={() => onRegenerate?.()}>
          <RotateCcw size={ICON} color={ink} strokeWidth={1.9} />
        </ActionIcon>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Wide gaps: these are separate taps, not a toolbar, and the icons carry no
  // labels to keep them apart.
  row: { alignItems: "center", columnGap: 22, marginTop: 10, paddingVertical: 2 },
});
