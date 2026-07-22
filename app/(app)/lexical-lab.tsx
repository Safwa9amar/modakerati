import { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import LexicalDomEditor, { type LexicalCommand, type LexicalState } from "@/components/workspace/lexical/LexicalDomEditor";
import { LexicalBubble } from "@/components/workspace/lexical/LexicalBubble";

// SPIKE screen: test the Lexical rich-text editor (in an Expo DOM component)
// driven by our native bubble. Isolated from the thesis doc/op-queue — reached
// from Settings → Developer → Lexical Lab (dev builds only).
export default function LexicalLabScreen() {
  const colors = useThemeColors();
  const [active, setActive] = useState<LexicalState>({
    bold: false,
    italic: false,
    underline: false,
    blockType: "paragraph",
    isRTL: false,
    index: -1,
    text: "",
  });
  const [command, setCommand] = useState<LexicalCommand | null>(null);
  const nonce = useRef(0);

  // Native bubble → Lexical. The parent stamps the nonce so a repeated tap of the
  // same button still re-fires the command across the async DOM bridge.
  const send = useCallback((type: string, value?: string) => {
    setCommand({ type, value, nonce: ++nonce.current } as LexicalCommand);
  }, []);

  // Lexical → native bubble (active formats). Stable identity so the DOM bridge's
  // update-listener effect doesn't re-subscribe every render.
  const onState = useCallback((s: LexicalState) => setActive(s), []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Lexical Lab</Text>
        <View style={{ width: 30 }} />
      </View>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Native bubble ⇄ Lexical (Expo DOM component) · spike, not wired to the thesis
      </Text>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.editorWrap, { borderColor: colors.borderSubtle }]}>
          <LexicalDomEditor
            command={command}
            onState={onState}
            dom={{
              style: { flex: 1 },
              scrollEnabled: true,
              keyboardDisplayRequiresUserAction: false,
              hideKeyboardAccessoryView: true,
            }}
          />
        </View>
        <LexicalBubble active={active} onCommand={send} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", paddingHorizontal: 20, paddingBottom: 8 },
  editorWrap: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
});
