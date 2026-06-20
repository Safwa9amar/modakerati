import { View, Text, StyleSheet } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useChatStore } from "@/stores/chat-store";
import { Sparkles } from "lucide-react-native";

const STEPS = [
  "Analyzing thesis context",
  "Researching relevant sources",
  "Structuring content",
  "Writing paragraphs",
  "Adding citations",
];

export function AIGeneratingOverlay() {
  const colors = useThemeColors();
  const isGenerating = useChatStore((s) => s.isGenerating);
  const step = useChatStore((s) => s.generatingStep);

  if (!isGenerating) return null;

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary + "F0" }]}>
      <View style={[styles.iconBg, { backgroundColor: colors.brandAccent + "1A" }]}>
        <Sparkles size={40} color={colors.brandAccent} strokeWidth={1.5} />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>AI is Writing...</Text>
      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <View key={i} style={styles.stepRow}>
            <View style={[styles.stepDot, { backgroundColor: i <= step ? colors.brandAccent : colors.bgSurface }]} />
            <Text style={[styles.stepText, { color: i <= step ? colors.textPrimary : colors.textSecondary }]}>{s}</Text>
            {i < step && <Text style={[styles.stepDone, { color: colors.brandAccent }]}>Done</Text>}
          </View>
        ))}
      </View>
      <View style={[styles.progressBg, { backgroundColor: colors.bgSurface }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.brandAccent, width: `${progress}%` }]} />
      </View>
      <Text style={[styles.progressText, { color: colors.textSecondary }]}>
        {Math.round(progress)}% complete
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center", padding: 32 },
  iconBg: { width: 100, height: 100, borderRadius: 50, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 24 },
  steps: { width: "100%", gap: 14, marginBottom: 24 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  stepText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  stepDone: { fontSize: 12, fontFamily: "Inter_500Medium" },
  progressBg: { width: "100%", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8 },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
