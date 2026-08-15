import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronUp, Hash, Plus, Trash2 } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import {
  CAPTION_FORMATS,
  CAPTION_SEPARATORS,
  previewNumber,
  useCaptionSheetStore,
} from "@/stores/caption-sheet-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  deleteThesisCaption,
  insertThesisCaption,
  listThesisCaptions,
  updateThesisCaption,
  type CaptionNumberFormat,
  type CaptionSeparator,
  type CaptionsDTO,
  type DocBlockDTO,
} from "@/lib/api";
import { visualRow, visualTextAlign } from "@/lib/rtl-layout";

/** How much of the screen the sheet covers. Under two thirds on purpose: the student
 *  is captioning something they need to SEE, and the panel scrolls internally. */
export const CAPTION_SHEET_FRACTION = 0.66;
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;
const PAD = 16;
/** Heading level that starts a chapter, matching Word's "Chapter starts with style". */
const CHAPTER_LEVELS = [1, 2, 3] as const;

/** Stable identity: a selector returning a fresh [] would loop the store. */
const EMPTY_BLOCKS: DocBlockDTO[] = [];

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Root-level bottom push drawer for Word's References → Insert Caption dialog.
 *
 * A caption is a document OBJECT, not a line of text: it carries a label, a
 * self-numbering field, a position relative to what it describes, and the whole
 * Caption Numbering dialog (format, chapter numbers, separator). None of that fits
 * in the floating block pill — the same reason the header/footer editor became a
 * sheet — so the picture bubble, the References/Picture ribbon tabs and the AI dock
 * all open this one surface.
 *
 * Wrap the app with it once, at the root, like HeaderFooterSheet.
 */
export function CaptionSheet({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const DRAWER_H = Math.round(height * CAPTION_SHEET_FRACTION);

  const open = useCaptionSheetStore((s) => s.open);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const openSV = useSharedValue(open);

  const close = () => useCaptionSheetStore.getState().close();

  useEffect(() => {
    openSV.value = open;
  }, [open, openSV]);

  useAnimatedReaction(
    () => (dragging.value ? -1 : openSV.value ? 1 : 0),
    (target) => {
      if (target >= 0) progress.value = withSpring(target, SPRING);
    },
  );

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const dragPan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          progress.value = clamp(1 - e.translationY / DRAWER_H, 0, 1);
        })
        .onEnd((e) => {
          const keep = progress.value > 0.55 && e.velocityY < 800;
          openSV.value = keep;
          dragging.value = false;
          if (!keep) runOnJS(close)();
        })
        .onFinalize(() => {
          dragging.value = false;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [DRAWER_H],
  );

  const appStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -progress.value * (insets.top + 6) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.94]) },
    ],
    borderRadius: progress.value * 16,
  }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * (DRAWER_H + 40) }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.app, appStyle]}>{children}</Animated.View>

      {/* No dim: the figure being captioned must stay visible behind the sheet. */}
      <View style={[StyleSheet.absoluteFill, styles.tapCatcher]} pointerEvents={open ? "auto" : "none"}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </View>

      <Animated.View style={[styles.drawer, { height: DRAWER_H }, drawerStyle]} pointerEvents={open ? "auto" : "none"}>
        {/* Unmounted while closed so the draft options and the caption fetch don't
            outlive the block they belong to. */}
        {open ? <CaptionPanel dragPan={dragPan} bottomInset={insets.bottom} /> : null}
      </Animated.View>
    </View>
  );
}

function CaptionPanel({ dragPan, bottomInset }: { dragPan: ReturnType<typeof Gesture.Pan>; bottomInset: number }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { isRTL: appRtl } = useRTL();
  const rowDir = visualRow(appRtl);
  const textAlign = visualTextAlign(appRtl);

  const thesisId = useCaptionSheetStore((s) => s.thesisId);
  const mode = useCaptionSheetStore((s) => s.mode);
  const index = useCaptionSheetStore((s) => s.index);
  const kind = useCaptionSheetStore((s) => s.kind);
  const initialText = useCaptionSheetStore((s) => s.text);
  // The live block list, for the chapter-number preview. A document that hasn't
  // loaded (or isn't a live .docx) simply yields no headings — the preview then
  // shows chapter 1, and the server computes the real number on insert anyway.
  const blocks = useThesisDocStore((s) => {
    const d = thesisId ? s.byId[thesisId] : undefined;
    return d?.available ? d.blocks : EMPTY_BLOCKS;
  });

  const [data, setData] = useState<CaptionsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState(initialText);
  const [label, setLabel] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [position, setPosition] = useState<"above" | "below">(kind === "table" ? "above" : "below");
  const [excludeLabel, setExcludeLabel] = useState(false);
  const [format, setFormat] = useState<CaptionNumberFormat>("arabic");
  const [includeChapter, setIncludeChapter] = useState(false);
  const [chapterLevel, setChapterLevel] = useState<number>(1);
  const [separator, setSeparator] = useState<CaptionSeparator>("-");
  const [numberingOpen, setNumberingOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const errorMsg = t("common.error", { defaultValue: "Something went wrong" });

  // The sheet covers the lower two thirds, so scroll what's being captioned into
  // the strip that's left — the student is describing something they need to SEE.
  const revealNonce = useCaptionSheetStore((s) => s.revealNonce);
  useEffect(() => {
    useWorkspaceStore.getState().requestScrollToBlock(index);
  }, [revealNonce, index]);

  // Load the document's labels + existing captions: the Label picker IS the thesis's
  // own convention (Word remembers labels per user; the document is our store), and
  // the live preview needs to know which number this caption would get.
  useEffect(() => {
    if (!thesisId) return;
    let alive = true;
    setLoading(true);
    listThesisCaptions(thesisId)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [thesisId]);

  // Edit mode opens from anywhere — a bubble chip only knows the block index, not the
  // caption's wording (the document DTO carries the whole line, "Figure 1 …", label
  // and number included). Seed the field from the parsed caption once it arrives.
  useEffect(() => {
    if (mode !== "edit" || !data) return;
    const hit = data.captions.find((c) => c.index === index);
    if (hit) setText((cur) => (cur ? cur : hit.text));
  }, [mode, data, index]);

  // Pre-pick the label the way Word pre-picks the last one used: prefer a label this
  // document already uses for this kind, else its most-used, else the first offered.
  useEffect(() => {
    if (!data || label !== null) return;
    const hints: Record<typeof kind, RegExp> = {
      figure: /^(figure|fig\.?|illustration|schéma|schema|الشكل|شكل|رسم)/i,
      table: /^(table|tableau|tabl\.?|الجدول|جدول)/i,
      equation: /^(equation|équation|formule|المعادلة|معادلة)/i,
    };
    const used = data.labels.filter((l) => l.count > 0);
    const match = used.find((l) => hints[kind].test(l.label)) ?? data.labels.find((l) => hints[kind].test(l.label));
    setLabel(match?.label ?? used[0]?.label ?? data.labels[0]?.label ?? "Figure");
  }, [data, kind, label]);

  const insertAt = position === "below" ? index + 1 : index;

  /** The number this caption will get — counted the way the server counts it, so the
   *  preview doesn't promise a number the document then disagrees with. */
  const nextNumber = useMemo(() => {
    if (!data || !label) return 1;
    const before = data.captions.filter((c) => c.label === label && c.index < insertAt);
    if (!includeChapter) return before.length + 1;
    // With chapter numbers the sequence restarts at every chapter heading, so only
    // the captions since the last one count.
    const lastHeading = blocks.reduce(
      (max, b) => (b.kind === "paragraph" && b.level === chapterLevel && b.index < insertAt ? Math.max(max, b.index) : max),
      -1,
    );
    return before.filter((c) => c.index > lastHeading).length + 1;
  }, [data, label, insertAt, includeChapter, chapterLevel, blocks]);

  /** How many chapter headings precede the caption — the "1" in "Figure 1-1". */
  const chapterNumber = useMemo(() => {
    return blocks.filter((b) => b.kind === "paragraph" && b.level === chapterLevel && b.index < insertAt).length || 1;
  }, [blocks, chapterLevel, insertAt]);

  // In edit mode the label and number are the caption's own and cannot change here —
  // renumbering is the document's job, not a form field's.
  const editing = mode === "edit";
  const editingCaption = editing ? data?.captions.find((c) => c.index === index) : undefined;

  const previewLabel = editing ? (editingCaption?.label ?? "") : excludeLabel ? "" : (label ?? "");
  const previewNum = editing
    ? (editingCaption?.number ?? "")
    : (includeChapter ? `${chapterNumber}${separator}` : "") + previewNumber(nextNumber, format);
  const docRtl = data?.rtl ?? appRtl;

  const submit = () => {
    if (!thesisId || saving) return;
    const wording = text.trim();
    setSaving(true);
    Keyboard.dismiss();
    void (async () => {
      try {
        const res = editing
          ? await updateThesisCaption(thesisId, index, wording)
          : await insertThesisCaption(thesisId, {
              nearIndex: index,
              label: label ?? "Figure",
              text: wording,
              position,
              excludeLabel,
              format,
              includeChapterNumber: includeChapter,
              chapterStyle: `Heading${chapterLevel}`,
              chapterSeparator: separator,
            });
        // Inserting shifts every later block index by +1, so nothing optimistic here:
        // the echoed document is the new source of truth.
        if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
        useCaptionSheetStore.getState().close();
      } catch {
        Alert.alert(errorMsg);
      } finally {
        setSaving(false);
      }
    })();
  };

  const remove = () => {
    if (!thesisId || saving) return;
    Alert.alert(
      t("workspace.caption.deleteTitle", { defaultValue: "Delete this caption?" }),
      t("workspace.caption.deleteBody", { defaultValue: "The remaining captions are renumbered." }),
      [
        { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
        {
          text: t("common.delete", { defaultValue: "Delete" }),
          style: "destructive",
          onPress: () => {
            setSaving(true);
            void (async () => {
              try {
                const res = await deleteThesisCaption(thesisId, index);
                if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
                useCaptionSheetStore.getState().close();
              } catch {
                Alert.alert(errorMsg);
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ],
    );
  };

  const addLabel = () => {
    const clean = newLabel.trim();
    if (!clean) return;
    setData((cur) =>
      cur && !cur.labels.some((l) => l.label === clean)
        ? { ...cur, labels: [...cur.labels, { label: clean, count: 0 }] }
        : cur,
    );
    setLabel(clean);
    setNewLabel("");
    setAddingLabel(false);
  };

  const chip = (active: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: active ? colors.brandPrimary : colors.borderDefault,
    backgroundColor: active ? colors.brandPrimary + "1A" : colors.bgPrimary,
  });
  const chipText = (active: boolean) => ({
    fontSize: 13,
    fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
    color: active ? colors.brandPrimary : colors.textPrimary,
  });

  return (
    <View style={[styles.panel, { backgroundColor: colors.bgSurface, borderColor: colors.borderDefault }]}>
      <GestureDetector gesture={dragPan}>
        <View style={styles.grabZone}>
          <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {editing
              ? t("workspace.caption.editTitle", { defaultValue: "Caption" })
              : t("workspace.caption.title", { defaultValue: "Insert caption" })}
          </Text>
        </View>
      </GestureDetector>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: PAD, paddingBottom: bottomInset + 24, gap: 18 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Live preview — exactly what the line will read, in the DOCUMENT's
              direction (an Arabic thesis previews right-to-left even in a French UI). */}
          <View style={[styles.preview, { borderColor: colors.borderDefault, backgroundColor: colors.bgPrimary }]}>
            <Text
              style={[styles.previewText, { color: colors.textPrimary, textAlign: visualTextAlign(docRtl) }]}
              numberOfLines={3}
            >
              <Text style={styles.previewNum}>
                {[previewLabel, previewNum].filter(Boolean).join(" ")}
              </Text>
              {text.trim() ? ` ${text.trim()}` : ""}
            </Text>
          </View>

          {/* Caption text */}
          <View style={{ gap: 7 }}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
              {t("workspace.caption.text", { defaultValue: "Caption" })}
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              autoFocus
              multiline
              placeholder={t("workspace.caption.textPlaceholder", { defaultValue: "What this shows…" })}
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.input,
                { color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgPrimary, textAlign: visualTextAlign(docRtl) },
              ]}
            />
          </View>

          {/* Everything below is fixed once a caption exists: its label and number
              belong to the document's sequence, and re-labelling one caption would
              split that sequence in two. */}
          {editing ? null : (
            <>
              {/* Label */}
              <View style={{ gap: 7 }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
                  {t("workspace.caption.label", { defaultValue: "Label" })}
                </Text>
                <View style={[styles.wrap, { flexDirection: rowDir }]}>
                  {(data?.labels ?? []).map((l) => (
                    <Pressable key={l.label} onPress={() => setLabel(l.label)} style={chip(label === l.label)} accessibilityRole="button">
                      <Text style={chipText(label === l.label)}>{l.label}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setAddingLabel((v) => !v)}
                    style={[chip(false), { flexDirection: rowDir, alignItems: "center", gap: 5 }]}
                    accessibilityRole="button"
                    accessibilityLabel={t("workspace.caption.newLabel", { defaultValue: "New label" })}
                  >
                    <Plus size={14} color={colors.textSecondary} strokeWidth={2.2} />
                    <Text style={[chipText(false), { color: colors.textSecondary }]}>
                      {t("workspace.caption.newLabel", { defaultValue: "New label" })}
                    </Text>
                  </Pressable>
                </View>
                {addingLabel ? (
                  <View style={[{ flexDirection: rowDir }, styles.newLabelRow]}>
                    <TextInput
                      value={newLabel}
                      onChangeText={setNewLabel}
                      autoFocus
                      onSubmitEditing={addLabel}
                      placeholder={t("workspace.caption.newLabelPlaceholder", { defaultValue: "e.g. Carte, الشكل رقم" })}
                      placeholderTextColor={colors.textPlaceholder}
                      style={[styles.labelInput, { color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgPrimary, textAlign }]}
                    />
                    <Pressable onPress={addLabel} style={[styles.addBtn, { backgroundColor: colors.brandPrimary }]} accessibilityRole="button">
                      <Check size={17} color={colors.brandOnPrimary} strokeWidth={2.6} />
                    </Pressable>
                  </View>
                ) : null}
              </View>

              {/* Position */}
              <View style={{ gap: 7 }}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
                  {t("workspace.caption.position", { defaultValue: "Position" })}
                </Text>
                <View style={[styles.wrap, { flexDirection: rowDir }]}>
                  {(["above", "below"] as const).map((p) => (
                    <Pressable key={p} onPress={() => setPosition(p)} style={chip(position === p)} accessibilityRole="button">
                      <Text style={chipText(position === p)}>
                        {p === "above"
                          ? t("workspace.caption.above", { defaultValue: "Above the item" })
                          : t("workspace.caption.below", { defaultValue: "Below the item" })}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Exclude label */}
              <View style={[styles.switchRow, { flexDirection: rowDir }]}>
                <Text style={[styles.switchLabel, { color: colors.textPrimary, textAlign }]}>
                  {t("workspace.caption.excludeLabel", { defaultValue: "Exclude label from caption" })}
                </Text>
                <Switch
                  value={excludeLabel}
                  onValueChange={setExcludeLabel}
                  trackColor={{ true: colors.brandPrimary }}
                />
              </View>

              {/* Numbering — Word's "Numbering… / Format…" sub-dialog, collapsed by
                  default because the default (1, 2, 3) is what most theses want. */}
              <Pressable
                onPress={() => setNumberingOpen((v) => !v)}
                style={[styles.sectionToggle, { flexDirection: rowDir, borderColor: colors.borderDefault }]}
                accessibilityRole="button"
              >
                <Hash size={16} color={colors.textSecondary} strokeWidth={2} />
                <Text style={[styles.sectionToggleText, { color: colors.textPrimary, textAlign }]}>
                  {t("workspace.caption.numbering", { defaultValue: "Numbering" })}
                </Text>
                {numberingOpen ? (
                  <ChevronUp size={17} color={colors.textSecondary} strokeWidth={2} />
                ) : (
                  <ChevronDown size={17} color={colors.textSecondary} strokeWidth={2} />
                )}
              </Pressable>

              {numberingOpen ? (
                <View style={{ gap: 16 }}>
                  <View style={{ gap: 7 }}>
                    <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
                      {t("workspace.caption.format", { defaultValue: "Format" })}
                    </Text>
                    <View style={[styles.wrap, { flexDirection: rowDir }]}>
                      {CAPTION_FORMATS.map((f) => (
                        <Pressable key={f.value} onPress={() => setFormat(f.value)} style={chip(format === f.value)} accessibilityRole="button">
                          <Text style={chipText(format === f.value)}>{f.sample}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={[styles.switchRow, { flexDirection: rowDir }]}>
                    <Text style={[styles.switchLabel, { color: colors.textPrimary, textAlign }]}>
                      {t("workspace.caption.includeChapter", { defaultValue: "Include chapter number" })}
                    </Text>
                    <Switch
                      value={includeChapter}
                      onValueChange={setIncludeChapter}
                      trackColor={{ true: colors.brandPrimary }}
                    />
                  </View>

                  {includeChapter ? (
                    <>
                      <View style={{ gap: 7 }}>
                        <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
                          {t("workspace.caption.chapterStyle", { defaultValue: "Chapter starts with style" })}
                        </Text>
                        <View style={[styles.wrap, { flexDirection: rowDir }]}>
                          {CHAPTER_LEVELS.map((lvl) => (
                            <Pressable key={lvl} onPress={() => setChapterLevel(lvl)} style={chip(chapterLevel === lvl)} accessibilityRole="button">
                              <Text style={chipText(chapterLevel === lvl)}>
                                {t("workspace.caption.heading", { defaultValue: "Heading {{n}}", n: lvl })}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>

                      <View style={{ gap: 7 }}>
                        <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
                          {t("workspace.caption.separator", { defaultValue: "Use separator" })}
                        </Text>
                        <View style={[styles.wrap, { flexDirection: rowDir }]}>
                          {CAPTION_SEPARATORS.map((sep) => (
                            <Pressable key={sep} onPress={() => setSeparator(sep)} style={chip(separator === sep)} accessibilityRole="button">
                              <Text style={[chipText(separator === sep), { fontSize: 15 }]}>{sep}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}
            </>
          )}

          {/* Actions */}
          <View style={[{ flexDirection: rowDir }, styles.actions]}>
            {editing ? (
              <Pressable
                onPress={remove}
                disabled={saving}
                style={[styles.iconBtn, { borderColor: colors.borderDefault }]}
                accessibilityRole="button"
                accessibilityLabel={t("common.delete", { defaultValue: "Delete" })}
              >
                <Trash2 size={18} color={colors.semanticError} strokeWidth={2} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => useCaptionSheetStore.getState().close()}
              disabled={saving}
              style={[styles.secondaryBtn, { borderColor: colors.borderDefault }]}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: colors.textPrimary }]}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={saving || (!editing && !label)}
              style={[styles.primaryBtn, { backgroundColor: colors.brandPrimary, opacity: saving ? 0.6 : 1 }]}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.brandOnPrimary} />
              ) : (
                <Check size={17} color={colors.brandOnPrimary} strokeWidth={2.4} />
              )}
              <Text style={[styles.btnText, { color: colors.brandOnPrimary }]}>
                {editing ? t("common.save", { defaultValue: "Save" }) : t("workspace.caption.insert", { defaultValue: "Insert" })}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  app: { flex: 1, overflow: "hidden", backgroundColor: "transparent" },
  tapCatcher: { zIndex: 1 },
  drawer: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 2 },
  panel: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 20,
  },
  grabZone: { paddingTop: 10, paddingBottom: 8, alignItems: "center" },
  grab: { width: 44, height: 5, borderRadius: 3, marginBottom: 10 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  preview: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  previewText: { fontSize: 14, lineHeight: 21 },
  previewNum: { fontFamily: "Inter_700Bold" },

  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  input: { minHeight: 74, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  wrap: { flexWrap: "wrap", gap: 8 },

  newLabelRow: { alignItems: "center", gap: 8 },
  labelInput: { flex: 1, height: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 14 },
  addBtn: { width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },

  switchRow: { alignItems: "center", justifyContent: "space-between", gap: 12 },
  switchLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },

  sectionToggle: { alignItems: "center", gap: 9, paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1, borderRadius: 12 },
  sectionToggleText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },

  actions: { alignItems: "center", gap: 10, marginTop: 4 },
  iconBtn: { width: 46, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  secondaryBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  primaryBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, borderRadius: 12 },
  btnText: { fontSize: 13.5, fontFamily: "Inter_700Bold" },
});
