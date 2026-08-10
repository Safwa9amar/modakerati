import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  SectionList,
  FlatList,
  Alert,
  StyleSheet,
  type DimensionValue,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { X, Search, Plus, FileText, Pencil, Pin, Archive, Trash2 } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { firstStrongDirection, isolateBidi, type TextDirection } from "@/lib/text-direction";
import { useChatThreadsStore } from "@/stores/chat-threads-store";
import { useThesisStore } from "@/stores/thesis-store";
import { groupThreads } from "@/lib/thread-groups";
import { SkeletonGroup, SkeletonBlock, SkeletonCard } from "@/components/ui/Skeleton";
import type { ChatThread, ThreadSearchResult } from "@/lib/api";
import type { ThemeColors } from "@/constants/colors";

// -----------------------------------------------------------------------------
// The conversation history panel: every thread the student can switch to,
// grouped by pin state then thesis (see lib/thread-groups.ts), with search
// across message content. A slide-in overlay presented as a full-screen Modal —
// same visible/onClose contract as MessageViewer/ChatImages, so it composes the
// same way over whatever screen is hosting it.
//
// This component only RENDERS the list and fires the store's actions; wiring a
// trigger button into the chat screen is a separate task.
// -----------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 300;

function dirStyle(dir: TextDirection) {
  return { textAlign: dir === "rtl" ? ("right" as const) : ("left" as const), writingDirection: dir };
}

// Relative time reuses the existing generic "notifications.*" strings rather
// than adding a parallel set under chat.threads — "just now / 3m ago / 2h ago /
// 5d ago" are plain time phrases, not notification-specific, and every locale
// already has them translated.
function relativeTime(iso: string, t: TFunction): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("notifications.justNow");
  if (mins < 60) return t("notifications.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("notifications.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("notifications.daysAgo", { count: days });
}

export function ChatHistoryPanel({
  visible,
  thesisId,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** Used only to pre-attach a thread created with ＋. */
  thesisId: string | null;
  onClose: () => void;
  onPick: (threadId: string) => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PanelBody visible={visible} thesisId={thesisId} onClose={onClose} onPick={onPick} />
      </SafeAreaProvider>
    </Modal>
  );
}

function PanelBody({
  visible,
  thesisId,
  onClose,
  onPick,
}: {
  visible: boolean;
  thesisId: string | null;
  onClose: () => void;
  onPick: (threadId: string) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const ambientDir: TextDirection = rtl.isRTL ? "rtl" : "ltr";

  // Select primitives / stable references only — never a fresh object or array
  // literal out of a zustand selector (see the store's own EMPTY_RESULTS note).
  const threads = useChatThreadsStore((s) => s.threads);
  const currentThreadId = useChatThreadsStore((s) => s.currentThreadId);
  const loading = useChatThreadsStore((s) => s.loading);
  const results = useChatThreadsStore((s) => s.results);
  const load = useChatThreadsStore((s) => s.load);
  const newThread = useChatThreadsStore((s) => s.newThread);
  const rename = useChatThreadsStore((s) => s.rename);
  const setPinned = useChatThreadsStore((s) => s.setPinned);
  const setArchived = useChatThreadsStore((s) => s.setArchived);
  const remove = useChatThreadsStore((s) => s.remove);
  const search = useChatThreadsStore((s) => s.search);

  const theses = useThesisStore((s) => s.theses);

  const [queryInput, setQueryInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuThread, setMenuThread] = useState<ChatThread | null>(null);
  const [renameThread, setRenameThread] = useState<ChatThread | null>(null);
  const [renameText, setRenameText] = useState("");

  const trimmedQuery = queryInput.trim();
  const hasQuery = trimmedQuery.length > 0;

  // Refresh the full (unscoped) list every time the panel opens — the server
  // is the source of truth for display order, same convention as AppDrawer's
  // thesis list refresh.
  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // Closing resets the search field and drops any in-flight results, so the
  // next open starts from the section list rather than a stale query.
  useEffect(() => {
    if (!visible) {
      setQueryInput("");
      search("");
    }
  }, [visible, search]);

  // Debounced search. Clearing the field fires immediately rather than waiting
  // out the debounce, so "clearing it returns to the section list" is snappy.
  useEffect(() => {
    if (!visible) return;
    if (!trimmedQuery) {
      search("");
      return;
    }
    const id = setTimeout(() => search(queryInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput, visible]);

  const thesisTitles = useMemo(() => new Map(theses.map((th) => [th.id, th.title])), [theses]);

  const sections = useMemo(
    () => groupThreads(threads).map((s) => ({ key: s.key, data: s.threads })),
    [threads],
  );

  const showSkeleton = loading && threads.length === 0 && !hasQuery;
  const showEmpty = hasQuery ? results.length === 0 : !loading && sections.length === 0;

  const openMenu = useCallback((thread: ChatThread) => setMenuThread(thread), []);
  const closeMenu = useCallback(() => setMenuThread(null), []);

  const openRename = useCallback((thread: ChatThread) => {
    setMenuThread(null);
    setRenameText(thread.title ?? "");
    setRenameThread(thread);
  }, []);

  const saveRename = useCallback(() => {
    const thread = renameThread;
    setRenameThread(null);
    if (!thread) return;
    const trimmed = renameText.trim();
    if (!trimmed || trimmed === (thread.title ?? "")) return;
    rename(thread.id, trimmed);
  }, [renameThread, renameText, rename]);

  const togglePin = useCallback(
    (thread: ChatThread) => {
      setMenuThread(null);
      setPinned(thread.id, !thread.pinned);
    },
    [setPinned],
  );

  const toggleArchive = useCallback(
    (thread: ChatThread) => {
      setMenuThread(null);
      setArchived(thread.id, !thread.archivedAt);
    },
    [setArchived],
  );

  const confirmDelete = useCallback(
    (thread: ChatThread) => {
      setMenuThread(null);
      Alert.alert(t("chat.threads.delete"), t("chat.threads.deleteConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("chat.threads.delete"), style: "destructive", onPress: () => remove(thread.id) },
      ]);
    },
    [t, remove],
  );

  const pick = useCallback(
    (id: string) => {
      onPick(id);
      onClose();
    },
    [onPick, onClose],
  );

  const handleNewThread = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await newThread(thesisId);
      pick(id);
    } catch {
      Alert.alert(t("common.error"), t("thesis.genericError"));
    } finally {
      setCreating(false);
    }
  }, [creating, newThread, thesisId, pick, t]);

  const menuTitle = menuThread ? menuThread.title?.trim() || t("chat.threads.untitled") : "";
  const menuTitleDir = firstStrongDirection(menuTitle, ambientDir);
  const renameDir = firstStrongDirection(renameText, ambientDir);

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={[styles.header, { flexDirection: rtl.flexDirection, borderBottomColor: colors.borderSubtle }]}>
        <Text style={[styles.title, { color: colors.textPrimary, textAlign: rtl.textAlign }]} numberOfLines={1}>
          {t("chat.threads.title")}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          style={[styles.closeBtn, { backgroundColor: colors.bgSurface }]}
        >
          <X size={19} color={colors.textPrimary} strokeWidth={2} />
        </Pressable>
      </View>

      <View
        style={[
          styles.searchBox,
          { flexDirection: rtl.flexDirection, backgroundColor: colors.bgInput, borderColor: colors.borderDefault },
        ]}
      >
        <Search size={16} color={colors.textSecondary} />
        <TextInput
          value={queryInput}
          onChangeText={setQueryInput}
          placeholder={t("chat.threads.search")}
          placeholderTextColor={colors.textPlaceholder}
          style={[styles.searchInput, { color: colors.textPrimary, textAlign: rtl.textAlign }]}
          returnKeyType="search"
          autoCorrect={false}
        />
        {hasQuery && (
          <Pressable onPress={() => setQueryInput("")} hitSlop={8}>
            <X size={15} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={handleNewThread}
        disabled={creating}
        style={[styles.newRow, { flexDirection: rtl.flexDirection, opacity: creating ? 0.6 : 1 }]}
        accessibilityRole="button"
      >
        <View style={[styles.newIconBox, { backgroundColor: colors.brandPrimary + "1A" }]}>
          <Plus size={17} color={colors.brandPrimary} strokeWidth={2.4} />
        </View>
        <Text style={[styles.newLabel, { color: colors.brandPrimary, textAlign: rtl.textAlign }]}>
          {t("chat.threads.new")}
        </Text>
      </Pressable>

      {showSkeleton ? (
        <ThreadsSkeleton />
      ) : showEmpty ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t("chat.threads.empty")}</Text>
        </View>
      ) : hasQuery ? (
        <FlatList
          data={results}
          keyExtractor={(r) => r.messageId}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }: { item: ThreadSearchResult }) => (
            <ThreadRow
              thread={item.thread}
              current={item.thread.id === currentThreadId}
              subtitle={item.snippet}
              ambientDir={ambientDir}
              rtl={rtl}
              colors={colors}
              t={t}
              onPress={() => pick(item.thread.id)}
              onLongPress={() => openMenu(item.thread)}
            />
          )}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section }) => {
            const label =
              section.key === "pinned"
                ? t("chat.threads.pinned")
                : section.key === "none"
                  ? t("chat.threads.noThesis")
                  : (thesisTitles.get(section.key) ?? section.key);
            const dir = firstStrongDirection(label, ambientDir);
            return (
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }, dirStyle(dir)]}>
                {isolateBidi(label, dir)}
              </Text>
            );
          }}
          renderItem={({ item }: { item: ChatThread }) => (
            <ThreadRow
              thread={item}
              current={item.id === currentThreadId}
              subtitle={relativeTime(item.lastMessageAt ?? item.createdAt, t)}
              ambientDir={ambientDir}
              rtl={rtl}
              colors={colors}
              t={t}
              onPress={() => pick(item.id)}
              onLongPress={() => openMenu(item)}
            />
          )}
        />
      )}

      {/* Row action sheet: rename / pin / archive / delete. */}
      <Modal transparent visible={!!menuThread} animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.backdrop} onPress={closeMenu}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.bgModal }]} onPress={() => {}}>
            {menuThread && (
              <>
                <Text
                  numberOfLines={1}
                  style={[styles.sheetTitle, { color: colors.textSecondary }, dirStyle(menuTitleDir)]}
                >
                  {isolateBidi(menuTitle, menuTitleDir)}
                </Text>
                <Pressable onPress={() => openRename(menuThread)} style={styles.item}>
                  <Pencil size={18} color={colors.textPrimary} strokeWidth={2} />
                  <Text style={[styles.itemText, { color: colors.textPrimary }]}>{t("chat.threads.rename")}</Text>
                </Pressable>
                <Pressable onPress={() => togglePin(menuThread)} style={styles.item}>
                  <Pin size={18} color={colors.textPrimary} strokeWidth={2} />
                  <Text style={[styles.itemText, { color: colors.textPrimary }]}>
                    {menuThread.pinned ? t("chat.threads.unpin") : t("chat.threads.pin")}
                  </Text>
                </Pressable>
                <Pressable onPress={() => toggleArchive(menuThread)} style={styles.item}>
                  <Archive size={18} color={colors.textPrimary} strokeWidth={2} />
                  <Text style={[styles.itemText, { color: colors.textPrimary }]}>
                    {menuThread.archivedAt ? t("chat.threads.unarchive") : t("chat.threads.archive")}
                  </Text>
                </Pressable>
                <Pressable onPress={() => confirmDelete(menuThread)} style={styles.item}>
                  <Trash2 size={18} color={colors.semanticError} strokeWidth={2} />
                  <Text style={[styles.itemText, { color: colors.semanticError }]}>{t("chat.threads.delete")}</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rename dialog. */}
      <Modal
        transparent
        visible={!!renameThread}
        animationType="fade"
        onRequestClose={() => setRenameThread(null)}
      >
        <View style={styles.centerBackdrop}>
          <View style={[styles.dialog, { backgroundColor: colors.bgModal }]}>
            <Text style={[styles.dialogTitle, { color: colors.textPrimary, textAlign: rtl.textAlign }]}>
              {t("chat.threads.rename")}
            </Text>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              style={[
                styles.input,
                {
                  backgroundColor: colors.bgInput,
                  color: colors.textPrimary,
                  borderColor: colors.borderDefault,
                  ...dirStyle(renameDir),
                },
              ]}
              placeholderTextColor={colors.textPlaceholder}
            />
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setRenameThread(null)} style={styles.dialogBtn}>
                <Text style={[styles.dialogBtnText, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable onPress={saveRename} style={[styles.dialogBtn, { backgroundColor: colors.brandPrimary }]}>
                <Text style={[styles.dialogBtnText, { color: "#FFFFFF" }]}>{t("common.save")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// One thread row, shared by the section list and the flat search-result list —
// only the subtitle differs (relative time vs. a match snippet). Title and
// subtitle each carry their OWN content direction (a French title inside an
// Arabic-locale panel still reads left-to-right), isolated the same way
// Markdown.tsx isolates an inline run so mixed-script punctuation doesn't drift
// to the wrong side.
function ThreadRow({
  thread,
  current,
  subtitle,
  ambientDir,
  rtl,
  colors,
  t,
  onPress,
  onLongPress,
}: {
  thread: ChatThread;
  current: boolean;
  subtitle: string;
  ambientDir: TextDirection;
  rtl: ReturnType<typeof useRTL>;
  colors: ThemeColors;
  t: TFunction;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const title = thread.title?.trim() || t("chat.threads.untitled");
  const titleDir = firstStrongDirection(title, ambientDir);
  const subtitleDir = firstStrongDirection(subtitle, ambientDir);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        styles.row,
        { flexDirection: rtl.flexDirection, borderColor: colors.borderSubtle },
        current && { backgroundColor: colors.bgSurface },
      ]}
    >
      {thread.thesisId ? (
        <View style={[styles.badge, { backgroundColor: colors.brandPrimary + "1A" }]}>
          <FileText size={13} color={colors.brandPrimary} strokeWidth={2} />
        </View>
      ) : (
        <View style={styles.badgeSpacer} />
      )}
      <View style={styles.rowBody}>
        <View style={[styles.titleLine, { flexDirection: rtl.flexDirection }]}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.textPrimary }, dirStyle(titleDir)]}>
            {isolateBidi(title, titleDir)}
          </Text>
          {current && <View style={[styles.currentDot, { backgroundColor: colors.brandPrimary }]} />}
        </View>
        <View style={[styles.metaLine, { flexDirection: rtl.flexDirection }]}>
          <Text
            numberOfLines={1}
            style={[styles.rowSubtitle, { color: colors.textSecondary, flex: 1 }, dirStyle(subtitleDir)]}
          >
            {isolateBidi(subtitle, subtitleDir)}
          </Text>
          {!!thread.archivedAt && (
            <Text style={[styles.archivedTag, { color: colors.textPlaceholder }]}>
              {t("chat.threads.archived")}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// Layout-shaped placeholder for the initial list fetch — never a spinner. Rows
// mirror the real ones (badge + two text lines) under a bucket label, and every
// bar breathes off the ONE pulse SkeletonGroup owns.
const SKELETON_TITLE_WIDTHS: DimensionValue[] = ["70%", "52%", "62%", "44%", "58%"];

function ThreadsSkeleton() {
  return (
    <SkeletonGroup style={styles.skeletonWrap} label="Loading conversations">
      <SkeletonBlock width={64} height={11} radius={4} style={styles.skeletonLabel} />
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={`a${i}`} style={styles.skeletonCard}>
          <View style={styles.skeletonRow}>
            <SkeletonBlock width={28} height={28} radius={8} />
            <View style={styles.skeletonBody}>
              <SkeletonBlock width={SKELETON_TITLE_WIDTHS[i % SKELETON_TITLE_WIDTHS.length]} height={13} />
              <SkeletonBlock width={72} height={10} radius={4} style={styles.skeletonTime} />
            </View>
          </View>
        </SkeletonCard>
      ))}
      <SkeletonBlock width={90} height={11} radius={4} style={styles.skeletonLabel} />
      {[0, 1].map((i) => (
        <SkeletonCard key={`b${i}`} style={styles.skeletonCard}>
          <View style={styles.skeletonRow}>
            <SkeletonBlock width={28} height={28} radius={8} />
            <View style={styles.skeletonBody}>
              <SkeletonBlock width={SKELETON_TITLE_WIDTHS[(i + 3) % SKELETON_TITLE_WIDTHS.length]} height={13} />
              <SkeletonBlock width={72} height={10} radius={4} style={styles.skeletonTime} />
            </View>
          </View>
        </SkeletonCard>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },

  searchBox: {
    alignItems: "center",
    gap: 8,
    height: 40,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },

  newRow: { alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  newIconBox: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  newLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },

  list: { paddingHorizontal: 12, paddingTop: 4 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    marginTop: 14,
    marginBottom: 6,
  },

  row: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  badge: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  badgeSpacer: { width: 26 },
  rowBody: { flex: 1, gap: 3 },
  titleLine: { alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  currentDot: { width: 6, height: 6, borderRadius: 3 },
  metaLine: { alignItems: "center", gap: 8 },
  rowSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  archivedTag: { fontSize: 10.5, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },

  skeletonWrap: { paddingHorizontal: 20 },
  skeletonLabel: { marginTop: 10, marginBottom: 10 },
  skeletonCard: { padding: 12, borderRadius: 12, marginBottom: 8 },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  skeletonBody: { flex: 1 },
  skeletonTime: { marginTop: 8 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { padding: 16, paddingBottom: 32, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 4 },
  sheetTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginLeft: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
  itemText: { fontSize: 15, fontFamily: "Inter_500Medium" },

  centerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  dialog: { width: "100%", borderRadius: 18, padding: 20, gap: 16 },
  dialogTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  dialogBtn: { minWidth: 84, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  dialogBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
