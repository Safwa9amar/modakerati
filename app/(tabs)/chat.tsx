import { useState, useRef, useEffect, memo } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput as RNTextInput, KeyboardAvoidingView, Platform, Keyboard } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, loadInitialMessages } from "@/lib/ai-service";
import { Send } from "lucide-react-native";
import type { ChatMessage } from "@/types/chat";

const Bubble = memo(({ item, colors }: { item: ChatMessage; colors: any }) => {
  const isUser = item.role === "user";
  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
      {!isUser && <View style={[styles.aiAvatar, { backgroundColor: colors.brandAccent }]} />}
      <View style={[styles.bubble, isUser ? { backgroundColor: colors.chatUserBubble, borderTopRightRadius: 4 } : { backgroundColor: colors.chatAiBubble, borderTopLeftRadius: 4 }]}>
        <Text style={[styles.messageText, { color: colors.textPrimary }]}>{item.content}</Text>
      </View>
    </View>
  );
});

function ChatContent({ thesisId, thesisTitle }: { thesisId: string; thesisTitle: string }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const messages = useChatStore((s) => s.getMessages(thesisId));
  const isGenerating = useChatStore((s) => s.isGenerating);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadInitialMessages(thesisId);
    }
  }, []);

  const msgLen = messages.length;
  useEffect(() => {
    if (msgLen > 0) {
      const t = setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
      return () => clearTimeout(t);
    }
  }, [msgLen]);

  async function handleSend() {
    if (!inputText.trim() || isGenerating) return;
    const text = inputText.trim();
    setInputText("");
    Keyboard.dismiss();
    await sendMessageToAI(thesisId, text);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      {/* Top bar */}
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.bgCard }}>
        <View style={styles.topBar}>
          <View style={{ width: 30 }} />
          <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>{thesisTitle}</Text>
          <View style={{ width: 30 }} />
        </View>
      </SafeAreaView>

      {/* Messages + Input */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={({ item }) => <Bubble item={item} colors={colors} />}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />

        {isGenerating && (
          <View style={[styles.generatingRow, { backgroundColor: colors.chatAiBubble }]}>
            <View style={[styles.aiAvatar, { backgroundColor: colors.brandAccent }]} />
            <Text style={[styles.generatingText, { color: colors.textSecondary }]}>AI is writing...</Text>
          </View>
        )}

        <View style={[styles.inputBar, { backgroundColor: colors.bgCard, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={[styles.inputField, { backgroundColor: colors.bgSurface }]}>
            <RNTextInput
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder="Ask about your thesis..."
              placeholderTextColor={colors.textPlaceholder}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              editable={!isGenerating}
              multiline
              maxLength={2000}
            />
          </View>
          <Pressable onPress={handleSend} style={[styles.sendBtn, { backgroundColor: colors.brandPrimary, opacity: inputText.trim() && !isGenerating ? 1 : 0.5 }]}>
            <Send size={18} color="#FFFFFF" strokeWidth={2} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function ChatScreen() {
  const colors = useThemeColors();
  const thesisId = useThesisStore((s) => s.currentThesisId);
  const thesisTitle = useThesisStore((s) => {
    if (!s.currentThesisId) return "";
    return s.theses.find((t) => t.id === s.currentThesisId)?.title ?? "";
  });

  if (!thesisId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
        <View style={styles.noThesis}>
          <Text style={[styles.noThesisText, { color: colors.textSecondary }]}>
            Select a thesis from Home to start chatting
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return <ChatContent thesisId={thesisId} thesisTitle={thesisTitle} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  topTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "center" },
  messageList: { padding: 16, paddingBottom: 10, gap: 14, flexGrow: 1 },
  messageRow: { flexDirection: "row", gap: 8 },
  userRow: { justifyContent: "flex-end" },
  aiRow: { justifyContent: "flex-start", alignItems: "flex-start" },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, marginTop: 2 },
  bubble: { maxWidth: "75%", borderRadius: 16, padding: 12 },
  messageText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  generatingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 16 },
  generatingText: { fontSize: 14, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 10 },
  inputField: { flex: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120 },
  input: { fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  noThesis: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  noThesisText: { fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
});
