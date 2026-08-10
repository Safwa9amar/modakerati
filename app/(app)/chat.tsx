import { useState, useRef, useEffect, useCallback, memo } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput as RNTextInput, KeyboardAvoidingView, Platform, Keyboard, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useBottomInset, useKeyboardLift } from "@/hooks/useBottomInset";
import { useThesisStore } from "@/stores/thesis-store";
import { useChatStore } from "@/stores/chat-store";
import { useChatThreadsStore } from "@/stores/chat-threads-store";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { useChatHead } from "@/stores/chat-head-store";
import { sendMessageToAI, loadInitialMessages, loadOlderMessages, regenerateLastResponse, retryFailedMessage, approvePendingAction, declinePendingAction } from "@/lib/ai-service";
import { ComposerConfirm } from "@/components/workspace/ComposerConfirm";
import { Send, Plus, Menu, List, Paperclip, Image as ImageIcon, Camera, ClipboardPaste, ChevronDown, ChevronUp, Square, Maximize2, X, FileText, RotateCcw, Volume2, AlertCircle, History } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useNavDrawerStore } from "@/stores/nav-drawer-store";
import { AskBottomSheet } from "@/components/AskBottomSheet";
import { DrawerMenuButton } from "@/components/DrawerMenuButton";
import { EmptyWriter } from "@/components/EmptyWriter";
import { Markdown } from "@/components/Markdown";
import { MessageViewer } from "@/components/MessageViewer";
import { ChatSkeleton } from "@/components/ChatSkeleton";
import { FileCard } from "@/components/FileCard";
import { splitFileFrames } from "@/lib/file-frames";
import { ComposerQuickActions } from "@/components/workspace/ComposerQuickActions";
import { useComposerSuggestions } from "@/hooks/useComposerSuggestions";
import { useSpeakMessage } from "@/hooks/useSpeakMessage";
import { getTextDirection } from "@/lib/text-direction";
import { TypingIndicator } from "@/components/TypingIndicator";
import { ThinkingTrace } from "@/components/ThinkingTrace";
import { AiWorkingNote } from "@/components/AiWorkingNote";
import { deriveThinkingMs } from "@/lib/thinking";
import * as DocumentPicker from "expo-document-picker";
import { Alert } from "react-native";
import { ChatImageGrid, ChatImageViewer } from "@/components/ChatImages";
import { splitImageFrames, pickChatImages, captureChatImage, pasteChatImage, MAX_CHAT_IMAGES, type StagedImage } from "@/lib/chat-images";
import { ChatHistoryPanel } from "@/components/chat/ChatHistoryPanel";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { ThesisAttachSheet } from "@/components/chat/ThesisAttachSheet";
import { patchThread } from "@/lib/api";
import type { ChatMessage, ChatImage, FilePayload } from "@/types/chat";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Whether opening this thread should wait behind a loading skeleton.
 *
 * `lastMessageAt` is the honest signal: null means the conversation has never
 * held a message, so there is nothing on the server to fetch and a skeleton
 * would be showing placeholder bubbles for a load that will find nothing. A
 * thread we don't know about yet also answers false — under-showing the
 * skeleton just means an empty chat that fills in, which is far better than the
 * reverse.
 */
function threadHasHistory(threadId: string): boolean {
  const row = useChatThreadsStore.getState().threads.find((t) => t.id === threadId);
  return !!row?.lastMessageAt;
}

const LOGO = require("../../assets/icon.png");

// A picked-but-not-yet-sent document. Staged in the composer so the user can add
// a prompt (or remove it) before it goes to the AI. Images are staged separately
// (see `images` below) because several can ride on one message and, unlike this,
// their bytes actually travel — see lib/chat-images.ts.
type Attachment = { type: "file"; uri: string; name: string; size?: number };

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

const Bubble = memo(({ item, colors, isStreaming, isLiveTurn, isLastAssistant, isUnanswered, isSpeaking, onExpand, onPreviewFile, onRegenerate, onRetryMessage, onSpeak, onViewImage }: { item: ChatMessage; colors: any; isStreaming?: boolean; isLiveTurn?: boolean; isLastAssistant?: boolean; isUnanswered?: boolean; isSpeaking?: boolean; onExpand?: (content: string) => void; onPreviewFile?: (file: FilePayload) => void; onRegenerate?: () => void; onRetryMessage?: (id: string) => void; onSpeak?: (id: string, text: string) => void; onViewImage?: (image: ChatImage) => void }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isUser = item.role === "user";
  // Both roles can carry frames in `content`, and neither may ever render one as
  // text. Assistant: [[MODK_FILE]] artifacts (an export) → file cards. User:
  // [[MODK_IMG]] attachments → thumbnails. Live sends arrive on item.files /
  // item.images with the frame already handled; a message reloaded from history
  // still holds it, so parse here too and prefer the live copy when there is one.
  const { text: bodyText, files: framedFiles, images: framedImages } = isUser
    ? { ...splitImageFrames(item.content), files: [] as FilePayload[] }
    : { ...splitFileFrames(item.content), images: [] as ChatImage[] };
  const files = item.files?.length ? item.files : framedFiles;
  const images = item.images?.length ? item.images : framedImages;
  // Whether there's answer text below the thinking block. While the model is
  // still reasoning, content is empty — so the thinking wrapper must not draw
  // its separator/spacing or it renders as an empty framed box.
  const hasContent = bodyText.trim().length > 0;
  // Only completed assistant answers collapse — streaming text stays fully visible.
  const isLong = !isUser && !isStreaming && bodyText.length > EXPAND_THRESHOLD;
  const collapsed = isLong && !expanded;
  // The most recent assistant reply gets a "Regenerate" affordance — re-runs the
  // last user turn for a different answer (ChatGPT-style). Hidden while streaming.
  // Deliberately NOT gated on there being answer text: a turn that ends with only
  // a thinking trace (or nothing at all) is exactly when the student needs to
  // retry, and gating on content made that bubble a dead end.
  const canRegenerate = !!isLastAssistant && !isStreaming;
  // The student's own last message never got an answer (they hit Stop, or the turn
  // died before a bubble existed). Offer the same retry there — otherwise the only
  // way back is retyping the question.
  // A send whose turn never landed is marked failed by ai-service, wherever it
  // sits in the list — not only when it happens to be last. `isUnanswered` still
  // covers the softer case (the student hit Stop, or the turn ended with no
  // bubble), so both routes to a dead end offer the same way out.
  const sendFailed = isUser && !!item.failed;
  const canRetryOwn = isUser && (sendFailed || !!isUnanswered);
  // Read-aloud is offered on every finished assistant answer, not just the last
  // one — the reason to tap it is usually a long reply further up. Dev-only
  // while the neural voice is still being evaluated on real devices.
  const canSpeak = __DEV__ && !isUser && !isStreaming && hasContent && !!onSpeak;
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
          <ThinkingTrace
            text={item.thinking}
            streaming={thinkingActive}
            durationMs={deriveThinkingMs(item)}
            dividerBelow={hasContent}
            rtl={dir === "rtl"}
            surfaceColor={colors.chatAiBubble}
          />
        ) : null}
        {/* Attachments sit ABOVE the caption, the way every messaging app puts
            them — the picture is the subject, the text is what's being asked
            about it. */}
        {isUser && images.length > 0 && (
          <View style={hasContent ? styles.bubbleImagesSpaced : undefined}>
            <ChatImageGrid images={images} onPress={onViewImage} />
          </View>
        )}
        {isUser ? (
          hasContent ? (
            <Text selectable style={[styles.messageText, { color: colors.chatUserText }, textDirStyle]}>{bodyText}</Text>
          ) : null
        ) : hasContent ? (
          // Markdown renders live while streaming too — <Markdown streaming> re-parses
          // on a timer instead of per token, so headings/tables/lists appear as they
          // are written without the O(n²) re-lex that made per-token parsing janky.
          <View style={collapsed ? styles.collapsedWrap : undefined}>
            <Markdown content={bodyText} color={colors.textPrimary} direction={dir} streaming={isStreaming} />
            {collapsed && <FadeOverlay color={colors.chatAiBubble} />}
          </View>
        ) : null}
        {/* The turn is still running but nothing has streamed for a while — the
            AI is off running tools (reading the source .docx, writing blocks).
            Mounted for the whole live turn; it stays invisible until the stream
            actually goes quiet. */}
        {isLiveTurn && <AiWorkingNote rtl={dir === "rtl"} />}
        {canRetryOwn && (
          <View style={[styles.bubbleActions, { borderTopColor: colors.chatUserText + "33" }]}>
            {/* Say it plainly. A failed send that looks delivered is what makes a
                student send the same request again — the retry below exists so
                they never have to retype it. */}
            {sendFailed && (
              <View style={styles.actionBtn}>
                <AlertCircle size={13} color={colors.chatUserText} strokeWidth={2} />
                <Text style={[styles.actionLabel, { color: colors.chatUserText }]}>
                  {t("chat.notSent", { defaultValue: "Not sent" })}
                </Text>
              </View>
            )}
            <Pressable
              // A FAILED send re-runs this exact row (no new bubble, and no
              // server-side regenerate — that path deletes the reply it replaces).
              // The unanswered case keeps the old regenerate behaviour.
              onPress={() => (sendFailed ? onRetryMessage?.(item.id) : onRegenerate?.())}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t("chat.tryAgain", { defaultValue: "Try again" })}
              style={styles.actionBtn}
            >
              <RotateCcw size={13} color={colors.chatUserText} strokeWidth={2} />
              <Text style={[styles.actionLabel, { color: colors.chatUserText }]}>{t("chat.tryAgain", { defaultValue: "Try again" })}</Text>
            </Pressable>
          </View>
        )}
        {(isLong || canRegenerate || canSpeak) && (
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
            {canSpeak && (
              <Pressable
                onPress={() => onSpeak?.(item.id, bodyText)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={isSpeaking ? t("chat.stopAudio", { defaultValue: "Stop" }) : t("chat.listen", { defaultValue: "Listen" })}
                style={styles.actionBtn}
              >
                {isSpeaking ? (
                  <Square size={11} color={colors.brandPrimaryLight} strokeWidth={2} fill={colors.brandPrimaryLight} />
                ) : (
                  <Volume2 size={13} color={colors.brandPrimaryLight} strokeWidth={2} />
                )}
                <Text style={[styles.actionLabel, { color: colors.brandPrimaryLight }]}>
                  {isSpeaking ? t("chat.stopAudio", { defaultValue: "Stop" }) : t("chat.listen", { defaultValue: "Listen" })}
                </Text>
              </Pressable>
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
export function ThesisChat({ thesisId: initialThesisId, thesisTitle, variant = "screen", onClose }: { thesisId: string | null; thesisTitle: string; variant?: "screen" | "overlay"; onClose?: () => void }) {
  // The thesis this conversation is about, which can CHANGE mid-session: an
  // unattached chat starts null and gains one when the student attaches it. Held
  // as state rather than read straight from the prop so that attach takes effect
  // on the very next turn without remounting the screen.
  const [thesisId, setThesisId] = useState<string | null>(initialThesisId);
  const colors = useThemeColors();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const [inputText, setInputText] = useState("");
  // Explicit height once onContentSizeChange measures it; undefined = let the
  // intrinsic (min/maxHeight-bounded) sizing govern. See INPUT_*_HEIGHT.
  const [inputHeight, setInputHeight] = useState<number | undefined>(undefined);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [viewerContent, setViewerContent] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  // Images picked / snapped / pasted but not yet sent. An array because a
  // student comparing two figures shouldn't have to send them one at a time.
  const [staged, setStaged] = useState<StagedImage[]>([]);
  // The attachment the reader tapped open, full screen. One viewer for the whole
  // list rather than one per bubble.
  const [viewerImage, setViewerImage] = useState<ChatImage | null>(null);
  // Room under the composer for whatever the phone puts there — a three-button
  // navigation bar, a gesture pill, or nothing — and none of it while the
  // keyboard is up. See hooks/useBottomInset.
  const composerInset = useBottomInset(8);
  const confirmInset = useBottomInset(12);
  // …plus, on Android, the keyboard's own height: edge-to-edge never resizes the
  // window for the IME, so the composer clears the keys by padding itself. The
  // list is the flexing sibling, so it shrinks by the same amount and the last
  // message stays reachable. iOS returns 0 — its KAV already shrank the region.
  const keyboardLift = useKeyboardLift();
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);
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
  // Read-aloud for a tapped assistant answer. One at a time, owned here so
  // starting a second message cuts the first off (see useSpeakMessage).
  const { speakingId, toggle: toggleSpeak, stop: stopSpeaking } = useSpeakMessage(i18n.language);
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
  // The conversation this thesis is currently in — resolved once below via
  // ensureThreadFor, not the thesis id itself. The message store, the AI turn
  // runners and the API calls all key off THIS, never `thesisId` (which only the
  // outline sync and the undo checkpoint need — see lib/ai-service.ts). Also
  // changed by handlePickThread when the student switches conversations from
  // the history panel.
  const [threadId, setThreadId] = useState<string | null>(null);
  // Full-screen conversation-history panel (components/chat/ChatHistoryPanel).
  // It owns its own list/search/loading state and only needs to know whether
  // it's open, so its own `visible` effect fetches the list — nothing to load here.
  const [historyOpen, setHistoryOpen] = useState(false);
  // AI-generated quick-action chips from the recent conversation + RAG. Only the
  // visible instance fetches, and not while an ask sheet is open. No block
  // selection in plain chat, so it grounds on the conversation alone. Declared
  // after `threadId` because it watches the thread's newest message to know when
  // to refresh.
  const { suggestions } = useComposerSuggestions(thesisId, { enabled: active && !pendingAsk, threadId });
  const messages = useChatStore((s) => s.getMessages(threadId ?? ""));
  // Infinite scroll: whether earlier messages remain and whether a page is loading.
  const hasMoreOlder = useChatStore((s) => s.getHasMoreOlder(threadId ?? ""));
  const loadingOlder = useChatStore((s) => s.getLoadingOlder(threadId ?? ""));
  const isGenerating = useChatStore((s) => s.isGenerating);
  const streamingId = useChatStore((s) => s.streamingId);
  const loadedRef = useRef(false);
  const rotation = useSharedValue(0);
  // True while the initial history is being pulled from cache/server. Starts true
  // only when nothing is in memory yet — a thesis revisited this session already
  // has its messages and shouldn't flash a skeleton.
  // The skeleton is only honest when history is actually on its way. A brand-new
  // conversation — a first-time student with no thesis, or a chat just created
  // with ＋ — has nothing to load, and placeholder bubbles there strand them
  // staring at fake messages instead of typing. Starts false; only ever raised
  // for a thread that has genuinely had messages before (see threadHasHistory).
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Resolve which conversation this thesis currently opens into — fired once
  // per mount, guarded by loadedRef so it never re-resolves a second thread out
  // from under the student. Switching conversations afterwards goes through
  // handlePickThread below, which sets `threadId` directly; it deliberately
  // does NOT touch loadedRef, so this effect can never fire again for it — the
  // effect below (keyed on threadId) is what does the actual message load for
  // BOTH paths, so it isn't repeated here.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const store = useChatThreadsStore.getState();
    // RESUME only — never create. With a thesis in hand, ask the server which
    // conversation it is currently in; without one, reopen whatever the student
    // last had open. If there is nothing to resume we leave threadId null and
    // show an empty chat they can type straight into: handleSend creates the
    // thread on the first message. Creating one here instead would leave an
    // empty conversation behind every time someone opened chat and walked away.
    const resolve = thesisId
      ? store.ensureThreadFor(thesisId)
      : store.currentThreadId
        ? Promise.resolve(store.currentThreadId)
        : Promise.resolve(null);
    void Promise.resolve(resolve)
      .then((id) => {
        if (!id) return; // nothing to resume — an empty chat, ready to type into
        setLoadingHistory(threadHasHistory(id));
        setThreadId(id);
      })
      .catch(() => {
        // Offline, or the server refused. Leave the student in an empty
        // conversation rather than an eternal skeleton — this is exactly how
        // the stuck placeholder bubbles happened: newThread() rejects, the
        // .then never runs, and nothing was left to clear the flag.
        setLoadingHistory(false);
        // A refusal here is usually a STALE currentThesisId: it outlives the
        // thesis it points at, so /threads/for-thesis 404s on a document this
        // account doesn't own. Clear it now so the composer offers to attach a
        // real one instead of silently retrying a dead id on every send.
        if (thesisId) {
          setThesisId(null);
          useThesisStore.getState().setCurrentThesis(null);
        }
      });
  }, []);

  // Load a thread's messages whenever the thread being displayed changes — the
  // initial resolve above, or a pick from the history panel. loadInitialMessages
  // itself is idempotent (it bails immediately once the thread already has
  // messages in memory this session — see lib/ai-service.ts), so switching back
  // to a thread already open this session is a no-op here: no refetch, no
  // re-flash of the skeleton. Picking the thread that's ALREADY current doesn't
  // even reach this effect — setThreadId to an unchanged value is a React no-op.
  useEffect(() => {
    if (!threadId) return;
    // Only clears — never raises. Whoever chose this thread already decided
    // whether a skeleton is warranted, because only they know if it is a
    // conversation being resumed or one created a moment ago.
    void loadInitialMessages(threadId).finally(() => setLoadingHistory(false));
  }, [threadId]);

  // Switch the conversation this screen is showing. The AI turn runners in
  // lib/ai-service.ts close over the threadId that was active when a turn
  // STARTED, not a live read of this state, so a turn already streaming keeps
  // writing into the thread it belongs to — never into whichever thread this
  // screen switches to. Read-aloud is stopped the same way regenerate/retry
  // stop it: a different conversation takes the floor. The scroll-pin flags are
  // re-armed exactly as they are on a thesis switch below (same FlatList
  // instance, an entirely different message array) — otherwise a thread opened
  // while scrolled up in the previous one would land mid-scroll instead of at
  // its latest message.
  const handlePickThread = useCallback(
    (picked: string) => {
      stopSpeaking();
      isNearBottomRef.current = true;
      userHasScrolledRef.current = false;
      setShowScrollDown(false);
      // Same rule as the initial resolve: a conversation with prior messages is
      // worth waiting for, one just created with ＋ is not.
      setLoadingHistory(threadHasHistory(picked));
      setThreadId(picked);
      useChatThreadsStore.getState().setCurrent(picked);
      setHistoryOpen(false);
      // A picked thread carries its OWN attachment, which may differ from the one
      // this screen was showing — reading it here is what makes switching from an
      // attached conversation to an unattached one (or back) actually change what
      // the composer offers and what the next turn is scoped to.
      const row = useChatThreadsStore.getState().threads.find((th) => th.id === picked);
      if (row) setThesisId(row.thesisId);
    },
    [stopSpeaking]
  );

  // Attach a thesis to this conversation. The server records WHEN, and tells the
  // model on the next turn that the earlier exchanges happened without document
  // access — so it can't describe them as though it had been reading along.
  const handleAttachThesis = useCallback(
    (picked: string) => {
      if (!threadId) return;
      // Optimistic: the composer's doc affordances should appear on the tap, not
      // after a round-trip. A failure rolls it back rather than leaving the
      // student a chat that looks attached and behaves otherwise.
      setThesisId(picked);
      void patchThread(threadId, { thesisId: picked })
        .then((row) => useChatThreadsStore.getState().applyThread(row))
        .catch(() => {
          setThesisId(null);
          Alert.alert(t("common.error"), t("chat.threads.attachFailed"));
        });
    },
    [threadId, t]
  );

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

  // Which bubble (if any) the running turn is streaming into. Derived from the
  // list rather than `streamingId` so it survives a turn whose stream id was
  // already cleared, and so exactly ONE surface owns the "still working" note:
  // the bubble when there is one, the footer indicator when there isn't yet.
  const lastMessage = messages[messages.length - 1];
  const liveTurnId = isGenerating && lastMessage?.role === "assistant" ? lastMessage.id : null;

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
    if (!threadId) return;
    // The answer being read aloud is the one about to be replaced.
    stopSpeaking();
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    void regenerateLastResponse(threadId, thesisId);
  }, [threadId, thesisId, stopSpeaking]);

  // Retry a send that never landed. Re-runs the turn for the EXISTING user row —
  // no second bubble, and no server-side regenerate (that path deletes the reply
  // it means to replace).
  const handleRetryMessage = useCallback((messageId: string) => {
    if (!threadId) return;
    stopSpeaking();
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    void retryFailedMessage(threadId, thesisId, messageId);
  }, [threadId, thesisId, stopSpeaking]);

  // Builds the outgoing text.
  //
  // Images no longer appear here: their bytes travel with the message and the
  // server records them on the row, so a `[Attached image]` marker would be a
  // second, less accurate account of the same thing. An UNCAPTIONED image still
  // needs an instruction, though — the model is being handed a picture and no
  // question — so it gets the localised default. Documents keep the marker,
  // because their contents genuinely don't travel yet.
  function composeMessage(text: string, att: Attachment | null, imageCount: number): string {
    if (att) {
      const prompt = text || t("chat.analyzeFile", { defaultValue: "Please analyze this document." });
      return `[Attached file: ${att.name}] ${prompt}`;
    }
    if (imageCount > 0 && !text) {
      return t("chat.describeImage", { defaultValue: "Please describe what you see and how it relates to my thesis." });
    }
    return text;
  }

  async function handleSend() {
    if (isGenerating) return;
    const text = inputText.trim();
    // Send when there's text, an attachment, or both — but never an empty turn.
    if (!text && !attachment && staged.length === 0) return;
    // Typing IS starting a conversation. If there is no thread yet — a first-time
    // student with no thesis, or one who opened chat and never touched ＋ — make
    // one now rather than swallowing the send. Done here and not on mount so
    // merely opening the chat and walking away doesn't litter the history panel
    // with empty conversations.
    const tid = threadId ?? (await createThreadForSend());
    if (!tid) {
      // Offline, or the server refused. Say so instead of quietly eating the
      // message — the text is still in the box at this point.
      Alert.alert(t("common.error"), t("thesis.genericError"));
      return;
    }
    const message = composeMessage(text, attachment, staged.length);
    const outgoing = staged;
    // A new turn takes the floor — don't keep reading the previous answer over it.
    stopSpeaking();
    setInputText("");
    // Also clear the native buffer: a controlled value="" set in the same tick as
    // the editable flip / keyboard dismiss can be dropped on Fabric, leaving the
    // sent text stuck in the field.
    inputRef.current?.clear();
    setInputHeight(undefined); // collapse back to one line after sending
    setAttachment(null);
    setStaged([]);
    Keyboard.dismiss();
    // Sending your own message always jumps to the latest, even if scrolled up.
    isNearBottomRef.current = true;
    setShowScrollDown(false);
    await sendMessageToAI(tid, thesisId, message, { images: outgoing.length ? outgoing : undefined });
  }

  // Create the conversation this send belongs to, on demand. Returns null when
  // it can't be created (offline, server refused) so the caller can tell the
  // student rather than dropping their message on the floor.
  async function createThreadForSend(): Promise<string | null> {
    const store = useChatThreadsStore.getState();
    const adopt = (id: string) => {
      setThreadId(id);
      store.setCurrent(id);
      return id;
    };

    if (thesisId) {
      try {
        return adopt(await store.ensureThreadFor(thesisId));
      } catch {
        // The thesis is gone, or was never this account's. currentThesisId
        // outlives the thesis it points at — a deletion, or signing in as
        // someone else — and the server rightly refuses to open a conversation
        // on a document the student doesn't own.
        //
        // That must not dead-end them. Drop the stale attachment and fall
        // through to the free conversation they were trying to start; the
        // composer then offers to attach a real thesis.
        setThesisId(null);
        useThesisStore.getState().setCurrentThesis(null);
      }
    }

    try {
      return adopt(await store.newThread(null));
    } catch {
      return null; // genuinely offline / server down — the caller says so
    }
  }

  // Add newly staged images, never past the cap. Say so when the cap is what
  // stopped them, rather than silently dropping the ones that didn't fit.
  // The alert stays OUT of the updater — a state updater has to be pure, or
  // React's double-invoke fires the dialog twice.
  function stageImages(picked: StagedImage[]) {
    if (!picked.length) return;
    const room = MAX_CHAT_IMAGES - staged.length;
    if (room <= 0) return void alertFull();
    if (picked.length > room) alertFull();
    setStaged((prev) => [...prev, ...picked.slice(0, Math.max(0, MAX_CHAT_IMAGES - prev.length))]);
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
        useNavDrawerStore.getState().openDrawer();
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
      // The three image routes all end the same way: normalised bytes staged in
      // the composer, sent with the next message rather than on their own.
      // Checking the cap BEFORE opening a picker (or a clipboard prompt) is the
      // difference between "you can attach up to four" and a dialog that seems
      // to do nothing.
      case "image": {
        const room = MAX_CHAT_IMAGES - staged.length;
        if (room <= 0) return void alertFull();
        stageImages(await pickChatImages(room));
        break;
      }
      case "camera": {
        if (staged.length >= MAX_CHAT_IMAGES) return void alertFull();
        const shot = await captureChatImage();
        if (shot) stageImages([shot]);
        break;
      }
      case "paste": {
        if (staged.length >= MAX_CHAT_IMAGES) return void alertFull();
        const pasted = await pasteChatImage();
        if (pasted) stageImages([pasted]);
        break;
      }
    }
  }

  function alertFull() {
    Alert.alert(t("chat.maxImages", { defaultValue: `You can attach up to ${MAX_CHAT_IMAGES} images.`, count: MAX_CHAT_IMAGES }));
  }

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const hasText = inputText.trim().length > 0;
  // The send button appears whenever there's something to send — text or a
  // staged attachment (so an image can be sent with no caption).
  const canSend = hasText || attachment !== null || staged.length > 0;

  const tools = [
    { key: "structure", icon: List, label: t("chat.toolStructure", { defaultValue: "Structure" }), color: colors.brandAccent },
    { key: "file", icon: Paperclip, label: t("chat.toolAttach", { defaultValue: "Attach" }), color: colors.semanticWarning },
    { key: "image", icon: ImageIcon, label: t("chat.toolPhoto", { defaultValue: "Photo" }), color: "#9959FF" },
    { key: "camera", icon: Camera, label: t("chat.toolCamera", { defaultValue: "Camera" }), color: "#0EA5E9" },
    { key: "paste", icon: ClipboardPaste, label: t("chat.toolPaste", { defaultValue: "Paste" }), color: "#10B981" },
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
            <DrawerMenuButton />
          )}
          <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>{thesisTitle}</Text>
          <Pressable
            onPress={() => setHistoryOpen(true)}
            hitSlop={8}
            style={{ padding: 4 }}
            accessibilityRole="button"
            accessibilityLabel={t("chat.threads.title")}
          >
            <History size={22} color={colors.textPrimary} strokeWidth={1.8} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* iOS only. behavior="height" DID clear the keyboard on Android, but it
          measures the gap as `frame.bottom - keyboard.screenY`, and under
          edge-to-edge the frame spans the navigation bar while the keyboard
          metrics don't — so it kept a navigation bar's height reserved with the
          keyboard CLOSED, which is the gap that used to sit under the composer.
          Android clears the keys with `keyboardLift` instead (see below); the
          two must never both be on or they double-count. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ flex: 1 }}>
          {loadingHistory && messages.length === 0 ? (
            <ChatSkeleton />
          ) : messages.length === 0 ? (
            // Nothing said yet — and nothing loading. Say what this can do for
            // them rather than showing an empty void above the composer.
            <ChatWelcome />
          ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={({ item, index }) => <Bubble item={item} colors={colors} isStreaming={item.id === streamingId} isLiveTurn={item.id === liveTurnId} isLastAssistant={index === messages.length - 1 && item.role === "assistant" && messages.length > 1} isUnanswered={index === messages.length - 1 && item.role === "user" && !isGenerating} isSpeaking={item.id === speakingId} onExpand={setViewerContent} onPreviewFile={handlePreviewFile} onRegenerate={handleRegenerate} onRetryMessage={handleRetryMessage} onSpeak={toggleSpeak} onViewImage={setViewerImage} />}
            keyExtractor={(item) => item.id}
            // The live-turn flag lives outside `data`, so tell the list about it —
            // otherwise the last bubble can keep its working note after the turn ends.
            extraData={liveTurnId}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            scrollEventThrottle={32}
            // Fetch the previous page from the server when the reader reaches the
            // top. Gated on a real drag so the opening auto-scroll to the bottom
            // (which passes through offset 0) doesn't fire a spurious load;
            // loadOlderMessages itself guards against double-loads and end-of-history.
            onStartReached={() => {
              if (!userHasScrolledRef.current || !threadId) return;
              void loadOlderMessages(threadId);
            }}
            onStartReachedThreshold={0.5}
            // Keep the on-screen content anchored when older messages are prepended,
            // so paging in earlier history doesn't jump the reader (New Architecture).
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            // Spinner at the top while an older page is loading or more remain.
            ListHeaderComponent={
              loadingOlder || hasMoreOlder ? (
                <View style={styles.loadOlder}>
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                </View>
              ) : null
            }
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
              // the single indicator — no duplicate row. The working note rides
              // along here for the same reason it does in the bubble: a turn can
              // spend minutes in a tool before the first token ever arrives.
              isGenerating && !liveTurnId ? (
                <View>
                  <TypingIndicator label={t("chat.thinking")} />
                  <AiWorkingNote rtl={i18n.language === "ar"} style={styles.footerNote} />
                </View>
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

        {/* The composer sits ON the system navigation bar: its background runs
            under it and `composerInset` is the padding that keeps the input
            clear of it, whichever navigation the phone uses. `keyboardLift`
            replaces that with the keyboard's height while typing. */}
        <View style={[styles.inputContainer, { backgroundColor: colors.bgCard, paddingBottom: composerInset + keyboardLift }]}>
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

          {/* Staged images — thumbnails in a row, each removable, shown until the
              message is sent. A row rather than the file chip's layout because
              there can be several and the picture is its own label. */}
          {staged.length > 0 && (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={styles.stagedRow}>
              {staged.map((img, i) => (
                <View key={img.uri + i} style={styles.stagedItem}>
                  <Image source={{ uri: img.uri }} style={[styles.stagedThumb, { borderColor: colors.borderDefault }]} />
                  <Pressable
                    onPress={() => setStaged((prev) => prev.filter((_, at) => at !== i))}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("chat.removeAttachment", { defaultValue: "Remove attachment" })}
                    style={[styles.stagedRemove, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
                  >
                    <X size={13} color={colors.textSecondary} strokeWidth={2.4} />
                  </Pressable>
                </View>
              ))}
            </Animated.View>
          )}

          {/* Staged document — shown until the user sends or removes it */}
          {attachment && (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={[styles.attachmentChip, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
              <View style={[styles.attachmentFileIcon, { backgroundColor: colors.brandPrimary + "22" }]}>
                <FileText size={20} color={colors.brandPrimary} strokeWidth={1.8} />
              </View>
              <View style={styles.attachmentInfo}>
                <Text style={[styles.attachmentName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {attachment.name}
                </Text>
                <Text style={[styles.attachmentMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {attachment.size != null
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

          {/* Unattached conversation: say so, and offer the way out. The AI can
              still plan, draft and cite here — it just can't touch a document —
              so this reads as an offer rather than a warning. */}
          {!thesisId && (
            <Pressable
              onPress={() => useBottomSheet.getState().openSheet("thesis-attach")}
              style={[styles.attachRow, { borderColor: colors.borderDefault, backgroundColor: colors.bgPrimary }]}
              accessibilityRole="button"
              accessibilityLabel={t("chat.threads.attach")}
            >
              <FileText size={16} color={colors.textSecondary} />
              <Text style={[styles.attachHint, { color: colors.textSecondary }]} numberOfLines={2}>
                {t("chat.threads.unattachedHint")}
              </Text>
              <Text style={[styles.attachCta, { color: colors.brandPrimary }]}>{t("chat.threads.attach")}</Text>
            </Pressable>
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
                // The measurement feeds back into the height we just set, so a
                // sub-pixel difference between what we wrote and what the native
                // side measures back would setState forever — a native-event loop
                // React eventually kills with "Maximum update depth exceeded",
                // taking the whole JS thread (and every tap) with it. Ignore
                // anything under a point: no layout depends on that much.
                onContentSizeChange={(e) => {
                  const measured = Math.min(
                    INPUT_MAX_HEIGHT,
                    Math.max(INPUT_MIN_HEIGHT, e.nativeEvent.contentSize.height)
                  );
                  setInputHeight((prev) => (prev != null && Math.abs(prev - measured) < 1 ? prev : measured));
                }}
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

      {active && (
        <AskBottomSheet
          ask={pendingAsk}
          onAnswer={(answer) => {
            setPendingAsk(null);
            if (threadId) void sendMessageToAI(threadId, thesisId, answer);
          }}
          onClose={() => setPendingAsk(null)}
        />
      )}

      {/* Gated destructive AI action → Approve/Cancel card pinned above the input.
          The doc isn't visible on this screen, so there's no "undo AI changes" chip here. */}
      {active && pendingConfirm && (
        <View
          style={[
            styles.confirmOverlay,
            { backgroundColor: colors.bgCard, borderColor: colors.borderDefault, paddingBottom: confirmInset + keyboardLift },
          ]}
        >
          <ComposerConfirm
            confirm={pendingConfirm}
            onApprove={() => threadId && void approvePendingAction(threadId, thesisId, pendingConfirm.actionId)}
            onCancel={() => threadId && void declinePendingAction(threadId, thesisId, pendingConfirm.actionId)}
            rtl={i18n.language === "ar"}
          />
        </View>
      )}

      <MessageViewer
        visible={viewerContent !== null}
        content={viewerContent}
        onClose={() => setViewerContent(null)}
      />

      {/* Full-screen view of a tapped attachment. */}
      <ChatImageViewer image={viewerImage} onClose={() => setViewerImage(null)} />

      {/* Full-screen conversation list — owns its own load/search/menu state;
          this screen only tells it whether it's open and what to do on a pick. */}
      <ChatHistoryPanel
        visible={historyOpen}
        thesisId={thesisId}
        onClose={() => setHistoryOpen(false)}
        onPick={handlePickThread}
      />

      {/* Attach a thesis to an unattached conversation. Mounted only when there
          is nothing attached — once one is, there is nothing to pick. */}
      {!thesisId && <ThesisAttachSheet onPick={handleAttachThesis} />}
    </View>
  );
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const thesisId = useThesisStore((s) => s.currentThesisId);
  const thesisTitle = useThesisStore((s) => {
    if (!s.currentThesisId) return "";
    return s.theses.find((t) => t.id === s.currentThesisId)?.title ?? "";
  });

  // No thesis is no longer a dead end. A conversation can stand on its own — a
  // plain assistant that can still plan, draft and answer questions about
  // citation — and the student attaches a thesis from the composer whenever they
  // want document editing. EmptyWriter (the writer's starters) is reachable from
  // the drawer for anyone who wants to begin one instead.
  return <ThesisChat thesisId={thesisId} thesisTitle={thesisTitle} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  topTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "center" },
  messageList: { padding: 16, paddingBottom: 10, gap: 14, flexGrow: 1 },
  loadOlder: { paddingVertical: 10, alignItems: "center" },
  // Indented to the typing indicator's bubble (avatar 28 + gap 8) so the note
  // reads as part of it rather than as a stray row under the list.
  footerNote: { marginHorizontal: 36 },
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
  confirmOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  suggestionsRow: { marginBottom: 10, marginHorizontal: 2 },
  attachRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    marginHorizontal: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachHint: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  attachCta: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
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
  bubbleImagesSpaced: { marginBottom: 8 },
  stagedRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10, marginHorizontal: 2 },
  // Padded on the top/right so the remove button, which overhangs the thumbnail,
  // isn't clipped by the row.
  stagedItem: { paddingTop: 6, paddingRight: 6 },
  stagedThumb: { width: 62, height: 62, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  stagedRemove: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
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
