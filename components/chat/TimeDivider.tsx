import { Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";

// A conversation runs for weeks. Without a stamp, a reply written this afternoon
// sits flush against one from a fortnight ago and reads as the same sitting —
// which matters here, because the answer usually refers to a document the
// student has edited many times since.
//
// One stamp per SITTING, not per message: below this gap the messages belong to
// the same exchange and a timestamp between every turn is noise.
const GAP_MS = 30 * 60 * 1000;

/**
 * Whether `iso` opens a new sitting and so deserves a stamp above it. The first
 * message in the list always does.
 *
 * An unparseable date answers false — a wrong stamp is worse than none, and
 * optimistic rows are written with a real ISO string anyway.
 */
export function shouldShowTime(prevIso: string | undefined, iso: string): boolean {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  if (!prevIso) return true;
  const prev = Date.parse(prevIso);
  if (!Number.isFinite(prev)) return true;
  return at - prev > GAP_MS;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * "Today 3:51 PM" / "Yesterday 9:04 AM" / "12 Aug 9:04 AM", in the app's
 * language — `toLocaleTimeString` handles the 12/24-hour convention and the
 * digits (Arabic renders its own), which is exactly the part worth not
 * hand-rolling.
 */
function formatStamp(iso: string, lang: string, today: string, yesterday: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  const now = new Date();
  const time = d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" });

  if (dayKey(d) === dayKey(now)) return `${today} ${time}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return `${yesterday} ${time}`;
  return `${d.toLocaleDateString(lang, { day: "numeric", month: "short" })} ${time}`;
}

/** The centred, muted stamp that opens a sitting. */
export function TimeDivider({ iso }: { iso: string }) {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const label = formatStamp(
    iso,
    i18n.language,
    t("chat.today", { defaultValue: "Today" }),
    t("chat.yesterday", { defaultValue: "Yesterday" }),
  );
  if (!label) return null;
  return (
    <Text style={[styles.stamp, { color: colors.textSecondary }]} accessibilityRole="header">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Centred rather than aligned to either edge: it belongs to both speakers.
  stamp: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 8, marginBottom: 6 },
});
