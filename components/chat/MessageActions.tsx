import { View, Text, Pressable, Share, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Library,
  ListChecks,
  Maximize2,
  RotateCcw,
  Share2,
  type LucideIcon,
} from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { visualRow } from "@/lib/rtl-layout";

// ─────────────────────────────────────────────────────────────────────────────
// The row under a finished assistant answer.
//
// TWO JOBS, in this order, kept apart by a hairline:
//
//   1. WHERE TO GO — the Writer, the Library, the student's Tasks. Labelled
//      chips, first in the row, because they are why the row is worth its space:
//      these are the app's three destinations and the conversation is its front
//      door. They used to live in the drawer, which put every trip to the
//      document behind a swipe.
//   2. WHAT TO DO WITH THIS ANSWER — share, expand, regenerate. Bare glyphs,
//      after the rule, in the quiet way every assistant app draws them.
//
// The chips are labelled and the glyphs are not, deliberately: an unlabelled
// document icon sitting next to Share reads as one more thing to do to the text
// rather than a place to go.
//
// Copy and read-aloud were here and are gone — the row could not hold eight
// controls on a phone, and between them and the three destinations the
// destinations are what a student reaches for. Sharing still hands over the
// text, which is what copying was mostly used for.
//
// Every control does something REAL. Writer and Tasks are simply ABSENT when
// there is no thesis to open, rather than present and dead.
// ─────────────────────────────────────────────────────────────────────────────

const ICON = 17;
const CHIP_ICON = 13;

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

/**
 * One destination. A STATIC style array — never `style={({pressed}) => …}`,
 * which under the New Architecture can silently apply nothing and leave the chip
 * as a borderless glyph stacked on its own label.
 */
function DestinationChip({
  label,
  icon: Icon,
  onPress,
  rtl,
  colors,
}: {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  rtl: boolean;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.chip, { borderColor: colors.borderDefault, flexDirection: visualRow(rtl) }]}
    >
      <Icon size={CHIP_ICON} color={colors.brandPrimary} strokeWidth={2} />
      <Text style={[styles.chipLabel, { color: colors.textPrimary }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface Props {
  /** The answer's text — what share hands over. */
  text: string;
  /** Direction of THIS message, so the row reads the way the answer does. */
  rtl?: boolean;
  /** Long answers collapse; these drive the inline expand and the full-screen viewer. */
  canExpand?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onViewFull?: () => void;
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
  canRegenerate,
  onRegenerate,
}: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  // The thesis the CONVERSATION is about: the selection follows the thread in
  // both directions (see handlePickThread in app/(app)/chat.tsx), so reading it
  // from the store here is the same document the answer above was written for.
  const thesisId = useThesisStore((s) => s.currentThesisId);
  // This row is also rendered by the floating chat overlay, which can sit ON TOP
  // of the Writer. Offering "Writer" there would push a second copy of the screen
  // the student is already looking at.
  const onWriter = pathname.includes("thesis-workspace");

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
      {/* The three destinations are ONE cluster, tighter inside than the row's
          own gap. Spaced like the glyphs they'd read as three unrelated buttons
          that happen to be adjacent; pulled together they read as the set they
          are — and the whole row then fits a phone on one line. */}
      <View style={[styles.cluster, { flexDirection: visualRow(!!rtl) }]}>
        {!!thesisId && !onWriter && (
          <DestinationChip
            label={t("drawer.writer")}
            icon={FileText}
            rtl={!!rtl}
            colors={colors}
            onPress={() =>
              router.push({ pathname: "/(app)/thesis-workspace", params: { thesisId } } as any)
            }
          />
        )}

        <DestinationChip
          label={t("drawer.library")}
          icon={Library}
          rtl={!!rtl}
          colors={colors}
          onPress={() => router.push("/(app)/library" as any)}
        />

        {!!thesisId && (
          <DestinationChip
            label={t("tasks.title")}
            icon={ListChecks}
            rtl={!!rtl}
            colors={colors}
            onPress={() => router.push({ pathname: "/(app)/tasks", params: { thesisId } } as any)}
          />
        )}
      </View>

      {/* The hairline is what makes the two halves legible as two halves: go
          somewhere, or act on this answer. Always drawn, because the Library is
          always reachable — the other two come and go with the thesis. */}
      <View style={[styles.rule, { backgroundColor: colors.borderSubtle }]} />

      <ActionIcon label={t("chat.share", { defaultValue: "Share" })} onPress={handleShare}>
        <Share2 size={ICON} color={ink} strokeWidth={1.9} />
      </ActionIcon>

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
  // The row WRAPS rather than clipping or scrolling: three labelled chips plus
  // the glyphs outrun a narrow phone, and with the chips first it is the glyphs
  // that fall to the second line — the right way round. rowGap keeps that second
  // line off the one above it.
  row: {
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: 14,
    rowGap: 10,
    marginTop: 10,
    paddingVertical: 2,
  },
  // The chips sit half a row-gap apart. It wraps too, so the cluster degrades on
  // a very narrow phone instead of pushing the row sideways.
  cluster: { alignItems: "center", flexWrap: "wrap", columnGap: 7, rowGap: 8 },
  // Vertical hairline between the two halves. Negative margins against the row's
  // columnGap pull it closer to both sides than two taps ever are, so it reads as
  // a divider rather than as another control.
  rule: { width: StyleSheet.hairlineWidth, height: ICON, marginHorizontal: -4 },
  chip: { alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  chipLabel: { fontSize: 11.5, fontFamily: "Inter_600SemiBold" },
});
