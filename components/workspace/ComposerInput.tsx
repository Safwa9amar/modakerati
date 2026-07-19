import { useState, useEffect } from "react";
import { View, Pressable, StyleSheet } from "react-native";
// Deliberately NOT BottomSheetTextInput: registering the input activates gorhom's
// own keyboard repositioning, which fights the sheet's manual keyboard docking
// (see WorkspaceComposerSheet). A plain gesture-handler TextInput keeps gorhom's
// keyboard machinery inert while still cooperating with the sheet's pan gesture.
import { TextInput } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Send, Square, Mic } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Composer auto-grow bounds (one line … ~6 lines, then it scrolls internally).
// Belt-and-suspenders so it grows whichever mechanism the New Architecture honors:
// minHeight/maxHeight bound the intrinsic auto-sizing, and onContentSizeChange drives
// an explicit height when that event fires. Height stays unset until measured, so if
// the event never fires the intrinsic path still governs (never pinned to one line).
const INPUT_MIN_HEIGHT = 28;
const INPUT_MAX_HEIGHT = 120;

interface Props {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  onMicPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
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
  onBlur,
  isGenerating,
  placeholder,
  sendLabel,
  stopLabel,
  micLabel,
}: Props) {
  const colors = useThemeColors();
  const hasText = value.trim().length > 0;
  const [inputHeight, setInputHeight] = useState<number | undefined>(undefined);
  // Collapse back to one line when the parent clears the text (e.g. after sending).
  useEffect(() => {
    if (!value) setInputHeight(undefined);
  }, [value]);

  return (
    <View style={[styles.wrapper, { backgroundColor: colors.bgInput }]}>
      <TextInput
        style={[styles.input, { color: colors.textPrimary }, inputHeight != null && { height: inputHeight }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={(e) =>
          setInputHeight(
            Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, e.nativeEvent.contentSize.height))
          )
        }
        onFocus={onFocus}
        onBlur={onBlur}
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
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 4, minHeight: INPUT_MIN_HEIGHT, maxHeight: INPUT_MAX_HEIGHT },
  micBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});
