import { useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { ChevronRight } from "lucide-react-native";

/**
 * Counts the proposals from a scheduled run down to zero and jumps to the next,
 * so none is missed by scrolling past it. Renders nothing when there are none —
 * this is the only thing that says "you still have work waiting" while the
 * student is inside the document.
 *
 * Deliberately holds no list of its own: it reads the same byIndex the cards
 * render from, so accepting one anywhere updates the count for free.
 */
export function ProposalStepper({ onJump }: { onJump: (index: number) => void }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();
  const byIndex = useSuggestionStore((s) => s.byIndex);

  // Only cards that came from a task — a live "rewrite this for me" ask is not
  // part of a run and must not be counted into it.
  const indices = useMemo(
    () =>
      Object.values(byIndex)
        .filter((c) => !!c.proposalId)
        .map((c) => c.index)
        .sort((a, b) => a - b),
    [byIndex],
  );

  // Where the last tap landed, so tapping again moves ON rather than fighting to
  // stay on the first one. Approving removes an index from the list, which walks
  // the student forward on its own; this is for reading past one undecided.
  const lastRef = useRef<number | null>(null);
  const jumpNext = () => {
    const last = lastRef.current;
    const next = (last == null ? undefined : indices.find((i) => i > last)) ?? indices[0];
    lastRef.current = next;
    onJump(next);
  };

  if (indices.length === 0) return null;

  return (
    <View
      style={[
        styles.pill,
        { flexDirection, backgroundColor: colors.bgCard, borderColor: colors.semanticWarning },
      ]}
    >
      <Text style={[styles.count, { color: colors.semanticWarning }]}>{indices.length}</Text>
      <Text numberOfLines={1} style={[styles.label, { color: colors.textPrimary }]}>
        {t("tasks.waitingForYou")}
      </Text>
      <Pressable
        onPress={jumpNext}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("tasks.reviewNext")}
        style={[styles.next, { flexDirection, borderColor: colors.borderDefault }]}
      >
        <Text style={{ color: colors.brandPrimary, fontSize: 12, fontWeight: "600" }}>
          {t("tasks.reviewNext")}
        </Text>
        <ChevronRight size={14} color={colors.brandPrimary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  count: { fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { fontSize: 13, flex: 1 },
  next: {
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
});
