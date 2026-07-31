import { StyleSheet } from "react-native";

/** Shared metrics for the dock's three rows. Kept in one place so the header,
 *  ask bar and action row stay on the same rhythm — mirrors bubble-tools/styles.ts. */
export const dockStyles = StyleSheet.create({
  container: { gap: 9 },

  // ── ScopeHeader ──
  header: { alignItems: "center", gap: 7 },
  /** Target phrase. The ONLY part allowed to ellipsize. */
  headerTarget: { flexShrink: 1, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  /** Outcome phrase — never shrinks. On a 375pt phone the header has ~249px of
   *  text room, and "This paragraph · you'll review the change" is already past
   *  it; a single truncating Text eats from the tail, so the outcome — the one
   *  thing this header exists to say — would be the first casualty, and worse in
   *  fr/ar. Keeping it rigid spends the truncation on the target instead. */
  headerOutcome: { flexShrink: 0, fontSize: 11, fontFamily: "Inter_600SemiBold" },
  headerSpacer: { flex: 1 },
  headerBtn: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  // ── AskBar ──
  askBar: { alignItems: "center", gap: 7, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 5, paddingHorizontal: 5 },
  askInput: { flex: 1, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },

  // ── ActionRow ──
  rowScroll: { flexGrow: 0 },
  rowContent: { alignItems: "center", gap: 7, paddingHorizontal: 1 },
  chip: { alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  suggChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  suggChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  /** Reserved slot while suggestions load — same box as a suggestion chip so
   *  nothing shifts when the real one lands. */
  slot: { width: 104, height: 35, borderRadius: 14 },

  dim: { opacity: 0.4 },
});
