import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useBottomInset } from "@/hooks/useBottomInset";
import { getSupportGuide } from "@/lib/support-guide-content";

/**
 * "How to write your thesis with Kwill" — the long guide in the Support Center.
 *
 * Read-only prose, so it is a plain scroll of cards like chat-guide.tsx. The one
 * interactive element is the prompt: tapping it copies it, because a prompt the
 * student has to retype by hand on a phone is a prompt they won't use.
 *
 * Copy: a prompt block is a Pressable whose feedback is inline (the glyph turns
 * into a tick for a moment) rather than a toast — a toast over a long scroll
 * hides the very text that was just copied.
 */
export default function SupportGuideScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();
  const bottomInset = useBottomInset(32);

  const guide = getSupportGuide(i18n.language);

  // Which prompt is showing its "copied" state, keyed by the prompt text itself
  // — stable and unique enough here, and it survives no re-ordering because the
  // list is static.
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? null : c)), 1600);
  }, []);

  const Prompt = ({ text }: { text: string }) => {
    const on = copied === text;
    return (
      <Pressable
        onPress={() => copy(text)}
        accessibilityRole="button"
        accessibilityLabel={`${guide.copyLabel}: ${text}`}
      >
        {({ pressed }) => (
          <View
            style={[
              styles.prompt,
              {
                backgroundColor: colors.bgSurface,
                borderColor: on ? colors.brandPrimary : colors.borderSubtle,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <View style={[styles.promptRow, { flexDirection }]}>
              <Text style={[styles.promptText, { color: colors.textPrimary, textAlign }]}>
                {text}
              </Text>
              {on ? (
                <Check size={15} color={colors.brandPrimary} strokeWidth={2.5} />
              ) : (
                <Copy size={15} color={colors.textPlaceholder} strokeWidth={2} />
              )}
            </View>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("support.guide.title", { defaultValue: "Writing guide" })}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lead, { color: colors.textPrimary, textAlign }]}>{guide.lead}</Text>

        {/* ── The build order ─────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, textAlign }]}>
          {guide.orderHeading}
        </Text>
        <Text style={[styles.sectionLead, { color: colors.textSecondary, textAlign }]}>
          {guide.orderLead}
        </Text>

        {guide.stages.map((stage) => (
          <Card key={stage.title} style={styles.card}>
            <Text style={[styles.stageTitle, { color: colors.textPrimary, textAlign }]}>
              {stage.title}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary, textAlign }]}>
              {stage.body}
            </Text>
            <View style={styles.promptWrap}>
              <Prompt text={stage.prompt} />
            </View>
            <View
              style={[
                styles.why,
                { borderColor: colors.borderDefault },
                // The rule sits on the reading-start edge in both directions.
                textAlign === "right"
                  ? { borderRightWidth: 2, paddingRight: 10 }
                  : { borderLeftWidth: 2, paddingLeft: 10 },
              ]}
            >
              <Text style={[styles.whyText, { color: colors.textSecondary, textAlign }]}>
                {stage.why}
              </Text>
            </View>
          </Card>
        ))}

        {/* ── Prompting rules ─────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, textAlign }]}>
          {guide.rulesHeading}
        </Text>
        <Text style={[styles.sectionLead, { color: colors.textSecondary, textAlign }]}>
          {guide.rulesLead}
        </Text>

        {guide.rules.map((rule) => (
          <Card key={rule.title} style={styles.card}>
            <Text style={[styles.itemTitle, { color: colors.textPrimary, textAlign }]}>
              {rule.title}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary, textAlign }]}>
              {rule.body}
            </Text>

            {rule.weak ? (
              <View
                style={[
                  styles.side,
                  { backgroundColor: colors.semanticError + "14", borderColor: colors.semanticError + "40" },
                ]}
              >
                <Text style={[styles.sideLabel, { color: colors.semanticError, textAlign }]}>
                  {guide.weakLabel}
                </Text>
                <Text style={[styles.sideText, { color: colors.textPrimary, textAlign }]}>
                  {rule.weak}
                </Text>
              </View>
            ) : null}

            {rule.strong ? (
              <View
                style={[
                  styles.side,
                  { backgroundColor: colors.semanticSuccess + "14", borderColor: colors.semanticSuccess + "40" },
                ]}
              >
                <Text style={[styles.sideLabel, { color: colors.semanticSuccess, textAlign }]}>
                  {guide.strongLabel}
                </Text>
                <Text style={[styles.sideText, { color: colors.textPrimary, textAlign }]}>
                  {rule.strong}
                </Text>
              </View>
            ) : null}
          </Card>
        ))}

        {/* ── Prompt library ──────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, textAlign }]}>
          {guide.promptsHeading}
        </Text>
        <Text style={[styles.sectionLead, { color: colors.textSecondary, textAlign }]}>
          {guide.promptsLead}
        </Text>

        {guide.promptGroups.map((group) => (
          <View key={group.heading} style={styles.group}>
            <Text style={[styles.groupHeading, { color: colors.textPrimary, textAlign }]}>
              {group.heading}
            </Text>
            {group.prompts.map((p) => (
              <View key={p} style={styles.promptWrap}>
                <Prompt text={p} />
              </View>
            ))}
          </View>
        ))}

        {/* ── Pitfalls ────────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, textAlign }]}>
          {guide.pitfallsHeading}
        </Text>
        <Text style={[styles.sectionLead, { color: colors.textSecondary, textAlign }]}>
          {guide.pitfallsLead}
        </Text>

        {guide.pitfalls.map((p) => (
          <Card key={p.title} style={styles.card}>
            <Text style={[styles.itemTitle, { color: colors.textPrimary, textAlign }]}>
              {p.title}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary, textAlign }]}>{p.body}</Text>
            <View style={[styles.fix, { backgroundColor: colors.bgSurface }]}>
              <Text style={[styles.fixLabel, { color: colors.semanticSuccess, textAlign }]}>
                {guide.fixLabel}
              </Text>
              <Text style={[styles.sideText, { color: colors.textPrimary, textAlign }]}>
                {p.fix}
              </Text>
            </View>
          </Card>
        ))}

        {/* ── Pre-submission checklist ────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, textAlign }]}>
          {guide.checklistHeading}
        </Text>
        <Text style={[styles.sectionLead, { color: colors.textSecondary, textAlign }]}>
          {guide.checklistLead}
        </Text>

        <Card style={styles.card}>
          {guide.checklist.map((line) => (
            <View key={line} style={[styles.checkRow, { flexDirection }]}>
              <View style={[styles.checkBox, { borderColor: colors.brandPrimary }]} />
              <Text style={[styles.checkText, { color: colors.textSecondary, textAlign }]}>
                {line}
              </Text>
            </View>
          ))}
        </Card>

        <Card style={[styles.card, { backgroundColor: colors.bgSurface }]}>
          <Text style={[styles.itemTitle, { color: colors.textPrimary, textAlign }]}>
            {guide.noteHeading}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary, textAlign, marginTop: 6 }]}>
            {guide.note}
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  content: { paddingHorizontal: 20 },
  lead: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, marginBottom: 8 },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 26,
    marginBottom: 6,
  },
  sectionLead: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 12 },
  card: { marginBottom: 12 },
  stageTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  itemTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  promptWrap: { marginTop: 10 },
  prompt: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  promptRow: { alignItems: "flex-start", gap: 10 },
  promptText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  why: { marginTop: 12 },
  whyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  side: { marginTop: 10, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  sideLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  sideText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  group: { marginBottom: 18 },
  groupHeading: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  fix: { marginTop: 12, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  fixLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  checkRow: { alignItems: "flex-start", gap: 10, marginBottom: 12 },
  checkBox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, marginTop: 3 },
  checkText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
});
