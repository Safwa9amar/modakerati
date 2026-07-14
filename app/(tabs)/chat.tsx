import { useState, useRef, useEffect, useCallback, memo } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput as RNTextInput, KeyboardAvoidingView, Platform, Keyboard, Image } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useChatHead } from "@/stores/chat-head-store";
import { sendMessageToAI, loadInitialMessages, regenerateLastResponse } from "@/lib/ai-service";
import { Send, Plus, Home, List, Paperclip, Image as ImageIcon, Sparkles, ChevronDown, ChevronUp, Square, Maximize2, X, FileText, RotateCcw } from "lucide-react-native";
import { useRouter } from "expo-router";
import { ThesisStructureSheet } from "@/components/ThesisStructureSheet";
import { AskBottomSheet } from "@/components/AskBottomSheet";
import { Markdown } from "@/components/Markdown";
import { MessageViewer } from "@/components/MessageViewer";
import { ChatSkeleton } from "@/components/ChatSkeleton";
import { FileCard } from "@/components/FileCard";
import { splitFileFrames } from "@/lib/file-frames";
import { ComposerQuickActions } from "@/components/workspace/ComposerQuickActions";
import { useComposerSuggestions } from "@/hooks/useComposerSuggestions";
import { getTextDirection } from "@/lib/text-direction";
import { TypingIndicator, ThinkingDots } from "@/components/TypingIndicator";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";
import type { ChatMessage, FilePayload } from "@/types/chat";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const LOGO = require("../../assets/icon.png");

// A picked-but-not-yet-sent image or document. Staged in the composer so the
// user can add a prompt (or remove it) before it goes to the AI.
type Attachment =
  | { type: "image"; uri: string; width?: number; height?: number }
  | { type: "file"; uri: string; name: string; size?: number };

// Above this length, an assistant answer is collapsed to a clipped preview with
// "View more" (expand inline) / "View full" (open the full-screen viewer)
// affordances — long answers otherwise dominate the scroll inside a 75%-width bubble.
const EXPAND_THRESHOLD = 280;
// Height of the clipped preview shown before the reader expands the message.
const COLLAPSED_HEIGHT = 220;
// Composer auto-grow bounds (one line … ~6 lines, then it scrolls internally).
// Belt-and-suspenders so it grows whichever mechanism the New Architecture honors:
//   • minHeight/maxHeight in the style bound the input's INTRINSIC auto-sizing, and
//   • onContentSizeChange drives an explicit height when that event fires.
// The height stays UNSET until measured, so if onContentSizeChange never fires the
// intrinsic path still governs (we never pin the box to one line).
const INPUT_MIN_HEIGHT = 28;
const INPUT_MAX_HEIGHT = 120;

/**
 * Gradient-style fade from transparent to the bubble color, masking the hard
 * clip at the bottom of a collapsed message. Built from stacked opacity bands so
 * we don't need a gradient dependency.
 */
function FadeOverlay({ color }: { color: string }) {
  const SLICES = 10;
  const H = 56;
  return (
    <View pointerEvents="none" style={[styles.fadeOverlay, { height: H }]}>
      {Array.from({ length: SLICES }).map((_, i) => (
        <View key={i} style={{ height: H / SLICES, backgroundColor: color, opacity: (i + 1) / SLICES }} />
      ))}
    </View>
  );
}

const Bubble = memo(({ item, colors, isStreaming, isLastAssistant, onExpand, onPreviewFile, onRegenerate }: { item: ChatMessage; colors: any; isStreaming?: boolean; isLastAssistant?: boolean; onExpand?: (content: string) => void; onPreviewFile?: (file: FilePayload) => void; onRegenerate?: () => void }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const isUser = item.role === "user";
  // Assistant content may carry [[MODK_FILE]] frames (e.g. an export). Strip them
  // for display and render file cards instead. Live-streamed files arrive on
  // item.files (frame already stripped); history messages still hold the frame in
  // content, so parse it here too — prefer item.files when present.
  const { text: bodyText, files: framedFiles } = isUser
    ? { text: item.content, files: [] as FilePayload[] }
    : splitFileFrames(item.content);
  const files = item.files?.length ? item.files : framedFiles;
  // Whether there's answer text below the thinking block. While the model is
  // still reasoning, content is empty — so the thinking wrapper must not draw
  // its separator/spacing or it renders as an empty framed box.
  const hasContent = bodyText.trim().length > 0;
  // Only completed assistant answers collapse — streaming text stays fully visible.
  const isLong = !isUser && !isStreaming && bodyText.length > EXPAND_THRESHOLD;
  const collapsed = isLong && !expanded;
  // The most recent assistant reply gets a "Regenerate" affordance — re-runs the
  // last user turn for a different answer (ChatGPT-style). Hidden while streaming.
  const canRegenerate = !!isLastAssistant && !isStreaming && hasContent;
  // The reasoning is still streaming (no answer text yet) → the "Thinking" toggle
  // shows live bouncing dots so it reads as active, replacing the separate typing
  // indicator. Once the answer starts (or the turn ends) the dots stop and it
  // stays as a collapsed, tappable toggle for reviewing the reasoning.
  const thinkingActive = !!isStreaming && !hasContent;
  // Direction follows the message's own language so a mix of Arabic/English/French
  // chats each align correctly regardless of the app's locale.
  const dir = getTextDirection(bodyText);
  const textDirStyle = { textAlign: dir === "rtl" ? "right" : "left", writingDirection: dir } as const;
  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
      {!isUser && <Image source={LOGO} style={styles.aiAvatar} />}
      <View style={[styles.bubble, isUser ? { backgroundColor: colors.chatUserBubble, borderTopRightRadius: 4 } : { backgroundColor: colors.chatAiBubble, borderTopLeftRadius: 4 }]}>
        {!isUser && item.thinking ? (
          <View style={[hasContent && styles.thinkWrap, { borderColor: colors.borderDefault }]}>
            <Pressable onPress={() => setThinkOpen((o) => !o)} hitSlop={6} style={styles.thinkHeader} accessibilityRole="button">
              <Sparkles size={13} color={colors.textSecondary} strokeWidth={2} />
              <Text style={[styles.thinkLabel, { color: colors.textSecondary }]}>{t("chat.thinking", { defaultValue: "Thinking" })}</Text>
              {thinkingActive && <ThinkingDots color={colors.textSecondary} />}
              <View style={styles.thinkSpacer} />
              {thinkOpen ? <ChevronUp size={14} color={colors.textSecondary} strokeWidth={2} /> : <ChevronDown size={14} color={colors.textSecondary} strokeWidth={2} />}
            </Pressable>
            {thinkOpen && <Text selectable style={[styles.thinkText, { color: colors.textSecondary }]}>{item.thinking}</Text>}
          </View>
        ) : null}
        {isUser ? (
          <Text selectable style={[styles.messageText, { color: colors.chatUserText }, textDirStyle]}>{item.content}</Text>
        ) : hasContent ? (
          isStreaming ? (
            // While streaming, render plain text — re-parsing markdown on every
            // token is O(n²) and janky. Markdown is applied once the message ends.
            <Text selectable style={[styles.messageText, { color: colors.textPrimary }, textDirStyle]}>{bodyText}</Text>
          ) : (
            <View style={collapsed ? styles.collapsedWrap : undefined}>
              <Markdown content={bodyText} color={colors.textPrimary} direction={dir} />
              {collapsed && <FadeOverlay color={colors.chatAiBubble} />}
            </View>
          )
        ) : null}
        {(isLong || canRegenerate) && (
          <View style={[styles.bubbleActions, { borderTopColor: colors.borderDefault }]}>
            {isLong && (
              <>
                <Pressable
                  onPress={() => setExpanded((e) => !e)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={expanded ? t("chat.showLess", { defaultValue: "Show less" }) : t("chat.viewMore", { defaultValue: "View more" })}
                  style={styles.actionBtn}
                >
                  {expanded ? (
                    <ChevronUp size={14} color={colors.brandPrimaryLight} strokeWidth={2} />
                  ) : (
                    <ChevronDown size={14} color={colors.brandPrimaryLight} strokeWidth={2} />
                  )}
                  <Text style={[styles.actionLabel, { color: colors.brandPrimaryLight }]}>
                    {expanded ? t("chat.showLess", { defaultValue: "Show less" }) : t("chat.viewMore", { defaultValue: "View more" })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onExpand?.(item.content)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.viewFull", { defaultValue: "View full response" })}
                  style={styles.actionBtn}
                >
                  <Maximize2 size={13} color={colors.brandPrimaryLight} strokeWidth={2} />
                  <Text style={[styles.actionLabel, { color: colors.brandPrimaryLight }]}>{t("chat.viewFull", { defaultValue: "View full" })}</Text>
                </Pressable>
              </>
            )}
            {canRegenerate && (
              <Pressable
                onPress={() => onRegenerate?.()}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t("chat.regenerate", { defaultValue: "Regenerate" })}
                style={styles.actionBtn}
              >
                <RotateCcw size={13} color={colors.brandPrimaryLight} strokeWidth={2} />
                <Text style={[styles.actionLabel, { color: colors.brandPrimaryLight }]}>{t("chat.regenerate", { defaultValue: "Regenerate" })}</Text>
              </Pressable>
            )}
          </View>
        )}
        {!isUser && files.length > 0 && (
          <View style={[styles.fileCards, hasContent && styles.fileCardsSpaced]}>
            {files.map((f, i) => (
              <FileCard key={(f.url || "file") + i} file={f} onPress={() => onPreviewFile?.(f)} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
});

// The full thesis chat UI, reusable in two places: as the Chat TAB (variant
// "screen", with a Home button) and inside the floating chat-head OVERLAY
// (variant "overlay", with a Close button that collapses back to the bubble).
export function ThesisChat({ thesisId, thesisTitle, variant = "screen", onClose }: { thesisId: string; thesisTitle: string; variant?: "screen" | "overlay"; onClose?: () => void }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const [inputText, setInputText] = useState("");
  // Explicit height once onContentSizeChange measures it; undefined = let the
  // intrinsic (min/maxHeight-bounded) sizing govern. See INPUT_*_HEIGHT.
  const [inputHeight, setInputHeight] = useState<number | undefined>(undefined);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [viewerContent, setViewerContent] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const setPendingAsk = useChatStore((s) => s.setPendingAsk);
  // This UI exists in two places at once (the Chat TAB and the floating chat-head
  // OVERLAY). Only the visible one is "active" and may drive the GLOBAL sheets
  // (ask/structure) — otherwise the agent's ask_user would open two sheets. The
  // tab yields to the overlay while it's expanded.
  const chatHeadExpanded = useChatHead((s) => s.expanded);
  const active = variant === "overlay" ? chatHeadExpanded : !chatHeadExpanded;
  // AI-generated quick-action chips from the recent conversation + RAG. Only the
  // visible instance fetches, and not while an ask sheet is open. No block
  // selection in plain chat, so it grounds on the conversation alone.
  const { suggestions } = useComposerSuggestions(thesisId, { enabled: active && !pendingAsk });
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<RNTextInput>(null);
  // True while the list is within NEAR_BOTTOM of the end. Gates auto-scroll so
  // reading older messages isn't interrupted by streaming/new-message scrolls.
  // Starts true so the chat opens pinned to the newest message.
  const isNearBottomRef = useRef(true);
  // Whether the user has ever manually dragged the list. Until they do, the
  // stick-to-bottom state must NOT be changed by scroll events — the async,
  // multi-pass layout when the chat first opens fires scroll events at offset 0
  // (looks "far from bottom") that would otherwise disengage the pin and leave
  // the chat stranded mid-history. Only a real drag hands scroll control over.
  const userHasScrolledRef = useRef(false);
  const messages = useChatStore((s) => s.getMessages(thesisId));
  const isGenerating = useChatStore((s) => s.isGenerating);
  const generatingPhase = useChatStore((s) => s.generatingPhase);
  const streamingId = useChatStore((s) => s.streamingId);
  const loadedRef = useRef(false);
  const rotation = useSharedValue(0);
  // True while the initial history is being pulled from cache/server. Starts true
  // only when nothing is in memory yet — a thesis revisited this session already
  // has its messages and shouldn't flash a skeleton.
  const [loadingHistory, setLoadingHistory] = useState(() => messages.length === 0);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadInitialMessages(thesisId).finally(() => setLoadingHistory(false));
    }
  }, []);

  // Bridge the model's pending question (data, in the chat store) to the global
  // sheet store so the "ask" sheet's open state lives alongside every other sheet.
  useEffect(() => {
    if (!active) return;
    if (pendingAsk) useBottomSheet.getState().openSheet("ask");
    else useBottomSheet.getState().closeSheet("ask");
  }, [pendingAsk, active]);

  // Focusing the input shrinks the list (keyboard/KeyboardAvoidingView) without
  // changing content size, so onContentSizeChange won't fire — keep the latest
  // message visible on keyboard-open, the way messaging apps do. Only while the
  // user is already at the bottom, so reading history isn't disrupted.
  useEffect(() => {
    const evt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(evt, () => {
      if (isNearBottomRef.current) flatListRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  // A new thesis is a fresh conversation: re-arm the open-at-bottom behaviour so
  // it isn't left in the previous chat's "scrolled up" state (this component is
  // reused across theses, not remounted).
  useEffect(() => {
    isNearBottomRef.current = true;
    userHasScrolledRef.current = false;
    setShowScrollDown(false);
  }, [thesisId]);

  const NEAR_BOTTOM = 160;
  function handleScroll(e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const nearBottom = distanceFromBottom < NEAR_BOTTOM;
    // Only honour position once the user has taken control with a drag. Before
    // that, the pin stays engaged through the opening layout passes (see
    // userHasScrolledRef) so the chat reliably lands on the newest message.
    if (userHasScrolledRef.current) isNearBottomRef.current = nearBottom;
    setShowScrollDown(!isNearBottomRef.current); // no-op re-render bailout when unchanged
  }

  function scrollToBottom() {
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    flatListRef.current?.scrollToEnd({ animated: true });
  }

  // Open the thesis's live .docx in the workspace (the document IS the export).
  // (Stable identity so the memoized Bubble doesn't re-render on every keystroke.)
  const handlePreviewFile = useCallback(
    (_file: FilePayload) => {
      router.push({ pathname: "/(app)/thesis-workspace", params: { thesisId } });
    },
    [router, thesisId]
  );

  // Regenerate the most recent assistant reply (drops it and re-runs the last
  // user turn). Stable identity so the memoized Bubble doesn't re-render on every
  // keystroke; snaps to the bottom so the fresh answer streams into view.
  const handleRegenerate = useCallback(() => {
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    void regenerateLastResponse(thesisId);
  }, [thesisId]);

  // Folds a staged attachment into the outgoing text. The `[Attached …]` marker
  // is what the assistant sees; a typed prompt overrides the generic default.
  function composeMessage(text: string, att: Attachment | null): string {
    if (!att) return text;
    if (att.type === "image") {
      const prompt = text || t("chat.describeImage", { defaultValue: "Please describe what you see and how it relates to my thesis." });
      return `[Attached image] ${prompt}`;
    }
    const prompt = text || t("chat.analyzeFile", { defaultValue: "Please analyze this document." });
    return `[Attached file: ${att.name}] ${prompt}`;
  }

  async function handleSend() {
    if (isGenerating) return;
    const text = inputText.trim();
    // Send when there's text, an attachment, or both — but never an empty turn.
    if (!text && !attachment) return;
    const message = composeMessage(text, attachment);
    setInputText("");
    // Also clear the native buffer: a controlled value="" set in the same tick as
    // the editable flip / keyboard dismiss can be dropped on Fabric, leaving the
    // sent text stuck in the field.
    inputRef.current?.clear();
    setInputHeight(undefined); // collapse back to one line after sending
    setAttachment(null);
    Keyboard.dismiss();
    // Sending your own message always jumps to the latest, even if scrolled up.
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    await sendMessageToAI(thesisId, message);
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
        useBottomSheet.getState().openSheet("structure");
        break;
      case "file":
        try {
          const result = await DocumentPicker.getDocumentAsync({
            type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"],
            copyToCacheDirectory: true,
          });
          if (!result.canceled && result.assets?.[0]) {
            const file = result.assets[0];
            // Stage it in the composer; it's sent with the next message, not now.
            setAttachment({ type: "file", uri: file.uri, name: file.name, size: file.size ?? undefined });
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
            // Stage it in the composer; it's sent with the next message, not now.
            setAttachment({ type: "image", uri: image.uri, width: image.width, height: image.height });
          }
        } catch {}
        break;
    }
  }

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const hasText = inputText.trim().length > 0;
  // The send button appears whenever there's something to send — text or a
  // staged attachment (so an image can be sent with no caption).
  const canSend = hasText || attachment !== null;

  const tools = [
    { key: "structure", icon: List, label: "Structure", color: colors.brandAccent },
    { key: "file", icon: Paperclip, label: "Attach", color: colors.semanticWarning },
    { key: "image", icon: ImageIcon, label: "Image", color: "#9959FF" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.bgCard }}>
        <View style={styles.topBar}>
          {variant === "overlay" ? (
            <Pressable onPress={onClose} hitSlop={8} style={{ padding: 4 }} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
              <X size={22} color={colors.textPrimary} strokeWidth={1.8} />
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push("/(tabs)/" as any)} style={{ padding: 4 }}>
              <Home size={22} color={colors.textPrimary} strokeWidth={1.8} />
            </Pressable>
          )}
          <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>{thesisTitle}</Text>
          <View style={{ width: 30 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={{ flex: 1 }}>
          {loadingHistory && messages.length === 0 ? (
            <ChatSkeleton />
          ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={({ item, index }) => <Bubble item={item} colors={colors} isStreaming={item.id === streamingId} isLastAssistant={index === messages.length - 1 && item.role === "assistant" && messages.length > 1} onExpand={setViewerContent} onPreviewFile={handlePreviewFile} onRegenerate={handleRegenerate} />}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            scrollEventThrottle={32}
            // A real finger-drag is what hands scroll control to the user; from
            // here on, position decides whether we stick to the bottom.
            onScrollBeginDrag={() => { userHasScrolledRef.current = true; }}
            onContentSizeChange={() => {
              // The bottom is the anchor (Messenger/WhatsApp style): re-pin to the
              // newest message on every content-size change while the user is at
              // the bottom. This is what makes the chat reliably OPEN at the end —
              // bubbles with markdown/images lay out over several async passes, and
              // each pass keeps us pinned instead of settling above the last
              // message. It also covers incoming messages and streaming tokens.
              // Suppressed once the user scrolls up to read history; re-armed when
              // they return to the bottom (handleScroll / the scroll-to-latest FAB).
              if (isNearBottomRef.current) flatListRef.current?.scrollToEnd({ animated: false });
            }}
            ListFooterComponent={
              // Only show the standalone typing indicator BEFORE the assistant
              // bubble exists. Once it streams (reasoning models create it on the
              // first thinking token), the bubble's own live "Thinking" toggle is
              // the single indicator — no duplicate row.
              isGenerating && generatingPhase === "thinking" && !streamingId ? (
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
          )}

          {/* Scroll-to-latest FAB — appears when scrolled away from the bottom */}
          {showScrollDown && !loadingHistory && (
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

          {/* Staged attachment — shown until the user sends or removes it */}
          {attachment && (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={[styles.attachmentChip, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
              {attachment.type === "image" ? (
                <Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} />
              ) : (
                <View style={[styles.attachmentFileIcon, { backgroundColor: colors.brandPrimary + "22" }]}>
                  <FileText size={20} color={colors.brandPrimary} strokeWidth={1.8} />
                </View>
              )}
              <View style={styles.attachmentInfo}>
                <Text style={[styles.attachmentName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {attachment.type === "image" ? t("chat.image", { defaultValue: "Image" }) : attachment.name}
                </Text>
                <Text style={[styles.attachmentMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {attachment.type === "image"
                    ? attachment.width && attachment.height
                      ? `${attachment.width} × ${attachment.height}`
                      : t("chat.attachedImage", { defaultValue: "Attached image" })
                    : attachment.size != null
                      ? `${(attachment.size / 1024).toFixed(1)} KB`
                      : t("chat.attachedFile", { defaultValue: "Attached file" })}
                </Text>
              </View>
              <Pressable
                onPress={() => setAttachment(null)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t("chat.removeAttachment", { defaultValue: "Remove attachment" })}
                style={[styles.attachmentRemove, { backgroundColor: colors.bgCard }]}
              >
                <X size={16} color={colors.textSecondary} strokeWidth={2} />
              </Pressable>
            </Animated.View>
          )}

          {/* AI suggestion chips — grounded in the conversation. Shown only when the
              model returned some (no static fallback here, unlike the workspace). */}
          {suggestions.length > 0 && !isGenerating && (
            <View style={styles.suggestionsRow}>
              <ComposerQuickActions
                suggestions={suggestions}
                onPreset={(prompt) => {
                  setInputText(prompt);
                  inputRef.current?.focus();
                }}
              />
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
                ref={inputRef}
                style={[styles.input, { color: colors.textPrimary }, inputHeight != null && { height: inputHeight }]}
                placeholder={t("chat.askPlaceholder")}
                placeholderTextColor={colors.textPlaceholder}
                value={inputText}
                onChangeText={setInputText}
                onContentSizeChange={(e) =>
                  setInputHeight(
                    Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, e.nativeEvent.contentSize.height))
                  )
                }
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
              ) : canSend ? (
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

      {active && <ThesisStructureSheet />}

      {active && (
        <AskBottomSheet
          ask={pendingAsk}
          onAnswer={(answer) => {
            setPendingAsk(null);
            void sendMessageToAI(thesisId, answer);
          }}
          onClose={() => setPendingAsk(null)}
        />
      )}

      <MessageViewer
        visible={viewerContent !== null}
        content={viewerContent}
        onClose={() => setViewerContent(null)}
      />
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

  return <ThesisChat thesisId={thesisId} thesisTitle={thesisTitle} />;
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
  collapsedWrap: { maxHeight: COLLAPSED_HEIGHT, overflow: "hidden" },
  fadeOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  bubbleActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  fileCards: { gap: 8 },
  fileCardsSpaced: { marginTop: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  thinkWrap: { marginBottom: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  thinkHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  thinkLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  thinkSpacer: { flex: 1 },
  thinkText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 8, fontStyle: "italic" },
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
  suggestionsRow: { marginBottom: 10, marginHorizontal: 2 },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    marginHorizontal: 2,
    padding: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachmentThumb: { width: 44, height: 44, borderRadius: 8 },
  attachmentFileIcon: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  attachmentInfo: { flex: 1, gap: 2 },
  attachmentName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  attachmentMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  attachmentRemove: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  toolsRow: { flexDirection: "row", gap: 8, marginBottom: 10, paddingHorizontal: 2 },
  toolBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 14 },
  toolIconBg: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toolLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  plusBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  inputWrapper: { flex: 1, flexDirection: "row", alignItems: "flex-end", borderRadius: 22, paddingLeft: 16, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", paddingVertical: 4, minHeight: INPUT_MIN_HEIGHT, maxHeight: INPUT_MAX_HEIGHT },
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
