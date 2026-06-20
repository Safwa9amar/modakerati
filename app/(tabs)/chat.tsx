import { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput as RNTextInput, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, loadInitialMessages } from "@/lib/ai-service";
import { ArrowLeft, MoreHorizontal, Send, List } from "lucide-react-native";
import { useRTL } from "@/hooks/useRTL";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
import type { ChatMessage } from "@/types/chat";

export default function ChatScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { isRTL } = useRTL();
  const [inputText, setInputText] = useState("");
  const [sheetVisible, setSheetVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const thesis = useThesisStore((s) => s.getCurrentThesis());
  const thesisId = thesis?.id ?? "default";
  const messages = useChatStore((s) => s.getMessages(thesisId));
  const isGenerating = useChatStore((s) => s.isGenerating);

  useEffect(() => {
    loadInitialMessages(thesisId);
  }, [thesisId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  async function handleSend() {
    if (!inputText.trim() || isGenerating) return;
    const text = inputText.trim();
    setInputText("");
    await sendMessageToAI(thesisId, text);
  }

  function renderMessage({ item }: { item: ChatMessage }) {
    const isUser = item.role === "user";
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
        {!isUser && (
          <View style={[styles.aiAvatar, { backgroundColor: colors.brandAccent }]} />
        )}
        <View
          style={[
            styles.bubble,
            isUser
              ? [styles.userBubble, { backgroundColor: colors.chatUserBubble }]
              : [styles.aiBubble, { backgroundColor: colors.chatAiBubble }],
          ]}
        >
          <Text style={[styles.messageText, { color: colors.textPrimary }]}>{item.content}</Text>
        </View>
      </View>
    );
  }

  // No thesis selected — show prompt
  if (!thesis) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.noThesis}>
          <Text style={[styles.noThesisText, { color: colors.textSecondary }]}>
            {t("chat.selectThesis")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      {/* Top bar */}
      <View style={[styles.topBar, { backgroundColor: colors.bgCard }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={22} color={colors.textPrimary} strokeWidth={2} style={isRTL ? { transform: [{ scaleX: -1 }] } : undefined} />
        </Pressable>
        <View style={styles.topCenter}>
          <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {thesis.title}
          </Text>
          <Text style={[styles.topSubtitle, { color: colors.textSecondary }]}>
            {thesis.chapters[0]?.title ?? ""}
          </Text>
        </View>
        <Pressable style={styles.iconBtn}>
          <MoreHorizontal size={22} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
        />

        {/* Generating indicator */}
        {isGenerating && (
          <View style={[styles.generatingRow, { backgroundColor: colors.chatAiBubble }]}>
            <View style={[styles.aiAvatar, { backgroundColor: colors.brandAccent }]} />
            <Text style={[styles.generatingText, { color: colors.textSecondary }]}>{t("chat.aiWriting")}</Text>
          </View>
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { backgroundColor: colors.bgCard }]}>
          <View style={styles.inputBottomRow}>
            <View style={[styles.inputField, { backgroundColor: colors.bgSurface }]}>
              <RNTextInput
                style={[styles.input, { color: colors.textPrimary, textAlign: isRTL ? "right" : "left" }]}
                placeholder={t("chat.askPlaceholder")}
                placeholderTextColor={colors.textPlaceholder}
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleSend}
                returnKeyType="send"
                editable={!isGenerating}
              />
            </View>
            <Pressable
              onPress={handleSend}
              style={[styles.sendBtn, { backgroundColor: colors.brandPrimary, opacity: inputText.trim() && !isGenerating ? 1 : 0.5 }]}
            >
              <Send size={18} color="#FFFFFF" strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* FAB */}
      <Pressable
        style={[styles.fab, { backgroundColor: colors.brandAccent }]}
        onPress={() => setSheetVisible(true)}
      >
        <List size={22} color={colors.bgPrimary} strokeWidth={2} />
      </Pressable>
      <ThesisStructureSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  iconBtn: { padding: 4 },
  topCenter: { flex: 1, alignItems: "center", marginHorizontal: 12 },
  topTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  topSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular" },
  messageList: { padding: 16, paddingBottom: 100, gap: 14 },
  messageRow: { flexDirection: "row", gap: 8 },
  userRow: { justifyContent: "flex-end" },
  aiRow: { justifyContent: "flex-start", alignItems: "flex-start" },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, marginTop: 2 },
  bubble: { maxWidth: "75%", borderRadius: 16, padding: 12 },
  userBubble: { borderTopRightRadius: 4 },
  aiBubble: { borderTopLeftRadius: 4 },
  messageText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  generatingRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 16, borderTopLeftRadius: 4,
  },
  generatingText: { fontSize: 14, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  inputBar: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28,
  },
  inputBottomRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  inputField: { flex: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12 },
  input: { fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  fab: {
    position: "absolute", bottom: 100, right: 20,
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    elevation: 8, shadowColor: "#33D6A6", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  noThesis: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  noThesisText: { fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
});
