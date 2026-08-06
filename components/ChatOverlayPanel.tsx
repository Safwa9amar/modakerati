import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useChatHead } from "@/stores/chat-head-store";
import { ThesisChat } from "@/app/(app)/chat";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  thesisId: string;
  thesisTitle: string;
}

/**
 * The dim backdrop + near-fullscreen chat panel showing the full thesis-chat
 * thread. Visibility is driven entirely by the `useChatHead` store
 * (`expanded`/`close`), so a caller can open it via
 * `useChatHead.getState().open()` without owning any panel state itself.
 * Extracted out of `ChatHead` so future entry points can reuse it.
 */
export function ChatOverlayPanel({ thesisId, thesisTitle }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const expanded = useChatHead((s) => s.expanded);
  const close = useChatHead((s) => s.close);

  if (!expanded) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <AnimatedPressable
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(160)}
        onPress={close}
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("common.close", { defaultValue: "Close" })}
      />
      <Animated.View
        entering={ZoomIn.duration(220)}
        exiting={ZoomOut.duration(180)}
        style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderDefault }]}
      >
        <ThesisChat thesisId={thesisId} thesisTitle={thesisTitle} variant="overlay" onClose={close} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  panel: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
