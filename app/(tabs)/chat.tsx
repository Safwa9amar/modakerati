import { useState, useRef, useEffect, memo, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput as RNTextInput, KeyboardAvoidingView, Platform, Keyboard, Animated as RNAnimated, LayoutAnimation } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, loadInitialMessages } from "@/lib/ai-service";
import { Send, Plus, Home, List, Paperclip, Image, BookOpen, Sparkles, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
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
  const router = useRouter();
  const [inputText, setInputText] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<RNTextInput>(null);
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
    setInputFocused(false);
    Keyboard.dismiss();
    await sendMessageToAI(thesisId, text);
  }

  function handlePlusPress() {
    if (inputFocused || inputText.trim()) {
      // If focused with text, this shouldn't happen (send button shows instead)
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setToolsExpanded(!toolsExpanded);
  }

  function handleToolPress(tool: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setToolsExpanded(false);

    switch (tool) {
      case "structure":
        setSheetVisible(true);
        break;
      case "enhance":
        router.push("/(app)/ai-enhance" as any);
        break;
      case "file":
        // TODO: document picker
        break;
      case "image":
        // TODO: image picker
        break;
    }
  }

  // Show send icon when focused or has text, otherwise show plus
  const showSend = inputFocused || inputText.trim().length > 0;

  const tools = [
    { key: "structure", icon: List, label: "Structure", color: colors.brandAccent },
    { key: "enhance", icon: Sparkles, label: "AI Enhance", color: colors.brandPrimary },
    { key: "file", icon: Paperclip, label: "Attach File", color: colors.semanticWarning },
    { key: "image", icon: Image, label: "Add Image", color: "#9959FF" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      {/* Top bar */}
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.bgCard }}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.push("/(tabs)/" as any)} style={{ padding: 4 }}>
            <Home size={22} color={colors.textPrimary} strokeWidth={1.8} />
          </Pressable>
          <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>{thesisTitle}</Text>
          <View style={{ width: 30 }} />
        </View>
      </SafeAreaView>

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={({ item }) => <Bubble item={item} colors={colors} />}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onTouchStart={() => {
            if (toolsExpanded) {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setToolsExpanded(false);
            }
          }}
        />

        {isGenerating && (
          <View style={[styles.generatingRow, { backgroundColor: colors.chatAiBubble }]}>
            <View style={[styles.aiAvatar, { backgroundColor: colors.brandAccent }]} />
            <Text style={[styles.generatingText, { color: colors.textSecondary }]}>AI is writing...</Text>
          </View>
        )}

        {/* Input area */}
        <View style={[styles.inputContainer, { backgroundColor: colors.bgCard, paddingBottom: Math.max(insets.bottom, 8) }]}>
          {/* Tools row */}
          {toolsExpanded && (
            <View style={styles.toolsRow}>
              {tools.map((tool) => (
                <Pressable
                  key={tool.key}
                  onPress={() => handleToolPress(tool.key)}
                  style={[styles.toolBtn, { backgroundColor: tool.color + "18" }]}
                >
                  <tool.icon size={20} color={tool.color} strokeWidth={1.8} />
                  <Text style={[styles.toolLabel, { color: tool.color }]}>{tool.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Input row */}
          <View style={styles.inputRow}>
            {/* Plus / Close button */}
            <Pressable
              onPress={showSend ? undefined : handlePlusPress}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: toolsExpanded ? colors.semanticError + "20" : (showSend ? "transparent" : colors.brandPrimary),
                },
              ]}
            >
              {toolsExpanded ? (
                <X size={20} color={colors.semanticError} strokeWidth={2} />
              ) : showSend ? null : (
                <Plus size={20} color="#FFFFFF" strokeWidth={2.5} />
              )}
            </Pressable>

            {/* Text input */}
            <View style={[styles.inputField, { backgroundColor: colors.bgSurface }]}>
              <RNTextInput
                ref={inputRef}
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="Ask about your thesis..."
                placeholderTextColor={colors.textPlaceholder}
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleSend}
                onFocus={() => {
                  setInputFocused(true);
                  if (toolsExpanded) {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setToolsExpanded(false);
                  }
                }}
                onBlur={() => setInputFocused(false)}
                returnKeyType="send"
                editable={!isGenerating}
                multiline
                maxLength={2000}
              />
            </View>

            {/* Send button — only shows when focused or has text */}
            {showSend && (
              <Pressable
                onPress={handleSend}
                style={[styles.actionBtn, { backgroundColor: colors.brandPrimary, opacity: inputText.trim() && !isGenerating ? 1 : 0.4 }]}
              >
                <Send size={18} color="#FFFFFF" strokeWidth={2} />
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <ThesisStructureSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} />
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
  inputContainer: { paddingHorizontal: 12, paddingTop: 8 },
  toolsRow: { flexDirection: "row", gap: 8, marginBottom: 10, paddingHorizontal: 4 },
  toolBtn: { flex: 1, flexDirection: "column", alignItems: "center", gap: 4, paddingVertical: 10, borderRadius: 12 },
  toolLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  actionBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  inputField: { flex: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120 },
  input: { fontSize: 14, fontFamily: "Inter_400Regular" },
  noThesis: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  noThesisText: { fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
});
