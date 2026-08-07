import { View, Text, StyleSheet, ActivityIndicator, Image } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useWorkingClock } from "@/hooks/useWorkingClock";
import { formatElapsed } from "@/lib/thinking";

const LOGO = require("../assets/icon.png");

export type ProcessingStepStatus = "done" | "active" | "pending";

export interface ProcessingStep {
  key: string;
  label: string;
  status: ProcessingStepStatus;
  /** Right-hand counter for a step that can really count ("3 / 6"). */
  detail?: string;
  /** 0..1 determinate bar. Pass it ONLY when the number is real. */
  progress?: number;
}

interface Props {
  title: string;
  subtitle?: string | null;
  /**
   * `steps` — the job reports which stage it is in, so each row carries a real
   * done/active/pending state.
   * `list` — the job is one opaque server call: a single spinner in the hero and
   * the rows become a plain "what is happening" list. Nothing pretends to tick.
   */
  mode?: "steps" | "list";
  steps: ProcessingStep[];
  /** Closing line under the list — e.g. "keep the app open". */
  note?: string | null;
  /**
   * Anything that changes while the job is alive (a counter, a stage name). The
   * wait line + clock only appear once this has been still for a moment, so a
   * job that is visibly progressing never gets a redundant "still working…".
   */
  liveness?: string;
}

/**
 * The app's shared "this is going to take a while" screen: hero + narrated steps
 * + the working clock. Same language as the plan generator's build screen, but
 * driven by props so any long job can mount it.
 *
 * Every stage it shows is a stage the caller actually knows about. A step never
 * ticks over on a timer — a fake checklist racing ahead of a stalled request is
 * worse than a spinner, because it lies about where the time is going.
 */
export function ProcessingSteps({ title, subtitle, mode = "steps", steps, note, liveness }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  // Same clock the AI surfaces use: it stays quiet while something is visibly
  // moving and escalates its wording the longer the silence runs.
  const clock = useWorkingClock({ active: true, stream: liveness ?? "" });

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {!!subtitle && (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
        {mode === "list" && (
          <ActivityIndicator size="large" color={colors.brandPrimary} style={styles.heroSpinner} />
        )}
      </View>

      <View style={[styles.rule, { backgroundColor: colors.borderSubtle }]} />

      <View style={styles.steps}>
        {steps.map((step) => {
          const muted = mode === "list" || step.status === "pending";
          return (
            <View key={step.key} style={styles.step}>
              <View style={styles.icWrap}>
                {mode === "list" ? (
                  <View style={[styles.bullet, { backgroundColor: colors.borderDefault }]} />
                ) : step.status === "done" ? (
                  <View style={[styles.ic, { backgroundColor: "#22B573" }]}>
                    <Text style={styles.icCheck}>✓</Text>
                  </View>
                ) : step.status === "active" ? (
                  <ActivityIndicator size="small" color={colors.brandPrimary} />
                ) : (
                  <View style={[styles.ic, styles.icPending, { borderColor: colors.borderDefault }]} />
                )}
              </View>

              <View style={styles.stepBody}>
                <View style={styles.stepRow}>
                  <Text
                    style={[
                      styles.stepLabel,
                      {
                        color: muted ? colors.textSecondary : colors.textPrimary,
                        fontFamily:
                          step.status === "active" && mode === "steps"
                            ? "Inter_600SemiBold"
                            : "Inter_400Regular",
                      },
                    ]}
                  >
                    {step.label}
                  </Text>
                  {!!step.detail && (
                    // Counters stay LTR in every locale — "3 / 6" must not reorder
                    // inside an Arabic layout.
                    <Text style={[styles.stepDetail, { color: colors.textSecondary }]}>
                      {step.detail}
                    </Text>
                  )}
                </View>
                {step.progress !== undefined && (
                  <View style={[styles.barBg, { backgroundColor: colors.bgSurface }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          backgroundColor: colors.brandPrimary,
                          width: `${Math.round(Math.min(1, Math.max(0, step.progress)) * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {clock && (
        <View style={styles.clockRow} accessibilityRole="progressbar">
          <Text style={[styles.clockLabel, { color: colors.textSecondary }]}>
            {clock.stage === "veryLong"
              ? t("working.veryLong")
              : clock.stage === "long"
                ? t("working.long")
                : t("working.short")}
          </Text>
          <Text style={[styles.clock, { color: colors.textSecondary }]}>
            {formatElapsed(clock.elapsedMs)}
          </Text>
        </View>
      )}

      {!!note && <Text style={[styles.note, { color: colors.textSecondary }]}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, paddingBottom: 40 },
  hero: { alignItems: "center", gap: 4, marginTop: 12 },
  logo: { width: 52, height: 52, borderRadius: 13 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 6, textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2 },
  heroSpinner: { marginTop: 14 },
  rule: { height: 1, marginVertical: 18 },
  steps: { gap: 14 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icWrap: { width: 22, height: 22, alignItems: "center", justifyContent: "center", marginTop: 1 },
  ic: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  icPending: { borderWidth: 2, backgroundColor: "transparent" },
  icCheck: { color: "#FFFFFF", fontSize: 12, fontFamily: "Inter_700Bold" },
  bullet: { width: 7, height: 7, borderRadius: 3.5 },
  stepBody: { flex: 1, gap: 8 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepLabel: { flex: 1, fontSize: 14 },
  stepDetail: { fontSize: 12, fontVariant: ["tabular-nums"], writingDirection: "ltr" },
  barBg: { height: 4, borderRadius: 2, overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2 },
  clockRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24 },
  clockLabel: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  clock: { fontSize: 11.5, fontVariant: ["tabular-nums"], writingDirection: "ltr" },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 22, lineHeight: 18 },
});
