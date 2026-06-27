import { View, Pressable, StyleSheet } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Send, Square, Mic } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  onMicPress: () => void;
  onFocus: () => void;
  isGenerating: boolean;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  micLabel: string;
}

/**
 * The composer's input row: a sheet-aware text input with an inline mic and a
 * send button that becomes a Stop button while the AI is generating.
 */
export function ComposerInput({
  value,
  onChangeText,
  onSend,
  onStop,
  onMicPress,
  onFocus,
  isGenerating,
  placeholder,
  sendLabel,
  stopLabel,
  micLabel,
}: Props) {
  const colors = useThemeColors();
  const hasText = value.trim().length > 0;

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.bgInput }]}>
      <BottomSheetTextInput
        style={[styles.input, { color: colors.textPrimary }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        editable={!isGenerating}
        multiline
        maxLength={2000}
      />
      {!isGenerating && (
        <Pressable
          onPress={onMicPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={micLabel}
          style={[styles.micBtn, { backgroundColor: colors.bgSurface }]}
        >
          <Mic size={16} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      )}
      {isGenerating ? (
        <AnimatedPressable
          entering={FadeIn.duration(150)}
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel={stopLabel}
          style={[styles.actionBtn, { backgroundColor: colors.semanticError }]}
        >
          <Square size={13} color="#FFFFFF" fill="#FFFFFF" />
        </AnimatedPressable>
      ) : hasText ? (
        <AnimatedPressable
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(100)}
          onPress={onSend}
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          style={[styles.actionBtn, { backgroundColor: colors.brandPrimary }]}
        >
          <Send size={16} color="#FFFFFF" strokeWidth={2} />
        </AnimatedPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 6,
  },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", maxHeight: 100, paddingVertical: 4 },
  micBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
