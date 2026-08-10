import { useRef, useEffect, useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, BackHandler } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { getTextDirection } from "@/lib/text-direction";
import { AskPreviewGrid } from "@/components/AskPreviewGrid";
import type { AskPayload } from "@/types/chat";
import { visualRow } from "@/lib/rtl-layout";

interface Props {
  ask: AskPayload | null;
  onAnswer: (answer: string) => void;
  onClose: () => void;
}

export function AskBottomSheet({ ask, onAnswer, onClose }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const isOpen = useBottomSheet((s) => s.openSheets.has("ask"));
  const sheetRef = useRef<BottomSheetModal>(null);
  const [text, setText] = useState("");
  // The answer the student picked, held until gorhom finishes dismissing. Every
  // way out of this sheet goes through `dismiss()` → `onDismiss`; answering used
  // to skip that, clearing `ask` and UNMOUNTING the modal mid-presentation — the
  // one thing this codebase's sheets must never do (see components/BottomSheet).
  const answerRef = useRef<string | null>(null);

  // Open/close is owned by the global sheet store; `ask` carries the content.
  useEffect(() => {
    if (isOpen) {
      setText("");
      answerRef.current = null;
      const id = requestAnimationFrame(() => sheetRef.current?.present());
      return () => cancelAnimationFrame(id);
    }
    sheetRef.current?.dismiss();
  }, [isOpen]);

  // The user always has the right to dismiss the question unanswered — Android
  // hardware back closes the sheet instead of leaking to the screen behind it.
  // No-op on iOS (no hardware back).
  useEffect(() => {
    if (!isOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      sheetRef.current?.dismiss();
      return true;
    });
    return () => sub.remove();
  }, [isOpen]);

  // Tapping the backdrop dismisses the question (onDismiss → onClose clears it).
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );

  if (!ask) return null;

  // Answering closes the sheet the same way ✕ / backdrop / back / swipe do: park
  // the answer and dismiss. `handleDismiss` sends it once gorhom has actually
  // torn the sheet (and its backdrop) down.
  const submit = (answer: string) => {
    const a = answer.trim();
    if (!a) return;
    answerRef.current = a;
    sheetRef.current?.dismiss();
  };

  // The single exit. An answer parked by `submit` is sent now; nothing parked
  // means the student dismissed the question unanswered, which is always their
  // right (see the ai-asks-dismissible rule).
  const handleDismiss = () => {
    const answer = answerRef.current;
    answerRef.current = null;
    if (answer) onAnswer(answer);
    else onClose();
  };

  // The answer field follows the QUESTION's direction, so an Arabic question
  // puts the caret on the right (same rule as the workspace's ComposerAsk).
  const rtl = getTextDirection(ask.question) === "rtl";

  return (
    <BottomSheetModal
      ref={sheetRef}
      // Two detents on purpose: `extend` raises the sheet to the HIGHEST one when
      // the keyboard opens, so the second detent is what clears the keys.
      snapPoints={["55%", "92%"]}
      enableDynamicSizing={false}
      // Dismissible without answering: swipe down, backdrop tap, back press, or ✕.
      enablePanDownToClose
      // Was `interactive`, which left the answer field BEHIND the keyboard on
      // Android: gorhom deliberately no-ops `interactive` when
      // android_keyboardInputMode is adjustResize, because it assumes the OS
      // resizes the window for the IME — and this app draws edge-to-edge, where
      // it never does (windowSoftInputMode is inert once you draw behind the
      // system bars; same trap BlockComposer documents). `extend` isn't behind
      // that guard, so it works on both platforms: keyboard up → highest detent.
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleComponent={null}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.bgModal }}
    >
      {/* Scrollable so a long question can't push the answer field out of the
          visible strip above the keyboard; persistTaps so the first tap on Send
          sends instead of only dismissing the keyboard. */}
      <BottomSheetScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.header, { flexDirection: visualRow(rtl) }]}>
          <Text style={[styles.question, { color: colors.textPrimary }, rtl && styles.rtlText]}>
            {ask.question}
          </Text>
          <Pressable
            onPress={() => sheetRef.current?.dismiss()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("chat.dismissQuestion", { defaultValue: "Dismiss question" })}
          >
            <X size={20} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        </View>

        {ask.previews?.length ? (
          // Visual choices (e.g. divider ornaments): preview cards instead of
          // chips. Answering goes through the same submit → dismiss path, and
          // every dismiss route stays available unanswered.
          <AskPreviewGrid previews={ask.previews} onChoose={submit} />
        ) : (
          <View style={[styles.chips, { flexDirection: visualRow(rtl) }]}>
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
        )}

        {ask.allowFreeText && (
          <View style={[styles.inputRow, { flexDirection: visualRow(rtl) }]}>
            <BottomSheetTextInput
              value={text}
              onChangeText={setText}
              placeholder={t("chat.typeYourOwn", { defaultValue: "Type your own…" })}
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { color: colors.textPrimary, backgroundColor: colors.bgCard, textAlign: rtl ? "right" : "left" },
              ]}
              onSubmitEditing={() => submit(text)}
              returnKeyType="send"
            />
            <Pressable
              onPress={() => submit(text)}
              style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }]}
            >
              <Text style={styles.sendText}>{t("chat.send", { defaultValue: "Send" })}</Text>
            </Pressable>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 16 },
  question: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12 },
  sendText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
