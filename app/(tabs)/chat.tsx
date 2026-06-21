import { useState, useRef, useEffect, memo } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput as RNTextInput, KeyboardAvoidingView, Platform, Keyboard } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { sendMessageToAI, loadInitialMessages } from "@/lib/ai-service";
import { Send, Plus, Home, List, Paperclip, Image as ImageIcon, Sparkles, ChevronDown, Square } from "lucide-react-native";
import { useRouter } from "expo-router";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
import { Markdown } from "@/components/Markdown";
import { TypingIndicator } from "@/components/TypingIndicator";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import type { ChatMessage } from "@/types/chat";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const Bubble = memo(({ item, colors, isStreaming }: { item: ChatMessage; colors: any; isStreaming?: boolean }) => {
  const isUser = item.role === "user";
  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
      {!isUser && <View style={[styles.aiAvatar, { backgroundColor: colors.brandAccent }]} />}
      <View style={[styles.bubble, isUser ? { backgroundColor: colors.chatUserBubble, borderTopRightRadius: 4 } : { backgroundColor: colors.chatAiBubble, borderTopLeftRadius: 4 }]}>
        {isUser ? (
          <Text selectable style={[styles.messageText, { color: colors.textPrimary }]}>{item.content}</Text>
        ) : isStreaming ? (
          // While streaming, render plain text — re-parsing markdown on every
          // token is O(n²) and janky. Markdown is applied once the message ends.
          <Text selectable style={[styles.messageText, { color: colors.textPrimary }]}>{item.content}</Text>
        ) : (
          <Markdown content={item.content} color={colors.textPrimary} />
        )}
      </View>
    </View>
  );
});

function ChatContent({ thesisId, thesisTitle }: { thesisId: string; thesisTitle: string }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const [inputText, setInputText] = useState("");
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  // True while the list is within NEAR_BOTTOM of the end. Gates auto-scroll so
  // reading older messages isn't interrupted by streaming/new-message scrolls.
  const isNearBottomRef = useRef(true);
  const messages = useChatStore((s) => s.getMessages(thesisId));
  const isGenerating = useChatStore((s) => s.isGenerating);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const streamingId = useChatStore((s) => s.streamingId);
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
    if (msgLen > 0 && isNearBottomRef.current) {
      const t = setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
      return () => clearTimeout(t);
    }
  }, [msgLen]);

  // Keep the streaming message pinned to the bottom as it grows, and follow the
  // typing indicator when it appears. Non-animated so rapid tokens don't jitter.
  // Skipped when the user has scrolled up to read previous messages.
  const lastMsg = messages[messages.length - 1];
  const streamingLen = lastMsg?.id === streamingId ? lastMsg.content.length : 0;
  useEffect(() => {
    if (isGenerating && isNearBottomRef.current) flatListRef.current?.scrollToEnd({ animated: false });
  }, [streamingLen, generatingPhase, isGenerating]);

  const NEAR_BOTTOM = 160;
  function handleScroll(e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const nearBottom = distanceFromBottom < NEAR_BOTTOM;
    isNearBottomRef.current = nearBottom;
    setShowScrollDown(!nearBottom); // no-op re-render bailout when unchanged
  }

  function scrollToBottom() {
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }

  async function handleSend() {
    if (!inputText.trim() || isGenerating) return;
    const text = inputText.trim();
    setInputText("");
    Keyboard.dismiss();
    // Sending your own message always jumps to the latest, even if scrolled up.
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    await sendMessageToAI(thesisId, text);
  }

  function toggleTools() {
    const next = !toolsExpanded;
    setToolsExpanded(next);
    rotation.value = withSpring(next ? 45 : 0, { damping: 12, stiffness: 200 });
  }

  async function handleToolPress(tool: string) {
    setToolsExpanded(false);
    rotation.value = withTiming(0, { duration: 200 });
    switch (tool) {
      case "structure":
        setSheetVisible(true);
        break;
      case "enhance":
        router.push("/(app)/ai-enhance" as any);
        break;
      case "file":
        try {
          const result = await DocumentPicker.getDocumentAsync({
            type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"],
            copyToCacheDirectory: true,
          });
          if (!result.canceled && result.assets?.[0]) {
            const file = result.assets[0];
            Alert.alert("File Selected", `${file.name}\n${(file.size! / 1024).toFixed(1)} KB`, [
              { text: "Send to AI", onPress: () => sendMessageToAI(thesisId, `[Attached file: ${file.name}] Please analyze this document.`) },
              { text: "Cancel", style: "cancel" },
            ]);
          }
        } catch {}
        break;
      case "image":
        try {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission needed", "Please allow access to your photo library.");
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
            allowsEditing: true,
          });
          if (!result.canceled && result.assets?.[0]) {
            const image = result.assets[0];
            Alert.alert("Image Selected", `${image.width}x${image.height}`, [
              { text: "Send to AI", onPress: () => sendMessageToAI(thesisId, `[Attached image] Please describe what you see and how it relates to my thesis.`) },
              { text: "Cancel", style: "cancel" },
            ]);
          }
        } catch {}
        break;
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
    { key: "image", icon: ImageIcon, label: "Image", color: "#9959FF" },
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
        <View style={{ flex: 1 }}>
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={({ item }) => <Bubble item={item} colors={colors} isStreaming={item.id === streamingId} />}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            scrollEventThrottle={32}
            ListFooterComponent={
              isGenerating && generatingPhase === "thinking" ? (
                <TypingIndicator label={t("chat.thinking")} />
              ) : null
            }
            onTouchStart={() => {
              if (toolsExpanded) {
                setToolsExpanded(false);
                rotation.value = withTiming(0, { duration: 200 });
              }
            }}
          />

          {/* Scroll-to-latest FAB — appears when scrolled away from the bottom */}
          {showScrollDown && (
            <AnimatedPressable
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(120)}
              onPress={scrollToBottom}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Scroll to latest message"
              style={[styles.scrollDownFab, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
            >
              <ChevronDown size={22} color={colors.textPrimary} strokeWidth={2.2} />
            </AnimatedPressable>
          )}
        </View>

        <View style={[styles.inputContainer, { backgroundColor: colors.bgCard, paddingBottom: Math.max(insets.bottom, 8) }]}>
          {/* Tools tray */}
          {toolsExpanded && (
            <View style={styles.toolsRow}>
              {tools.map((tool, i) => (
                <AnimatedPressable
                  key={tool.key}
                  entering={ZoomIn.delay(i * 70).duration(200)}
                  exiting={ZoomOut.delay((tools.length - 1 - i) * 30).duration(120)}
                  onPress={() => handleToolPress(tool.key)}
                  style={[styles.toolBtn, { backgroundColor: tool.color + "15" }]}
                >
                  <View style={[styles.toolIconBg, { backgroundColor: tool.color + "25" }]}>
                    <tool.icon size={20} color={tool.color} strokeWidth={1.8} />
                  </View>
                  <Text style={[styles.toolLabel, { color: tool.color }]}>{tool.label}</Text>
                </AnimatedPressable>
              ))}
            </View>
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
                placeholder={t("chat.askPlaceholder")}
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
              {/* While generating, the send button becomes a Stop button that
                  cancels the in-flight AI turn; otherwise it appears on text. */}
              {isGenerating ? (
                <AnimatedPressable
                  entering={FadeIn.duration(150)}
                  exiting={FadeOut.duration(100)}
                  onPress={() => useChatStore.getState().stopGenerating()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.stop")}
                  style={[styles.sendBtn, { backgroundColor: colors.semanticError }]}
                >
                  <Square size={12} color="#FFFFFF" fill="#FFFFFF" />
                </AnimatedPressable>
              ) : hasText ? (
                <AnimatedPressable
                  entering={FadeIn.duration(150)}
                  exiting={FadeOut.duration(100)}
                  onPress={handleSend}
                  style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }]}
                >
                  <Send size={16} color="#FFFFFF" strokeWidth={2} />
                </AnimatedPressable>
              ) : null}
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
  const router = useRouter();
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
          <Pressable
            onPress={() => router.push("/(tabs)" as never)}
            style={[styles.homeBtn, { backgroundColor: colors.brandPrimary }]}
            accessibilityRole="button"
            accessibilityLabel="Go to Home">
            <Home size={18} color="#FFFFFF" strokeWidth={2.4} />
            <Text style={styles.homeBtnText}>Home</Text>
          </Pressable>
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
  scrollDownFab: {
    position: "absolute",
    right: 16,
    bottom: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
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
  homeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },
  homeBtnText: { color: "#FFFFFF", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
