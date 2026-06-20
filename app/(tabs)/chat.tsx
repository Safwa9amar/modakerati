import { useState, useRef, useEffect, memo } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput as RNTextInput, KeyboardAvoidingView, Platform, Keyboard } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, loadInitialMessages } from "@/lib/ai-service";
import { Send, Plus, Home, List, Paperclip, Image, Sparkles } from "lucide-react-native";
import { useRouter } from "expo-router";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
import type { ChatMessage } from "@/types/chat";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const messages = useChatStore((s) => s.getMessages(thesisId));
  const isGenerating = useChatStore((s) => s.isGenerating);
  const loadedRef = useRef(false);
  const rotation = useSharedValue(0);

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

  function toggleTools() {
    const next = !toolsExpanded;
    setToolsExpanded(next);
    rotation.value = withSpring(next ? 45 : 0, { damping: 12, stiffness: 200 });
  }

  function handleToolPress(tool: string) {
    setToolsExpanded(false);
    rotation.value = withTiming(0, { duration: 200 });
    switch (tool) {
      case "structure": setSheetVisible(true); break;
      case "enhance": router.push("/(app)/ai-enhance" as any); break;
    }
  }

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const hasText = inputText.trim().length > 0;

  const tools = [
    { key: "structure", icon: List, label: "Structure", color: colors.brandAccent },
    { key: "enhance", icon: Sparkles, label: "AI Enhance", color: colors.brandPrimary },
    { key: "file", icon: Paperclip, label: "Attach", color: colors.semanticWarning },
    { key: "image", icon: Image, label: "Image", color: "#9959FF" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.bgCard }}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.push("/(tabs)/" as any)} style={{ padding: 4 }}>
            <Home size={22} color={colors.textPrimary} strokeWidth={1.8} />
          </Pressable>
          <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>{thesisTitle}</Text>
          <View style={{ width: 30 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
              setToolsExpanded(false);
              rotation.value = withTiming(0, { duration: 200 });
            }
          }}
        />

        {isGenerating && (
          <View style={[styles.generatingRow, { backgroundColor: colors.chatAiBubble }]}>
            <View style={[styles.aiAvatar, { backgroundColor: colors.brandAccent }]} />
            <Text style={[styles.generatingText, { color: colors.textSecondary }]}>AI is writing...</Text>
          </View>
        )}

        <View style={[styles.inputContainer, { backgroundColor: colors.bgCard, paddingBottom: Math.max(insets.bottom, 8) }]}>
          {/* Tools tray */}
          {toolsExpanded && (
            <Animated.View entering={SlideInDown.duration(250).springify()} exiting={SlideOutDown.duration(200)} style={styles.toolsRow}>
              {tools.map((tool, i) => (
                <AnimatedPressable
                  key={tool.key}
                  entering={FadeIn.delay(i * 60).duration(200)}
                  onPress={() => handleToolPress(tool.key)}
                  style={[styles.toolBtn, { backgroundColor: tool.color + "15" }]}
                >
                  <View style={[styles.toolIconBg, { backgroundColor: tool.color + "25" }]}>
                    <tool.icon size={20} color={tool.color} strokeWidth={1.8} />
                  </View>
                  <Text style={[styles.toolLabel, { color: tool.color }]}>{tool.label}</Text>
                </AnimatedPressable>
              ))}
            </Animated.View>
          )}

          {/* Input row: + button on left, input with embedded send on right */}
          <View style={styles.inputRow}>
            {/* Plus button — always visible on the left */}
            <Pressable
              onPress={toggleTools}
              style={[styles.plusBtn, { backgroundColor: toolsExpanded ? colors.bgSurface : colors.brandPrimary }]}
            >
              <Animated.View style={plusStyle}>
                <Plus size={20} color={toolsExpanded ? colors.textSecondary : "#FFFFFF"} strokeWidth={2.5} />
              </Animated.View>
            </Pressable>

            {/* Input wrapper with send inside */}
            <View style={[styles.inputWrapper, { backgroundColor: colors.bgSurface }]}>
              <RNTextInput
                style={[styles.input, { color: colors.textPrimary }]}
                placeholder="Ask about your thesis..."
                placeholderTextColor={colors.textPlaceholder}
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleSend}
                onFocus={() => {
                  if (toolsExpanded) {
                    setToolsExpanded(false);
                    rotation.value = withTiming(0, { duration: 200 });
                  }
                }}
                returnKeyType="send"
                editable={!isGenerating}
                multiline
                maxLength={2000}
              />
              {/* Send button inside input — appears when there's text */}
              {hasText && (
                <AnimatedPressable
                  entering={FadeIn.duration(150)}
                  exiting={FadeOut.duration(100)}
                  onPress={handleSend}
                  style={[styles.sendBtn, { backgroundColor: colors.brandPrimary, opacity: isGenerating ? 0.4 : 1 }]}
                >
                  <Send size={16} color="#FFFFFF" strokeWidth={2} />
                </AnimatedPressable>
              )}
            </View>
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
  toolsRow: { flexDirection: "row", gap: 8, marginBottom: 10, paddingHorizontal: 2 },
  toolBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 14 },
  toolIconBg: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toolLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  plusBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  inputWrapper: { flex: 1, flexDirection: "row", alignItems: "flex-end", borderRadius: 22, paddingLeft: 16, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", maxHeight: 100, paddingVertical: 4 },
  sendBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginLeft: 6 },
  noThesis: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  noThesisText: { fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center" },
});
