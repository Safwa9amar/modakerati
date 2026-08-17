import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Send } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useBottomInset } from "@/hooks/useBottomInset";
import {
  getSupportConversation,
  replyToSupportConversation,
  type SupportConversationDetail,
} from "@/lib/api";

/**
 * One support conversation: the messages, and a box to add to it.
 *
 * Deliberately NOT modelled on the assistant chat — this is correspondence with
 * a person, not a stream. Both sides get a bubble (unlike the assistant
 * transcript, where only the student does) because here neither party is "the
 * app talking".
 */
export default function SupportThreadScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign } = useRTL();
  const bottomInset = useBottomInset(12);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [thread, setThread] = useState<SupportConversationDetail | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Refetched on focus rather than polled: a support reply arrives in minutes or
  // hours, not seconds, and a poll on a help screen is battery spent for nothing.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let alive = true;
      getSupportConversation(id)
        .then((r) => alive && setThread(r))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [id])
  );

  const send = async () => {
    const body = reply.trim();
    if (!body || sending || !id) return;
    setSending(true);
    try {
      const created = await replyToSupportConversation(id, body);
      setReply("");
      setThread((cur) =>
        cur ? { ...cur, status: "open", messages: [...cur.messages, created] } : cur
      );
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      // Keep what they typed so a failed send is retryable, not lost.
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {thread?.subject || t("support.contact.title", { defaultValue: "Contact us" })}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        {thread === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messages}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {thread.messages.map((m) => {
              const staff = m.sender === "staff";
              return (
                <View
                  key={m.id}
                  style={[styles.bubbleRow, { alignItems: staff ? "flex-start" : "flex-end" }]}
                >
                  <View
                    style={[
                      styles.bubble,
                      staff
                        ? { backgroundColor: colors.bgSurface }
                        : { backgroundColor: colors.chatUserBubble },
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        { color: staff ? colors.textPrimary : colors.chatUserText, textAlign },
                      ]}
                    >
                      {m.body}
                    </Text>
                  </View>
                  <Text style={[styles.who, { color: colors.textPlaceholder }]}>
                    {staff
                      ? m.authorName ||
                        t("support.thread.team", { defaultValue: "Kwill team" })
                      : t("support.thread.you", { defaultValue: "You" })}
                  </Text>
                </View>
              );
            })}

            {thread.status === "resolved" ? (
              <Text style={[styles.resolved, { color: colors.textPlaceholder }]}>
                {t("support.thread.resolvedNote", {
                  defaultValue: "Marked resolved. Reply below to reopen it.",
                })}
              </Text>
            ) : null}
          </ScrollView>
        )}

        <View
          style={[
            styles.composer,
            { borderTopColor: colors.borderSubtle, paddingBottom: bottomInset, flexDirection },
          ]}
        >
          <TextInput
            value={reply}
            onChangeText={setReply}
            multiline
            maxLength={5000}
            placeholder={t("support.thread.replyPlaceholder", { defaultValue: "Write a reply…" })}
            placeholderTextColor={colors.textPlaceholder}
            style={[
              styles.input,
              { color: colors.textPrimary, backgroundColor: colors.bgInput, textAlign },
            ]}
            editable={!sending}
          />
          <Pressable
            onPress={send}
            disabled={!reply.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={t("support.contact.send", { defaultValue: "Send" })}
            style={[
              styles.sendButton,
              {
                backgroundColor: colors.brandPrimary,
                opacity: !reply.trim() || sending ? 0.4 : 1,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.brandOnPrimary} />
            ) : (
              <Send size={17} color={colors.brandOnPrimary} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  messages: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  bubbleRow: { marginBottom: 14 },
  bubble: { maxWidth: "88%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11 },
  bubbleText: { fontSize: 14.5, fontFamily: "Inter_400Regular", lineHeight: 22 },
  who: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4, paddingHorizontal: 4 },
  resolved: { fontSize: 12.5, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
  composer: {
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  sendButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
