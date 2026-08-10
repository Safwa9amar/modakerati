import { useTranslation } from "react-i18next";
import { Image, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

// The welcome artwork. Swap this one line for the robot illustration once it is
// saved to assets/ — everything below is sized off the image's own aspect ratio,
// so a different picture needs no other change.
const WELCOME_ART = require("../../assets/welcome-chat-avatar.png");

/**
 * What an empty conversation shows instead of nothing.
 *
 * This replaced a fake assistant message that ai-service used to insert. That
 * bubble looked like the model had spoken before the student said anything, and
 * it sat in the transcript as a real message — it could be read aloud,
 * regenerated, and counted toward "has history". A rendered empty state says the
 * same thing without pretending to be part of the conversation.
 */
export function ChatWelcome() {
  const { t } = useTranslation();
  const colors = useThemeColors();

  return (
    <View style={styles.wrap}>
      {/* Copy sits ABOVE the art: the student reads what this can do for them
          first, and the illustration is the warm full stop, not the headline. */}
      <Image source={WELCOME_ART} style={styles.art} resizeMode="contain" accessibilityRole="image" />

      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {t("chat.welcome.body")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred in whatever space the empty list leaves, with generous side padding
  // so the copy never runs edge to edge on a small phone.
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 23, textAlign: "center" },
  art: { width: 200, height: 200 },
});
