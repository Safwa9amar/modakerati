import { useCallback, useEffect, useState } from "react";
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
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useBottomInset, useKeyboardLift } from "@/hooks/useBottomInset";
import {
  createSupportConversation,
  listSupportConversations,
  type SupportConversationSummary,
  type SupportStatus,
} from "@/lib/api";
import { watchMyConversations } from "@/lib/support-realtime";
import { useThesisStore } from "@/stores/thesis-store";

const MAX = 5000;

/**
 * Contact: the student's existing support threads, and the box to open a new one.
 *
 * The thread list comes first when there is one — a student returning to this
 * screen is usually here to read a reply, not to file a second ticket about the
 * same thing.
 *
 * The ticket carries context the student shouldn't have to type: which thesis
 * was attached, the app build, the platform, and the UI language (so whoever
 * answers writes back in it).
 */
export default function SupportContactScreen() {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection, textAlign, isRTL } = useRTL();
  const bottomInset = useBottomInset(24);
  // Android is edge-to-edge, so the window is never resized for the IME and the
  // KeyboardAvoidingView below is inert there. The scroll content pads itself by
  // the keyboard's height instead, which keeps the message box and the Send
  // button reachable. iOS returns 0 and lets the KAV do it.
  const keyboardLift = useKeyboardLift();
  const router = useRouter();

  // Selecting a primitive, never an object literal — see stores/ conventions.
  const currentThesisId = useThesisStore((s) => s.currentThesisId);

  const [rows, setRows] = useState<SupportConversationSummary[] | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    listSupportConversations()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(load);

  // A reply to any of the student's threads refreshes the list and its unread
  // dots without them having to leave and come back.
  useEffect(() => watchMyConversations(load), [load]);

  const submit = async () => {
    const body = message.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await createSupportConversation({
        message: body,
        language: (i18n.language || "ar").slice(0, 2),
        thesisId: currentThesisId,
        appVersion: String(Constants.expoConfig?.version ?? ""),
        platform: Platform.OS,
      });
      setMessage("");
      router.push({ pathname: "/(app)/support-thread", params: { id: created.id } } as any);
    } catch {
      setError(
        t("support.contact.failed", {
          defaultValue: "Couldn't send that. Check your connection and try again.",
        })
      );
    } finally {
      setSending(false);
    }
  };

  const statusLabel = (s: SupportStatus) =>
    s === "resolved"
      ? t("support.status.resolved", { defaultValue: "Resolved" })
      : s === "pending"
        ? t("support.status.answered", { defaultValue: "Answered" })
        : t("support.status.open", { defaultValue: "Open" });

  const statusColor = (s: SupportStatus) =>
    s === "resolved"
      ? colors.semanticSuccess
      : s === "pending"
        ? colors.brandPrimary
        : colors.textSecondary;

  const Chevron = isRTL ? ChevronLeft : ChevronRight;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={[styles.header, { flexDirection }]}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {t("support.contact.title", { defaultValue: "Contact us" })}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomInset + keyboardLift }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Existing threads, when there are any. */}
          {rows === null ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : rows.length > 0 ? (
            <View style={styles.group}>
              <Text style={[styles.groupHeading, { color: colors.textSecondary, textAlign }]}>
                {t("support.contact.yourMessages", { defaultValue: "Your messages" })}
              </Text>
              {rows.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    router.push({ pathname: "/(app)/support-thread", params: { id: c.id } } as any)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={c.subject}
                >
                  {({ pressed }) => (
                    <Card style={[styles.threadCard, pressed && { opacity: 0.7 }]}>
                      <View style={[styles.threadRow, { flexDirection }]}>
                        <View style={styles.threadText}>
                          <Text
                            style={[styles.threadSubject, { color: colors.textPrimary, textAlign }]}
                            numberOfLines={1}
                          >
                            {c.subject}
                          </Text>
                          <Text
                            style={[styles.threadLast, { color: colors.textSecondary, textAlign }]}
                            numberOfLines={1}
                          >
                            {c.lastMessage}
                          </Text>
                          <Text style={[styles.threadStatus, { color: statusColor(c.status), textAlign }]}>
                            {statusLabel(c.status)}
                          </Text>
                        </View>
                        {c.unread > 0 ? (
                          <View style={[styles.dot, { backgroundColor: colors.brandPrimary }]} />
                        ) : null}
                        <Chevron size={17} color={colors.textPlaceholder} />
                      </View>
                    </Card>
                  )}
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* New ticket. */}
          <Text style={[styles.groupHeading, { color: colors.textSecondary, textAlign }]}>
            {rows && rows.length > 0
              ? t("support.contact.newMessage", { defaultValue: "New message" })
              : t("support.contact.howCanWeHelp", { defaultValue: "How can we help?" })}
          </Text>

          <Text style={[styles.hint, { color: colors.textSecondary, textAlign }]}>
            {t("support.contact.hint", {
              defaultValue:
                "Describe what you were doing, what you expected, and what happened instead. The more precise, the faster the answer.",
            })}
          </Text>

          <Card style={styles.composer}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={MAX}
              placeholder={t("support.contact.placeholder", {
                defaultValue: "Write your message…",
              })}
              placeholderTextColor={colors.textPlaceholder}
              style={[styles.input, { color: colors.textPrimary, textAlign }]}
              textAlignVertical="top"
              editable={!sending}
            />
          </Card>

          {error ? (
            <Text style={[styles.error, { color: colors.semanticError, textAlign }]}>{error}</Text>
          ) : null}

          <Button
            title={t("support.contact.send", { defaultValue: "Send" })}
            onPress={submit}
            loading={sending}
            disabled={!message.trim()}
            style={styles.send}
          />

          <Text style={[styles.privacy, { color: colors.textPlaceholder, textAlign }]}>
            {t("support.contact.privacy", {
              defaultValue:
                "Your message reaches the Kwill team with your name and email. We never read your thesis unless you ask us to.",
            })}
          </Text>
        </ScrollView>
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
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  content: { paddingHorizontal: 20 },
  loading: { paddingVertical: 24 },
  group: { marginBottom: 22 },
  groupHeading: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  threadCard: { marginBottom: 8 },
  threadRow: { alignItems: "center", gap: 10 },
  threadText: { flex: 1 },
  threadSubject: { fontSize: 14.5, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  threadLast: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 4 },
  threadStatus: { fontSize: 11.5, fontFamily: "Inter_600SemiBold" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hint: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 12 },
  composer: { paddingVertical: 6 },
  input: { minHeight: 140, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  error: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 10 },
  send: { marginTop: 14 },
  privacy: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 14 },
});
