import { useRef, useEffect, useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, BackHandler } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import type { AskPayload } from "@/types/chat";

interface Props {
  ask: AskPayload | null;
  onAnswer: (answer: string) => void;
  onClose: () => void;
}

export function AskBottomSheet({ ask, onAnswer, onClose }: Props) {
  const colors = useThemeColors();
  const isOpen = useBottomSheet((s) => s.openSheets.has("ask"));
  const sheetRef = useRef<BottomSheetModal>(null);
  const [text, setText] = useState("");

  // Open/close is owned by the global sheet store; `ask` carries the content.
  useEffect(() => {
    if (isOpen) {
      setText("");
      const id = requestAnimationFrame(() => sheetRef.current?.present());
      return () => cancelAnimationFrame(id);
    }
    sheetRef.current?.dismiss();
  }, [isOpen]);

  // While the question is open, swallow the Android hardware back press so it
  // can't dismiss the sheet. No-op on iOS (no hardware back).
  useEffect(() => {
    if (!isOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [isOpen]);

  // Blocking sheet: the question must be answered, so tapping the backdrop
  // does nothing (no dismiss).
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="none" />
    ),
    []
  );

  if (!ask) return null;

  const submit = (answer: string) => {
    const a = answer.trim();
    if (!a) return;
    onAnswer(a);
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={["50%"]}
      enableDynamicSizing={false}
      // Can't be swiped down or back-dismissed — only answering closes it.
      enablePanDownToClose={false}
      // Keep the focused free-text input above the keyboard instead of hidden
      // behind it. `interactive` shifts the sheet up by the keyboard height;
      // adjustResize lets Android resize the window so the shift has room.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleComponent={null}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.bgModal }}
    >
      <BottomSheetView style={styles.content}>
        <Text style={[styles.question, { color: colors.textPrimary }]}>{ask.question}</Text>

        <View style={styles.chips}>
          {ask.options.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => submit(opt)}
              style={[styles.chip, { backgroundColor: colors.bgCard, borderColor: colors.brandPrimary + "60" }]}
            >
              <Text style={[styles.chipText, { color: colors.textPrimary }]}>{opt}</Text>
            </Pressable>
          ))}
        </View>

        {ask.allowFreeText && (
          <View style={styles.inputRow}>
            <BottomSheetTextInput
              value={text}
              onChangeText={setText}
              placeholder="Type your own…"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
              onSubmitEditing={() => submit(text)}
              returnKeyType="send"
            />
            <Pressable
              onPress={() => submit(text)}
              style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }]}
            >
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },
  question: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginBottom: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12 },
  sendText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
